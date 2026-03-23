import { PROTOCOL_ERROR } from "./constants.js";
import { getDbOrResponse, dbFirst } from "./db.js";
import { failure, jsonResponse, readRequestId, withCors } from "./helpers.js";
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
  handleMatchmakingActive,
  handleMatchmakingCancel,
  handleMatchmakingStart,
  handleMatchmakingStatus,
} from "./matchmaking-handlers.js";

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
