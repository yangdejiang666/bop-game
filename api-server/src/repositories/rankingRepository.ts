import type {
  GetCurrentRankingSeasonResponse,
  GetRankingHistoryResponse,
  GetRankingLeaderboardResponse,
  GetRankingOverviewResponse,
  QueueRatingSummary,
  RankQueueId,
  RankTier,
  RankingHistoryEntry,
  RankingLeaderboardEntry,
  RankingOverview,
  RankingSeasonSummary,
} from "@bop/shared-protocol";
import type { QueryResultRow } from "pg";
import type { DbExecutor } from "../lib/db.js";
import { query } from "../lib/db.js";
import {
  getActiveUserDirectoryEntriesByUserIds,
  listActiveUserDirectoryEntries,
} from "./userDirectoryRepository.js";

interface SeasonRow extends QueryResultRow {
  season_id: string;
  name: string;
  status: "upcoming" | "active" | "ended";
  starts_at: string;
  ends_at: string;
}

interface QueueRow extends QueryResultRow {
  queue_id: RankQueueId;
  display_name: string;
  visible: boolean;
  default_mmr: number;
}

interface RatingRow extends QueryResultRow {
  queue_id: RankQueueId;
  display_name: string;
  rank_score: number;
  mmr: number;
  wins: number;
  losses: number;
  matches_played: number;
  peak_rank_score: number;
  best_leaderboard_position: number | null;
  updated_at: string;
}

interface LeaderboardRow extends QueryResultRow {
  user_id: string;
  rank_score: number;
  mmr: number;
  wins: number;
  losses: number;
  matches_played: number;
  peak_rank_score: number;
  updated_at: string;
}

interface HistoryRow extends QueryResultRow {
  rating_match_id: string;
  season_id: string;
  queue_id: RankQueueId;
  match_id: string;
  placement: number;
  delta_score: number;
  result: "win" | "loss";
  rank_score_after: number;
  tier_after: RankTier;
  division_after: number;
  created_at: string;
}

type Executor = DbExecutor;

function getExecutor(executor?: Executor): Executor {
  return (
    executor ?? {
      query: (text, params) => query(text, params),
    }
  );
}

const TIER_BRACKETS: Array<{
  tier: RankTier;
  min: number;
  max: number;
  divisions: number;
}> = [
  { tier: "Bronze", min: 0, max: 1199, divisions: 3 },
  { tier: "Silver", min: 1200, max: 1399, divisions: 3 },
  { tier: "Gold", min: 1400, max: 1599, divisions: 3 },
  { tier: "Platinum", min: 1600, max: 1799, divisions: 3 },
  { tier: "Diamond", min: 1800, max: 2099, divisions: 3 },
  { tier: "Master", min: 2100, max: 2399, divisions: 2 },
  { tier: "Grandmaster", min: 2400, max: Number.POSITIVE_INFINITY, divisions: 1 },
];

function toSeasonSummary(row: SeasonRow | null | undefined): RankingSeasonSummary | null {
  if (!row) {
    return null;
  }

  return {
    seasonId: row.season_id,
    name: row.name,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  };
}

export function resolveTierDivision(rankScore: number): {
  tier: RankTier;
  division: number;
} {
  const safeScore = Math.max(0, Math.floor(rankScore));
  const bracket =
    TIER_BRACKETS.find((candidate) => safeScore >= candidate.min && safeScore <= candidate.max) ??
    TIER_BRACKETS[0]!;

  if (bracket.divisions <= 1 || !Number.isFinite(bracket.max)) {
    return {
      tier: bracket.tier,
      division: 1,
    };
  }

  const span = Math.max(1, bracket.max - bracket.min + 1);
  const offset = Math.min(span - 1, Math.max(0, safeScore - bracket.min));
  const bucketSize = Math.max(1, Math.ceil(span / bracket.divisions));
  const division = Math.max(
    1,
    bracket.divisions - Math.floor(offset / bucketSize),
  );

  return {
    tier: bracket.tier,
    division,
  };
}

