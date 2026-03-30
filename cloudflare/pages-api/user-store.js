import { dbAll, dbFirst, dbRun } from "./db.js";
import {
  clampNonNegativeInteger,
  computeMatchRewards,
  sanitizePlayerProgression,
  toBoolean,
} from "./helpers.js";

export async function getUserSummaryById(db, userId) {
  const userRow = await dbFirst(
    db,
    `
      SELECT
        u.id AS user_id,
        u.game_id AS user_game_id,
        u.status AS user_status,
        u.created_at AS user_created_at,
        u.updated_at AS user_updated_at,
        u.last_login_at AS user_last_login_at,
        p.nickname AS profile_nickname,
        p.avatar_url AS profile_avatar_url,
        p.bootstrapped_from_local_at AS profile_bootstrapped_from_local_at,
        p.level AS profile_level,
        p.current_xp AS profile_current_xp,
        p.total_xp AS profile_total_xp,
        p.coins AS profile_coins,
        p.season_score AS profile_season_score,
        p.best_mass AS profile_best_mass,
        p.total_matches AS profile_total_matches,
        p.total_wins AS profile_total_wins,
        p.updated_at AS profile_updated_at
      FROM users u
      INNER JOIN user_profiles p ON p.user_id = u.id
      WHERE u.id = ?
      LIMIT 1
    `,
    [userId],
  );

  if (!userRow) {
    return null;
  }

  const identities = await dbAll(
    db,
    `
      SELECT
        provider,
        provider_uid,
        account,
        email,
        phone,
        email_verified,
        phone_verified,
        bound_at
      FROM user_identities
      WHERE user_id = ?
      ORDER BY bound_at ASC
    `,
    [userId],
  );

  return {
    summary: {
      user: {
        id: userRow.user_id,
        gameId: userRow.user_game_id || userRow.user_id,
        status: userRow.user_status,
        createdAt: userRow.user_created_at,
        updatedAt: userRow.user_updated_at,
        lastLoginAt: userRow.user_last_login_at || null,
      },
      profile: {
        userId: userRow.user_id,
        nickname: userRow.profile_nickname,
        avatarUrl: userRow.profile_avatar_url || null,
        level: clampNonNegativeInteger(userRow.profile_level, 1),
        currentXp: clampNonNegativeInteger(userRow.profile_current_xp, 0),
        totalXp: clampNonNegativeInteger(userRow.profile_total_xp, 0),
        coins: clampNonNegativeInteger(userRow.profile_coins, 0),
        seasonScore: clampNonNegativeInteger(userRow.profile_season_score, 0),
        bestMass: clampNonNegativeInteger(userRow.profile_best_mass, 0),
        totalMatches: clampNonNegativeInteger(userRow.profile_total_matches, 0),
        totalWins: clampNonNegativeInteger(userRow.profile_total_wins, 0),
        updatedAt: userRow.profile_updated_at,
      },
      ban: {
        isBanned: userRow.user_status !== "active",
        reason: userRow.user_status === "active" ? null : "account_disabled",
        until: null,
      },
      identities: identities.map((identity) => ({
        provider: identity.provider,
        providerUid: identity.provider_uid,
        username: identity.account || null,
        email: identity.email || null,
        phone: identity.phone || null,
        emailVerified: toBoolean(identity.email_verified),
        phoneVerified: toBoolean(identity.phone_verified),
        boundAt: identity.bound_at,
      })),
    },
    bootstrappedFromLocalAt: userRow.profile_bootstrapped_from_local_at || null,
  };
}

export function buildAuthUser(summaryRecord) {
  const summary = summaryRecord.summary;
  const identity =
    summary.identities.find((item) => item.provider === "password") ||
    summary.identities[0];
  return {
    userId: summary.user.id,
    gameId: summary.user.gameId,
    accountId: identity?.username || identity?.providerUid || summary.user.id,
    nickname: summary.profile.nickname,
    avatarUrl: summary.profile.avatarUrl || "",
    banned: summary.ban.isBanned,
    banReason: summary.ban.reason || undefined,
    banUntil: summary.ban.until || undefined,
    createdAt: summary.user.createdAt,
    updatedAt: summary.user.updatedAt,
  };
}

export async function getDeveloperAccountStats(db) {
  const row = await dbFirst(
    db,
    `
      SELECT
        COUNT(*) AS total_accounts,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_accounts,
        (
          SELECT COUNT(*)
          FROM user_identities
          WHERE provider = 'password'
        ) AS password_accounts,
        SUM(
          CASE
            WHEN last_login_at IS NOT NULL
             AND datetime(last_login_at) >= datetime('now', '-1 day')
            THEN 1
            ELSE 0
          END
        ) AS recent_login_count_24h
      FROM users
    `,
  );

  return {
    totalAccounts: clampNonNegativeInteger(row?.total_accounts, 0),
    activeAccounts: clampNonNegativeInteger(row?.active_accounts, 0),
    passwordAccounts: clampNonNegativeInteger(row?.password_accounts, 0),
    recentLoginCount24h: clampNonNegativeInteger(row?.recent_login_count_24h, 0),
  };
}

