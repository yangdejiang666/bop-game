import {
  type AuthUser,
  type DeviceInfo,
  type DeviceSession,
  type ListDeviceSessionsResponse,
  type LoginResponse,
  type RefreshTokenResponse,
  type RegisterByPasswordResponse,
  type TokenPair,
} from "@bop/shared-protocol";
import { apiServerConfig } from "../lib/config.js";
import { withTransaction } from "../lib/db.js";
import {
  createAccessToken,
  createOpaqueToken,
  hashOpaqueToken,
} from "../lib/jwt.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import {
  createPasswordUser,
  createPlatformUser,
  findIdentityByProviderUid,
  findPasswordIdentityByAccount,
  getActiveSessionById,
  getUserSummaryById,
  insertRefreshToken,
  listActiveSessionsByUserId,
  normalizeAccount,
  revokeAllSessionsByUserId,
  revokeRefreshTokenById,
  revokeSessionById,
  revokeSessionTokens,
  syncPlatformIdentity,
  touchUserLogin,
  upsertAuthSession,
  type RefreshTokenRecord,
} from "../repositories/accountRepository.js";
import { findRefreshTokenByHash } from "../repositories/accountRepository.js";
import {
  captureServerEvent,
  verifyClerkPlatformToken,
} from "./platformService.js";

function buildAuthUser(summary: Awaited<ReturnType<typeof getUserSummaryById>>): AuthUser {
  if (!summary) {
    throw new Error("user summary not found");
  }

  const accountIdentity =
    summary.summary.identities.find((identity) => identity.provider === "password") ??
    summary.summary.identities[0];

  return {
    userId: summary.summary.user.id,
    gameId: summary.summary.user.gameId,
    accountId:
      accountIdentity?.username ??
      accountIdentity?.providerUid ??
      summary.summary.user.id,
    nickname: summary.summary.profile.nickname,
    avatarUrl: summary.summary.profile.avatarUrl ?? "",
    banned: summary.summary.ban.isBanned,
    banReason: summary.summary.ban.reason ?? undefined,
    banUntil: summary.summary.ban.until ?? undefined,
    createdAt: summary.summary.user.createdAt,
    updatedAt: summary.summary.user.updatedAt,
  };
}

function nowPlusSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function toTokenPair(userId: string, sessionId: string): {
  tokens: TokenPair;
  refreshTokenHash: string;
} {
  const accessToken = createAccessToken(userId, sessionId);
  const refreshToken = createOpaqueToken();
  return {
    tokens: {
      accessToken,
      refreshToken,
      expiresIn: apiServerConfig.jwt.accessTtlSeconds,
      refreshExpiresIn: apiServerConfig.jwt.refreshTtlSeconds,
      tokenType: "Bearer",
    },
    refreshTokenHash: hashOpaqueToken(refreshToken),
  };
}

async function issueTokenPair(params: {
  userId: string;
  device: DeviceInfo;
}): Promise<{
  tokens: TokenPair;
  sessionId: string;
}> {
  return withTransaction(async (client) => {
    const session = await upsertAuthSession(
      {
        userId: params.userId,
        device: params.device,
      },
      client,
    );

    await revokeSessionTokens(session.sessionId, client);
    const { tokens, refreshTokenHash } = toTokenPair(params.userId, session.sessionId);
    await insertRefreshToken(
      {
        sessionId: session.sessionId,
        userId: params.userId,
        refreshTokenHash,
        expiresAt: nowPlusSeconds(tokens.refreshExpiresIn),
      },
      client,
    );

    return {
      tokens,
      sessionId: session.sessionId,
    };
  });
}

function ensureRefreshTokenActive(record: RefreshTokenRecord | null): asserts record {
  if (!record) {
    throw new Error("refresh token invalid");
  }

  if (record.revokedAt || record.sessionRevokedAt) {
    throw new Error("refresh token invalid");
  }

  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    throw new Error("refresh token expired");
  }
}

export async function registerByPassword(params: {
  account: string;
  password: string;
  nickname?: string;
  device: DeviceInfo;
}): Promise<RegisterByPasswordResponse> {
  const account = normalizeAccount(params.account);
  const passwordHash = await hashPassword(params.password);

  const created = await withTransaction(async (client) => {
    const { userId } = await createPasswordUser(
      {
        account,
        passwordHash,
        nickname: params.nickname,
      },
      client,
    );
    const summary = await getUserSummaryById(userId, client);
    if (!summary) {
      throw new Error("user summary not found");
    }
    return summary;
  });

  const issued = await issueTokenPair({
    userId: created.summary.user.id,
    device: params.device,
  });

  return {
    user: buildAuthUser(created),
    tokens: issued.tokens,
    isNewUser: true,
  };
}

