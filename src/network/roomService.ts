import type {
  CreateRoomRequest,
  CreateRoomResponse,
  JoinRoomRequest,
  JoinRoomResponse,
  LeaveRoomRequest,
  LeaveRoomResponse,
  SetReadyRequest,
  SetReadyResponse,
  GetRoomSnapshotResponse,
  QueryRoomByInviteCodeResponse,
  StartRoomMatchRequest,
  StartRoomMatchResponse,
  SyncRoomMatchRequest,
  SyncRoomMatchResponse,
} from "../../shared-protocol/src/room";
import { HttpClient } from "./http";
import { networkConfig } from "./config";
import { authService } from "./authService";

export interface RoomServiceOptions {
  httpClient?: HttpClient;
}

export class RoomService {
  private readonly http: HttpClient;

  constructor(options: RoomServiceOptions = {}) {
    this.http =
      options.httpClient ??
      new HttpClient({
        baseUrl: networkConfig.apiBaseUrl,
        prepareAuth: () => authService.refreshToken(),
        getAccessToken: () => authService.getSession()?.accessToken ?? null,
      });
  }

  async createRoom(payload: CreateRoomRequest): Promise<CreateRoomResponse> {
    const response = await this.http.post<
      CreateRoomResponse,
      CreateRoomRequest
    >("/room/create", payload, {
      withAuth: true,
    });

    if (!response.ok) {
      throw new Error(response.error.message);
    }

    return response.data;
  }

  async joinRoom(payload: JoinRoomRequest): Promise<JoinRoomResponse> {
    const response = await this.http.post<JoinRoomResponse, JoinRoomRequest>(
      "/room/join",
      payload,
      {
        withAuth: true,
      },
    );

    if (!response.ok) {
      throw new Error(response.error.message);
    }

    return response.data;
  }

  async leaveRoom(payload: LeaveRoomRequest): Promise<LeaveRoomResponse> {
    const response = await this.http.post<LeaveRoomResponse, LeaveRoomRequest>(
      "/room/leave",
      payload,
      {
        withAuth: true,
      },
    );

    if (!response.ok) {
      throw new Error(response.error.message);
    }

    return response.data;
  }

  async setReady(payload: SetReadyRequest): Promise<SetReadyResponse> {
    const response = await this.http.post<SetReadyResponse, SetReadyRequest>(
      "/room/ready",
      payload,
      {
        withAuth: true,
      },
    );

    if (!response.ok) {
      throw new Error(response.error.message);
    }

    return response.data;
  }

  async getRoomSnapshot(roomId: string): Promise<GetRoomSnapshotResponse> {
    const safeRoomId = roomId.trim();
    if (!safeRoomId) {
      throw new Error("roomId is required");
    }

    const response = await this.http.get<GetRoomSnapshotResponse>(
      `/room/${encodeURIComponent(safeRoomId)}`,
      {
        withAuth: true,
      },
    );

    if (!response.ok) {
      throw new Error(response.error.message);
    }

    return response.data;
  }

  async queryRoomByInviteCode(
    inviteCode: string,
  ): Promise<QueryRoomByInviteCodeResponse> {
    const safeInviteCode = inviteCode.trim().toUpperCase();
    if (!safeInviteCode) {
      throw new Error("inviteCode is required");
    }

    const response = await this.http.get<QueryRoomByInviteCodeResponse>(
      `/room/invite/${encodeURIComponent(safeInviteCode)}`,
      {
        withAuth: true,
      },
    );

    if (!response.ok) {
      throw new Error(response.error.message);
    }

    return response.data;
  }

  async startRoomMatch(
    payload: StartRoomMatchRequest,
  ): Promise<StartRoomMatchResponse> {
    const response = await this.http.post<
      StartRoomMatchResponse,
      StartRoomMatchRequest
    >("/room/start-match", payload, {
      withAuth: true,
    });

    if (!response.ok) {
      throw new Error(response.error.message);
    }

    return response.data;
  }

  async syncRoomMatch(
    payload: SyncRoomMatchRequest,
  ): Promise<SyncRoomMatchResponse> {
    const response = await this.http.post<
      SyncRoomMatchResponse,
      SyncRoomMatchRequest
    >("/room/session/sync", payload, {
      withAuth: true,
    });

    if (!response.ok) {
      throw new Error(response.error.message);
    }

    return response.data;
  }
}

export const roomService = new RoomService();
