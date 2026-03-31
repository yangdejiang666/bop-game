import type express from "express";
import { Router } from "express";
import {
  PROTOCOL_ERROR,
  createError,
  createSuccess,
  type CancelMatchmakingRequest,
  type CancelMatchmakingResponse,
  type MatchmakingTicketState,
  type QueueModeId,
  type StartMatchmakingRequest,
  type StartMatchmakingResponse,
} from "@bop/shared-protocol";
import { asyncHandler } from "../lib/asyncHandler.js";
import { DomainError } from "../lib/domainError.js";
import {
  requireAuth,
  type AuthenticatedRequest,
  readRequestId,
} from "../lib/auth.js";
import {
  cancelMatchmaking,
  getActiveMatchmakingTicket,
  getMatchmakingTicketStatus,
  startMatchmaking,
} from "../services/matchmakingService.js";

const router = Router();

const SUPPORTED_MODES: readonly QueueModeId[] = [
  "ranked",
  "peak",
  "classic",
  "speed",
  "team",
  "battleRoyale",
] as const;

function sendDomainError(
  error: unknown,
  request: express.Request,
  response: express.Response,
) {
  if (!(error instanceof DomainError)) {
    throw error;
  }

  response.status(error.status).json(
    createError(error.code as any, error.message, {
      requestId: readRequestId(request),
      details: error.details,
    }),
  );
}

router.post(
  "/start",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

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

    try {
      const payload: StartMatchmakingResponse = await startMatchmaking({
        userId: auth.userId,
        modeId: body.modeId,
        region: body.region,
        clientVersion: body.clientVersion,
      });
      response.json(createSuccess(payload, readRequestId(request)));
    } catch (error) {
      sendDomainError(error, request, response);
    }
  }),
);

router.post(
  "/cancel",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

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

    try {
      const payload: CancelMatchmakingResponse = await cancelMatchmaking({
        userId: auth.userId,
        ticketId,
      });
      response.json(createSuccess(payload, readRequestId(request)));
    } catch (error) {
      sendDomainError(error, request, response);
    }
  }),
);

router.get(
  "/status/:ticketId",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

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

    try {
      const payload: MatchmakingTicketState = await getMatchmakingTicketStatus({
        userId: auth.userId,
        ticketId,
      });
      response.json(createSuccess(payload, readRequestId(request)));
    } catch (error) {
      sendDomainError(error, request, response);
    }
  }),
);

router.get(
  "/active",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

    const payload = {
      ticket: await getActiveMatchmakingTicket(auth.userId),
    };
    response.json(createSuccess(payload, readRequestId(request)));
  }),
);

export default router;