export async function loginByPassword(params: {
  account: string;
  password: string;
  device: DeviceInfo;
}): Promise<LoginResponse> {
  const identity = await findPasswordIdentityByAccount(params.account);
  if (!identity) {
    throw new Error("invalid credentials");
  }

  const passwordMatches = await verifyPassword(
    params.password,
    identity.passwordHash,
  );
  if (!passwordMatches) {
    throw new Error("invalid credentials");
  }

  if (identity.userStatus !== "active" || identity.banned) {
    throw new Error("account banned");
  }

  const summary = await withTransaction(async (client) => {
    await touchUserLogin(identity.userId, client);
    const found = await getUserSummaryById(identity.userId, client);
    if (!found) {
      throw new Error("user summary not found");
    }
    return found;
  });

  const issued = await issueTokenPair({
    userId: identity.userId,
    device: params.device,
  });

  return {
    user: buildAuthUser(summary),
    tokens: issued.tokens,
    method: "password",
    isNewUser: false,
    serverTime: new Date().toISOString(),
    riskMeta: {
      riskLevel: "low",
      requiresVerification: false,
      reasonCodes: [],
    },
  };
}

export async function loginByPlatform(params: {
  provider: string;
  providerToken: string;
  device: DeviceInfo;
}): Promise<LoginResponse> {
  if (params.provider !== "clerk") {
    throw new Error("unsupported platform provider");
  }

  const verified = await verifyClerkPlatformToken(params.providerToken);
  const providerUid = `clerk:${verified.subject}`;
  const existingIdentity = await findIdentityByProviderUid({
    provider: "platform",
    providerUid,
  });

  let userId = existingIdentity?.userId ?? null;
  let isNewUser = false;

  if (!userId) {
    const created = await createPlatformUser({
      providerUid,
      nickname: verified.nickname ?? undefined,
      avatarUrl: verified.avatarUrl,
      email: verified.email,
      emailVerified: !!verified.email,
    });
    userId = created.userId;
    isNewUser = true;
  } else {
    await syncPlatformIdentity({
      userId,
      providerUid,
      avatarUrl: verified.avatarUrl,
      email: verified.email,
      emailVerified: !!verified.email,
    });
  }
  if (!userId) {
    throw new Error("platform user resolution failed");
  }

  const summary = await withTransaction(async (client) => {
    await touchUserLogin(userId, client);
    const found = await getUserSummaryById(userId, client);
    if (!found) {
      throw new Error("user summary not found");
    }
    return found;
  });

  const issued = await issueTokenPair({
    userId,
    device: params.device,
  });

  await captureServerEvent({
    event: "auth_platform_login_succeeded",
    distinctId: userId,
    properties: {
      provider: params.provider,
      isNewUser,
    },
  });

  return {
    user: buildAuthUser(summary),
    tokens: issued.tokens,
    method: "platform",
    isNewUser,
    serverTime: new Date().toISOString(),
    riskMeta: {
      riskLevel: "low",
      requiresVerification: false,
      reasonCodes: [params.provider],
    },
  };
}

export async function refreshSession(params: {
  refreshToken: string;
  device?: Pick<DeviceInfo, "deviceId">;
}): Promise<RefreshTokenResponse> {
  const refreshTokenHash = hashOpaqueToken(params.refreshToken);
  const record = await findRefreshTokenByHash(refreshTokenHash);
  ensureRefreshTokenActive(record);

  if (params.device?.deviceId && params.device.deviceId !== record.deviceId) {
    throw new Error("refresh token invalid");
  }

  const { tokens } = await withTransaction(async (client) => {
    await revokeRefreshTokenById(record.refreshTokenId, client);
    await revokeSessionTokens(record.sessionId, client);
    const next = toTokenPair(record.userId, record.sessionId);
    await insertRefreshToken(
      {
        sessionId: record.sessionId,
        userId: record.userId,
        refreshTokenHash: next.refreshTokenHash,
        expiresAt: nowPlusSeconds(next.tokens.refreshExpiresIn),
      },
      client,
    );
    return next;
  });

  return {
    tokens,
    serverTime: new Date().toISOString(),
  };
}

export async function logoutSession(params: {
  userId: string;
  sessionId: string;
  refreshToken?: string;
  allDevices?: boolean;
}): Promise<void> {
  await withTransaction(async (client) => {
    if (params.allDevices) {
      await revokeAllSessionsByUserId(params.userId, client);
      return;
    }

    if (params.refreshToken) {
      const record = await findRefreshTokenByHash(
        hashOpaqueToken(params.refreshToken),
        client,
      );
      if (record && record.userId === params.userId) {
        await revokeSessionById(record.sessionId, client);
        return;
      }
    }

    await revokeSessionById(params.sessionId, client);
  });
}

export async function listDeviceSessions(params: {
  userId: string;
  currentSessionId: string;
}): Promise<ListDeviceSessionsResponse> {
  const sessions = await listActiveSessionsByUserId(params.userId);
  const hydrated: DeviceSession[] = sessions.map((session) => ({
    ...session,
    current: session.sessionId === params.currentSessionId,
  }));

  return {
    sessions: hydrated,
    serverTime: new Date().toISOString(),
  };
}

export async function revokeDeviceSession(params: {
  userId: string;
  sessionId: string;
}): Promise<void> {
  const session = await getActiveSessionById(params.sessionId);
  if (!session || session.userId !== params.userId || session.revokedAt) {
    throw new Error("session not found");
  }
  await revokeSessionById(params.sessionId);
}
