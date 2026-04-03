import type { QueryResultRow } from "pg";
import type { DbExecutor } from "../lib/db.js";
import { query } from "../lib/db.js";
import { deriveGameId } from "./accountRepository.js";

export const ONLINE_PRESENCE_WINDOW_MS = 60_000;

interface UserDirectoryRow extends QueryResultRow {
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  level: number;
  best_mass: number;
  season_score: number;
  total_matches: number;
  total_wins: number;
  last_seen_at: string | null;
  game_seed: string;
}

export interface UserDirectoryEntry {
  userId: string;
  gameId: string;
  nickname: string;
  avatarUrl: string | null;
  level: number;
  bestMass: number;
  seasonScore: number;
  totalMatches: number;
  totalWins: number;
  lastSeenAt: string | null;
}

type Executor = DbExecutor;

function getExecutor(executor?: Executor): Executor {
  return (
    executor ?? {
      query: (text, params) => query(text, params),
    }
  );
}

function mapUserDirectoryEntry(row: UserDirectoryRow): UserDirectoryEntry {
  return {
    userId: row.user_id,
    gameId: deriveGameId(row.game_seed || row.user_id),
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    level: row.level,
    bestMass: row.best_mass,
    seasonScore: row.season_score,
    totalMatches: row.total_matches,
    totalWins: row.total_wins,
    lastSeenAt: row.last_seen_at,
  };
}

const BASE_DIRECTORY_SELECT = `
  SELECT
    u.id AS user_id,
    p.nickname,
    p.avatar_url,
    p.level,
    p.best_mass,
    p.season_score,
    p.total_matches,
    p.total_wins,
    sessions.last_seen_at,
    COALESCE(password_identity.account, primary_identity.provider_uid, u.id::text) AS game_seed
  FROM users u
  INNER JOIN user_profiles p ON p.user_id = u.id
  LEFT JOIN LATERAL (
    SELECT account
    FROM user_identities
    WHERE user_id = u.id
      AND provider = 'password'
      AND account IS NOT NULL
    ORDER BY created_at ASC
    LIMIT 1
  ) password_identity ON TRUE
  LEFT JOIN LATERAL (
    SELECT provider_uid
    FROM user_identities
    WHERE user_id = u.id
      AND provider_uid IS NOT NULL
    ORDER BY created_at ASC
    LIMIT 1
  ) primary_identity ON TRUE
  LEFT JOIN LATERAL (
    SELECT MAX(last_seen_at) AS last_seen_at
    FROM auth_sessions
    WHERE user_id = u.id
      AND revoked_at IS NULL
  ) sessions ON TRUE
  WHERE u.status = 'active'
`;

export function isUserDirectoryEntryOnline(
  entry: Pick<UserDirectoryEntry, "lastSeenAt">,
): boolean {
  if (!entry.lastSeenAt) {
    return false;
  }

  const ts = Date.parse(entry.lastSeenAt);
  if (Number.isNaN(ts)) {
    return false;
  }

  return Date.now() - ts <= ONLINE_PRESENCE_WINDOW_MS;
}

export async function listActiveUserDirectoryEntries(
  executor?: Executor,
): Promise<UserDirectoryEntry[]> {
  const db = getExecutor(executor);
  const result = await db.query<UserDirectoryRow>(
    `${BASE_DIRECTORY_SELECT}
     ORDER BY u.created_at DESC`,
  );

  return result.rows.map(mapUserDirectoryEntry);
}

export async function getActiveUserDirectoryEntryByUserId(
  userId: string,
  executor?: Executor,
): Promise<UserDirectoryEntry | null> {
  const db = getExecutor(executor);
  const result = await db.query<UserDirectoryRow>(
    `${BASE_DIRECTORY_SELECT}
     AND u.id = $1
     LIMIT 1`,
    [userId],
  );

  const row = result.rows[0];
  return row ? mapUserDirectoryEntry(row) : null;
}

export async function getActiveUserDirectoryEntriesByUserIds(
  userIds: string[],
  executor?: Executor,
): Promise<Map<string, UserDirectoryEntry>> {
  const uniqueUserIds = [...new Set(userIds.map((value) => value.trim()).filter(Boolean))];
  const byId = new Map<string, UserDirectoryEntry>();

  if (uniqueUserIds.length === 0) {
    return byId;
  }

  const db = getExecutor(executor);
  const params = uniqueUserIds.map((_, index) => `$${index + 1}`).join(", ");
  const result = await db.query<UserDirectoryRow>(
    `${BASE_DIRECTORY_SELECT}
     AND u.id IN (${params})`,
    uniqueUserIds,
  );

  for (const row of result.rows) {
    const entry = mapUserDirectoryEntry(row);
    byId.set(entry.userId, entry);
  }

  return byId;
}

export async function findActiveUserDirectoryEntryByGameId(
  gameId: string,
  executor?: Executor,
): Promise<UserDirectoryEntry | null> {
  const safeGameId = gameId.trim();
  if (!/^\d{9}$/.test(safeGameId)) {
    return null;
  }

  const entries = await listActiveUserDirectoryEntries(executor);
  return entries.find((entry) => entry.gameId === safeGameId) ?? null;
}
