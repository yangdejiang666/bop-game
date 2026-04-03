import type {
  SocialBlockEntry,
  SocialFriend,
  SocialFriendRequest,
  SocialOverview,
  SocialRelationship,
  SocialSearchResult,
} from "@bop/shared-protocol";
import type { QueryResultRow } from "pg";
import type { DbExecutor } from "../lib/db.js";
import { query } from "../lib/db.js";
import {
  findActiveUserDirectoryEntryByGameId,
  getActiveUserDirectoryEntriesByUserIds,
  getActiveUserDirectoryEntryByUserId,
  isUserDirectoryEntryOnline,
} from "./userDirectoryRepository.js";

interface FriendEdgeRow extends QueryResultRow {
  friend_user_id: string;
  created_at: string;
}

interface FriendRequestRow extends QueryResultRow {
  request_id: string;
  sender_user_id: string;
  receiver_user_id: string;
  status: "pending" | "accepted" | "rejected" | "cancelled";
  created_at: string;
}

interface BlockRow extends QueryResultRow {
  blocked_user_id: string;
  created_at: string;
}

type Executor = DbExecutor;

function getExecutor(executor?: Executor): Executor {
  return (
    executor ?? {
      query: (text, params) => query(text, params),
    }
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function createRequestId(): string {
  return `friend_${crypto.randomUUID().replaceAll("-", "")}`;
}

function toFriend(
  entry: Awaited<ReturnType<typeof getActiveUserDirectoryEntryByUserId>> extends infer T
    ? NonNullable<T>
    : never,
  friendedAt: string,
): SocialFriend {
  return {
    userId: entry.userId,
    gameId: entry.gameId,
    nickname: entry.nickname,
    avatarUrl: entry.avatarUrl,
    isOnline: isUserDirectoryEntryOnline(entry),
    lastSeenAt: entry.lastSeenAt,
    friendedAt,
  };
}

function toBlockEntry(
  entry: Awaited<ReturnType<typeof getActiveUserDirectoryEntryByUserId>> extends infer T
    ? NonNullable<T>
    : never,
  blockedAt: string,
): SocialBlockEntry {
  return {
    userId: entry.userId,
    gameId: entry.gameId,
    nickname: entry.nickname,
    avatarUrl: entry.avatarUrl,
    blockedAt,
  };
}

async function hasBlock(
  userId: string,
  blockedUserId: string,
  executor?: Executor,
): Promise<boolean> {
  const db = getExecutor(executor);
  const result = await db.query<{ exists: boolean } & QueryResultRow>(
    `
      SELECT TRUE AS exists
      FROM social_blocks
      WHERE user_id = $1
        AND blocked_user_id = $2
      LIMIT 1
    `,
    [userId, blockedUserId],
  );

  return Boolean(result.rows[0]?.exists);
}

async function areFriends(
  userId: string,
  friendUserId: string,
  executor?: Executor,
): Promise<boolean> {
  const db = getExecutor(executor);
  const result = await db.query<{ exists: boolean } & QueryResultRow>(
    `
      SELECT TRUE AS exists
      FROM social_friend_edges
      WHERE user_id = $1
        AND friend_user_id = $2
      LIMIT 1
    `,
    [userId, friendUserId],
  );

  return Boolean(result.rows[0]?.exists);
}

async function getPendingRequest(
  senderUserId: string,
  receiverUserId: string,
  executor?: Executor,
): Promise<FriendRequestRow | null> {
  const db = getExecutor(executor);
  const result = await db.query<FriendRequestRow>(
    `
      SELECT
        request_id,
        sender_user_id,
        receiver_user_id,
        status,
        created_at
      FROM social_friend_requests
      WHERE sender_user_id = $1
        AND receiver_user_id = $2
        AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [senderUserId, receiverUserId],
  );

  return result.rows[0] ?? null;
}

async function cancelPendingPairRequests(
  leftUserId: string,
  rightUserId: string,
  handledAt: string,
  keepRequestId: string | null,
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  await db.query(
    `
      UPDATE social_friend_requests
      SET
        status = 'cancelled',
        handled_at = COALESCE(handled_at, $3),
        updated_at = NOW()
      WHERE status = 'pending'
        AND (
          (sender_user_id = $1 AND receiver_user_id = $2)
          OR
          (sender_user_id = $2 AND receiver_user_id = $1)
        )
        AND ($4::text IS NULL OR request_id <> $4)
    `,
    [leftUserId, rightUserId, handledAt, keepRequestId],
  );
}

async function createFriendEdges(
  leftUserId: string,
  rightUserId: string,
  createdAt: string,
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  await db.query(
    `
      INSERT INTO social_friend_edges (
        user_id,
        friend_user_id,
        created_at,
        updated_at
      )
      VALUES
        ($1, $2, $3, $3),
        ($2, $1, $3, $3)
      ON CONFLICT (user_id, friend_user_id) DO UPDATE
      SET updated_at = EXCLUDED.updated_at
    `,
    [leftUserId, rightUserId, createdAt],
  );
}

async function resolveRelationship(
  viewerUserId: string,
  targetUserId: string,
  executor?: Executor,
): Promise<{ relationship: SocialRelationship; blocked: boolean }> {
  if (viewerUserId === targetUserId) {
    return {
      relationship: "self",
      blocked: false,
    };
  }

  if (
    (await hasBlock(viewerUserId, targetUserId, executor)) ||
    (await hasBlock(targetUserId, viewerUserId, executor))
  ) {
    return {
      relationship: "none",
      blocked: true,
    };
  }

  if (await areFriends(viewerUserId, targetUserId, executor)) {
    return {
      relationship: "friend",
      blocked: false,
    };
  }

  if (await getPendingRequest(targetUserId, viewerUserId, executor)) {
    return {
      relationship: "incoming_pending",
      blocked: false,
    };
  }

  if (await getPendingRequest(viewerUserId, targetUserId, executor)) {
    return {
      relationship: "outgoing_pending",
      blocked: false,
    };
  }

  return {
    relationship: "none",
    blocked: false,
  };
}

async function buildFriendByUserId(
  userId: string,
  friendedAt: string,
  executor?: Executor,
): Promise<SocialFriend | null> {
  const entry = await getActiveUserDirectoryEntryByUserId(userId, executor);
  return entry ? toFriend(entry, friendedAt) : null;
}

export async function getSocialOverviewByUserId(
  userId: string,
  executor?: Executor,
): Promise<SocialOverview> {
  const db = getExecutor(executor);
  const meEntry = await getActiveUserDirectoryEntryByUserId(userId, db);

  const friendEdges = await db.query<FriendEdgeRow>(
    `
      SELECT friend_user_id, created_at
      FROM social_friend_edges
      WHERE user_id = $1
      ORDER BY created_at DESC
    `,
    [userId],
  );
  const incomingRequests = await db.query<FriendRequestRow>(
    `
      SELECT
        request_id,
        sender_user_id,
        receiver_user_id,
        status,
        created_at
      FROM social_friend_requests
      WHERE receiver_user_id = $1
        AND status = 'pending'
      ORDER BY created_at DESC
    `,
    [userId],
  );
  const outgoingRequests = await db.query<FriendRequestRow>(
    `
      SELECT
        request_id,
        sender_user_id,
        receiver_user_id,
        status,
        created_at
      FROM social_friend_requests
      WHERE sender_user_id = $1
        AND status = 'pending'
      ORDER BY created_at DESC
    `,
    [userId],
  );
  const blocks = await db.query<BlockRow>(
    `
      SELECT blocked_user_id, created_at
      FROM social_blocks
      WHERE user_id = $1
      ORDER BY created_at DESC
    `,
    [userId],
  );

  const hydrateIds = [
    ...friendEdges.rows.map((row) => row.friend_user_id),
    ...incomingRequests.rows.map((row) => row.sender_user_id),
    ...outgoingRequests.rows.map((row) => row.receiver_user_id),
    ...blocks.rows.map((row) => row.blocked_user_id),
  ];

  const directoryByUserId = await getActiveUserDirectoryEntriesByUserIds(
    hydrateIds,
    db,
  );

  const friends = friendEdges.rows
    .map((row) => {
      const entry = directoryByUserId.get(row.friend_user_id);
      return entry ? toFriend(entry, row.created_at) : null;
    })
    .filter((value): value is SocialFriend => value !== null);

  const incoming: SocialFriendRequest[] = incomingRequests.rows.flatMap((row) => {
      const entry = directoryByUserId.get(row.sender_user_id);
      if (!entry) {
        return [];
      }

      return [{
        requestId: row.request_id,
        direction: "incoming",
        status: "pending",
        counterpart: {
          userId: entry.userId,
          gameId: entry.gameId,
          nickname: entry.nickname,
          avatarUrl: entry.avatarUrl,
        },
        createdAt: row.created_at,
      } satisfies SocialFriendRequest];
    });

  const outgoing: SocialFriendRequest[] = outgoingRequests.rows.flatMap((row) => {
      const entry = directoryByUserId.get(row.receiver_user_id);
      if (!entry) {
        return [];
      }

      return [{
        requestId: row.request_id,
        direction: "outgoing",
        status: "pending",
        counterpart: {
          userId: entry.userId,
          gameId: entry.gameId,
          nickname: entry.nickname,
          avatarUrl: entry.avatarUrl,
        },
        createdAt: row.created_at,
      } satisfies SocialFriendRequest];
    });

  const blockEntries = blocks.rows
    .map((row) => {
      const entry = directoryByUserId.get(row.blocked_user_id);
      return entry ? toBlockEntry(entry, row.created_at) : null;
    })
    .filter((value): value is SocialBlockEntry => value !== null);

  return {
    me: {
      userId,
      gameId: meEntry?.gameId ?? "",
    },
    counts: {
      friends: friends.length,
      incomingRequests: incoming.length,
      outgoingRequests: outgoing.length,
      blocks: blockEntries.length,
    },
    friends,
    incomingRequests: incoming,
    outgoingRequests: outgoing,
    blocks: blockEntries,
  };
}

export async function searchUserByGameIdForViewer(
  viewerUserId: string,
  gameId: string,
  executor?: Executor,
): Promise<SocialSearchResult> {
  const targetEntry = await findActiveUserDirectoryEntryByGameId(gameId, executor);
  if (!targetEntry) {
    return {
      found: false,
      user: null,
      relationship: "not_found",
      canSendFriendRequest: false,
    };
  }

  const relationshipState = await resolveRelationship(
    viewerUserId,
    targetEntry.userId,
    executor,
  );

  if (relationshipState.blocked) {
    return {
      found: false,
      user: null,
      relationship: "not_found",
      canSendFriendRequest: false,
    };
  }

  return {
    found: true,
    user: {
      userId: targetEntry.userId,
      gameId: targetEntry.gameId,
      nickname: targetEntry.nickname,
      avatarUrl: targetEntry.avatarUrl,
    },
    relationship: relationshipState.relationship,
    canSendFriendRequest: relationshipState.relationship === "none",
  };
}

export async function createFriendRequestByGameId(
  requesterUserId: string,
  targetGameId: string,
  executor?: Executor,
): Promise<
  | {
      status: "pending";
      relationship: SocialRelationship;
      requestId: string;
      friend?: undefined;
    }
  | {
      status: "auto_accepted";
      relationship: SocialRelationship;
      requestId: string;
      friend: SocialFriend | null;
    }
  | {
      status:
        | "blocked"
        | "already_friends"
        | "already_pending"
        | "cannot_add_self"
        | "user_not_found";
      relationship: SocialRelationship;
      requestId?: undefined;
      friend?: undefined;
    }
> {
  const db = getExecutor(executor);
  const targetEntry = await findActiveUserDirectoryEntryByGameId(targetGameId, db);
  if (!targetEntry) {
    return {
      status: "user_not_found",
      relationship: "none",
    };
  }

  if (targetEntry.userId === requesterUserId) {
    return {
      status: "cannot_add_self",
      relationship: "self",
    };
  }

  const relationship = await resolveRelationship(
    requesterUserId,
    targetEntry.userId,
    db,
  );

  if (relationship.blocked) {
    return {
      status: "blocked",
      relationship: "none",
    };
  }

  if (relationship.relationship === "friend") {
    return {
      status: "already_friends",
      relationship: "friend",
    };
  }

  if (relationship.relationship === "outgoing_pending") {
    return {
      status: "already_pending",
      relationship: "outgoing_pending",
    };
  }

  if (relationship.relationship === "incoming_pending") {
    const reverseRequest = await getPendingRequest(
      targetEntry.userId,
      requesterUserId,
      db,
    );
    if (!reverseRequest) {
      return {
        status: "already_pending",
        relationship: "incoming_pending",
      };
    }

    const handledAt = nowIso();
    await db.query(
      `
        UPDATE social_friend_requests
        SET
          status = 'accepted',
          handled_at = $2,
          updated_at = NOW()
        WHERE request_id = $1
      `,
      [reverseRequest.request_id, handledAt],
    );
    await createFriendEdges(requesterUserId, targetEntry.userId, handledAt, db);
    await cancelPendingPairRequests(
      requesterUserId,
      targetEntry.userId,
      handledAt,
      reverseRequest.request_id,
      db,
    );

    return {
      status: "auto_accepted",
      relationship: "friend",
      requestId: reverseRequest.request_id,
      friend: await buildFriendByUserId(targetEntry.userId, handledAt, db),
    };
  }

  const requestId = createRequestId();
  await db.query(
    `
      INSERT INTO social_friend_requests (
        request_id,
        sender_user_id,
        receiver_user_id,
        status,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, 'pending', NOW(), NOW())
    `,
    [requestId, requesterUserId, targetEntry.userId],
  );

  return {
    status: "pending",
    relationship: "outgoing_pending",
    requestId,
  };
}

export async function acceptFriendRequestById(
  requestId: string,
  receiverUserId: string,
  executor?: Executor,
): Promise<
  | { status: "accepted"; friend: SocialFriend | null }
  | { status: "request_not_found" | "request_handled" | "blocked" }
> {
  const db = getExecutor(executor);
  const result = await db.query<FriendRequestRow>(
    `
      SELECT
        request_id,
        sender_user_id,
        receiver_user_id,
        status,
        created_at
      FROM social_friend_requests
      WHERE request_id = $1
      LIMIT 1
    `,
    [requestId],
  );

  const row = result.rows[0];
  if (!row || row.receiver_user_id !== receiverUserId) {
    return { status: "request_not_found" };
  }
  if (row.status !== "pending") {
    return { status: "request_handled" };
  }
  if (
    (await hasBlock(row.sender_user_id, row.receiver_user_id, db)) ||
    (await hasBlock(row.receiver_user_id, row.sender_user_id, db))
  ) {
    return { status: "blocked" };
  }

  const handledAt = nowIso();
  await db.query(
    `
      UPDATE social_friend_requests
      SET
        status = 'accepted',
        handled_at = $2,
        updated_at = NOW()
      WHERE request_id = $1
        AND status = 'pending'
    `,
    [requestId, handledAt],
  );
  await createFriendEdges(row.sender_user_id, row.receiver_user_id, handledAt, db);
  await cancelPendingPairRequests(
    row.sender_user_id,
    row.receiver_user_id,
    handledAt,
    requestId,
    db,
  );

  return {
    status: "accepted",
    friend: await buildFriendByUserId(row.sender_user_id, handledAt, db),
  };
}

export async function rejectFriendRequestById(
  requestId: string,
  receiverUserId: string,
  executor?: Executor,
): Promise<{ status: "rejected" | "request_not_found" | "request_handled" }> {
  const db = getExecutor(executor);
  const result = await db.query<FriendRequestRow>(
    `
      SELECT
        request_id,
        receiver_user_id,
        status
      FROM social_friend_requests
      WHERE request_id = $1
      LIMIT 1
    `,
    [requestId],
  );

  const row = result.rows[0];
  if (!row || row.receiver_user_id !== receiverUserId) {
    return { status: "request_not_found" };
  }
  if (row.status !== "pending") {
    return { status: "request_handled" };
  }

  await db.query(
    `
      UPDATE social_friend_requests
      SET
        status = 'rejected',
        handled_at = NOW(),
        updated_at = NOW()
      WHERE request_id = $1
        AND status = 'pending'
    `,
    [requestId],
  );

  return { status: "rejected" };
}

export async function removeFriendByGameId(
  userId: string,
  targetGameId: string,
  executor?: Executor,
): Promise<{ status: "removed" | "not_friends" | "user_not_found" }> {
  const db = getExecutor(executor);
  const targetEntry = await findActiveUserDirectoryEntryByGameId(targetGameId, db);
  if (!targetEntry) {
    return { status: "user_not_found" };
  }

  const result = await db.query(
    `
      DELETE FROM social_friend_edges
      WHERE (user_id = $1 AND friend_user_id = $2)
         OR (user_id = $2 AND friend_user_id = $1)
    `,
    [userId, targetEntry.userId],
  );

  if (!result.rowCount) {
    return { status: "not_friends" };
  }

  return { status: "removed" };
}

export async function listBlocksByUserId(
  userId: string,
  executor?: Executor,
): Promise<SocialBlockEntry[]> {
  const overview = await getSocialOverviewByUserId(userId, executor);
  return overview.blocks;
}

export async function addBlockByGameId(
  userId: string,
  targetGameId: string,
  executor?: Executor,
): Promise<
  | { status: "blocked"; blocked: SocialBlockEntry | null }
  | { status: "user_not_found" | "cannot_block_self" }
> {
  const db = getExecutor(executor);
  const targetEntry = await findActiveUserDirectoryEntryByGameId(targetGameId, db);
  if (!targetEntry) {
    return { status: "user_not_found" };
  }
  if (targetEntry.userId === userId) {
    return { status: "cannot_block_self" };
  }

  const blockedAt = nowIso();
  await db.query(
    `
      INSERT INTO social_blocks (
        user_id,
        blocked_user_id,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $3)
      ON CONFLICT (user_id, blocked_user_id) DO UPDATE
      SET updated_at = EXCLUDED.updated_at
    `,
    [userId, targetEntry.userId, blockedAt],
  );

  await db.query(
    `
      DELETE FROM social_friend_edges
      WHERE (user_id = $1 AND friend_user_id = $2)
         OR (user_id = $2 AND friend_user_id = $1)
    `,
    [userId, targetEntry.userId],
  );
  await cancelPendingPairRequests(userId, targetEntry.userId, blockedAt, null, db);

  return {
    status: "blocked",
    blocked: toBlockEntry(targetEntry, blockedAt),
  };
}

export async function removeBlockByGameId(
  userId: string,
  targetGameId: string,
  executor?: Executor,
): Promise<{ status: "removed" | "user_not_found" }> {
  const db = getExecutor(executor);
  const targetEntry = await findActiveUserDirectoryEntryByGameId(targetGameId, db);
  if (!targetEntry) {
    return { status: "user_not_found" };
  }

  await db.query(
    `
      DELETE FROM social_blocks
      WHERE user_id = $1
        AND blocked_user_id = $2
    `,
    [userId, targetEntry.userId],
  );

  return { status: "removed" };
}
