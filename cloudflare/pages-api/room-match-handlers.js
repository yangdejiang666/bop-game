import { PROTOCOL_ERROR } from "./constants.js";
import { dbFirst, dbRun } from "./db.js";
import { requireAuth } from "./auth-handlers.js";
import { failure, nowIso, readJson, success } from "./helpers.js";
import { getRoomSnapshotById } from "./room-handlers.js";
import {
  applyRoomMatchInput,
  createPublicRoomMatchSnapshot,
  createRoomMatchState,
  simulateRoomMatchState,
} from "./room-match-engine.js";

function canStartRoomMatch(room) {
  if (!room) {
    return false;
  }

  if (!(room.status === "idle" || room.status === "matching" || room.status === "inGame")) {
    return false;
  }

  if (room.members.length < room.minStartMembers) {
    return false;
  }

  return room.members.every((member) => member.ready || member.role === "owner");
}

async function getLiveSessionRow(db, roomId) {
  return dbFirst(
    db,
    `
      SELECT
        room_id,
        session_id,
        mode_id,
        phase,
        version,
        state_json,
        created_at,
        updated_at,
        started_at,
        finished_at,
        last_simulated_at
      FROM room_live_sessions
      WHERE room_id = ?
      LIMIT 1
    `,
    [roomId],
  );
}

function parseSessionRow(row) {
  if (!row) {
    return null;
  }

  const parsed = JSON.parse(row.state_json);
  return {
    ...parsed,
    sessionId: row.session_id,
    roomId: row.room_id,
    modeId: row.mode_id,
    phase: row.phase,
    version: Number(row.version) || parsed.version || 1,
    startedAt: row.started_at,
    lastSimulatedAt: row.last_simulated_at || parsed.lastSimulatedAt,
  };
}

async function persistSessionState(db, roomId, expectedVersion, state, timestamp) {
  const result = await dbRun(
    db,
    `
      UPDATE room_live_sessions
      SET
        session_id = ?,
        mode_id = ?,
        phase = ?,
        version = ?,
        state_json = ?,
        updated_at = ?,
        started_at = ?,
        finished_at = ?,
        last_simulated_at = ?
      WHERE room_id = ? AND version = ?
    `,
    [
      state.sessionId,
      state.modeId,
      state.phase,
      state.version,
      JSON.stringify(state),
      timestamp,
      state.startedAt,
      state.phase === "finished" ? timestamp : null,
      state.lastSimulatedAt,
      roomId,
      expectedVersion,
    ],
  );

  return Number(result?.meta?.changes ?? 0) > 0;
}

