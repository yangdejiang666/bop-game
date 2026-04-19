import type { ProtocolResponse } from "../../shared-protocol/src/errors";
import type {
  StartMatchmakingRequest,
  StartMatchmakingResponse,
  CancelMatchmakingRequest,
  CancelMatchmakingResponse,
  MatchmakingTicketState,
} from "../../shared-protocol/src/matchmaking";
import { HttpClient } from "./http";
import { networkConfig } from "./config";
import { authService } from "./authService";

export interface MatchmakingServiceOptions {
  /** 外部注入的 HttpClient（测试/Mock 场景） */
  httpClient?: HttpClient;
}

export class MatchmakingServiceError extends Error {
  public readonly status?: number;
  public readonly code?: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    status?: number,
    code?: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "MatchmakingServiceError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * 匹配服务 — 管理后端匹配流程（开始/取消/轮询状态/获取活跃票据）。
 *
 * 特殊设计说明：
 * - 不继承 BaseService，因为需要自定义错误类型（MatchmakingServiceError）
 *   和轮询逻辑，但内部使用 HttpClient 统一通信
 * - 公共 API 返回裸 data（非 ProtocolResponse），失败时抛 MatchmakingServiceError
 */
export class MatchmakingService {
  private readonly http: HttpClient;

  constructor(options: MatchmakingServiceOptions = {}) {
    this.http =
      options.httpClient ??
      new HttpClient({
        baseUrl: networkConfig.apiBaseUrl,
        prepareAuth: () => authService.refreshToken(),
        getAccessToken: () => authService.getSession()?.accessToken ?? null,
        timeoutMs: networkConfig.requestTimeoutMs ?? 12_000,
      });
  }

  async start(
    payload: StartMatchmakingRequest,
  ): Promise<StartMatchmakingResponse> {
    return this.request<StartMatchmakingResponse>(
      "/matchmaking/start",
      { method: "POST", body: payload },
    );
  }

  async cancel(
    ticketId: string,
    reason: CancelMatchmakingRequest["reason"] = "user_cancelled",
  ): Promise<CancelMatchmakingResponse> {
    if (!ticketId || ticketId.trim().length === 0) {
      throw new MatchmakingServiceError(
        "ticketId is required to cancel matchmaking",
      );
    }

    return this.request<CancelMatchmakingResponse>(
      "/matchmaking/cancel",
      {
        method: "POST",
        body: { ticketId: ticketId.trim(), reason } satisfies CancelMatchmakingRequest,
      },
    );
  }

  async getTicketStatus(ticketId: string): Promise<MatchmakingTicketState> {
    if (!ticketId || ticketId.trim().length === 0) {
      throw new MatchmakingServiceError("ticketId is required to query status");
    }

    const encoded = encodeURIComponent(ticketId.trim());
    return this.request<MatchmakingTicketState>(
      `/matchmaking/status/${encoded}`,
      { method: "GET" },
    );
  }

  async getActiveTicket(): Promise<MatchmakingTicketState | null> {
    const response = await this.raw<{ ticket: MatchmakingTicketState | null }>(
      "/matchmaking/active",
      { method: "GET" },
    );
    if (!response.ok) {
      throw new MatchmakingServiceError(
        response.error.message,
        undefined,
        response.error.code,
        response.error.details,
      );
    }
    return response.data!.ticket;
  }

  async pollTicketStatus(
    ticketId: string,
    options?: {
      intervalMs?: number;
      timeoutMs?: number;
      onTick?: (state: MatchmakingTicketState) => void;
      shouldStop?: (state: MatchmakingTicketState) => boolean;
    },
  ): Promise<MatchmakingTicketState> {
    const intervalMs = options?.intervalMs ?? 1000;
    const timeoutMs = options?.timeoutMs ?? 60_000;
    const startedAt = Date.now();

    while (true) {
      const state = await this.getTicketStatus(ticketId);
      options?.onTick?.(state);

      const terminal =
        state.stage === "matched" ||
        state.stage === "cancelled" ||
        state.stage === "failed";

      if (terminal || options?.shouldStop?.(state)) {
        return state;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        throw new MatchmakingServiceError(
          `Polling timeout after ${timeoutMs}ms`,
          408,
          "MATCH_POLL_TIMEOUT",
          { ticketId, timeoutMs },
        );
      }

      await sleep(intervalMs);
    }
  }

  // ─── 私有方法 ────────────────────────────────────────

  /**
   * 发送请求并解包为裸 data。
   * 失败时抛出 MatchmakingServiceError（携带协议错误详情）。
   */
  private async request<T>(
    path: string,
    options: { method: "GET" | "POST"; body?: unknown },
  ): Promise<T> {
    const response = await this.raw<T>(path, options);

    if (!response.ok) {
      throw new MatchmakingServiceError(
        response.error.message,
        undefined,
        response.error.code,
        response.error.details,
      );
    }

    return response.data!;
  }

  /**
   * 使用 HttpClient 发送原始请求，返回完整 ProtocolResponse。
   */
  private async raw<T>(
    path: string,
    options: { method: "GET" | "POST"; body?: unknown },
  ): Promise<ProtocolResponse<T>> {
    if (options.method === "POST") {
      return this.http.post<T>(path, options.body, { withAuth: true });
    }
    return this.http.get<T>(path, { withAuth: true });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
