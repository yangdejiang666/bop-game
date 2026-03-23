import { PROTOCOL_ERROR } from "./constants.js";
import { dbAll, dbBatch, dbFirst, dbRun } from "./db.js";
import { requireAuth } from "./auth-handlers.js";
import { failure, nowIso, readJson, success, clampNonNegativeInteger, toBoolean } from "./helpers.js";
import { getUserSummaryById } from "./user-store.js";

function normalizeVisibility(value) {
  return value === "public" ? "public" : "private";
}

function normalizeTeamMode(value) {
  return value === "team" ? "team" : "solo";
}

function safeMaxMembers(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 4;
  }
  return Math.max(2, Math.min(50, Math.floor(numeric)));
}

function safeMinStartMembers(value, maxMembers) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.min(2, maxMembers);
  }
  return Math.max(2, Math.min(maxMembers, Math.floor(numeric)));
}

async function getRoomRowById(db, roomId) {
  return dbFirst(
    db,
    `
      SELECT
        room_id,
        mode_id,
        visibility,
        invite_code,
        owner_user_id,
        status,
        team_mode,
        max_members,
        min_start_members,
        version,
        created_at,
        updated_at
      FROM rooms
      WHERE room_id = ?
      LIMIT 1
    `,
    [roomId],
  );
}

async function getRoomMembers(db, roomId) {
  return dbAll(
    db,
    `
      SELECT
        user_id,
        nickname_snapshot,
        avatar_url_snapshot,
        ready,
        role,
        team_id,
        joined_at,
        is_online
      FROM room_members
      WHERE room_id = ?
      ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, datetime(joined_at) ASC
    `,
    [roomId],
  );
}

function canStartRoom(snapshot) {
  if (snapshot.status !== "idle") {
    return false;
  }
  if (snapshot.members.length < snapshot.minStartMembers) {
    return false;
  }
  return snapshot.members.every((member) => member.ready || member.role === "owner");
}

function roomStatusAfterReady(snapshot) {
  return canStartRoom(snapshot) ? "matching" : "idle";
}

export async function getRoomSnapshotById(db, roomId) {
  const room = await getRoomRowById(db, roomId);
  if (!room) {
    return null;
  }
  const members = await getRoomMembers(db, roomId);
  return {
    roomId: room.room_id,
    modeId: room.mode_id,
    visibility: room.visibility,
    inviteCode: room.invite_code || null,
    ownerUserId: room.owner_user_id,
    status: room.status,
    teamMode: room.team_mode,
    maxMembers: clampNonNegativeInteger(room.max_members, 4),
    minStartMembers: clampNonNegativeInteger(room.min_start_members, 2),
    members: members.map((member) => ({
      userId: member.user_id,
      nickname: member.nickname_snapshot,
      avatarUrl: member.avatar_url_snapshot || "",
      ready: toBoolean(member.ready),
      role: member.role,
      teamId:
        member.team_id === null || member.team_id === undefined
          ? null
          : Number(member.team_id),
      joinedAt: member.joined_at,
      isOnline: toBoolean(member.is_online),
    })),
    createdAt: room.created_at,
    updatedAt: room.updated_at,
    version: clampNonNegativeInteger(room.version, 1),
  };
}

async function findRoomByInviteCode(db, inviteCode) {
  const room = await dbFirst(
    db,
    `
      SELECT room_id
      FROM rooms
      WHERE invite_code = ?
      LIMIT 1
    `,
    [inviteCode],
  );
  return room?.room_id ? getRoomSnapshotById(db, room.room_id) : null;
}

async function findActiveRoomIdByUser(db, userId) {
  const row = await dbFirst(
    db,
    `
      SELECT r.room_id
      FROM room_members m
      INNER JOIN rooms r ON r.room_id = m.room_id
      WHERE m.user_id = ? AND r.status != 'closed'
      ORDER BY datetime(r.updated_at) DESC
      LIMIT 1
    `,
    [userId],
  );
  return row?.room_id || null;
}

