import type {
  AcceptFriendRequestResponse,
  CreateBlockRequest,
  CreateBlockResponse,
  CreateFriendRequestRequest,
  CreateFriendRequestResponse,
  GetSocialOverviewResponse,
  RejectFriendRequestResponse,
  RemoveBlockResponse,
  RemoveFriendResponse,
  SearchSocialUserResponse,
} from "../../shared-protocol/src/social";
import { HttpClient } from "./http";
import { networkConfig } from "./config";
import { authService } from "./authService";

function normalizeGameId(raw: string) {
  const normalized = raw.trim();
  return /^\d{9}$/.test(normalized) ? normalized : "";
}

export class SocialService {
  private readonly http: HttpClient;

  constructor() {
    this.http = new HttpClient({
      baseUrl: networkConfig.apiBaseUrl,
      prepareAuth: () => authService.refreshToken(),
      getAccessToken: () => authService.getSession()?.accessToken ?? null,
      timeoutMs: networkConfig.requestTimeoutMs,
    });
  }

  async getOverview(): Promise<GetSocialOverviewResponse> {
    const response = await this.http.get<GetSocialOverviewResponse>(
      "/social/overview",
      { withAuth: true },
    );
    if (!response.ok) {
      throw new Error(response.error.message);
    }
    return response.data;
  }

  async searchByGameId(rawGameId: string): Promise<SearchSocialUserResponse> {
    const gameId = normalizeGameId(rawGameId);
    if (!gameId) {
      throw new Error("请输入 9 位数字 UID。");
    }

    const response = await this.http.get<SearchSocialUserResponse>(
      `/social/search/${encodeURIComponent(gameId)}`,
      { withAuth: true },
    );
    if (!response.ok) {
      throw new Error(response.error.message);
    }
    return response.data;
  }

  async createFriendRequest(rawGameId: string): Promise<CreateFriendRequestResponse> {
    const gameId = normalizeGameId(rawGameId);
    if (!gameId) {
      throw new Error("请输入 9 位数字 UID。");
    }

    const payload: CreateFriendRequestRequest = {
      targetGameId: gameId,
    };

    const response = await this.http.post<
      CreateFriendRequestResponse,
      CreateFriendRequestRequest
    >("/social/friend-requests", payload, { withAuth: true });
    if (!response.ok) {
      throw new Error(response.error.message);
    }
    return response.data;
  }

  async acceptFriendRequest(requestId: string): Promise<AcceptFriendRequestResponse> {
    const safeRequestId = requestId.trim();
    if (!safeRequestId) {
      throw new Error("requestId is required.");
    }

    const response = await this.http.post<AcceptFriendRequestResponse>(
      `/social/friend-requests/${encodeURIComponent(safeRequestId)}/accept`,
      undefined,
      { withAuth: true },
    );
    if (!response.ok) {
      throw new Error(response.error.message);
    }
    return response.data;
  }

  async rejectFriendRequest(requestId: string): Promise<RejectFriendRequestResponse> {
    const safeRequestId = requestId.trim();
    if (!safeRequestId) {
      throw new Error("requestId is required.");
    }

    const response = await this.http.post<RejectFriendRequestResponse>(
      `/social/friend-requests/${encodeURIComponent(safeRequestId)}/reject`,
      undefined,
      { withAuth: true },
    );
    if (!response.ok) {
      throw new Error(response.error.message);
    }
    return response.data;
  }

  async removeFriend(rawGameId: string): Promise<RemoveFriendResponse> {
    const gameId = normalizeGameId(rawGameId);
    if (!gameId) {
      throw new Error("请输入 9 位数字 UID。");
    }

    const response = await this.http.delete<RemoveFriendResponse>(
      `/social/friends/${encodeURIComponent(gameId)}`,
      { withAuth: true },
    );
    if (!response.ok) {
      throw new Error(response.error.message);
    }
    return response.data;
  }

  async blockUser(rawGameId: string): Promise<CreateBlockResponse> {
    const gameId = normalizeGameId(rawGameId);
    if (!gameId) {
      throw new Error("请输入 9 位数字 UID。");
    }

    const payload: CreateBlockRequest = {
      targetGameId: gameId,
    };
    const response = await this.http.post<CreateBlockResponse, CreateBlockRequest>(
      "/social/blocks",
      payload,
      { withAuth: true },
    );
    if (!response.ok) {
      throw new Error(response.error.message);
    }
    return response.data;
  }

  async unblockUser(rawGameId: string): Promise<RemoveBlockResponse> {
    const gameId = normalizeGameId(rawGameId);
    if (!gameId) {
      throw new Error("请输入 9 位数字 UID。");
    }

    const response = await this.http.delete<RemoveBlockResponse>(
      `/social/blocks/${encodeURIComponent(gameId)}`,
      { withAuth: true },
    );
    if (!response.ok) {
      throw new Error(response.error.message);
    }
    return response.data;
  }
}

export const socialService = new SocialService();
