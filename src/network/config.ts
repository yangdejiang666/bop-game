export type RuntimeEnv = "development" | "staging" | "production";

export interface NetworkConfig {
  env: RuntimeEnv;
  apiBaseUrl: string;
  wsBaseUrl: string;
  requestTimeoutMs: number;
  heartbeatIntervalMs: number;
  useBackendMatching: boolean;
  reconnect: {
    enabled: boolean;
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    jitterMs: number;
  };
}

const DEFAULTS: NetworkConfig = {
  env: "development",
  apiBaseUrl: "http://127.0.0.1:8788/api/v1",
  wsBaseUrl: "ws://127.0.0.1:8899/ws",
  requestTimeoutMs: 12_000,
  heartbeatIntervalMs: 10_000,
  useBackendMatching: false,
  reconnect: {
    enabled: true,
    maxAttempts: 8,
    baseDelayMs: 400,
    maxDelayMs: 10_000,
    jitterMs: 300,
  },
};

function normalizeEnv(value: string | undefined): RuntimeEnv {
  const v = value?.trim().toLowerCase();
  if (v === "production") return "production";
  if (v === "staging") return "staging";
  return "development";
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".localhost")
  );
}

function inferBrowserHostedEnv(): RuntimeEnv | null {
  if (typeof window === "undefined" || !window.location?.hostname) {
    return null;
  }

  return isLocalHostname(window.location.hostname)
    ? "development"
    : "production";
}

function sanitizeUrl(value: string | undefined, fallback: string): string {
  const next = value?.trim();
  if (!next) return fallback;
  try {
    const parsed = new URL(next);
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

function sanitizePositiveInt(
  value: string | number | undefined,
  fallback: number,
): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function sanitizeBoolean(
  value: string | boolean | undefined,
  fallback: boolean,
): boolean {
  if (typeof value === "boolean") return value;
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function deriveSameOriginDefaults():
  | Pick<NetworkConfig, "apiBaseUrl" | "wsBaseUrl">
  | null {
  if (typeof window === "undefined" || !window.location?.origin) {
    return null;
  }

  const origin = window.location.origin.replace(/\/+$/, "");

  try {
    const wsUrl = new URL(origin);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    return {
      apiBaseUrl: `${origin}/api/v1`,
      wsBaseUrl: `${wsUrl.toString().replace(/\/+$/, "")}/ws`,
    };
  } catch {
    return null;
  }
}

function deriveDefaultsByEnv(
  env: RuntimeEnv,
): Pick<NetworkConfig, "apiBaseUrl" | "wsBaseUrl"> {
  const sameOriginDefaults = deriveSameOriginDefaults();

  if (env === "production") {
    return {
      apiBaseUrl:
        sameOriginDefaults?.apiBaseUrl ?? "https://bop-game.pages.dev/api/v1",
      wsBaseUrl: sameOriginDefaults?.wsBaseUrl ?? "wss://bop-game.pages.dev/ws",
    };
  }

  if (env === "staging") {
    return {
      apiBaseUrl:
        sameOriginDefaults?.apiBaseUrl ??
        "https://staging.bop-game.pages.dev/api/v1",
      wsBaseUrl:
        sameOriginDefaults?.wsBaseUrl ?? "wss://staging.bop-game.pages.dev/ws",
    };
  }

  return {
    apiBaseUrl: DEFAULTS.apiBaseUrl,
    wsBaseUrl: DEFAULTS.wsBaseUrl,
  };
}

/**
 * Read client network config from Vite env:
 * - VITE_APP_ENV
 * - VITE_API_BASE_URL
 * - VITE_WS_BASE_URL
 * - VITE_REQUEST_TIMEOUT_MS
 * - VITE_WS_HEARTBEAT_MS
 * - VITE_USE_BACKEND_MATCHING
 * - VITE_WS_RECONNECT_ENABLED
 * - VITE_WS_RECONNECT_MAX_ATTEMPTS
 * - VITE_WS_RECONNECT_BASE_DELAY_MS
 * - VITE_WS_RECONNECT_MAX_DELAY_MS
 * - VITE_WS_RECONNECT_JITTER_MS
 */
export function loadNetworkConfig(): NetworkConfig {
  const explicitEnv = String(import.meta.env.VITE_APP_ENV ?? "").trim();
  const env = explicitEnv
    ? normalizeEnv(explicitEnv)
    : inferBrowserHostedEnv() ?? DEFAULTS.env;
  const envDefaults = deriveDefaultsByEnv(env);

  const reconnectEnabledRaw = String(
    import.meta.env.VITE_WS_RECONNECT_ENABLED ?? "",
  )
    .trim()
    .toLowerCase();
  const reconnectEnabled = reconnectEnabledRaw
    ? reconnectEnabledRaw === "1" ||
      reconnectEnabledRaw === "true" ||
      reconnectEnabledRaw === "yes"
    : DEFAULTS.reconnect.enabled;
  const useSameOriginProductionProxy = env === "production";

  return {
    env,
    apiBaseUrl: useSameOriginProductionProxy
      ? envDefaults.apiBaseUrl
      : sanitizeUrl(import.meta.env.VITE_API_BASE_URL, envDefaults.apiBaseUrl),
    wsBaseUrl: useSameOriginProductionProxy
      ? envDefaults.wsBaseUrl
      : sanitizeUrl(import.meta.env.VITE_WS_BASE_URL, envDefaults.wsBaseUrl),
    requestTimeoutMs: sanitizePositiveInt(
      import.meta.env.VITE_REQUEST_TIMEOUT_MS,
      DEFAULTS.requestTimeoutMs,
    ),
    heartbeatIntervalMs: sanitizePositiveInt(
      import.meta.env.VITE_WS_HEARTBEAT_MS,
      DEFAULTS.heartbeatIntervalMs,
    ),
    useBackendMatching: sanitizeBoolean(
      import.meta.env.VITE_USE_BACKEND_MATCHING,
      DEFAULTS.useBackendMatching,
    ),
    reconnect: {
      enabled: reconnectEnabled,
      maxAttempts: sanitizePositiveInt(
        import.meta.env.VITE_WS_RECONNECT_MAX_ATTEMPTS,
        DEFAULTS.reconnect.maxAttempts,
      ),
      baseDelayMs: sanitizePositiveInt(
        import.meta.env.VITE_WS_RECONNECT_BASE_DELAY_MS,
        DEFAULTS.reconnect.baseDelayMs,
      ),
      maxDelayMs: sanitizePositiveInt(
        import.meta.env.VITE_WS_RECONNECT_MAX_DELAY_MS,
        DEFAULTS.reconnect.maxDelayMs,
      ),
      jitterMs: sanitizePositiveInt(
        import.meta.env.VITE_WS_RECONNECT_JITTER_MS,
        DEFAULTS.reconnect.jitterMs,
      ),
    },
  };
}

export const networkConfig: NetworkConfig = loadNetworkConfig();
