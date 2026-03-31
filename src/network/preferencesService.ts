import type {
  GetUserPreferencesResponse,
  SyncUserPreferencesRequest,
  SyncUserPreferencesResponse,
} from "../../shared-protocol/src/preferences";
import { HttpClient } from "./http";
import { networkConfig } from "./config";
import { authService } from "./authService";

export class PreferencesService {
  private readonly http: HttpClient;

  constructor() {
    this.http = new HttpClient({
      baseUrl: networkConfig.apiBaseUrl,
      prepareAuth: () => authService.refreshToken(),
      getAccessToken: () => authService.getSession()?.accessToken ?? null,
      timeoutMs: networkConfig.requestTimeoutMs,
    });
  }

  async getPreferences(): Promise<GetUserPreferencesResponse> {
    const response = await this.http.get<GetUserPreferencesResponse>(
      "/preferences",
      { withAuth: true },
    );
    if (!response.ok) {
      throw new Error(response.error.message);
    }
    return response.data;
  }

  async syncPreferences(
    payload: SyncUserPreferencesRequest,
  ): Promise<SyncUserPreferencesResponse> {
    const response = await this.http.post<
      SyncUserPreferencesResponse,
      SyncUserPreferencesRequest
    >("/preferences/sync", payload, { withAuth: true });
    if (!response.ok) {
      throw new Error(response.error.message);
    }
    return response.data;
  }
}

export const preferencesService = new PreferencesService();
