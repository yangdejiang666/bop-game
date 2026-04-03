import type { QueryResultRow } from "pg";
import type { DbExecutor } from "../lib/db.js";
import { query } from "../lib/db.js";

type Executor = DbExecutor;

export type VerificationChannel = "email" | "sms";
export type VerificationPurpose =
  | "login"
  | "register"
  | "resetPassword"
  | "bindMobile"
  | "bindEmail";
export type VerificationSendStatus =
  | "pending"
  | "sent"
  | "failed"
  | "consumed"
  | "expired"
  | "cancelled";

interface VerificationChallengeRow extends QueryResultRow {
  challengeId: string;
  channel: VerificationChannel;
  purpose: VerificationPurpose;
  userId: string | null;
  account: string | null;
  email: string | null;
  phoneCountryCode: string | null;
  phoneNumber: string | null;
  phoneE164: string | null;
  codeHash: string;
  attemptCount: number;
  maxAttempts: number;
  deliveryProvider: string;
  providerMessageId: string | null;
  sendStatus: VerificationSendStatus;
  sendError: string | null;
  debugPayload: unknown;
  metadata: unknown;
  expiresAt: string;
  sentAt: string | null;
  consumedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface InboundEmailRow extends QueryResultRow {
  provider: string;
  emailId: string;
  receivedAt: string;
  fromEmail: string;
  toEmails: unknown;
  ccEmails: unknown;
  bccEmails: unknown;
  subject: string;
  messageId: string;
  textContent: string | null;
  htmlContent: string | null;
  attachments: unknown;
  rawDownloadUrl: string | null;
  rawExpiresAt: string | null;
  payloadJson: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface VerificationChallengeRecord {
  challengeId: string;
  channel: VerificationChannel;
  purpose: VerificationPurpose;
  userId: string | null;
  account: string | null;
  email: string | null;
  phoneCountryCode: string | null;
  phoneNumber: string | null;
  phoneE164: string | null;
  codeHash: string;
  attemptCount: number;
  maxAttempts: number;
  deliveryProvider: string;
  providerMessageId: string | null;
  sendStatus: VerificationSendStatus;
  sendError: string | null;
  debugPayload: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  expiresAt: string;
  sentAt: string | null;
  consumedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InboundEmailRecord {
  provider: string;
  emailId: string;
  receivedAt: string;
  fromEmail: string;
  toEmails: string[];
  ccEmails: string[];
  bccEmails: string[];
  subject: string;
  messageId: string;
  textContent: string | null;
  htmlContent: string | null;
  attachments: Array<Record<string, unknown>>;
  rawDownloadUrl: string | null;
  rawExpiresAt: string | null;
  payloadJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function getExecutor(executor?: Executor): Executor {
  return executor ?? { query: (text, params) => query(text, params) };
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asObjectOrNull(value: unknown): Record<string, unknown> | null {
  if (value == null) {
    return null;
  }
  return asObject(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function asObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => entry as Record<string, unknown>);
}

function mapChallenge(row: VerificationChallengeRow): VerificationChallengeRecord {
  return {
    challengeId: row.challengeId,
    channel: row.channel,
    purpose: row.purpose,
    userId: row.userId,
    account: row.account,
    email: row.email,
    phoneCountryCode: row.phoneCountryCode,
    phoneNumber: row.phoneNumber,
    phoneE164: row.phoneE164,
    codeHash: row.codeHash,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    deliveryProvider: row.deliveryProvider,
    providerMessageId: row.providerMessageId,
    sendStatus: row.sendStatus,
    sendError: row.sendError,
    debugPayload: asObjectOrNull(row.debugPayload),
    metadata: asObject(row.metadata),
    expiresAt: row.expiresAt,
    sentAt: row.sentAt,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapInboundEmail(row: InboundEmailRow): InboundEmailRecord {
  return {
    provider: row.provider,
    emailId: row.emailId,
    receivedAt: row.receivedAt,
    fromEmail: row.fromEmail,
    toEmails: asStringArray(row.toEmails),
    ccEmails: asStringArray(row.ccEmails),
    bccEmails: asStringArray(row.bccEmails),
    subject: row.subject,
    messageId: row.messageId,
    textContent: row.textContent,
    htmlContent: row.htmlContent,
    attachments: asObjectArray(row.attachments),
    rawDownloadUrl: row.rawDownloadUrl,
    rawExpiresAt: row.rawExpiresAt,
    payloadJson: asObject(row.payloadJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createVerificationChallenge(
  params: {
    challengeId: string;
    channel: VerificationChannel;
    purpose: VerificationPurpose;
    userId?: string | null;
    account?: string | null;
    email?: string | null;
    phoneCountryCode?: string | null;
    phoneNumber?: string | null;
    phoneE164?: string | null;
    codeHash: string;
    maxAttempts?: number;
    deliveryProvider: string;
    metadata?: Record<string, unknown>;
    expiresAt: string;
  },
  executor?: Executor,
): Promise<VerificationChallengeRecord> {
  const db = getExecutor(executor);
  const result = await db.query<VerificationChallengeRow>(
    `
      INSERT INTO auth_verification_challenges (
        challenge_id,
        channel,
        purpose,
        user_id,
        account,
        email,
        phone_country_code,
        phone_number,
        phone_e164,
        code_hash,
        max_attempts,
        delivery_provider,
        metadata,
        expires_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13::jsonb,
        $14
      )
      RETURNING
        challenge_id AS "challengeId",
        channel,
        purpose,
        user_id AS "userId",
        account,
        email,
        phone_country_code AS "phoneCountryCode",
        phone_number AS "phoneNumber",
        phone_e164 AS "phoneE164",
        code_hash AS "codeHash",
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        delivery_provider AS "deliveryProvider",
        provider_message_id AS "providerMessageId",
        send_status AS "sendStatus",
        send_error AS "sendError",
        debug_payload AS "debugPayload",
        metadata,
        expires_at AS "expiresAt",
        sent_at AS "sentAt",
        consumed_at AS "consumedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [
      params.challengeId,
      params.channel,
      params.purpose,
      params.userId ?? null,
      params.account ?? null,
      params.email ?? null,
      params.phoneCountryCode ?? null,
      params.phoneNumber ?? null,
      params.phoneE164 ?? null,
      params.codeHash,
      params.maxAttempts ?? 5,
      params.deliveryProvider,
      JSON.stringify(params.metadata ?? {}),
      params.expiresAt,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("failed to create verification challenge");
  }
  return mapChallenge(row);
}

export async function cancelActiveChallengesForTarget(
  params: {
    channel: VerificationChannel;
    purpose: VerificationPurpose;
    email?: string | null;
    phoneE164?: string | null;
  },
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  await db.query(
    `
      UPDATE auth_verification_challenges
      SET
        send_status = 'cancelled',
        updated_at = NOW()
      WHERE channel = $1
        AND purpose = $2
        AND consumed_at IS NULL
        AND expires_at > NOW()
        AND send_status IN ('pending', 'sent')
        AND (
          ($3::text IS NOT NULL AND email = $3)
          OR
          ($4::text IS NOT NULL AND phone_e164 = $4)
        )
    `,
    [params.channel, params.purpose, params.email ?? null, params.phoneE164 ?? null],
  );
}

export async function getLatestActiveChallengeForTarget(
  params: {
    channel: VerificationChannel;
    purpose: VerificationPurpose;
    email?: string | null;
    phoneE164?: string | null;
  },
  executor?: Executor,
): Promise<VerificationChallengeRecord | null> {
  const db = getExecutor(executor);
  const result = await db.query<VerificationChallengeRow>(
    `
      SELECT
        challenge_id AS "challengeId",
        channel,
        purpose,
        user_id AS "userId",
        account,
        email,
        phone_country_code AS "phoneCountryCode",
        phone_number AS "phoneNumber",
        phone_e164 AS "phoneE164",
        code_hash AS "codeHash",
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        delivery_provider AS "deliveryProvider",
        provider_message_id AS "providerMessageId",
        send_status AS "sendStatus",
        send_error AS "sendError",
        debug_payload AS "debugPayload",
        metadata,
        expires_at AS "expiresAt",
        sent_at AS "sentAt",
        consumed_at AS "consumedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM auth_verification_challenges
      WHERE channel = $1
        AND purpose = $2
        AND consumed_at IS NULL
        AND expires_at > NOW()
        AND send_status IN ('pending', 'sent')
        AND (
          ($3::text IS NOT NULL AND email = $3)
          OR
          ($4::text IS NOT NULL AND phone_e164 = $4)
        )
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [params.channel, params.purpose, params.email ?? null, params.phoneE164 ?? null],
  );

  const row = result.rows[0];
  return row ? mapChallenge(row) : null;
}

export async function getVerificationChallengeById(
  challengeId: string,
  executor?: Executor,
): Promise<VerificationChallengeRecord | null> {
  const db = getExecutor(executor);
  const result = await db.query<VerificationChallengeRow>(
    `
      SELECT
        challenge_id AS "challengeId",
        channel,
        purpose,
        user_id AS "userId",
        account,
        email,
        phone_country_code AS "phoneCountryCode",
        phone_number AS "phoneNumber",
        phone_e164 AS "phoneE164",
        code_hash AS "codeHash",
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        delivery_provider AS "deliveryProvider",
        provider_message_id AS "providerMessageId",
        send_status AS "sendStatus",
        send_error AS "sendError",
        debug_payload AS "debugPayload",
        metadata,
        expires_at AS "expiresAt",
        sent_at AS "sentAt",
        consumed_at AS "consumedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM auth_verification_challenges
      WHERE challenge_id = $1
      LIMIT 1
    `,
    [challengeId],
  );

  const row = result.rows[0];
  return row ? mapChallenge(row) : null;
}

export async function markVerificationChallengeSent(
  params: {
    challengeId: string;
    providerMessageId?: string | null;
    debugPayload?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
  },
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  await db.query(
    `
      UPDATE auth_verification_challenges
      SET
        send_status = 'sent',
        provider_message_id = COALESCE($2, provider_message_id),
        debug_payload = COALESCE($3::jsonb, debug_payload),
        metadata = CASE
          WHEN $4::jsonb IS NULL THEN metadata
          ELSE metadata || $4::jsonb
        END,
        send_error = NULL,
        sent_at = NOW(),
        updated_at = NOW()
      WHERE challenge_id = $1
    `,
    [
      params.challengeId,
      params.providerMessageId ?? null,
      params.debugPayload ? JSON.stringify(params.debugPayload) : null,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ],
  );
}

export async function markVerificationChallengeFailed(
  params: {
    challengeId: string;
    errorMessage: string;
    debugPayload?: Record<string, unknown> | null;
  },
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  await db.query(
    `
      UPDATE auth_verification_challenges
      SET
        send_status = 'failed',
        send_error = $2,
        debug_payload = COALESCE($3::jsonb, debug_payload),
        updated_at = NOW()
      WHERE challenge_id = $1
    `,
    [
      params.challengeId,
      params.errorMessage,
      params.debugPayload ? JSON.stringify(params.debugPayload) : null,
    ],
  );
}

export async function incrementVerificationChallengeAttempt(
  challengeId: string,
  executor?: Executor,
): Promise<VerificationChallengeRecord | null> {
  const db = getExecutor(executor);
  const result = await db.query<VerificationChallengeRow>(
    `
      UPDATE auth_verification_challenges
      SET
        attempt_count = attempt_count + 1,
        send_status = CASE
          WHEN attempt_count + 1 >= max_attempts THEN 'failed'
          ELSE send_status
        END,
        updated_at = NOW()
      WHERE challenge_id = $1
      RETURNING
        challenge_id AS "challengeId",
        channel,
        purpose,
        user_id AS "userId",
        account,
        email,
        phone_country_code AS "phoneCountryCode",
        phone_number AS "phoneNumber",
        phone_e164 AS "phoneE164",
        code_hash AS "codeHash",
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        delivery_provider AS "deliveryProvider",
        provider_message_id AS "providerMessageId",
        send_status AS "sendStatus",
        send_error AS "sendError",
        debug_payload AS "debugPayload",
        metadata,
        expires_at AS "expiresAt",
        sent_at AS "sentAt",
        consumed_at AS "consumedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [challengeId],
  );

  const row = result.rows[0];
  return row ? mapChallenge(row) : null;
}

export async function consumeVerificationChallenge(
  challengeId: string,
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  await db.query(
    `
      UPDATE auth_verification_challenges
      SET
        send_status = 'consumed',
        consumed_at = NOW(),
        debug_payload = NULL,
        updated_at = NOW()
      WHERE challenge_id = $1
    `,
    [challengeId],
  );
}

export async function upsertInboundEmail(
  params: {
    provider: string;
    emailId: string;
    receivedAt: string;
    fromEmail: string;
    toEmails: string[];
    ccEmails: string[];
    bccEmails: string[];
    subject: string;
    messageId: string;
    textContent: string | null;
    htmlContent: string | null;
    attachments: Array<Record<string, unknown>>;
    rawDownloadUrl: string | null;
    rawExpiresAt: string | null;
    payloadJson?: Record<string, unknown>;
  },
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  await db.query(
    `
      INSERT INTO platform_inbound_emails (
        provider,
        email_id,
        received_at,
        from_email,
        to_emails,
        cc_emails,
        bcc_emails,
        subject,
        message_id,
        text_content,
        html_content,
        attachments,
        raw_download_url,
        raw_expires_at,
        payload_json
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5::jsonb,
        $6::jsonb,
        $7::jsonb,
        $8,
        $9,
        $10,
        $11,
        $12::jsonb,
        $13,
        $14,
        $15::jsonb
      )
      ON CONFLICT (email_id) DO UPDATE
      SET
        provider = EXCLUDED.provider,
        received_at = EXCLUDED.received_at,
        from_email = EXCLUDED.from_email,
        to_emails = EXCLUDED.to_emails,
        cc_emails = EXCLUDED.cc_emails,
        bcc_emails = EXCLUDED.bcc_emails,
        subject = EXCLUDED.subject,
        message_id = EXCLUDED.message_id,
        text_content = EXCLUDED.text_content,
        html_content = EXCLUDED.html_content,
        attachments = EXCLUDED.attachments,
        raw_download_url = EXCLUDED.raw_download_url,
        raw_expires_at = EXCLUDED.raw_expires_at,
        payload_json = EXCLUDED.payload_json,
        updated_at = NOW()
    `,
    [
      params.provider,
      params.emailId,
      params.receivedAt,
      params.fromEmail,
      JSON.stringify(params.toEmails),
      JSON.stringify(params.ccEmails),
      JSON.stringify(params.bccEmails),
      params.subject,
      params.messageId,
      params.textContent,
      params.htmlContent,
      JSON.stringify(params.attachments),
      params.rawDownloadUrl,
      params.rawExpiresAt,
      JSON.stringify(params.payloadJson ?? {}),
    ],
  );
}

export async function listRecentInboundEmails(
  limit = 20,
  executor?: Executor,
): Promise<InboundEmailRecord[]> {
  const db = getExecutor(executor);
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const result = await db.query<InboundEmailRow>(
    `
      SELECT
        provider,
        email_id AS "emailId",
        received_at AS "receivedAt",
        from_email AS "fromEmail",
        to_emails AS "toEmails",
        cc_emails AS "ccEmails",
        bcc_emails AS "bccEmails",
        subject,
        message_id AS "messageId",
        text_content AS "textContent",
        html_content AS "htmlContent",
        attachments,
        raw_download_url AS "rawDownloadUrl",
        raw_expires_at AS "rawExpiresAt",
        payload_json AS "payloadJson",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM platform_inbound_emails
      ORDER BY received_at DESC, created_at DESC
      LIMIT $1
    `,
    [safeLimit],
  );

  return result.rows.map(mapInboundEmail);
}
