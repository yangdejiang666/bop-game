import { Router } from "express";
import {
  PROTOCOL_ERROR,
  createError,
  createSuccess,
  type GetDeveloperAccountsOverviewResponse,
  type GetMeResponse,
  type GetPublicUserResponse,
  type UpdateProfileRequest,
  type UpdateProfileResponse,
  type UserBootstrapRequest,
  type UserBootstrapResponse,
} from "@bop/shared-protocol";
import { asyncHandler } from "../lib/asyncHandler.js";
import { apiServerConfig } from "../lib/config.js";
import {
  requireAuth,
  type AuthenticatedRequest,
  readRequestId,
} from "../lib/auth.js";
import {
  bootstrapUserFromLocal,
  getDeveloperAccountsOverview,
  getPublicUserCard,
  getUserSummary,
  updateProfile,
} from "../services/userService.js";

export function createUserRouter() {
  const router = Router();

  router.get(
    "/me",
    asyncHandler(async (request, response) => {
      const auth = await requireAuth(request as AuthenticatedRequest, response);
      if (!auth) {
        return;
      }

      const payload: GetMeResponse = {
        summary: await getUserSummary(auth.userId),
      };
      response.json(createSuccess(payload, readRequestId(request)));
    }),
  );

  router.post(
    "/bootstrap",
    asyncHandler(async (request, response) => {
      const auth = await requireAuth(request as AuthenticatedRequest, response);
      if (!auth) {
        return;
      }

      const body = (request.body ?? {}) as Partial<UserBootstrapRequest>;
      if (body.source !== "local_storage") {
        response.status(400).json(
          createError(PROTOCOL_ERROR.INVALID_REQUEST, "source must be local_storage.", {
            requestId: readRequestId(request),
            details: { field: "source" },
          }),
        );
        return;
      }

      const payload: UserBootstrapResponse = await bootstrapUserFromLocal({
        userId: auth.userId,
        payload: {
          source: "local_storage",
          nickname: body.nickname,
          avatarUrl: body.avatarUrl,
          progression: body.progression,
        },
      });

      response.json(createSuccess(payload, readRequestId(request)));
    }),
  );

  router.patch(
    "/profile",
    asyncHandler(async (request, response) => {
      const auth = await requireAuth(request as AuthenticatedRequest, response);
      if (!auth) {
        return;
      }

      const body = (request.body ?? {}) as UpdateProfileRequest;

      try {
        const profile = await updateProfile({
          userId: auth.userId,
          nickname: body.nickname,
          avatarUrl: body.avatarUrl,
        });

        const payload: UpdateProfileResponse = { profile };
        response.json(createSuccess(payload, readRequestId(request)));
      } catch (error) {
        const message = error instanceof Error ? error.message : PROTOCOL_ERROR.UNKNOWN;
        if (
          message === PROTOCOL_ERROR.USER_INVALID_NAME ||
          message === PROTOCOL_ERROR.USER_INVALID_AVATAR
        ) {
          response.status(400).json(
            createError(message, message === PROTOCOL_ERROR.USER_INVALID_NAME ? "Nickname is invalid." : "avatarUrl is invalid.", {
              requestId: readRequestId(request),
            }),
          );
          return;
        }
        if (message === PROTOCOL_ERROR.USER_NOT_FOUND) {
          response.status(404).json(
            createError(PROTOCOL_ERROR.USER_NOT_FOUND, "User profile not found.", {
              requestId: readRequestId(request),
            }),
          );
          return;
        }
        throw error;
      }
    }),
  );

  router.get(
    "/dev/accounts-overview",
    asyncHandler(async (request, response) => {
      const auth = await requireAuth(request as AuthenticatedRequest, response);
      if (!auth) {
        return;
      }

      if (apiServerConfig.env === "production") {
        response.status(403).json(
          createError(
            PROTOCOL_ERROR.FORBIDDEN,
            "Developer account overview is disabled in production.",
            {
              requestId: readRequestId(request),
            },
          ),
        );
        return;
      }

      const payload: GetDeveloperAccountsOverviewResponse = {
        overview: await getDeveloperAccountsOverview(auth.userId),
      };
      response.json(createSuccess(payload, readRequestId(request)));
    }),
  );

  router.get(
    "/:userId",
    asyncHandler(async (request, response) => {
      const targetUserId = request.params.userId?.trim();
      if (!targetUserId) {
        response.status(400).json(
          createError(PROTOCOL_ERROR.INVALID_REQUEST, "userId is required.", {
            requestId: readRequestId(request),
            details: { field: "userId" },
          }),
        );
        return;
      }

      try {
        const user = await getPublicUserCard(targetUserId);
        const payload: GetPublicUserResponse = { user };
        response.json(createSuccess(payload, readRequestId(request)));
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === PROTOCOL_ERROR.USER_NOT_FOUND
        ) {
          response.status(404).json(
            createError(PROTOCOL_ERROR.USER_NOT_FOUND, "User not found.", {
              requestId: readRequestId(request),
            }),
          );
          return;
        }
        throw error;
      }
    }),
  );

  return router;
}
