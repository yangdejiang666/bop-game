import { Router } from "express";
import {
  PROTOCOL_ERROR,
  createError,
  createSuccess,
  type CancelMatchmakingRequest,
  type CancelMatchmakingResponse,
  type MatchFoundPayload,
  type MatchmakingTicketState,
  type QueueModeId,
  type StartMatchmakingRequest,
  type StartMatchmakingResponse,
} from "@bop/shared-protocol";
import { asyncHandler } from "../lib/asyncHandler.js";
import {
  requireAuth,
  type AuthenticatedRequest,
  readRequestId,
} from "../lib/auth.js";

const PUBLIC_GAME_WS_URL =
  process.env.PUBLIC_GAME_WS_URL?.trim() || "wss://ws.example.com/ws";

type TicketRecord = MatchmakingTicketState & {
  timeoutHandle: NodeJS.Timeout | null;
};

const router = Router();

const SUPPORTED_MODES: readonly QueueModeId[] = [
  "ranked",
  "peak",
  "classic",
  "speed",
  "team",
  "battleRoyale",
] as const;

const MODE_CONFIG: Record<
  QueueModeId,
  { targetPlayers: number; minStartPlayers: number; expectedSeconds: number }
> = {
  ranked: { targetPlayers: 50, minStartPlayers: 16, expectedSeconds: 7 },
  peak: { targetPlayers: 50, minStartPlayers: 18, expectedSeconds: 8 },
  classic: { targetPlayers: 50, minStartPlayers: 14, expectedSeconds: 6 },
  speed: { targetPlayers: 50, minStartPlayers: 16, expectedSeconds: 5 },
  team: { targetPlayers: 50, minStartPlayers: 20, expectedSeconds: 7 },
  battleRoyale: { targetPlayers: 50, minStartPlayers: 20, expectedSeconds: 9 },
};

const ticketsById = new Map<string, TicketRecord>();
const activeTicketByUserId = new Map<string, string>();

function nowIso(): string {
  return new Date().toISOString();
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function toPublicTicket(ticket: TicketRecord): MatchmakingTicketState {
  const { timeoutHandle: _omit, ...publicState } = ticket;
  return publicState;
}

function clearTicketTimer(ticket: TicketRecord) {
  if (ticket.timeoutHandle) {
    clearTimeout(ticket.timeoutHandle);
    ticket.timeoutHandle = null;
  }
}

function markMatched(ticket: TicketRecord): void {
  if (ticket.stage !== "searching") {
    return;
  }

  const matchedAt = nowIso();
  const matchFound: MatchFoundPayload = {
    ticketId: ticket.ticketId,
    matchId: createId("match"),
    roomId: createId("room"),
    modeId: ticket.modeId,
    server: {
      region: ticket.region ?? "ap-east-1",
      wsUrl: PUBLIC_GAME_WS_URL,
    },
    players: {
      current: ticket.targetPlayers,
      target: ticket.targetPlayers,
    },
    joinedAt: matchedAt,
    confirmationDeadlineAt: new Date(Date.now() + 15_000).toISOString(),
  };

  ticket.stage = "matched";
  ticket.currentPlayers = ticket.targetPlayers;
  ticket.estimatedWaitSeconds = 0;
  ticket.matchFound = matchFound;
  ticket.updatedAt = matchedAt;
  ticket.timeoutHandle = null;
}

function scheduleMockMatch(ticket: TicketRecord): void {
  const delayMs = Math.max(1_500, ticket.estimatedWaitSeconds * 1_000);
  ticket.timeoutHandle = setTimeout(() => {
    markMatched(ticket);
  }, delayMs);
}

router.post(
  "/start",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) {
      return;
    }

    const body = (request.body ?? {}) as Partial<StartMatchmakingRequest>;
    if (!body.modeId || !SUPPORTED_MODES.includes(body.modeId)) {
      response.status(400).json(
        createError(PROTOCOL_ERROR.INVALID_REQUEST, "Invalid modeId.", {
          requestId: readRequestId(request),
          details: { field: "modeId", reason: "unsupported_mode" },
        }),
      );
      return;
    }

    const modeId = body.modeId as QueueModeId;
    const existingTicketId = activeTicketByUserId.get(auth.userId);
    if (existingTicketId) {
      const existing = ticketsById.get(existingTicketId);
      if (
        existing &&
        (existing.stage === "searching" ||
          existing.stage === "confirming" ||
          existing.stage === "matched")
      ) {
        response.status(409).json(
          createError(
            PROTOCOL_ERROR.MATCH_ALREADY_IN_QUEUE,
            "User already has an active ticket.",
            {
              requestId: readRequestId(request),
              details: {
                ticketId: existing.ticketId,
                stage: existing.stage,
              },
            },
          ),
        );
        return;
      }
    }

    const config = MODE_CONFIG[modeId];
    const ticketId = createId("mm");
    const createdAt = nowIso();

    const ticket: TicketRecord = {
      ticketId,
      userId: auth.userId,
      modeId,
      stage: "searching",
      queuedAt: createdAt,
      updatedAt: createdAt,
      estimatedWaitSeconds: config.expectedSeconds,
      currentPlayers: randomInt(
        Math.max(1, Math.floor(config.minStartPlayers / 2)),
        config.minStartPlayers,
      ),
      targetPlayers: config.targetPlayers,
      minStartPlayers: config.minStartPlayers,
      region: body.region ?? "ap-east-1",
      failureCode: undefined,
      failureMessage: undefined,
      matchFound: undefined,
      timeoutHandle: null,
    };

    ticketsById.set(ticketId, ticket);
    activeTicketByUserId.set(auth.userId, ticketId);
    scheduleMockMatch(ticket);

    const payload: StartMatchmakingResponse = {
      ticketId: ticket.ticketId,
      modeId: ticket.modeId,
      stage: "searching",
      queuedAt: ticket.queuedAt,
      estimatedWaitSeconds: ticket.estimatedWaitSeconds,
      minStartPlayers: ticket.minStartPlayers,
      targetPlayers: ticket.targetPlayers,
    };

    response.json(createSuccess(payload, readRequestId(request)));
  }),
);

