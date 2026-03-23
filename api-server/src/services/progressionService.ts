import {
  applyMatchRewardsToProgression,
  computeMatchRewards,
  type CompleteMatchProgressionRequest,
  type CompleteMatchProgressionResponse,
  type MatchRewardBreakdown,
  type PlayerProgression,
  PROTOCOL_ERROR,
} from "@bop/shared-protocol";
import { withTransaction } from "../lib/db.js";
import {
  getUserSummaryById,
  overwriteUserProgression,
} from "../repositories/accountRepository.js";
import {
  findMatchResultByClientMatchId,
  insertMatchResult,
} from "../repositories/progressionRepository.js";

function toPlayerProgression(profile: {
  level: number;
  currentXp: number;
  totalXp: number;
  coins: number;
  totalMatches: number;
  totalWins: number;
  bestMass: number;
}): PlayerProgression {
  return {
    level: profile.level,
    currentXp: profile.currentXp,
    totalXp: profile.totalXp,
    coins: profile.coins,
    totalMatches: profile.totalMatches,
    totalWins: profile.totalWins,
    bestMass: profile.bestMass,
  };
}

function rewardFromStoredMatch(params: {
  playerRank: number;
  playerMass: number;
  playerWon: boolean;
  isNewRecord: boolean;
  xpGained: number;
  coinsGained: number;
}): MatchRewardBreakdown {
  const breakdown = computeMatchRewards(
    params.playerRank,
    params.playerMass,
    params.playerWon,
    params.isNewRecord,
  );

  return {
    ...breakdown,
    totalXp: params.xpGained,
    totalCoins: params.coinsGained,
  };
}

export async function completeMatchProgression(params: {
  userId: string;
  payload: CompleteMatchProgressionRequest;
}): Promise<CompleteMatchProgressionResponse> {
  const initial = await findMatchResultByClientMatchId(
    params.userId,
    params.payload.clientMatchId,
  );
  if (initial) {
    const summary = await getUserSummaryById(params.userId);
    if (!summary) {
      throw new Error(PROTOCOL_ERROR.USER_NOT_FOUND);
    }
    return {
      summary: summary.summary,
      rewardBreakdown: rewardFromStoredMatch(initial),
      duplicate: true,
    };
  }

  return withTransaction(async (client) => {
    const existing = await findMatchResultByClientMatchId(
      params.userId,
      params.payload.clientMatchId,
      client,
    );
    if (existing) {
      const summary = await getUserSummaryById(params.userId, client);
      if (!summary) {
        throw new Error(PROTOCOL_ERROR.USER_NOT_FOUND);
      }
      return {
        summary: summary.summary,
        rewardBreakdown: rewardFromStoredMatch(existing),
        duplicate: true,
      };
    }

    const current = await getUserSummaryById(params.userId, client);
    if (!current) {
      throw new Error(PROTOCOL_ERROR.USER_NOT_FOUND);
    }

    const isNewRecord =
      params.payload.playerMass > current.summary.profile.bestMass;
    const rewardBreakdown = computeMatchRewards(
      params.payload.playerRank,
      params.payload.playerMass,
      params.payload.playerWon,
      isNewRecord,
    );
    const applied = applyMatchRewardsToProgression(
      toPlayerProgression(current.summary.profile),
      rewardBreakdown,
    );

    await overwriteUserProgression(
      {
        userId: params.userId,
        progression: applied.after,
      },
      client,
    );

    await insertMatchResult(
      {
        userId: params.userId,
        clientMatchId: params.payload.clientMatchId,
        modeId: params.payload.modeId,
        playerRank: params.payload.playerRank,
        playerMass: params.payload.playerMass,
        playerWon: params.payload.playerWon,
        isNewRecord,
        xpGained: rewardBreakdown.totalXp,
        coinsGained: rewardBreakdown.totalCoins,
        finishedAt: params.payload.finishedAt,
        createdAt: new Date().toISOString(),
      },
      client,
    );

    const summary = await getUserSummaryById(params.userId, client);
    if (!summary) {
      throw new Error(PROTOCOL_ERROR.USER_NOT_FOUND);
    }

    return {
      summary: summary.summary,
      rewardBreakdown,
      duplicate: false,
    };
  });
}
