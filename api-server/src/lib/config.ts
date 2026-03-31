export type ApiNodeEnv = "development" | "test" | "production";

export interface ApiServerConfig {
  env: ApiNodeEnv;
  host: string;
  port: number;
  corsOrigin: string;
  logLevel: "debug" | "info" | "warn" | "error";
  app: {
    publicSiteUrl: string;
  };
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
  integrations: {
    communications: {
      emailProvider: "disabled" | "local" | "resend";
      smsProvider: "disabled" | "local" | "aliyun";
      defaultPhoneCountryCode: string;
    };
    stripe: {
      enabled: boolean;
      secretKey: string;
      publishableKey: string;
      webhookSecret: string;
      defaultProductKey: string;
      successUrl: string;
      cancelUrl: string;
      prices: {
        coins1200: string;
        founderPack: string;
        seasonPass: string;
      };
    };
    supabase: {
      enabled: boolean;
      url: string;
      anonKey: string;
      serviceRoleKey: string;
      avatarBucket: string;
    };
    resend: {
      enabled: boolean;
      apiKey: string;
      fromEmail: string;
      replyTo: string;
      webhookSecret: string;
    };
    aliyunSms: {
      enabled: boolean;
      accessKeyId: string;
      accessKeySecret: string;
      endpoint: string;
      regionId: string;
      signName: string;
      templateCodes: {
        login: string;
        register: string;
        resetPassword: string;
        bindMobile: string;
      };
    };
    clerk: {
      enabled: boolean;
      publishableKey: string;
      secretKey: string;
      jwtKey: string;
      signInUrl: string;
      signUpUrl: string;
      afterSignInUrl: string;
      afterSignUpUrl: string;
      authorizedParties: string[];
    };
    posthog: {
      enabled: boolean;
      apiKey: string;
      personalApiKey: string;
      host: string;
    };
    sentry: {
      enabled: boolean;
      dsn: string;
      environment: string;
      tracesSampleRate: number;
    };
    upstash: {
      enabled: boolean;
      url: string;
      token: string;
      loginLimit: number;
      loginWindow: string;
      registerLimit: number;
      registerWindow: string;
      checkoutLimit: number;
      checkoutWindow: string;
    };
    pinecone: {
      enabled: boolean;
      apiKey: string;
      indexHost: string;
      namespace: string;
      topK: number;
    };
  };
}

