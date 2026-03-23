import type {
  CompleteMatchProgressionRequest,
  CompleteMatchProgressionResponse,
} from "../../shared-protocol/src/progression";
import { HttpClient } from "./http";
import { networkConfig } from "./config";
import { authService } from "./authService";

export class ProgressionService {
  private readonly http: HttpClient;

  constructor() {
    this.http = new HttpClient({
      baseUrl: networkConfig.apiBaseUrl,
      prepareAuth: () => authService.refreshToken(),
      getAccessToken: () => authService.getSession()?.accessToken ?? null,
      timeoutMs: networkConfig.requestTimeoutMs,
    });
  }

  async completeMatch(
    payload: CompleteMatchProgressionRequest,
  ): Promise<CompleteMatchProgressionResponse> {
    const response = await this.http.post<
      CompleteMatchProgressionResponse,
      CompleteMatchProgressionRequest
    >("/progression/matches/complete", payload, {
      withAuth: true,
    });

    if (!response.ok) {
      throw new Error(response.error.message);
    }

    return response.data;
  }
}

export const progressionService = new ProgressionService();
