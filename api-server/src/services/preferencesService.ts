import {
  DEFAULT_USER_PREFERENCES,
  type SyncUserPreferencesResponse,
  type UserPreferences,
  type UserPreferencesPatch,
} from "@bop/shared-protocol";
import { PROTOCOL_ERROR } from "@bop/shared-protocol";
import { DomainError } from "../lib/domainError.js";
import {
  getOrCreateUserPreferences,
  saveUserPreferences,
} from "../repositories/preferencesRepository.js";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ensureObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError(
      PROTOCOL_ERROR.PREFERENCES_INVALID_PATCH,
      "preferences patch must be an object.",
      400,
    );
  }
  return value as Record<string, unknown>;
}

function sanitizeString(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed.length > 0 ? trimmed : fallback;
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function sanitizeNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  digits = 2,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Number(clamp(value, min, max).toFixed(digits));
}

function mergePreferences(
  current: UserPreferences,
  patch: UserPreferencesPatch,
): UserPreferences {
  return {
    ...current,
    controls: {
      ...current.controls,
      ...(patch.controls
        ? {
            joystickHandedness:
              patch.controls.joystickHandedness === "left" ||
              patch.controls.joystickHandedness === "right" ||
              patch.controls.joystickHandedness === "dynamic"
                ? patch.controls.joystickHandedness
                : current.controls.joystickHandedness,
            joystickSize: sanitizeNumber(
              patch.controls.joystickSize,
              current.controls.joystickSize,
              0.6,
              1.6,
            ),
            joystickOpacity: sanitizeNumber(
              patch.controls.joystickOpacity,
              current.controls.joystickOpacity,
              0.2,
              1,
            ),
            skillButtonsMirrored: sanitizeBoolean(
              patch.controls.skillButtonsMirrored,
              current.controls.skillButtonsMirrored,
            ),
            splitTapConfirm: sanitizeBoolean(
              patch.controls.splitTapConfirm,
              current.controls.splitTapConfirm,
            ),
            ejectTapHold: sanitizeBoolean(
              patch.controls.ejectTapHold,
              current.controls.ejectTapHold,
            ),
            vibrationEnabled: sanitizeBoolean(
              patch.controls.vibrationEnabled,
              current.controls.vibrationEnabled,
            ),
          }
        : {}),
    },
    graphics: {
      ...current.graphics,
      ...(patch.graphics
        ? {
            qualityPreset:
              patch.graphics.qualityPreset === "low" ||
              patch.graphics.qualityPreset === "medium" ||
              patch.graphics.qualityPreset === "high" ||
              patch.graphics.qualityPreset === "ultra"
                ? patch.graphics.qualityPreset
                : current.graphics.qualityPreset,
            renderScale: sanitizeNumber(
              patch.graphics.renderScale,
              current.graphics.renderScale,
              0.5,
              1.5,
            ),
            particlesEnabled: sanitizeBoolean(
              patch.graphics.particlesEnabled,
              current.graphics.particlesEnabled,
            ),
            screenShakeEnabled: sanitizeBoolean(
              patch.graphics.screenShakeEnabled,
              current.graphics.screenShakeEnabled,
            ),
            colorfulVfxEnabled: sanitizeBoolean(
              patch.graphics.colorfulVfxEnabled,
              current.graphics.colorfulVfxEnabled,
            ),
            showFps: sanitizeBoolean(
              patch.graphics.showFps,
              current.graphics.showFps,
            ),
            showMinimap: sanitizeBoolean(
              patch.graphics.showMinimap,
              current.graphics.showMinimap,
            ),
            showLeaderboard: sanitizeBoolean(
              patch.graphics.showLeaderboard,
              current.graphics.showLeaderboard,
            ),
            reducedMotion: sanitizeBoolean(
              patch.graphics.reducedMotion,
              current.graphics.reducedMotion,
            ),
          }
        : {}),
    },
    keybinds: {
      ...current.keybinds,
      ...(patch.keybinds
        ? {
            split: sanitizeString(patch.keybinds.split, current.keybinds.split, 24),
            eject: sanitizeString(patch.keybinds.eject, current.keybinds.eject, 24),
            boost: sanitizeString(patch.keybinds.boost, current.keybinds.boost, 24),
            ping: sanitizeString(patch.keybinds.ping, current.keybinds.ping, 24),
          }
        : {}),
    },
    ui: {
      ...current.ui,
      ...(patch.ui
        ? {
            language: sanitizeString(patch.ui.language, current.ui.language, 16),
            compactLobby: sanitizeBoolean(
              patch.ui.compactLobby,
              current.ui.compactLobby,
            ),
            safeAreaInsetCompensation: sanitizeBoolean(
              patch.ui.safeAreaInsetCompensation,
              current.ui.safeAreaInsetCompensation,
            ),
            preferredModeId: sanitizeString(
              patch.ui.preferredModeId,
              current.ui.preferredModeId,
              32,
            ),
            preferredQueueId: sanitizeString(
              patch.ui.preferredQueueId,
              current.ui.preferredQueueId,
              32,
            ),
          }
        : {}),
    },
    accessibility: {
      ...current.accessibility,
      ...(patch.accessibility
        ? {
            highContrast: sanitizeBoolean(
              patch.accessibility.highContrast,
              current.accessibility.highContrast,
            ),
            largerText: sanitizeBoolean(
              patch.accessibility.largerText,
              current.accessibility.largerText,
            ),
            colorAssist: sanitizeBoolean(
              patch.accessibility.colorAssist,
              current.accessibility.colorAssist,
            ),
            subtitleEnabled: sanitizeBoolean(
              patch.accessibility.subtitleEnabled,
              current.accessibility.subtitleEnabled,
            ),
          }
        : {}),
    },
    updatedAt: new Date().toISOString(),
  };
}

export async function getUserPreferences(userId: string): Promise<UserPreferences> {
  return getOrCreateUserPreferences(userId);
}

export async function syncUserPreferences(params: {
  userId: string;
  patch: UserPreferencesPatch;
}): Promise<SyncUserPreferencesResponse> {
  ensureObject(params.patch ?? {});
  const current = await getOrCreateUserPreferences(params.userId);
  const next = mergePreferences(
    {
      ...DEFAULT_USER_PREFERENCES,
      ...current,
    },
    params.patch,
  );

  return {
    preferences: await saveUserPreferences(params.userId, next),
    updated: true,
  };
}
