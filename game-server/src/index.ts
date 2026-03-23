// @ts-nocheck
/* eslint-disable no-console */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import {
  PROTOCOL_ERROR,
  createError,
  createSuccess,
  WsProtocol,
} from "@bop/shared-protocol";

/**
 * BOP Game Server - WebSocket Gateway Scaffold
 * ---------------------------------------------
 * Scope:
 * - connection auth (Bearer token in query/header)
 * - heartbeat (ping/pong + timeout close)
 * - basic room join/leave flow
 * - matchmaking progress push (mock)
 * - server->client envelope helpers
 *
 * This is intentionally a scaffold:
 * - no persistent storage
 * - no real JWT verification yet
 * - no authoritative gameplay simulation yet
 */

type ClientPlatform = "web" | "android" | "ios" | "unknown";

interface GatewayConfig {
  host: string;
  port: number;
  path: string;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  corsOrigin: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

interface AuthContext {
  userId: string;
  sessionId: string;
  token: string;
  isGuest: boolean;
}

interface ClientState {
  connectionId: string;
  ws: WebSocket;
  connectedAt: number;
  lastPingAt: number;
  lastPongAt: number;
  lastSeenAt: number;
  auth: AuthContext | null;
  activeRoomId: string | null;
  activeQueueTicketId: string | null;
  platform: ClientPlatform;
  appVersion: string;
  ip: string;
}

interface RoomMember {
  userId: string;
  nickname: string;
  ready: boolean;
  leader: boolean;
  team: "A" | "B" | "observer";
  avatarUrl?: string;
}

interface RoomState {
  roomId: string;
  modeId: WsProtocol.MatchModeId;
  state: "forming" | "ready" | "starting" | "in_game" | "closed";
  inviteCode?: string;
  members: RoomMember[];
  maxMembers: number;
  canStart: boolean;
}

interface QueueState {
  ticketId: string;
  userId: string;
  modeId: WsProtocol.MatchModeId;
  startedAt: number;
  etaSeconds: number;
  currentPlayers: number;
  targetPlayers: number;
  stage: "searching" | "confirming" | "found";
}

const config: GatewayConfig = {
  host: process.env.GAME_HOST ?? "0.0.0.0",
  port: Number(process.env.GAME_PORT ?? 8899),
  path: process.env.GAME_WS_PATH ?? "/ws",
  heartbeatIntervalMs: Number(process.env.GAME_HEARTBEAT_INTERVAL_MS ?? 10000),
  heartbeatTimeoutMs: Number(process.env.GAME_HEARTBEAT_TIMEOUT_MS ?? 30000),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  logLevel:
    (process.env.LOG_LEVEL as GatewayConfig["logLevel"] | undefined) ?? "info",
};

const httpServer = createServer((_req, res) => {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      ok: true,
      service: "bop-game-server",
      now: new Date().toISOString(),
      wsPath: config.path,
    }),
  );
});

const wss = new WebSocketServer({
  server: httpServer,
  path: config.path,
});

const clientsByConnectionId = new Map<string, ClientState>();
const connectionIdBySocket = new WeakMap<WebSocket, string>();
const roomsById = new Map<string, RoomState>();
const queueByTicketId = new Map<string, QueueState>();

function log(level: GatewayConfig["logLevel"], message: string, data?: unknown) {
  const levels: Record<GatewayConfig["logLevel"], number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };
  if (levels[level] < levels[config.logLevel]) return;
  if (data !== undefined) {
    console.log(`[${level}] ${message}`, data);
  } else {
    console.log(`[${level}] ${message}`);
  }
}

function nowMs() {
  return Date.now();
}

function makeId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function parseTokenFromUpgrade(url: string, authHeader?: string): string | null {
  try {
    const parsed = new URL(url, "ws://localhost");
    const queryToken = parsed.searchParams.get("token");
    if (queryToken?.trim()) return queryToken.trim();
  } catch {
    // ignore parse error
  }

  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  return null;
}

/**
 * Token scaffold:
 * - demo_user:<id>
 * - guest:<id>
 * - anything else -> unauthorized
 */
function verifyAccessToken(token: string): AuthContext | null {
  if (token.startsWith("demo_user:")) {
    const userId = token.slice("demo_user:".length).trim();
    if (!userId) return null;
    return {
      userId,
      sessionId: makeId("sess"),
      token,
      isGuest: false,
    };
  }

  if (token.startsWith("guest:")) {
    const userId = token.slice("guest:".length).trim();
    if (!userId) return null;
    return {
      userId: `guest_${userId}`,
      sessionId: makeId("sess"),
      token,
      isGuest: true,
    };
  }

  return null;
}

