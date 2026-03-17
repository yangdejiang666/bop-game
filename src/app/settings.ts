export type GamePhase = 'lobby' | 'playing' | 'settings';

export interface GameSettings {
    playerName: string;
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

    return {
        ...DEFAULT_GAME_SETTINGS,
        ...normalized
    };
}

export function loadGameSettings(): GameSettings {
    try {
        const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!raw) {
            return { ...DEFAULT_GAME_SETTINGS };
        }

        const parsed = JSON.parse(raw) as LegacyGameSettingsShape;
        return mergeGameSettings(parsed);
    } catch (error) {
        console.error('Failed to load game settings:', error);
        return { ...DEFAULT_GAME_SETTINGS };
    }
}

export function saveGameSettings(settings: GameSettings) {
    try {
        window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
        console.error('Failed to save game settings:', error);
    }
}
