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
import { ModeHallUI, type RoomAction } from './ui/ModeHallUI';
import type { ModeHallTabId } from './modes/definitions';

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
        debug_set_mode: (modeId: LobbyModeId) => string;
        debug_open_mode_hall: (modeId: LobbyModeId, tabId?: ModeHallTabId) => string;
        debug_room_simulate: (action: RoomAction, payload?: string) => string;
        debug_set_zone: (stage: number) => string;
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
let activeModeHall: LobbyModeId | null = null;
let activeModeHallTab: ModeHallTabId = 'rules';

function applyReducedMotionState() {
    document.documentElement.dataset.reducedMotion = String(settings.reducedMotion);
    appRoot.dataset.phase = phase;
}

function syncSettings(nextSettings: GameSettings) {
    settings = mergeGameSettings(nextSettings);
    saveGameSettings(settings);
    applyReducedMotionState();
    lobbyUI.setSettings(settings);
    modeHallUI.setSettings(settings);
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
    activeModeHall = null;
    matchmakingUI.hide(true);
    modeHallUI.hide();
    phase = 'lobby';
    lobbyUI.refreshProgression();
    lobbyUI.showLobby();
    applyReducedMotionState();
}

function isLobbyModeId(value: string): value is LobbyModeId {
    return value === 'ranked'
        || value === 'peak'
        || value === 'classic'
        || value === 'speed'
        || value === 'team'
        || value === 'battleRoyale';
}

function isModeHallTabId(value: string): value is ModeHallTabId {
    return value === 'rules' || value === 'rewards' || value === 'stats' || value === 'map';
}

function showModeHall(modeId: LobbyModeId, tabId: ModeHallTabId = 'rules') {
    destroyCurrentSession();
    pendingModeForMatch = modeId;
    activeModeHall = modeId;
    activeModeHallTab = tabId;
    matchmakingUI.hide(true);
    lobbyUI.hideAll();
    modeHallUI.show(modeId, tabId);
    phase = 'modeHall';
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
    } else if (activeModeHall) {
        phase = 'modeHall';
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
    activeModeHall = modeId;
    matchmakingUI.hide(true);
    modeHallUI.hide();

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
    activeModeHall = modeId;
    phase = 'matching';
    lobbyUI.hideAll();
    modeHallUI.hide();
    matchmakingUI.start(modeId);
    applyReducedMotionState();
}

const matchmakingUI = new MatchmakingUI({
    settings,
    onMatchReady: (modeId) => {
        launchGame(modeId);
    },
    onCancelled: () => {
        if (pendingModeForMatch) {
            showModeHall(pendingModeForMatch, activeModeHallTab);
            return;
        }
        showLobby();
    }
});

const modeHallUI = new ModeHallUI({
    settings,
    onBackLobby: () => {
        showLobby();
    },
    onOpenSettings: () => {
        openSettings(true);
    },
    onStartMatch: (modeId) => {
        startMatchmaking(modeId);
    }
});

const lobbyUI = new LobbyUI({
    settings,
    onOpenModeHall: (modeId) => {
        showModeHall(modeId, 'rules');
    },
    onSettingsChange: syncSettings,
    onSettingsOpened: () => {
        phase = 'settings';
        applyReducedMotionState();
    },
    onSettingsClosed: closeSettings
});

matchmakingUI.mount(overlayMount);
modeHallUI.mount(overlayMount);
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
        modeHall: modeHallUI.getSnapshot(),
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

window.debug_set_mode = (modeId: LobbyModeId) => {
    if (!isLobbyModeId(modeId)) {
        return window.render_game_to_text();
    }
    showModeHall(modeId, 'rules');
    return window.render_game_to_text();
};

window.debug_open_mode_hall = (modeId: LobbyModeId, tabId: ModeHallTabId = 'rules') => {
    if (!isLobbyModeId(modeId) || !isModeHallTabId(tabId)) {
        return window.render_game_to_text();
    }
    showModeHall(modeId, tabId);
    return window.render_game_to_text();
};

window.debug_room_simulate = (action: RoomAction, payload?: string) => {
    modeHallUI.simulateRoom(action, payload);
    return window.render_game_to_text();
};

window.debug_set_zone = (stage: number) => {
    if (currentSession && Number.isFinite(stage)) {
        currentSession.debugSetBattleZone(Math.max(0, Number(stage)));
    }
    return window.render_game_to_text();
};
