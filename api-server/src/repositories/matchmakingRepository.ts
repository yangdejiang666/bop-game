import type {
  MatchFoundPayload,
  MatchmakingTicketState,
  QueueModeId,
} from "@bop/shared-protocol";
import type { QueryResultRow } from "pg";
import type { DbExecutor } from "../lib/db.js";
import { query } from "../lib/db.js";

export interface MatchmakingModeConfig {
  targetPlayers: number;
  minStartPlayers: number;
  expectedSeconds: number;
}

export const MATCHMAKING_MODE_CONFIG: Record<QueueModeId, MatchmakingModeConfig> = {
  ranked: { targetPlayers: 50, minStartPlayers: 16, expectedSeconds: 7 },
  peak: { targetPlayers: 50, minStartPlayers: 18, expectedSeconds: 8 },
  classic: { targetPlayers: 50, minStartPlayers: 14, expectedSeconds: 6 },
  speed: { targetPlayers: 50, minStartPlayers: 16, expectedSeconds: 5 },
  team: { targetPlayers: 50, minStartPlayers: 20, expectedSeconds: 7 },
  battleRoyale: { targetPlayers: 50, minStartPlayers: 20, expectedSeconds: 9 },
};

export interface MatchmakingTicketRow extends QueryResultRow {
  ticket_id: string;
  user_id: string;
  mode_id: QueueModeId;
  stage: MatchmakingTicketState["stage"];
  queued_at: string;
  updated_at: string;
  estimated_wait_sec: number;
  current_players: number;
  target_players: number;
  min_start_players: number;
  region: string | null;
  client_version: string | null;
  match_id: string | null;
  room_id: string | null;
  failure_code: string | null;
  failure_message: string | null;
  cancelled_at: string | null;
}

type Executor = DbExecutor;

