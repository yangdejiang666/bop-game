import {
  PROTOCOL_ERROR,
  type AcceptFriendRequestResponse,
  type CreateBlockResponse,
  type CreateFriendRequestResponse,
  type GetSocialOverviewResponse,
  type RejectFriendRequestResponse,
  type RemoveBlockResponse,
  type RemoveFriendResponse,
  type SearchSocialUserResponse,
} from "@bop/shared-protocol";
import { DomainError } from "../lib/domainError.js";
import {
  acceptFriendRequestById,
  addBlockByGameId,
  createFriendRequestByGameId,
  getSocialOverviewByUserId,
  listBlocksByUserId,
  rejectFriendRequestById,
  removeBlockByGameId,
  removeFriendByGameId,
  searchUserByGameIdForViewer,
} from "../repositories/socialRepository.js";

export async function getSocialOverview(
  userId: string,
): Promise<GetSocialOverviewResponse> {
  return {
    overview: await getSocialOverviewByUserId(userId),
  };
}

export async function searchSocialUser(
  viewerUserId: string,
  gameId: string,
): Promise<SearchSocialUserResponse> {
  return {
    result: await searchUserByGameIdForViewer(viewerUserId, gameId),
  };
}

export async function createFriendRequest(
  requesterUserId: string,
  targetGameId: string,
): Promise<CreateFriendRequestResponse> {
  const result = await createFriendRequestByGameId(requesterUserId, targetGameId);
  if (result.status === "user_not_found") {
    throw new DomainError(
      PROTOCOL_ERROR.USER_NOT_FOUND,
      "Target user not found.",
      404,
    );
  }
  if (result.status === "cannot_add_self") {
    throw new DomainError(
      PROTOCOL_ERROR.SOCIAL_CANNOT_ADD_SELF,
      "Cannot add yourself as a friend.",
      400,
    );
  }
  if (result.status === "blocked") {
    throw new DomainError(
      PROTOCOL_ERROR.SOCIAL_BLOCKED,
      "The friendship action is blocked by blacklist settings.",
      403,
    );
  }
  if (result.status === "already_friends") {
    throw new DomainError(
      PROTOCOL_ERROR.SOCIAL_ALREADY_FRIENDS,
      "You are already friends.",
      409,
    );
  }
  if (result.status === "already_pending") {
    throw new DomainError(
      PROTOCOL_ERROR.SOCIAL_REQUEST_DUPLICATE,
      "A pending request already exists.",
      409,
    );
  }

  return {
    status: result.status,
    relationship: result.relationship,
    requestId: result.requestId,
    friend: result.friend ?? undefined,
  };
}

export async function acceptFriendRequest(
  receiverUserId: string,
  requestId: string,
): Promise<AcceptFriendRequestResponse> {
  const result = await acceptFriendRequestById(requestId, receiverUserId);
  if (result.status === "request_not_found") {
    throw new DomainError(
      PROTOCOL_ERROR.SOCIAL_REQUEST_NOT_FOUND,
      "Friend request not found.",
      404,
    );
  }
  if (result.status === "request_handled") {
    throw new DomainError(
      PROTOCOL_ERROR.SOCIAL_REQUEST_ALREADY_HANDLED,
      "Friend request has already been handled.",
      409,
    );
  }
  if (result.status === "blocked") {
    throw new DomainError(
      PROTOCOL_ERROR.SOCIAL_BLOCKED,
      "The friendship action is blocked by blacklist settings.",
      403,
    );
  }
  if (result.status !== "accepted") {
    throw new DomainError(
      PROTOCOL_ERROR.UNKNOWN,
      "Unexpected friend acceptance state.",
      500,
    );
  }
  if (!result.friend) {
    throw new DomainError(
      PROTOCOL_ERROR.UNKNOWN,
      "Accepted friend payload is missing counterpart data.",
      500,
    );
  }

  return {
    success: true,
    friend: result.friend,
  };
}

export async function rejectFriendRequest(
  receiverUserId: string,
  requestId: string,
): Promise<RejectFriendRequestResponse> {
  const result = await rejectFriendRequestById(requestId, receiverUserId);
  if (result.status === "request_not_found") {
    throw new DomainError(
      PROTOCOL_ERROR.SOCIAL_REQUEST_NOT_FOUND,
      "Friend request not found.",
      404,
    );
  }
  if (result.status === "request_handled") {
    throw new DomainError(
      PROTOCOL_ERROR.SOCIAL_REQUEST_ALREADY_HANDLED,
      "Friend request has already been handled.",
      409,
    );
  }

  return { success: true };
}

export async function removeFriend(
  userId: string,
  targetGameId: string,
): Promise<RemoveFriendResponse> {
  const result = await removeFriendByGameId(userId, targetGameId);
  if (result.status === "user_not_found") {
    throw new DomainError(
      PROTOCOL_ERROR.USER_NOT_FOUND,
      "Target user not found.",
      404,
    );
  }
  if (result.status === "not_friends") {
    throw new DomainError(
      PROTOCOL_ERROR.SOCIAL_NOT_FRIENDS,
      "You are not friends with this user.",
      409,
    );
  }

  return { success: true };
}

export async function listSocialBlocks(userId: string) {
  return {
    blocks: await listBlocksByUserId(userId),
  };
}

export async function createBlock(
  userId: string,
  targetGameId: string,
): Promise<CreateBlockResponse> {
  const result = await addBlockByGameId(userId, targetGameId);
  if (result.status === "user_not_found") {
    throw new DomainError(
      PROTOCOL_ERROR.USER_NOT_FOUND,
      "Target user not found.",
      404,
    );
  }
  if (result.status === "cannot_block_self") {
    throw new DomainError(
      PROTOCOL_ERROR.INVALID_REQUEST,
      "Cannot block yourself.",
      400,
      { field: "targetGameId" },
    );
  }
  if (result.status !== "blocked") {
    throw new DomainError(
      PROTOCOL_ERROR.UNKNOWN,
      "Unexpected block state.",
      500,
    );
  }
  if (!result.blocked) {
    throw new DomainError(
      PROTOCOL_ERROR.UNKNOWN,
      "Block action completed without payload.",
      500,
    );
  }

  return {
    success: true,
    blocked: result.blocked,
  };
}

export async function removeBlock(
  userId: string,
  targetGameId: string,
): Promise<RemoveBlockResponse> {
  const result = await removeBlockByGameId(userId, targetGameId);
  if (result.status === "user_not_found") {
    throw new DomainError(
      PROTOCOL_ERROR.USER_NOT_FOUND,
      "Target user not found.",
      404,
    );
  }

  return { success: true };
}
