// @ts-nocheck
export type ApiNodeEnv = "development" | "test" | "production";

export interface ApiServerConfig {
  env: ApiNodeEnv;
  host: string;
  port: number;
  corsOrigin: string;
  logLevel: "debug" | "info" | "warn" | "error";
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
    issuer: string;
    audience: string;
  };
  rateLimit: {
    windowMs: number;
    max: number;
    loginMax: number;
  };
  database: {
    url: string;
  };
  redis: {
    url: string;
    enabled: boolean;
  };
}

const DEFAULTS = {
  env: "development" as ApiNodeEnv,
  host: "0.0.0.0",
  port: 8788,
  corsOrigin: "*",
  logLevel: "info" as const,
  jwt: {
    accessSecret: "dev-access-secret-change-me",
    refreshSecret: "dev-refresh-secret-change-me",
    accessTtlSeconds: 60 * 60, // 1h
    refreshTtlSeconds: 60 * 60 * 24 * 30, // 30d
    issuer: "bop-api",
    audience: "bop-client",
  },
  rateLimit: {
    windowMs: 60_000,
    max: 120,
    loginMax: 20,
  },
  database: {
    url: "postgres://postgres:postgres@127.0.0.1:5432/bop",
  },
  redis: {
    url: "redis://127.0.0.1:6379",
    enabled: false,
  },
} as const;

function toEnv(value: string | undefined): ApiNodeEnv {
  if (value === "production" || value === "test" || value === "development") {
    return value;
  }
  return DEFAULTS.env;
}

function toNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  ) {
    return true;
  }
  if (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return false;
  }
  return fallback;
}

function toLogLevel(value: string | undefined): ApiServerConfig["logLevel"] {
  if (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  ) {
    return value;
  }
  return DEFAULTS.logLevel;
}

function readString(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export function loadApiServerConfig(
  env: NodeJS.ProcessEnv = process.env,
): ApiServerConfig {
  const nodeEnv = toEnv(env.NODE_ENV);

  const config: ApiServerConfig = {
    env: nodeEnv,
    host: readString(env.API_HOST, DEFAULTS.host),
    port: toNumber(env.API_PORT, DEFAULTS.port),
    corsOrigin: readString(env.CORS_ORIGIN, DEFAULTS.corsOrigin),
    logLevel: toLogLevel(env.LOG_LEVEL),
    jwt: {
      accessSecret: readString(
        env.JWT_ACCESS_SECRET,
        DEFAULTS.jwt.accessSecret,
      ),
      refreshSecret: readString(
        env.JWT_REFRESH_SECRET,
        DEFAULTS.jwt.refreshSecret,
      ),
      accessTtlSeconds: toNumber(
        env.JWT_ACCESS_TTL_SECONDS,
        DEFAULTS.jwt.accessTtlSeconds,
      ),
      refreshTtlSeconds: toNumber(
        env.JWT_REFRESH_TTL_SECONDS,
        DEFAULTS.jwt.refreshTtlSeconds,
      ),
      issuer: readString(env.JWT_ISSUER, DEFAULTS.jwt.issuer),
      audience: readString(env.JWT_AUDIENCE, DEFAULTS.jwt.audience),
    },
    rateLimit: {
      windowMs: toNumber(env.RATE_LIMIT_WINDOW_MS, DEFAULTS.rateLimit.windowMs),
      max: toNumber(env.RATE_LIMIT_MAX, DEFAULTS.rateLimit.max),
      loginMax: toNumber(env.RATE_LIMIT_LOGIN_MAX, DEFAULTS.rateLimit.loginMax),
    },
    database: {
      url: readString(env.DATABASE_URL, DEFAULTS.database.url),
    },
    redis: {
      url: readString(env.REDIS_URL, DEFAULTS.redis.url),
      enabled: toBoolean(env.REDIS_ENABLED, DEFAULTS.redis.enabled),
    },
  };

  return config;
}

export const apiServerConfig: ApiServerConfig = loadApiServerConfig();
