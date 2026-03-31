import * as Sentry from "@sentry/browser";
import posthog from "posthog-js";
import { clientPlatformConfig } from "./config";

let telemetryInitialized = false;

export function initializeClientTelemetry(): void {
  if (telemetryInitialized) {
    return;
  }
  telemetryInitialized = true;

  if (clientPlatformConfig.posthog.enabled && clientPlatformConfig.posthog.apiKey) {
    posthog.init(clientPlatformConfig.posthog.apiKey, {
      api_host: clientPlatformConfig.posthog.host,
      defaults: "2026-01-30",
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true,
      person_profiles: "identified_only",
    });
  }

  if (clientPlatformConfig.sentry.enabled && clientPlatformConfig.sentry.dsn) {
    Sentry.init({
      dsn: clientPlatformConfig.sentry.dsn,
      environment: clientPlatformConfig.sentry.environment,
      tracesSampleRate: clientPlatformConfig.sentry.tracesSampleRate,
    });
  }
}

export function identifyClientUser(params: {
  userId: string;
  gameId?: string;
  nickname?: string;
}): void {
  if (clientPlatformConfig.posthog.enabled) {
    posthog.identify(params.userId, {
      gameId: params.gameId ?? null,
      nickname: params.nickname ?? null,
    });
  }

  if (clientPlatformConfig.sentry.enabled) {
    Sentry.setUser({
      id: params.userId,
      username: params.nickname,
    });
  }
}

export function clearClientUser(): void {
  if (clientPlatformConfig.posthog.enabled) {
    posthog.reset();
  }

  if (clientPlatformConfig.sentry.enabled) {
    Sentry.setUser(null);
  }
}

export function captureClientEvent(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!clientPlatformConfig.posthog.enabled) {
    return;
  }

  posthog.capture(event, properties ?? {});
}

export function captureClientException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (clientPlatformConfig.sentry.enabled) {
    Sentry.captureException(error, {
      extra: context,
    });
  }

  if (clientPlatformConfig.posthog.enabled && error instanceof Error) {
    posthog.captureException(error, context ?? {});
  }
}