async function assignTeamId(db, roomId) {
  const counts = await dbAll(
    db,
    `
      SELECT team_id, COUNT(*) AS member_count
      FROM room_members
      WHERE room_id = ? AND team_id IS NOT NULL
      GROUP BY team_id
    `,
    [roomId],
  );
  const teamA = counts.find((row) => Number(row.team_id) === 0);
  const teamB = counts.find((row) => Number(row.team_id) === 1);
  return clampNonNegativeInteger(teamA?.member_count, 0) <=
    clampNonNegativeInteger(teamB?.member_count, 0)
    ? 0
    : 1;
}

async function touchRoomUpdated(db, roomId) {
  await dbRun(
    db,
    `
      UPDATE rooms
      SET version = version + 1, updated_at = ?
      WHERE room_id = ?
    `,
    [nowIso(), roomId],
  );
}

export async function handleCreateRoom(request, env, requestId) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const body = (await readJson(request)) || {};
  const modeId =
    typeof body.modeId === "string" ? body.modeId.trim().slice(0, 32) : "";
  if (!modeId) {
    return failure(
      request,
      requestId,
      400,
      PROTOCOL_ERROR.INVALID_REQUEST,
      "modeId is required.",
      { field: "modeId" },
    );
  }

  const existingRoomId = await findActiveRoomIdByUser(
    required.auth.db,
    required.auth.userId,
  );
  if (existingRoomId) {
    const existingSnapshot = await getRoomSnapshotById(
      required.auth.db,
      existingRoomId,
    );
    if (existingSnapshot && existingSnapshot.status !== "closed") {
      return success(request, requestId, { room: existingSnapshot });
    }
  }

  const summary = await getUserSummaryById(required.auth.db, required.auth.userId);
  const visibility = normalizeVisibility(body.visibility);
  const teamMode = normalizeTeamMode(body.teamMode);
  const maxMembers = safeMaxMembers(body.maxMembers);
  const minStartMembers = safeMinStartMembers(body.minStartMembers, maxMembers);
  const roomId = `room_${crypto.randomUUID().replaceAll("-", "")}`;
  const inviteCode =
    visibility === "private"
      ? Math.random().toString(36).slice(2, 8).toUpperCase()
      : null;
  const timestamp = nowIso();

  await dbBatch(required.auth.db, [
    {
      sql: `
        INSERT INTO rooms (
          room_id,
          mode_id,
          visibility,
          invite_code,
          owner_user_id,
          status,
          team_mode,
          max_members,
          min_start_members,
          version,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, 'idle', ?, ?, ?, 1, ?, ?)
      `,
      params: [
        roomId,
        modeId,
        visibility,
        inviteCode,
        required.auth.userId,
        teamMode,
        maxMembers,
        minStartMembers,
        timestamp,
        timestamp,
      ],
    },
    {
      sql: `
        INSERT INTO room_members (
          id,
          room_id,
          user_id,
          nickname_snapshot,
          avatar_url_snapshot,
          ready,
          role,
          team_id,
          is_online,
          joined_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, 'owner', ?, 1, ?, ?)
      `,
      params: [
        `roommember_${crypto.randomUUID().replaceAll("-", "")}`,
        roomId,
        required.auth.userId,
        summary?.summary.profile.nickname || "勇者球球",
        summary?.summary.profile.avatarUrl || "",
        teamMode === "team" ? 0 : null,
        timestamp,
        timestamp,
      ],
    },
  ]);

  const snapshot = await getRoomSnapshotById(required.auth.db, roomId);
  return success(request, requestId, { room: snapshot }, 201);
}