function getClientBySocket(ws: WebSocket): ClientState | null {
  const connectionId = connectionIdBySocket.get(ws);
  if (!connectionId) return null;
  return clientsByConnectionId.get(connectionId) ?? null;
}

function sendEnvelope<TType extends string, TPayload>(
  client: ClientState,
  type: TType,
  payload: TPayload,
  traceId?: string,
) {
  const envelope = WsProtocol.createWsEnvelope(
    type,
    payload,
    makeId("evt"),
    traceId,
  );
  if (client.ws.readyState === client.ws.OPEN) {
    client.ws.send(JSON.stringify(envelope));
  }
}

function sendError(
  client: ClientState,
  code: string,
  message: string,
  retriable = false,
  details?: Record<string, unknown>,
) {
  sendEnvelope(client, "system.error", {
    code,
    message,
    retriable,
    details,
  } satisfies WsProtocol.WsErrorPayload);
}

function ensureAuthed(client: ClientState): client is ClientState & { auth: AuthContext } {
  return !!client.auth;
}

function buildNickname(userId: string) {
  return userId.startsWith("guest_")
    ? `游客_${userId.slice(-4)}`
    : `玩家_${userId.slice(0, 6)}`;
}

function ensureRoom(roomId: string, modeId: WsProtocol.MatchModeId): RoomState {
  const existing = roomsById.get(roomId);
  if (existing) return existing;

  const room: RoomState = {
    roomId,
    modeId,
    state: "forming",
    members: [],
    maxMembers: 50,
    canStart: false,
  };
  roomsById.set(roomId, room);
  return room;
}

function recalcRoomState(room: RoomState) {
  const readyCount = room.members.filter((m) => m.ready).length;
  room.canStart = room.members.length >= 2 && readyCount >= Math.max(1, room.members.length - 1);
  room.state = room.canStart ? "ready" : "forming";
}

function broadcastRoomState(room: RoomState) {
  const payload: WsProtocol.RoomStatePayload = {
    roomId: room.roomId,
    modeId: room.modeId,
    state: room.state,
    inviteCode: room.inviteCode,
    members: room.members,
    maxMembers: room.maxMembers,
    canStart: room.canStart,
  };

  for (const client of clientsByConnectionId.values()) {
    if (client.activeRoomId === room.roomId) {
      sendEnvelope(client, "room.state", payload);
    }
  }
}

function leaveCurrentRoom(client: ClientState, reason: WsProtocol.RoomClosedPayload["reason"] | null = null) {
  const roomId = client.activeRoomId;
  if (!roomId || !client.auth) return;

  const room = roomsById.get(roomId);
  client.activeRoomId = null;

  if (!room) return;

  room.members = room.members.filter((m) => m.userId !== client.auth!.userId);

  if (room.members.length === 0) {
    room.state = "closed";
    roomsById.delete(room.roomId);
    return;
  }

  // transfer leader if needed
  if (!room.members.some((m) => m.leader)) {
    room.members[0].leader = true;
  }

  recalcRoomState(room);
  broadcastRoomState(room);

  if (reason) {
    sendEnvelope(client, "room.closed", {
      roomId,
      reason,
    } satisfies WsProtocol.RoomClosedPayload);
  }
}

