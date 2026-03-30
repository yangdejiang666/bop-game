import { PROTOCOL_ERROR } from "./constants.js";
import { getDbOrResponse, dbFirst } from "./db.js";
import {
  failure,
  jsonResponse,
  readRequestId,
  success,
  withCors,
} from "./helpers.js";
import {
  handleLogin,
  handleLogout,
  handleRefresh,
  handleRegister,
} from "./auth-handlers.js";
import {
  handleBootstrap,
  handleDeveloperAccountsOverview,
  handleGetMe,
  handleGetPublicUser,
  handleUpdateProfile,
} from "./user-handlers.js";
import { handleCompleteMatch } from "./progression-handlers.js";
import {
  handleCreateRoom,
  handleGetRoomSnapshot,
  handleJoinRoom,
  handleLeaveRoom,
  handleQueryRoomByInviteCode,
  handleReadyRoom,
} from "./room-handlers.js";
import {
  handleStartRoomMatch,
  handleSyncRoomMatch,
} from "./room-match-handlers.js";
import {
  handleMatchmakingActive,
  handleMatchmakingCancel,
  handleMatchmakingStart,
  handleMatchmakingStatus,
} from "./matchmaking-handlers.js";
import {
  handleAcceptFriendRequest,
  handleCreateBlock,
  handleCreateFriendRequest,
  handleGetSocialOverview,
  handleRejectFriendRequest,
  handleRemoveBlock,
  handleRemoveFriend,
  handleSearchSocialUser,
} from "./social-handlers.js";

function readString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isEnabled(envValue, fallbacks = []) {
  const normalized = readString(envValue).toLowerCase();
  if (normalized) {
    return (
      normalized === "1" ||
      normalized === "true" ||
      normalized === "yes" ||
      normalized === "on"
    );
  }

  return fallbacks.some((value) => readString(value).length > 0);
}

