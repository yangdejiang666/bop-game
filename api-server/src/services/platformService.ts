import { createHash, randomInt, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import Dysmsapi20170525, {
  SendSmsRequest,
} from "@alicloud/dysmsapi20170525";
import * as $OpenApi from "@alicloud/openapi-client";
import Stripe from "stripe";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  Resend,
  type EmailReceivedEvent,
  type GetReceivingEmailResponseSuccess,
  type WebhookEventPayload,
} from "resend";
import { verifyToken } from "@clerk/backend";
import { PostHog } from "posthog-node";
import * as Sentry from "@sentry/node";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { Pinecone } from "@pinecone-database/pinecone";
import {
  PROTOCOL_ERROR,
  type CommerceProductConfig,
  type CreateCheckoutSessionRequest,
  type CreateCheckoutSessionResponse,
  type PineconeSearchMatch,
  type PineconeSearchRequest,
  type PineconeSearchResponse,
  type PlatformConfigResponse,
  type UploadAvatarRequest,
  type UploadAvatarResponse,
} from "@bop/shared-protocol";
import { apiServerConfig } from "../lib/config.js";
import { withTransaction } from "../lib/db.js";
import {
  markVerificationChallengeFailed,
  markVerificationChallengeSent,
  upsertInboundEmail,
} from "../repositories/authVerificationRepository.js";
import {
  findPasswordIdentityByAccount,
  getUserSummaryById,
  overwriteUserProgression,
} from "../repositories/accountRepository.js";

export class PlatformServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PlatformServiceError";
  }
}

type RateLimitBucket = "login" | "register" | "checkout";

type PasswordResetChallengeRecord = {
  kind: "password-reset";
  account: string;
  userId: string;
  email: string;
  code: string;
};

type StoredRecord = {
  expiresAt: number;
  value: string;
};

type InboundEmailRecord = {
  provider: "resend";
  emailId: string;
  receivedAt: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  messageId: string;
  text: string | null;
  html: string | null;
  attachments: Array<{
    id: string;
    filename: string | null;
    size: number | null;
    contentType: string;
    contentDisposition: string | null;
  }>;
  rawDownloadUrl: string | null;
  rawExpiresAt: string | null;
};

export interface EmailDispatchResult {
  provider: "local" | "resend";
  messageId: string | null;
}

export interface SmsDispatchResult {
  provider: "local" | "aliyun";
  messageId: string | null;
}

const memoryStore = new Map<string, StoredRecord>();
const memoryProcessedSessions = new Map<string, number>();
const rateLimiterCache = new Map<RateLimitBucket, Ratelimit>();
const recentInboundEmails: InboundEmailRecord[] = [];

const MAX_RECENT_INBOUND_EMAILS = 20;

let stripeClient: Stripe | null | undefined;
let supabaseAdminClient: SupabaseClient | null | undefined;
let resendClient: Resend | null | undefined;
let resendWebhookClient: Resend | null | undefined;
let aliyunSmsClient: Dysmsapi20170525 | null | undefined;
let posthogClient: PostHog | null | undefined;
let pineconeClient: Pinecone | null | undefined;
let sentryInitialized = false;

const COMMERCE_PRODUCT_BLUEPRINTS = [
  {
    productKey: "coins_1200",
    label: "1200 金币补给",
    description: "快速补充金币，用于后续皮肤、装扮与赛季消耗。",
    mode: "payment" as const,
    coinGrant: 1200,
    getPriceId: () => apiServerConfig.integrations.stripe.prices.coins1200,
  },
  {
    productKey: "founder_pack",
    label: "创始补给包",
    description: "一次性创始人补给，适合早期测试服内购联调。",
    mode: "payment" as const,
    coinGrant: 5000,
    getPriceId: () => apiServerConfig.integrations.stripe.prices.founderPack,
  },
  {
    productKey: "season_pass",
    label: "赛季通行证",
    description: "赛季制订阅包，附带测试期金币补给奖励。",
    mode: "subscription" as const,
    coinGrant: 1500,
    getPriceId: () => apiServerConfig.integrations.stripe.prices.seasonPass,
  },
] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function cleanupMemoryStore() {
  const now = Date.now();
  for (const [key, record] of memoryStore.entries()) {
    if (record.expiresAt <= now) {
      memoryStore.delete(key);
    }
  }
  for (const [key, expiresAt] of memoryProcessedSessions.entries()) {
    if (expiresAt <= now) {
      memoryProcessedSessions.delete(key);
    }
  }
}

function buildCommerceCatalog(): Array<CommerceProductConfig & { priceId: string }> {
  return COMMERCE_PRODUCT_BLUEPRINTS.map((product) => {
    const priceId = product.getPriceId().trim();
    return {
      productKey: product.productKey,
      label: product.label,
      description: product.description,
      mode: product.mode,
      coinGrant: product.coinGrant,
      enabled: priceId.length > 0,
      priceId,
    };
  });
}

function getCommerceProduct(productKey: string | null | undefined) {
  const desiredKey =
    productKey?.trim() || apiServerConfig.integrations.stripe.defaultProductKey;
  return buildCommerceCatalog().find((product) => product.productKey === desiredKey);
}

function getStripeClient(): Stripe | null {
  if (stripeClient !== undefined) {
    return stripeClient;
  }

  if (
    !apiServerConfig.integrations.stripe.enabled ||
    !apiServerConfig.integrations.stripe.secretKey
  ) {
    stripeClient = null;
    return stripeClient;
  }

  stripeClient = new Stripe(apiServerConfig.integrations.stripe.secretKey);
  return stripeClient;
}

