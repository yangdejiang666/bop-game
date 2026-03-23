import {
  ACCESS_TOKEN_TTL_SECONDS,
  ACCOUNT_MAX,
  ACCOUNT_MIN,
  PASSWORD_MAX,
  PASSWORD_MIN,
  PROTOCOL_ERROR,
  REFRESH_TOKEN_TTL_SECONDS,
} from "./constants.js";
import { createOpaqueToken, hashPassword, sha256Hex, verifyPassword } from "./crypto.js";
import { dbBatch, dbFirst, dbRun, getDbOrResponse, isUniqueConstraintError } from "./db.js";
import {
  failure,
  normalizeAccount,
  normalizeNickname,
  nowIso,
  numericEnv,
  readJson,
  success,
} from "./helpers.js";
import { buildAuthUser, findPasswordIdentityByAccount, getUserSummaryById } from "./user-store.js";

function sanitizePlatform(value) {
  const allowed = new Set([
    "web",
    "android",
    "ios",
    "windows",
    "macos",
    "linux",
    "unknown",
  ]);
  return allowed.has(value) ? value : "web";
}

export function readDeviceInfo(request, bodyDevice) {
  const device = bodyDevice && typeof bodyDevice === "object" ? bodyDevice : {};
  const deviceId =
    typeof device.deviceId === "string" && device.deviceId.trim()
      ? device.deviceId.trim()
      : request.headers.get("x-device-id")?.trim() || "web-default-device";
  const appVersion =
    typeof device.appVersion === "string" && device.appVersion.trim()
      ? device.appVersion.trim()
      : request.headers.get("x-app-version")?.trim() || "0.1.0";

  return {
    deviceId,
    platform: sanitizePlatform(device.platform),
    appVersion,
    osVersion:
      typeof device.osVersion === "string" ? device.osVersion : undefined,
    deviceModel:
      typeof device.deviceModel === "string" ? device.deviceModel : undefined,
    ip:
      request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-forwarded-for") ||
      undefined,
    userAgent: request.headers.get("user-agent") || undefined,
  };
}

async function upsertAuthSession(db, userId, device) {
  const existing = await dbFirst(
    db,
    `
      SELECT session_id
      FROM auth_sessions
      WHERE user_id = ? AND device_id = ?
      LIMIT 1
    `,
    [userId, device.deviceId],
  );

  const timestamp = nowIso();
  if (existing?.session_id) {
    await dbRun(
      db,
      `
        UPDATE auth_sessions
        SET
          platform = ?,
          app_version = ?,
          ip = ?,
          user_agent = ?,
          last_seen_at = ?,
          revoked_at = NULL
        WHERE session_id = ?
      `,
      [
        device.platform,
        device.appVersion,
        device.ip || null,
        device.userAgent || null,
        timestamp,
        existing.session_id,
      ],
    );
    return existing.session_id;
  }

  const sessionId = `sess_${crypto.randomUUID().replaceAll("-", "")}`;
  await dbRun(
    db,
    `
      INSERT INTO auth_sessions (
        session_id,
        user_id,
        device_id,
        platform,
        app_version,
        ip,
        user_agent,
        created_at,
        last_seen_at,
        revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `,
    [
      sessionId,
      userId,
      device.deviceId,
      device.platform,
      device.appVersion,
      device.ip || null,
      device.userAgent || null,
      timestamp,
      timestamp,
    ],
  );
  return sessionId;
}

async function revokeSessionTokens(db, sessionId, revokedAt = nowIso()) {
  await dbBatch(db, [
    {
      sql: "UPDATE auth_access_tokens SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL",
      params: [revokedAt, sessionId],
    },
    {
      sql: "UPDATE auth_refresh_tokens SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL",
      params: [revokedAt, sessionId],
    },
  ]);
}

