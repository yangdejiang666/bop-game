import type express from "express";
import { Router } from "express";
import {
  PROTOCOL_ERROR,
  createError,
  createSuccess,
  type CreateRoomRequest,
  type CreateRoomResponse,
  type GetRoomSnapshotResponse,
  type JoinRoomRequest,
  type JoinRoomResponse,
  type LeaveRoomRequest,
  type LeaveRoomResponse,
  type QueryRoomByInviteCodeResponse,
  type SetReadyRequest,
  type SetReadyResponse,
  type StartRoomMatchRequest,
  type StartRoomMatchResponse,
  type SyncRoomMatchRequest,
  type SyncRoomMatchResponse,
} from "@bop/shared-protocol";
import { asyncHandler } from "../lib/asyncHandler.js";
import { DomainError } from "../lib/domainError.js";
import {
  requireAuth,
  type AuthenticatedRequest,
  readRequestId,
} from "../lib/auth.js";
import {
  createRoom,
  getRoomSnapshot,
  joinRoom,
  leaveRoom,
  queryRoomByInviteCode,
  setReadyState,
  startRoomMatch,
  syncRoomMatch,
} from "../services/roomService.js";

const router = Router();

function sanitizeText(input: unknown, fallback: string, max = 64): string {
  if (typeof input !== "string") {
    return fallback;
  }
  const trimmed = input.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : fallback;
}

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
  "/create",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

    const body = (request.body ?? {}) as Partial<CreateRoomRequest>;
    try {
      const payload: CreateRoomResponse = await createRoom({
        userId: auth.userId,
        modeId: body.modeId ?? "",
        visibility: body.visibility,
        maxMembers: body.maxMembers,
        minStartMembers: body.minStartMembers,
        teamMode: body.teamMode,
      });
      response.status(201).json(createSuccess(payload, readRequestId(request)));
    } catch (error) {
      sendDomainError(error, request, response);
    }
  }),
);

router.post(
  "/join",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

    const body = (request.body ?? {}) as Partial<JoinRoomRequest>;
    try {
      const payload: JoinRoomResponse = await joinRoom({
        userId: auth.userId,
        roomId: body.roomId?.trim(),
        inviteCode: body.inviteCode?.trim().toUpperCase(),
      });
      response.json(createSuccess(payload, readRequestId(request)));
    } catch (error) {
      sendDomainError(error, request, response);
    }
  }),
);

router.post(
  "/leave",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

    const body = (request.body ?? {}) as Partial<LeaveRoomRequest>;
    const roomId = sanitizeText(body.roomId, "", 64);
    if (!roomId) {
      response.status(400).json(
        createError(PROTOCOL_ERROR.INVALID_REQUEST, "roomId is required.", {
          requestId: readRequestId(request),
          details: { field: "roomId" },
        }),
      );
      return;
    }

    try {
      const payload: LeaveRoomResponse = await leaveRoom({
        userId: auth.userId,
        roomId,
      });
      response.json(createSuccess(payload, readRequestId(request)));
    } catch (error) {
      sendDomainError(error, request, response);
    }
  }),
);

router.post(
  "/ready",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

    const body = (request.body ?? {}) as Partial<SetReadyRequest>;
    const roomId = sanitizeText(body.roomId, "", 64);
    if (!roomId) {
      response.status(400).json(
        createError(PROTOCOL_ERROR.INVALID_REQUEST, "roomId is required.", {
          requestId: readRequestId(request),
          details: { field: "roomId" },
        }),
      );
      return;
    }

    try {
      const payload: SetReadyResponse = await setReadyState({
        userId: auth.userId,
        roomId,
        ready: Boolean(body.ready),
      });
      response.json(createSuccess(payload, readRequestId(request)));
    } catch (error) {
      sendDomainError(error, request, response);
    }
  }),
);

router.post(
  "/start-match",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

    const body = (request.body ?? {}) as Partial<StartRoomMatchRequest>;
    const roomId = sanitizeText(body.roomId, "", 64);
    if (!roomId) {
      response.status(400).json(
        createError(PROTOCOL_ERROR.INVALID_REQUEST, "roomId is required.", {
          requestId: readRequestId(request),
          details: { field: "roomId" },
        }),
      );
      return;
    }

    try {
      const payload: StartRoomMatchResponse = await startRoomMatch({
        userId: auth.userId,
        roomId,
      });
      response.json(createSuccess(payload, readRequestId(request)));
    } catch (error) {
      sendDomainError(error, request, response);
    }
  }),
);

router.post(
  "/session/sync",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

    const body = (request.body ?? {}) as Partial<SyncRoomMatchRequest>;
    const roomId = sanitizeText(body.roomId, "", 64);
    if (!roomId) {
      response.status(400).json(
        createError(PROTOCOL_ERROR.INVALID_REQUEST, "roomId is required.", {
          requestId: readRequestId(request),
          details: { field: "roomId" },
        }),
      );
      return;
    }

    try {
      const payload: SyncRoomMatchResponse = await syncRoomMatch({
        userId: auth.userId,
        roomId,
        input: body.input,
      });
      response.json(createSuccess(payload, readRequestId(request)));
    } catch (error) {
      sendDomainError(error, request, response);
    }
  }),
);

router.get(
  "/invite/:inviteCode",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

    try {
      const payload: QueryRoomByInviteCodeResponse = await queryRoomByInviteCode(
        sanitizeText(request.params.inviteCode, "", 16).toUpperCase(),
      );
      response.json(createSuccess(payload, readRequestId(request)));
    } catch (error) {
      sendDomainError(error, request, response);
    }
  }),
);

router.get(
  "/:roomId",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

    try {
      const payload: GetRoomSnapshotResponse = await getRoomSnapshot(
        sanitizeText(request.params.roomId, "", 64),
      );
      response.json(createSuccess(payload, readRequestId(request)));
    } catch (error) {
      sendDomainError(error, request, response);
    }
  }),
);

export default router;
