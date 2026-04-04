import { Router, type Request, type Response } from "express";
import {
  PROTOCOL_ERROR,
  createError,
  createSuccess,
  type BindEmailRequest,
  type BindEmailResponse,
  type BindMobileRequest,
  type BindMobileResponse,
  type ConfirmPasswordResetRequest,
  type ConfirmPasswordResetResponse,
  type DeviceInfo,
  type SendEmailCodeRequest,
  type SendEmailCodeResponse,
  type ListDeviceSessionsResponse,
  type LoginByPlatformRequest,
  type LoginBySmsRequest,
  type LoginByPasswordRequest,
  type LoginRequest,
  type LoginResponse,
  type LogoutRequest,
  type LogoutResponse,
  type RefreshTokenRequest,
  type RefreshTokenResponse,
  type RegisterByPasswordRequest,
  type RegisterByPasswordResponse,
  type RequestPasswordResetRequest,
  type RequestPasswordResetResponse,
  type RevokeDeviceSessionRequest,
  type RevokeDeviceSessionResponse,
  type SendSmsCodeRequest,
  type SendSmsCodeResponse,
} from "@bop/shared-protocol";
import { asyncHandler } from "../lib/asyncHandler.js";
import {
  requireAuth,
  type AuthenticatedRequest,
  readRequestId,
} from "../lib/auth.js";
import {
  listDeviceSessions,
  loginByPlatform,
  loginBySms,
  loginByPassword,
  logoutSession,
  refreshSession,
  registerByPassword,
  revokeDeviceSession,
} from "../services/authService.js";
import {
  assertPlatformRateLimit,
  PlatformServiceError,
} from "../services/platformService.js";
import { hashPassword } from "../lib/password.js";
import {
  bindEmailToUser,
  bindPhoneIdentityToUser,
  updatePasswordHashForUser,
} from "../repositories/accountRepository.js";
import {
  consumeEmailChallengeByCode,
  consumeSmsChallengeByCode,
  maskEmailForDisplay,
  maskPhoneForDisplay,
  requestPasswordReset,
  sendEmailCode,
  sendSmsCode,
  verifyPasswordResetChallenge,
} from "../services/authChallengeService.js";

const router = Router();

const ACCOUNT_MIN = 3;
const ACCOUNT_MAX = 64;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 64;
const VERIFICATION_PURPOSES = new Set([
  "login",
  "register",
  "resetPassword",
  "bindMobile",
  "bindEmail",
]);

function normalizeAccount(value: string): string {
  return value.trim().toLowerCase();
}

function isVerificationPurpose(
  value: string,
): value is SendSmsCodeRequest["purpose"] {
  return VERIFICATION_PURPOSES.has(value);
}

function readDeviceInfo(request: Request): DeviceInfo {
  const bodyDevice = (request.body as { device?: Partial<DeviceInfo> } | undefined)
    ?.device;
  const deviceId =
    bodyDevice?.deviceId?.trim() ||
    request.header("x-device-id")?.trim() ||
    "web-default-device";

  const platform = bodyDevice?.platform ?? "web";
  const appVersion =
    bodyDevice?.appVersion?.trim() ||
    request.header("x-app-version")?.trim() ||
    "0.1.0";

  return {
    deviceId,
    platform,
    appVersion,
    osVersion: bodyDevice?.osVersion,
    deviceModel: bodyDevice?.deviceModel,
    ip: request.ip,
    userAgent: request.header("user-agent") ?? undefined,
  };
}

function sendValidationError(
  response: Response,
  request: Request,
  message: string,
  field: string,
  status = 400,
) {
  response.status(status).json(
    createError(PROTOCOL_ERROR.INVALID_REQUEST, message, {
      requestId: readRequestId(request),
      details: { field },
    }),
  );
}

function isPgUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

function getPgConstraintName(error: unknown): string | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("constraint" in error)
  ) {
    return null;
  }

  const constraint = (error as { constraint?: unknown }).constraint;
  return typeof constraint === "string" && constraint.trim().length > 0
    ? constraint
    : null;
}