async function issueTokenPair(db, env, userId, device, existingSessionId = null) {
  const sessionId =
    existingSessionId || (await upsertAuthSession(db, userId, device));
  const accessToken = createOpaqueToken("atk");
  const refreshToken = createOpaqueToken("rtk");
  const accessTokenHash = await sha256Hex(accessToken);
  const refreshTokenHash = await sha256Hex(refreshToken);
  const accessExpiresIn = numericEnv(
    env?.ACCESS_TOKEN_TTL_SECONDS,
    ACCESS_TOKEN_TTL_SECONDS,
  );
  const refreshExpiresIn = numericEnv(
    env?.REFRESH_TOKEN_TTL_SECONDS,
    REFRESH_TOKEN_TTL_SECONDS,
  );
  const issuedAt = nowIso();
  const accessExpiresAt = new Date(
    Date.now() + accessExpiresIn * 1000,
  ).toISOString();
  const refreshExpiresAt = new Date(
    Date.now() + refreshExpiresIn * 1000,
  ).toISOString();

  await revokeSessionTokens(db, sessionId, issuedAt);
  await dbBatch(db, [
    {
      sql: `
        INSERT INTO auth_access_tokens (
          access_token_hash,
          session_id,
          user_id,
          expires_at,
          revoked_at,
          created_at
        ) VALUES (?, ?, ?, ?, NULL, ?)
      `,
      params: [accessTokenHash, sessionId, userId, accessExpiresAt, issuedAt],
    },
    {
      sql: `
        INSERT INTO auth_refresh_tokens (
          refresh_token_hash,
          session_id,
          user_id,
          expires_at,
          revoked_at,
          created_at
        ) VALUES (?, ?, ?, ?, NULL, ?)
      `,
      params: [refreshTokenHash, sessionId, userId, refreshExpiresAt, issuedAt],
    },
  ]);

  return {
    sessionId,
    tokens: {
      accessToken,
      refreshToken,
      expiresIn: accessExpiresIn,
      refreshExpiresIn,
      tokenType: "Bearer",
    },
  };
}

export async function requireAuth(request, env, requestId) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return {
      auth: null,
      response: failure(
        request,
        requestId,
        401,
        PROTOCOL_ERROR.UNAUTHORIZED,
        "Missing bearer token.",
      ),
    };
  }

  const { db, response } = await getDbOrResponse(request, env, requestId);
  if (!db) {
    return { auth: null, response };
  }

  const tokenHash = await sha256Hex(token);
  const row = await dbFirst(
    db,
    `
      SELECT
        t.user_id,
        t.session_id,
        t.expires_at,
        t.revoked_at,
        s.revoked_at AS session_revoked_at
      FROM auth_access_tokens t
      INNER JOIN auth_sessions s ON s.session_id = t.session_id
      WHERE t.access_token_hash = ?
      LIMIT 1
    `,
    [tokenHash],
  );

  if (!row) {
    return {
      auth: null,
      response: failure(
        request,
        requestId,
        401,
        PROTOCOL_ERROR.UNAUTHORIZED,
        "Invalid access token.",
      ),
    };
  }

  if (row.revoked_at || row.session_revoked_at || Date.parse(row.expires_at) <= Date.now()) {
    return {
      auth: null,
      response: failure(
        request,
        requestId,
        401,
        PROTOCOL_ERROR.AUTH_TOKEN_EXPIRED,
        "Access token expired.",
      ),
    };
  }

  await dbRun(
    db,
    "UPDATE auth_sessions SET last_seen_at = ? WHERE session_id = ?",
    [nowIso(), row.session_id],
  );

  return {
    auth: {
      userId: row.user_id,
      sessionId: row.session_id,
      db,
    },
    response: null,
  };
}