function getSupabaseAdminClient(): SupabaseClient | null {
  if (supabaseAdminClient !== undefined) {
    return supabaseAdminClient;
  }

  const supabaseConfig = apiServerConfig.integrations.supabase;
  if (
    !supabaseConfig.enabled ||
    !supabaseConfig.url ||
    !supabaseConfig.serviceRoleKey
  ) {
    supabaseAdminClient = null;
    return supabaseAdminClient;
  }

  supabaseAdminClient = createClient(
    supabaseConfig.url,
    supabaseConfig.serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
  return supabaseAdminClient;
}

function getResendClient(): Resend | null {
  if (resendClient !== undefined) {
    return resendClient;
  }

  if (
    !apiServerConfig.integrations.resend.enabled ||
    !apiServerConfig.integrations.resend.apiKey
  ) {
    resendClient = null;
    return resendClient;
  }

  resendClient = new Resend(apiServerConfig.integrations.resend.apiKey);
  return resendClient;
}

function getResendWebhookClient(): Resend | null {
  if (resendWebhookClient !== undefined) {
    return resendWebhookClient;
  }

  if (!apiServerConfig.integrations.resend.webhookSecret) {
    resendWebhookClient = null;
    return resendWebhookClient;
  }

  resendWebhookClient = new Resend(
    apiServerConfig.integrations.resend.apiKey || "resend-webhook-verifier",
  );
  return resendWebhookClient;
}

function getAliyunSmsClient(): Dysmsapi20170525 | null {
  if (aliyunSmsClient !== undefined) {
    return aliyunSmsClient;
  }

  const smsConfig = apiServerConfig.integrations.aliyunSms;
  if (
    !smsConfig.enabled ||
    !smsConfig.accessKeyId ||
    !smsConfig.accessKeySecret ||
    !smsConfig.signName
  ) {
    aliyunSmsClient = null;
    return aliyunSmsClient;
  }

  const config = new $OpenApi.Config({
    accessKeyId: smsConfig.accessKeyId,
    accessKeySecret: smsConfig.accessKeySecret,
    endpoint: smsConfig.endpoint,
  });
  config.regionId = smsConfig.regionId;

  aliyunSmsClient = new Dysmsapi20170525(config);
  return aliyunSmsClient;
}

function getPosthogClient(): PostHog | null {
  if (posthogClient !== undefined) {
    return posthogClient;
  }

  if (
    !apiServerConfig.integrations.posthog.enabled ||
    !apiServerConfig.integrations.posthog.apiKey
  ) {
    posthogClient = null;
    return posthogClient;
  }

  posthogClient = new PostHog(apiServerConfig.integrations.posthog.apiKey, {
    host: apiServerConfig.integrations.posthog.host,
  });
  return posthogClient;
}

function getRedisClient(): Redis | null {
  if (
    !apiServerConfig.integrations.upstash.enabled ||
    !apiServerConfig.integrations.upstash.url ||
    !apiServerConfig.integrations.upstash.token
  ) {
    return null;
  }

  return new Redis({
    url: apiServerConfig.integrations.upstash.url,
    token: apiServerConfig.integrations.upstash.token,
  });
}

function getRateLimiter(bucket: RateLimitBucket): Ratelimit | null {
  const cached = rateLimiterCache.get(bucket);
  if (cached) {
    return cached;
  }

  const redis = getRedisClient();
  if (!redis) {
    return null;
  }

  const config = apiServerConfig.integrations.upstash;
  const limiter =
    bucket === "register"
      ? Ratelimit.slidingWindow(config.registerLimit, config.registerWindow as any)
      : bucket === "checkout"
        ? Ratelimit.slidingWindow(config.checkoutLimit, config.checkoutWindow as any)
        : Ratelimit.slidingWindow(config.loginLimit, config.loginWindow as any);

  const created = new Ratelimit({
    redis,
    limiter,
    analytics: true,
    prefix: `@bop/${bucket}`,
  });
  rateLimiterCache.set(bucket, created);
  return created;
}

function getPineconeClient(): Pinecone | null {
  if (pineconeClient !== undefined) {
    return pineconeClient;
  }

  if (
    !apiServerConfig.integrations.pinecone.enabled ||
    !apiServerConfig.integrations.pinecone.apiKey
  ) {
    pineconeClient = null;
    return pineconeClient;
  }

  pineconeClient = new Pinecone({
    apiKey: apiServerConfig.integrations.pinecone.apiKey,
  });
  return pineconeClient;
}

function buildProvidersConfig(): PlatformConfigResponse["providers"] {
  const catalog = buildCommerceCatalog();
  const resendFeatures = ["password_reset_email", "purchase_receipts"];
  if (apiServerConfig.integrations.resend.webhookSecret) {
    resendFeatures.push("inbound_email_webhook");
  }
  return [
    {
      provider: "stripe",
      enabled:
        apiServerConfig.integrations.stripe.enabled &&
        catalog.some((product) => product.enabled),
      features: ["checkout", "webhook", "coin_grants"],
    },
    {
      provider: "supabase",
      enabled: apiServerConfig.integrations.supabase.enabled,
      features: ["avatar_storage", "cdn"],
    },
    {
      provider: "resend",
      enabled: apiServerConfig.integrations.communications.emailProvider === "resend",
      features: resendFeatures,
    },
    {
      provider: "aliyun-sms",
      enabled: apiServerConfig.integrations.communications.smsProvider === "aliyun",
      features: ["verification_sms", "china_mobile"],
    },
    {
      provider: "clerk",
      enabled: apiServerConfig.integrations.clerk.enabled,
      features: ["platform_login", "session_verification"],
    },
    {
      provider: "posthog",
      enabled: apiServerConfig.integrations.posthog.enabled,
      features: ["analytics", "server_events"],
    },
    {
      provider: "sentry",
      enabled: apiServerConfig.integrations.sentry.enabled,
      features: ["browser_errors", "api_errors"],
    },
    {
      provider: "upstash",
      enabled: apiServerConfig.integrations.upstash.enabled,
      features: ["rate_limit", "ephemeral_store"],
    },
    {
      provider: "pinecone",
      enabled: apiServerConfig.integrations.pinecone.enabled,
      features: ["semantic_search"],
    },
  ];
}

function parseDataUrl(dataUrl: string): {
  contentType: string;
  extension: string;
  buffer: Buffer;
} {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  const contentTypeRaw = match?.[1];
  const base64BodyRaw = match?.[2];
  if (!contentTypeRaw || !base64BodyRaw) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.INVALID_REQUEST,
      400,
      "Avatar payload must be a valid base64 data URL.",
    );
  }

  const contentType = contentTypeRaw.trim().toLowerCase();
  const base64Body = base64BodyRaw.trim();
  const extension =
    contentType === "image/jpeg"
      ? "jpg"
      : contentType === "image/webp"
        ? "webp"
        : contentType === "image/gif"
          ? "gif"
          : "png";

  return {
    contentType,
    extension,
    buffer: Buffer.from(base64Body, "base64"),
  };
}