router.post(
  "/register",
  asyncHandler(async (request, response) => {
    const body = (request.body ?? {}) as Partial<RegisterByPasswordRequest>;

    if (typeof body.account !== "string" || typeof body.password !== "string") {
      sendValidationError(
        response,
        request,
        "account and password are required.",
        "account/password",
      );
      return;
    }

    const account = normalizeAccount(body.account);
    if (account.length < ACCOUNT_MIN || account.length > ACCOUNT_MAX) {
      sendValidationError(
        response,
        request,
        `account length must be ${ACCOUNT_MIN}~${ACCOUNT_MAX}.`,
        "account",
      );
      return;
    }

    if (
      body.password.length < PASSWORD_MIN ||
      body.password.length > PASSWORD_MAX
    ) {
      sendValidationError(
        response,
        request,
        `password length must be ${PASSWORD_MIN}~${PASSWORD_MAX}.`,
        "password",
      );
      return;
    }

    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const emailCode =
      typeof body.emailCode === "string" ? body.emailCode.trim() : "";
    if (!email) {
      sendValidationError(
        response,
        request,
        "email is required for registration.",
        "email",
      );
      return;
    }
    if (!emailCode) {
      sendValidationError(
        response,
        request,
        "emailCode is required for registration.",
        "emailCode",
      );
      return;
    }
    if ((email.length > 0 || emailCode.length > 0) && !email) {
      sendValidationError(
        response,
        request,
        "email is required when emailCode is provided.",
        "email",
      );
      return;
    }
    if ((email.length > 0 || emailCode.length > 0) && !emailCode) {
      sendValidationError(
        response,
        request,
        "emailCode is required when email is provided.",
        "emailCode",
      );
      return;
    }

    const mobileCountryCode =
      typeof body.mobileCountryCode === "string"
        ? body.mobileCountryCode.trim()
        : "";
    const mobile = typeof body.mobile === "string" ? body.mobile.trim() : "";
    const mobileCode =
      typeof body.mobileCode === "string" ? body.mobileCode.trim() : "";
    if ((mobile.length > 0 || mobileCode.length > 0) && !mobile) {
      sendValidationError(
        response,
        request,
        "mobile is required when mobileCode is provided.",
        "mobile",
      );
      return;
    }
    if ((mobile.length > 0 || mobileCode.length > 0) && !mobileCode) {
      sendValidationError(
        response,
        request,
        "mobileCode is required when mobile is provided.",
        "mobileCode",
      );
      return;
    }

    try {
      await assertPlatformRateLimit(
        "register",
        `${request.ip}:${account}`,
      );
      const result = await registerByPassword({
        account,
        password: body.password,
        nickname: body.nickname,
        emailVerification:
          email && emailCode
            ? {
                email,
                code: emailCode,
              }
            : undefined,
        mobileVerification:
          mobile && mobileCode
            ? {
                countryCode: mobileCountryCode || "+86",
                mobile,
                code: mobileCode,
              }
            : undefined,
        device: readDeviceInfo(request),
      });

      response
        .status(201)
        .json(
          createSuccess<RegisterByPasswordResponse>(
            result,
            readRequestId(request),
          ),
        );
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        const constraint = getPgConstraintName(error);
        const field =
          constraint === "uq_user_identities_email"
            ? "email"
            : constraint === "uq_user_identities_phone"
              ? "mobile"
              : "account";
        const message =
          field === "email"
            ? "email is already bound."
            : field === "mobile"
              ? "mobile is already bound."
              : "account already exists.";
        response.status(409).json(
          createError(PROTOCOL_ERROR.CONFLICT, message, {
            requestId: readRequestId(request),
            details: { field },
          }),
        );
        return;
      }
      if (error instanceof PlatformServiceError) {
        response.status(error.status).json(
          createError(error.code as any, error.message, {
            requestId: readRequestId(request),
          }),
        );
        return;
      }
      throw error;
    }
  }),
);

