import type {
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse,
  PineconeSearchRequest,
  PineconeSearchResponse,
  PlatformConfigResponse,
  UploadAvatarRequest,
  UploadAvatarResponse,
} from "../../shared-protocol/src/platform";
import { HttpClient } from "./http";
import { networkConfig } from "./config";
import { authService } from "./authService";

export class PlatformService {
  private readonly http: HttpClient;

  constructor() {
    this.http = new HttpClient({
      baseUrl: networkConfig.apiBaseUrl,
      prepareAuth: () => authService.refreshToken(),
      getAccessToken: () => authService.getSession()?.accessToken ?? null,
      timeoutMs: networkConfig.requestTimeoutMs,
    });
  }

  async getConfig(): Promise<PlatformConfigResponse> {
    const response = await this.http.get<PlatformConfigResponse>(
      "/platform/config",
      {
        withAuth: false,
      },
    );

    if (!response.ok) {
      throw new Error(response.error.message);
    }

    return response.data;
  }

  async createCheckoutSession(
    payload: CreateCheckoutSessionRequest,
  ): Promise<CreateCheckoutSessionResponse> {
    const response = await this.http.post<
      CreateCheckoutSessionResponse,
      CreateCheckoutSessionRequest
    >("/platform/commerce/checkout", payload, {
      withAuth: true,
    });

    if (!response.ok) {
      throw new Error(response.error.message);
    }

    return response.data;
  }

  async uploadAvatar(
    payload: UploadAvatarRequest,
  ): Promise<UploadAvatarResponse> {
    const response = await this.http.post<UploadAvatarResponse, UploadAvatarRequest>(
      "/platform/storage/avatar/upload",
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

  async searchKnowledge(
    payload: PineconeSearchRequest,
  ): Promise<PineconeSearchResponse> {
    const response = await this.http.post<PineconeSearchResponse, PineconeSearchRequest>(
      "/platform/ai/search",
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
}

export const platformService = new PlatformService();
