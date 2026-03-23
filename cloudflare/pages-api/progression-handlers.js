import { PROTOCOL_ERROR } from "./constants.js";
import { dbRun } from "./db.js";
import {
  applyMatchRewardsToProgression,
  computeMatchRewards,
  failure,
  nowIso,
  readJson,
  success,
} from "./helpers.js";
import { requireAuth } from "./auth-handlers.js";
import {
  findMatchResultByClientMatchId,
  getUserSummaryById,
  rewardFromStoredMatch,
  toProfileProgression,
  updateUserProgression,
} from "./user-store.js";

export async function handleCompleteMatch(request, env, requestId) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const body = await readJson(request);
  if (
    !body ||
    typeof body.clientMatchId !== "string" ||
    typeof body.modeId !== "string" ||
    typeof body.playerRank !== "number" ||
    typeof body.playerMass !== "number" ||
    typeof body.playerWon !== "boolean" ||
    typeof body.finishedAt !== "string"
  ) {
    return failure(
      request,
      requestId,
      400,
      PROTOCOL_ERROR.INVALID_REQUEST,
      "Invalid match completion payload.",
    );
  }

  const existing = await findMatchResultByClientMatchId(
    required.auth.db,
    required.auth.userId,
    body.clientMatchId.trim(),
  );
  if (existing) {
    const summary = await getUserSummaryById(required.auth.db, required.auth.userId);
    return success(request, requestId, {
      summary: summary.summary,
      rewardBreakdown: rewardFromStoredMatch(existing),
      duplicate: true,
    });
  }

  const current = await getUserSummaryById(required.auth.db, required.auth.userId);
  if (!current) {
    return failure(
      request,
      requestId,
      404,
      PROTOCOL_ERROR.USER_NOT_FOUND,
      "User not found.",
    );
  }

  const progressionBefore = toProfileProgression(current.summary.profile);
  const isNewRecord = Math.floor(body.playerMass) > progressionBefore.bestMass;
  const rewardBreakdown = computeMatchRewards(
    body.playerRank,
    body.playerMass,
    body.playerWon,
    isNewRecord,
  );
  const applied = applyMatchRewardsToProgression(
    progressionBefore,
    rewardBreakdown,
  );
  const timestamp = nowIso();

  await updateUserProgression(
    required.auth.db,
    required.auth.userId,
    applied.after,
    timestamp,
  );
  await dbRun(
    required.auth.db,
    `
      INSERT INTO user_match_results (
        id,
        user_id,
        client_match_id,
        mode_id,
        player_rank,
        player_mass,
        player_won,
        is_new_record,
        xp_gained,
        coins_gained,
        finished_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      `matchresult_${crypto.randomUUID().replaceAll("-", "")}`,
      required.auth.userId,
      body.clientMatchId.trim(),
      body.modeId.trim(),
      Math.max(1, Math.floor(body.playerRank)),
      Math.max(0, Math.floor(body.playerMass)),
      body.playerWon ? 1 : 0,
      isNewRecord ? 1 : 0,
      rewardBreakdown.totalXp,
      rewardBreakdown.totalCoins,
      body.finishedAt,
      timestamp,
    ],
  );

  const summary = await getUserSummaryById(required.auth.db, required.auth.userId);
  return success(request, requestId, {
    summary: summary.summary,
    rewardBreakdown,
    duplicate: false,
  });
}
