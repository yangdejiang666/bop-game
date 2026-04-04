import type {
  BindEmailRequest,
  BindEmailResponse,
  BindMobileRequest,
  BindMobileResponse,
  ConfirmPasswordResetRequest,
  ConfirmPasswordResetResponse,
  DeviceInfo,
  LoginMethod,
  LoginRequest,
  LoginResponse,
  LogoutRequest,
  LogoutResponse,
  RequestPasswordResetRequest,
  RequestPasswordResetResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
  RegisterByPasswordRequest,
  RegisterByPasswordResponse,
  SendEmailCodeRequest,
  SendEmailCodeResponse,
  SendSmsCodeRequest,
  SendSmsCodeResponse,
} from "../../shared-protocol/src/auth";
import type {
  GetMeResponse,
  UpdateProfileRequest,
  UpdateProfileResponse,
} from "../../shared-protocol/src/user";
import type { ProtocolResponse } from "../../shared-protocol/src/errors";
import { networkConfig } from "./config";

const DEFAULT_BASE_URL = networkConfig.apiBaseUrl;
const DEVICE_STORAGE_KEY = "bop:device-id";

export interface AuthServiceConfig {
  baseUrl?: string;
  storageKey?: string;
  requestTimeoutMs?: number;
}

export interface AuthSessionState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
  userId: string;
  gameId: string;
  nickname: string;
  method: LoginMethod;
}

export interface AuthHeadersOptions {
  includeAuth?: boolean;
  requestId?: string;
}

export class AuthService {
  private readonly baseUrl: string;
  private readonly storageKey: string;
  private readonly requestTimeoutMs: number;
  private inMemorySession: AuthSessionState | null = null;