async function createSessionRow(db, room, state, timestamp) {
  await dbRun(
    db,
    `
      INSERT OR REPLACE INTO room_live_sessions (
        room_id,
        session_id,
        mode_id,
        phase,
        version,
        state_json,
        created_at,
        updated_at,
        started_at,
        finished_at,
        last_simulated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      room.roomId,
      state.sessionId,
      state.modeId,
      state.phase,
      state.version,
      JSON.stringify(state),
      timestamp,
      timestamp,
      state.startedAt,
      state.phase === "finished" ? timestamp : null,
      state.lastSimulatedAt,
    ],
  );
}

async function syncRoomStatusForMatch(db, room, nextStatus, timestamp) {
  if (room.status === nextStatus) {
    return;
  }

  await dbRun(
    db,
    "UPDATE rooms SET status = ?, updated_at = ?, version = version + 1 WHERE room_id = ?",
    [nextStatus, timestamp, room.roomId],
  );
}

async function materializeSessionForUser(db, room, userId, input, requestTimestamp) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const sessionRow = await getLiveSessionRow(db, room.roomId);
    if (!sessionRow) {
      return null;
    }

    const sessionState = parseSessionRow(sessionRow);
    let nextState = simulateRoomMatchState(
      sessionState,
      room,
      requestTimestamp,
    );
    nextState = applyRoomMatchInput(nextState, userId, input, requestTimestamp);

    const persisted = await persistSessionState(
      db,
      room.roomId,
      Number(sessionRow.version) || sessionState.version || 1,
      nextState,
      requestTimestamp,
    );

    if (!persisted) {
      continue;
    }

    await syncRoomStatusForMatch(
      db,
      room,
      nextState.phase === "finished" ? "idle" : "inGame",
      requestTimestamp,
    );

    return nextState;
  }

  throw new Error("Room live session update conflicted too many times.");
}

export async function handleStartRoomMatch(request, env, requestId) {
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

  let room = await getRoomSnapshotById(required.auth.db, roomId);
  if (!room) {
    return failure(
      request,
      requestId,
      404,
      PROTOCOL_ERROR.ROOM_NOT_FOUND,
      "Room not found.",
    );
  }

  if (room.ownerUserId !== required.auth.userId) {
    return failure(
      request,
      requestId,
      403,
      PROTOCOL_ERROR.ROOM_PERMISSION_DENIED || PROTOCOL_ERROR.FORBIDDEN,
      "Only the room owner can start a private match.",
      { roomId },
    );
  }

  if (!canStartRoomMatch(room)) {
    return failure(
      request,
      requestId,
      409,
      PROTOCOL_ERROR.ROOM_START_CONDITION_NOT_MET || PROTOCOL_ERROR.ROOM_INVALID_STATE,
      "房间人数或准备状态还不满足开局条件。",
      {
        roomId,
        minStartMembers: room.minStartMembers,
        memberCount: room.members.length,
      },
    );
  }

  const timestamp = nowIso();
  let sessionState = null;
  const existingRow = await getLiveSessionRow(required.auth.db, roomId);
  if (existingRow) {
    sessionState = parseSessionRow(existingRow);
    if (sessionState.phase === "running") {
      sessionState = await materializeSessionForUser(
        required.auth.db,
        room,
        required.auth.userId,
        { moveX: 0, moveY: 0 },
        timestamp,
      );
      room = await getRoomSnapshotById(required.auth.db, roomId);
      return success(request, requestId, {
        room,
        session: createPublicRoomMatchSnapshot(sessionState, required.auth.userId),
      });
    }
  }

  sessionState = createRoomMatchState(room, timestamp);
  await createSessionRow(required.auth.db, room, sessionState, timestamp);
  await syncRoomStatusForMatch(required.auth.db, room, "inGame", timestamp);
  room = await getRoomSnapshotById(required.auth.db, roomId);

  return success(
    request,
    requestId,
    {
      room,
      session: createPublicRoomMatchSnapshot(sessionState, required.auth.userId),
    },
    201,
  );
}

export async function handleSyncRoomMatch(request, env, requestId) {
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

  let room = await getRoomSnapshotById(required.auth.db, roomId);
  if (!room) {
    return failure(
      request,
      requestId,
      404,
      PROTOCOL_ERROR.ROOM_NOT_FOUND,
      "Room not found.",
    );
  }

  const membership = room.members.find(
    (member) => member.userId === required.auth.userId,
  );
  if (!membership) {
    return failure(
      request,
      requestId,
      403,
      PROTOCOL_ERROR.ROOM_NOT_MEMBER,
      "You are not in this room.",
      { roomId },
    );
  }

  const sessionRow = await getLiveSessionRow(required.auth.db, roomId);
  if (!sessionRow) {
    return failure(
      request,
      requestId,
      409,
      PROTOCOL_ERROR.ROOM_INVALID_STATE,
      "房间对局还没有开始，请等待房主开局。",
      { roomId, status: room.status },
    );
  }

  const timestamp = nowIso();
  const state = await materializeSessionForUser(
    required.auth.db,
    room,
    required.auth.userId,
    body.input,
    timestamp,
  );
  room = await getRoomSnapshotById(required.auth.db, roomId);

  return success(request, requestId, {
    room,
    session: createPublicRoomMatchSnapshot(state, required.auth.userId),
  });
}