export async function handleJoinRoom(request, env, requestId) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const body = (await readJson(request)) || {};
  let roomSnapshot = null;
  if (typeof body.roomId === "string" && body.roomId.trim()) {
    roomSnapshot = await getRoomSnapshotById(required.auth.db, body.roomId.trim());
  } else if (typeof body.inviteCode === "string" && body.inviteCode.trim()) {
    roomSnapshot = await findRoomByInviteCode(
      required.auth.db,
      body.inviteCode.trim().toUpperCase(),
    );
  }

  if (!roomSnapshot) {
    return failure(
      request,
      requestId,
      404,
      PROTOCOL_ERROR.ROOM_NOT_FOUND,
      "Room not found.",
    );
  }

  if (roomSnapshot.status !== "idle") {
    return failure(
      request,
      requestId,
      409,
      PROTOCOL_ERROR.ROOM_INVALID_STATE,
      "Room is not joinable right now.",
      { roomId: roomSnapshot.roomId, status: roomSnapshot.status },
    );
  }

  const existingRoomId = await findActiveRoomIdByUser(
    required.auth.db,
    required.auth.userId,
  );
  if (existingRoomId && existingRoomId !== roomSnapshot.roomId) {
    return failure(
      request,
      requestId,
      409,
      PROTOCOL_ERROR.CONFLICT,
      "User already in another room.",
      { roomId: existingRoomId },
    );
  }

  const existingMember = roomSnapshot.members.find(
    (member) => member.userId === required.auth.userId,
  );
  if (existingMember) {
    return success(request, requestId, { room: roomSnapshot });
  }

  if (roomSnapshot.members.length >= roomSnapshot.maxMembers) {
    return failure(
      request,
      requestId,
      409,
      PROTOCOL_ERROR.ROOM_FULL,
      "Room is full.",
      { roomId: roomSnapshot.roomId, maxMembers: roomSnapshot.maxMembers },
    );
  }

  const summary = await getUserSummaryById(required.auth.db, required.auth.userId);
  await dbRun(
    required.auth.db,
    `
      INSERT INTO room_members (
        id,
        room_id,
        user_id,
        nickname_snapshot,
        avatar_url_snapshot,
        ready,
        role,
        team_id,
        is_online,
        joined_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 'member', ?, 1, ?, ?)
    `,
    [
      `roommember_${crypto.randomUUID().replaceAll("-", "")}`,
      roomSnapshot.roomId,
      required.auth.userId,
      summary?.summary.profile.nickname || "勇者球球",
      summary?.summary.profile.avatarUrl || "",
      roomSnapshot.teamMode === "team"
        ? await assignTeamId(required.auth.db, roomSnapshot.roomId)
        : null,
      nowIso(),
      nowIso(),
    ],
  );
  await touchRoomUpdated(required.auth.db, roomSnapshot.roomId);
  roomSnapshot = await getRoomSnapshotById(required.auth.db, roomSnapshot.roomId);
  return success(request, requestId, { room: roomSnapshot });
}

