import type { StorageScope } from "./storageScope";
import {
  readScopedStorageValue,
  writeScopedStorageValue,
} from "./storageScope";
import {
  DEFAULT_PLAYER_PROGRESSION,
  applyMatchRewardsToProgression,
  clonePlayerProgression,
  computeMatchRewards,
  getRequiredXpForLevel,
  sanitizePlayerProgression,
  type MatchRewardBreakdown,
  type PlayerProgression,
  type ProgressionApplyResult,
} from "../../shared-protocol/src/progression";

export const PROGRESSION_STORAGE_KEY = "bop:player-progression";

export {
  DEFAULT_PLAYER_PROGRESSION,
  applyMatchRewardsToProgression,
  clonePlayerProgression,
  computeMatchRewards,
  getRequiredXpForLevel,
  sanitizePlayerProgression,
};

export type {
  MatchRewardBreakdown,
  PlayerProgression,
  ProgressionApplyResult,
};

export function loadPlayerProgression(scope?: StorageScope): PlayerProgression {
  try {
    const raw = readScopedStorageValue(PROGRESSION_STORAGE_KEY, { scope });
    if (!raw) {
      return clonePlayerProgression(DEFAULT_PLAYER_PROGRESSION);
    }
    const parsed = JSON.parse(raw) as Partial<PlayerProgression>;
    return sanitizePlayerProgression(parsed);
  } catch (error) {
    console.error("Failed to load player progression:", error);
    return clonePlayerProgression(DEFAULT_PLAYER_PROGRESSION);
  }
}

export function savePlayerProgression(
  progression: PlayerProgression,
  scope?: StorageScope,
) {
  try {
    const safe = sanitizePlayerProgression(progression);
    writeScopedStorageValue(PROGRESSION_STORAGE_KEY, JSON.stringify(safe), scope);
  } catch (error) {
    console.error("Failed to save player progression:", error);
  }
}

export function resetPlayerProgression(scope?: StorageScope): PlayerProgression {
  const fresh = clonePlayerProgression(DEFAULT_PLAYER_PROGRESSION);
  savePlayerProgression(fresh, scope);
  return fresh;
}

export function setPlayerProgression(
  next: Partial<PlayerProgression>,
  scope?: StorageScope,
): PlayerProgression {
  const merged = sanitizePlayerProgression({
    ...loadPlayerProgression(scope),
    ...next,
  });
  savePlayerProgression(merged, scope);
  return merged;
}