function buildPlatformConfig(request, env) {
  const siteUrl =
    readString(env.PUBLIC_SITE_URL) ||
    readString(env.SITE_ORIGIN) ||
    new URL(request.url).origin;
  const clerkPublishableKey =
    readString(env.VITE_CLERK_PUBLISHABLE_KEY) ||
    readString(env.CLERK_PUBLISHABLE_KEY) ||
    null;
  const stripePublishableKey =
    readString(env.VITE_STRIPE_PUBLISHABLE_KEY) ||
    readString(env.STRIPE_PUBLISHABLE_KEY) ||
    null;
  const supabaseUrl =
    readString(env.VITE_SUPABASE_URL) ||
    readString(env.SUPABASE_URL) ||
    null;
  const supabaseAnonKey =
    readString(env.VITE_SUPABASE_ANON_KEY) ||
    readString(env.SUPABASE_ANON_KEY) ||
    null;
  const posthogApiKey =
    readString(env.VITE_POSTHOG_API_KEY) ||
    readString(env.POSTHOG_API_KEY) ||
    null;
  const posthogHost =
    readString(env.VITE_POSTHOG_HOST) ||
    readString(env.POSTHOG_HOST) ||
    "https://us.i.posthog.com";
  const sentryDsn =
    readString(env.VITE_SENTRY_DSN) ||
    readString(env.SENTRY_DSN) ||
    null;
  const stripeEnabled = isEnabled(env.VITE_STRIPE_ENABLED ?? env.STRIPE_ENABLED, [
    stripePublishableKey,
  ]);
  const supabaseEnabled = isEnabled(
    env.VITE_SUPABASE_ENABLED ?? env.SUPABASE_ENABLED,
    [supabaseUrl, supabaseAnonKey],
  );
  const resendEnabled = isEnabled(env.RESEND_ENABLED, [env.RESEND_API_KEY]);
  const clerkEnabled = isEnabled(env.VITE_CLERK_ENABLED ?? env.CLERK_ENABLED, [
    clerkPublishableKey,
  ]);
  const posthogEnabled = isEnabled(
    env.VITE_POSTHOG_ENABLED ?? env.POSTHOG_ENABLED,
    [posthogApiKey],
  );
  const sentryEnabled = isEnabled(
    env.VITE_SENTRY_ENABLED ?? env.SENTRY_ENABLED,
    [sentryDsn],
  );
  const upstashEnabled = isEnabled(env.UPSTASH_ENABLED, [
    env.UPSTASH_REDIS_REST_URL,
    env.UPSTASH_REDIS_REST_TOKEN,
  ]);
  const pineconeEnabled = isEnabled(env.PINECONE_ENABLED, [
    env.PINECONE_API_KEY,
    env.PINECONE_INDEX_HOST,
  ]);
  const defaultProductKey =
    readString(env.VITE_STRIPE_DEFAULT_PRODUCT_KEY) ||
    readString(env.STRIPE_DEFAULT_PRODUCT_KEY) ||
    "coins_1200";
  const avatarBucket =
    readString(env.VITE_SUPABASE_AVATAR_BUCKET) ||
    readString(env.SUPABASE_AVATAR_BUCKET) ||
    "avatars";

  return {
    env: readString(env.VITE_APP_ENV) || readString(env.NODE_ENV) || "production",
    siteUrl,
    providers: [
      {
        provider: "stripe",
        enabled: stripeEnabled,
        features: ["checkout", "webhook", "coin_grants"],
      },
      {
        provider: "supabase",
        enabled: supabaseEnabled,
        features: ["avatar_storage", "cdn"],
      },
      {
        provider: "resend",
        enabled: resendEnabled,
        features: ["password_reset_email", "purchase_receipts"],
      },
      {
        provider: "clerk",
        enabled: clerkEnabled,
        features: ["platform_login", "session_verification"],
      },
      {
        provider: "posthog",
        enabled: posthogEnabled,
        features: ["analytics", "server_events"],
      },
      {
        provider: "sentry",
        enabled: sentryEnabled,
        features: ["browser_errors", "api_errors"],
      },
      {
        provider: "upstash",
        enabled: upstashEnabled,
        features: ["rate_limit", "ephemeral_store"],
      },
      {
        provider: "pinecone",
        enabled: pineconeEnabled,
        features: ["semantic_search"],
      },
    ],
    auth: {
      passwordEnabled: true,
      clerkEnabled,
      clerkPublishableKey,
      clerkSignInUrl: readString(env.VITE_CLERK_SIGN_IN_URL) || null,
      clerkSignUpUrl: readString(env.VITE_CLERK_SIGN_UP_URL) || null,
      clerkAfterSignInUrl:
        readString(env.VITE_CLERK_AFTER_SIGN_IN_URL) ||
        readString(env.CLERK_AFTER_SIGN_IN_URL) ||
        siteUrl,
      clerkAfterSignUpUrl:
        readString(env.VITE_CLERK_AFTER_SIGN_UP_URL) ||
        readString(env.CLERK_AFTER_SIGN_UP_URL) ||
        siteUrl,
    },
    commerce: {
      stripeEnabled,
      stripePublishableKey,
      defaultProductKey,
      products: [
        {
          productKey: "coins_1200",
          label: "1200 金币补给",
          description: "快速补充金币，用于后续皮肤、装扮与赛季消耗。",
          mode: "payment",
          coinGrant: 1200,
          enabled: stripeEnabled,
        },
        {
          productKey: "founder_pack",
          label: "创始补给包",
          description: "一次性创始人补给，适合早期测试服内购联调。",
          mode: "payment",
          coinGrant: 5000,
          enabled: stripeEnabled,
        },
        {
          productKey: "season_pass",
          label: "赛季通行证",
          description: "赛季制订阅包，附带测试期金币补给奖励。",
          mode: "subscription",
          coinGrant: 1500,
          enabled: stripeEnabled,
        },
      ],
    },
    storage: {
      avatarProvider: supabaseEnabled ? "supabase" : "local",
      supabaseUrl,
      supabaseAnonKey,
      avatarBucket,
    },
    telemetry: {
      posthogEnabled,
      posthogApiKey,
      posthogHost,
      sentryEnabled,
      sentryDsn,
      sentryEnvironment:
        readString(env.VITE_SENTRY_ENVIRONMENT) ||
        readString(env.SENTRY_ENVIRONMENT) ||
        "production",
    },
    cache: {
      upstashEnabled,
    },
    ai: {
      pineconeEnabled,
      namespace: readString(env.PINECONE_NAMESPACE) || "bop-guide",
    },
    serverTime: new Date().toISOString(),
  };
}

