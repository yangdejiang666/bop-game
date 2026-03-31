export interface ClientPlatformConfig {
  enableLocalAuthBypass: boolean;
  clerk: {
    enabled: boolean;
    publishableKey: string;
    signInUrl: string;
    signUpUrl: string;
    afterSignInUrl: string;
    afterSignUpUrl: string;
  };
  stripe: {
    enabled: boolean;
    publishableKey: string;
    defaultProductKey: string;
  };
  supabase: {
    enabled: boolean;
    url: string;
    anonKey: string;
    avatarBucket: string;
  };
  posthog: {
    enabled: boolean;
    apiKey: string;
    host: string;
  };
  sentry: {
    enabled: boolean;
    dsn: string;
    tracesSampleRate: number;
    environment: string;
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function readFraction(value: unknown, fallback: number): number {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 0 || next > 1) {
    return fallback;
  }
  return next;
}

function isEnabled(explicit: unknown, fields: string[]): boolean {
  if (typeof explicit === "string" && explicit.trim()) {
    return readBoolean(explicit, false);
  }
  return fields.some((field) => field.length > 0);
}

const clerkPublishableKey = readString(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const stripePublishableKey = readString(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
const supabaseUrl = readString(import.meta.env.VITE_SUPABASE_URL);
const supabaseAnonKey = readString(import.meta.env.VITE_SUPABASE_ANON_KEY);
const posthogApiKey = readString(import.meta.env.VITE_POSTHOG_API_KEY);
const sentryDsn = readString(import.meta.env.VITE_SENTRY_DSN);

export const clientPlatformConfig: ClientPlatformConfig = {
  enableLocalAuthBypass: readBoolean(
    import.meta.env.VITE_ENABLE_LOCAL_AUTH_BYPASS,
    false,
  ),
  clerk: {
    enabled: isEnabled(import.meta.env.VITE_CLERK_ENABLED, [clerkPublishableKey]),
    publishableKey: clerkPublishableKey,
    signInUrl: readString(import.meta.env.VITE_CLERK_SIGN_IN_URL),
    signUpUrl: readString(import.meta.env.VITE_CLERK_SIGN_UP_URL),
    afterSignInUrl: readString(import.meta.env.VITE_CLERK_AFTER_SIGN_IN_URL),
    afterSignUpUrl: readString(import.meta.env.VITE_CLERK_AFTER_SIGN_UP_URL),
  },
  stripe: {
    enabled: isEnabled(import.meta.env.VITE_STRIPE_ENABLED, [stripePublishableKey]),
    publishableKey: stripePublishableKey,
    defaultProductKey:
      readString(import.meta.env.VITE_STRIPE_DEFAULT_PRODUCT_KEY) || "coins_1200",
  },
  supabase: {
    enabled: isEnabled(import.meta.env.VITE_SUPABASE_ENABLED, [
      supabaseUrl,
      supabaseAnonKey,
    ]),
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
    avatarBucket:
      readString(import.meta.env.VITE_SUPABASE_AVATAR_BUCKET) || "avatars",
  },
  posthog: {
    enabled: isEnabled(import.meta.env.VITE_POSTHOG_ENABLED, [posthogApiKey]),
    apiKey: posthogApiKey,
    host: readString(import.meta.env.VITE_POSTHOG_HOST) || "https://us.i.posthog.com",
  },
  sentry: {
    enabled: isEnabled(import.meta.env.VITE_SENTRY_ENABLED, [sentryDsn]),
    dsn: sentryDsn,
    tracesSampleRate: readFraction(
      import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
      0.2,
    ),
    environment:
      readString(import.meta.env.VITE_SENTRY_ENVIRONMENT) ||
      readString(import.meta.env.VITE_APP_ENV) ||
      "development",
  },
};
