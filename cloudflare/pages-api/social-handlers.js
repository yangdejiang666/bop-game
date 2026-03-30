import { PROTOCOL_ERROR } from "./constants.js";
import { failure, normalizeAccount, readJson, success } from "./helpers.js";
import { normalizeGameId } from "./db.js";
import { requireAuth } from "./auth-handlers.js";
import {
  acceptFriendRequest,
  addBlock,
  createFriendRequest,
  ensureUserGameId,
  findUserByGameId,
  getRelationshipStatus,
  getSocialOverviewByUserId,
  rejectFriendRequest,
  removeBlock,
  removeFriendship,
  searchUserByGameIdForViewer,
} from "./social-store.js";

function readGameId(raw) {
  return normalizeGameId(normalizeAccount(raw));
}

export async function handleGetSocialOverview(request, env, requestId) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  await ensureUserGameId(required.auth.db, required.auth.userId);
  const overview = await getSocialOverviewByUserId(
    required.auth.db,
    required.auth.userId,
  );
  return success(request, requestId, { overview });
}

export async function handleSearchSocialUser(
  request,
  env,
  requestId,
  rawGameId,
) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const gameId = readGameId(rawGameId);
  if (!gameId) {
    return failure(
      request,
      requestId,
      400,
      PROTOCOL_ERROR.SOCIAL_INVALID_GAME_ID,
      "gameId must be a 9-digit number.",
      { field: "gameId" },
    );
  }

  const result = await searchUserByGameIdForViewer(
    required.auth.db,
    required.auth.userId,
    gameId,
  );
  return success(request, requestId, { result });
}

export async function handleCreateFriendRequest(request, env, requestId) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const body = await readJson(request);
  const targetGameId = readGameId(body?.targetGameId);
  if (!targetGameId) {
    return failure(
      request,
      requestId,
      400,
      PROTOCOL_ERROR.SOCIAL_INVALID_GAME_ID,
      "targetGameId must be a 9-digit number.",
      { field: "targetGameId" },
    );
  }

  const targetUser = await findUserByGameId(required.auth.db, targetGameId);
  if (!targetUser) {
    return failure(
      request,
      requestId,
      404,
      PROTOCOL_ERROR.USER_NOT_FOUND,
      "Target user not found.",
    );
  }

  if (targetUser.user_id === required.auth.userId) {
    return failure(
      request,
      requestId,
      400,
      PROTOCOL_ERROR.SOCIAL_CANNOT_ADD_SELF,
      "Cannot add yourself as a friend.",
    );
  }

  const created = await createFriendRequest(
    required.auth.db,
    required.auth.userId,
    targetUser.user_id,
  );

  if (created.status === "blocked") {
    return failure(
      request,
      requestId,
      403,
      PROTOCOL_ERROR.SOCIAL_BLOCKED,
      "The friendship action is blocked by blacklist settings.",
    );
  }
  if (created.status === "already_friends") {
    return failure(
      request,
      requestId,
      409,
      PROTOCOL_ERROR.SOCIAL_ALREADY_FRIENDS,
      "You are already friends.",
    );
  }
  if (created.status === "already_pending") {
    return failure(
      request,
      requestId,
      409,
      PROTOCOL_ERROR.CONFLICT,
      "A pending request already exists.",
    );
  }
  if (created.status === "cannot_add_self") {
    return failure(
      request,
      requestId,
      400,
      PROTOCOL_ERROR.SOCIAL_CANNOT_ADD_SELF,
      "Cannot add yourself as a friend.",
    );
  }

  const relationship = await getRelationshipStatus(
    required.auth.db,
    required.auth.userId,
    targetUser.user_id,
  );

  return success(request, requestId, {
    status: created.status === "auto_accepted" ? "auto_accepted" : "pending",
    relationship:
      relationship === "friend" ||
      relationship === "incoming_pending" ||
      relationship === "outgoing_pending" ||
      relationship === "none" ||
      relationship === "self"
        ? relationship
        : "none",
    requestId: created.requestId,
    friend: created.friend ?? undefined,
  });
}

export async function handleAcceptFriendRequest(
  request,
  env,
  requestId,
  requestSocialId,
) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const requestIdSafe =
    typeof requestSocialId === "string" ? requestSocialId.trim() : "";
  if (!requestIdSafe) {
    return failure(
      request,
      requestId,
      400,
      PROTOCOL_ERROR.INVALID_REQUEST,
      "requestId is required.",
      { field: "requestId" },
    );
  }

  const accepted = await acceptFriendRequest(
    required.auth.db,
    requestIdSafe,
    required.auth.userId,
  );

  if (accepted.status === "request_not_found") {
    return failure(
      request,
      requestId,
      404,
      PROTOCOL_ERROR.SOCIAL_REQUEST_NOT_FOUND,
      "Friend request not found.",
    );
  }
  if (accepted.status === "request_handled") {
    return failure(
      request,
      requestId,
      409,
      PROTOCOL_ERROR.SOCIAL_REQUEST_ALREADY_HANDLED,
      "Friend request has already been handled.",
    );
  }
  if (accepted.status === "blocked") {
    return failure(
      request,
      requestId,
      403,
      PROTOCOL_ERROR.SOCIAL_BLOCKED,
      "The friendship action is blocked by blacklist settings.",
    );
  }

  return success(request, requestId, {
    success: true,
    friend: accepted.friend,
  });
}

