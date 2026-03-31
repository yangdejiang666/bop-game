import { createHash, randomInt, randomUUID } from "node:crypto";
import { PROTOCOL_ERROR } from "@bop/shared-protocol";
import type { DbExecutor } from "../lib/db.js";
import { apiServerConfig } from "../lib/config.js";
import {
  createVerificationChallenge,
  cancelActiveChallengesForTarget,
  consumeVerificationChallenge,
  getLatestActiveChallengeForTarget,
  getVerificationChallengeById,
  incrementVerificationChallengeAttempt,
  type VerificationChallengeRecord,
  type VerificationPurpose,
} from "../repositories/authVerificationRepository.js";
import {
  findPasswordIdentityByAccount,
  findVerifiedPhoneIdentity,
  getUserSummaryById,
} from "../repositories/accountRepository.js";
import {
  captureServerEvent,
  dispatchEmailMessage,
  dispatchSmsMessage,
  PlatformServiceError,
} from "./platformService.js";

const CHALLENGE_TTL_MS = 1000 * 60 * 15;
const CHALLENGE_COOLDOWN_MS = 1000 * 60;
const MAX_VERIFICATION_ATTEMPTS = 5;

type VerificationChannel = "email" | "sms";
type Executor = DbExecutor;

export interface NormalizedPhoneNumber {
  countryCode: string;
  mobile: string;
  phoneE164: string;
}

function normalizeEmailAddress(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.INVALID_REQUEST,
      400,
      "Email address is invalid.",
    );
  }
  return normalized;
}

function normalizeCountryCode(countryCode: string): string {
  const fallback = apiServerConfig.integrations.communications.defaultPhoneCountryCode;
  const raw = (countryCode || fallback).trim();
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.INVALID_REQUEST,
      400,
      "countryCode is invalid.",
    );
  }
  return digits.startsWith("+") ? digits : `+${digits}`;
}

export function normalizePhoneNumber(
  countryCode: string,
  mobile: string,
): NormalizedPhoneNumber {
  const normalizedCountryCode = normalizeCountryCode(countryCode);
  let normalizedMobile = mobile.replace(/\D/g, "");

  if (normalizedCountryCode === "+86") {
    if (normalizedMobile.startsWith("86") && normalizedMobile.length === 13) {
      normalizedMobile = normalizedMobile.slice(2);
    }
    if (!/^1[3-9]\d{9}$/.test(normalizedMobile)) {
      throw new PlatformServiceError(
        PROTOCOL_ERROR.INVALID_REQUEST,
        400,
        "Chinese mobile number is invalid.",
      );
    }
  } else if (normalizedMobile.length < 4 || normalizedMobile.length > 20) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.INVALID_REQUEST,
      400,
      "mobile is invalid.",
    );
  }

  return {
    countryCode: normalizedCountryCode,
    mobile: normalizedMobile,
    phoneE164: `${normalizedCountryCode}${normalizedMobile}`,
  };
}

function maskEmailAddress(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) {
    return "***";
  }
  const prefix = name.slice(0, Math.min(2, name.length));
  return `${prefix}***@${domain}`;
}

function maskPhoneNumber(phone: NormalizedPhoneNumber): string {
  return `${phone.countryCode}${phone.mobile}`.replace(
    /(\+\d{2,4})(\d{3})\d+(\d{3})$/,
    "$1$2****$3",
  );
}

export function maskPhoneForDisplay(
  countryCode: string,
  mobile: string,
): string {
  return maskPhoneNumber(normalizePhoneNumber(countryCode, mobile));
}

function buildChallengeId(prefix = "vfy"): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function buildFakeChallengeId(prefix = "vfy"): string {
  return buildChallengeId(prefix);
}

function buildVerificationCode(): string {
  return `${randomInt(100000, 999999)}`;
}

function hashVerificationCode(challengeId: string, code: string): string {
  return createHash("sha256")
    .update(`${challengeId}:${code.trim()}:${apiServerConfig.jwt.accessSecret}`)
    .digest("hex");
}

function resolveEmailSubject(purpose: VerificationPurpose): string {
  switch (purpose) {
    case "bindEmail":
      return "BOP 邮箱绑定验证码";
    case "resetPassword":
      return "BOP 密码重置验证码";
    case "login":
      return "BOP 登录验证码";
    case "register":
      return "BOP 注册验证码";
    default:
      return "BOP 验证码";
  }
}

