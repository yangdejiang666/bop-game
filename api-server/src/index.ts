import "./loadEnv.js";
/* eslint-disable no-console */
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { apiServerConfig } from "./lib/config.js";
import { closeDbPool } from "./lib/db.js";
import {
  handleResendWebhookHttp,
  handleStripeWebhookHttp,
} from "./modules/platform.js";
import {
  captureServerException,
  initializeServerTelemetry,
  shutdownPlatformClients,
} from "./services/platformService.js";
import { createVersionedApiRouter } from "./routes/index.js";
initializeServerTelemetry();

function parseCorsOrigins(raw: string): string[] | boolean {
  const normalized = (raw ?? "").trim();
  if (!normalized || normalized === "*") {
    return true;
  }
  const list = normalized
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return list.length > 0 ? list : true;
}

function healthPayload() {
  return {
    ok: true,
    service: "bop-api-server",
    env: apiServerConfig.env,
    now: new Date().toISOString(),
  };
}

function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", true);

  app.use(
    cors({
      origin: parseCorsOrigins(apiServerConfig.corsOrigin),
      credentials: true,
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );

  app.use((req, _res, next) => {
    const requestIdHeader = req.header("x-request-id")?.trim();
    if (!requestIdHeader) {
      req.headers["x-request-id"] =
        `req_${Math.random().toString(36).slice(2, 10)}`;
    }
    next();
  });

  app.post(
    "/api/v1/platform/commerce/webhooks/stripe",
    express.raw({ type: "application/json" }),
    (request, response, next) => {
      void handleStripeWebhookHttp(request, response).catch(next);
    },
  );

  app.post(
    "/api/v1/platform/communications/webhooks/resend",
    express.raw({ type: "application/json" }),
    (request, response, next) => {
      void handleResendWebhookHttp(request, response).catch(next);
    },
  );

  app.use(express.json({ limit: "6mb" }));
  app.use(express.urlencoded({ extended: false }));

  // Health endpoints
  app.get("/healthz", (_req, res) => {
    res.json(healthPayload());
  });

  app.get("/readyz", (_req, res) => {
    res.json({
      ...healthPayload(),
      checks: {
        memory: "ok",
        process: "ok",
      },
    });
  });

  app.use("/api", createVersionedApiRouter());

  app.all("/api/v1/inventory/*", (_req, res) => {
    res.status(501).json({
      ok: false,
      error: {
        code: "NOT_IMPLEMENTED",
        message: "inventory module scaffolded but not implemented yet.",
      },
      timestamp: new Date().toISOString(),
    });
  });

  // 404
  app.use((req, res) => {
    res.status(404).json({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `Route not found: ${req.method} ${req.originalUrl}`,
      },
      timestamp: new Date().toISOString(),
    });
  });

  // Error handler
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const message =
        error instanceof Error ? error.message : "Unexpected server error";
      console.error("[api-server] unhandled error:", error);
      captureServerException(error, {
        method: _req.method,
        path: _req.originalUrl,
        requestId: _req.header("x-request-id") ?? null,
      });
      res.status(500).json({
        ok: false,
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message,
        },
        timestamp: new Date().toISOString(),
      });
    },
  );

  return app;
}

async function start() {
  const app = createApp();
  const server = app.listen(apiServerConfig.port, apiServerConfig.host, () => {
    console.info("[api-server] started", {
      host: apiServerConfig.host,
      port: apiServerConfig.port,
      env: apiServerConfig.env,
    });
  });

  const shutdown = (signal: NodeJS.Signals) => {
    console.info("[api-server] graceful shutdown started", { signal });
    server.close(async (err?: Error) => {
      if (err) {
        console.error("[api-server] graceful shutdown failed", err);
        process.exit(1);
      }
      await shutdownPlatformClients().catch((shutdownError) => {
        console.error("[api-server] platform shutdown failed", shutdownError);
      });
      await closeDbPool().catch((closeError) => {
        console.error("[api-server] database shutdown failed", closeError);
      });
      console.info("[api-server] graceful shutdown complete");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void start();