export async function handleLeaveRoom(request, env, requestId) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const body = (await readJson(request)) || {};
  const roomId = typeof body.roomId === "string" ? body.roomId.trim() : "";
  if (!roomId) {
    return failure(
      request,
      requestId,
      400,
      PROTOCOL_ERROR.INVALID_REQUEST,
      "roomId is required.",
      { field: "roomId" },
    );
  }

  let snapshot = await getRoomSnapshotById(required.auth.db, roomId);
  if (!snapshot) {
    return failure(
      request,
      requestId,
      404,
      PROTOCOL_ERROR.ROOM_NOT_FOUND,
      "Room not found.",
    );
  }

  const member = snapshot.members.find(
    (entry) => entry.userId === required.auth.userId,
  );
  if (!member) {
    return failure(
      request,
      requestId,
      403,
      PROTOCOL_ERROR.ROOM_NOT_MEMBER,
      "You are not in this room.",
    );
  }

  await dbRun(
    required.auth.db,
    "DELETE FROM room_members WHERE room_id = ? AND user_id = ?",
    [roomId, required.auth.userId],
  );

  snapshot = await getRoomSnapshotById(required.auth.db, roomId);
  let roomClosed = false;
  let nextOwnerUserId = null;

  if (!snapshot || snapshot.members.length === 0) {
    roomClosed = true;
    await dbRun(
      required.auth.db,
      "UPDATE rooms SET status = 'closed', updated_at = ? WHERE room_id = ?",
      [nowIso(), roomId],
    );
  } else {
    if (snapshot.ownerUserId === required.auth.userId) {
      const nextOwner = snapshot.members[0];
      nextOwnerUserId = nextOwner?.userId || null;
      if (nextOwnerUserId) {
        const timestamp = nowIso();
        await dbBatch(required.auth.db, [
          {
            sql: "UPDATE rooms SET owner_user_id = ?, updated_at = ?, version = version + 1 WHERE room_id = ?",
            params: [nextOwnerUserId, timestamp, roomId],
          },
          {
            sql: "UPDATE room_members SET role = CASE WHEN user_id = ? THEN 'owner' ELSE 'member' END, updated_at = ? WHERE room_id = ?",
            params: [nextOwnerUserId, timestamp, roomId],
          },
        ]);
      }
    } else {
      await touchRoomUpdated(required.auth.db, roomId);
    }

    snapshot = await getRoomSnapshotById(required.auth.db, roomId);
    if (snapshot) {
      const nextStatus = roomStatusAfterReady(snapshot);
      await dbRun(
        required.auth.db,
        "UPDATE rooms SET status = ?, updated_at = ?, version = version + 1 WHERE room_id = ?",
        [nextStatus, nowIso(), roomId],
      );
    }
  }

  return success(request, requestId, {
    roomId,
    leftUserId: required.auth.userId,
    roomClosed,
    nextOwnerUserId,
  });
}

export async function handleReadyRoom(request, env, requestId) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const body = (await readJson(request)) || {};
  const roomId = typeof body.roomId === "string" ? body.roomId.trim() : "";
  if (!roomId) {
    return failure(
      request,
      requestId,
      400,
      PROTOCOL_ERROR.INVALID_REQUEST,
      "roomId is required.",
      { field: "roomId" },
    );
  }

  const snapshot = await getRoomSnapshotById(required.auth.db, roomId);
  if (!snapshot) {
    return failure(
      request,
      requestId,
      404,
      PROTOCOL_ERROR.ROOM_NOT_FOUND,
      "Room not found.",
    );
  }

  const member = snapshot.members.find(
    (entry) => entry.userId === required.auth.userId,
  );
  if (!member) {
    return failure(
      request,
      requestId,
      403,
      PROTOCOL_ERROR.ROOM_NOT_MEMBER,
      "You are not in this room.",
    );
  }

  await dbRun(
    required.auth.db,
    `
      UPDATE room_members
      SET ready = ?, updated_at = ?
      WHERE room_id = ? AND user_id = ?
    `,
    [body.ready ? 1 : 0, nowIso(), roomId, required.auth.userId],
  );

  const updatedSnapshot = await getRoomSnapshotById(required.auth.db, roomId);
  const nextStatus = roomStatusAfterReady(updatedSnapshot);
  await dbRun(
    required.auth.db,
    "UPDATE rooms SET status = ?, updated_at = ?, version = version + 1 WHERE room_id = ?",
    [nextStatus, nowIso(), roomId],
  );
  return success(request, requestId, {
    room: await getRoomSnapshotById(required.auth.db, roomId),
  });
}

export async function handleQueryRoomByInviteCode(
  request,
  env,
  requestId,
  inviteCode,
) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const room = await findRoomByInviteCode(
    required.auth.db,
    inviteCode.trim().toUpperCase(),
  );
  if (!room) {
    return failure(
      request,
      requestId,
      404,
      PROTOCOL_ERROR.ROOM_NOT_FOUND,
      "Room not found.",
    );
  }

  return success(request, requestId, { room });
}

export async function handleGetRoomSnapshot(request, env, requestId, roomId) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const room = await getRoomSnapshotById(required.auth.db, roomId);
  if (!room) {
    return failure(
      request,
      requestId,
      404,
      PROTOCOL_ERROR.ROOM_NOT_FOUND,
      "Room not found.",
    );
  }

  return success(request, requestId, { room });
}
