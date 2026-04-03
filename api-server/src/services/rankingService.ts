import {
  PROTOCOL_ERROR,
  type GetCurrentRankingSeasonResponse,
  type GetRankingHistoryResponse,
  type GetRankingLeaderboardResponse,
  type GetRankingOverviewResponse,
  type RankQueueId,
} from "@bop/shared-protocol";
import { DomainError } from "../lib/domainError.js";
import {
  getCurrentRankingSeason,
  getRankingOverviewByUserId,
  listRankingHistoryForUser,
  listRankingLeaderboard,
} from "../repositories/rankingRepository.js";

const SUPPORTED_QUEUES: readonly RankQueueId[] = [
  "ranked",
  "peak",
  "classic",
  "battleRoyale",
  "team",
] as const;

export async function getRankingOverview(
  userId: string,
): Promise<GetRankingOverviewResponse> {
  return getRankingOverviewByUserId(userId);
}

export async function getRankingLeaderboard(
  queueId: string,
): Promise<GetRankingLeaderboardResponse> {
  if (!SUPPORTED_QUEUES.includes(queueId as RankQueueId)) {
    throw new DomainError(
      PROTOCOL_ERROR.RANKING_QUEUE_NOT_FOUND,
      "Ranking queue not found.",
      404,
      { queueId },
    );
  }

  return listRankingLeaderboard(queueId as RankQueueId);
}

export async function getRankingHistory(
  userId: string,
): Promise<GetRankingHistoryResponse> {
  return listRankingHistoryForUser(userId);
}

export async function getCurrentSeason(): Promise<GetCurrentRankingSeasonResponse> {
  return getCurrentRankingSeason();
}
