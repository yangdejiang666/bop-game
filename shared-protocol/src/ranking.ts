export type RankQueueId =
  | "ranked"
  | "peak"
  | "classic"
  | "battleRoyale"
  | "team";

export type RankTier =
  | "Bronze"
  | "Silver"
  | "Gold"
  | "Platinum"
  | "Diamond"
  | "Master"
  | "Grandmaster";

export interface RankingSeasonSummary {
  seasonId: string;
  name: string;
  status: "upcoming" | "active" | "ended";
  startsAt: string;
  endsAt: string;
}

export interface QueueRatingSummary {
  queueId: RankQueueId;
  displayName: string;
  rankScore: number;
  tier: RankTier;
  division: number;
  wins: number;
  losses: number;
  matchesPlayed: number;
  winRate: number;
  peakRankScore: number;
  bestLeaderboardPosition: number | null;
  updatedAt: string;
}

export interface RankingLeaderboardEntry {
  seasonId: string;
  queueId: RankQueueId;
  rankPosition: number;
  userId: string;
  gameId: string;
  nickname: string;
  avatarUrl: string | null;
  rankScore: number;
  tier: RankTier;
  division: number;
  wins: number;
  losses: number;
  matchesPlayed: number;
  bestMass: number;
  updatedAt: string;
}

export interface RankingHistoryEntry {
  ratingMatchId: string;
  seasonId: string;
  queueId: RankQueueId;
  matchId: string;
  placement: number;
  deltaScore: number;
  result: "win" | "loss";
  rankScoreAfter: number;
  tierAfter: RankTier;
  divisionAfter: number;
  createdAt: string;
}

export interface RankingOverview {
  currentSeason: RankingSeasonSummary | null;
  queues: QueueRatingSummary[];
  featuredLeaderboard: RankingLeaderboardEntry[];
}

export interface GetRankingOverviewResponse {
  overview: RankingOverview;
}

export interface GetRankingLeaderboardResponse {
  season: RankingSeasonSummary | null;
  queueId: RankQueueId;
  entries: RankingLeaderboardEntry[];
}

export interface GetRankingHistoryResponse {
  currentSeason: RankingSeasonSummary | null;
  entries: RankingHistoryEntry[];
}

export interface GetCurrentRankingSeasonResponse {
  season: RankingSeasonSummary | null;
}
