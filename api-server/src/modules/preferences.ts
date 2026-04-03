import type express from "express";
import { Router } from "express";
import {
  PROTOCOL_ERROR,
  createError,
  createSuccess,
  type GetUserPreferencesResponse,
  type SyncUserPreferencesRequest,
  type SyncUserPreferencesResponse,
} from "@bop/shared-protocol";
import { asyncHandler } from "../lib/asyncHandler.js";
import { DomainError } from "../lib/domainError.js";
import {
  requireAuth,
  type AuthenticatedRequest,
  readRequestId,
} from "../lib/auth.js";
import {
  getUserPreferences,
  syncUserPreferences,
} from "../services/preferencesService.js";

const router = Router();

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
  "/",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) {
      return;
    }

    const payload: GetUserPreferencesResponse = {
      preferences: await getUserPreferences(auth.userId),
    };
    response.json(createSuccess(payload, readRequestId(request)));
  }),
);

router.post(
  "/sync",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) {
      return;
    }

    const body = (request.body ?? {}) as Partial<SyncUserPreferencesRequest>;
    try {
      const payload: SyncUserPreferencesResponse = await syncUserPreferences({
        userId: auth.userId,
        patch: body.patch ?? {},
      });
      response.json(createSuccess(payload, readRequestId(request)));
    } catch (error) {
      sendDomainError(error, request, response);
    }
  }),
);

export default router;