function getExpirySeconds(ttlMs: number): number {
  return Math.max(1, Math.ceil(ttlMs / 1000));
}

async function persistRecord<T>(key: string, value: T, ttlMs: number): Promise<void> {
  cleanupMemoryStore();
  const redis = getRedisClient();
  const payload = JSON.stringify(value);
  if (redis) {
    await (redis as any).set(key, payload, { ex: getExpirySeconds(ttlMs) });
    return;
  }

  memoryStore.set(key, {
    expiresAt: Date.now() + ttlMs,
    value: payload,
  });
}

async function readRecord<T>(key: string): Promise<T | null> {
  cleanupMemoryStore();
  const redis = getRedisClient();
  if (redis) {
    const raw = await redis.get<string>(key);
    if (typeof raw !== "string" || raw.length === 0) {
      return null;
    }
    return JSON.parse(raw) as T;
  }

  const found = memoryStore.get(key);
  if (!found || found.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return JSON.parse(found.value) as T;
}

async function deleteRecord(key: string): Promise<void> {
  const redis = getRedisClient();
  if (redis) {
    await redis.del(key);
    return;
  }
  memoryStore.delete(key);
}

async function isStripeSessionProcessed(sessionId: string): Promise<boolean> {
  cleanupMemoryStore();
  const redis = getRedisClient();
  const key = `stripe:processed:${sessionId}`;

  if (redis) {
    const raw = await redis.get<string>(key);
    return typeof raw === "string" && raw.length > 0;
  }

  const expiresAt = memoryProcessedSessions.get(key);
  if (!expiresAt || expiresAt <= Date.now()) {
    memoryProcessedSessions.delete(key);
    return false;
  }
  return true;
}

async function markStripeSessionProcessed(sessionId: string): Promise<void> {
  const key = `stripe:processed:${sessionId}`;
  const ttlMs = 1000 * 60 * 60 * 24 * 30;
  const redis = getRedisClient();
  if (redis) {
    await (redis as any).set(key, "1", { ex: getExpirySeconds(ttlMs) });
    return;
  }

  memoryProcessedSessions.set(key, Date.now() + ttlMs);
}

function resolveAliyunTemplateCode(
  purpose: "login" | "register" | "resetPassword" | "bindMobile" | "bindEmail",
): string {
  const templates = apiServerConfig.integrations.aliyunSms.templateCodes;
  if (purpose === "login") {
    return templates.login;
  }
  if (purpose === "register") {
    return templates.register || templates.login;
  }
  if (purpose === "bindMobile") {
    return templates.bindMobile || templates.login;
  }
  if (purpose === "resetPassword") {
    return templates.resetPassword || templates.login;
  }
  return templates.bindMobile || templates.login;
}

export async function dispatchEmailMessage(params: {
  to: string;
  subject: string;
  html: string;
  purpose?: string;
  challengeId?: string;
  debugPayload?: Record<string, unknown>;
}): Promise<EmailDispatchResult> {
  const provider = apiServerConfig.integrations.communications.emailProvider;
  if (provider === "disabled") {
    if (params.challengeId) {
      await markVerificationChallengeFailed({
        challengeId: params.challengeId,
        errorMessage: "Email delivery provider is not configured.",
      });
    }
    throw new PlatformServiceError(
      PROTOCOL_ERROR.SERVICE_UNAVAILABLE,
      503,
      "Email delivery is not configured.",
    );
  }

  if (provider === "local") {
    if (params.challengeId) {
      await markVerificationChallengeSent({
        challengeId: params.challengeId,
        debugPayload: {
          ...(params.debugPayload ?? {}),
          to: params.to,
          subject: params.subject,
          previewHtml: params.html,
        },
        metadata: {
          deliveryMode: "local",
        },
      });
    }
    return {
      provider: "local",
      messageId: null,
    };
  }

  const resend = getResendClient();
  if (!resend) {
    if (params.challengeId) {
      await markVerificationChallengeFailed({
        challengeId: params.challengeId,
        errorMessage: "Resend is not configured.",
      });
    }
    throw new PlatformServiceError(
      PROTOCOL_ERROR.SERVICE_UNAVAILABLE,
      503,
      "Resend is not configured.",
    );
  }

  const response = await resend.emails.send({
    from: apiServerConfig.integrations.resend.fromEmail,
    to: [params.to],
    subject: params.subject,
    html: params.html,
    replyTo: apiServerConfig.integrations.resend.replyTo || undefined,
  });

  if (response.error) {
    if (params.challengeId) {
      await markVerificationChallengeFailed({
        challengeId: params.challengeId,
        errorMessage: response.error.message || "Failed to send email.",
      });
    }
    throw new PlatformServiceError(
      PROTOCOL_ERROR.SERVICE_UNAVAILABLE,
      503,
      response.error.message || "Failed to send email.",
    );
  }

  const messageId =
    typeof (response.data as { id?: unknown } | null | undefined)?.id === "string"
      ? (response.data as { id: string }).id
      : null;

  if (params.challengeId) {
    await markVerificationChallengeSent({
      challengeId: params.challengeId,
      providerMessageId: messageId,
      metadata: {
        deliveryMode: "resend",
      },
    });
  }

  return {
    provider: "resend",
    messageId,
  };
}

export async function dispatchSmsMessage(params: {
  phone: string;
  purpose: "login" | "register" | "resetPassword" | "bindMobile" | "bindEmail";
  code: string;
  text: string;
  challengeId?: string;
  debugPayload?: Record<string, unknown>;
}): Promise<SmsDispatchResult> {
  const provider = apiServerConfig.integrations.communications.smsProvider;
  if (provider === "disabled") {
    if (params.challengeId) {
      await markVerificationChallengeFailed({
        challengeId: params.challengeId,
        errorMessage: "SMS delivery provider is not configured.",
      });
    }
    throw new PlatformServiceError(
      PROTOCOL_ERROR.SERVICE_UNAVAILABLE,
      503,
      "SMS delivery is not configured.",
    );
  }

  if (provider === "local") {
    if (params.challengeId) {
      await markVerificationChallengeSent({
        challengeId: params.challengeId,
        debugPayload: {
          ...(params.debugPayload ?? {}),
          phone: params.phone,
          text: params.text,
          code: params.code,
        },
        metadata: {
          deliveryMode: "local",
        },
      });
    }
    return {
      provider: "local",
      messageId: null,
    };
  }

  const client = getAliyunSmsClient();
  const templateCode = resolveAliyunTemplateCode(params.purpose);
  if (!client || !templateCode) {
    if (params.challengeId) {
      await markVerificationChallengeFailed({
        challengeId: params.challengeId,
        errorMessage: "Aliyun SMS is not fully configured.",
      });
    }
    throw new PlatformServiceError(
      PROTOCOL_ERROR.SERVICE_UNAVAILABLE,
      503,
      "Aliyun SMS is not fully configured.",
    );
  }

  try {
    const response = await client.sendSms(
      new SendSmsRequest({
        phoneNumbers: params.phone,
        signName: apiServerConfig.integrations.aliyunSms.signName,
        templateCode,
        templateParam: JSON.stringify({
          code: params.code,
        }),
      }),
    );

    const body = response.body as {
      code?: string;
      message?: string;
      bizId?: string;
      requestId?: string;
    } | undefined;
    const responseCode = body?.code?.trim() ?? "";
    if (responseCode && responseCode !== "OK") {
      if (params.challengeId) {
        await markVerificationChallengeFailed({
          challengeId: params.challengeId,
          errorMessage: body?.message || `Aliyun SMS send failed: ${responseCode}`,
        });
      }
      throw new PlatformServiceError(
        PROTOCOL_ERROR.SERVICE_UNAVAILABLE,
        503,
        body?.message || `Aliyun SMS send failed: ${responseCode}`,
      );
    }

    const messageId = body?.bizId?.trim() || body?.requestId?.trim() || null;
    if (params.challengeId) {
      await markVerificationChallengeSent({
        challengeId: params.challengeId,
        providerMessageId: messageId,
        metadata: {
          deliveryMode: "aliyun",
          requestId: body?.requestId ?? null,
          responseCode: body?.code ?? null,
        },
      });
    }

    return {
      provider: "aliyun",
      messageId,
    };
  } catch (error) {
    if (error instanceof PlatformServiceError) {
      throw error;
    }
    const message = normalizeErrorMessage(error, "Aliyun SMS send failed.");
    if (params.challengeId) {
      await markVerificationChallengeFailed({
        challengeId: params.challengeId,
        errorMessage: message,
      });
    }
    throw new PlatformServiceError(
      PROTOCOL_ERROR.SERVICE_UNAVAILABLE,
      503,
      message,
    );
  }
}

function rememberInboundEmail(record: InboundEmailRecord): void {
  const existingIndex = recentInboundEmails.findIndex(
    (item) => item.emailId === record.emailId,
  );
  if (existingIndex >= 0) {
    recentInboundEmails.splice(existingIndex, 1);
  }

  recentInboundEmails.unshift(record);
  if (recentInboundEmails.length > MAX_RECENT_INBOUND_EMAILS) {
    recentInboundEmails.length = MAX_RECENT_INBOUND_EMAILS;
  }
}

function normalizeEmailList(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

async function fetchInboundEmailDetails(
  emailId: string,
): Promise<GetReceivingEmailResponseSuccess | null> {
  const resend = getResendClient();
  if (!resend) {
    return null;
  }

  const response = await resend.emails.receiving.get(emailId);
  if (!response.data || response.error) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.SERVICE_UNAVAILABLE,
      503,
      response.error?.message || "Failed to fetch the inbound Resend email.",
    );
  }

  return response.data;
}