router.post(
  "/login",
  asyncHandler(async (request, response) => {
    const body = (request.body ?? {}) as Partial<LoginRequest>;
    if (!body || typeof body.method !== "string" || typeof body.payload !== "object") {
      response.status(400).json(
        createError(PROTOCOL_ERROR.INVALID_REQUEST, "Login payload is invalid.", {
          requestId: readRequestId(request),
          details: { field: "method" },
        }),
      );
      return;
    }

    try {
      if (body.method === "password") {
        const payload = body.payload as unknown as LoginByPasswordRequest;
        const account =
          typeof payload.account === "string"
            ? normalizeAccount(payload.account)
            : "";
        const password =
          typeof payload.password === "string" ? payload.password : "";

        if (!account || !password) {
          sendValidationError(
            response,
            request,
            "account and password are required.",
            "payload.account/password",
          );
          return;
        }

        await assertPlatformRateLimit(
          "login",
          `${request.ip}:${account}`,
        );
        const result = await loginByPassword({
          account,
          password,
          device: readDeviceInfo(request),
        });

        response.json(
          createSuccess<LoginResponse>(result, readRequestId(request)),
        );
        return;
      }

      if (body.method === "platform") {
        const payload = body.payload as unknown as LoginByPlatformRequest;
        const provider =
          typeof payload.provider === "string" ? payload.provider.trim() : "";
        const providerToken =
          typeof payload.providerToken === "string"
            ? payload.providerToken.trim()
            : "";

        if (!provider || !providerToken) {
          sendValidationError(
            response,
            request,
            "provider and providerToken are required.",
            "payload.provider/providerToken",
          );
          return;
        }

        await assertPlatformRateLimit(
          "login",
          `${request.ip}:${provider}`,
        );
        const result = await loginByPlatform({
          provider,
          providerToken,
          device: readDeviceInfo(request),
        });

        response.json(
          createSuccess<LoginResponse>(result, readRequestId(request)),
        );
        return;
      }

      if (body.method === "sms") {
        const payload = body.payload as unknown as LoginBySmsRequest;
        const countryCode =
          typeof payload.countryCode === "string"
            ? payload.countryCode.trim()
            : "";
        const mobile =
          typeof payload.mobile === "string" ? payload.mobile.trim() : "";
        const code =
          typeof payload.code === "string" ? payload.code.trim() : "";

        if (!countryCode || !mobile || !code) {
          sendValidationError(
            response,
            request,
            "countryCode, mobile and code are required.",
            "payload.countryCode/mobile/code",
          );
          return;
        }

        await assertPlatformRateLimit(
          "login",
          `${request.ip}:sms:${countryCode}${mobile}`,
        );
        const result = await loginBySms({
          countryCode,
          mobile,
          code,
          device: payload.device ?? readDeviceInfo(request),
        });

        response.json(
          createSuccess<LoginResponse>(result, readRequestId(request)),
        );
        return;
      }

      response.status(400).json(
        createError(PROTOCOL_ERROR.INVALID_REQUEST, "Unsupported login method.", {
          requestId: readRequestId(request),
          details: { field: "method" },
        }),
      );
    } catch (error) {
      if (error instanceof PlatformServiceError) {
        response.status(error.status).json(
          createError(error.code as any, error.message, {
            requestId: readRequestId(request),
          }),
        );
        return;
      }

      const message = error instanceof Error ? error.message : "login failed";
      if (message === "invalid credentials") {
        response.status(401).json(
          createError(
            PROTOCOL_ERROR.AUTH_INVALID_CREDENTIALS,
            "invalid credentials.",
            {
              requestId: readRequestId(request),
            },
          ),
        );
        return;
      }
      if (message === "account banned") {
        response.status(403).json(
          createError(
            PROTOCOL_ERROR.AUTH_ACCOUNT_BANNED,
            "account is banned.",
            {
              requestId: readRequestId(request),
            },
          ),
        );
        return;
      }
      if (message === "unsupported platform provider") {
        response.status(400).json(
          createError(PROTOCOL_ERROR.INVALID_REQUEST, "Unsupported platform provider.", {
            requestId: readRequestId(request),
            details: { field: "payload.provider" },
          }),
        );
        return;
      }
      throw error;
    }
  }),
);

router.post(
  "/refresh",
  asyncHandler(async (request, response) => {
    const body = (request.body ?? {}) as Partial<RefreshTokenRequest>;
    if (typeof body.refreshToken !== "string" || !body.refreshToken.trim()) {
      sendValidationError(
        response,
        request,
        "refreshToken is required.",
        "refreshToken",
      );
      return;
    }

    try {
      const result = await refreshSession({
        refreshToken: body.refreshToken.trim(),
        device: body.device,
      });

      response.json(
        createSuccess<RefreshTokenResponse>(result, readRequestId(request)),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "refresh token invalid";
      const code =
        message === "refresh token expired"
          ? PROTOCOL_ERROR.AUTH_TOKEN_EXPIRED
          : PROTOCOL_ERROR.AUTH_REFRESH_TOKEN_INVALID;

      response.status(401).json(
        createError(code, "refresh token invalid or expired.", {
          requestId: readRequestId(request),
        }),
      );
    }
  }),
);

router.post(
  "/logout",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) {
      return;
    }

    const body = (request.body ?? {}) as Partial<LogoutRequest>;
    await logoutSession({
      userId: auth.userId,
      sessionId: auth.sessionId,
      refreshToken: body.refreshToken,
      allDevices: body.allDevices,
    });

    const payload: LogoutResponse = {
      success: true,
      serverTime: new Date().toISOString(),
    };
    response.json(createSuccess(payload, readRequestId(request)));
  }),
);

router.get(
  "/sessions",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) {
      return;
    }

    const payload: ListDeviceSessionsResponse = await listDeviceSessions({
      userId: auth.userId,
      currentSessionId: auth.sessionId,
    });
    response.json(createSuccess(payload, readRequestId(request)));
  }),
);

