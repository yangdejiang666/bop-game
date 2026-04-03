export type SocialRelationship =
  | "none"
  | "self"
  | "friend"
  | "incoming_pending"
  | "outgoing_pending";

export interface SocialUserCard {
  userId: string;
  gameId: string;
  nickname: string;
  avatarUrl: string | null;
}

export interface SocialFriend {
  userId: string;
  gameId: string;
  nickname: string;
  avatarUrl: string | null;
  isOnline: boolean;
  lastSeenAt: string | null;
  friendedAt: string;
}

export interface SocialFriendRequest {
  requestId: string;
  direction: "incoming" | "outgoing";
  status: "pending";
  counterpart: SocialUserCard;
  createdAt: string;
}

export interface SocialBlockEntry {
  userId: string;
  gameId: string;
  nickname: string;
  avatarUrl: string | null;
  blockedAt: string;
}

export interface SocialOverview {
  me: {
    userId: string;
    gameId: string;
  };
  counts: {
    friends: number;
    incomingRequests: number;
    outgoingRequests: number;
    blocks: number;
  };
  friends: SocialFriend[];
  incomingRequests: SocialFriendRequest[];
  outgoingRequests: SocialFriendRequest[];
  blocks: SocialBlockEntry[];
}

export interface GetSocialOverviewResponse {
  overview: SocialOverview;
}

export interface GetSocialFriendRequestsResponse {
  incoming: SocialFriendRequest[];
  outgoing: SocialFriendRequest[];
}

export interface GetSocialBlocksResponse {
  blocks: SocialBlockEntry[];
}

export interface SocialSearchResult {
  found: boolean;
  user: SocialUserCard | null;
  relationship: SocialRelationship | "not_found";
  canSendFriendRequest: boolean;
}

export interface SearchSocialUserResponse {
  result: SocialSearchResult;
}

export interface CreateFriendRequestRequest {
  targetGameId: string;
}

export interface CreateFriendRequestResponse {
  status: "pending" | "auto_accepted";
  relationship: SocialRelationship;
  requestId?: string;
  friend?: SocialFriend;
}

export interface AcceptFriendRequestResponse {
  success: true;
  friend: SocialFriend;
}

export interface RejectFriendRequestResponse {
  success: true;
}

export interface RemoveFriendResponse {
  success: true;
}

export interface CreateBlockRequest {
  targetGameId: string;
}

export interface CreateBlockResponse {
  success: true;
  blocked: SocialBlockEntry;
}

export interface RemoveBlockResponse {
  success: true;
}
