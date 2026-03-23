import { MODE_CONFIG, PROTOCOL_ERROR } from "./constants.js";
import { dbFirst, dbRun } from "./db.js";
import { requireAuth } from "./auth-handlers.js";
import {
  clampNonNegativeInteger,
  failure,
  isSupportedModeId,
  nowIso,
  randomInt,
  readJson,
  success,
} from "./helpers.js";

function getPublicWsUrl(request, env) {
  const configured = String(env?.PUBLIC_WS_URL || "").trim();
  if (configured) {
    return configured;
  }
  const url = new URL(request.url);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function materializeTicketState(db, request, env, storedTicket) {
  if (!storedTicket) {
    return null;
  }

  const now = Date.now();
  const queuedAtMs = Date.parse(storedTicket.queued_at);
  const waitMs = Math.max(
    1_000,
    clampNonNegativeInteger(storedTicket.estimated_wait_seconds, 1) * 1000,
  );

  if (storedTicket.stage === "searching" && now - queuedAtMs >= waitMs) {
    const matchedAt = nowIso();
    const roomId = storedTicket.room_id || `room_${crypto.randomUUID().replaceAll("-", "")}`;
    const matchId = storedTicket.match_id || `match_${crypto.randomUUID().replaceAll("-", "")}`;

    await dbRun(
      db,
      `
        UPDATE matchmaking_tickets
        SET
          stage = 'matched',
          current_players = target_players,
          room_id = ?,
          match_id = ?,
          updated_at = ?
        WHERE ticket_id = ?
      `,
      [roomId, matchId, matchedAt, storedTicket.ticket_id],
    );

    storedTicket = {
      ...storedTicket,
      stage: "matched",
      current_players: storedTicket.target_players,
      room_id: roomId,
      match_id: matchId,
      updated_at: matchedAt,
    };
  }

  const progress =
    storedTicket.stage === "searching"
      ? Math.max(0, Math.min(1, (now - queuedAtMs) / waitMs))
      : 1;
  const dynamicPlayers =
    storedTicket.stage === "searching"
      ? Math.min(
          clampNonNegativeInteger(storedTicket.target_players, 0),
          clampNonNegativeInteger(storedTicket.current_players, 0) +
            Math.floor(
              (clampNonNegativeInteger(storedTicket.target_players, 0) -
                clampNonNegativeInteger(storedTicket.current_players, 0)) *
                progress,
            ),
        )
      : clampNonNegativeInteger(
          storedTicket.stage === "matched"
            ? storedTicket.target_players
            : storedTicket.current_players,
          0,
        );

  return {
    ticketId: storedTicket.ticket_id,
    userId: storedTicket.user_id,
    modeId: storedTicket.mode_id,
    stage: storedTicket.stage,
    queuedAt: storedTicket.queued_at,
    updatedAt:
      storedTicket.stage === "searching" ? nowIso() : storedTicket.updated_at,
    estimatedWaitSeconds:
      storedTicket.stage === "searching"
        ? Math.max(0, Math.ceil((waitMs - (now - queuedAtMs)) / 1000))
        : 0,
    currentPlayers: dynamicPlayers,
    targetPlayers: clampNonNegativeInteger(storedTicket.target_players, 0),
    minStartPlayers: clampNonNegativeInteger(storedTicket.min_start_players, 0),
    region: storedTicket.region || undefined,
    failureCode: storedTicket.failure_code || undefined,
    failureMessage: storedTicket.failure_message || undefined,
    matchFound:
      storedTicket.stage === "matched"
        ? {
            ticketId: storedTicket.ticket_id,
            matchId: storedTicket.match_id,
            roomId: storedTicket.room_id,
            modeId: storedTicket.mode_id,
            server: {
              region: storedTicket.region || "ap-east-1",
              wsUrl: getPublicWsUrl(request, env),
            },
            players: {
              current: clampNonNegativeInteger(storedTicket.target_players, 0),
              target: clampNonNegativeInteger(storedTicket.target_players, 0),
            },
            joinedAt: storedTicket.updated_at,
            confirmationDeadlineAt: new Date(
              Date.parse(storedTicket.updated_at) + 15_000,
            ).toISOString(),
          }
        : undefined,
  };
}

export async function handleMatchmakingStart(request, env, requestId) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const body = (await readJson(request)) || {};
  if (!isSupportedModeId(body.modeId)) {
    return failure(
      request,
      requestId,
      400,
      PROTOCOL_ERROR.INVALID_REQUEST,
      "Invalid modeId.",
      { field: "modeId", reason: "unsupported_mode" },
    );
  }

  const existingRow = await dbFirst(
    required.auth.db,
    `
      SELECT ticket_id
      FROM matchmaking_tickets
      WHERE user_id = ? AND stage IN ('searching', 'confirming', 'matched')
      ORDER BY datetime(queued_at) DESC
      LIMIT 1
    `,
    [required.auth.userId],
  );
  if (existingRow?.ticket_id) {
    const existingTicket = await dbFirst(
      required.auth.db,
      "SELECT * FROM matchmaking_tickets WHERE ticket_id = ? LIMIT 1",
      [existingRow.ticket_id],
    );
    const materialized = await materializeTicketState(
      required.auth.db,
      request,
      env,
      existingTicket,
    );
    return failure(
      request,
      requestId,
      409,
      PROTOCOL_ERROR.MATCH_ALREADY_IN_QUEUE,
      "User already has an active ticket.",
      {
        ticketId: materialized?.ticketId,
        stage: materialized?.stage,
      },
    );
  }

  const config = MODE_CONFIG[body.modeId];
  const ticketId = `mm_${crypto.randomUUID().replaceAll("-", "")}`;
  const queuedAt = nowIso();
  const currentPlayers = randomInt(
    Math.max(1, Math.floor(config.minStartPlayers / 2)),
    config.minStartPlayers,
  );

  await dbRun(
    required.auth.db,
    `
      INSERT INTO matchmaking_tickets (
        ticket_id,
        user_id,
        mode_id,
        stage,
        region,
        estimated_wait_seconds,
        current_players,
        target_players,
        min_start_players,
        match_id,
        room_id,
        failure_code,
        failure_message,
        queued_at,
        updated_at,
        cancelled_at
      ) VALUES (?, ?, ?, 'searching', ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, NULL)
    `,
    [
      ticketId,
      required.auth.userId,
      body.modeId,
      typeof body.region === "string" && body.region.trim()
        ? body.region.trim()
        : "ap-east-1",
      config.expectedSeconds,
      currentPlayers,
      config.targetPlayers,
      config.minStartPlayers,
      queuedAt,
      queuedAt,
    ],
  );

  return success(request, requestId, {
    ticketId,
    modeId: body.modeId,
    stage: "searching",
    queuedAt,
    estimatedWaitSeconds: config.expectedSeconds,
    minStartPlayers: config.minStartPlayers,
    targetPlayers: config.targetPlayers,
  });
}

