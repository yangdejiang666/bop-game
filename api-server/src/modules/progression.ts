import { Router } from "express";
import {
  PROTOCOL_ERROR,
  createError,
  createSuccess,
  type CompleteMatchProgressionRequest,
  type CompleteMatchProgressionResponse,
} from "@bop/shared-protocol";
import { asyncHandler } from "../lib/asyncHandler.js";
import {
  requireAuth,
  type AuthenticatedRequest,
  readRequestId,
} from "../lib/auth.js";
import { completeMatchProgression } from "../services/progressionService.js";

const router = Router();

router.post(
  "/matches/complete",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) {
      return;
    }

    const body = (request.body ?? {}) as Partial<CompleteMatchProgressionRequest>;
    if (
      typeof body.clientMatchId !== "string" ||
      typeof body.modeId !== "string" ||
      typeof body.playerRank !== "number" ||
      typeof body.playerMass !== "number" ||
      typeof body.playerWon !== "boolean" ||
      typeof body.finishedAt !== "string"
    ) {
      response.status(400).json(
        createError(PROTOCOL_ERROR.INVALID_REQUEST, "Invalid match completion payload.", {
          requestId: readRequestId(request),
        }),
      );
      return;
    }

    const payload: CompleteMatchProgressionResponse =
      await completeMatchProgression({
        userId: auth.userId,
        payload: {
          clientMatchId: body.clientMatchId.trim(),
          modeId: body.modeId.trim(),
          playerRank: Math.max(1, Math.floor(body.playerRank)),
          playerMass: Math.max(0, Math.floor(body.playerMass)),
          playerWon: body.playerWon,
          finishedAt: body.finishedAt,
        },
      });

    response.json(createSuccess(payload, readRequestId(request)));
  }),
);

export default router;
