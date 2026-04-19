import type { StorageScope } from "./storageScope";
import { readScopedStorageValue, writeScopedStorageValue } from "./storageScope";

export type GamePhase = 'auth' | 'lobby' | 'modeHall' | 'matching' | 'playing' | 'settings';

export interface GameSettings {
    playerName: string;
    avatarDataUrl: string;
    equippedSkinId: string;
    showFps: boolean;
    showMinimap: boolean;
    showLeaderboard: boolean;
    developerMode: boolean;
    reducedMotion: boolean;
}

interface LegacyGameSettingsShape extends Partial<GameSettings> {
    showDebugPanel?: boolean;
}

export const SETTINGS_STORAGE_KEY = 'bop:lobby-settings';

export const DEFAULT_GAME_SETTINGS: GameSettings = {
    playerName: '勇者球球',
    avatarDataUrl: '',
    equippedSkinId: 'classic_blue',
    showFps: true,
    showMinimap: true,
    showLeaderboard: true,
    developerMode: false,
    reducedMotion: false
};

export function mergeGameSettings(settings?: LegacyGameSettingsShape): GameSettings {
    const normalized: LegacyGameSettingsShape = {
        ...(settings ?? {})
    };

    if (normalized.developerMode === undefined && typeof normalized.showDebugPanel === 'boolean') {
        normalized.developerMode = normalized.showDebugPanel;
    }

    const safePlayerName = typeof normalized.playerName === 'string'
        ? normalized.playerName.trim().slice(0, 12)
        : DEFAULT_GAME_SETTINGS.playerName;

    const safeAvatarDataUrl = typeof normalized.avatarDataUrl === 'string'
        ? normalized.avatarDataUrl.slice(0, 2_000_000)
        : DEFAULT_GAME_SETTINGS.avatarDataUrl;

    const safeSkinId = typeof normalized.equippedSkinId === 'string' && normalized.equippedSkinId.trim().length > 0
        ? normalized.equippedSkinId.trim().slice(0, 32)
        : DEFAULT_GAME_SETTINGS.equippedSkinId;

    return {
        ...DEFAULT_GAME_SETTINGS,
        ...normalized,
        playerName: safePlayerName,
        avatarDataUrl: safeAvatarDataUrl,
        equippedSkinId: safeSkinId
    };
}

/**
 * Check if current user is a developer (from auth session).
 * Returns true if authService reports isDeveloper=true.
 */
function _isDeveloperUser(): boolean {
    try {
        const raw = typeof window !== 'undefined'
            ? window.localStorage.getItem('bop:auth-session')
            : null;
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return parsed.isDeveloper === true;
    } catch {
        return false;
    }
}

/** Minimum match time (seconds) before a non-developer can exit. */
export const MIN_EXIT_TIME_SECONDS = 6 * 60; // 6 minutes

export function getCurrentMinExitTimeSeconds(): number {
    try {
        const raw = typeof window !== 'undefined'
            ? window.localStorage.getItem('bop:auth-session')
            : null;
        if (!raw) {
            return MIN_EXIT_TIME_SECONDS;
        }
        const parsed = JSON.parse(raw) as {
            playtimePolicy?: {
                requiredSeconds?: number;
            };
        };
        const configuredSeconds = parsed.playtimePolicy?.requiredSeconds;
        return typeof configuredSeconds === 'number' && configuredSeconds >= 0
            ? configuredSeconds
            : MIN_EXIT_TIME_SECONDS;
    } catch {
        return MIN_EXIT_TIME_SECONDS;
    }
}

export function loadGameSettings(scope?: StorageScope): GameSettings {
    try {
        const raw = readScopedStorageValue(SETTINGS_STORAGE_KEY, { scope });
        if (!raw) {
            return {
                ...DEFAULT_GAME_SETTINGS,
                developerMode: _isDeveloperUser(),
            };
        }

        const parsed = JSON.parse(raw) as LegacyGameSettingsShape;
        const merged = mergeGameSettings(parsed);
        // Developer accounts always get dev mode enabled (opt-in not needed).
        // Regular players must re-enable on each page load.
        if (_isDeveloperUser()) {
            return { ...merged, developerMode: true };
        }
        return {
            ...merged,
            developerMode: false
        };
    } catch (error) {
        console.error('Failed to load game settings:', error);
        return { ...DEFAULT_GAME_SETTINGS };
    }
}

export function saveGameSettings(
    settings: GameSettings,
    scope?: StorageScope
) {
    try {
        writeScopedStorageValue(SETTINGS_STORAGE_KEY, JSON.stringify(settings), scope);
    } catch (error) {
        console.error('Failed to save game settings:', error);
    }
}
