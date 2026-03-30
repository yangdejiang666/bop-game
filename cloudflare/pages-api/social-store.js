import {
  dbAll,
  dbFirst,
  dbRun,
  generateUniqueGameId,
  isUniqueConstraintError,
  normalizeGameId,
} from "./db.js";
import { newId, nowIso } from "./helpers.js";

const ONLINE_WINDOW_MS = 60_000;

function normalizePair(leftUserId, rightUserId) {
  return leftUserId < rightUserId
    ? [leftUserId, rightUserId]
    : [rightUserId, leftUserId];
}

function isOnlineFromLastSeen(lastSeenAt) {
  if (!lastSeenAt) {
    return false;
  }
  const ts = Date.parse(lastSeenAt);
  if (Number.isNaN(ts)) {
    return false;
  }
  return Date.now() - ts <= ONLINE_WINDOW_MS;
}

function mapUserCard(row) {
  return {
    userId: row.user_id,
    gameId: row.game_id || row.user_id,
    nickname: row.nickname,
    avatarUrl: row.avatar_url || null,
  };
}

function mapFriendRow(row) {
  return {
    userId: row.user_id,
    gameId: row.game_id || row.user_id,
    nickname: row.nickname,
    avatarUrl: row.avatar_url || null,
    isOnline: isOnlineFromLastSeen(row.last_seen_at || null),
    lastSeenAt: row.last_seen_at || null,
    friendedAt: row.friended_at,
  };
}

