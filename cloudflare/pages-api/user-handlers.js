import { PROTOCOL_ERROR } from "./constants.js";
import { getDbOrResponse, dbRun } from "./db.js";
import {
  failure,
  normalizeNickname,
  nowIso,
  readJson,
  success,
  validateAvatarUrl,
  validateNickname,
  sanitizePlayerProgression,
  clampNonNegativeInteger,
} from "./helpers.js";
import { requireAuth } from "./auth-handlers.js";
import {
  getDeveloperAccountDigestByUserId,
  getDeveloperAccountStats,
  getPublicUserCardById,
  getUserSummaryById,
  listRecentDeveloperAccounts,
} from "./user-store.js";

export async function handleGetMe(request, env, requestId) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const summary = await getUserSummaryById(required.auth.db, required.auth.userId);
  if (!summary) {
    return failure(
      request,
      requestId,
      404,
      PROTOCOL_ERROR.USER_NOT_FOUND,
      "User not found.",
    );
  }

  return success(request, requestId, { summary: summary.summary });
}

export async function handleBootstrap(request, env, requestId) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const body = await readJson(request);
  if (!body || body.source !== "local_storage") {
    return failure(
      request,
      requestId,
      400,
      PROTOCOL_ERROR.INVALID_REQUEST,
      "source must be local_storage.",
      { field: "source" },
    );
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

  let migrationApplied = false;
  if (!current.bootstrappedFromLocalAt) {
    const nextNickname =
      body.nickname === undefined
        ? current.summary.profile.nickname
        : normalizeNickname(body.nickname, current.summary.profile.nickname);
    const nextAvatar =
      body.avatarUrl === undefined
        ? current.summary.profile.avatarUrl
        : validateAvatarUrl(body.avatarUrl);

    if (nextAvatar === undefined) {
      return failure(
        request,
        requestId,
        400,
        PROTOCOL_ERROR.USER_INVALID_AVATAR,
        "avatarUrl is invalid.",
      );
    }

    const progression = sanitizePlayerProgression(body.progression);
    const timestamp = nowIso();
    await dbRun(
      required.auth.db,
      `
        UPDATE user_profiles
        SET
          nickname = ?,
          avatar_url = ?,
          bootstrapped_from_local_at = ?,
          level = ?,
          current_xp = ?,
          total_xp = ?,
          coins = ?,
          best_mass = ?,
          total_matches = ?,
          total_wins = ?,
          updated_at = ?
        WHERE user_id = ?
      `,
      [
        nextNickname,
        nextAvatar,
        timestamp,
        progression.level,
        progression.currentXp,
        progression.totalXp,
        progression.coins,
        progression.bestMass,
        progression.totalMatches,
        progression.totalWins,
        timestamp,
        required.auth.userId,
      ],
    );
    migrationApplied = true;
  }

  const summary = await getUserSummaryById(required.auth.db, required.auth.userId);
  return success(request, requestId, {
    summary: summary.summary,
    migrationApplied,
  });
}

export async function handleUpdateProfile(request, env, requestId) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const body = (await readJson(request)) || {};
  const nickname =
    body.nickname === undefined ? undefined : validateNickname(body.nickname);
  if (body.nickname !== undefined && nickname === null) {
    return failure(
      request,
      requestId,
      400,
      PROTOCOL_ERROR.USER_INVALID_NAME,
      "Nickname is invalid.",
    );
  }

  let avatarUrl = undefined;
  if (body.avatarUrl !== undefined) {
    avatarUrl = validateAvatarUrl(body.avatarUrl);
    if (avatarUrl === undefined) {
      return failure(
        request,
        requestId,
        400,
        PROTOCOL_ERROR.USER_INVALID_AVATAR,
        "avatarUrl is invalid.",
      );
    }
  }

  const current = await getUserSummaryById(required.auth.db, required.auth.userId);
  if (!current) {
    return failure(
      request,
      requestId,
      404,
      PROTOCOL_ERROR.USER_NOT_FOUND,
      "User profile not found.",
    );
  }

  await dbRun(
    required.auth.db,
    `
      UPDATE user_profiles
      SET
        nickname = ?,
        avatar_url = ?,
        updated_at = ?
      WHERE user_id = ?
    `,
    [
      nickname ?? current.summary.profile.nickname,
      avatarUrl !== undefined ? avatarUrl : current.summary.profile.avatarUrl,
      nowIso(),
      required.auth.userId,
    ],
  );

  const updated = await getUserSummaryById(required.auth.db, required.auth.userId);
  return success(request, requestId, {
    profile: updated.summary.profile,
  });
}

export async function handleDeveloperAccountsOverview(request, env, requestId) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const [stats, currentAccount, recentAccounts] = await Promise.all([
    getDeveloperAccountStats(required.auth.db),
    getDeveloperAccountDigestByUserId(required.auth.db, required.auth.userId),
    listRecentDeveloperAccounts(required.auth.db, 6),
  ]);

  return success(request, requestId, {
    overview: {
      stats,
      currentAccount,
      recentAccounts,
    },
  });
}

export async function handleGetPublicUser(request, env, requestId, userId) {
  const { db, response } = await getDbOrResponse(request, env, requestId);
  if (!db) {
    return response;
  }

  const card = await getPublicUserCardById(db, userId);
  if (!card) {
    return failure(
      request,
      requestId,
      404,
      PROTOCOL_ERROR.USER_NOT_FOUND,
      "User not found.",
    );
  }

  return success(request, requestId, {
    user: {
      userId: card.user_id,
      nickname: card.nickname,
      avatarUrl: card.avatar_url || null,
      level: clampNonNegativeInteger(card.level, 1),
      bestMass: clampNonNegativeInteger(card.best_mass, 0),
      seasonScore: clampNonNegativeInteger(card.season_score, 0),
    },
  });
}
