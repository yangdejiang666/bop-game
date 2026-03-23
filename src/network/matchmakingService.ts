import type { ProtocolResponse } from "../../shared-protocol/src/errors";
import type {
  StartMatchmakingRequest,
  StartMatchmakingResponse,
  CancelMatchmakingRequest,
  CancelMatchmakingResponse,
  MatchmakingTicketState,
} from "../../shared-protocol/src/matchmaking";

export interface MatchmakingServiceOptions {
  baseUrl: string;
  prepareAuth?: () => Promise<unknown> | unknown;
  getAccessToken: () => string | null;
  requestTimeoutMs?: number;
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

export class MatchmakingService {
  private readonly baseUrl: string;
  private readonly prepareAuth?: () => Promise<unknown> | unknown;
  private readonly getAccessToken: () => string | null;
  private readonly requestTimeoutMs: number;

  constructor(options: MatchmakingServiceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.prepareAuth = options.prepareAuth;
    this.getAccessToken = options.getAccessToken;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 12_000;
  }

  async start(
    payload: StartMatchmakingRequest,
  ): Promise<StartMatchmakingResponse> {
    const result = await this.request<StartMatchmakingResponse>(
      "/matchmaking/start",
      {
        method: "POST",
        body: payload,
      },
    );
    return result;
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

    const result = await this.request<CancelMatchmakingResponse>(
      "/matchmaking/cancel",
      {
        method: "POST",
        body: {
          ticketId: ticketId.trim(),
          reason,
        } satisfies CancelMatchmakingRequest,
      },
    );
    return result;
  }

  async getTicketStatus(ticketId: string): Promise<MatchmakingTicketState> {
    if (!ticketId || ticketId.trim().length === 0) {
      throw new MatchmakingServiceError("ticketId is required to query status");
    }

    const encoded = encodeURIComponent(ticketId.trim());
    return this.request<MatchmakingTicketState>(
      `/matchmaking/status/${encoded}`,
      {
        method: "GET",
      },
    );
  }

  async getActiveTicket(): Promise<MatchmakingTicketState | null> {
    const response = await this.request<{
      ticket: MatchmakingTicketState | null;
    }>("/matchmaking/active", { method: "GET" });
    return response.ticket;
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

  private async request<T>(
    path: string,
    init: {
      method: "GET" | "POST";
      body?: unknown;
    },
  ): Promise<T> {
    await this.prepareAuth?.();
    const token = this.getAccessToken();

    const controller = new AbortController();
    const timer = window.setTimeout(
      () => controller.abort(),
      this.requestTimeoutMs,
    );

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });

      const raw = (await safeJson(response)) as ProtocolResponse<T> | unknown;

      if (!response.ok) {
        const err = extractProtocolFailure(raw);
        throw new MatchmakingServiceError(
          err?.message ?? `HTTP ${response.status}`,
          response.status,
          err?.code,
          err?.details,
        );
      }

      const success = extractProtocolSuccess<T>(raw);
      if (!success) {
        throw new MatchmakingServiceError(
          "Unexpected API response format",
          response.status,
          "INVALID_RESPONSE",
        );
      }

      return success;
    } catch (error) {
      if (error instanceof MatchmakingServiceError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new MatchmakingServiceError(
          `Request timeout after ${this.requestTimeoutMs}ms`,
          408,
          "REQUEST_TIMEOUT",
        );
      }

      throw new MatchmakingServiceError(
        error instanceof Error
          ? error.message
          : "Unknown matchmaking request error",
      );
    } finally {
      window.clearTimeout(timer);
    }
  }
}

function extractProtocolSuccess<T>(raw: unknown): T | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const maybe = raw as { ok?: unknown; data?: unknown };
  if (maybe.ok !== true) {
    return null;
  }

  return maybe.data as T;
}

function extractProtocolFailure(
  raw: unknown,
): { code?: string; message?: string; details?: unknown } | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const maybe = raw as { ok?: unknown; error?: unknown };
  if (maybe.ok !== false || !maybe.error || typeof maybe.error !== "object") {
    return null;
  }

  const error = maybe.error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };

  return {
    code: typeof error.code === "string" ? error.code : undefined,
    message: typeof error.message === "string" ? error.message : undefined,
    details: error.details,
  };
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: { message: text } };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
