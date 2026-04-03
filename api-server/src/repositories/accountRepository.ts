import type {
  DeveloperAccountDigest,
  DeveloperAccountStats,
  DeviceInfo,
  DeviceSession,
  PublicUserCard,
  UserIdentity,
  UserProfile,
  UserSummary,
} from "@bop/shared-protocol";
import type { QueryResultRow } from "pg";
import type { DbExecutor } from "../lib/db.js";
import { query } from "../lib/db.js";

type Executor = DbExecutor;

interface UserSummaryRow extends QueryResultRow {
  user_id: string;
  user_status: "active" | "banned" | "deleted";
  user_created_at: string;
  user_updated_at: string;
  user_last_login_at: string | null;
  profile_nickname: string;
  profile_avatar_url: string | null;
  profile_level: number;
  profile_current_xp: number;
  profile_total_xp: number;
  profile_coins: number;
  profile_season_score: number;
  profile_best_mass: number;
  profile_total_matches: number;
  profile_total_wins: number;
  profile_updated_at: string;
  profile_bootstrapped_from_local_at: string | null;
  ban_is_banned: boolean | null;
  ban_reason: string | null;
  ban_until: string | null;
}

interface UserIdentityRow extends QueryResultRow {
  provider: "guest" | "password" | "phone" | "apple" | "wechat";
  provider_uid: string;
  account: string | null;
  email: string | null;
  phone: string | null;
  email_verified: boolean;
  phone_verified: boolean;
  bound_at: string;
}

interface DeveloperAccountDigestRow extends QueryResultRow {
  userId: string;
  nickname: string;
  account: string | null;
  providerUid: string | null;
  provider: "guest" | "password" | "phone" | "apple" | "wechat" | null;
  userStatus: "active" | "banned" | "deleted";
  level: number;
  bestMass: number;
  totalMatches: number;
  createdAt: string;
  lastLoginAt: string | null;
}

interface DeveloperAccountStatsRow extends QueryResultRow {
  totalAccounts: string | number;
  activeAccounts: string | number;
  passwordAccounts: string | number;
  recentLoginCount24h: string | number;
}

export interface PasswordIdentityRecord {
  userId: string;
  account: string;
  passwordHash: string;
  userStatus: "active" | "banned" | "deleted";
  banned: boolean;
  banReason: string | null;
  banUntil: string | null;
}

export interface ProviderIdentityRecord {
  userId: string;
  provider: "guest" | "password" | "phone" | "apple" | "wechat" | "platform";
  providerUid: string;
  email: string | null;
  emailVerified: boolean;
}

export interface PhoneIdentityRecord {
  userId: string;
  provider: "guest" | "password" | "phone" | "apple" | "wechat" | "platform";
  providerUid: string;
  phone: string;
  phoneVerified: boolean;
  userStatus: "active" | "banned" | "deleted";
  banned: boolean;
  banReason: string | null;
  banUntil: string | null;
}

export interface SessionRecord {
  sessionId: string;
  userId: string;
  deviceId: string;
  platform: DeviceInfo["platform"] | "unknown";
  appVersion: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

export interface RefreshTokenRecord {
  refreshTokenId: string;
  sessionId: string;
  userId: string;
  expiresAt: string;
  revokedAt: string | null;
  sessionRevokedAt: string | null;
  deviceId: string;
  platform: DeviceInfo["platform"] | "unknown";
  appVersion: string;
}

export interface UserSummaryRecord {
  summary: UserSummary;
  bootstrappedFromLocalAt: string | null;
}

function getExecutor(executor?: Executor): Executor {
  return (
    executor ?? {
      query: (text, params) => query(text, params),
    }
  );
}

function sanitizeNullableText(value: string | null | undefined): string | null {
  return value && value.trim().length > 0 ? value : null;
}

function mapProfile(row: UserSummaryRow): UserProfile {
  return {
    userId: row.user_id,
    nickname: row.profile_nickname,
    avatarUrl: row.profile_avatar_url,
    level: row.profile_level,
    currentXp: row.profile_current_xp,
    totalXp: row.profile_total_xp,
    coins: row.profile_coins,
    seasonScore: row.profile_season_score,
    bestMass: row.profile_best_mass,
    totalMatches: row.profile_total_matches,
    totalWins: row.profile_total_wins,
    updatedAt: row.profile_updated_at,
  };
}

function mapIdentity(row: UserIdentityRow): UserIdentity {
  return {
    provider: row.provider,
    providerUid: row.provider_uid,
    username: row.account,
    email: row.email,
    phone: row.phone,
    emailVerified: row.email_verified,
    phoneVerified: row.phone_verified,
    boundAt: row.bound_at,
  };
}

function toGameIdSeed(identities: UserIdentity[]): string | null {
  const preferredAccount = identities.find(
    (identity) => identity.provider === "password" && identity.username?.trim(),
  );
  if (preferredAccount?.username) {
    return preferredAccount.username;
  }

  const preferredProviderUid = identities.find((identity) =>
    identity.providerUid.trim().length > 0
  );
  if (preferredProviderUid?.providerUid) {
    return preferredProviderUid.providerUid;
  }

  return null;
}

export function deriveGameId(seed: string): string {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return String(100_000_000 + (hash % 900_000_000));
}

function mapDeveloperAccountDigest(
  row: DeveloperAccountDigestRow,
): DeveloperAccountDigest {
  return {
    userId: row.userId,
    gameId: deriveGameId(row.account ?? row.providerUid ?? row.userId),
    nickname: row.nickname,
    account: row.account,
    provider: row.provider ?? "password",
    status: row.userStatus,
    level: row.level,
    bestMass: row.bestMass,
    totalMatches: row.totalMatches,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
  };
}

function parsePgCount(value: string | number | undefined): number {
  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    return 0;
  }
  return Math.floor(normalized);
}