function resolveEmailHeading(purpose: VerificationPurpose): string {
  switch (purpose) {
    case "bindEmail":
      return "邮箱绑定请求";
    case "resetPassword":
      return "密码重置请求";
    case "login":
      return "登录验证请求";
    case "register":
      return "注册验证请求";
    default:
      return "验证码请求";
  }
}

function buildEmailVerificationHtml(params: {
  code: string;
  purpose: VerificationPurpose;
  target: string;
}): string {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">
      <h2 style="margin-bottom:12px">${resolveEmailHeading(params.purpose)}</h2>
      <p>目标账号：<strong>${params.target}</strong></p>
      <p>验证码：</p>
      <p style="font-size:28px;letter-spacing:6px;font-weight:700;margin:12px 0">${params.code}</p>
      <p>验证码 15 分钟内有效。如果不是你本人操作，可以忽略这封邮件。</p>
    </div>
  `;
}

function buildSmsText(params: {
  code: string;
  purpose: VerificationPurpose;
}): string {
  const action =
    params.purpose === "resetPassword"
      ? "密码重置"
      : params.purpose === "bindMobile"
        ? "手机号绑定"
        : params.purpose === "register"
          ? "注册"
          : "登录";
  return `【BOP】${action}验证码：${params.code}，15分钟内有效。`;
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

function resolveVerifiedPhone(
  identities: Array<{
    phone?: string | null;
    phoneVerified?: boolean;
  }>,
): string | null {
  const found = identities.find(
    (identity) => identity.phoneVerified && identity.phone?.trim(),
  );
  return found?.phone?.trim() ?? null;
}

async function enforceChallengeCooldown(params: {
  channel: VerificationChannel;
  purpose: VerificationPurpose;
  email?: string | null;
  phoneE164?: string | null;
}): Promise<void> {
  const existing = await getLatestActiveChallengeForTarget(params);
  if (!existing) {
    return;
  }

  const elapsedMs = Date.now() - new Date(existing.createdAt).getTime();
  const retryAfterMs = CHALLENGE_COOLDOWN_MS - elapsedMs;
  if (retryAfterMs > 0) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.RATE_LIMITED,
      429,
      `Verification code requested too frequently. Retry in ${Math.ceil(
        retryAfterMs / 1000,
      )} seconds.`,
    );
  }

  await cancelActiveChallengesForTarget(params);
}

async function sendEmailVerificationCodeInternal(params: {
  email: string;
  purpose: VerificationPurpose;
  userId?: string | null;
  account?: string | null;
}): Promise<{ challengeId: string; cooldownSeconds: number }> {
  const email = normalizeEmailAddress(params.email);
  await enforceChallengeCooldown({
    channel: "email",
    purpose: params.purpose,
    email,
  });

  const challengeId = buildChallengeId("eml");
  const code = buildVerificationCode();
  await createVerificationChallenge({
    challengeId,
    channel: "email",
    purpose: params.purpose,
    userId: params.userId ?? null,
    account: params.account ?? null,
    email,
    codeHash: hashVerificationCode(challengeId, code),
    maxAttempts: MAX_VERIFICATION_ATTEMPTS,
    deliveryProvider: apiServerConfig.integrations.communications.emailProvider,
    metadata: {
      target: email,
    },
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
  });

  try {
    const dispatched = await dispatchEmailMessage({
      to: email,
      subject: resolveEmailSubject(params.purpose),
      html: buildEmailVerificationHtml({
        code,
        purpose: params.purpose,
        target: email,
      }),
      purpose: params.purpose,
      challengeId,
      debugPayload: {
        code,
        purpose: params.purpose,
        target: email,
      },
    });
    await captureServerEvent({
      event: "auth_email_code_sent",
      distinctId: params.userId ?? email,
      properties: {
        challengeId,
        purpose: params.purpose,
        provider: dispatched.provider,
      },
    });
  } catch (error) {
    throw error;
  }

  return {
    challengeId,
    cooldownSeconds: 60,
  };
}

async function sendSmsVerificationCodeInternal(params: {
  countryCode: string;
  mobile: string;
  purpose: VerificationPurpose;
  userId?: string | null;
  account?: string | null;
}): Promise<{
  challengeId: string;
  cooldownSeconds: number;
  normalizedPhone: NormalizedPhoneNumber;
}> {
  const normalizedPhone = normalizePhoneNumber(params.countryCode, params.mobile);
  await enforceChallengeCooldown({
    channel: "sms",
    purpose: params.purpose,
    phoneE164: normalizedPhone.phoneE164,
  });

  const challengeId = buildChallengeId("sms");
  const code = buildVerificationCode();
  await createVerificationChallenge({
    challengeId,
    channel: "sms",
    purpose: params.purpose,
    userId: params.userId ?? null,
    account: params.account ?? null,
    phoneCountryCode: normalizedPhone.countryCode,
    phoneNumber: normalizedPhone.mobile,
    phoneE164: normalizedPhone.phoneE164,
    codeHash: hashVerificationCode(challengeId, code),
    maxAttempts: MAX_VERIFICATION_ATTEMPTS,
    deliveryProvider: apiServerConfig.integrations.communications.smsProvider,
    metadata: {
      target: normalizedPhone.phoneE164,
    },
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
  });

  const dispatched = await dispatchSmsMessage({
    phone: normalizedPhone.phoneE164,
    purpose: params.purpose,
    code,
    text: buildSmsText({
      code,
      purpose: params.purpose,
    }),
    challengeId,
    debugPayload: {
      purpose: params.purpose,
      target: normalizedPhone.phoneE164,
    },
  });

  await captureServerEvent({
    event: "auth_sms_code_sent",
    distinctId: params.userId ?? normalizedPhone.phoneE164,
    properties: {
      challengeId,
      purpose: params.purpose,
      provider: dispatched.provider,
      countryCode: normalizedPhone.countryCode,
    },
  });

  return {
    challengeId,
    cooldownSeconds: 60,
    normalizedPhone,
  };
}

async function verifyStoredChallenge(
  challenge: VerificationChallengeRecord | null,
  code: string,
  channel: VerificationChannel,
  purpose: VerificationPurpose,
  executor?: Executor,
): Promise<VerificationChallengeRecord> {
  if (!challenge || challenge.channel !== channel || challenge.purpose !== purpose) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.AUTH_VERIFICATION_REQUIRED,
      401,
      "Verification code is missing or expired.",
    );
  }

  if (challenge.consumedAt || challenge.sendStatus === "consumed") {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.AUTH_VERIFICATION_REQUIRED,
      401,
      "Verification code has already been used.",
    );
  }

  if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
    throw new PlatformServiceError(
      PROTOCOL_ERROR.AUTH_VERIFICATION_REQUIRED,
      401,
      "Verification code is expired.",
    );
  }

  const expectedHash = hashVerificationCode(challenge.challengeId, code);
  if (expectedHash !== challenge.codeHash) {
    const updated = await incrementVerificationChallengeAttempt(
      challenge.challengeId,
      executor,
    );
    const attemptsLeft = updated
      ? Math.max(0, updated.maxAttempts - updated.attemptCount)
      : 0;
    throw new PlatformServiceError(
      PROTOCOL_ERROR.AUTH_INVALID_CREDENTIALS,
      401,
      attemptsLeft > 0
        ? `Verification code is invalid. ${attemptsLeft} attempts remaining.`
        : "Verification code is invalid.",
    );
  }

  await consumeVerificationChallenge(challenge.challengeId, executor);
  return challenge;
}

function tryResolvePhoneInput(account: string): NormalizedPhoneNumber | null {
  try {
    return normalizePhoneNumber(
      apiServerConfig.integrations.communications.defaultPhoneCountryCode,
      account,
    );
  } catch {
    return null;
  }
}

export async function sendEmailCode(params: {
  email: string;
  purpose: VerificationPurpose;
  userId?: string | null;
  account?: string | null;
}): Promise<{ cooldownSeconds: number }> {
  const result = await sendEmailVerificationCodeInternal(params);
  return {
    cooldownSeconds: result.cooldownSeconds,
  };
}

export async function sendSmsCode(params: {
  countryCode: string;
  mobile: string;
  purpose: VerificationPurpose;
  userId?: string | null;
  account?: string | null;
}): Promise<{ cooldownSeconds: number }> {
  const result = await sendSmsVerificationCodeInternal(params);
  return {
    cooldownSeconds: result.cooldownSeconds,
  };
}

export async function requestPasswordReset(params: {
  account: string;
  verifyBy: "email" | "sms";
}): Promise<{ challengeId: string }> {
  const account = params.account.trim().toLowerCase();
  const fallbackChallengeId = buildFakeChallengeId("pwd");

  if (params.verifyBy === "email") {
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

    const sent = await sendEmailVerificationCodeInternal({
      email,
      purpose: "resetPassword",
      userId: identity.userId,
      account,
    });
    return { challengeId: sent.challengeId };
  }

  const passwordIdentity = await findPasswordIdentityByAccount(account);
  if (passwordIdentity) {
    const summary = await getUserSummaryById(passwordIdentity.userId);
    const phone = summary
      ? resolveVerifiedPhone(summary.summary.identities)
      : null;
    if (!phone) {
      return { challengeId: fallbackChallengeId };
    }

    const matched = /^(\+\d{1,4})(\d+)$/.exec(phone);
    if (!matched) {
      return { challengeId: fallbackChallengeId };
    }
    const countryCode = matched[1];
    const mobile = matched[2];
    if (!countryCode || !mobile) {
      return { challengeId: fallbackChallengeId };
    }
    const sent = await sendSmsVerificationCodeInternal({
      countryCode,
      mobile,
      purpose: "resetPassword",
      userId: passwordIdentity.userId,
      account,
    });
    return { challengeId: sent.challengeId };
  }

  const phoneInput = tryResolvePhoneInput(account);
  if (!phoneInput) {
    return { challengeId: fallbackChallengeId };
  }

  const phoneIdentity = await findVerifiedPhoneIdentity(phoneInput.phoneE164);
  if (!phoneIdentity) {
    return { challengeId: fallbackChallengeId };
  }

  const summary = await getUserSummaryById(phoneIdentity.userId);
  const hasPasswordIdentity = summary?.summary.identities.some(
    (identity) => identity.provider === "password",
  );
  if (!summary || !hasPasswordIdentity) {
    return { challengeId: fallbackChallengeId };
  }

  const sent = await sendSmsVerificationCodeInternal({
    countryCode: phoneInput.countryCode,
    mobile: phoneInput.mobile,
    purpose: "resetPassword",
    userId: phoneIdentity.userId,
    account,
  });
  return { challengeId: sent.challengeId };
}

export async function verifyPasswordResetChallenge(params: {
  challengeId: string;
  code: string;
}): Promise<VerificationChallengeRecord> {
  const challenge = await getVerificationChallengeById(params.challengeId.trim());
  return verifyStoredChallenge(
    challenge,
    params.code.trim(),
    "email",
    "resetPassword",
  ).catch(async (error) => {
    if (challenge?.channel === "sms" && challenge.purpose === "resetPassword") {
      return verifyStoredChallenge(
        challenge,
        params.code.trim(),
        "sms",
        "resetPassword",
      );
    }
    throw error;
  });
}

export async function consumeEmailChallengeByCode(params: {
  email: string;
  purpose: VerificationPurpose;
  code: string;
}, executor?: Executor): Promise<VerificationChallengeRecord> {
  const email = normalizeEmailAddress(params.email);
  const challenge = await getLatestActiveChallengeForTarget({
    channel: "email",
    purpose: params.purpose,
    email,
  }, executor);
  return verifyStoredChallenge(
    challenge,
    params.code.trim(),
    "email",
    params.purpose,
    executor,
  );
}

export async function consumeSmsChallengeByCode(params: {
  countryCode: string;
  mobile: string;
  purpose: VerificationPurpose;
  code: string;
}, executor?: Executor): Promise<{
  challenge: VerificationChallengeRecord;
  normalizedPhone: NormalizedPhoneNumber;
}> {
  const normalizedPhone = normalizePhoneNumber(params.countryCode, params.mobile);
  const challenge = await getLatestActiveChallengeForTarget({
    channel: "sms",
    purpose: params.purpose,
    phoneE164: normalizedPhone.phoneE164,
  }, executor);
  const verified = await verifyStoredChallenge(
    challenge,
    params.code.trim(),
    "sms",
    params.purpose,
    executor,
  );
  return {
    challenge: verified,
    normalizedPhone,
  };
}

export function maskEmailForDisplay(email: string): string {
  return maskEmailAddress(normalizeEmailAddress(email));
}