export async function handleRegister(request, env, requestId) {
  let step = "bootstrap-db";

  try {
    const { db, response } = await getDbOrResponse(request, env, requestId);
    if (!db) {
      return response;
    }

    step = "parse-body";
    const body = await readJson(request);
    if (
      !body ||
      typeof body.account !== "string" ||
      typeof body.password !== "string"
    ) {
      return failure(
        request,
        requestId,
        400,
        PROTOCOL_ERROR.INVALID_REQUEST,
        "account and password are required.",
        { field: "account/password" },
      );
    }

    step = "validate-input";
    const account = normalizeAccount(body.account);
    if (account.length < ACCOUNT_MIN || account.length > ACCOUNT_MAX) {
      return failure(
        request,
        requestId,
        400,
        PROTOCOL_ERROR.INVALID_REQUEST,
        `account length must be ${ACCOUNT_MIN}~${ACCOUNT_MAX}.`,
        { field: "account" },
      );
    }

    if (
      body.password.length < PASSWORD_MIN ||
      body.password.length > PASSWORD_MAX
    ) {
      return failure(
        request,
        requestId,
        400,
        PROTOCOL_ERROR.INVALID_REQUEST,
        `password length must be ${PASSWORD_MIN}~${PASSWORD_MAX}.`,
        { field: "password" },
      );
    }

    step = "check-existing";
    const existing = await findPasswordIdentityByAccount(db, account);
    if (existing) {
      return failure(
        request,
        requestId,
        409,
        PROTOCOL_ERROR.CONFLICT,
        "account already exists.",
        { field: "account" },
      );
    }

    const userId = `user_${crypto.randomUUID().replaceAll("-", "")}`;
    const identityId = `identity_${crypto.randomUUID().replaceAll("-", "")}`;
    const timestamp = nowIso();

    step = "hash-password";
    const passwordHash = await hashPassword(body.password);
    const nickname = normalizeNickname(body.nickname);

    step = "insert-user";
    try {
      await dbBatch(db, [
        {
          sql: `
            INSERT INTO users (id, status, created_at, updated_at, last_login_at)
            VALUES (?, 'active', ?, ?, NULL)
          `,
          params: [userId, timestamp, timestamp],
        },
        {
          sql: `
            INSERT INTO user_identities (
              id,
              user_id,
              provider,
              provider_uid,
              account,
              password_hash,
              password_algo,
              email,
              phone,
              email_verified,
              phone_verified,
              bound_at,
              created_at,
              updated_at
            ) VALUES (?, ?, 'password', ?, ?, ?, 'pbkdf2_sha256', NULL, NULL, 0, 0, ?, ?, ?)
          `,
          params: [
            identityId,
            userId,
            account,
            account,
            passwordHash,
            timestamp,
            timestamp,
            timestamp,
          ],
        },
        {
          sql: `
            INSERT INTO user_profiles (
              user_id,
              nickname,
              avatar_url,
              bootstrapped_from_local_at,
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
            ) VALUES (?, ?, NULL, NULL, 1, 0, 0, 0, 0, 0, 0, 0, ?, ?)
          `,
          params: [userId, nickname, timestamp, timestamp],
        },
      ]);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return failure(
          request,
          requestId,
          409,
          PROTOCOL_ERROR.CONFLICT,
          "account already exists.",
          { field: "account" },
        );
      }
      throw error;
    }

    step = "issue-tokens";
    const device = readDeviceInfo(request, body.device);
    const issued = await issueTokenPair(db, env, userId, device);

    step = "update-login-time";
    await dbRun(
      db,
      "UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?",
      [timestamp, timestamp, userId],
    );

    step = "load-summary";
    const summary = await getUserSummaryById(db, userId);

    step = "success-response";
    return success(
      request,
      requestId,
      {
        user: buildAuthUser(summary),
        tokens: issued.tokens,
        isNewUser: true,
      },
      201,
    );
  } catch (error) {
    return failure(
      request,
      requestId,
      500,
      PROTOCOL_ERROR.UNKNOWN,
      `REGISTER_FAILED[${step}]: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function handleLogin(request, env, requestId) {
  const { db, response } = await getDbOrResponse(request, env, requestId);
  if (!db) {
    return response;
  }

  const body = await readJson(request);
  if (!body || body.method !== "password" || typeof body.payload !== "object") {
    return failure(
      request,
      requestId,
      400,
      PROTOCOL_ERROR.INVALID_REQUEST,
      "Only password login is enabled.",
      { field: "method" },
    );
  }

  const account = normalizeAccount(body.payload.account);
  const password =
    typeof body.payload.password === "string" ? body.payload.password : "";
  if (!account || !password) {
    return failure(
      request,
      requestId,
      400,
      PROTOCOL_ERROR.INVALID_REQUEST,
      "account and password are required.",
      { field: "payload.account/password" },
    );
  }

  const identity = await findPasswordIdentityByAccount(db, account);
  if (!identity || !(await verifyPassword(password, identity.password_hash))) {
    return failure(
      request,
      requestId,
      401,
      PROTOCOL_ERROR.AUTH_INVALID_CREDENTIALS,
      "invalid credentials.",
    );
  }

  if (identity.user_status !== "active") {
    return failure(
      request,
      requestId,
      403,
      PROTOCOL_ERROR.AUTH_ACCOUNT_BANNED,
      "account is banned.",
    );
  }

  const device = readDeviceInfo(request, body.payload.device);
  const issued = await issueTokenPair(db, env, identity.user_id, device);
  const timestamp = nowIso();
  await dbRun(db, "UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?", [
    timestamp,
    timestamp,
    identity.user_id,
  ]);
  const summary = await getUserSummaryById(db, identity.user_id);

  return success(request, requestId, {
    user: buildAuthUser(summary),
    tokens: issued.tokens,
    method: "password",
    isNewUser: false,
    serverTime: timestamp,
    riskMeta: {
      riskLevel: "low",
      requiresVerification: false,
      reasonCodes: [],
    },
  });
}

export async function handleRefresh(request, env, requestId) {
  const { db, response } = await getDbOrResponse(request, env, requestId);
  if (!db) {
    return response;
  }

  const body = await readJson(request);
  const refreshToken =
    body && typeof body.refreshToken === "string" ? body.refreshToken.trim() : "";
  if (!refreshToken) {
    return failure(
      request,
      requestId,
      400,
      PROTOCOL_ERROR.INVALID_REQUEST,
      "refreshToken is required.",
      { field: "refreshToken" },
    );
  }

  const refreshTokenHash = await sha256Hex(refreshToken);
  const row = await dbFirst(
    db,
    `
      SELECT
        rt.refresh_token_hash,
        rt.session_id,
        rt.user_id,
        rt.expires_at,
        rt.revoked_at,
        s.device_id,
        s.platform,
        s.app_version,
        s.ip,
        s.user_agent,
        s.revoked_at AS session_revoked_at
      FROM auth_refresh_tokens rt
      INNER JOIN auth_sessions s ON s.session_id = rt.session_id
      WHERE rt.refresh_token_hash = ?
      LIMIT 1
    `,
    [refreshTokenHash],
  );

  if (!row || row.revoked_at || row.session_revoked_at) {
    return failure(
      request,
      requestId,
      401,
      PROTOCOL_ERROR.AUTH_REFRESH_TOKEN_INVALID,
      "refresh token invalid or expired.",
    );
  }

  if (
    body?.device?.deviceId &&
    String(body.device.deviceId).trim() &&
    String(body.device.deviceId).trim() !== row.device_id
  ) {
    return failure(
      request,
      requestId,
      401,
      PROTOCOL_ERROR.AUTH_REFRESH_TOKEN_INVALID,
      "refresh token invalid or expired.",
    );
  }

  if (Date.parse(row.expires_at) <= Date.now()) {
    return failure(
      request,
      requestId,
      401,
      PROTOCOL_ERROR.AUTH_TOKEN_EXPIRED,
      "refresh token invalid or expired.",
    );
  }

  const issued = await issueTokenPair(
    db,
    env,
    row.user_id,
    {
      deviceId: row.device_id,
      platform: sanitizePlatform(row.platform),
      appVersion: row.app_version || "0.1.0",
      ip: row.ip || undefined,
      userAgent: row.user_agent || undefined,
    },
    row.session_id,
  );

  return success(request, requestId, {
    tokens: issued.tokens,
    serverTime: nowIso(),
  });
}

export async function handleLogout(request, env, requestId) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const body = (await readJson(request)) || {};
  const revokedAt = nowIso();

  if (body.allDevices) {
    await dbBatch(required.auth.db, [
      {
        sql: "UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
        params: [revokedAt, required.auth.userId],
      },
      {
        sql: "UPDATE auth_access_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
        params: [revokedAt, required.auth.userId],
      },
      {
        sql: "UPDATE auth_refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
        params: [revokedAt, required.auth.userId],
      },
    ]);
  } else {
    await dbBatch(required.auth.db, [
      {
        sql: "UPDATE auth_sessions SET revoked_at = ? WHERE session_id = ?",
        params: [revokedAt, required.auth.sessionId],
      },
      {
        sql: "UPDATE auth_access_tokens SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL",
        params: [revokedAt, required.auth.sessionId],
      },
      {
        sql: "UPDATE auth_refresh_tokens SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL",
        params: [revokedAt, required.auth.sessionId],
      },
    ]);
  }

  return success(request, requestId, {
    success: true,
    serverTime: revokedAt,
  });
}