function startMockQueue(client: ClientState, modeId: WsProtocol.MatchModeId) {
  if (!client.auth) return;

  if (client.activeQueueTicketId) {
    sendError(
      client,
      PROTOCOL_ERROR.MATCH_ALREADY_IN_QUEUE,
      "You are already in queue.",
      false,
      { ticketId: client.activeQueueTicketId },
    );
    return;
  }

  const ticketId = makeId("mm");
  const queue: QueueState = {
    ticketId,
    userId: client.auth.userId,
    modeId,
    startedAt: nowMs(),
    etaSeconds: 6,
    currentPlayers: 1,
    targetPlayers: 50,
    stage: "searching",
  };

  queueByTicketId.set(ticketId, queue);
  client.activeQueueTicketId = ticketId;

  sendEnvelope(client, "matchmaking.progress", {
    queueTicketId: ticketId,
    modeId,
    stage: "searching",
    currentPlayers: queue.currentPlayers,
    targetPlayers: queue.targetPlayers,
    etaSeconds: queue.etaSeconds,
  } satisfies WsProtocol.MatchmakingProgressPayload);

  // mock progression -> found
  const progressTimer = setInterval(() => {
    const live = queueByTicketId.get(ticketId);
    const liveClient = clientsByConnectionId.get(client.connectionId);

    if (!live || !liveClient || liveClient.activeQueueTicketId !== ticketId) {
      clearInterval(progressTimer);
      return;
    }

    if (live.stage !== "searching") {
      clearInterval(progressTimer);
      return;
    }

    live.currentPlayers = Math.min(live.targetPlayers, live.currentPlayers + 8);
    live.etaSeconds = Math.max(0, live.etaSeconds - 1);

    sendEnvelope(liveClient, "matchmaking.progress", {
      queueTicketId: live.ticketId,
      modeId: live.modeId,
      stage: "searching",
      currentPlayers: live.currentPlayers,
      targetPlayers: live.targetPlayers,
      etaSeconds: live.etaSeconds,
    } satisfies WsProtocol.MatchmakingProgressPayload);

    if (live.currentPlayers >= live.targetPlayers || live.etaSeconds <= 0) {
      live.stage = "found";

      const roomId = makeId("room");
      const joinToken = makeId("join");
      const room = ensureRoom(roomId, live.modeId);

      // auto join room
      room.members.push({
        userId: live.userId,
        nickname: buildNickname(live.userId),
        ready: false,
        leader: room.members.length === 0,
        team: "observer",
      });
      recalcRoomState(room);

      liveClient.activeQueueTicketId = null;
      liveClient.activeRoomId = roomId;
      queueByTicketId.delete(ticketId);

      sendEnvelope(liveClient, "matchmaking.found", {
        queueTicketId: live.ticketId,
        roomId,
        joinToken,
        modeId: live.modeId,
      } satisfies WsProtocol.MatchmakingFoundPayload);

      broadcastRoomState(room);
      clearInterval(progressTimer);
    }
  }, 1000);
}

function cancelQueue(client: ClientState, queueTicketId: string) {
  if (!client.auth) return;
  if (client.activeQueueTicketId !== queueTicketId) {
    sendError(
      client,
      PROTOCOL_ERROR.MATCH_NOT_IN_QUEUE,
      "No active queue with this ticket.",
      false,
      { queueTicketId },
    );
    return;
  }

  queueByTicketId.delete(queueTicketId);
  client.activeQueueTicketId = null;

  sendEnvelope(client, "matchmaking.cancelled", {
    queueTicketId,
    by: "client",
  } satisfies WsProtocol.MatchmakingCancelledPayload);
}

