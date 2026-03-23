import type {
  GetDeveloperAccountsOverviewResponse,
  UserBootstrapRequest,
  UserBootstrapResponse,
} from "../../shared-protocol/src/user";
import { HttpClient } from "./http";
import { networkConfig } from "./config";
import { authService } from "./authService";

export class UserService {
  private readonly http: HttpClient;

  constructor() {
    this.http = new HttpClient({
      baseUrl: networkConfig.apiBaseUrl,
      prepareAuth: () => authService.refreshToken(),
      getAccessToken: () => authService.getSession()?.accessToken ?? null,
      timeoutMs: networkConfig.requestTimeoutMs,
    });
  }

  async bootstrapLocalProfile(
    payload: UserBootstrapRequest,
  ): Promise<UserBootstrapResponse> {
    const response = await this.http.post<UserBootstrapResponse, UserBootstrapRequest>(
      "/user/bootstrap",
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

  async getDeveloperAccountsOverview(): Promise<GetDeveloperAccountsOverviewResponse> {
    const response = await this.http.get<GetDeveloperAccountsOverviewResponse>(
      "/user/dev/accounts-overview",
      {
        withAuth: true,
      },
    );

    if (!response.ok) {
      throw new Error(response.error.message);
    }

    return response.data;
  }
}

export const userService = new UserService();