function mapInboundEmailRecord(
  event: EmailReceivedEvent,
  email: GetReceivingEmailResponseSuccess | null,
): InboundEmailRecord {
  const attachmentSource = email?.attachments ?? [];
  return {
    provider: "resend",
    emailId: event.data.email_id,
    receivedAt: email?.created_at ?? event.data.created_at ?? event.created_at,
    from: email?.from ?? event.data.from,
    to: normalizeEmailList(email?.to ?? event.data.to),
    cc: normalizeEmailList(email?.cc ?? event.data.cc),
    bcc: normalizeEmailList(email?.bcc ?? event.data.bcc),
    subject: email?.subject ?? event.data.subject,
    messageId: email?.message_id ?? event.data.message_id,
    text: email?.text ?? null,
    html: email?.html ?? null,
    attachments: attachmentSource.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      size:
        typeof attachment.size === "number" && Number.isFinite(attachment.size)
          ? attachment.size
          : null,
      contentType: attachment.content_type,
      contentDisposition: attachment.content_disposition,
    })),
    rawDownloadUrl: email?.raw?.download_url ?? null,
    rawExpiresAt: email?.raw?.expires_at ?? null,
  };
}

async function handleResendEmailReceived(event: EmailReceivedEvent): Promise<void> {
  let emailDetails: GetReceivingEmailResponseSuccess | null = null;
  try {
    emailDetails = await fetchInboundEmailDetails(event.data.email_id);
  } catch (error) {
    captureServerException(error, {
      provider: "resend",
      eventType: event.type,
      emailId: event.data.email_id,
      stage: "fetch_inbound_email",
    });
  }

  const record = mapInboundEmailRecord(event, emailDetails);
  rememberInboundEmail(record);
  await upsertInboundEmail({
    provider: record.provider,
    emailId: record.emailId,
    receivedAt: record.receivedAt,
    fromEmail: record.from,
    toEmails: record.to,
    ccEmails: record.cc,
    bccEmails: record.bcc,
    subject: record.subject,
    messageId: record.messageId,
    textContent: record.text,
    htmlContent: record.html,
    attachments: record.attachments,
    rawDownloadUrl: record.rawDownloadUrl,
    rawExpiresAt: record.rawExpiresAt,
    payloadJson: {
      eventType: event.type,
      createdAt: event.created_at,
      data: event.data as unknown as Record<string, unknown>,
    },
  });

  await captureServerEvent({
    event: "resend_email_received",
    distinctId: record.from,
    properties: {
      emailId: record.emailId,
      subject: record.subject,
      recipientCount: record.to.length,
      ccCount: record.cc.length,
      bccCount: record.bcc.length,
      attachmentCount: record.attachments.length,
      fromDomain: record.from.split("@")[1] ?? null,
      hasHtml: !!record.html,
      hasText: !!record.text,
    },
  });
}

