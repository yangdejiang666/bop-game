import type {
  CreateRoomRequest,
  CreateRoomResponse,
  JoinRoomRequest,
  JoinRoomResponse,
  LeaveRoomRequest,
  LeaveRoomResponse,
  InviteFriendToRoomRequest,
  InviteFriendToRoomResponse,
  SetReadyRequest,
  SetReadyResponse,
  GetRoomSnapshotResponse,
  QueryRoomByInviteCodeResponse,
  StartRoomMatchRequest,
  StartRoomMatchResponse,
  SyncRoomMatchRequest,
  SyncRoomMatchResponse,
} from "../../shared-protocol/src/room";
import { BaseService, type BaseServiceDeps } from "./BaseService";

export interface RoomServiceOptions extends BaseServiceDeps {}

/**
 * 房间服务 — 管理私人房 CRUD、快照查询、对局同步。
 *
 * 继承 BaseService，使用 authPost/authGet/authDelete 快捷方法。
 * 所有公共 API 返回裸 data，失败时抛 Error。
 */
export class RoomService extends BaseService {
  async createRoom(payload: CreateRoomRequest): Promise<CreateRoomResponse> {
    return this.authPost<CreateRoomResponse, CreateRoomRequest>("/room/create", payload);
  }

  async joinRoom(payload: JoinRoomRequest): Promise<JoinRoomResponse> {
    return this.authPost<JoinRoomResponse, JoinRoomRequest>("/room/join", payload);
  }

  async inviteFriendToRoom(
    payload: InviteFriendToRoomRequest,
  ): Promise<InviteFriendToRoomResponse> {
    return this.authPost<InviteFriendToRoomResponse, InviteFriendToRoomRequest>(
      "/room/invite-friend",
      payload,
    );
  }

  async leaveRoom(payload: LeaveRoomRequest): Promise<LeaveRoomResponse> {
    return this.authPost<LeaveRoomResponse, LeaveRoomRequest>("/room/leave", payload);
  }

  async setReady(payload: SetReadyRequest): Promise<SetReadyResponse> {
    return this.authPost<SetReadyResponse, SetReadyRequest>("/room/ready", payload);
  }

  async getRoomSnapshot(roomId: string): Promise<GetRoomSnapshotResponse> {
    const safeRoomId = roomId.trim();
    if (!safeRoomId) throw new Error("roomId is required");
    return this.authGet<GetRoomSnapshotResponse>(`/room/${encodeURIComponent(safeRoomId)}`);
  }

  async queryRoomByInviteCode(
    inviteCode: string,
  ): Promise<QueryRoomByInviteCodeResponse> {
    const safeInviteCode = inviteCode.trim().toUpperCase();
    if (!safeInviteCode) throw new Error("inviteCode is required");
    return this.authGet<QueryRoomByInviteCodeResponse>(
      `/room/invite/${encodeURIComponent(safeInviteCode)}`,
    );
  }

  async startRoomMatch(
    payload: StartRoomMatchRequest,
  ): Promise<StartRoomMatchResponse> {
    return this.authPost<StartRoomMatchResponse, StartRoomMatchRequest>(
      "/room/start-match",
      payload,
    );
  }

  async syncRoomMatch(
    payload: SyncRoomMatchRequest,
  ): Promise<SyncRoomMatchResponse> {
    return this.authPost<SyncRoomMatchResponse, SyncRoomMatchRequest>(
      "/room/session/sync",
      payload,
    );
  }
}

export const roomService = new RoomService();
