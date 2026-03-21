export type GamePhase = 'lobby' | 'modeHall' | 'matching' | 'playing' | 'settings';

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

export function loadGameSettings(): GameSettings {
    try {
        const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!raw) {
            return { ...DEFAULT_GAME_SETTINGS };
        }

        const parsed = JSON.parse(raw) as LegacyGameSettingsShape;
        const merged = mergeGameSettings(parsed);
        // Keep developer mode opt-in on every fresh page load.
        return {
            ...merged,
            developerMode: false
        };
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
