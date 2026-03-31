import type express from "express";
import { Router } from "express";
import {
  createError,
  createSuccess,
  type GetCurrentRankingSeasonResponse,
  type GetRankingHistoryResponse,
  type GetRankingLeaderboardResponse,
  type GetRankingOverviewResponse,
} from "@bop/shared-protocol";
import { asyncHandler } from "../lib/asyncHandler.js";
import { DomainError } from "../lib/domainError.js";
import {
  requireAuth,
  type AuthenticatedRequest,
  readRequestId,
} from "../lib/auth.js";
import {
  getCurrentSeason,
  getRankingHistory,
  getRankingLeaderboard,
  getRankingOverview,
} from "../services/rankingService.js";

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
  "/overview",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

    const payload: GetRankingOverviewResponse = await getRankingOverview(auth.userId);
    response.json(createSuccess(payload, readRequestId(request)));
  }),
);

router.get(
  "/leaderboard/:queueId",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

    try {
      const payload: GetRankingLeaderboardResponse = await getRankingLeaderboard(
        String(request.params.queueId ?? ""),
      );
      response.json(createSuccess(payload, readRequestId(request)));
    } catch (error) {
      sendDomainError(error, request, response);
    }
  }),
);

router.get(
  "/history",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) return;

    const payload: GetRankingHistoryResponse = await getRankingHistory(auth.userId);
    response.json(createSuccess(payload, readRequestId(request)));
  }),
);

router.get(
  "/season/current",
  asyncHandler(async (_request, response) => {
    const payload: GetCurrentRankingSeasonResponse = await getCurrentSeason();
    response.json(createSuccess(payload, readRequestId(_request)));
  }),
);

export default router;