async function grantCoinsForPurchase(
  userId: string,
  coinGrant: number,
): Promise<void> {
  if (!Number.isFinite(coinGrant) || coinGrant <= 0) {
    return;
  }

  await withTransaction(async (client) => {
    const summaryRecord = await getUserSummaryById(userId, client);
    if (!summaryRecord) {
      throw new PlatformServiceError(
        PROTOCOL_ERROR.USER_NOT_FOUND,
        404,
        "Purchase target user not found.",
      );
    }

    const profile = summaryRecord.summary.profile;
    await overwriteUserProgression(
      {
        userId,
        progression: {
          level: profile.level,
          currentXp: profile.currentXp,
          totalXp: profile.totalXp,
          coins: profile.coins + coinGrant,
          totalMatches: profile.totalMatches,
          totalWins: profile.totalWins,
          bestMass: profile.bestMass,
        },
      },
      client,
    );
  });
}

function resolveResetEmail(
  account: string,
  identities: Array<{ provider: string; email?: string | null }>,
): string | null {
  const boundEmail =
    identities.find((identity) => identity.provider === "password" && identity.email)?.email ??
    identities.find((identity) => identity.email)?.email ??
    null;

  if (boundEmail?.trim()) {
    return boundEmail.trim();
  }

  return account.includes("@") ? account.trim() : null;
}

