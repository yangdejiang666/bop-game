import type {
  RoomMatchSnapshot,
  RoomMemberSnapshot,
  RoomSnapshot,
  RoomTeamMode,
  RoomVisibility,
} from "@bop/shared-protocol";
import type { QueryResultRow } from "pg";
import type { DbExecutor } from "../lib/db.js";
import { query } from "../lib/db.js";
import { isUserDirectoryEntryOnline } from "./userDirectoryRepository.js";

interface RoomRow extends QueryResultRow {
  id: string;
  room_id: string;
  mode_id: string;
  visibility: "public" | "private";
  invite_code: string | null;
  owner_user_id: string;
  status: "idle" | "matching" | "in_game" | "closed";
  team_mode: "solo" | "team";
  max_members: number;
  min_start_members: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface RoomMemberRow extends QueryResultRow {
  user_id: string;
  nickname_snapshot: string;
  avatar_url_snapshot: string | null;
  ready: boolean;
  role: "owner" | "member";
  team_id: number | null;
  joined_at: string;
  last_seen_at: string | null;
}

export interface LiveRoomSessionRow extends QueryResultRow {
  room_id: string;
  session_id: string;
  mode_id: string;
  phase: "running" | "finished";
  version: number;
  state_json: unknown;
  created_at: string;
  updated_at: string;
  started_at: string;
  finished_at: string | null;
  last_simulated_at: string;
}

type Executor = DbExecutor;

function getExecutor(executor?: Executor): Executor {
  return (
    executor ?? {
      query: (text, params) => query(text, params),
    }
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function createInviteCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function toProtocolStatus(status: RoomRow["status"]): RoomSnapshot["status"] {
  if (status === "in_game") {
    return "inGame";
  }
  return status;
}

function toDbStatus(status: RoomSnapshot["status"]): RoomRow["status"] {
  if (status === "inGame") {
    return "in_game";
  }
  return status;
}

function mapRoomMember(row: RoomMemberRow): RoomMemberSnapshot {
  return {
    userId: row.user_id,
    nickname: row.nickname_snapshot,
    avatarUrl: row.avatar_url_snapshot ?? "",
    ready: row.ready,
    role: row.role,
    teamId: row.team_id,
    joinedAt: row.joined_at,
    isOnline: isUserDirectoryEntryOnline({ lastSeenAt: row.last_seen_at }),
  };
}

async function listRoomMembers(
  roomDbId: string,
  executor?: Executor,
): Promise<RoomMemberSnapshot[]> {
  const db = getExecutor(executor);
  const result = await db.query<RoomMemberRow>(
    `
      SELECT
        rm.user_id,
        rm.nickname_snapshot,
        rm.avatar_url_snapshot,
        rm.ready,
        rm.role::text AS role,
        rm.team_id,
        rm.joined_at,
        sessions.last_seen_at
      FROM room_members rm
      LEFT JOIN LATERAL (
        SELECT MAX(last_seen_at) AS last_seen_at
        FROM auth_sessions
        WHERE user_id = rm.user_id
          AND revoked_at IS NULL
      ) sessions ON TRUE
      WHERE rm.room_id = $1
      ORDER BY
        CASE WHEN rm.role = 'owner' THEN 0 ELSE 1 END,
        rm.joined_at ASC
    `,
    [roomDbId],
  );

  return result.rows.map(mapRoomMember);
}

async function buildRoomSnapshot(
  row: RoomRow,
  executor?: Executor,
): Promise<RoomSnapshot> {
  const members = await listRoomMembers(row.id, executor);
  return {
    roomId: row.room_id,
    modeId: row.mode_id,
    visibility: row.visibility,
    inviteCode: row.invite_code,
    ownerUserId: row.owner_user_id,
    status: toProtocolStatus(row.status),
    teamMode: row.team_mode,
    maxMembers: row.max_members,
    minStartMembers: row.min_start_members,
    members,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

async function getRoomRowByClause(
  clause: string,
  params: unknown[],
  executor?: Executor,
): Promise<RoomRow | null> {
  const db = getExecutor(executor);
  const result = await db.query<RoomRow>(
    `
      SELECT
        id,
        room_id,
        mode_id,
        visibility::text AS visibility,
        invite_code,
        owner_user_id,
        status::text AS status,
        team_mode::text AS team_mode,
        max_members,
        min_start_members,
        version,
        created_at,
        updated_at
      FROM rooms
      ${clause}
      LIMIT 1
    `,
    params,
  );

  return result.rows[0] ?? null;
}

export async function getRoomSnapshotByRoomId(
  roomId: string,
  executor?: Executor,
): Promise<RoomSnapshot | null> {
  const row = await getRoomRowByClause(
    `WHERE room_id = $1`,
    [roomId],
    executor,
  );
  return row ? buildRoomSnapshot(row, executor) : null;
}

export async function getRoomSnapshotByInviteCode(
  inviteCode: string,
  executor?: Executor,
): Promise<RoomSnapshot | null> {
  const row = await getRoomRowByClause(
    `WHERE invite_code = $1`,
    [inviteCode.toUpperCase()],
    executor,
  );
  return row ? buildRoomSnapshot(row, executor) : null;
}

export async function getActiveRoomSnapshotByUserId(
  userId: string,
  executor?: Executor,
): Promise<RoomSnapshot | null> {
  const row = await getRoomRowByClause(
    `
      INNER JOIN room_members membership ON membership.room_id = rooms.id
      WHERE membership.user_id = $1
        AND rooms.status <> 'closed'
      ORDER BY rooms.updated_at DESC
    `,
    [userId],
    executor,
  );
  return row ? buildRoomSnapshot(row, executor) : null;
}

export async function createRoomRecord(
  params: {
    ownerUserId: string;
    modeId: string;
    visibility: RoomVisibility;
    teamMode: RoomTeamMode;
    maxMembers: number;
    minStartMembers: number;
    nickname: string;
    avatarUrl?: string | null;
  },
  executor?: Executor,
): Promise<RoomSnapshot> {
  const db = getExecutor(executor);
  let created: RoomRow | null = null;

  while (!created) {
    const roomId = createId("room");
    const inviteCode =
      params.visibility === "private" ? createInviteCode() : null;

    try {
      const roomResult = await db.query<RoomRow>(
        `
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
          )
          VALUES (
            $1,
            $2,
            $3::room_visibility,
            $4,
            $5,
            'idle',
            $6::team_mode,
            $7,
            $8,
            1,
            NOW(),
            NOW()
          )
          RETURNING
            id,
            room_id,
            mode_id,
            visibility::text AS visibility,
            invite_code,
            owner_user_id,
            status::text AS status,
            team_mode::text AS team_mode,
            max_members,
            min_start_members,
            version,
            created_at,
            updated_at
        `,
        [
          roomId,
          params.modeId,
          params.visibility,
          inviteCode,
          params.ownerUserId,
          params.teamMode,
          params.maxMembers,
          params.minStartMembers,
        ],
      );

      created = roomResult.rows[0] ?? null;
      if (!created) {
        throw new Error("room creation failed");
      }

      await db.query(
        `
          INSERT INTO room_members (
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
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            FALSE,
            'owner',
            $5,
            TRUE,
            NOW(),
            NOW()
          )
        `,
        [
          created.id,
          params.ownerUserId,
          params.nickname,
          params.avatarUrl ?? null,
          params.teamMode === "team" ? 0 : null,
        ],
      );
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: string }).code ?? "")
          : "";
      if (code === "23505") {
        created = null;
        continue;
      }
      throw error;
    }
  }

  return buildRoomSnapshot(created, db);
}

export async function addRoomMember(
  params: {
    roomId: string;
    userId: string;
    nickname: string;
    avatarUrl?: string | null;
    teamId: number | null;
  },
  executor?: Executor,
): Promise<RoomSnapshot | null> {
  const db = getExecutor(executor);
  const room = await getRoomRowByClause(`WHERE room_id = $1`, [params.roomId], db);
  if (!room) {
    return null;
  }

  await db.query(
    `
      INSERT INTO room_members (
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
      )
      VALUES ($1, $2, $3, $4, FALSE, 'member', $5, TRUE, NOW(), NOW())
      ON CONFLICT (room_id, user_id) DO UPDATE
      SET
        nickname_snapshot = EXCLUDED.nickname_snapshot,
        avatar_url_snapshot = EXCLUDED.avatar_url_snapshot,
        updated_at = NOW()
    `,
    [room.id, params.userId, params.nickname, params.avatarUrl ?? null, params.teamId],
  );
  await db.query(
    `
      UPDATE rooms
      SET version = version + 1, updated_at = NOW()
      WHERE id = $1
    `,
    [room.id],
  );

  const refreshed = await getRoomRowByClause(`WHERE room_id = $1`, [params.roomId], db);
  return refreshed ? buildRoomSnapshot(refreshed, db) : null;
}

export async function setRoomMemberReadyState(
  params: {
    roomId: string;
    userId: string;
    ready: boolean;
  },
  executor?: Executor,
): Promise<RoomSnapshot | null> {
  const db = getExecutor(executor);
  const room = await getRoomRowByClause(`WHERE room_id = $1`, [params.roomId], db);
  if (!room) {
    return null;
  }

  await db.query(
    `
      UPDATE room_members
      SET ready = $3, updated_at = NOW()
      WHERE room_id = $1
        AND user_id = $2
    `,
    [room.id, params.userId, params.ready],
  );
  await db.query(
    `
      UPDATE rooms
      SET version = version + 1, updated_at = NOW()
      WHERE id = $1
    `,
    [room.id],
  );

  const refreshed = await getRoomRowByClause(`WHERE room_id = $1`, [params.roomId], db);
  return refreshed ? buildRoomSnapshot(refreshed, db) : null;
}

export async function removeRoomMember(
  params: {
    roomId: string;
    userId: string;
  },
  executor?: Executor,
): Promise<RoomSnapshot | null> {
  const db = getExecutor(executor);
  const room = await getRoomRowByClause(`WHERE room_id = $1`, [params.roomId], db);
  if (!room) {
    return null;
  }

  await db.query(
    `
      DELETE FROM room_members
      WHERE room_id = $1
        AND user_id = $2
    `,
    [room.id, params.userId],
  );
  await db.query(
    `
      UPDATE rooms
      SET version = version + 1, updated_at = NOW()
      WHERE id = $1
    `,
    [room.id],
  );

  const refreshed = await getRoomRowByClause(`WHERE room_id = $1`, [params.roomId], db);
  return refreshed ? buildRoomSnapshot(refreshed, db) : null;
}

export async function updateRoomMetadata(
  params: {
    roomId: string;
    ownerUserId?: string;
    status?: RoomSnapshot["status"];
  },
  executor?: Executor,
): Promise<RoomSnapshot | null> {
  const db = getExecutor(executor);
  await db.query(
    `
      UPDATE rooms
      SET
        owner_user_id = COALESCE($2, owner_user_id),
        status = COALESCE($3::room_status, status),
        version = version + 1,
        updated_at = NOW()
      WHERE room_id = $1
    `,
    [params.roomId, params.ownerUserId ?? null, params.status ? toDbStatus(params.status) : null],
  );

  const refreshed = await getRoomRowByClause(`WHERE room_id = $1`, [params.roomId], db);
  return refreshed ? buildRoomSnapshot(refreshed, db) : null;
}

export async function reassignRoomOwner(
  roomId: string,
  nextOwnerUserId: string,
  executor?: Executor,
): Promise<RoomSnapshot | null> {
  const db = getExecutor(executor);
  const room = await getRoomRowByClause(`WHERE room_id = $1`, [roomId], db);
  if (!room) {
    return null;
  }

  await db.query(
    `
      UPDATE room_members
      SET role = 'member', updated_at = NOW()
      WHERE room_id = $1
    `,
    [room.id],
  );
  await db.query(
    `
      UPDATE room_members
      SET role = 'owner', updated_at = NOW()
      WHERE room_id = $1
        AND user_id = $2
    `,
    [room.id, nextOwnerUserId],
  );

  return updateRoomMetadata(
    {
      roomId,
      ownerUserId: nextOwnerUserId,
    },
    db,
  );
}

export async function deleteRoomRecord(
  roomId: string,
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  await db.query(
    `
      DELETE FROM rooms
      WHERE room_id = $1
    `,
    [roomId],
  );
}

export async function getLiveRoomSessionRow(
  roomId: string,
  executor?: Executor,
): Promise<LiveRoomSessionRow | null> {
  const db = getExecutor(executor);
  const result = await db.query<LiveRoomSessionRow>(
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
      WHERE room_id = $1
      LIMIT 1
    `,
    [roomId],
  );

  return result.rows[0] ?? null;
}

export function parseLiveRoomSessionRow(
  row: LiveRoomSessionRow | null,
): (RoomMatchSnapshot & { lastSimulatedAt: string }) | null {
  if (!row || !row.state_json || typeof row.state_json !== "object") {
    return null;
  }

  const payload = row.state_json as Record<string, unknown>;
  return {
    ...(payload as unknown as RoomMatchSnapshot),
    sessionId: row.session_id,
    roomId: row.room_id,
    modeId: row.mode_id,
    phase: row.phase,
    version: row.version,
    startedAt: row.started_at,
    lastSimulatedAt: row.last_simulated_at,
  };
}

interface PersistableLiveRoomSessionState {
  sessionId: string;
  roomId: string;
  modeId: string;
  phase: "running" | "finished";
  version: number;
  startedAt: string;
  lastSimulatedAt: string;
}

export async function createOrReplaceLiveRoomSession<TState extends PersistableLiveRoomSessionState>(
  state: TState,
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  await db.query(
    `
      INSERT INTO room_live_sessions (
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
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6::jsonb,
        NOW(),
        NOW(),
        $7,
        $8,
        $9
      )
      ON CONFLICT (room_id) DO UPDATE
      SET
        session_id = EXCLUDED.session_id,
        mode_id = EXCLUDED.mode_id,
        phase = EXCLUDED.phase,
        version = EXCLUDED.version,
        state_json = EXCLUDED.state_json,
        updated_at = NOW(),
        started_at = EXCLUDED.started_at,
        finished_at = EXCLUDED.finished_at,
        last_simulated_at = EXCLUDED.last_simulated_at
    `,
    [
      state.roomId,
      state.sessionId,
      state.modeId,
      state.phase,
      state.version,
      state,
      state.startedAt,
      state.phase === "finished" ? nowIso() : null,
      state.lastSimulatedAt,
    ],
  );
}

export async function updateLiveRoomSessionWithVersion<TState extends PersistableLiveRoomSessionState>(
  roomId: string,
  expectedVersion: number,
  state: TState,
  executor?: Executor,
): Promise<boolean> {
  const db = getExecutor(executor);
  const result = await db.query(
    `
      UPDATE room_live_sessions
      SET
        session_id = $3,
        mode_id = $4,
        phase = $5,
        version = $6,
        state_json = $7::jsonb,
        updated_at = NOW(),
        started_at = $8,
        finished_at = $9,
        last_simulated_at = $10
      WHERE room_id = $1
        AND version = $2
    `,
    [
      roomId,
      expectedVersion,
      state.sessionId,
      state.modeId,
      state.phase,
      state.version,
      state,
      state.startedAt,
      state.phase === "finished" ? nowIso() : null,
      state.lastSimulatedAt,
    ],
  );

  return (result.rowCount ?? 0) > 0;
}

export async function deleteLiveRoomSession(
  roomId: string,
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  await db.query(
    `
      DELETE FROM room_live_sessions
      WHERE room_id = $1
    `,
    [roomId],
  );
}