function mapDeveloperDigest(row) {
  return {
    userId: row.user_id,
    gameId: row.game_id || row.user_id,
    nickname: row.nickname,
    account: row.account || null,
    provider: row.provider || "password",
    status: row.status,
    level: clampNonNegativeInteger(row.level, 1),
    bestMass: clampNonNegativeInteger(row.best_mass, 0),
    totalMatches: clampNonNegativeInteger(row.total_matches, 0),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
  };
}

export async function getDeveloperAccountDigestByUserId(db, userId) {
  const row = await dbFirst(
    db,
    `
      SELECT
        u.id AS user_id,
        u.game_id AS game_id,
        u.status AS status,
        u.created_at AS created_at,
        u.last_login_at AS last_login_at,
        p.nickname AS nickname,
        p.level AS level,
        p.best_mass AS best_mass,
        p.total_matches AS total_matches,
        i.account AS account,
        i.provider AS provider
      FROM users u
      INNER JOIN user_profiles p ON p.user_id = u.id
      LEFT JOIN user_identities i ON i.user_id = u.id AND i.provider = 'password'
      WHERE u.id = ?
      LIMIT 1
    `,
    [userId],
  );

  return row ? mapDeveloperDigest(row) : null;
}

export async function listRecentDeveloperAccounts(db, limit = 6) {
  const rows = await dbAll(
    db,
    `
      SELECT
        u.id AS user_id,
        u.game_id AS game_id,
        u.status AS status,
        u.created_at AS created_at,
        u.last_login_at AS last_login_at,
        p.nickname AS nickname,
        p.level AS level,
        p.best_mass AS best_mass,
        p.total_matches AS total_matches,
        i.account AS account,
        i.provider AS provider
      FROM users u
      INNER JOIN user_profiles p ON p.user_id = u.id
      LEFT JOIN user_identities i ON i.user_id = u.id AND i.provider = 'password'
      ORDER BY datetime(u.created_at) DESC
      LIMIT ?
    `,
    [Math.max(1, Math.min(20, Math.floor(limit)))],
  );
  return rows.map(mapDeveloperDigest);
}

export async function getPublicUserCardById(db, userId) {
  return dbFirst(
    db,
    `
      SELECT
        p.user_id,
        u.game_id,
        p.nickname,
        p.avatar_url,
        p.level,
        p.best_mass,
        p.season_score
      FROM user_profiles p
      INNER JOIN users u ON u.id = p.user_id
      WHERE p.user_id = ?
      LIMIT 1
    `,
    [userId],
  );
}

export async function findPasswordIdentityByAccount(db, account) {
  return dbFirst(
    db,
    `
      SELECT
        i.user_id,
        i.account,
        i.password_hash,
        u.status AS user_status
      FROM user_identities i
      INNER JOIN users u ON u.id = i.user_id
      WHERE i.provider = 'password' AND i.account = ?
      LIMIT 1
    `,
    [account],
  );
}

export async function updateUserProgression(db, userId, progression, updatedAt) {
  await dbRun(
    db,
    `
      UPDATE user_profiles
      SET
        level = ?,
        current_xp = ?,
        total_xp = ?,
        coins = ?,
        total_matches = ?,
        total_wins = ?,
        best_mass = ?,
        updated_at = ?
      WHERE user_id = ?
    `,
    [
      progression.level,
      progression.currentXp,
      progression.totalXp,
      progression.coins,
      progression.totalMatches,
      progression.totalWins,
      progression.bestMass,
      updatedAt,
      userId,
    ],
  );
}

export async function findMatchResultByClientMatchId(db, userId, clientMatchId) {
  return dbFirst(
    db,
    `
      SELECT
        player_rank,
        player_mass,
        player_won,
        is_new_record,
        xp_gained,
        coins_gained
      FROM user_match_results
      WHERE user_id = ? AND client_match_id = ?
      LIMIT 1
    `,
    [userId, clientMatchId],
  );
}

export function rewardFromStoredMatch(stored) {
  const breakdown = computeMatchRewards(
    stored.player_rank,
    stored.player_mass,
    toBoolean(stored.player_won),
    toBoolean(stored.is_new_record),
  );
  return {
    ...breakdown,
    totalXp: clampNonNegativeInteger(stored.xp_gained, breakdown.totalXp),
    totalCoins: clampNonNegativeInteger(stored.coins_gained, breakdown.totalCoins),
  };
}

export function toProfileProgression(profile) {
  return sanitizePlayerProgression(profile);
}