async function getCurrentSeasonRow(executor?: Executor): Promise<SeasonRow | null> {
  const db = getExecutor(executor);
  const result = await db.query<SeasonRow>(
    `
      SELECT season_id, name, status, starts_at, ends_at
      FROM rank_seasons
      WHERE status = 'active'
      ORDER BY starts_at DESC
      LIMIT 1
    `,
  );

  return result.rows[0] ?? null;
}

async function listVisibleQueues(executor?: Executor): Promise<QueueRow[]> {
  const db = getExecutor(executor);
  const result = await db.query<QueueRow>(
    `
      SELECT queue_id, display_name, visible, default_mmr
      FROM rank_queues
      WHERE visible = TRUE
      ORDER BY queue_id ASC
    `,
  );

  return result.rows;
}

export async function getCurrentRankingSeason(
  executor?: Executor,
): Promise<GetCurrentRankingSeasonResponse> {
  return {
    season: toSeasonSummary(await getCurrentSeasonRow(executor)),
  };
}

export async function ensureCurrentSeasonRatings(
  executor?: Executor,
): Promise<RankingSeasonSummary | null> {
  const db = getExecutor(executor);
  const season = await getCurrentSeasonRow(db);
  if (!season) {
    return null;
  }

  const queues = await listVisibleQueues(db);
  const users = await listActiveUserDirectoryEntries(db);

  for (const queueRow of queues) {
    for (const user of users) {
      const baseMatches = Math.max(0, Math.floor(user.totalMatches / 4));
      const baseWins = Math.max(0, Math.min(baseMatches, Math.floor(user.totalWins / 4)));
      const rankScore = Math.max(queueRow.default_mmr, queueRow.default_mmr + user.seasonScore);
      const { tier, division } = resolveTierDivision(rankScore);

      await db.query(
        `
          INSERT INTO rank_player_ratings (
            season_id,
            queue_id,
            user_id,
            mmr,
            rank_score,
            tier,
            division,
            wins,
            losses,
            matches_played,
            peak_rank_score,
            best_leaderboard_position,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $4, NULL, NOW(), NOW())
          ON CONFLICT (season_id, queue_id, user_id) DO NOTHING
        `,
        [
          season.season_id,
          queueRow.queue_id,
          user.userId,
          rankScore,
          tier,
          division,
          baseWins,
          Math.max(0, baseMatches - baseWins),
          baseMatches,
        ],
      );
    }
  }

  return toSeasonSummary(season);
}

async function refreshLeaderboardSnapshots(
  seasonId: string,
  queueId: RankQueueId,
  entries: RankingLeaderboardEntry[],
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  await db.query(
    `
      DELETE FROM rank_leaderboard_snapshots
      WHERE season_id = $1
        AND queue_id = $2
    `,
    [seasonId, queueId],
  );

  for (const entry of entries) {
    await db.query(
      `
        INSERT INTO rank_leaderboard_snapshots (
          season_id,
          queue_id,
          rank_position,
          user_id,
          rank_score,
          tier,
          division,
          wins,
          losses,
          matches_played,
          best_mass,
          snapshot_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      `,
      [
        seasonId,
        queueId,
        entry.rankPosition,
        entry.userId,
        entry.rankScore,
        entry.tier,
        entry.division,
        entry.wins,
        entry.losses,
        entry.matchesPlayed,
        entry.bestMass,
      ],
    );
  }
}

export async function listQueueRatingsForUser(
  userId: string,
  executor?: Executor,
): Promise<QueueRatingSummary[]> {
  const db = getExecutor(executor);
  const season = await ensureCurrentSeasonRatings(db);
  if (!season) {
    return [];
  }

  const result = await db.query<RatingRow>(
    `
      SELECT
        r.queue_id,
        q.display_name,
        r.rank_score,
        r.mmr,
        r.wins,
        r.losses,
        r.matches_played,
        r.peak_rank_score,
        r.best_leaderboard_position,
        r.updated_at
      FROM rank_player_ratings r
      INNER JOIN rank_queues q ON q.queue_id = r.queue_id
      WHERE r.season_id = $1
        AND r.user_id = $2
      ORDER BY r.queue_id ASC
    `,
    [season.seasonId, userId],
  );

  return result.rows.map((row) => {
    const { tier, division } = resolveTierDivision(row.rank_score);
    return {
      queueId: row.queue_id,
      displayName: row.display_name,
      rankScore: row.rank_score,
      tier,
      division,
      wins: row.wins,
      losses: row.losses,
      matchesPlayed: row.matches_played,
      winRate:
        row.matches_played > 0
          ? Number((row.wins / row.matches_played).toFixed(4))
          : 0,
      peakRankScore: row.peak_rank_score,
      bestLeaderboardPosition: row.best_leaderboard_position,
      updatedAt: row.updated_at,
    } satisfies QueueRatingSummary;
  });
}

