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
  type ListDeviceSessionsResponse,
  type LoginByPlatformRequest,
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
  loginByPassword,
  logoutSession,
  refreshSession,
  registerByPassword,
  revokeDeviceSession,
} from "../services/authService.js";
import {
  assertPlatformRateLimit,
  PlatformServiceError,
  requestPasswordResetByEmail,
  verifyPasswordResetChallenge,
} from "../services/platformService.js";
import { hashPassword } from "../lib/password.js";
import { updatePasswordHashForUser } from "../repositories/accountRepository.js";

const router = Router();

const ACCOUNT_MIN = 3;
const ACCOUNT_MAX = 64;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 64;

function normalizeAccount(value: string): string {
  return value.trim().toLowerCase();
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

    try {
      await assertPlatformRateLimit(
        "register",
        `${request.ip}:${account}`,
      );
      const result = await registerByPassword({
        account,
        password: body.password,
        nickname: body.nickname,
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
        response.status(409).json(
          createError(PROTOCOL_ERROR.CONFLICT, "account already exists.", {
            requestId: readRequestId(request),
            details: { field: "account" },
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

router.post("/sms/send", (request, response) => {
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

  const payload: SendSmsCodeResponse = {
    success: true,
    cooldownSeconds: 60,
    serverTime: new Date().toISOString(),
  };
  response.json(createSuccess(payload, readRequestId(request)));
});

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

  if (body.verifyBy !== "email") {
    response.status(400).json(
      createError(
        PROTOCOL_ERROR.INVALID_REQUEST,
        "Only email password reset is configured.",
        {
          requestId: readRequestId(request),
          details: { field: "verifyBy" },
        },
      ),
    );
    return;
  }

  try {
    const result = await requestPasswordResetByEmail({
      account: body.account,
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

  const payload: BindMobileResponse = {
    success: true,
    mobileMasked: `${body.countryCode}${body.mobile}`.replace(/(\d{3})\d+(\d{3})$/, "$1****$2"),
    serverTime: new Date().toISOString(),
  };
  response.json(createSuccess(payload, readRequestId(request)));
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

  const [name, domain] = body.email.split("@");
  const payload: BindEmailResponse = {
    success: true,
    emailMasked:
      name && domain ? `${name.slice(0, 2)}***@${domain}` : "***",
    serverTime: new Date().toISOString(),
  };
  response.json(createSuccess(payload, readRequestId(request)));
}));

export default router;