async function getUserSummaryRow(
  userId: string,
  executor?: Executor,
): Promise<UserSummaryRow | null> {
  const db = getExecutor(executor);
  const result = await db.query<UserSummaryRow>(
    `
      SELECT
        u.id AS user_id,
        u.status AS user_status,
        u.created_at AS user_created_at,
        u.updated_at AS user_updated_at,
        u.last_login_at AS user_last_login_at,
        p.nickname AS profile_nickname,
        p.avatar_url AS profile_avatar_url,
        p.level AS profile_level,
        p.current_xp AS profile_current_xp,
        p.total_xp AS profile_total_xp,
        p.coins AS profile_coins,
        p.season_score AS profile_season_score,
        p.best_mass AS profile_best_mass,
        p.total_matches AS profile_total_matches,
        p.total_wins AS profile_total_wins,
        p.updated_at AS profile_updated_at,
        p.bootstrapped_from_local_at AS profile_bootstrapped_from_local_at,
        b.is_banned AS ban_is_banned,
        b.reason AS ban_reason,
        b.banned_until AS ban_until
      FROM users u
      INNER JOIN user_profiles p ON p.user_id = u.id
      LEFT JOIN user_bans b ON b.user_id = u.id
      WHERE u.id = $1
      LIMIT 1
    `,
    [userId],
  );

  return result.rows[0] ?? null;
}