  constructor(config?: AuthServiceConfig) {
    this.baseUrl = (config?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.storageKey = config?.storageKey ?? "bop:auth-session";
    this.requestTimeoutMs = Math.max(1000, config?.requestTimeoutMs ?? 10_000);
    this.inMemorySession = this.loadSessionFromStorage();
  }

  getSession(): AuthSessionState | null {
    return this.inMemorySession;
  }

  isLoggedIn(): boolean {
    const session = this.inMemorySession;
    if (!session) return false;
    return Date.now() < session.refreshExpiresAt;
  }

  clearSession(): void {
    this.inMemorySession = null;
    try {
      window.localStorage.removeItem(this.storageKey);
    } catch {
      // ignore storage errors
    }
  }

  installDebugSession(session: AuthSessionState): void {
    this.persistSession(session);
  }

  async register(
    payload: RegisterByPasswordRequest,
  ): Promise<ProtocolResponse<RegisterByPasswordResponse>> {
    const requestPayload: RegisterByPasswordRequest = {
      ...payload,
      device: payload.device ?? this.getDeviceInfo(),
    };
    const response = await this.request<RegisterByPasswordResponse>(
      "/auth/register",
      {
        method: "POST",
        body: requestPayload,
      },
    );

    if (response.ok) {
      this.persistSession({
        accessToken: response.data.tokens.accessToken,
        refreshToken: response.data.tokens.refreshToken,
        expiresAt: Date.now() + response.data.tokens.expiresIn * 1000,
        refreshExpiresAt:
          Date.now() + response.data.tokens.refreshExpiresIn * 1000,
        userId: response.data.user.userId,
        gameId: response.data.user.gameId,
        nickname: response.data.user.nickname,
        method: "password",
      });
    }

    return response;
  }

  async login(payload: LoginRequest): Promise<ProtocolResponse<LoginResponse>> {
    const requestPayload = this.attachDeviceToLoginPayload(payload);
    const response = await this.request<LoginResponse>("/auth/login", {
      method: "POST",
      body: requestPayload,
    });

    if (response.ok) {
      this.persistSession({
        accessToken: response.data.tokens.accessToken,
        refreshToken: response.data.tokens.refreshToken,
        expiresAt: Date.now() + response.data.tokens.expiresIn * 1000,
        refreshExpiresAt:
          Date.now() + response.data.tokens.refreshExpiresIn * 1000,
        userId: response.data.user.userId,
        gameId: response.data.user.gameId,
        nickname: response.data.user.nickname,
        method: response.data.method,
      });
    }

    return response;
  }

  async refreshToken(
    force = false,
  ): Promise<ProtocolResponse<RefreshTokenResponse>> {
    const session = this.inMemorySession;
    if (!session) {
      return {
        ok: false,
        error: {
          code: "UNAUTHORIZED",
          message: "No session to refresh.",
          timestamp: new Date().toISOString(),
        },
      };
    }

    if (!force && Date.now() < session.expiresAt - 30_000) {
      return {
        ok: true,
        data: {
          tokens: {
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            expiresIn: Math.max(
              1,
              Math.floor((session.expiresAt - Date.now()) / 1000),
            ),
            refreshExpiresIn: Math.max(
              1,
              Math.floor((session.refreshExpiresAt - Date.now()) / 1000),
            ),
            tokenType: "Bearer",
          },
          serverTime: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
      };
    }

    const payload: RefreshTokenRequest = {
      refreshToken: session.refreshToken,
      device: {
        deviceId: this.getDeviceInfo().deviceId,
        platform: this.getDeviceInfo().platform,
        appVersion: this.getDeviceInfo().appVersion,
      },
    };

    const response = await this.request<RefreshTokenResponse>("/auth/refresh", {
      method: "POST",
      body: payload,
    });

    if (response.ok) {
      this.persistSession({
        ...session,
        accessToken: response.data.tokens.accessToken,
        refreshToken: response.data.tokens.refreshToken,
        expiresAt: Date.now() + response.data.tokens.expiresIn * 1000,
        refreshExpiresAt:
          Date.now() + response.data.tokens.refreshExpiresIn * 1000,
        method: session.method,
      });
    } else if (
      response.error.code === "AUTH_REFRESH_TOKEN_INVALID" ||
      response.error.code === "AUTH_TOKEN_EXPIRED" ||
      response.error.code === "UNAUTHORIZED"
    ) {
      this.clearSession();
    }

    return response;
  }

  async logout(allDevices = false): Promise<ProtocolResponse<LogoutResponse>> {
    const session = this.inMemorySession;
    if (!session) {
      this.clearSession();
      return {
        ok: true,
        data: {
          success: true,
          serverTime: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
      };
    }

    const payload: LogoutRequest = {
      allDevices,
      refreshToken: session.refreshToken,
    };

    const response = await this.request<LogoutResponse>("/auth/logout", {
      method: "POST",
      body: payload,
      auth: true,
    });

    this.clearSession();
    return response;
  }

  async sendSmsCode(
    payload: SendSmsCodeRequest,
  ): Promise<ProtocolResponse<SendSmsCodeResponse>> {
    return this.request<SendSmsCodeResponse>("/auth/sms/send", {
      method: "POST",
      body: payload,
    });
  }

  async sendEmailCode(
    payload: SendEmailCodeRequest,
  ): Promise<ProtocolResponse<SendEmailCodeResponse>> {
    return this.request<SendEmailCodeResponse>("/auth/email/send", {
      method: "POST",
      body: payload,
    });
  }

  async requestPasswordReset(
    payload: RequestPasswordResetRequest,
  ): Promise<ProtocolResponse<RequestPasswordResetResponse>> {
    return this.request<RequestPasswordResetResponse>("/auth/password/request-reset", {
      method: "POST",
      body: payload,
    });
  }

  async confirmPasswordReset(
    payload: ConfirmPasswordResetRequest,
  ): Promise<ProtocolResponse<ConfirmPasswordResetResponse>> {
    return this.request<ConfirmPasswordResetResponse>("/auth/password/confirm-reset", {
      method: "POST",
      body: payload,
    });
  }

  async bindMobile(
    payload: BindMobileRequest,
  ): Promise<ProtocolResponse<BindMobileResponse>> {
    await this.refreshToken();
    return this.request<BindMobileResponse>("/auth/bind/mobile", {
      method: "POST",
      body: payload,
      auth: true,
    });
  }

  async bindEmail(
    payload: BindEmailRequest,
  ): Promise<ProtocolResponse<BindEmailResponse>> {
    await this.refreshToken();
    return this.request<BindEmailResponse>("/auth/bind/email", {
      method: "POST",
      body: payload,
      auth: true,
    });
  }

  async getMe(): Promise<ProtocolResponse<GetMeResponse>> {
    await this.refreshToken();
    return this.request<GetMeResponse>("/user/me", {
      method: "GET",
      auth: true,
    });
  }

  async updateProfile(
    payload: UpdateProfileRequest,
  ): Promise<ProtocolResponse<UpdateProfileResponse>> {
    await this.refreshToken();
    const response = await this.request<UpdateProfileResponse>(
      "/user/profile",
      {
        method: "PATCH",
        body: payload,
        auth: true,
      },
    );

    if (response.ok && this.inMemorySession) {
      this.persistSession({
        ...this.inMemorySession,
        nickname: response.data.profile.nickname,
      });
    }

    return response;
  }

  updateSessionProfile(userId: string, nickname: string): void {
    const session = this.inMemorySession;
    if (!session || session.userId !== userId) {
      return;
    }

    const safeNickname = nickname.trim();
    if (!safeNickname || safeNickname === session.nickname) {
      return;
    }

    this.persistSession({
      ...session,
      nickname: safeNickname,
    });
  }

  private persistSession(next: AuthSessionState): void {
    this.inMemorySession = next;
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(next));
    } catch {
      // ignore storage errors
    }
  }

  private attachDeviceToLoginPayload(payload: LoginRequest): LoginRequest {
    if (payload.method === "password") {
      return {
        ...payload,
        payload: {
          ...payload.payload,
          device: payload.payload.device ?? this.getDeviceInfo(),
        },
      };
    }

    if (payload.method === "guest") {
      return {
        ...payload,
        payload: {
          ...payload.payload,
          device: payload.payload.device ?? this.getDeviceInfo(),
        },
      };
    }

    if (payload.method === "platform") {
      return {
        ...payload,
        payload: {
          ...payload.payload,
          device: payload.payload.device ?? this.getDeviceInfo(),
        },
      };
    }

    if (payload.method === "sms") {
      return {
        ...payload,
        payload: {
          ...payload.payload,
          device: payload.payload.device ?? this.getDeviceInfo(),
        },
      };
    }

    return payload;
  }

  private getDeviceInfo(): DeviceInfo {
    let deviceId = "";

    try {
      deviceId = window.localStorage.getItem(DEVICE_STORAGE_KEY)?.trim() ?? "";
      if (!deviceId) {
        deviceId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `web_${Math.random().toString(36).slice(2, 12)}`;
        window.localStorage.setItem(DEVICE_STORAGE_KEY, deviceId);
      }
    } catch {
      deviceId = `web_${Math.random().toString(36).slice(2, 12)}`;
    }

    return {
      deviceId,
      platform: "web",
      appVersion: "0.1.0",
      userAgent: navigator.userAgent,
      osVersion: navigator.platform,
      deviceModel: "browser",
    };
  }

  private loadSessionFromStorage(): AuthSessionState | null {
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<AuthSessionState>;
      if (
        typeof parsed.accessToken !== "string" ||
        typeof parsed.refreshToken !== "string" ||
        typeof parsed.expiresAt !== "number" ||
        typeof parsed.refreshExpiresAt !== "number" ||
        typeof parsed.userId !== "string" ||
        typeof parsed.gameId !== "string" ||
        typeof parsed.nickname !== "string" ||
        typeof parsed.method !== "string"
      ) {
        if (
          typeof parsed.accessToken !== "string" ||
          typeof parsed.refreshToken !== "string" ||
          typeof parsed.expiresAt !== "number" ||
          typeof parsed.refreshExpiresAt !== "number" ||
          typeof parsed.userId !== "string" ||
          typeof parsed.nickname !== "string"
        ) {
          return null;
        }
      }
      return {
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken,
        expiresAt: parsed.expiresAt,
        refreshExpiresAt: parsed.refreshExpiresAt,
        userId: parsed.userId,
        gameId:
          typeof parsed.gameId === "string" && parsed.gameId.trim()
            ? parsed.gameId
            : parsed.userId,
        nickname: parsed.nickname,
        method:
          parsed.method === "password" ||
          parsed.method === "guest" ||
          parsed.method === "sms" ||
          parsed.method === "apple" ||
          parsed.method === "wechat" ||
          parsed.method === "platform"
            ? parsed.method
            : "password",
      };
    } catch {
      return null;
    }
  }

  private async request<T>(
    path: string,
    options: {
      method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
      body?: unknown;
      auth?: boolean;
      requestId?: string;
    },
  ): Promise<ProtocolResponse<T>> {
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      this.requestTimeoutMs,
    );

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-request-id":
          options.requestId ?? `req_${Math.random().toString(36).slice(2, 10)}`,
      };

      if (options.auth) {
        const session = this.inMemorySession;
        if (!session) {
          return {
            ok: false,
            error: {
              code: "UNAUTHORIZED",
              message: "No auth session.",
              timestamp: new Date().toISOString(),
            },
          };
        }
        headers.Authorization = `Bearer ${session.accessToken}`;
      }

      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method,
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });

      const json = (await response.json()) as ProtocolResponse<T>;
      return json;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Network request failed.";
      return {
        ok: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message,
          timestamp: new Date().toISOString(),
        },
      };
    } finally {
      window.clearTimeout(timeout);
    }
  }
}

export const authService = new AuthService();