async function syncPurchaseEmail(
  userId: string,
  customerEmail: string,
  productLabel: string,
  coinGrant: number,
): Promise<void> {
  if (!customerEmail.trim()) {
    return;
  }

  await dispatchEmailMessage({
    to: customerEmail,
    subject: `BOP 订单已完成 · ${productLabel}`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">
        <h2 style="margin-bottom:12px">订单已完成</h2>
        <p>你的 <strong>${productLabel}</strong> 已成功发放到账号。</p>
        <p>发货账号：<strong>${userId}</strong></p>
        <p>本次奖励金币：<strong>${coinGrant}</strong></p>
        <p>现在可以返回大厅继续验证商城和账号链路。</p>
      </div>
    `,
  });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const metadata = session.metadata ?? {};
  const userId = metadata.userId?.trim();
  if (!userId) {
    return;
  }

  if (await isStripeSessionProcessed(session.id)) {
    return;
  }

  const product = getCommerceProduct(metadata.productKey);
  const coinGrant = Number(metadata.coinGrant ?? product?.coinGrant ?? 0);
  await grantCoinsForPurchase(userId, coinGrant);
  await markStripeSessionProcessed(session.id);

  await captureServerEvent({
    event: "stripe_checkout_completed",
    distinctId: userId,
    properties: {
      productKey: metadata.productKey ?? product?.productKey ?? null,
      coinGrant,
      checkoutSessionId: session.id,
      amountTotal: session.amount_total ?? null,
      currency: session.currency ?? null,
      mode: session.mode,
    },
  });

  const email =
    session.customer_details?.email ??
    (typeof session.customer_email === "string" ? session.customer_email : "");
  await syncPurchaseEmail(
    userId,
    email,
    product?.label ?? "BOP 商城订单",
    coinGrant,
  );
}

export function initializeServerTelemetry(): void {
  if (
    sentryInitialized ||
    !apiServerConfig.integrations.sentry.enabled ||
    !apiServerConfig.integrations.sentry.dsn
  ) {
    return;
  }

  Sentry.init({
    dsn: apiServerConfig.integrations.sentry.dsn,
    environment: apiServerConfig.integrations.sentry.environment,
    sendDefaultPii: true,
    tracesSampleRate: apiServerConfig.integrations.sentry.tracesSampleRate,
  });
  sentryInitialized = true;
}

export async function captureServerEvent(params: {
  event: string;
  distinctId?: string;
  properties?: Record<string, unknown>;
}): Promise<void> {
  const posthog = getPosthogClient();
  if (!posthog) {
    return;
  }

  posthog.capture({
    event: params.event,
    distinctId: params.distinctId ?? "server",
    properties: params.properties ?? {},
  });
}

export function captureServerException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  initializeServerTelemetry();
  if (sentryInitialized) {
    Sentry.captureException(error, {
      extra: context,
    });
  }

  const posthog = getPosthogClient();
  if (posthog) {
    posthog.captureException(error, "server", context);
  }
}

export async function shutdownPlatformClients(): Promise<void> {
  const posthog = getPosthogClient();
  if (posthog) {
    await posthog.shutdown?.();
  }
}

export function createPublicPlatformConfig(): PlatformConfigResponse {
  const catalog = buildCommerceCatalog();
  return {
    env: apiServerConfig.env,
    siteUrl: apiServerConfig.app.publicSiteUrl,
    providers: buildProvidersConfig(),
    auth: {
      passwordEnabled: true,
      emailVerificationEnabled:
        apiServerConfig.integrations.communications.emailProvider !== "disabled",
      emailProvider:
        apiServerConfig.integrations.communications.emailProvider === "disabled"
          ? null
          : apiServerConfig.integrations.communications.emailProvider,
      smsVerificationEnabled:
        apiServerConfig.integrations.communications.smsProvider !== "disabled",
      smsProvider:
        apiServerConfig.integrations.communications.smsProvider === "disabled"
          ? null
          : apiServerConfig.integrations.communications.smsProvider,
      defaultPhoneCountryCode:
        apiServerConfig.integrations.communications.defaultPhoneCountryCode || null,
      clerkEnabled: apiServerConfig.integrations.clerk.enabled,
      clerkPublishableKey:
        apiServerConfig.integrations.clerk.publishableKey || null,
      clerkSignInUrl: apiServerConfig.integrations.clerk.signInUrl || null,
      clerkSignUpUrl: apiServerConfig.integrations.clerk.signUpUrl || null,
      clerkAfterSignInUrl:
        apiServerConfig.integrations.clerk.afterSignInUrl || null,
      clerkAfterSignUpUrl:
        apiServerConfig.integrations.clerk.afterSignUpUrl || null,
    },
    commerce: {
      stripeEnabled:
        apiServerConfig.integrations.stripe.enabled &&
        catalog.some((product) => product.enabled),
      stripePublishableKey:
        apiServerConfig.integrations.stripe.publishableKey || null,
      defaultProductKey:
        apiServerConfig.integrations.stripe.defaultProductKey || null,
      products: catalog.map(({ priceId: _priceId, ...product }) => product),
    },
    storage: {
      avatarProvider: apiServerConfig.integrations.supabase.enabled
        ? "supabase"
        : "local",
      supabaseUrl: apiServerConfig.integrations.supabase.url || null,
      supabaseAnonKey: apiServerConfig.integrations.supabase.anonKey || null,
      avatarBucket:
        apiServerConfig.integrations.supabase.avatarBucket || null,
    },
    telemetry: {
      posthogEnabled: apiServerConfig.integrations.posthog.enabled,
      posthogApiKey: apiServerConfig.integrations.posthog.apiKey || null,
      posthogHost: apiServerConfig.integrations.posthog.host || null,
      sentryEnabled: apiServerConfig.integrations.sentry.enabled,
      sentryDsn: apiServerConfig.integrations.sentry.dsn || null,
      sentryEnvironment: apiServerConfig.integrations.sentry.environment,
    },
    cache: {
      upstashEnabled: apiServerConfig.integrations.upstash.enabled,
    },
    ai: {
      pineconeEnabled: apiServerConfig.integrations.pinecone.enabled,
      namespace: apiServerConfig.integrations.pinecone.namespace || null,
    },
    serverTime: nowIso(),
  };
}

export async function assertPlatformRateLimit(
  bucket: RateLimitBucket,
  identifier: string,
): Promise<void> {
  const normalized = identifier.trim();
  if (!normalized) {
    return;
  }

  const ratelimit = getRateLimiter(bucket);
  if (!ratelimit) {
    return;
  }

  const result = await ratelimit.limit(normalized);
  await result.pending.catch(() => undefined);
  if (!result.success) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.RATE_LIMITED,
      429,
      "Too many requests. Please retry in a moment.",
    );
  }
}

export async function verifyClerkPlatformToken(token: string): Promise<{
  subject: string;
  email: string | null;
  nickname: string | null;
  avatarUrl: string | null;
}> {
  if (!apiServerConfig.integrations.clerk.enabled) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.SERVICE_UNAVAILABLE,
      503,
      "Clerk is not configured.",
    );
  }

  const payload = await verifyToken(token, {
    jwtKey: apiServerConfig.integrations.clerk.jwtKey || undefined,
    secretKey: apiServerConfig.integrations.clerk.secretKey || undefined,
    authorizedParties: apiServerConfig.integrations.clerk.authorizedParties,
  });

  const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!subject) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.UNAUTHORIZED,
      401,
      "Invalid Clerk session token.",
    );
  }

  const rawName =
    (typeof payload.name === "string" && payload.name) ||
    (typeof payload.full_name === "string" && payload.full_name) ||
    (typeof payload.given_name === "string" && payload.given_name) ||
    "";

  return {
    subject,
    email:
      typeof payload.email === "string"
        ? payload.email
        : typeof payload.email_address === "string"
          ? payload.email_address
          : null,
    nickname: rawName.trim() || null,
    avatarUrl:
      typeof payload.picture === "string"
        ? payload.picture
        : typeof payload.image_url === "string"
          ? payload.image_url
          : null,
  };
}

export async function createStripeCheckoutSession(params: {
  userId: string;
  gameId: string;
  nickname: string;
  request: CreateCheckoutSessionRequest;
}): Promise<CreateCheckoutSessionResponse> {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.SERVICE_UNAVAILABLE,
      503,
      "Stripe is not configured.",
    );
  }

  const product = getCommerceProduct(
    params.request.productKey ??
      apiServerConfig.integrations.stripe.defaultProductKey,
  );
  const priceId = params.request.priceId?.trim() || product?.priceId || "";
  if (!priceId) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.INVALID_REQUEST,
      400,
      "No Stripe price is configured for this product.",
    );
  }

  const mode = params.request.mode ?? product?.mode ?? "payment";
  const quantity = Math.max(1, Math.floor(params.request.quantity ?? 1));
  const successUrl =
    params.request.successUrl?.trim() ||
    apiServerConfig.integrations.stripe.successUrl;
  const cancelUrl =
    params.request.cancelUrl?.trim() ||
    apiServerConfig.integrations.stripe.cancelUrl;

  const metadata = {
    userId: params.userId,
    gameId: params.gameId,
    nickname: params.nickname,
    productKey: product?.productKey ?? params.request.productKey ?? "custom",
    coinGrant: String(product?.coinGrant ?? 0),
    ...(params.request.metadata ?? {}),
  };

  const session = await stripe.checkout.sessions.create({
    mode,
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    client_reference_id: params.userId,
    customer_email: params.request.customerEmail?.trim() || undefined,
    line_items: [
      {
        price: priceId,
        quantity,
      },
    ],
    metadata,
    success_url: successUrl,
    cancel_url: cancelUrl,
    ...(mode === "payment" ? { customer_creation: "always" as const } : {}),
  });

  if (!session.url) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.SERVICE_UNAVAILABLE,
      503,
      "Stripe did not return a checkout URL.",
    );
  }

  await captureServerEvent({
    event: "stripe_checkout_created",
    distinctId: params.userId,
    properties: {
      productKey: metadata.productKey,
      mode,
      sessionId: session.id,
    },
  });

  return {
    provider: "stripe",
    productKey: metadata.productKey,
    mode,
    sessionId: session.id,
    checkoutUrl: session.url,
    serverTime: nowIso(),
  };
}

export async function handleStripeWebhook(params: {
  rawBody: string;
  signature: string;
}): Promise<{ received: true; eventType: string }> {
  const stripe = getStripeClient();
  const webhookSecret = apiServerConfig.integrations.stripe.webhookSecret;
  if (!stripe || !webhookSecret) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.SERVICE_UNAVAILABLE,
      503,
      "Stripe webhook is not configured.",
    );
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      params.rawBody,
      params.signature,
      webhookSecret,
    );
  } catch (error) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.UNAUTHORIZED,
      401,
      normalizeErrorMessage(error, "Invalid Stripe signature."),
    );
  }

  if (event.type === "checkout.session.completed") {
    await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
  }

  return {
    received: true,
    eventType: event.type,
  };
}

export async function handleResendWebhook(params: {
  rawBody: string;
  headers: {
    id: string;
    timestamp: string;
    signature: string;
  };
}): Promise<{ received: true; eventType: string; emailId: string | null }> {
  const resend = getResendWebhookClient();
  const webhookSecret = apiServerConfig.integrations.resend.webhookSecret;
  if (!resend || !webhookSecret) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.SERVICE_UNAVAILABLE,
      503,
      "Resend webhook is not configured.",
    );
  }

  let event: WebhookEventPayload;
  try {
    event = resend.webhooks.verify({
      payload: params.rawBody,
      headers: params.headers,
      webhookSecret,
    });
  } catch (error) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.UNAUTHORIZED,
      401,
      normalizeErrorMessage(error, "Invalid Resend webhook signature."),
    );
  }

  if (event.type === "email.received") {
    await handleResendEmailReceived(event);
  } else {
    await captureServerEvent({
      event: `resend_${event.type.replace(/\./g, "_")}`,
      properties: {
        createdAt: event.created_at,
      },
    });
  }

  const emailId =
    typeof (event.data as { email_id?: unknown })?.email_id === "string"
      ? (event.data as { email_id: string }).email_id
      : null;

  return {
    received: true,
    eventType: event.type,
    emailId,
  };
}

export async function uploadAvatarToSupabase(params: {
  userId: string;
  payload: UploadAvatarRequest;
}): Promise<UploadAvatarResponse> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.SERVICE_UNAVAILABLE,
      503,
      "Supabase Storage is not configured.",
    );
  }

  const parsed = parseDataUrl(params.payload.dataUrl);
  const digest = createHash("sha1").update(parsed.buffer).digest("hex");
  const objectPath = `${params.userId}/${digest}.${parsed.extension}`;
  const bucket = apiServerConfig.integrations.supabase.avatarBucket;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(objectPath, parsed.buffer, {
      contentType: parsed.contentType,
      upsert: true,
    });

  if (error) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.SERVICE_UNAVAILABLE,
      503,
      error.message || "Avatar upload failed.",
    );
  }

  const publicUrl = supabase.storage.from(bucket).getPublicUrl(objectPath).data
    .publicUrl;
  if (!publicUrl) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.SERVICE_UNAVAILABLE,
      503,
      "Avatar upload succeeded but no public URL was returned.",
    );
  }

  await captureServerEvent({
    event: "supabase_avatar_uploaded",
    distinctId: params.userId,
    properties: {
      bucket,
      objectPath,
      bytes: parsed.buffer.byteLength,
      contentType: parsed.contentType,
    },
  });

  return {
    provider: "supabase",
    avatarUrl: publicUrl,
    objectPath,
    serverTime: nowIso(),
  };
}

export async function requestPasswordResetByEmail(params: {
  account: string;
}): Promise<{ challengeId: string }> {
  const account = params.account.trim().toLowerCase();
  const fallbackChallengeId = `pwd_${randomUUID().replaceAll("-", "")}`;
  const identity = await findPasswordIdentityByAccount(account);
  if (!identity) {
    return { challengeId: fallbackChallengeId };
  }

  const summary = await getUserSummaryById(identity.userId);
  const email = summary
    ? resolveResetEmail(account, summary.summary.identities)
    : null;
  if (!email) {
    return { challengeId: fallbackChallengeId };
  }

  const code = `${randomInt(100000, 999999)}`;
  const challengeId = `pwd_${randomUUID().replaceAll("-", "")}`;
  const record: PasswordResetChallengeRecord = {
    kind: "password-reset",
    account,
    userId: identity.userId,
    email,
    code,
  };

  await persistRecord(`auth:pwdreset:${challengeId}`, record, 1000 * 60 * 15);
  await dispatchEmailMessage({
    to: email,
    subject: "BOP 密码重置验证码",
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">
        <h2 style="margin-bottom:12px">密码重置请求</h2>
        <p>你正在为 BOP 账号 <strong>${account}</strong> 重置密码。</p>
        <p>验证码：<strong style="font-size:24px;letter-spacing:4px">${code}</strong></p>
        <p>15 分钟内有效。如果不是你本人操作，可以忽略这封邮件。</p>
      </div>
    `,
  });

  await captureServerEvent({
    event: "resend_password_reset_requested",
    distinctId: identity.userId,
    properties: {
      account,
      challengeId,
      emailDomain: email.split("@")[1] ?? null,
    },
  });

  return { challengeId };
}

