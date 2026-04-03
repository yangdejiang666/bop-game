import type {
  GetCurrentRankingSeasonResponse,
  GetRankingHistoryResponse,
  GetRankingLeaderboardResponse,
  GetRankingOverviewResponse,
  RankQueueId,
} from "../../shared-protocol/src/ranking";
import { HttpClient } from "./http";
import { networkConfig } from "./config";
import { authService } from "./authService";

export class RankingService {
  private readonly http: HttpClient;

  constructor() {
    this.http = new HttpClient({
      baseUrl: networkConfig.apiBaseUrl,
      prepareAuth: () => authService.refreshToken(),
      getAccessToken: () => authService.getSession()?.accessToken ?? null,
      timeoutMs: networkConfig.requestTimeoutMs,
    });
  }

  async getOverview(): Promise<GetRankingOverviewResponse> {
    const response = await this.http.get<GetRankingOverviewResponse>(
      "/ranking/overview",
      { withAuth: true },
    );
    if (!response.ok) {
      throw new Error(response.error.message);
    }
    return response.data;
  }

  async getLeaderboard(
    queueId: RankQueueId,
  ): Promise<GetRankingLeaderboardResponse> {
    const response = await this.http.get<GetRankingLeaderboardResponse>(
      `/ranking/leaderboard/${encodeURIComponent(queueId)}`,
      { withAuth: true },
    );
    if (!response.ok) {
      throw new Error(response.error.message);
    }
    return response.data;
  }

  async getHistory(): Promise<GetRankingHistoryResponse> {
    const response = await this.http.get<GetRankingHistoryResponse>(
      "/ranking/history",
      { withAuth: true },
    );
    if (!response.ok) {
      throw new Error(response.error.message);
    }
    return response.data;
  }

  async getCurrentSeason(): Promise<GetCurrentRankingSeasonResponse> {
    const response = await this.http.get<GetCurrentRankingSeasonResponse>(
      "/ranking/season/current",
      { withAuth: true },
    );
    if (!response.ok) {
      throw new Error(response.error.message);
    }
    return response.data;
  }
}

export const rankingService = new RankingService();
