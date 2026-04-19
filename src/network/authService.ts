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
  UserAuthorization,
  UserPlaytimePolicy,
} from "../../shared-protocol/src/access";
import type {
  GetMeResponse,
  UpdateProfileRequest,
  UpdateProfileResponse,
} from "../../shared-protocol/src/user";
import type { ProtocolResponse } from "../../shared-protocol/src/errors";
import { HttpClient } from "./http";
import { networkConfig } from "./config";

const DEVICE_STORAGE_KEY = "bop:device-id";

export interface AuthServiceConfig {
  baseUrl?: string;
  storageKey?: string;
  requestTimeoutMs?: number;
  /** 外部注入的 HttpClient（测试/Mock 场景） */
  httpClient?: HttpClient;
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
  isDeveloper: boolean;
  playtimePolicy: UserPlaytimePolicy;
}

export interface AuthHeadersOptions {
  includeAuth?: boolean;
  requestId?: string;
}

/**
 * 认证服务 — 管理用户登录态、Token 刷新、注册/登录/登出等认证流程。
 *
 * 特殊设计说明：
 * - 继承自 BaseService 模式但不继承（因为需要返回完整 ProtocolResponse 而非解包后的裸 data）
 * - 内部使用 HttpClient 统一处理 HTTP 通信（与其他 Service 共享同一套基础设施）
 * - register/login 等方法需要检查 response.ok 并在成功后持久化 session，
 *   因此使用 rawPost/rawGet 返回完整 ProtocolResponse
 * - bindMobile/bindEmail/getMe/updateProfile 等方法需要先刷新 Token 再请求，
 *   因此内部调用 refreshToken() 后再发带 auth 的请求
 *
 * 公共 API 完全不变，所有外部引用无需修改。
 */
export class AuthService {
  private readonly http: HttpClient;
  private readonly storageKey: string;
  private readonly requestTimeoutMs: number;
  private inMemorySession: AuthSessionState | null = null;