router.post(
  "/cancel",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) {
      return;
    }

    const body = (request.body ?? {}) as Partial<CancelMatchmakingRequest>;
    const ticketId = body.ticketId?.trim();
    if (!ticketId) {
      response.status(400).json(
        createError(PROTOCOL_ERROR.INVALID_REQUEST, "ticketId is required.", {
          requestId: readRequestId(request),
          details: { field: "ticketId", reason: "required" },
        }),
      );
      return;
    }

    const ticket = ticketsById.get(ticketId);
    if (!ticket || ticket.userId !== auth.userId) {
      response.status(404).json(
        createError(
          PROTOCOL_ERROR.MATCH_NOT_IN_QUEUE,
          "Ticket not found for current user.",
          {
            requestId: readRequestId(request),
            details: { ticketId },
          },
        ),
      );
      return;
    }

    if (ticket.stage === "matched") {
      response.status(409).json(
        createError(PROTOCOL_ERROR.CONFLICT, "Cannot cancel after match is found.", {
          requestId: readRequestId(request),
          details: { ticketId: ticket.ticketId, stage: ticket.stage },
        }),
      );
      return;
    }

    clearTicketTimer(ticket);
    ticket.stage = "cancelled";
    ticket.updatedAt = nowIso();
    activeTicketByUserId.delete(auth.userId);

    const payload: CancelMatchmakingResponse = {
      ticketId: ticket.ticketId,
      stage: "cancelled",
      cancelledAt: ticket.updatedAt,
    };
    response.json(createSuccess(payload, readRequestId(request)));
  }),
);

router.get(
  "/status/:ticketId",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) {
      return;
    }

    const ticketId = String(request.params.ticketId ?? "").trim();
    if (!ticketId) {
      response.status(400).json(
        createError(PROTOCOL_ERROR.INVALID_REQUEST, "ticketId is required.", {
          requestId: readRequestId(request),
          details: { field: "ticketId", reason: "required" },
        }),
      );
      return;
    }

    const ticket = ticketsById.get(ticketId);
    if (!ticket || ticket.userId !== auth.userId) {
      response.status(404).json(
        createError(
          PROTOCOL_ERROR.MATCH_NOT_IN_QUEUE,
          "Ticket not found for current user.",
          {
            requestId: readRequestId(request),
            details: { ticketId },
          },
        ),
      );
      return;
    }

    if (ticket.stage === "searching") {
      const elapsedSec = Math.floor(
        (Date.now() - new Date(ticket.queuedAt).getTime()) / 1000,
      );
      const progressedPlayers = Math.min(
        ticket.targetPlayers,
        ticket.minStartPlayers + Math.max(0, elapsedSec * 2),
      );
      ticket.currentPlayers = Math.max(ticket.currentPlayers, progressedPlayers);
      ticket.estimatedWaitSeconds = Math.max(0, ticket.estimatedWaitSeconds - 1);
      ticket.updatedAt = nowIso();
    }

    response.json(createSuccess(toPublicTicket(ticket), readRequestId(request)));
  }),
);

router.get(
  "/active",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) {
      return;
    }

    const activeTicketId = activeTicketByUserId.get(auth.userId);
    if (!activeTicketId) {
      response.json(
        createSuccess<{ ticket: MatchmakingTicketState | null }>(
          { ticket: null },
          readRequestId(request),
        ),
      );
      return;
    }

    const ticket = ticketsById.get(activeTicketId);
    if (!ticket) {
      activeTicketByUserId.delete(auth.userId);
      response.json(
        createSuccess<{ ticket: MatchmakingTicketState | null }>(
          { ticket: null },
          readRequestId(request),
        ),
      );
      return;
    }

    if (ticket.stage === "cancelled" || ticket.stage === "failed") {
      activeTicketByUserId.delete(auth.userId);
    }

    response.json(
      createSuccess<{ ticket: MatchmakingTicketState | null }>(
        { ticket: toPublicTicket(ticket) },
        readRequestId(request),
      ),
    );
  }),
);

export default router;