export async function handleRejectFriendRequest(
  request,
  env,
  requestId,
  requestSocialId,
) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const requestIdSafe =
    typeof requestSocialId === "string" ? requestSocialId.trim() : "";
  if (!requestIdSafe) {
    return failure(
      request,
      requestId,
      400,
      PROTOCOL_ERROR.INVALID_REQUEST,
      "requestId is required.",
      { field: "requestId" },
    );
  }

  const rejected = await rejectFriendRequest(
    required.auth.db,
    requestIdSafe,
    required.auth.userId,
  );

  if (rejected.status === "request_not_found") {
    return failure(
      request,
      requestId,
      404,
      PROTOCOL_ERROR.SOCIAL_REQUEST_NOT_FOUND,
      "Friend request not found.",
    );
  }
  if (rejected.status === "request_handled") {
    return failure(
      request,
      requestId,
      409,
      PROTOCOL_ERROR.SOCIAL_REQUEST_ALREADY_HANDLED,
      "Friend request has already been handled.",
    );
  }

  return success(request, requestId, {
    success: true,
  });
}

export async function handleRemoveFriend(request, env, requestId, targetGameIdRaw) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const targetGameId = readGameId(targetGameIdRaw);
  if (!targetGameId) {
    return failure(
      request,
      requestId,
      400,
      PROTOCOL_ERROR.SOCIAL_INVALID_GAME_ID,
      "target game id must be a 9-digit number.",
      { field: "gameId" },
    );
  }

  const targetUser = await findUserByGameId(required.auth.db, targetGameId);
  if (!targetUser) {
    return failure(
      request,
      requestId,
      404,
      PROTOCOL_ERROR.USER_NOT_FOUND,
      "Target user not found.",
    );
  }

  const removed = await removeFriendship(
    required.auth.db,
    required.auth.userId,
    targetUser.user_id,
  );
  if (removed.status === "not_friends") {
    return failure(
      request,
      requestId,
      409,
      PROTOCOL_ERROR.SOCIAL_NOT_FRIENDS,
      "You are not friends with this user.",
    );
  }

  return success(request, requestId, {
    success: true,
  });
}

export async function handleCreateBlock(request, env, requestId) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const body = await readJson(request);
  const targetGameId = readGameId(body?.targetGameId);
  if (!targetGameId) {
    return failure(
      request,
      requestId,
      400,
      PROTOCOL_ERROR.SOCIAL_INVALID_GAME_ID,
      "targetGameId must be a 9-digit number.",
      { field: "targetGameId" },
    );
  }

  const targetUser = await findUserByGameId(required.auth.db, targetGameId);
  if (!targetUser) {
    return failure(
      request,
      requestId,
      404,
      PROTOCOL_ERROR.USER_NOT_FOUND,
      "Target user not found.",
    );
  }
  if (targetUser.user_id === required.auth.userId) {
    return failure(
      request,
      requestId,
      400,
      PROTOCOL_ERROR.INVALID_REQUEST,
      "Cannot block yourself.",
      { field: "targetGameId" },
    );
  }

  const blocked = await addBlock(
    required.auth.db,
    required.auth.userId,
    targetUser.user_id,
  );
  if (blocked.status === "cannot_block_self") {
    return failure(
      request,
      requestId,
      400,
      PROTOCOL_ERROR.INVALID_REQUEST,
      "Cannot block yourself.",
      { field: "targetGameId" },
    );
  }

  return success(request, requestId, {
    success: true,
    blocked: blocked.blocked,
  });
}

export async function handleRemoveBlock(request, env, requestId, targetGameIdRaw) {
  const required = await requireAuth(request, env, requestId);
  if (!required.auth) {
    return required.response;
  }

  const targetGameId = readGameId(targetGameIdRaw);
  if (!targetGameId) {
    return failure(
      request,
      requestId,
      400,
      PROTOCOL_ERROR.SOCIAL_INVALID_GAME_ID,
      "target game id must be a 9-digit number.",
      { field: "gameId" },
    );
  }

  const targetUser = await findUserByGameId(required.auth.db, targetGameId);
  if (!targetUser) {
    return failure(
      request,
      requestId,
      404,
      PROTOCOL_ERROR.USER_NOT_FOUND,
      "Target user not found.",
    );
  }

  await removeBlock(required.auth.db, required.auth.userId, targetUser.user_id);
  return success(request, requestId, {
    success: true,
  });
}
