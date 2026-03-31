import { Buffer } from "node:buffer";
import { Router, type Request, type Response } from "express";
import {
  PROTOCOL_ERROR,
  createError,
  createSuccess,
  type CreateCheckoutSessionRequest,
  type CreateCheckoutSessionResponse,
  type PineconeSearchRequest,
  type PineconeSearchResponse,
  type PlatformConfigResponse,
  type UploadAvatarRequest,
  type UploadAvatarResponse,
} from "@bop/shared-protocol";
import { asyncHandler } from "../lib/asyncHandler.js";
import {
  readRequestId,
  requireAuth,
  type AuthenticatedRequest,
} from "../lib/auth.js";
import { getUserSummary } from "../services/userService.js";
import {
  assertPlatformRateLimit,
  createPublicPlatformConfig,
  handleResendWebhook,
  createStripeCheckoutSession,
  handleStripeWebhook,
  PlatformServiceError,
  queryPineconeKnowledge,
  uploadAvatarToSupabase,
} from "../services/platformService.js";

function sendPlatformError(
  response: Response,
  request: Request,
  error: PlatformServiceError,
) {
  response.status(error.status).json(
    createError(error.code as any, error.message, {
      requestId: readRequestId(request),
    }),
  );
}

const router = Router();

router.get("/config", (_request, response) => {
  const payload: PlatformConfigResponse = createPublicPlatformConfig();
  response.json(createSuccess(payload));
});

router.post(
  "/commerce/checkout",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) {
      return;
    }

    const body = (request.body ?? {}) as Partial<CreateCheckoutSessionRequest>;
    try {
      await assertPlatformRateLimit("checkout", auth.userId);
      const summary = await getUserSummary(auth.userId);
      const payload: CreateCheckoutSessionResponse =
        await createStripeCheckoutSession({
          userId: auth.userId,
          gameId: summary.user.gameId,
          nickname: summary.profile.nickname,
          request: {
            productKey: body.productKey,
            priceId: body.priceId,
            mode: body.mode,
            quantity: body.quantity,
            successUrl: body.successUrl,
            cancelUrl: body.cancelUrl,
            customerEmail: body.customerEmail,
            metadata: body.metadata,
          },
        });

      response.json(createSuccess(payload, readRequestId(request)));
    } catch (error) {
      if (error instanceof PlatformServiceError) {
        sendPlatformError(response, request, error);
        return;
      }
      throw error;
    }
  }),
);

router.post(
  "/storage/avatar/upload",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) {
      return;
    }

    const body = (request.body ?? {}) as Partial<UploadAvatarRequest>;
    if (typeof body.dataUrl !== "string" || !body.dataUrl.trim()) {
      response.status(400).json(
        createError(PROTOCOL_ERROR.INVALID_REQUEST, "dataUrl is required.", {
          requestId: readRequestId(request),
          details: { field: "dataUrl" },
        }),
      );
      return;
    }

    try {
      const payload: UploadAvatarResponse = await uploadAvatarToSupabase({
        userId: auth.userId,
        payload: {
          dataUrl: body.dataUrl,
          filename: body.filename,
        },
      });
      response.json(createSuccess(payload, readRequestId(request)));
    } catch (error) {
      if (error instanceof PlatformServiceError) {
        sendPlatformError(response, request, error);
        return;
      }
      throw error;
    }
  }),
);

router.post(
  "/ai/search",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) {
      return;
    }

    const body = (request.body ?? {}) as Partial<PineconeSearchRequest>;
    if (typeof body.query !== "string" || !body.query.trim()) {
      response.status(400).json(
        createError(PROTOCOL_ERROR.INVALID_REQUEST, "query is required.", {
          requestId: readRequestId(request),
          details: { field: "query" },
        }),
      );
      return;
    }

    try {
      const payload: PineconeSearchResponse = await queryPineconeKnowledge({
        query: body.query.trim(),
        topK: body.topK,
        namespace: body.namespace,
        filter: body.filter,
      });
      response.json(createSuccess(payload, readRequestId(request)));
    } catch (error) {
      if (error instanceof PlatformServiceError) {
        sendPlatformError(response, request, error);
        return;
      }
      throw error;
    }
  }),
);

export const platformRouter = router;

export async function handleStripeWebhookHttp(
  request: Request,
  response: Response,
): Promise<void> {
  const signature = request.header("stripe-signature")?.trim() ?? "";
  if (!signature) {
    response.status(400).json(
      createError(PROTOCOL_ERROR.INVALID_REQUEST, "Missing Stripe signature.", {
        requestId: readRequestId(request),
        details: { field: "stripe-signature" },
      }),
    );
    return;
  }

  const rawBody =
    Buffer.isBuffer(request.body)
      ? request.body.toString("utf8")
      : typeof request.body === "string"
        ? request.body
        : "";

  try {
    const payload = await handleStripeWebhook({
      rawBody,
      signature,
    });
    response.json(createSuccess(payload, readRequestId(request)));
  } catch (error) {
    if (error instanceof PlatformServiceError) {
      sendPlatformError(response, request, error);
      return;
    }
    throw error;
  }
}

export async function handleResendWebhookHttp(
  request: Request,
  response: Response,
): Promise<void> {
  const svixId = request.header("svix-id")?.trim() ?? "";
  const svixTimestamp = request.header("svix-timestamp")?.trim() ?? "";
  const svixSignature = request.header("svix-signature")?.trim() ?? "";

  if (!svixId || !svixTimestamp || !svixSignature) {
    response.status(400).json(
      createError(
        PROTOCOL_ERROR.INVALID_REQUEST,
        "Missing Resend webhook signature headers.",
        {
          requestId: readRequestId(request),
          details: {
            fields: ["svix-id", "svix-timestamp", "svix-signature"],
          },
        },
      ),
    );
    return;
  }

  const rawBody =
    Buffer.isBuffer(request.body)
      ? request.body.toString("utf8")
      : typeof request.body === "string"
        ? request.body
        : "";

  try {
    const payload = await handleResendWebhook({
      rawBody,
      headers: {
        id: svixId,
        timestamp: svixTimestamp,
        signature: svixSignature,
      },
    });
    response.json(createSuccess(payload, readRequestId(request)));
  } catch (error) {
    if (error instanceof PlatformServiceError) {
      sendPlatformError(response, request, error);
      return;
    }
    throw error;
  }
}
