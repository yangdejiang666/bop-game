import type { StorageScope } from "./storageScope";
import { readScopedStorageValue, writeScopedStorageValue } from "./storageScope";
import { loadPlayerProgression, savePlayerProgression } from "./progression";

export const BEST_MASS_RECORD_KEY = "bop:best-mass-record";

export function loadBestMassRecord(scope?: StorageScope): number {
  try {
    const raw = readScopedStorageValue(BEST_MASS_RECORD_KEY, { scope });
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    const progressionBest = loadPlayerProgression(scope).bestMass;
    const localBest = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    return Math.max(localBest, progressionBest);
  } catch {
    return 0;
  }
}

export function saveBestMassRecord(value: number, scope?: StorageScope) {
  try {
    const safeValue = Math.max(0, Math.floor(value));
    writeScopedStorageValue(BEST_MASS_RECORD_KEY, String(safeValue), scope);
    const progression = loadPlayerProgression(scope);
    if (safeValue > progression.bestMass) {
      progression.bestMass = safeValue;
      savePlayerProgression(progression, scope);
    }
  } catch (error) {
    console.error("Failed to persist best mass record:", error);
  }
}
