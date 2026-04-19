export type RoomVisibility = 'public' | 'private';
export type RoomJoinType = 'direct' | 'inviteCode' | 'matchmaking';

export type RoomTeamMode = 'solo' | 'team';

export type RoomMemberRole = 'owner' | 'member';

export interface RoomMemberSnapshot {
    userId: string;
    nickname: string;
    avatarUrl: string;
    ready: boolean;
    role: RoomMemberRole;
    teamId: number | null;
    joinedAt: string;
    isOnline: boolean;
}

export interface RoomSnapshot {
    roomId: string;
    modeId: string;
    visibility: RoomVisibility;
    inviteCode: string | null;
    ownerUserId: string;
    status: 'idle' | 'matching' | 'inGame' | 'closed';
    teamMode: RoomTeamMode;
    maxMembers: number;
    minStartMembers: number;
    members: RoomMemberSnapshot[];
    createdAt: string;
    updatedAt: string;
    version: number;
}

export interface CreateRoomRequest {
    modeId: string;
    visibility?: RoomVisibility;
    maxMembers?: number;
    minStartMembers?: number;
    teamMode?: RoomTeamMode;
    clientVersion?: string;
}

export interface CreateRoomResponse {
    room: RoomSnapshot;
}

export interface JoinRoomRequest {
    roomId?: string;
    inviteCode?: string;
    joinType?: RoomJoinType;
    clientVersion?: string;
}

export interface JoinRoomResponse {
    room: RoomSnapshot;
}

export interface LeaveRoomRequest {
    roomId: string;
}

export interface LeaveRoomResponse {
    roomId: string;
    leftUserId: string;
    roomClosed: boolean;
    nextOwnerUserId: string | null;
}

export interface SetReadyRequest {
    roomId: string;
    ready: boolean;
}

export interface SetReadyResponse {
    room: RoomSnapshot;
}

export interface SwitchTeamRequest {
    roomId: string;
    teamId: number;
}

export interface SwitchTeamResponse {
    room: RoomSnapshot;
}

export interface KickRoomMemberRequest {
    roomId: string;
    targetUserId: string;
}

export interface KickRoomMemberResponse {
    room: RoomSnapshot;
}

export interface DisbandRoomRequest {
    roomId: string;
}

export interface DisbandRoomResponse {
    roomId: string;
    disbandedAt: string;
}

export interface StartRoomMatchRequest {
    roomId: string;
}

export interface RoomMatchInputPayload {
    moveX: number;
    moveY: number;
}

export interface RoomMatchLeaderboardEntry {
    userId: string;
    nickname: string;
    mass: number;
    score: number;
    alive: boolean;
}

export interface RoomMatchPlayerSnapshot {
    userId: string;
    nickname: string;
    color: string;
    accentColor: string;
    x: number;
    y: number;
    mass: number;
    radius: number;
    score: number;
    alive: boolean;
    respawnAt: string | null;
}

export interface RoomMatchFoodSnapshot {
    id: string;
    x: number;
    y: number;
    mass: number;
}

export interface RoomMatchSnapshot {
    sessionId: string;
    roomId: string;
    modeId: string;
    roomCode: string | null;
    phase: 'running' | 'finished';
    tick: number;
    version: number;
    worldSize: number;
    serverTime: string;
    startedAt: string;
    endsAt: string;
    winnerUserId: string | null;
    leaderboard: RoomMatchLeaderboardEntry[];
    players: RoomMatchPlayerSnapshot[];
    foods: RoomMatchFoodSnapshot[];
    localPlayerId: string | null;
}

export interface StartRoomMatchResponse {
    room: RoomSnapshot;
    session: RoomMatchSnapshot;
}

export interface SyncRoomMatchRequest {
    roomId: string;
    input?: RoomMatchInputPayload;
    lastKnownVersion?: number;
}

export interface SyncRoomMatchResponse {
    room: RoomSnapshot;
    session: RoomMatchSnapshot;
}

export interface GetRoomSnapshotRequest {
    roomId: string;
}

export interface GetRoomSnapshotResponse {
    room: RoomSnapshot;
}

export interface QueryRoomByInviteCodeRequest {
    inviteCode: string;
}

export interface QueryRoomByInviteCodeResponse {
    room: RoomSnapshot;
}

export interface InviteFriendToRoomRequest {
    roomId: string;
    targetGameId: string;
}

export interface InviteFriendToRoomResponse {
    success: true;
    roomId: string;
    inviteCode: string | null;
    targetGameId: string;
    targetUserId: string;
    deliveredAt: string;
}
