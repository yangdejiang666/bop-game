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
}

export interface CreateRoomResponse {
    room: RoomSnapshot;
}

export interface JoinRoomRequest {
    roomId?: string;
    inviteCode?: string;
    joinType?: RoomJoinType;
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

export interface StartRoomMatchResponse {
    room: RoomSnapshot;
    ticketId: string;
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