router.post(
  "/sessions/revoke",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) {
      return;
    }

    const body = (request.body ?? {}) as Partial<RevokeDeviceSessionRequest>;
    if (typeof body.sessionId !== "string" || !body.sessionId.trim()) {
      sendValidationError(
        response,
        request,
        "sessionId is required.",
        "sessionId",
      );
      return;
    }

    try {
      await revokeDeviceSession({
        userId: auth.userId,
        sessionId: body.sessionId.trim(),
      });
    } catch {
      response.status(404).json(
        createError(PROTOCOL_ERROR.NOT_FOUND, "session not found.", {
          requestId: readRequestId(request),
          details: { field: "sessionId" },
        }),
      );
      return;
    }

    const payload: RevokeDeviceSessionResponse = {
      success: true,
      serverTime: new Date().toISOString(),
    };
    response.json(createSuccess(payload, readRequestId(request)));
  }),
);

router.post("/sms/send", asyncHandler(async (request, response) => {
  const body = (request.body ?? {}) as Partial<SendSmsCodeRequest>;
  if (
    typeof body.countryCode !== "string" ||
    typeof body.mobile !== "string" ||
    typeof body.purpose !== "string"
  ) {
    sendValidationError(
      response,
      request,
      "countryCode, mobile, purpose are required.",
      "countryCode/mobile/purpose",
    );
    return;
  }
  if (!isVerificationPurpose(body.purpose)) {
    sendValidationError(
      response,
      request,
      "purpose is invalid.",
      "purpose",
    );
    return;
  }

  try {
    await assertPlatformRateLimit(
      "login",
      `${request.ip}:sms-send:${body.countryCode}:${body.mobile}:${body.purpose}`,
    );
    const result = await sendSmsCode({
      countryCode: body.countryCode,
      mobile: body.mobile,
      purpose: body.purpose,
    });
    const payload: SendSmsCodeResponse = {
      success: true,
      cooldownSeconds: result.cooldownSeconds,
      serverTime: new Date().toISOString(),
    };
    response.json(createSuccess(payload, readRequestId(request)));
  } catch (error) {
    if (error instanceof PlatformServiceError) {
      response.status(error.status).json(
        createError(error.code as any, error.message, {
          requestId: readRequestId(request),
        }),
      );
      return;
    }
    throw error;
  }
}));

router.post("/email/send", asyncHandler(async (request, response) => {
  const body = (request.body ?? {}) as Partial<SendEmailCodeRequest>;
  if (typeof body.email !== "string" || typeof body.purpose !== "string") {
    sendValidationError(
      response,
      request,
      "email and purpose are required.",
      "email/purpose",
    );
    return;
  }
  if (!isVerificationPurpose(body.purpose)) {
    sendValidationError(
      response,
      request,
      "purpose is invalid.",
      "purpose",
    );
    return;
  }

  try {
    await assertPlatformRateLimit(
      "login",
      `${request.ip}:email-send:${body.email}:${body.purpose}`,
    );
    const result = await sendEmailCode({
      email: body.email,
      purpose: body.purpose,
    });
    const payload: SendEmailCodeResponse = {
      success: true,
      cooldownSeconds: result.cooldownSeconds,
      serverTime: new Date().toISOString(),
    };
    response.json(createSuccess(payload, readRequestId(request)));
  } catch (error) {
    if (error instanceof PlatformServiceError) {
      response.status(error.status).json(
        createError(error.code as any, error.message, {
          requestId: readRequestId(request),
        }),
      );
      return;
    }
    throw error;
  }
}));

router.post("/password/request-reset", asyncHandler(async (request, response) => {
  const body = (request.body ?? {}) as Partial<RequestPasswordResetRequest>;
  if (typeof body.account !== "string" || typeof body.verifyBy !== "string") {
    sendValidationError(
      response,
      request,
      "account and verifyBy are required.",
      "account/verifyBy",
    );
    return;
  }
  if (body.verifyBy !== "email" && body.verifyBy !== "sms") {
    sendValidationError(
      response,
      request,
      "verifyBy must be email or sms.",
      "verifyBy",
    );
    return;
  }

  try {
    const result = await requestPasswordReset({
      account: body.account.trim(),
      verifyBy: body.verifyBy,
    });
    const payload: RequestPasswordResetResponse = {
      success: true,
      challengeId: result.challengeId,
      serverTime: new Date().toISOString(),
    };
    response.json(createSuccess(payload, readRequestId(request)));
  } catch (error) {
    if (error instanceof PlatformServiceError) {
      response.status(error.status).json(
        createError(error.code as any, error.message, {
          requestId: readRequestId(request),
        }),
      );
      return;
    }
    throw error;
  }
}));