  constructor(config?: AuthServiceConfig) {
    this.storageKey = config?.storageKey ?? "bop:auth-session";
    this.requestTimeoutMs = Math.max(1000, config?.requestTimeoutMs ?? 10_000);
    this.inMemorySession = this.loadSessionFromStorage();

    const baseUrl = ((config != null ? config.baseUrl : undefined) ?? networkConfig.apiBaseUrl).replace(/\/+$/, "");

    this.http =
      config?.httpClient ??
      new HttpClient({
        baseUrl,
        getRequestId: () => `req_${Math.random().toString(36).slice(2, 10)}`,
        timeoutMs: this.requestTimeoutMs,
      });
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
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("bop:auth-session-changed"));
    }
  }

  installDebugSession(session: AuthSessionState): void {
    this.persistSession(session);
  }

  // ─── 认证核心方法 ──────────────────────────────────────

  async register(
    payload: RegisterByPasswordRequest,
  ): Promise<ProtocolResponse<RegisterByPasswordResponse>> {
    const requestPayload: RegisterByPasswordRequest = {
      ...payload,
      device: payload.device ?? this.getDeviceInfo(),
    };
    const response = await this.http.post<RegisterByPasswordResponse>(
      "/auth/register",
      requestPayload,
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
        isDeveloper: response.data.user.role === "developer",
        playtimePolicy: {
          ...response.data.user.playtimePolicy,
          activeSessionId: null,
          lastHeartbeatAt: null,
        },
      });
    }

    return response;
  }

  async login(payload: LoginRequest): Promise<ProtocolResponse<LoginResponse>> {
    const requestPayload = this.attachDeviceToLoginPayload(payload);
    const response = await this.http.post<LoginResponse>("/auth/login", requestPayload);

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
        isDeveloper: response.data.user.role === "developer",
        playtimePolicy: {
          ...response.data.user.playtimePolicy,
          activeSessionId: null,
          lastHeartbeatAt: null,
        },
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

    // refresh 端点不需要 Bearer Token（用 refreshToken 字段即可）
    const response = await this.http.post<RefreshTokenResponse>(
      "/auth/refresh",
      payload,
    );

    if (response.ok) {
      this.persistSession({
        ...session,
        accessToken: response.data.tokens.accessToken,
        refreshToken: response.data.tokens.refreshToken,
        expiresAt: Date.now() + response.data.tokens.expiresIn * 1000,
        refreshExpiresAt:
          Date.now() + response.data.tokens.refreshExpiresIn * 1000,
        method: session.method,
        playtimePolicy: session.playtimePolicy,
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

    // logout 需要 Bearer Token + refreshToken body
    const response = await this.http.post<LogoutResponse>("/auth/logout", payload, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });

    this.clearSession();
    return response;
  }

  // ─── 验证码与密码重置 ─────────────────────────────────

  async sendSmsCode(
    payload: SendSmsCodeRequest,
  ): Promise<ProtocolResponse<SendSmsCodeResponse>> {
    return this.http.post<SendSmsCodeResponse>("/auth/sms/send", payload);
  }

  async sendEmailCode(
    payload: SendEmailCodeRequest,
  ): Promise<ProtocolResponse<SendEmailCodeResponse>> {
    return this.http.post<SendEmailCodeResponse>("/auth/email/send", payload);
  }

  async requestPasswordReset(
    payload: RequestPasswordResetRequest,
  ): Promise<ProtocolResponse<RequestPasswordResetResponse>> {
    return this.http.post<RequestPasswordResetResponse>(
      "/auth/password/request-reset",
      payload,
    );
  }

  async confirmPasswordReset(
    payload: ConfirmPasswordResetRequest,
  ): Promise<ProtocolResponse<ConfirmPasswordResetResponse>> {
    return this.http.post<ConfirmPasswordResetResponse>(
      "/auth/password/confirm-reset",
      payload,
    );
  }

  // ─── 已登录用户的操作（自动带 Auth + 自动 Refresh）──

  async bindMobile(
    payload: BindMobileRequest,
  ): Promise<ProtocolResponse<BindMobileResponse>> {
    await this.refreshToken();
    return this.authRequest<BindMobileResponse>("/auth/bind/mobile", "POST", payload);
  }

  async bindEmail(
    payload: BindEmailRequest,
  ): Promise<ProtocolResponse<BindEmailResponse>> {
    await this.refreshToken();
    return this.authRequest<BindEmailResponse>("/auth/bind/email", "POST", payload);
  }

  async getMe(): Promise<ProtocolResponse<GetMeResponse>> {
    await this.refreshToken();
    return this.authRequest<GetMeResponse>("/user/me", "GET");
  }

  async updateProfile(
    payload: UpdateProfileRequest,
  ): Promise<ProtocolResponse<UpdateProfileResponse>> {
    await this.refreshToken();
    const response = await this.authRequest<UpdateProfileResponse>(
      "/user/profile",
      "PATCH",
      payload,
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

  updateSessionAuthorization(userId: string, authorization: UserAuthorization): void {
    const session = this.inMemorySession;
    if (!session || session.userId !== userId) {
      return;
    }

    this.persistSession({
      ...session,
      isDeveloper: authorization.role === "developer",
      playtimePolicy: authorization.playtimePolicy,
    });
  }

  // ─── 私有方法 ────────────────────────────────────────

  /**
   * 带认证头的通用请求方法。
   * 自动从当前 session 取 Bearer Token，无 session 时返回 UNAUTHORIZED 错误响应。
   */
  private async authRequest<T>(
    path: string,
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    body?: unknown,
  ): Promise<ProtocolResponse<T>> {
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

    const options: Parameters<HttpClient["post"]>[2] = {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    };

    switch (method) {
      case "GET":
        return this.http.get<T>(path, options);
      case "POST":
        return this.http.post<T>(path, body, options);
      case "PATCH":
        return this.http.patch<T>(path, body, options);
      case "PUT":
        return this.http.put<T>(path, body, options);
      case "DELETE":
        return this.http.delete<T>(path, options);
      default:
        return this.http.post<T>(path, body, options);
    }
  }

  private persistSession(next: AuthSessionState): void {
    this.inMemorySession = next;
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(next));
    } catch {
      // ignore storage errors
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("bop:auth-session-changed"));
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
      const playtimePolicy = parsed.playtimePolicy as Partial<UserPlaytimePolicy> | undefined;
      if (
        typeof parsed.accessToken !== "string" ||
        typeof parsed.refreshToken !== "string" ||
        typeof parsed.expiresAt !== "number" ||
        typeof parsed.refreshExpiresAt !== "number" ||
        typeof parsed.userId !== "string" ||
        typeof parsed.gameId !== "string" ||
        typeof parsed.nickname !== "string" ||
        typeof parsed.method !== "string" ||
        typeof playtimePolicy !== "object" ||
        playtimePolicy === null
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
      const safePlaytimePolicy: Partial<UserPlaytimePolicy> = playtimePolicy ?? {};

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
        isDeveloper: parsed.isDeveloper === true,
        playtimePolicy: {
          requiredSeconds:
            typeof safePlaytimePolicy.requiredSeconds === "number"
              ? safePlaytimePolicy.requiredSeconds
              : 360,
          accumulatedSeconds:
            typeof safePlaytimePolicy.accumulatedSeconds === "number"
              ? safePlaytimePolicy.accumulatedSeconds
              : 0,
          remainingSeconds:
            typeof safePlaytimePolicy.remainingSeconds === "number"
              ? safePlaytimePolicy.remainingSeconds
              : 360,
          canExitMatch: safePlaytimePolicy.canExitMatch === true,
          activeSessionId:
            typeof safePlaytimePolicy.activeSessionId === "string"
              ? safePlaytimePolicy.activeSessionId
              : null,
          lastHeartbeatAt:
            typeof safePlaytimePolicy.lastHeartbeatAt === "string"
              ? safePlaytimePolicy.lastHeartbeatAt
              : null,
          unlockedFeatureKeys: Array.isArray(safePlaytimePolicy.unlockedFeatureKeys)
            ? safePlaytimePolicy.unlockedFeatureKeys.filter(
                (item): item is UserPlaytimePolicy["unlockedFeatureKeys"][number] =>
                  typeof item === "string",
              )
            : [],
          pendingFeatureKeys: Array.isArray(safePlaytimePolicy.pendingFeatureKeys)
            ? safePlaytimePolicy.pendingFeatureKeys.filter(
                (item): item is UserPlaytimePolicy["pendingFeatureKeys"][number] =>
                  typeof item === "string",
              )
            : [],
        },
      };
    } catch {
      return null;
    }
  }
}

export const authService = new AuthService();