const DEFAULTS = {
  env: "development" as ApiNodeEnv,
  host: "0.0.0.0",
  port: 8788,
  corsOrigin: "*",
  logLevel: "info" as const,
  app: {
    publicSiteUrl: "http://127.0.0.1:4180",
  },
  jwt: {
    accessSecret: "dev-access-secret-change-me",
    refreshSecret: "dev-refresh-secret-change-me",
    accessTtlSeconds: 60 * 60,
    refreshTtlSeconds: 60 * 60 * 24 * 30,
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
  integrations: {
    communications: {
      emailProvider: "local" as const,
      smsProvider: "local" as const,
      defaultPhoneCountryCode: "+86",
    },
    stripe: {
      secretKey: "",
      publishableKey: "",
      webhookSecret: "",
      defaultProductKey: "coins_1200",
      successUrl: "http://127.0.0.1:4180/?checkout=success",
      cancelUrl: "http://127.0.0.1:4180/?checkout=cancelled",
      prices: {
        coins1200: "",
        founderPack: "",
        seasonPass: "",
      },
    },
    supabase: {
      url: "",
      anonKey: "",
      serviceRoleKey: "",
      avatarBucket: "avatars",
    },
    resend: {
      apiKey: "",
      fromEmail: "BOP <onboarding@resend.dev>",
      replyTo: "",
      webhookSecret: "",
    },
    aliyunSms: {
      accessKeyId: "",
      accessKeySecret: "",
      endpoint: "dysmsapi.aliyuncs.com",
      regionId: "cn-hangzhou",
      signName: "",
      templateCodes: {
        login: "",
        register: "",
        resetPassword: "",
        bindMobile: "",
      },
    },
    clerk: {
      publishableKey: "",
      secretKey: "",
      jwtKey: "",
      signInUrl: "",
      signUpUrl: "",
      afterSignInUrl: "http://127.0.0.1:4180",
      afterSignUpUrl: "http://127.0.0.1:4180",
      authorizedParties: ["http://127.0.0.1:4180"],
    },
    posthog: {
      apiKey: "",
      personalApiKey: "",
      host: "https://us.i.posthog.com",
    },
    sentry: {
      dsn: "",
      environment: "development",
      tracesSampleRate: 0.2,
    },
    upstash: {
      url: "",
      token: "",
      loginLimit: 6,
      loginWindow: "10 m",
      registerLimit: 4,
      registerWindow: "30 m",
      checkoutLimit: 3,
      checkoutWindow: "5 m",
    },
    pinecone: {
      apiKey: "",
      indexHost: "",
      namespace: "bop-guide",
      topK: 5,
    },
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

function toEmailProvider(
  value: string | undefined,
  env: ApiNodeEnv,
  resendApiKey: string,
): ApiServerConfig["integrations"]["communications"]["emailProvider"] {
  if (value === "disabled" || value === "local" || value === "resend") {
    return value;
  }
  if (resendApiKey.trim().length > 0) {
    return "resend";
  }
  return env === "production" ? "disabled" : "local";
}

function toSmsProvider(
  value: string | undefined,
  env: ApiNodeEnv,
  hasAliyunCredentials: boolean,
): ApiServerConfig["integrations"]["communications"]["smsProvider"] {
  if (value === "disabled" || value === "local" || value === "aliyun") {
    return value;
  }
  if (hasAliyunCredentials) {
    return "aliyun";
  }
  return env === "production" ? "disabled" : "local";
}

function toFraction(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const next = Number(value);
  if (!Number.isFinite(next) || next < 0 || next > 1) {
    return fallback;
  }
  return next;
}

function toStringArray(
  value: string | undefined,
  fallback: readonly string[],
): string[] {
  if (!value) {
    return [...fallback];
  }
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : [...fallback];
}

function readString(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function isEnabled(explicit: string | undefined, values: string[]): boolean {
  if (explicit !== undefined) {
    return toBoolean(explicit, false);
  }
  return values.some((value) => value.trim().length > 0);
}

export function loadApiServerConfig(
  env: NodeJS.ProcessEnv = process.env,
): ApiServerConfig {
  const nodeEnv = toEnv(env.NODE_ENV);
  const publicSiteUrl = readString(
    env.PUBLIC_SITE_URL,
    readString(env.SITE_ORIGIN, DEFAULTS.app.publicSiteUrl),
  );

  const stripeSecretKey = readString(
    env.STRIPE_SECRET_KEY,
    DEFAULTS.integrations.stripe.secretKey,
  );
  const stripePublishableKey = readString(
    env.STRIPE_PUBLISHABLE_KEY,
    DEFAULTS.integrations.stripe.publishableKey,
  );
  const stripeWebhookSecret = readString(
    env.STRIPE_WEBHOOK_SECRET,
    DEFAULTS.integrations.stripe.webhookSecret,
  );
  const supabaseUrl = readString(
    env.SUPABASE_URL,
    DEFAULTS.integrations.supabase.url,
  );
  const supabaseAnonKey = readString(
    env.SUPABASE_ANON_KEY,
    DEFAULTS.integrations.supabase.anonKey,
  );
  const supabaseServiceRoleKey = readString(
    env.SUPABASE_SERVICE_ROLE_KEY,
    DEFAULTS.integrations.supabase.serviceRoleKey,
  );
  const resendApiKey = readString(
    env.RESEND_API_KEY,
    DEFAULTS.integrations.resend.apiKey,
  );
  const clerkPublishableKey = readString(
    env.CLERK_PUBLISHABLE_KEY,
    DEFAULTS.integrations.clerk.publishableKey,
  );
  const aliyunSmsAccessKeyId = readString(
    env.ALIYUN_SMS_ACCESS_KEY_ID,
    DEFAULTS.integrations.aliyunSms.accessKeyId,
  );
  const aliyunSmsAccessKeySecret = readString(
    env.ALIYUN_SMS_ACCESS_KEY_SECRET,
    DEFAULTS.integrations.aliyunSms.accessKeySecret,
  );
  const clerkSecretKey = readString(
    env.CLERK_SECRET_KEY,
    DEFAULTS.integrations.clerk.secretKey,
  );
  const clerkJwtKey = readString(
    env.CLERK_JWT_KEY,
    DEFAULTS.integrations.clerk.jwtKey,
  );
  const posthogApiKey = readString(
    env.POSTHOG_API_KEY,
    DEFAULTS.integrations.posthog.apiKey,
  );
  const sentryDsn = readString(
    env.SENTRY_DSN,
    DEFAULTS.integrations.sentry.dsn,
  );
  const upstashUrl = readString(
    env.UPSTASH_REDIS_REST_URL,
    DEFAULTS.integrations.upstash.url,
  );
  const upstashToken = readString(
    env.UPSTASH_REDIS_REST_TOKEN,
    DEFAULTS.integrations.upstash.token,
  );
  const pineconeApiKey = readString(
    env.PINECONE_API_KEY,
    DEFAULTS.integrations.pinecone.apiKey,
  );
  const pineconeIndexHost = readString(
    env.PINECONE_INDEX_HOST,
    DEFAULTS.integrations.pinecone.indexHost,
  );
  const emailProvider = toEmailProvider(
    env.EMAIL_PROVIDER,
    nodeEnv,
    resendApiKey,
  );
  const smsProvider = toSmsProvider(
    env.SMS_PROVIDER,
    nodeEnv,
    aliyunSmsAccessKeyId.length > 0 && aliyunSmsAccessKeySecret.length > 0,
  );

  return {
    env: nodeEnv,
    host: readString(env.API_HOST, DEFAULTS.host),
    port: toNumber(env.API_PORT, DEFAULTS.port),
    corsOrigin: readString(env.CORS_ORIGIN, DEFAULTS.corsOrigin),
    logLevel: toLogLevel(env.LOG_LEVEL),
    app: {
      publicSiteUrl,
    },
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
    integrations: {
      communications: {
        emailProvider,
        smsProvider,
        defaultPhoneCountryCode: readString(
          env.DEFAULT_PHONE_COUNTRY_CODE,
          DEFAULTS.integrations.communications.defaultPhoneCountryCode,
        ),
      },
      stripe: {
        enabled: isEnabled(env.STRIPE_ENABLED, [
          stripeSecretKey,
          stripePublishableKey,
        ]),
        secretKey: stripeSecretKey,
        publishableKey: stripePublishableKey,
        webhookSecret: stripeWebhookSecret,
        defaultProductKey: readString(
          env.STRIPE_DEFAULT_PRODUCT_KEY,
          DEFAULTS.integrations.stripe.defaultProductKey,
        ),
        successUrl: readString(
          env.STRIPE_SUCCESS_URL,
          `${publicSiteUrl.replace(/\/+$/, "")}/?checkout=success`,
        ),
        cancelUrl: readString(
          env.STRIPE_CANCEL_URL,
          `${publicSiteUrl.replace(/\/+$/, "")}/?checkout=cancelled`,
        ),
        prices: {
          coins1200: readString(
            env.STRIPE_PRICE_ID_COINS_1200,
            DEFAULTS.integrations.stripe.prices.coins1200,
          ),
          founderPack: readString(
            env.STRIPE_PRICE_ID_FOUNDER_PACK,
            DEFAULTS.integrations.stripe.prices.founderPack,
          ),
          seasonPass: readString(
            env.STRIPE_PRICE_ID_SEASON_PASS,
            DEFAULTS.integrations.stripe.prices.seasonPass,
          ),
        },
      },
      supabase: {
        enabled: isEnabled(env.SUPABASE_ENABLED, [
          supabaseUrl,
          supabaseAnonKey,
        ]),
        url: supabaseUrl,
        anonKey: supabaseAnonKey,
        serviceRoleKey: supabaseServiceRoleKey,
        avatarBucket: readString(
          env.SUPABASE_AVATAR_BUCKET,
          DEFAULTS.integrations.supabase.avatarBucket,
        ),
      },
      resend: {
        enabled:
          emailProvider === "resend" &&
          isEnabled(env.RESEND_ENABLED, [resendApiKey]),
        apiKey: resendApiKey,
        fromEmail: readString(
          env.RESEND_FROM_EMAIL,
          DEFAULTS.integrations.resend.fromEmail,
        ),
        replyTo: readString(
          env.RESEND_REPLY_TO,
          DEFAULTS.integrations.resend.replyTo,
        ),
        webhookSecret: readString(
          env.RESEND_WEBHOOK_SECRET,
          DEFAULTS.integrations.resend.webhookSecret,
        ),
      },
      aliyunSms: {
        enabled:
          smsProvider === "aliyun" &&
          isEnabled(env.ALIYUN_SMS_ENABLED, [
            aliyunSmsAccessKeyId,
            aliyunSmsAccessKeySecret,
          ]),
        accessKeyId: aliyunSmsAccessKeyId,
        accessKeySecret: aliyunSmsAccessKeySecret,
        endpoint: readString(
          env.ALIYUN_SMS_ENDPOINT,
          DEFAULTS.integrations.aliyunSms.endpoint,
        ),
        regionId: readString(
          env.ALIYUN_SMS_REGION_ID,
          DEFAULTS.integrations.aliyunSms.regionId,
        ),
        signName: readString(
          env.ALIYUN_SMS_SIGN_NAME,
          DEFAULTS.integrations.aliyunSms.signName,
        ),
        templateCodes: {
          login: readString(
            env.ALIYUN_SMS_TEMPLATE_LOGIN,
            DEFAULTS.integrations.aliyunSms.templateCodes.login,
          ),
          register: readString(
            env.ALIYUN_SMS_TEMPLATE_REGISTER,
            DEFAULTS.integrations.aliyunSms.templateCodes.register,
          ),
          resetPassword: readString(
            env.ALIYUN_SMS_TEMPLATE_RESET_PASSWORD,
            DEFAULTS.integrations.aliyunSms.templateCodes.resetPassword,
          ),
          bindMobile: readString(
            env.ALIYUN_SMS_TEMPLATE_BIND_MOBILE,
            DEFAULTS.integrations.aliyunSms.templateCodes.bindMobile,
          ),
        },
      },
      clerk: {
        enabled: isEnabled(env.CLERK_ENABLED, [
          clerkPublishableKey,
          clerkSecretKey,
          clerkJwtKey,
        ]),
        publishableKey: clerkPublishableKey,
        secretKey: clerkSecretKey,
        jwtKey: clerkJwtKey,
        signInUrl: readString(
          env.CLERK_SIGN_IN_URL,
          DEFAULTS.integrations.clerk.signInUrl,
        ),
        signUpUrl: readString(
          env.CLERK_SIGN_UP_URL,
          DEFAULTS.integrations.clerk.signUpUrl,
        ),
        afterSignInUrl: readString(
          env.CLERK_AFTER_SIGN_IN_URL,
          DEFAULTS.integrations.clerk.afterSignInUrl,
        ),
        afterSignUpUrl: readString(
          env.CLERK_AFTER_SIGN_UP_URL,
          DEFAULTS.integrations.clerk.afterSignUpUrl,
        ),
        authorizedParties: toStringArray(
          env.CLERK_AUTHORIZED_PARTIES,
          DEFAULTS.integrations.clerk.authorizedParties,
        ),
      },
      posthog: {
        enabled: isEnabled(env.POSTHOG_ENABLED, [posthogApiKey]),
        apiKey: posthogApiKey,
        personalApiKey: readString(
          env.POSTHOG_PERSONAL_API_KEY,
          DEFAULTS.integrations.posthog.personalApiKey,
        ),
        host: readString(env.POSTHOG_HOST, DEFAULTS.integrations.posthog.host),
      },
      sentry: {
        enabled: isEnabled(env.SENTRY_ENABLED, [sentryDsn]),
        dsn: sentryDsn,
        environment: readString(
          env.SENTRY_ENVIRONMENT,
          nodeEnv === "production"
            ? "production"
            : DEFAULTS.integrations.sentry.environment,
        ),
        tracesSampleRate: toFraction(
          env.SENTRY_TRACES_SAMPLE_RATE,
          DEFAULTS.integrations.sentry.tracesSampleRate,
        ),
      },
      upstash: {
        enabled: isEnabled(env.UPSTASH_ENABLED, [upstashUrl, upstashToken]),
        url: upstashUrl,
        token: upstashToken,
        loginLimit: toNumber(
          env.UPSTASH_LOGIN_LIMIT,
          DEFAULTS.integrations.upstash.loginLimit,
        ),
        loginWindow: readString(
          env.UPSTASH_LOGIN_WINDOW,
          DEFAULTS.integrations.upstash.loginWindow,
        ),
        registerLimit: toNumber(
          env.UPSTASH_REGISTER_LIMIT,
          DEFAULTS.integrations.upstash.registerLimit,
        ),
        registerWindow: readString(
          env.UPSTASH_REGISTER_WINDOW,
          DEFAULTS.integrations.upstash.registerWindow,
        ),
        checkoutLimit: toNumber(
          env.UPSTASH_CHECKOUT_LIMIT,
          DEFAULTS.integrations.upstash.checkoutLimit,
        ),
        checkoutWindow: readString(
          env.UPSTASH_CHECKOUT_WINDOW,
          DEFAULTS.integrations.upstash.checkoutWindow,
        ),
      },
      pinecone: {
        enabled: isEnabled(env.PINECONE_ENABLED, [
          pineconeApiKey,
          pineconeIndexHost,
        ]),
        apiKey: pineconeApiKey,
        indexHost: pineconeIndexHost,
        namespace: readString(
          env.PINECONE_NAMESPACE,
          DEFAULTS.integrations.pinecone.namespace,
        ),
        topK: toNumber(env.PINECONE_TOP_K, DEFAULTS.integrations.pinecone.topK),
      },
    },
  };
}

export const apiServerConfig: ApiServerConfig = loadApiServerConfig();