router.post("/password/confirm-reset", asyncHandler(async (request, response) => {
  const body = (request.body ?? {}) as Partial<ConfirmPasswordResetRequest>;
  if (
    typeof body.challengeId !== "string" ||
    typeof body.verificationCode !== "string" ||
    typeof body.newPassword !== "string"
  ) {
    sendValidationError(
      response,
      request,
      "challengeId, verificationCode, newPassword are required.",
      "challengeId/verificationCode/newPassword",
    );
    return;
  }

  try {
    const challenge = await verifyPasswordResetChallenge({
      challengeId: body.challengeId.trim(),
      code: body.verificationCode.trim(),
    });
    if (!challenge.userId) {
      throw new PlatformServiceError(
        PROTOCOL_ERROR.AUTH_VERIFICATION_REQUIRED,
        401,
        "Password reset challenge is invalid.",
      );
    }
    const passwordHash = await hashPassword(body.newPassword);
    await updatePasswordHashForUser(challenge.userId, passwordHash);
  } catch (error) {
    if (error instanceof PlatformServiceError) {
      response.status(error.status).json(
        createError(error.code as any, error.message, {
          requestId: readRequestId(request),
        }),
      );
      return;
    }
    throw error;
  }

  const payload: ConfirmPasswordResetResponse = {
    success: true,
    serverTime: new Date().toISOString(),
  };
  response.json(createSuccess(payload, readRequestId(request)));
}));

router.post("/bind/mobile", asyncHandler(async (request, response) => {
  const auth = await requireAuth(request as AuthenticatedRequest, response);
  if (!auth) {
    return;
  }

  const body = (request.body ?? {}) as Partial<BindMobileRequest>;
  if (
    typeof body.countryCode !== "string" ||
    typeof body.mobile !== "string" ||
    typeof body.code !== "string"
  ) {
    sendValidationError(
      response,
      request,
      "countryCode, mobile, code are required.",
      "countryCode/mobile/code",
    );
      return;
  }

  try {
    const verified = await consumeSmsChallengeByCode({
      countryCode: body.countryCode,
      mobile: body.mobile,
      purpose: "bindMobile",
      code: body.code,
    });
    await bindPhoneIdentityToUser({
      userId: auth.userId,
      phone: verified.normalizedPhone.phoneE164,
    });

    const payload: BindMobileResponse = {
      success: true,
      mobileMasked: maskPhoneForDisplay(body.countryCode, body.mobile),
      serverTime: new Date().toISOString(),
    };
    response.json(createSuccess(payload, readRequestId(request)));
  } catch (error) {
    if (isPgUniqueViolation(error)) {
      response.status(409).json(
        createError(PROTOCOL_ERROR.CONFLICT, "mobile is already bound.", {
          requestId: readRequestId(request),
          details: { field: "mobile" },
        }),
      );
      return;
    }
    if (error instanceof PlatformServiceError) {
      response.status(error.status).json(
        createError(error.code as any, error.message, {
          requestId: readRequestId(request),
        }),
      );
      return;
    }
    throw error;
  }
}));

router.post("/bind/email", asyncHandler(async (request, response) => {
  const auth = await requireAuth(request as AuthenticatedRequest, response);
  if (!auth) {
    return;
  }

  const body = (request.body ?? {}) as Partial<BindEmailRequest>;
  if (typeof body.email !== "string" || typeof body.code !== "string") {
    sendValidationError(
      response,
      request,
      "email and code are required.",
      "email/code",
    );
      return;
  }

  try {
    await consumeEmailChallengeByCode({
      email: body.email,
      purpose: "bindEmail",
      code: body.code,
    });
    await bindEmailToUser({
      userId: auth.userId,
      email: body.email,
    });

    const payload: BindEmailResponse = {
      success: true,
      emailMasked: maskEmailForDisplay(body.email),
      serverTime: new Date().toISOString(),
    };
    response.json(createSuccess(payload, readRequestId(request)));
  } catch (error) {
    if (isPgUniqueViolation(error)) {
      response.status(409).json(
        createError(PROTOCOL_ERROR.CONFLICT, "email is already bound.", {
          requestId: readRequestId(request),
          details: { field: "email" },
        }),
      );
      return;
    }
    if (error instanceof PlatformServiceError) {
      response.status(error.status).json(
        createError(error.code as any, error.message, {
          requestId: readRequestId(request),
        }),
      );
      return;
    }
    throw error;
  }
}));

export default router;
