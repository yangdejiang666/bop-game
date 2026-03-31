export type PlatformProviderId =
  | "stripe"
  | "supabase"
  | "resend"
  | "aliyun-sms"
  | "clerk"
  | "posthog"
  | "sentry"
  | "upstash"
  | "pinecone";

export type CheckoutMode = "payment" | "subscription";

export interface PlatformProviderStatus {
  provider: PlatformProviderId;
  enabled: boolean;
  features: string[];
}

export interface CommerceProductConfig {
  productKey: string;
  label: string;
  description: string;
  mode: CheckoutMode;
  coinGrant: number;
  enabled: boolean;
}

export interface PlatformConfigResponse {
  env: string;
  siteUrl: string;
  providers: PlatformProviderStatus[];
  auth: {
    passwordEnabled: boolean;
    emailVerificationEnabled: boolean;
    emailProvider: "disabled" | "local" | "resend" | null;
    smsVerificationEnabled: boolean;
    smsProvider: "disabled" | "local" | "aliyun" | null;
    defaultPhoneCountryCode: string | null;
    clerkEnabled: boolean;
    clerkPublishableKey: string | null;
    clerkSignInUrl: string | null;
    clerkSignUpUrl: string | null;
    clerkAfterSignInUrl: string | null;
    clerkAfterSignUpUrl: string | null;
  };
  commerce: {
    stripeEnabled: boolean;
    stripePublishableKey: string | null;
    defaultProductKey: string | null;
    products: CommerceProductConfig[];
  };
  storage: {
    avatarProvider: "local" | "supabase";
    supabaseUrl: string | null;
    supabaseAnonKey: string | null;
    avatarBucket: string | null;
  };
  telemetry: {
    posthogEnabled: boolean;
    posthogApiKey: string | null;
    posthogHost: string | null;
    sentryEnabled: boolean;
    sentryDsn: string | null;
    sentryEnvironment: string;
  };
  cache: {
    upstashEnabled: boolean;
  };
  ai: {
    pineconeEnabled: boolean;
    namespace: string | null;
  };
  serverTime: string;
}

export interface CreateCheckoutSessionRequest {
  productKey?: string;
  priceId?: string;
  mode?: CheckoutMode;
  quantity?: number;
  successUrl?: string;
  cancelUrl?: string;
  customerEmail?: string;
  metadata?: Record<string, string>;
}

export interface CreateCheckoutSessionResponse {
  provider: "stripe";
  productKey: string;
  mode: CheckoutMode;
  sessionId: string;
  checkoutUrl: string;
  serverTime: string;
}

export interface UploadAvatarRequest {
  dataUrl: string;
  filename?: string;
}

export interface UploadAvatarResponse {
  provider: "supabase";
  avatarUrl: string;
  objectPath: string;
  serverTime: string;
}

export interface PineconeSearchRequest {
  query: string;
  topK?: number;
  namespace?: string;
  filter?: Record<string, string | number | boolean>;
}

export interface PineconeSearchMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface PineconeSearchResponse {
  provider: "pinecone";
  query: string;
  namespace: string;
  matches: PineconeSearchMatch[];
  serverTime: string;
}
