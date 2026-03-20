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
import {
    loadPlayerProgression,
    resetPlayerProgression,
    setPlayerProgression,
    type PlayerProgression
} from './app/progression';
import { LobbyUI, type LobbyModeId } from './ui/LobbyUI';
import { MatchmakingUI } from './ui/MatchmakingUI';

declare global {
    interface Window {
        render_game_to_text: () => string;
        advanceTime: (ms: number) => void;
        export_gameplay_tuning: () => string;
        apply_gameplay_tuning: (patch: GameplayTuningPatch | string) => string;
        reset_gameplay_tuning: () => string;
        debug_finish_match: (mode?: 'auto' | 'win' | 'lose' | 'record') => string;
        debug_set_best_record: (value: number) => string;
        debug_reset_progression: () => string;
        debug_set_progression: (payload: Partial<PlayerProgression> | string) => string;
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
let pendingModeForMatch: LobbyModeId | null = null;

function applyReducedMotionState() {
    document.documentElement.dataset.reducedMotion = String(settings.reducedMotion);
    appRoot.dataset.phase = phase;
}

function syncSettings(nextSettings: GameSettings) {
    settings = mergeGameSettings(nextSettings);
    saveGameSettings(settings);
    applyReducedMotionState();
    lobbyUI.setSettings(settings);
    matchmakingUI.setSettings(settings);
    currentSession?.applySettings(settings);
}

function destroyCurrentSession() {
    currentSession?.destroy();
    currentSession = null;
}

function showLobby() {
    destroyCurrentSession();
    pendingModeForMatch = null;
    matchmakingUI.hide(true);
    phase = 'lobby';
    lobbyUI.refreshProgression();
    lobbyUI.showLobby();
    applyReducedMotionState();
}

function openSettings(modalOnly: boolean) {
    phase = 'settings';
    lobbyUI.openSettings(modalOnly);
    applyReducedMotionState();
}

function closeSettings() {
    if (currentSession) {
        phase = 'playing';
        lobbyUI.hideAll();
    } else if (matchmakingUI.isActive()) {
        phase = 'matching';
        lobbyUI.hideAll();
    } else {
        phase = 'lobby';
        lobbyUI.showLobby();
    }
    applyReducedMotionState();
}

function launchGame(modeId: LobbyModeId = 'classic') {
    destroyCurrentSession();
    pendingModeForMatch = null;
    matchmakingUI.hide(true);

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

function startMatchmaking(modeId: LobbyModeId = 'classic') {
    destroyCurrentSession();
    pendingModeForMatch = modeId;
    phase = 'matching';
    lobbyUI.hideAll();
    matchmakingUI.start(modeId);
    applyReducedMotionState();
}

const matchmakingUI = new MatchmakingUI({
    settings,
    onMatchReady: (modeId) => {
        launchGame(modeId);
    },
    onCancelled: () => {
        showLobby();
    }
});

const lobbyUI = new LobbyUI({
    settings,
    onStartGame: startMatchmaking,
    onSettingsChange: syncSettings,
    onSettingsOpened: () => {
        phase = 'settings';
        applyReducedMotionState();
    },
    onSettingsClosed: closeSettings
});

matchmakingUI.mount(overlayMount);
lobbyUI.mount(overlayMount);
lobbyUI.showLobby();
applyReducedMotionState();

window.render_game_to_text = () => {
    const payload = {
        phase,
        isPlaying: currentSession !== null,
        playerName: settings.playerName,
        progression: loadPlayerProgression(),
        settings: {
            showFps: settings.showFps,
            showMinimap: settings.showMinimap,
            showLeaderboard: settings.showLeaderboard,
            developerMode: settings.developerMode,
            reducedMotion: settings.reducedMotion
        },
        matching: matchmakingUI.getSnapshot(),
        pendingModeForMatch,
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

window.debug_finish_match = (mode = 'auto') => {
    if (!currentSession) {
        return window.render_game_to_text();
    }

    if (mode === 'win') {
        currentSession.debugFinishMatch({ winner: 'player', subtitle: 'Console 调试：强制我方胜利。' });
    } else if (mode === 'lose') {
        currentSession.debugFinishMatch({ winner: 'bot', subtitle: 'Console 调试：强制我方失败。' });
    } else if (mode === 'record') {
        const snapshot = currentSession.getSnapshot();
        const previewMass = Math.max(snapshot.playerMass, snapshot.match.bestMassRecord + 500);
        currentSession.debugFinishMatch({
            winner: 'player',
            playerMass: previewMass,
            forceNewRecord: true,
            subtitle: 'Console 调试：新纪录庆祝预览。'
        });
    } else {
        currentSession.debugFinishMatch();
    }

    return window.render_game_to_text();
};

window.debug_set_best_record = (value: number) => {
    if (currentSession) {
        currentSession.debugSetBestMassRecord(value);
    } else if (Number.isFinite(value)) {
        setPlayerProgression({ bestMass: Math.max(0, Math.floor(value)) });
    }
    lobbyUI.refreshProgression();
    return window.render_game_to_text();
};

window.debug_reset_progression = () => {
    resetPlayerProgression();
    lobbyUI.refreshProgression();
    return window.render_game_to_text();
};

window.debug_set_progression = (payload: Partial<PlayerProgression> | string) => {
    let patch: Partial<PlayerProgression>;
    if (typeof payload === 'string') {
        patch = JSON.parse(payload) as Partial<PlayerProgression>;
    } else {
        patch = payload;
    }
    setPlayerProgression(patch);
    lobbyUI.refreshProgression();
    return window.render_game_to_text();
};