export async function handleMatchmakingCancel(request, env, requestId) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const body = (await readJson(request)) || {};
  const ticketId = typeof body.ticketId === "string" ? body.ticketId.trim() : "";
  if (!ticketId) {
    return failure(
      request,
      requestId,
      400,
      PROTOCOL_ERROR.INVALID_REQUEST,
      "ticketId is required.",
      { field: "ticketId", reason: "required" },
    );
  }

  const stored = await dbFirst(
    required.auth.db,
    "SELECT * FROM matchmaking_tickets WHERE ticket_id = ? LIMIT 1",
    [ticketId],
  );
  const ticket = stored
    ? await materializeTicketState(required.auth.db, request, env, stored)
    : null;
  if (!ticket || ticket.userId !== required.auth.userId) {
    return failure(
      request,
      requestId,
      404,
      PROTOCOL_ERROR.MATCH_NOT_IN_QUEUE,
      "Ticket not found for current user.",
      { ticketId },
    );
  }

  if (ticket.stage === "matched") {
    return failure(
      request,
      requestId,
      409,
      PROTOCOL_ERROR.CONFLICT,
      "Cannot cancel after match is found.",
      { ticketId: ticket.ticketId, stage: ticket.stage },
    );
  }

  const cancelledAt = nowIso();
  await dbRun(
    required.auth.db,
    `
      UPDATE matchmaking_tickets
      SET stage = 'cancelled', cancelled_at = ?, updated_at = ?
      WHERE ticket_id = ?
    `,
    [cancelledAt, cancelledAt, ticketId],
  );

  return success(request, requestId, {
    ticketId,
    stage: "cancelled",
    cancelledAt,
  });
}

export async function handleMatchmakingStatus(request, env, requestId, ticketId) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const stored = await dbFirst(
    required.auth.db,
    "SELECT * FROM matchmaking_tickets WHERE ticket_id = ? LIMIT 1",
    [ticketId],
  );
  if (!stored || stored.user_id !== required.auth.userId) {
    return failure(
      request,
      requestId,
      404,
      PROTOCOL_ERROR.MATCH_NOT_IN_QUEUE,
      "Ticket not found for current user.",
      { ticketId },
    );
  }

  const ticket = await materializeTicketState(required.auth.db, request, env, stored);
  return success(request, requestId, ticket);
}

export async function handleMatchmakingActive(request, env, requestId) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const stored = await dbFirst(
    required.auth.db,
    `
      SELECT *
      FROM matchmaking_tickets
      WHERE user_id = ? AND stage IN ('searching', 'confirming', 'matched')
      ORDER BY datetime(queued_at) DESC
      LIMIT 1
    `,
    [required.auth.userId],
  );

  const ticket = stored
    ? await materializeTicketState(required.auth.db, request, env, stored)
    : null;
  return success(request, requestId, { ticket });
}