export async function verifyPasswordResetChallenge(params: {
  challengeId: string;
  code: string;
}): Promise<PasswordResetChallengeRecord> {
  const record = await readRecord<PasswordResetChallengeRecord>(
    `auth:pwdreset:${params.challengeId}`,
  );
  if (!record || record.kind !== "password-reset") {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.AUTH_REFRESH_TOKEN_INVALID,
      401,
      "Password reset challenge is invalid or expired.",
    );
  }

  if (record.code !== params.code.trim()) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.AUTH_INVALID_CREDENTIALS,
      401,
      "Verification code is invalid.",
    );
  }

  await deleteRecord(`auth:pwdreset:${params.challengeId}`);
  return record;
}

export async function queryPineconeKnowledge(
  request: PineconeSearchRequest,
): Promise<PineconeSearchResponse> {
  const pinecone = getPineconeClient();
  if (!pinecone || !apiServerConfig.integrations.pinecone.indexHost) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.SERVICE_UNAVAILABLE,
      503,
      "Pinecone is not configured.",
    );
  }

  const namespace =
    request.namespace?.trim() || apiServerConfig.integrations.pinecone.namespace;
  const index = pinecone.index({
    host: apiServerConfig.integrations.pinecone.indexHost,
  });

  const response = await (index as any).searchRecords({
    namespace,
    query: {
      inputs: {
        text: request.query,
      },
      topK: Math.max(
        1,
        Math.floor(request.topK ?? apiServerConfig.integrations.pinecone.topK),
      ),
      filter: request.filter,
    },
  });

  const rawMatches =
    (response as any)?.result?.hits ??
    (response as any)?.matches ??
    (response as any)?.data ??
    [];
  const matches: PineconeSearchMatch[] = Array.isArray(rawMatches)
    ? rawMatches.map((match: any) => ({
        id:
          typeof match?._id === "string"
            ? match._id
            : typeof match?.id === "string"
              ? match.id
              : randomUUID(),
        score:
          typeof match?._score === "number"
            ? match._score
            : typeof match?.score === "number"
              ? match.score
              : 0,
        metadata:
          match?.fields && typeof match.fields === "object"
            ? match.fields
            : match?.metadata && typeof match.metadata === "object"
              ? match.metadata
              : undefined,
      }))
    : [];

  await captureServerEvent({
    event: "pinecone_search_executed",
    properties: {
      namespace,
      topK: request.topK ?? apiServerConfig.integrations.pinecone.topK,
      resultCount: matches.length,
    },
  });

  return {
    provider: "pinecone",
    query: request.query,
    namespace,
    matches,
    serverTime: nowIso(),
  };
}
