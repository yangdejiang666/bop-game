import type express from "express";
import { Router } from "express";
import {
  PROTOCOL_ERROR,
  createError,
  createSuccess,
  type AcceptFriendRequestResponse,
  type CreateBlockRequest,
  type CreateBlockResponse,
  type CreateFriendRequestRequest,
  type CreateFriendRequestResponse,
  type GetSocialBlocksResponse,
  type GetSocialFriendRequestsResponse,
  type GetSocialOverviewResponse,
  type RejectFriendRequestResponse,
  type RemoveBlockResponse,
  type RemoveFriendResponse,
  type SearchSocialUserResponse,
} from "@bop/shared-protocol";
import { asyncHandler } from "../lib/asyncHandler.js";
import { DomainError } from "../lib/domainError.js";
import {
  requireAuth,
  type AuthenticatedRequest,
  readRequestId,
} from "../lib/auth.js";
import {
  acceptFriendRequest,
  createBlock,
  createFriendRequest,
  getSocialOverview,
  listSocialBlocks,
  rejectFriendRequest,
  removeBlock,
  removeFriend,
  searchSocialUser,
} from "../services/socialService.js";

const router = Router();

function normalizeGameId(raw: string): string {
  const safe = raw.trim();
  return /^\d{9}$/.test(safe) ? safe : "";
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

router.get(
  "/overview",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

    const payload: GetSocialOverviewResponse = await getSocialOverview(auth.userId);
    response.json(createSuccess(payload, readRequestId(request)));
  }),
);

router.get(
  "/search/:gameId",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

    const gameId = normalizeGameId(String(request.params.gameId ?? ""));
    if (!gameId) {
      response.status(400).json(
        createError(PROTOCOL_ERROR.SOCIAL_INVALID_GAME_ID, "gameId must be a 9-digit number.", {
          requestId: readRequestId(request),
          details: { field: "gameId" },
        }),
      );
      return;
    }

    const payload: SearchSocialUserResponse = await searchSocialUser(auth.userId, gameId);
    response.json(createSuccess(payload, readRequestId(request)));
  }),
);

router.get(
  "/friend-requests",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

    const overview = await getSocialOverview(auth.userId);
    const payload: GetSocialFriendRequestsResponse = {
      incoming: overview.overview.incomingRequests,
      outgoing: overview.overview.outgoingRequests,
    };
    response.json(createSuccess(payload, readRequestId(request)));
  }),
);

router.post(
  "/friend-requests",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

    const body = (request.body ?? {}) as Partial<CreateFriendRequestRequest>;
    const targetGameId = normalizeGameId(body.targetGameId ?? "");
    if (!targetGameId) {
      response.status(400).json(
        createError(PROTOCOL_ERROR.SOCIAL_INVALID_GAME_ID, "targetGameId must be a 9-digit number.", {
          requestId: readRequestId(request),
          details: { field: "targetGameId" },
        }),
      );
      return;
    }

    try {
      const payload: CreateFriendRequestResponse = await createFriendRequest(
        auth.userId,
        targetGameId,
      );
      response.json(createSuccess(payload, readRequestId(request)));
    } catch (error) {
      sendDomainError(error, request, response);
    }
  }),
);

router.post(
  "/friend-requests/:requestId/accept",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

    try {
      const payload: AcceptFriendRequestResponse = await acceptFriendRequest(
        auth.userId,
        String(request.params.requestId ?? "").trim(),
      );
      response.json(createSuccess(payload, readRequestId(request)));
    } catch (error) {
      sendDomainError(error, request, response);
    }
  }),
);

router.post(
  "/friend-requests/:requestId/reject",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

    try {
      const payload: RejectFriendRequestResponse = await rejectFriendRequest(
        auth.userId,
        String(request.params.requestId ?? "").trim(),
      );
      response.json(createSuccess(payload, readRequestId(request)));
    } catch (error) {
      sendDomainError(error, request, response);
    }
  }),
);

router.delete(
  "/friends/:gameId",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

    const gameId = normalizeGameId(String(request.params.gameId ?? ""));
    if (!gameId) {
      response.status(400).json(
        createError(PROTOCOL_ERROR.SOCIAL_INVALID_GAME_ID, "gameId must be a 9-digit number.", {
          requestId: readRequestId(request),
          details: { field: "gameId" },
        }),
      );
      return;
    }

    try {
      const payload: RemoveFriendResponse = await removeFriend(auth.userId, gameId);
      response.json(createSuccess(payload, readRequestId(request)));
    } catch (error) {
      sendDomainError(error, request, response);
    }
  }),
);

router.get(
  "/blocks",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

    const payload: GetSocialBlocksResponse = await listSocialBlocks(auth.userId);
    response.json(createSuccess(payload, readRequestId(request)));
  }),
);

router.post(
  "/blocks",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

    const body = (request.body ?? {}) as Partial<CreateBlockRequest>;
    const targetGameId = normalizeGameId(body.targetGameId ?? "");
    if (!targetGameId) {
      response.status(400).json(
        createError(PROTOCOL_ERROR.SOCIAL_INVALID_GAME_ID, "targetGameId must be a 9-digit number.", {
          requestId: readRequestId(request),
          details: { field: "targetGameId" },
        }),
      );
      return;
    }

    try {
      const payload: CreateBlockResponse = await createBlock(auth.userId, targetGameId);
      response.json(createSuccess(payload, readRequestId(request)));
    } catch (error) {
      sendDomainError(error, request, response);
    }
  }),
);

router.delete(
  "/blocks/:gameId",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

    const gameId = normalizeGameId(String(request.params.gameId ?? ""));
    if (!gameId) {
      response.status(400).json(
        createError(PROTOCOL_ERROR.SOCIAL_INVALID_GAME_ID, "gameId must be a 9-digit number.", {
          requestId: readRequestId(request),
          details: { field: "gameId" },
        }),
      );
      return;
    }

    try {
      const payload: RemoveBlockResponse = await removeBlock(auth.userId, gameId);
      response.json(createSuccess(payload, readRequestId(request)));
    } catch (error) {
      sendDomainError(error, request, response);
    }
  }),
);

export default router;