async function getUserIdentities(
  userId: string,
  executor?: Executor,
): Promise<UserIdentity[]> {
  const db = getExecutor(executor);
  const result = await db.query<UserIdentityRow>(
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
      WHERE user_id = $1
      ORDER BY created_at ASC
    `,
    [userId],
  );

  return result.rows.map(mapIdentity);
}

export function normalizeAccount(account: string): string {
  return account.trim().toLowerCase();
}

export function normalizeNickname(
  nickname: string | undefined,
  fallback = "勇者球球",
): string {
  const safe = nickname?.trim().slice(0, 12);
  return safe && safe.length > 0 ? safe : fallback;
}

export async function getUserSummaryById(
  userId: string,
  executor?: Executor,
): Promise<UserSummaryRecord | null> {
  const row = await getUserSummaryRow(userId, executor);
  if (!row) {
    return null;
  }

  const identities = await getUserIdentities(userId, executor);

  return {
    summary: {
      user: {
        id: row.user_id,
        gameId: deriveGameId(toGameIdSeed(identities) ?? row.user_id),
        status: row.user_status,
        createdAt: row.user_created_at,
        updatedAt: row.user_updated_at,
        lastLoginAt: row.user_last_login_at,
      },
      profile: mapProfile(row),
      ban: {
        isBanned: row.ban_is_banned ?? false,
        reason: row.ban_reason,
        until: row.ban_until,
      },
      identities,
    },
    bootstrappedFromLocalAt: row.profile_bootstrapped_from_local_at,
  };
}

export async function getPublicUserCardById(
  userId: string,
  executor?: Executor,
): Promise<PublicUserCard | null> {
  const row = await getUserSummaryRow(userId, executor);
  if (!row || row.user_status === "deleted") {
    return null;
  }

  const identities = await getUserIdentities(userId, executor);

  return {
    userId: row.user_id,
    gameId: deriveGameId(toGameIdSeed(identities) ?? row.user_id),
    nickname: row.profile_nickname,
    avatarUrl: row.profile_avatar_url,
    level: row.profile_level,
    bestMass: row.profile_best_mass,
    seasonScore: row.profile_season_score,
  };
}

export async function getDeveloperAccountStats(
  executor?: Executor,
): Promise<DeveloperAccountStats> {
  const db = getExecutor(executor);
  const result = await db.query<DeveloperAccountStatsRow>(
    `
      SELECT
        COUNT(DISTINCT u.id) FILTER (WHERE u.status <> 'deleted') AS "totalAccounts",
        COUNT(DISTINCT u.id) FILTER (WHERE u.status = 'active') AS "activeAccounts",
        COUNT(DISTINCT CASE WHEN ui.provider = 'password' THEN u.id END) AS "passwordAccounts",
        COUNT(DISTINCT u.id) FILTER (
          WHERE u.last_login_at IS NOT NULL
            AND u.last_login_at >= NOW() - INTERVAL '24 hours'
        ) AS "recentLoginCount24h"
      FROM users u
      LEFT JOIN user_identities ui ON ui.user_id = u.id
    `,
  );

  const row = result.rows[0];
  return {
    totalAccounts: parsePgCount(row?.totalAccounts),
    activeAccounts: parsePgCount(row?.activeAccounts),
    passwordAccounts: parsePgCount(row?.passwordAccounts),
    recentLoginCount24h: parsePgCount(row?.recentLoginCount24h),
  };
}

export async function getDeveloperAccountDigestByUserId(
  userId: string,
  executor?: Executor,
): Promise<DeveloperAccountDigest | null> {
  const db = getExecutor(executor);
  const result = await db.query<DeveloperAccountDigestRow>(
    `
      SELECT
        u.id AS "userId",
        p.nickname AS nickname,
        identity.account AS account,
        identity.provider_uid AS "providerUid",
        identity.provider AS provider,
        u.status AS "userStatus",
        p.level AS level,
        p.best_mass AS "bestMass",
        p.total_matches AS "totalMatches",
        u.created_at AS "createdAt",
        u.last_login_at AS "lastLoginAt"
      FROM users u
      INNER JOIN user_profiles p ON p.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT
          provider::text AS provider,
          provider_uid,
          account
        FROM user_identities
        WHERE user_id = u.id
        ORDER BY
          CASE WHEN provider = 'password' THEN 0 ELSE 1 END,
          created_at ASC
        LIMIT 1
      ) identity ON TRUE
      WHERE u.id = $1
        AND u.status <> 'deleted'
      LIMIT 1
    `,
    [userId],
  );

  const row = result.rows[0];
  return row ? mapDeveloperAccountDigest(row) : null;
}

export async function listRecentDeveloperAccounts(
  limit = 6,
  executor?: Executor,
): Promise<DeveloperAccountDigest[]> {
  const db = getExecutor(executor);
  const safeLimit = Math.max(1, Math.min(20, Math.floor(limit)));
  const result = await db.query<DeveloperAccountDigestRow>(
    `
      SELECT
        u.id AS "userId",
        p.nickname AS nickname,
        identity.account AS account,
        identity.provider_uid AS "providerUid",
        identity.provider AS provider,
        u.status AS "userStatus",
        p.level AS level,
        p.best_mass AS "bestMass",
        p.total_matches AS "totalMatches",
        u.created_at AS "createdAt",
        u.last_login_at AS "lastLoginAt"
      FROM users u
      INNER JOIN user_profiles p ON p.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT
          provider::text AS provider,
          provider_uid,
          account
        FROM user_identities
        WHERE user_id = u.id
        ORDER BY
          CASE WHEN provider = 'password' THEN 0 ELSE 1 END,
          created_at ASC
        LIMIT 1
      ) identity ON TRUE
      WHERE u.status <> 'deleted'
      ORDER BY u.created_at DESC
      LIMIT $1
    `,
    [safeLimit],
  );

  return result.rows.map(mapDeveloperAccountDigest);
}

export async function findPasswordIdentityByAccount(
  account: string,
  executor?: Executor,
): Promise<PasswordIdentityRecord | null> {
  const db = getExecutor(executor);
  const result = await db.query<
    PasswordIdentityRecord & QueryResultRow
  >(
    `
      SELECT
        ui.user_id AS "userId",
        ui.account AS account,
        ui.password_hash AS "passwordHash",
        u.status AS "userStatus",
        COALESCE(b.is_banned, FALSE) AS banned,
        b.reason AS "banReason",
        b.banned_until AS "banUntil"
      FROM user_identities ui
      INNER JOIN users u ON u.id = ui.user_id
      LEFT JOIN user_bans b ON b.user_id = ui.user_id
      WHERE ui.provider = 'password'
        AND ui.account = $1
      LIMIT 1
    `,
    [normalizeAccount(account)],
  );

  return result.rows[0] ?? null;
}

export async function findIdentityByProviderUid(
  params: {
    provider: ProviderIdentityRecord["provider"];
    providerUid: string;
  },
  executor?: Executor,
): Promise<ProviderIdentityRecord | null> {
  const db = getExecutor(executor);
  const result = await db.query<
    ProviderIdentityRecord & QueryResultRow
  >(
    `
      SELECT
        ui.user_id AS "userId",
        ui.provider::text AS provider,
        ui.provider_uid AS "providerUid",
        ui.email AS email,
        ui.email_verified AS "emailVerified"
      FROM user_identities ui
      WHERE ui.provider = $1::provider_type
        AND ui.provider_uid = $2
      LIMIT 1
    `,
    [params.provider, params.providerUid],
  );

  return result.rows[0] ?? null;
}

export async function findVerifiedPhoneIdentity(
  phone: string,
  executor?: Executor,
): Promise<PhoneIdentityRecord | null> {
  const db = getExecutor(executor);
  const result = await db.query<
    PhoneIdentityRecord & QueryResultRow
  >(
    `
      SELECT
        ui.user_id AS "userId",
        ui.provider::text AS provider,
        ui.provider_uid AS "providerUid",
        ui.phone AS phone,
        ui.phone_verified AS "phoneVerified",
        u.status AS "userStatus",
        COALESCE(b.is_banned, FALSE) AS banned,
        b.reason AS "banReason",
        b.banned_until AS "banUntil"
      FROM user_identities ui
      INNER JOIN users u ON u.id = ui.user_id
      LEFT JOIN user_bans b ON b.user_id = ui.user_id
      WHERE ui.phone = $1
        AND ui.phone_verified = TRUE
      ORDER BY
        CASE WHEN ui.provider = 'phone' THEN 0 ELSE 1 END,
        ui.created_at ASC
      LIMIT 1
    `,
    [phone],
  );

  return result.rows[0] ?? null;
}

export async function createPasswordUser(
  params: {
    account: string;
    passwordHash: string;
    nickname?: string;
  },
  executor?: Executor,
): Promise<{ userId: string }> {
  const db = getExecutor(executor);
  const account = normalizeAccount(params.account);
  const nickname = normalizeNickname(params.nickname);

  const userResult = await db.query<{ id: string }>(
    `
      INSERT INTO users (status, created_at, updated_at, last_login_at)
      VALUES ('active', NOW(), NOW(), NOW())
      RETURNING id
    `,
  );
  const userId = userResult.rows[0]?.id;
  if (!userId) {
    throw new Error("failed to create user");
  }

  await db.query(
    `
      INSERT INTO user_profiles (
        user_id,
        nickname,
        avatar_url,
        level,
        current_xp,
        total_xp,
        coins,
        season_score,
        best_mass,
        total_matches,
        total_wins,
        created_at,
        updated_at
      )
      VALUES ($1, $2, NULL, 1, 0, 0, 0, 0, 0, 0, 0, NOW(), NOW())
    `,
    [userId, nickname],
  );

  await db.query(
    `
      INSERT INTO user_bans (
        user_id,
        is_banned,
        reason,
        banned_until,
        operator_note,
        created_at,
        updated_at
      )
      VALUES ($1, FALSE, NULL, NULL, NULL, NOW(), NOW())
      ON CONFLICT (user_id) DO NOTHING
    `,
    [userId],
  );

  await db.query(
    `
      INSERT INTO user_identities (
        user_id,
        provider,
        provider_uid,
        account,
        password_hash,
        password_algo,
        created_at,
        updated_at
      )
      VALUES ($1, 'password', $2, $2, $3, 'bcrypt', NOW(), NOW())
    `,
    [userId, account, params.passwordHash],
  );

  return { userId };
}

export async function createPhoneUser(
  params: {
    phone: string;
    nickname?: string;
  },
  executor?: Executor,
): Promise<{ userId: string }> {
  const db = getExecutor(executor);
  const nickname = normalizeNickname(params.nickname, "手机玩家");
  const phone = params.phone.trim();

  const userResult = await db.query<{ id: string }>(
    `
      INSERT INTO users (status, created_at, updated_at, last_login_at)
      VALUES ('active', NOW(), NOW(), NOW())
      RETURNING id
    `,
  );
  const userId = userResult.rows[0]?.id;
  if (!userId) {
    throw new Error("failed to create phone user");
  }

  await db.query(
    `
      INSERT INTO user_profiles (
        user_id,
        nickname,
        avatar_url,
        level,
        current_xp,
        total_xp,
        coins,
        season_score,
        best_mass,
        total_matches,
        total_wins,
        created_at,
        updated_at
      )
      VALUES ($1, $2, NULL, 1, 0, 0, 0, 0, 0, 0, 0, NOW(), NOW())
    `,
    [userId, nickname],
  );

  await db.query(
    `
      INSERT INTO user_bans (
        user_id,
        is_banned,
        reason,
        banned_until,
        operator_note,
        created_at,
        updated_at
      )
      VALUES ($1, FALSE, NULL, NULL, NULL, NOW(), NOW())
      ON CONFLICT (user_id) DO NOTHING
    `,
    [userId],
  );

  await db.query(
    `
      INSERT INTO user_identities (
        user_id,
        provider,
        provider_uid,
        phone,
        phone_verified,
        created_at,
        updated_at
      )
      VALUES ($1, 'phone', $2, $2, TRUE, NOW(), NOW())
    `,
    [userId, phone],
  );

  return { userId };
}

async function findUnusedEmail(
  email: string | null | undefined,
  executor?: Executor,
): Promise<string | null> {
  const normalized = sanitizeNullableText(email);
  if (!normalized) {
    return null;
  }

  const db = getExecutor(executor);
  const existing = await db.query<{ userId: string } & QueryResultRow>(
    `
      SELECT user_id AS "userId"
      FROM user_identities
      WHERE email = $1
      LIMIT 1
    `,
    [normalized],
  );

  return existing.rows[0] ? null : normalized;
}

export async function createPlatformUser(
  params: {
    providerUid: string;
    nickname?: string;
    avatarUrl?: string | null;
    email?: string | null;
    emailVerified?: boolean;
  },
  executor?: Executor,
): Promise<{ userId: string }> {
  const db = getExecutor(executor);
  const nickname = normalizeNickname(params.nickname);
  const safeEmail = await findUnusedEmail(params.email, db);

  const userResult = await db.query<{ id: string }>(
    `
      INSERT INTO users (status, created_at, updated_at, last_login_at)
      VALUES ('active', NOW(), NOW(), NOW())
      RETURNING id
    `,
  );
  const userId = userResult.rows[0]?.id;
  if (!userId) {
    throw new Error("failed to create platform user");
  }

  await db.query(
    `
      INSERT INTO user_profiles (
        user_id,
        nickname,
        avatar_url,
        level,
        current_xp,
        total_xp,
        coins,
        season_score,
        best_mass,
        total_matches,
        total_wins,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, 1, 0, 0, 0, 0, 0, 0, 0, NOW(), NOW())
    `,
    [userId, nickname, sanitizeNullableText(params.avatarUrl)],
  );

  await db.query(
    `
      INSERT INTO user_bans (
        user_id,
        is_banned,
        reason,
        banned_until,
        operator_note,
        created_at,
        updated_at
      )
      VALUES ($1, FALSE, NULL, NULL, NULL, NOW(), NOW())
      ON CONFLICT (user_id) DO NOTHING
    `,
    [userId],
  );

  await db.query(
    `
      INSERT INTO user_identities (
        user_id,
        provider,
        provider_uid,
        email,
        email_verified,
        created_at,
        updated_at
      )
      VALUES ($1, 'platform', $2, $3, $4, NOW(), NOW())
    `,
    [userId, params.providerUid, safeEmail, params.emailVerified ?? false],
  );

  return { userId };
}

export async function syncPlatformIdentity(
  params: {
    userId: string;
    providerUid: string;
    avatarUrl?: string | null;
    email?: string | null;
    emailVerified?: boolean;
  },
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  const safeEmail = await findUnusedEmail(params.email, db);

  await db.query(
    `
      UPDATE user_identities
      SET
        email = COALESCE($3, email),
        email_verified = CASE
          WHEN $4 THEN TRUE
          ELSE email_verified
        END,
        updated_at = NOW()
      WHERE user_id = $1
        AND provider = 'platform'
        AND provider_uid = $2
    `,
    [params.userId, params.providerUid, safeEmail, params.emailVerified ?? false],
  );

  if (params.avatarUrl !== undefined) {
    await db.query(
      `
        UPDATE user_profiles
        SET
          avatar_url = $2,
          updated_at = NOW()
        WHERE user_id = $1
      `,
      [params.userId, sanitizeNullableText(params.avatarUrl)],
    );
  }
}

export async function bindPhoneIdentityToUser(
  params: {
    userId: string;
    phone: string;
  },
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  const phone = params.phone.trim();

  const updated = await db.query(
    `
      UPDATE user_identities
      SET
        phone = $2,
        phone_verified = TRUE,
        updated_at = NOW()
      WHERE user_id = $1
        AND provider = 'phone'
    `,
    [params.userId, phone],
  );

  if ((updated.rowCount ?? 0) > 0) {
    return;
  }

  await db.query(
    `
      INSERT INTO user_identities (
        user_id,
        provider,
        provider_uid,
        phone,
        phone_verified,
        created_at,
        updated_at
      )
      VALUES ($1, 'phone', $2, $2, TRUE, NOW(), NOW())
    `,
    [params.userId, phone],
  );
}

export async function bindEmailToUser(
  params: {
    userId: string;
    email: string;
  },
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  const email = params.email.trim().toLowerCase();
  const result = await db.query(
    `
      WITH target_identity AS (
        SELECT id
        FROM user_identities
        WHERE user_id = $1
        ORDER BY
          CASE
            WHEN provider = 'password' THEN 0
            WHEN provider = 'phone' THEN 1
            ELSE 2
          END,
          created_at ASC
        LIMIT 1
      )
      UPDATE user_identities ui
      SET
        email = $2,
        email_verified = TRUE,
        updated_at = NOW()
      FROM target_identity ti
      WHERE ui.id = ti.id
    `,
    [params.userId, email],
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error("no identity available for email binding");
  }
}

export async function touchUserLogin(
  userId: string,
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  await db.query(
    `
      UPDATE users
      SET updated_at = NOW(), last_login_at = NOW()
      WHERE id = $1
    `,
    [userId],
  );
}

function normalizePlatform(
  platform: DeviceInfo["platform"] | undefined,
): SessionRecord["platform"] {
  if (
    platform === "web" ||
    platform === "android" ||
    platform === "ios" ||
    platform === "windows" ||
    platform === "macos" ||
    platform === "linux"
  ) {
    return platform;
  }
  return "unknown";
}

export async function upsertAuthSession(
  params: {
    userId: string;
    device: DeviceInfo;
  },
  executor?: Executor,
): Promise<SessionRecord> {
  const db = getExecutor(executor);
  const result = await db.query<
    {
      sessionId: string;
      userId: string;
      deviceId: string;
      platform: SessionRecord["platform"];
      appVersion: string | null;
      ip: string | null;
      userAgent: string | null;
      createdAt: string;
      lastSeenAt: string;
      revokedAt: string | null;
    } & QueryResultRow
  >(
    `
      INSERT INTO auth_sessions (
        user_id,
        device_id,
        device_name,
        platform,
        app_version,
        ip,
        user_agent,
        created_at,
        last_seen_at,
        revoked_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4::device_platform,
        $5,
        NULLIF($6, '')::inet,
        $7,
        NOW(),
        NOW(),
        NULL
      )
      ON CONFLICT (user_id, device_id) DO UPDATE
      SET
        device_name = EXCLUDED.device_name,
        platform = EXCLUDED.platform,
        app_version = EXCLUDED.app_version,
        ip = EXCLUDED.ip,
        user_agent = EXCLUDED.user_agent,
        last_seen_at = NOW(),
        revoked_at = NULL
      RETURNING
        id AS "sessionId",
        user_id AS "userId",
        device_id AS "deviceId",
        platform::text AS platform,
        app_version AS "appVersion",
        host(ip) AS ip,
        user_agent AS "userAgent",
        created_at AS "createdAt",
        last_seen_at AS "lastSeenAt",
        revoked_at AS "revokedAt"
    `,
    [
      params.userId,
      params.device.deviceId,
      sanitizeNullableText(params.device.deviceModel),
      normalizePlatform(params.device.platform),
      params.device.appVersion,
      sanitizeNullableText(params.device.ip),
      sanitizeNullableText(params.device.userAgent),
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("failed to upsert session");
  }

  return {
    sessionId: row.sessionId,
    userId: row.userId,
    deviceId: row.deviceId,
    platform: row.platform,
    appVersion: row.appVersion ?? "0.0.0",
    ip: row.ip,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
  };
}

export async function revokeSessionTokens(
  sessionId: string,
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  await db.query(
    `
      UPDATE auth_refresh_tokens
      SET revoked_at = NOW()
      WHERE session_id = $1
        AND revoked_at IS NULL
    `,
    [sessionId],
  );
}

export async function insertRefreshToken(
  params: {
    sessionId: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: string;
  },
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  await db.query(
    `
      INSERT INTO auth_refresh_tokens (
        session_id,
        user_id,
        refresh_token_hash,
        issued_at,
        expires_at,
        revoked_at
      )
      VALUES ($1, $2, $3, NOW(), $4, NULL)
    `,
    [params.sessionId, params.userId, params.refreshTokenHash, params.expiresAt],
  );
}

export async function findRefreshTokenByHash(
  refreshTokenHash: string,
  executor?: Executor,
): Promise<RefreshTokenRecord | null> {
  const db = getExecutor(executor);
  const result = await db.query<
    {
      refreshTokenId: string;
      sessionId: string;
      userId: string;
      expiresAt: string;
      revokedAt: string | null;
      sessionRevokedAt: string | null;
      deviceId: string;
      platform: SessionRecord["platform"];
      appVersion: string | null;
    } & QueryResultRow
  >(
    `
      SELECT
        t.id AS "refreshTokenId",
        t.session_id AS "sessionId",
        t.user_id AS "userId",
        t.expires_at AS "expiresAt",
        t.revoked_at AS "revokedAt",
        s.revoked_at AS "sessionRevokedAt",
        s.device_id AS "deviceId",
        s.platform::text AS platform,
        s.app_version AS "appVersion"
      FROM auth_refresh_tokens t
      INNER JOIN auth_sessions s ON s.id = t.session_id
      WHERE t.refresh_token_hash = $1
      LIMIT 1
    `,
    [refreshTokenHash],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    refreshTokenId: row.refreshTokenId,
    sessionId: row.sessionId,
    userId: row.userId,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    sessionRevokedAt: row.sessionRevokedAt,
    deviceId: row.deviceId,
    platform: row.platform,
    appVersion: row.appVersion ?? "0.0.0",
  };
}

export async function revokeRefreshTokenById(
  refreshTokenId: string,
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  await db.query(
    `
      UPDATE auth_refresh_tokens
      SET revoked_at = NOW()
      WHERE id = $1
        AND revoked_at IS NULL
    `,
    [refreshTokenId],
  );
}

export async function getActiveSessionById(
  sessionId: string,
  executor?: Executor,
): Promise<SessionRecord | null> {
  const db = getExecutor(executor);
  const result = await db.query<
    {
      sessionId: string;
      userId: string;
      deviceId: string;
      platform: SessionRecord["platform"];
      appVersion: string | null;
      ip: string | null;
      userAgent: string | null;
      createdAt: string;
      lastSeenAt: string;
      revokedAt: string | null;
    } & QueryResultRow
  >(
    `
      SELECT
        id AS "sessionId",
        user_id AS "userId",
        device_id AS "deviceId",
        platform::text AS platform,
        app_version AS "appVersion",
        host(ip) AS ip,
        user_agent AS "userAgent",
        created_at AS "createdAt",
        last_seen_at AS "lastSeenAt",
        revoked_at AS "revokedAt"
      FROM auth_sessions
      WHERE id = $1
      LIMIT 1
    `,
    [sessionId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    sessionId: row.sessionId,
    userId: row.userId,
    deviceId: row.deviceId,
    platform: row.platform,
    appVersion: row.appVersion ?? "0.0.0",
    ip: row.ip,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
  };
}

export async function markSessionSeen(
  sessionId: string,
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  await db.query(
    `
      UPDATE auth_sessions
      SET last_seen_at = NOW()
      WHERE id = $1
    `,
    [sessionId],
  );
}

export async function revokeSessionById(
  sessionId: string,
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  await db.query(
    `
      UPDATE auth_sessions
      SET revoked_at = NOW()
      WHERE id = $1
        AND revoked_at IS NULL
    `,
    [sessionId],
  );
  await revokeSessionTokens(sessionId, db);
}

export async function revokeAllSessionsByUserId(
  userId: string,
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  await db.query(
    `
      UPDATE auth_sessions
      SET revoked_at = NOW()
      WHERE user_id = $1
        AND revoked_at IS NULL
    `,
    [userId],
  );
  await db.query(
    `
      UPDATE auth_refresh_tokens
      SET revoked_at = NOW()
      WHERE user_id = $1
        AND revoked_at IS NULL
    `,
    [userId],
  );
}

export async function listActiveSessionsByUserId(
  userId: string,
  executor?: Executor,
): Promise<DeviceSession[]> {
  const db = getExecutor(executor);
  const result = await db.query<
    {
      sessionId: string;
      deviceId: string;
      platform: DeviceSession["platform"];
      appVersion: string | null;
      ip: string | null;
      userAgent: string | null;
      createdAt: string;
      lastSeenAt: string;
    } & QueryResultRow
  >(
    `
      SELECT
        id AS "sessionId",
        device_id AS "deviceId",
        platform::text AS platform,
        app_version AS "appVersion",
        host(ip) AS ip,
        user_agent AS "userAgent",
        created_at AS "createdAt",
        last_seen_at AS "lastSeenAt"
      FROM auth_sessions
      WHERE user_id = $1
        AND revoked_at IS NULL
      ORDER BY last_seen_at DESC
    `,
    [userId],
  );

  return result.rows.map((row) => ({
    sessionId: row.sessionId,
    deviceId: row.deviceId,
    platform: row.platform,
    appVersion: row.appVersion ?? "0.0.0",
    ip: row.ip ?? undefined,
    userAgent: row.userAgent ?? undefined,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    current: false,
  }));
}

export async function updateUserProfile(
  params: {
    userId: string;
    nickname?: string;
    avatarUrl?: string | null;
    setAvatarUrl?: boolean;
  },
  executor?: Executor,
): Promise<UserProfile | null> {
  const db = getExecutor(executor);
  await db.query(
    `
      UPDATE user_profiles
      SET
        nickname = COALESCE($2, nickname),
        avatar_url = CASE
          WHEN $4 = FALSE THEN avatar_url
          ELSE $3
        END,
        updated_at = NOW()
      WHERE user_id = $1
    `,
    [
      params.userId,
      params.nickname ?? null,
      params.avatarUrl ?? null,
      params.setAvatarUrl ?? false,
    ],
  );

  const summary = await getUserSummaryById(params.userId, db);
  return summary?.summary.profile ?? null;
}

export async function applyBootstrapFromLocal(
  params: {
    userId: string;
    nickname?: string;
    avatarUrl?: string | null;
    progression: {
      level: number;
      currentXp: number;
      totalXp: number;
      coins: number;
      totalMatches: number;
      totalWins: number;
      bestMass: number;
    };
  },
  executor?: Executor,
): Promise<boolean> {
  const db = getExecutor(executor);
  const result = await db.query(
    `
      UPDATE user_profiles
      SET
        nickname = COALESCE($2, nickname),
        avatar_url = CASE
          WHEN $3::text IS NULL THEN avatar_url
          ELSE $3
        END,
        level = GREATEST(level, $4),
        current_xp = GREATEST(current_xp, $5),
        total_xp = GREATEST(total_xp, $6),
        coins = GREATEST(coins, $7),
        total_matches = GREATEST(total_matches, $8),
        total_wins = GREATEST(total_wins, $9),
        best_mass = GREATEST(best_mass, $10),
        bootstrapped_from_local_at = NOW(),
        updated_at = NOW()
      WHERE user_id = $1
        AND bootstrapped_from_local_at IS NULL
    `,
    [
      params.userId,
      params.nickname ?? null,
      params.avatarUrl ?? null,
      params.progression.level,
      params.progression.currentXp,
      params.progression.totalXp,
      params.progression.coins,
      params.progression.totalMatches,
      params.progression.totalWins,
      params.progression.bestMass,
    ],
  );

  return (result.rowCount ?? 0) > 0;
}

export async function overwriteUserProgression(
  params: {
    userId: string;
    progression: {
      level: number;
      currentXp: number;
      totalXp: number;
      coins: number;
      totalMatches: number;
      totalWins: number;
      bestMass: number;
    };
  },
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  await db.query(
    `
      UPDATE user_profiles
      SET
        level = $2,
        current_xp = $3,
        total_xp = $4,
        coins = $5,
        total_matches = $6,
        total_wins = $7,
        best_mass = $8,
        updated_at = NOW()
      WHERE user_id = $1
    `,
    [
      params.userId,
      params.progression.level,
      params.progression.currentXp,
      params.progression.totalXp,
      params.progression.coins,
      params.progression.totalMatches,
      params.progression.totalWins,
      params.progression.bestMass,
    ],
  );
}

export async function updatePasswordHashForUser(
  userId: string,
  passwordHash: string,
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  await db.query(
    `
      UPDATE user_identities
      SET
        password_hash = $2,
        password_algo = 'bcrypt',
        updated_at = NOW()
      WHERE user_id = $1
        AND provider = 'password'
    `,
    [userId, passwordHash],
  );
}