function handleClientEvent(client: ClientState, raw: string) {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    sendError(
      client,
      PROTOCOL_ERROR.WS_INVALID_MESSAGE,
      "Invalid JSON payload.",
      false,
    );
    return;
  }

  if (!WsProtocol.isWsEnvelope(data)) {
    sendError(
      client,
      PROTOCOL_ERROR.WS_INVALID_MESSAGE,
      "Payload is not a valid websocket envelope.",
      false,
    );
    return;
  }

  const envelope = data as WsProtocol.ClientEvent;
  client.lastSeenAt = nowMs();

  switch (envelope.type) {
    case "system.hello": {
      const payload = envelope.payload as WsProtocol.ClientHelloPayload;
      client.platform = payload.platform ?? "unknown";
      client.appVersion = payload.appVersion ?? "0.0.0";
      sendEnvelope(client, "system.welcome", {
        connectionId: client.connectionId,
        heartbeatIntervalMs: config.heartbeatIntervalMs,
        serverTime: nowMs(),
      } satisfies WsProtocol.ServerWelcomePayload, envelope.traceId);
      return;
    }

    case "system.ping": {
      const payload = envelope.payload as WsProtocol.ClientPingPayload;
      client.lastPingAt = nowMs();
      sendEnvelope(client, "system.pong", {
        nonce: payload.nonce,
        serverTime: nowMs(),
      } satisfies WsProtocol.ServerPongPayload, envelope.traceId);
      return;
    }

    case "auth.resume": {
      const payload = envelope.payload as WsProtocol.AuthResumePayload;
      const verified = verifyAccessToken(payload.accessToken);
      if (!verified) {
        sendEnvelope(client, "auth.expired", {
          reason: "token_expired",
        } satisfies WsProtocol.AuthExpiredPayload, envelope.traceId);
        return;
      }

      client.auth = verified;
      sendEnvelope(client, "auth.ok", {
        userId: verified.userId,
        nickname: buildNickname(verified.userId),
        sessionId: verified.sessionId,
      } satisfies WsProtocol.AuthOkPayload, envelope.traceId);
      return;
    }

    case "matchmaking.start": {
      if (!ensureAuthed(client)) {
        sendError(
          client,
          PROTOCOL_ERROR.WS_UNAUTHORIZED,
          "Authenticate first with auth.resume.",
          false,
        );
        return;
      }
      const payload = envelope.payload as WsProtocol.MatchmakingStartPayload;
      startMockQueue(client, payload.modeId);
      return;
    }

    case "matchmaking.cancel": {
      if (!ensureAuthed(client)) {
        sendError(client, PROTOCOL_ERROR.WS_UNAUTHORIZED, "Unauthorized.", false);
        return;
      }
      const payload = envelope.payload as WsProtocol.MatchmakingCancelPayload;
      cancelQueue(client, payload.queueTicketId);
      return;
    }

    case "room.create": {
      if (!ensureAuthed(client)) {
        sendError(client, PROTOCOL_ERROR.WS_UNAUTHORIZED, "Unauthorized.", false);
        return;
      }
      const payload = envelope.payload as WsProtocol.RoomCreatePayload;
      const roomId = makeId("room");

      leaveCurrentRoom(client, null);

      const room = ensureRoom(roomId, payload.modeId);
      room.maxMembers = Math.max(2, Math.min(50, payload.maxMembers ?? 4));
      room.inviteCode = payload.privateRoom ? Math.random().toString(36).slice(2, 8).toUpperCase() : undefined;
      room.members.push({
        userId: client.auth.userId,
        nickname: buildNickname(client.auth.userId),
        ready: false,
        leader: true,
        team: "observer",
      });
      recalcRoomState(room);

      client.activeRoomId = roomId;
      broadcastRoomState(room);
      return;
    }

    case "room.join": {
      if (!ensureAuthed(client)) {
        sendError(client, PROTOCOL_ERROR.WS_UNAUTHORIZED, "Unauthorized.", false);
        return;
      }
      const payload = envelope.payload as WsProtocol.RoomJoinPayload;
      if (!payload.roomId) {
        sendError(
          client,
          PROTOCOL_ERROR.ROOM_NOT_FOUND,
          "roomId is required in scaffold.",
          false,
        );
        return;
      }

      const room = roomsById.get(payload.roomId);
      if (!room) {
        sendError(client, PROTOCOL_ERROR.ROOM_NOT_FOUND, "Room not found.", false);
        return;
      }
      if (room.members.length >= room.maxMembers) {
        sendError(client, PROTOCOL_ERROR.ROOM_FULL, "Room is full.", false);
        return;
      }

      leaveCurrentRoom(client, null);
      room.members.push({
        userId: client.auth.userId,
        nickname: buildNickname(client.auth.userId),
        ready: false,
        leader: false,
        team: "observer",
      });
      recalcRoomState(room);

      client.activeRoomId = room.roomId;
      broadcastRoomState(room);
      return;
    }

    case "room.leave": {
      if (!ensureAuthed(client)) {
        sendError(client, PROTOCOL_ERROR.WS_UNAUTHORIZED, "Unauthorized.", false);
        return;
      }
      leaveCurrentRoom(client, "disbanded");
      return;
    }

    case "room.ready.set": {
      if (!ensureAuthed(client)) {
        sendError(client, PROTOCOL_ERROR.WS_UNAUTHORIZED, "Unauthorized.", false);
        return;
      }

      if (!client.activeRoomId) {
        sendError(client, PROTOCOL_ERROR.ROOM_NOT_FOUND, "Not in room.", false);
        return;
      }

      const room = roomsById.get(client.activeRoomId);
      if (!room) {
        sendError(client, PROTOCOL_ERROR.ROOM_NOT_FOUND, "Room not found.", false);
        return;
      }

      const payload = envelope.payload as WsProtocol.RoomReadySetPayload;
      const member = room.members.find((m) => m.userId === client.auth.userId);
      if (!member) {
        sendError(client, PROTOCOL_ERROR.ROOM_NOT_MEMBER, "Not room member.", false);
        return;
      }

      member.ready = !!payload.ready;
      recalcRoomState(room);
      broadcastRoomState(room);
      return;
    }

    case "game.input": {
      // Placeholder: authoritative simulation not implemented in this scaffold.
      return;
    }

    default: {
      sendError(
        client,
        PROTOCOL_ERROR.WS_INVALID_MESSAGE,
        `Unsupported event type: ${(envelope as { type?: string }).type ?? "unknown"}`,
        false,
      );
    }
  }
}