function getExecutor(executor?: Executor): Executor {
  return (
    executor ?? {
      query: (text, params) => query(text, params),
    }
  );
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function mapMatchmakingTicketRow(
  row: MatchmakingTicketRow,
  publicGameWsUrl: string,
): MatchmakingTicketState {
  let matchFound: MatchFoundPayload | undefined;
  if (row.stage === "matched" && row.match_id && row.room_id) {
    matchFound = {
      ticketId: row.ticket_id,
      matchId: row.match_id,
      roomId: row.room_id,
      modeId: row.mode_id,
      server: {
        region: row.region ?? "ap-east-1",
        wsUrl: publicGameWsUrl,
      },
      players: {
        current: row.target_players,
        target: row.target_players,
      },
      joinedAt: row.updated_at,
      confirmationDeadlineAt: new Date(
        Date.parse(row.updated_at) + 15_000,
      ).toISOString(),
    };
  }

  return {
    ticketId: row.ticket_id,
    userId: row.user_id,
    modeId: row.mode_id,
    stage: row.stage,
    queuedAt: row.queued_at,
    updatedAt: row.updated_at,
    estimatedWaitSeconds: row.estimated_wait_sec,
    currentPlayers: row.current_players,
    targetPlayers: row.target_players,
    minStartPlayers: row.min_start_players,
    region: row.region ?? undefined,
    clientVersion: row.client_version ?? undefined,
    failureCode: row.failure_code ?? undefined,
    failureMessage: row.failure_message ?? undefined,
    matchFound,
  };
}

export async function findActiveMatchmakingTicketByUserId(
  userId: string,
  executor?: Executor,
): Promise<MatchmakingTicketRow | null> {
  const db = getExecutor(executor);
  const result = await db.query<MatchmakingTicketRow>(
    `
      SELECT
        ticket_id,
        user_id,
        mode_id,
        stage::text AS stage,
        queued_at,
        updated_at,
        estimated_wait_sec,
        current_players,
        target_players,
        min_start_players,
        region,
        client_version,
        match_id,
        room_id,
        failure_code,
        failure_message,
        cancelled_at
      FROM matchmaking_tickets
      WHERE user_id = $1
        AND stage IN ('searching', 'confirming', 'matched')
      ORDER BY queued_at DESC
      LIMIT 1
    `,
    [userId],
  );

  return result.rows[0] ?? null;
}

export async function findMatchmakingTicketByIdForUser(
  ticketId: string,
  userId: string,
  executor?: Executor,
): Promise<MatchmakingTicketRow | null> {
  const db = getExecutor(executor);
  const result = await db.query<MatchmakingTicketRow>(
    `
      SELECT
        ticket_id,
        user_id,
        mode_id,
        stage::text AS stage,
        queued_at,
        updated_at,
        estimated_wait_sec,
        current_players,
        target_players,
        min_start_players,
        region,
        client_version,
        match_id,
        room_id,
        failure_code,
        failure_message,
        cancelled_at
      FROM matchmaking_tickets
      WHERE ticket_id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [ticketId, userId],
  );

  return result.rows[0] ?? null;
}

export async function createMatchmakingTicket(
  params: {
    userId: string;
    modeId: QueueModeId;
    region?: string;
    clientVersion?: string;
  },
  executor?: Executor,
): Promise<MatchmakingTicketRow> {
  const db = getExecutor(executor);
  const config = MATCHMAKING_MODE_CONFIG[params.modeId];
  const ticketId = createId("mm");
  const currentPlayers = Math.max(
    1,
    Math.floor(config.minStartPlayers / 2) + Math.floor(Math.random() * config.minStartPlayers),
  );

  const result = await db.query<MatchmakingTicketRow>(
    `
      INSERT INTO matchmaking_tickets (
        ticket_id,
        user_id,
        mode_id,
        stage,
        region,
        client_version,
        estimated_wait_sec,
        current_players,
        target_players,
        min_start_players,
        queued_at,
        updated_at,
        cancelled_at
      )
      VALUES (
        $1,
        $2,
        $3,
        'searching',
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        NOW(),
        NOW(),
        NULL
      )
      RETURNING
        ticket_id,
        user_id,
        mode_id,
        stage::text AS stage,
        queued_at,
        updated_at,
        estimated_wait_sec,
        current_players,
        target_players,
        min_start_players,
        region,
        client_version,
        match_id,
        room_id,
        failure_code,
        failure_message,
        cancelled_at
    `,
    [
      ticketId,
      params.userId,
      params.modeId,
      params.region ?? "ap-east-1",
      params.clientVersion ?? null,
      config.expectedSeconds,
      Math.min(currentPlayers, config.targetPlayers),
      config.targetPlayers,
      config.minStartPlayers,
    ],
  );

  return result.rows[0] as MatchmakingTicketRow;
}

export async function updateMatchmakingTicket(
  ticketId: string,
  patch: Partial<{
    stage: MatchmakingTicketState["stage"];
    estimatedWaitSeconds: number;
    currentPlayers: number;
    targetPlayers: number;
    minStartPlayers: number;
    matchId: string | null;
    roomId: string | null;
    failureCode: string | null;
    failureMessage: string | null;
    cancelledAt: string | null;
  }>,
  executor?: Executor,
): Promise<MatchmakingTicketRow | null> {
  const db = getExecutor(executor);
  const result = await db.query<MatchmakingTicketRow>(
    `
      UPDATE matchmaking_tickets
      SET
        stage = COALESCE($2::ticket_stage, stage),
        estimated_wait_sec = COALESCE($3, estimated_wait_sec),
        current_players = COALESCE($4, current_players),
        target_players = COALESCE($5, target_players),
        min_start_players = COALESCE($6, min_start_players),
        match_id = COALESCE($7, match_id),
        room_id = COALESCE($8, room_id),
        failure_code = $9,
        failure_message = $10,
        cancelled_at = COALESCE($11, cancelled_at),
        updated_at = NOW()
      WHERE ticket_id = $1
      RETURNING
        ticket_id,
        user_id,
        mode_id,
        stage::text AS stage,
        queued_at,
        updated_at,
        estimated_wait_sec,
        current_players,
        target_players,
        min_start_players,
        region,
        client_version,
        match_id,
        room_id,
        failure_code,
        failure_message,
        cancelled_at
    `,
    [
      ticketId,
      patch.stage ?? null,
      patch.estimatedWaitSeconds ?? null,
      patch.currentPlayers ?? null,
      patch.targetPlayers ?? null,
      patch.minStartPlayers ?? null,
      patch.matchId ?? null,
      patch.roomId ?? null,
      patch.failureCode ?? null,
      patch.failureMessage ?? null,
      patch.cancelledAt ?? null,
    ],
  );

  return result.rows[0] ?? null;
}

export async function cancelMatchmakingTicket(
  ticketId: string,
  userId: string,
  executor?: Executor,
): Promise<MatchmakingTicketRow | null> {
  const db = getExecutor(executor);
  const result = await db.query<MatchmakingTicketRow>(
    `
      UPDATE matchmaking_tickets
      SET
        stage = 'cancelled',
        cancelled_at = NOW(),
        updated_at = NOW()
      WHERE ticket_id = $1
        AND user_id = $2
        AND stage <> 'matched'
      RETURNING
        ticket_id,
        user_id,
        mode_id,
        stage::text AS stage,
        queued_at,
        updated_at,
        estimated_wait_sec,
        current_players,
        target_players,
        min_start_players,
        region,
        client_version,
        match_id,
        room_id,
        failure_code,
        failure_message,
        cancelled_at
    `,
    [ticketId, userId],
  );

  return result.rows[0] ?? null;
}

export function createMatchFoundIds(): {
  matchId: string;
  roomId: string;
} {
  return {
    matchId: createId("match"),
    roomId: createId("room"),
  };
}
