import './style.css';
import {
    loadGameSettings,
    mergeGameSettings,
    saveGameSettings
} from './app/settings';
import type { GamePhase, GameSettings } from './app/settings';
import { createGameSession, type GameSession } from './game/createGameSession';
import {
    applyGameplayTuningPatch,
    cloneGameplayTuning,
    resetGameplayTuningToDefaults,
    saveGameplayTuningToStorage,
    type GameplayTuningPatch
} from './gameplay/tuning';
import { LobbyUI, type LobbyModeId } from './ui/LobbyUI';

declare global {
    interface Window {
        render_game_to_text: () => string;
        advanceTime: (ms: number) => void;
        export_gameplay_tuning: () => string;
        apply_gameplay_tuning: (patch: GameplayTuningPatch | string) => string;
        reset_gameplay_tuning: () => string;
    }
}

const appRoot = document.createElement('div');
appRoot.className = 'app-root';

const gameMount = document.createElement('div');
gameMount.className = 'game-mount';

const overlayMount = document.createElement('div');
overlayMount.className = 'overlay-mount';

appRoot.append(gameMount, overlayMount);
document.body.appendChild(appRoot);

let phase: GamePhase = 'lobby';
let settings: GameSettings = loadGameSettings();
let currentSession: GameSession | null = null;

function applyReducedMotionState() {
    document.documentElement.dataset.reducedMotion = String(settings.reducedMotion);
    appRoot.dataset.phase = phase;
}

function syncSettings(nextSettings: GameSettings) {
    settings = mergeGameSettings(nextSettings);
    saveGameSettings(settings);
    applyReducedMotionState();
    lobbyUI.setSettings(settings);
    currentSession?.applySettings(settings);
}

function destroyCurrentSession() {
    currentSession?.destroy();
    currentSession = null;
}

function showLobby() {
    destroyCurrentSession();
    phase = 'lobby';
    lobbyUI.showLobby();
    applyReducedMotionState();
}

function openSettings(modalOnly: boolean) {
    phase = 'settings';
    lobbyUI.openSettings(modalOnly);
    applyReducedMotionState();
}

function closeSettings() {
    phase = currentSession ? 'playing' : 'lobby';
    if (currentSession) {
        lobbyUI.hideAll();
    } else {
        lobbyUI.showLobby();
    }
    applyReducedMotionState();
}

function startNewGame(modeId: LobbyModeId = 'classic') {
    destroyCurrentSession();

    currentSession = createGameSession({
        settings,
        modeId,
        onReturnToLobby: showLobby,
        onOpenSettings: () => openSettings(true)
    });

    currentSession.mount(gameMount);
    currentSession.startNewGame();

    phase = 'playing';
    lobbyUI.hideAll();
    applyReducedMotionState();
}

const lobbyUI = new LobbyUI({
    settings,
    onStartGame: startNewGame,
    onSettingsChange: syncSettings,
    onSettingsOpened: () => {
        phase = 'settings';
        applyReducedMotionState();
    },
    onSettingsClosed: closeSettings
});

lobbyUI.mount(overlayMount);
lobbyUI.showLobby();
applyReducedMotionState();

window.render_game_to_text = () => {
    const payload = {
        phase,
        isPlaying: currentSession !== null,
        playerName: settings.playerName,
        settings: {
            showFps: settings.showFps,
            showMinimap: settings.showMinimap,
            showLeaderboard: settings.showLeaderboard,
            developerMode: settings.developerMode,
            reducedMotion: settings.reducedMotion
        },
        session: currentSession?.getSnapshot() ?? null
    };

    return JSON.stringify(payload);
};

window.advanceTime = (ms: number) => {
    if (!currentSession) {
        return;
    }

    currentSession.advanceTime(ms);
};

window.export_gameplay_tuning = () => JSON.stringify(cloneGameplayTuning(), null, 2);

window.apply_gameplay_tuning = (patch: GameplayTuningPatch | string) => {
    let nextPatch: GameplayTuningPatch;

    if (typeof patch === 'string') {
        nextPatch = JSON.parse(patch) as GameplayTuningPatch;
    } else {
        nextPatch = patch;
    }

    applyGameplayTuningPatch(nextPatch);
    saveGameplayTuningToStorage();
    return window.export_gameplay_tuning();
};

window.reset_gameplay_tuning = () => {
    resetGameplayTuningToDefaults();
    return window.export_gameplay_tuning();
};