export async function listRankingLeaderboard(
  queueId: RankQueueId,
  limit = 100,
  executor?: Executor,
): Promise<GetRankingLeaderboardResponse> {
  const db = getExecutor(executor);
  const season = await ensureCurrentSeasonRatings(db);
  if (!season) {
    return {
      season: null,
      queueId,
      entries: [],
    };
  }

  const result = await db.query<LeaderboardRow>(
    `
      SELECT
        user_id,
        rank_score,
        mmr,
        wins,
        losses,
        matches_played,
        peak_rank_score,
        updated_at
      FROM rank_player_ratings
      WHERE season_id = $1
        AND queue_id = $2
      ORDER BY rank_score DESC, mmr DESC, updated_at ASC
      LIMIT $3
    `,
    [season.seasonId, queueId, Math.max(1, Math.min(100, Math.floor(limit)))],
  );

  const directoryByUserId = await getActiveUserDirectoryEntriesByUserIds(
    result.rows.map((row) => row.user_id),
    db,
  );

  const entries = result.rows.flatMap((row, index) => {
    const user = directoryByUserId.get(row.user_id);
    if (!user) {
      return [];
    }

    const { tier, division } = resolveTierDivision(row.rank_score);
    return [
      {
        seasonId: season.seasonId,
        queueId,
        rankPosition: index + 1,
        userId: user.userId,
        gameId: user.gameId,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
        rankScore: row.rank_score,
        tier,
        division,
        wins: row.wins,
        losses: row.losses,
        matchesPlayed: row.matches_played,
        bestMass: user.bestMass,
        updatedAt: row.updated_at,
      } satisfies RankingLeaderboardEntry,
    ];
  });

  await refreshLeaderboardSnapshots(season.seasonId, queueId, entries, db);

  return {
    season,
    queueId,
    entries,
  };
}

export async function listRankingHistoryForUser(
  userId: string,
  limit = 20,
  executor?: Executor,
): Promise<GetRankingHistoryResponse> {
  const db = getExecutor(executor);
  const season = await ensureCurrentSeasonRatings(db);
  const currentSeasonId = season?.seasonId ?? null;

  const result = await db.query<HistoryRow>(
    `
      SELECT
        rating_match_id,
        season_id,
        queue_id,
        match_id,
        placement,
        delta_score,
        result,
        rank_score_after,
        tier_after,
        division_after,
        created_at
      FROM rank_match_results
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [userId, Math.max(1, Math.min(50, Math.floor(limit)))],
  );

  return {
    currentSeason: season,
    entries: result.rows.map((row) => ({
      ratingMatchId: row.rating_match_id,
      seasonId: row.season_id,
      queueId: row.queue_id,
      matchId: row.match_id,
      placement: row.placement,
      deltaScore: row.delta_score,
      result: row.result,
      rankScoreAfter: row.rank_score_after,
      tierAfter: row.tier_after,
      divisionAfter: row.division_after,
      createdAt: row.created_at,
    } satisfies RankingHistoryEntry)).filter((entry) => !currentSeasonId || entry.seasonId === currentSeasonId),
  };
}

export async function getRankingOverviewByUserId(
  userId: string,
  executor?: Executor,
): Promise<GetRankingOverviewResponse> {
  const db = getExecutor(executor);
  const currentSeason = await ensureCurrentSeasonRatings(db);
  const queues = await listQueueRatingsForUser(userId, db);
  const featuredLeaderboard = (
    await listRankingLeaderboard("ranked", 10, db)
  ).entries;

  return {
    overview: {
      currentSeason,
      queues,
      featuredLeaderboard,
    } satisfies RankingOverview,
  };
}
