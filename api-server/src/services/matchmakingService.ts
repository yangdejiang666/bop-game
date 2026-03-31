import {
  PROTOCOL_ERROR,
  type CancelMatchmakingResponse,
  type MatchmakingTicketState,
  type QueueModeId,
  type StartMatchmakingResponse,
} from "@bop/shared-protocol";
import { DomainError } from "../lib/domainError.js";
import {
  MATCHMAKING_MODE_CONFIG,
  cancelMatchmakingTicket,
  createMatchFoundIds,
  createMatchmakingTicket,
  findActiveMatchmakingTicketByUserId,
  findMatchmakingTicketByIdForUser,
  mapMatchmakingTicketRow,
  updateMatchmakingTicket,
  type MatchmakingTicketRow,
} from "../repositories/matchmakingRepository.js";

const PUBLIC_GAME_WS_URL =
  process.env.PUBLIC_GAME_WS_URL?.trim() || "wss://ws.example.com/ws";

function nowIso(): string {
  return new Date().toISOString();
}

async function materializeTicketState(
  row: MatchmakingTicketRow,
): Promise<MatchmakingTicketRow> {
  if (row.stage !== "searching") {
    return row;
  }

  const config = MATCHMAKING_MODE_CONFIG[row.mode_id];
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(row.queued_at)) / 1000),
  );
  const estimatedWaitSeconds = Math.max(0, config.expectedSeconds - elapsedSeconds);
  const currentPlayers = Math.min(
    row.target_players,
    Math.max(
      row.current_players,
      row.min_start_players + Math.max(0, elapsedSeconds * 2),
    ),
  );

  if (elapsedSeconds >= config.expectedSeconds) {
    const ids = createMatchFoundIds();
    return (
      (await updateMatchmakingTicket(
        row.ticket_id,
        {
          stage: "matched",
          estimatedWaitSeconds: 0,
          currentPlayers: row.target_players,
          matchId: ids.matchId,
          roomId: ids.roomId,
        },
      )) ?? row
    );
  }

  return (
    (await updateMatchmakingTicket(row.ticket_id, {
      estimatedWaitSeconds,
      currentPlayers,
    })) ?? row
  );
}

export async function startMatchmaking(params: {
  userId: string;
  modeId: QueueModeId;
  region?: string;
  clientVersion?: string;
}): Promise<StartMatchmakingResponse> {
  const existing = await findActiveMatchmakingTicketByUserId(params.userId);
  if (existing) {
    throw new DomainError(
      PROTOCOL_ERROR.MATCH_ALREADY_IN_QUEUE,
      "User already has an active ticket.",
      409,
      {
        ticketId: existing.ticket_id,
        stage: existing.stage,
      },
    );
  }

  const created = await createMatchmakingTicket(params);
  return {
    ticketId: created.ticket_id,
    modeId: created.mode_id,
    stage: "searching",
    queuedAt: created.queued_at,
    estimatedWaitSeconds: created.estimated_wait_sec,
    minStartPlayers: created.min_start_players,
    targetPlayers: created.target_players,
    serverTime: nowIso(),
  };
}

export async function getMatchmakingTicketStatus(params: {
  userId: string;
  ticketId: string;
}): Promise<MatchmakingTicketState> {
  const found = await findMatchmakingTicketByIdForUser(params.ticketId, params.userId);
  if (!found) {
    throw new DomainError(
      PROTOCOL_ERROR.MATCH_NOT_IN_QUEUE,
      "Ticket not found for current user.",
      404,
      { ticketId: params.ticketId },
    );
  }

  return mapMatchmakingTicketRow(await materializeTicketState(found), PUBLIC_GAME_WS_URL);
}

export async function getActiveMatchmakingTicket(
  userId: string,
): Promise<MatchmakingTicketState | null> {
  const found = await findActiveMatchmakingTicketByUserId(userId);
  if (!found) {
    return null;
  }

  return mapMatchmakingTicketRow(await materializeTicketState(found), PUBLIC_GAME_WS_URL);
}

export async function cancelMatchmaking(params: {
  userId: string;
  ticketId: string;
}): Promise<CancelMatchmakingResponse> {
  const found = await findMatchmakingTicketByIdForUser(params.ticketId, params.userId);
  if (!found) {
    throw new DomainError(
      PROTOCOL_ERROR.MATCH_NOT_IN_QUEUE,
      "Ticket not found for current user.",
      404,
      { ticketId: params.ticketId },
    );
  }
  if (found.stage === "matched") {
    throw new DomainError(
      PROTOCOL_ERROR.CONFLICT,
      "Cannot cancel after match is found.",
      409,
      {
        ticketId: found.ticket_id,
        stage: found.stage,
      },
    );
  }

  const cancelled = await cancelMatchmakingTicket(params.ticketId, params.userId);
  if (!cancelled) {
    throw new DomainError(
      PROTOCOL_ERROR.MATCH_NOT_IN_QUEUE,
      "Ticket not found for current user.",
      404,
      { ticketId: params.ticketId },
    );
  }

  return {
    ticketId: cancelled.ticket_id,
    stage: "cancelled",
    cancelledAt: cancelled.cancelled_at ?? nowIso(),
  };
}