export async function handleHealthzRequest({ request }) {
  return jsonResponse(request, 200, {
    ok: true,
    service: "bop-pages-backend",
    timestamp: new Date().toISOString(),
  });
}

export async function handleReadyzRequest({ request, env }) {
  const requestId = readRequestId(request);
  const { db, response } = await getDbOrResponse(request, env, requestId);
  if (!db) {
    return response;
  }

  const table = await dbFirst(
    db,
    `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = 'users'
      LIMIT 1
    `,
  );

  if (!table?.name) {
    return failure(
      request,
      requestId,
      503,
      PROTOCOL_ERROR.SERVICE_UNAVAILABLE,
      "D1 schema is not migrated yet.",
      { requiredTable: "users" },
    );
  }

  return jsonResponse(request, 200, {
    ok: true,
    ready: true,
    timestamp: new Date().toISOString(),
  });
}

function makeOptionsResponse(request) {
  return new Response(null, {
    status: 204,
    headers: withCors(request),
  });
}

export async function handleApiRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return makeOptionsResponse(request);
  }

  const requestId = readRequestId(request);
  const url = new URL(request.url);
  const rawPath = url.pathname.replace(/^\/api\/v1/, "") || "/";

  try {
    if (request.method === "GET" && rawPath === "/healthz") {
      return handleHealthzRequest({ request });
    }
    if (request.method === "GET" && rawPath === "/") {
      return jsonResponse(request, 200, {
        ok: true,
        service: "bop-pages-backend",
        version: "v1",
        timestamp: new Date().toISOString(),
      });
    }

    if (request.method === "GET" && rawPath === "/platform/config") {
      return success(request, requestId, buildPlatformConfig(request, env));
    }

    if (request.method === "POST" && rawPath === "/auth/register") {
      return handleRegister(request, env, requestId);
    }
    if (request.method === "POST" && rawPath === "/auth/login") {
      return handleLogin(request, env, requestId);
    }
    if (request.method === "POST" && rawPath === "/auth/refresh") {
      return handleRefresh(request, env, requestId);
    }
    if (request.method === "POST" && rawPath === "/auth/logout") {
      return handleLogout(request, env, requestId);
    }

    if (request.method === "GET" && rawPath === "/user/me") {
      return handleGetMe(request, env, requestId);
    }
    if (request.method === "POST" && rawPath === "/user/bootstrap") {
      return handleBootstrap(request, env, requestId);
    }
    if (request.method === "PATCH" && rawPath === "/user/profile") {
      return handleUpdateProfile(request, env, requestId);
    }
    if (request.method === "GET" && rawPath === "/user/dev/accounts-overview") {
      return handleDeveloperAccountsOverview(request, env, requestId);
    }

    const userMatch = rawPath.match(/^\/user\/([^/]+)$/);
    if (request.method === "GET" && userMatch) {
      return handleGetPublicUser(
        request,
        env,
        requestId,
        decodeURIComponent(userMatch[1]),
      );
    }

    if (request.method === "GET" && rawPath === "/social/overview") {
      return handleGetSocialOverview(request, env, requestId);
    }
    if (request.method === "POST" && rawPath === "/social/friend-requests") {
      return handleCreateFriendRequest(request, env, requestId);
    }
    if (request.method === "POST" && rawPath === "/social/blocks") {
      return handleCreateBlock(request, env, requestId);
    }

    const socialSearchMatch = rawPath.match(/^\/social\/search\/([^/]+)$/);
    if (request.method === "GET" && socialSearchMatch) {
      return handleSearchSocialUser(
        request,
        env,
        requestId,
        decodeURIComponent(socialSearchMatch[1]),
      );
    }

    const acceptFriendMatch = rawPath.match(
      /^\/social\/friend-requests\/([^/]+)\/accept$/,
    );
    if (request.method === "POST" && acceptFriendMatch) {
      return handleAcceptFriendRequest(
        request,
        env,
        requestId,
        decodeURIComponent(acceptFriendMatch[1]),
      );
    }

    const rejectFriendMatch = rawPath.match(
      /^\/social\/friend-requests\/([^/]+)\/reject$/,
    );
    if (request.method === "POST" && rejectFriendMatch) {
      return handleRejectFriendRequest(
        request,
        env,
        requestId,
        decodeURIComponent(rejectFriendMatch[1]),
      );
    }

    const removeFriendMatch = rawPath.match(/^\/social\/friends\/([^/]+)$/);
    if (request.method === "DELETE" && removeFriendMatch) {
      return handleRemoveFriend(
        request,
        env,
        requestId,
        decodeURIComponent(removeFriendMatch[1]),
      );
    }

    const removeBlockMatch = rawPath.match(/^\/social\/blocks\/([^/]+)$/);
    if (request.method === "DELETE" && removeBlockMatch) {
      return handleRemoveBlock(
        request,
        env,
        requestId,
        decodeURIComponent(removeBlockMatch[1]),
      );
    }

    if (request.method === "POST" && rawPath === "/progression/matches/complete") {
      return handleCompleteMatch(request, env, requestId);
    }

    if (request.method === "POST" && rawPath === "/room/create") {
      return handleCreateRoom(request, env, requestId);
    }
    if (request.method === "POST" && rawPath === "/room/join") {
      return handleJoinRoom(request, env, requestId);
    }
    if (request.method === "POST" && rawPath === "/room/leave") {
      return handleLeaveRoom(request, env, requestId);
    }
    if (request.method === "POST" && rawPath === "/room/ready") {
      return handleReadyRoom(request, env, requestId);
    }
    if (request.method === "POST" && rawPath === "/room/start-match") {
      return handleStartRoomMatch(request, env, requestId);
    }
    if (request.method === "POST" && rawPath === "/room/session/sync") {
      return handleSyncRoomMatch(request, env, requestId);
    }

    const inviteMatch = rawPath.match(/^\/room\/invite\/([^/]+)$/);
    if (request.method === "GET" && inviteMatch) {
      return handleQueryRoomByInviteCode(
        request,
        env,
        requestId,
        decodeURIComponent(inviteMatch[1]),
      );
    }

    const roomMatch = rawPath.match(/^\/room\/([^/]+)$/);
    if (request.method === "GET" && roomMatch) {
      return handleGetRoomSnapshot(
        request,
        env,
        requestId,
        decodeURIComponent(roomMatch[1]),
      );
    }

    if (request.method === "POST" && rawPath === "/matchmaking/start") {
      return handleMatchmakingStart(request, env, requestId);
    }
    if (request.method === "POST" && rawPath === "/matchmaking/cancel") {
      return handleMatchmakingCancel(request, env, requestId);
    }

    const statusMatch = rawPath.match(/^\/matchmaking\/status\/([^/]+)$/);
    if (request.method === "GET" && statusMatch) {
      return handleMatchmakingStatus(
        request,
        env,
        requestId,
        decodeURIComponent(statusMatch[1]),
      );
    }

    if (request.method === "GET" && rawPath === "/matchmaking/active") {
      return handleMatchmakingActive(request, env, requestId);
    }

    return failure(
      request,
      requestId,
      404,
      PROTOCOL_ERROR.NOT_FOUND,
      "Route not found.",
      { method: request.method, path: rawPath },
    );
  } catch (error) {
    return failure(
      request,
      requestId,
      500,
      PROTOCOL_ERROR.UNKNOWN,
      error instanceof Error ? error.message : "Unknown server error.",
    );
  }
}

export async function onRequest(context) {
  return handleApiRequest(context);
}