export async function ensureUserGameId(db, userId) {
  const existing = await dbFirst(
    db,
    `
      SELECT game_id
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    [userId],
  );

  if (!existing) {
    return null;
  }

  const normalized = normalizeGameId(existing.game_id);
  if (normalized) {
    return normalized;
  }

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const candidate = await generateUniqueGameId(db);
    try {
      await dbRun(
        db,
        `
          UPDATE users
          SET
            game_id = ?,
            updated_at = ?
          WHERE id = ? AND (game_id IS NULL OR TRIM(game_id) = '')
        `,
        [candidate, nowIso(), userId],
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        continue;
      }
      throw error;
    }

    const verified = await dbFirst(
      db,
      `
        SELECT game_id
        FROM users
        WHERE id = ?
        LIMIT 1
      `,
      [userId],
    );
    const verifiedGameId = normalizeGameId(verified?.game_id);
    if (verifiedGameId) {
      return verifiedGameId;
    }
  }

  throw new Error(`Failed to ensure game_id for user ${userId}.`);
}

export async function findUserByGameId(db, gameId) {
  const normalized = normalizeGameId(gameId);
  if (!normalized) {
    return null;
  }

  const row = await dbFirst(
    db,
    `
      SELECT
        u.id AS user_id,
        u.game_id AS game_id,
        u.status AS status,
        p.nickname AS nickname,
        p.avatar_url AS avatar_url
      FROM users u
      INNER JOIN user_profiles p ON p.user_id = u.id
      WHERE u.game_id = ?
      LIMIT 1
    `,
    [normalized],
  );

  if (!row || row.status !== "active") {
    return null;
  }

  return row;
}

export async function findUserById(db, userId) {
  return dbFirst(
    db,
    `
      SELECT
        u.id AS user_id,
        u.game_id AS game_id,
        u.status AS status,
        p.nickname AS nickname,
        p.avatar_url AS avatar_url
      FROM users u
      INNER JOIN user_profiles p ON p.user_id = u.id
      WHERE u.id = ?
      LIMIT 1
    `,
    [userId],
  );
}

async function hasBlock(db, blockerUserId, blockedUserId) {
  const row = await dbFirst(
    db,
    `
      SELECT id
      FROM social_blocks
      WHERE blocker_user_id = ? AND blocked_user_id = ?
      LIMIT 1
    `,
    [blockerUserId, blockedUserId],
  );
  return Boolean(row?.id);
}

async function findPendingRequest(db, requesterUserId, targetUserId) {
  return dbFirst(
    db,
    `
      SELECT id, requester_user_id, target_user_id
      FROM social_friend_requests
      WHERE requester_user_id = ? AND target_user_id = ? AND status = 'pending'
      LIMIT 1
    `,
    [requesterUserId, targetUserId],
  );
}

async function hasFriendship(db, leftUserId, rightUserId) {
  const [userLow, userHigh] = normalizePair(leftUserId, rightUserId);
  const row = await dbFirst(
    db,
    `
      SELECT id
      FROM social_friendships
      WHERE user_low = ? AND user_high = ?
      LIMIT 1
    `,
    [userLow, userHigh],
  );
  return Boolean(row?.id);
}

async function ensureFriendship(db, leftUserId, rightUserId, createdByUserId) {
  const [userLow, userHigh] = normalizePair(leftUserId, rightUserId);
  const existing = await dbFirst(
    db,
    `
      SELECT id, created_at
      FROM social_friendships
      WHERE user_low = ? AND user_high = ?
      LIMIT 1
    `,
    [userLow, userHigh],
  );
  if (existing?.id) {
    return {
      friendshipId: existing.id,
      createdAt: existing.created_at,
    };
  }

  const friendshipId = newId("fship");
  const createdAt = nowIso();
  await dbRun(
    db,
    `
      INSERT INTO social_friendships (id, user_low, user_high, created_at, created_by_user_id)
      VALUES (?, ?, ?, ?, ?)
    `,
    [friendshipId, userLow, userHigh, createdAt, createdByUserId],
  );

  return {
    friendshipId,
    createdAt,
  };
}

async function cancelPendingPairRequests(db, leftUserId, rightUserId, reasonTimestamp) {
  await dbRun(
    db,
    `
      UPDATE social_friend_requests
      SET
        status = 'cancelled',
        updated_at = ?,
        responded_at = COALESCE(responded_at, ?)
      WHERE status = 'pending'
        AND (
          (requester_user_id = ? AND target_user_id = ?)
          OR (requester_user_id = ? AND target_user_id = ?)
        )
    `,
    [
      reasonTimestamp,
      reasonTimestamp,
      leftUserId,
      rightUserId,
      rightUserId,
      leftUserId,
    ],
  );
}

async function getFriendByUserId(db, userId, friendUserId) {
  const [userLow, userHigh] = normalizePair(userId, friendUserId);
  const row = await dbFirst(
    db,
    `
      SELECT
        u.id AS user_id,
        u.game_id AS game_id,
        p.nickname AS nickname,
        p.avatar_url AS avatar_url,
        f.created_at AS friended_at,
        s.last_seen_at AS last_seen_at
      FROM social_friendships f
      INNER JOIN users u ON u.id = ?
      INNER JOIN user_profiles p ON p.user_id = u.id
      LEFT JOIN (
        SELECT user_id, MAX(last_seen_at) AS last_seen_at
        FROM auth_sessions
        WHERE revoked_at IS NULL
        GROUP BY user_id
      ) s ON s.user_id = u.id
      WHERE f.user_low = ? AND f.user_high = ?
      LIMIT 1
    `,
    [friendUserId, userLow, userHigh],
  );

  return row ? mapFriendRow(row) : null;
}

export async function getRelationshipStatus(db, viewerUserId, targetUserId) {
  if (viewerUserId === targetUserId) {
    return "self";
  }

  if (await hasBlock(db, viewerUserId, targetUserId)) {
    return "blocked_by_you";
  }
  if (await hasBlock(db, targetUserId, viewerUserId)) {
    return "blocked_you";
  }
  if (await hasFriendship(db, viewerUserId, targetUserId)) {
    return "friend";
  }
  if (await findPendingRequest(db, targetUserId, viewerUserId)) {
    return "incoming_pending";
  }
  if (await findPendingRequest(db, viewerUserId, targetUserId)) {
    return "outgoing_pending";
  }
  return "none";
}

export async function searchUserByGameIdForViewer(db, viewerUserId, gameId) {
  const user = await findUserByGameId(db, gameId);
  if (!user) {
    return {
      found: false,
      user: null,
      relationship: "not_found",
      canSendFriendRequest: false,
    };
  }

  const relationship = await getRelationshipStatus(db, viewerUserId, user.user_id);
  if (relationship === "blocked_by_you" || relationship === "blocked_you") {
    return {
      found: false,
      user: null,
      relationship: "not_found",
      canSendFriendRequest: false,
    };
  }

  return {
    found: true,
    user: mapUserCard(user),
    relationship,
    canSendFriendRequest: relationship === "none",
  };
}

export async function getSocialOverviewByUserId(db, userId) {
  const meGameId = await ensureUserGameId(db, userId);

  const friendsRows = await dbAll(
    db,
    `
      SELECT
        u.id AS user_id,
        u.game_id AS game_id,
        p.nickname AS nickname,
        p.avatar_url AS avatar_url,
        f.created_at AS friended_at,
        s.last_seen_at AS last_seen_at
      FROM social_friendships f
      INNER JOIN users u ON u.id = CASE WHEN f.user_low = ? THEN f.user_high ELSE f.user_low END
      INNER JOIN user_profiles p ON p.user_id = u.id
      LEFT JOIN (
        SELECT user_id, MAX(last_seen_at) AS last_seen_at
        FROM auth_sessions
        WHERE revoked_at IS NULL
        GROUP BY user_id
      ) s ON s.user_id = u.id
      WHERE f.user_low = ? OR f.user_high = ?
      ORDER BY datetime(f.created_at) DESC
    `,
    [userId, userId, userId],
  );

  const incomingRows = await dbAll(
    db,
    `
      SELECT
        r.id AS request_id,
        r.created_at AS created_at,
        u.id AS user_id,
        u.game_id AS game_id,
        p.nickname AS nickname,
        p.avatar_url AS avatar_url
      FROM social_friend_requests r
      INNER JOIN users u ON u.id = r.requester_user_id
      INNER JOIN user_profiles p ON p.user_id = u.id
      WHERE r.target_user_id = ? AND r.status = 'pending'
      ORDER BY datetime(r.created_at) DESC
    `,
    [userId],
  );

  const outgoingRows = await dbAll(
    db,
    `
      SELECT
        r.id AS request_id,
        r.created_at AS created_at,
        u.id AS user_id,
        u.game_id AS game_id,
        p.nickname AS nickname,
        p.avatar_url AS avatar_url
      FROM social_friend_requests r
      INNER JOIN users u ON u.id = r.target_user_id
      INNER JOIN user_profiles p ON p.user_id = u.id
      WHERE r.requester_user_id = ? AND r.status = 'pending'
      ORDER BY datetime(r.created_at) DESC
    `,
    [userId],
  );

  const blockRows = await dbAll(
    db,
    `
      SELECT
        b.created_at AS blocked_at,
        u.id AS user_id,
        u.game_id AS game_id,
        p.nickname AS nickname,
        p.avatar_url AS avatar_url
      FROM social_blocks b
      INNER JOIN users u ON u.id = b.blocked_user_id
      INNER JOIN user_profiles p ON p.user_id = u.id
      WHERE b.blocker_user_id = ?
      ORDER BY datetime(b.created_at) DESC
    `,
    [userId],
  );

  return {
    me: {
      userId,
      gameId: meGameId || "",
    },
    counts: {
      friends: friendsRows.length,
      incomingRequests: incomingRows.length,
      outgoingRequests: outgoingRows.length,
      blocks: blockRows.length,
    },
    friends: friendsRows.map(mapFriendRow),
    incomingRequests: incomingRows.map((row) => ({
      requestId: row.request_id,
      direction: "incoming",
      status: "pending",
      counterpart: mapUserCard(row),
      createdAt: row.created_at,
    })),
    outgoingRequests: outgoingRows.map((row) => ({
      requestId: row.request_id,
      direction: "outgoing",
      status: "pending",
      counterpart: mapUserCard(row),
      createdAt: row.created_at,
    })),
    blocks: blockRows.map((row) => ({
      userId: row.user_id,
      gameId: row.game_id,
      nickname: row.nickname,
      avatarUrl: row.avatar_url || null,
      blockedAt: row.blocked_at,
    })),
  };
}

export async function createFriendRequest(db, requesterUserId, targetUserId) {
  if (requesterUserId === targetUserId) {
    return { status: "cannot_add_self" };
  }

  if (
    (await hasBlock(db, requesterUserId, targetUserId)) ||
    (await hasBlock(db, targetUserId, requesterUserId))
  ) {
    return { status: "blocked" };
  }

  if (await hasFriendship(db, requesterUserId, targetUserId)) {
    return { status: "already_friends" };
  }

  const existingOutgoing = await findPendingRequest(db, requesterUserId, targetUserId);
  if (existingOutgoing) {
    return { status: "already_pending", requestId: existingOutgoing.id };
  }

  const existingIncoming = await findPendingRequest(db, targetUserId, requesterUserId);
  if (existingIncoming) {
    const timestamp = nowIso();
    await dbRun(
      db,
      `
        UPDATE social_friend_requests
        SET
          status = 'accepted',
          updated_at = ?,
          responded_at = ?
        WHERE id = ?
      `,
      [timestamp, timestamp, existingIncoming.id],
    );

    await ensureFriendship(db, requesterUserId, targetUserId, requesterUserId);
    await cancelPendingPairRequests(db, requesterUserId, targetUserId, timestamp);
    const friend = await getFriendByUserId(db, requesterUserId, targetUserId);
    return {
      status: "auto_accepted",
      requestId: existingIncoming.id,
      friend,
    };
  }

  const requestId = newId("frequest");
  const createdAt = nowIso();
  try {
    await dbRun(
      db,
      `
        INSERT INTO social_friend_requests (
          id,
          requester_user_id,
          target_user_id,
          status,
          created_at,
          updated_at,
          responded_at
        ) VALUES (?, ?, ?, 'pending', ?, ?, NULL)
      `,
      [requestId, requesterUserId, targetUserId, createdAt, createdAt],
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { status: "already_pending" };
    }
    throw error;
  }

  return {
    status: "pending",
    requestId,
  };
}

export async function acceptFriendRequest(db, requestId, accepterUserId) {
  const request = await dbFirst(
    db,
    `
      SELECT id, requester_user_id, target_user_id, status
      FROM social_friend_requests
      WHERE id = ?
      LIMIT 1
    `,
    [requestId],
  );

  if (!request) {
    return { status: "request_not_found" };
  }
  if (request.status !== "pending") {
    return { status: "request_handled" };
  }
  if (request.target_user_id !== accepterUserId) {
    return { status: "request_not_found" };
  }
  if (
    (await hasBlock(db, request.requester_user_id, request.target_user_id)) ||
    (await hasBlock(db, request.target_user_id, request.requester_user_id))
  ) {
    return { status: "blocked" };
  }

  const timestamp = nowIso();
  await dbRun(
    db,
    `
      UPDATE social_friend_requests
      SET
        status = 'accepted',
        updated_at = ?,
        responded_at = ?
      WHERE id = ?
    `,
    [timestamp, timestamp, requestId],
  );
  await ensureFriendship(
    db,
    request.requester_user_id,
    request.target_user_id,
    accepterUserId,
  );
  await cancelPendingPairRequests(
    db,
    request.requester_user_id,
    request.target_user_id,
    timestamp,
  );

  const friend = await getFriendByUserId(db, accepterUserId, request.requester_user_id);
  return {
    status: "accepted",
    friend,
  };
}

export async function rejectFriendRequest(db, requestId, rejectorUserId) {
  const request = await dbFirst(
    db,
    `
      SELECT id, target_user_id, status
      FROM social_friend_requests
      WHERE id = ?
      LIMIT 1
    `,
    [requestId],
  );
  if (!request) {
    return { status: "request_not_found" };
  }
  if (request.status !== "pending") {
    return { status: "request_handled" };
  }
  if (request.target_user_id !== rejectorUserId) {
    return { status: "request_not_found" };
  }

  const timestamp = nowIso();
  await dbRun(
    db,
    `
      UPDATE social_friend_requests
      SET
        status = 'rejected',
        updated_at = ?,
        responded_at = ?
      WHERE id = ?
    `,
    [timestamp, timestamp, requestId],
  );

  return { status: "rejected" };
}

export async function removeFriendship(db, actorUserId, targetUserId) {
  const [userLow, userHigh] = normalizePair(actorUserId, targetUserId);
  const existing = await dbFirst(
    db,
    `
      SELECT id
      FROM social_friendships
      WHERE user_low = ? AND user_high = ?
      LIMIT 1
    `,
    [userLow, userHigh],
  );
  if (!existing) {
    return { status: "not_friends" };
  }

  await dbRun(
    db,
    `
      DELETE FROM social_friendships
      WHERE user_low = ? AND user_high = ?
    `,
    [userLow, userHigh],
  );

  return { status: "removed" };
}

export async function addBlock(db, blockerUserId, blockedUserId) {
  if (blockerUserId === blockedUserId) {
    return { status: "cannot_block_self" };
  }

  const timestamp = nowIso();
  const blockId = newId("block");
  try {
    await dbRun(
      db,
      `
        INSERT INTO social_blocks (id, blocker_user_id, blocked_user_id, created_at)
        VALUES (?, ?, ?, ?)
      `,
      [blockId, blockerUserId, blockedUserId, timestamp],
    );
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
  }

  const [userLow, userHigh] = normalizePair(blockerUserId, blockedUserId);
  await dbRun(
    db,
    `
      DELETE FROM social_friendships
      WHERE user_low = ? AND user_high = ?
    `,
    [userLow, userHigh],
  );
  await cancelPendingPairRequests(db, blockerUserId, blockedUserId, timestamp);

  const blockedUser = await findUserById(db, blockedUserId);
  return {
    status: "blocked",
    blocked: blockedUser
      ? {
          userId: blockedUser.user_id,
          gameId: blockedUser.game_id || blockedUser.user_id,
          nickname: blockedUser.nickname,
          avatarUrl: blockedUser.avatar_url || null,
          blockedAt: timestamp,
        }
      : null,
  };
}

export async function removeBlock(db, blockerUserId, blockedUserId) {
  await dbRun(
    db,
    `
      DELETE FROM social_blocks
      WHERE blocker_user_id = ? AND blocked_user_id = ?
    `,
    [blockerUserId, blockedUserId],
  );
  return { status: "unblocked" };
}