function closeClient(client: ClientState, code = 1000, reason = "normal") {
  try {
    leaveCurrentRoom(client, null);

    if (client.activeQueueTicketId) {
      queueByTicketId.delete(client.activeQueueTicketId);
      client.activeQueueTicketId = null;
    }

    clientsByConnectionId.delete(client.connectionId);
    if (client.ws.readyState === client.ws.OPEN || client.ws.readyState === client.ws.CONNECTING) {
      client.ws.close(code, reason);
    }
  } catch {
    // ignore close errors
  }
}

function setupHeartbeatTicker() {
  const timer = setInterval(() => {
    const now = nowMs();

    for (const client of clientsByConnectionId.values()) {
      if (client.ws.readyState !== client.ws.OPEN) {
        closeClient(client, 1001, "socket_not_open");
        continue;
      }

      const inactiveFor = now - client.lastSeenAt;
      if (inactiveFor > config.heartbeatTimeoutMs) {
        log("warn", "Heartbeat timeout, closing client", {
          connectionId: client.connectionId,
          inactiveFor,
        });
        closeClient(client, 4001, "heartbeat_timeout");
        continue;
      }

      // proactive ping frame
      try {
        client.ws.ping();
      } catch {
        closeClient(client, 1006, "ping_failed");
      }
    }
  }, config.heartbeatIntervalMs);

  return timer;
}

wss.on("connection", (ws, req) => {
  const connectionId = makeId("conn");
  const token = parseTokenFromUpgrade(
    req.url ?? "",
    req.headers.authorization as string | undefined,
  );

  const auth = token ? verifyAccessToken(token) : null;
  const client: ClientState = {
    connectionId,
    ws,
    connectedAt: nowMs(),
    lastPingAt: 0,
    lastPongAt: nowMs(),
    lastSeenAt: nowMs(),
    auth: auth ?? null,
    activeRoomId: null,
    activeQueueTicketId: null,
    platform: "unknown",
    appVersion: "0.0.0",
    ip:
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
      req.socket.remoteAddress ??
      "unknown",
  };

  clientsByConnectionId.set(connectionId, client);
  connectionIdBySocket.set(ws, connectionId);

  log("info", "Client connected", {
    connectionId,
    ip: client.ip,
    authed: !!auth,
    userId: auth?.userId ?? null,
  });

  // welcome + optional auth ok
  sendEnvelope(client, "system.welcome", {
    connectionId,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    serverTime: nowMs(),
  } satisfies WsProtocol.ServerWelcomePayload);

  if (auth) {
    sendEnvelope(client, "auth.ok", {
      userId: auth.userId,
      nickname: buildNickname(auth.userId),
      sessionId: auth.sessionId,
    } satisfies WsProtocol.AuthOkPayload);
  }

  ws.on("pong", () => {
    const live = getClientBySocket(ws);
    if (!live) return;
    live.lastPongAt = nowMs();
    live.lastSeenAt = nowMs();
  });

  ws.on("message", (raw) => {
    const live = getClientBySocket(ws);
    if (!live) return;
    handleClientEvent(live, raw.toString("utf-8"));
  });

  ws.on("close", (code, reasonBuffer) => {
    const live = getClientBySocket(ws);
    if (!live) return;

    const reason = reasonBuffer.toString("utf-8");
    log("info", "Client closed", {
      connectionId: live.connectionId,
      code,
      reason,
      userId: live.auth?.userId ?? null,
    });

    closeClient(live, 1000, "closed");
  });

  ws.on("error", (error) => {
    const live = getClientBySocket(ws);
    log("error", "Socket error", {
      connectionId: live?.connectionId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
    if (live) {
      closeClient(live, 1011, "socket_error");
    }
  });
});

const heartbeatTimer = setupHeartbeatTicker();

httpServer.listen(config.port, config.host, () => {
  log("info", "Game WS gateway started", {
    host: config.host,
    port: config.port,
    path: config.path,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    heartbeatTimeoutMs: config.heartbeatTimeoutMs,
  });
});

function shutdown(signal: NodeJS.Signals) {
  log("warn", "Shutdown signal received", { signal });

  clearInterval(heartbeatTimer);

  for (const client of clientsByConnectionId.values()) {
    closeClient(client, 1001, "server_shutdown");
  }

  wss.close(() => {
    httpServer.close(() => {
      log("info", "Game WS gateway stopped");
      process.exit(0);
    });
  });

  // force exit guard
  setTimeout(() => {
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
