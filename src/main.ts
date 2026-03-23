import "./style.css";
import "./lobby-stitch-hotfix.css";
import {
  DEFAULT_GAME_SETTINGS,
  loadGameSettings,
  mergeGameSettings,
  saveGameSettings,
  SETTINGS_STORAGE_KEY,
} from "./app/settings";
import type { GamePhase, GameSettings } from "./app/settings";
import {
  getStorageScopeForUser,
  hasScopedStorageValue,
  setActiveStorageScopeForUser,
} from "./app/storageScope";
import { createGameSession, type GameSession } from "./game/createGameSession";
import {
  applyGameplayTuningPatch,
  cloneGameplayTuning,
  resetGameplayTuningToDefaults,
  saveGameplayTuningToStorage,
  type GameplayTuningPatch,
} from "./gameplay/tuning";
import {
  loadPlayerProgression,
  resetPlayerProgression,
  savePlayerProgression,
  setPlayerProgression,
  PROGRESSION_STORAGE_KEY,
  type PlayerProgression,
} from "./app/progression";
import { loadBestMassRecord, saveBestMassRecord, BEST_MASS_RECORD_KEY } from "./app/bestMassRecord";
import {
  LobbyUI,
  type LobbyAuthStatus,
  type LobbyLoginPayload,
  type LobbyModeId,
  type LobbyRegisterPayload,
} from "./ui/LobbyUI";
import { MatchmakingUI } from "./ui/MatchmakingUI";
import { ModeHallUI, type RoomAction } from "./ui/ModeHallUI";
import type { ModeHallTabId } from "./modes/definitions";
import { authService } from "./network/authService";
import { MatchmakingService } from "./network/matchmakingService";
import { progressionService } from "./network/progressionService";
import { roomService } from "./network/roomService";
import { userService } from "./network/userService";
import { networkConfig } from "./network/config";
import type { RoomSnapshot } from "../shared-protocol/src/room";
import type { ModeHallRoomSnapshot } from "./modes/definitions";
import type {
  DeveloperAccountsOverview,
  UserSummary,
} from "../shared-protocol/src/user";

declare global {
  interface Window {
    render_game_to_text: () => string;
    advanceTime: (ms: number) => void;
    export_gameplay_tuning: () => string;
    apply_gameplay_tuning: (patch: GameplayTuningPatch | string) => string;
    reset_gameplay_tuning: () => string;
    debug_finish_match: (mode?: "auto" | "win" | "lose" | "record") => string;
    debug_set_best_record: (value: number) => string;
    debug_reset_progression: () => string;
    debug_set_progression: (
      payload: Partial<PlayerProgression> | string,
    ) => string;
    debug_set_mode: (modeId: LobbyModeId) => string;
    debug_open_mode_hall: (
      modeId: LobbyModeId,
      tabId?: ModeHallTabId,
    ) => string;
    debug_room_simulate: (action: RoomAction, payload?: string) => string;
    debug_set_zone: (stage: number) => string;
    debug_backend_login_demo: () => Promise<string>;
    debug_backend_guest_login: (guestId?: string) => Promise<string>;
    debug_backend_logout: () => Promise<string>;
    debug_backend_match_start: (modeId?: LobbyModeId) => Promise<string>;
    debug_backend_match_cancel: () => Promise<string>;
    debug_backend_match_status: () => Promise<string>;
  }
}

const appRoot = document.createElement("div");
appRoot.className = "app-root";

const gameMount = document.createElement("div");
gameMount.className = "game-mount";

const overlayMount = document.createElement("div");
overlayMount.className = "overlay-mount";

appRoot.append(gameMount, overlayMount);
document.body.appendChild(appRoot);

setActiveStorageScopeForUser(authService.getSession()?.userId ?? null);

let phase: GamePhase = authService.getSession() ? "lobby" : "auth";
let settings: GameSettings = loadGameSettings();
let currentSession: GameSession | null = null;
let pendingModeForMatch: LobbyModeId | null = null;
let activeModeHall: LobbyModeId | null = null;
let activeModeHallTab: ModeHallTabId = "rules";
let backendTicketId: string | null = null;
let backendPollTimerId: number | null = null;
let activeBackendRoomId: string | null = null;
let activeBackendRoomInviteCode: string | null = null;
let lastKnownBackendRoomId: string | null = null;
let lastKnownBackendRoomInviteCode: string | null = null;
let profileSyncTimerId: number | null = null;
let suppressRemoteProfileSync = false;
const backendMatchmaking = new MatchmakingService({
  baseUrl: networkConfig.apiBaseUrl,
  prepareAuth: () => authService.refreshToken(),
  getAccessToken: () => authService.getSession()?.accessToken ?? null,
  requestTimeoutMs: networkConfig.requestTimeoutMs,
});

function getAnonymousStorageScope() {
  return getStorageScopeForUser(null);
}

function toProfileProgression(summary: UserSummary): PlayerProgression {
  return {
    level: summary.profile.level,
    currentXp: summary.profile.currentXp,
    totalXp: summary.profile.totalXp,
    coins: summary.profile.coins,
    totalMatches: summary.profile.totalMatches,
    totalWins: summary.profile.totalWins,
    bestMass: summary.profile.bestMass,
  };
}

function getAuthStatusView(): LobbyAuthStatus {
  const session = authService.getSession();
  return {
    loggedIn: !!session,
    userLabel: session?.nickname ?? "游客",
    accountLabel: session?.userId ? `UID · ${session.userId}` : "本地试玩档",
  };
}

function applyLoadedSettings(nextSettings: GameSettings, persist = false) {
  settings = mergeGameSettings(nextSettings);
  if (persist) {
    saveGameSettings(settings);
  }
  applyReducedMotionState();
  lobbyUI.setSettings(settings);
  modeHallUI.setSettings(settings);
  matchmakingUI.setSettings(settings);
  currentSession?.applySettings(settings);
}

function cloneAnonymousStateIntoUserScope(userId: string) {
  const userScope = getStorageScopeForUser(userId);
  const anonymousScope = getAnonymousStorageScope();

  if (!hasScopedStorageValue(SETTINGS_STORAGE_KEY, userScope)) {
    saveGameSettings(loadGameSettings(anonymousScope), userScope);
  }
  if (!hasScopedStorageValue(PROGRESSION_STORAGE_KEY, userScope)) {
    savePlayerProgression(loadPlayerProgression(anonymousScope), userScope);
  }
  if (!hasScopedStorageValue(BEST_MASS_RECORD_KEY, userScope)) {
    saveBestMassRecord(loadBestMassRecord(anonymousScope), userScope);
  }
}

function applyUserSummaryToLocalState(
  summary: UserSummary,
  options?: {
    updateRuntimeSettings?: boolean;
  },
) {
  const userScope = getStorageScopeForUser(summary.user.id);
  const scopedSettings = loadGameSettings(userScope);
  const syncedSettings = mergeGameSettings({
    ...scopedSettings,
    playerName: summary.profile.nickname,
    avatarDataUrl: summary.profile.avatarUrl ?? "",
  });

  saveGameSettings(syncedSettings, userScope);
  savePlayerProgression(toProfileProgression(summary), userScope);
  saveBestMassRecord(summary.profile.bestMass, userScope);
  authService.updateSessionProfile(summary.user.id, summary.profile.nickname);

  if (options?.updateRuntimeSettings !== false) {
    setActiveStorageScopeForUser(summary.user.id);
    suppressRemoteProfileSync = true;
    applyLoadedSettings(syncedSettings);
    suppressRemoteProfileSync = false;
    lobbyUI.refreshProgression();
    lobbyUI.refreshAuthStatus();
    void lobbyUI.refreshDeveloperOverview(true);
  }
}

function buildAnonymousBootstrapPayload() {
  const anonymousScope = getAnonymousStorageScope();
  const anonymousSettings = loadGameSettings(anonymousScope);
  const anonymousProgression = loadPlayerProgression(anonymousScope);
  const anonymousBestMass = loadBestMassRecord(anonymousScope);

  return {
    source: "local_storage" as const,
    nickname:
      anonymousSettings.playerName.trim().length > 0 &&
      anonymousSettings.playerName.trim() !== DEFAULT_GAME_SETTINGS.playerName
        ? anonymousSettings.playerName.trim()
        : undefined,
    avatarUrl:
      anonymousSettings.avatarDataUrl.trim().length > 0
        ? anonymousSettings.avatarDataUrl
        : null,
    progression: {
      ...anonymousProgression,
      bestMass: Math.max(anonymousProgression.bestMass, anonymousBestMass),
    },
  };
}

async function syncAuthenticatedAccount(runBootstrap: boolean) {
  const me = await authService.getMe();
  if (!me.ok) {
    throw new Error(me.error.message);
  }

  let summary = me.data.summary;
  const session = authService.getSession();
  if (runBootstrap && session) {
    cloneAnonymousStateIntoUserScope(session.userId);
    const bootstrapped = await userService.bootstrapLocalProfile(
      buildAnonymousBootstrapPayload(),
    );
    summary = bootstrapped.summary;
  }

  applyUserSummaryToLocalState(summary);
}

async function loadDeveloperAccountsOverview(): Promise<DeveloperAccountsOverview | null> {
  if (!authService.getSession()) {
    return null;
  }

  const result = await userService.getDeveloperAccountsOverview();
  return result.overview;
}

function applyAnonymousScopeState() {
  setActiveStorageScopeForUser(null);
  suppressRemoteProfileSync = true;
  applyLoadedSettings(loadGameSettings(getAnonymousStorageScope()));
  suppressRemoteProfileSync = false;
  lobbyUI.refreshProgression();
  lobbyUI.refreshAuthStatus();
  void lobbyUI.refreshDeveloperOverview(true);
}

function clearBackendAccountState() {
  backendTicketId = null;
  activeBackendRoomId = null;
  activeBackendRoomInviteCode = null;
  lastKnownBackendRoomId = null;
  lastKnownBackendRoomInviteCode = null;
  stopBackendMatchmakingPolling();
  clearModeHallRoomSnapshot("私人模式链路待连接。");
}

async function logoutToAnonymousScope() {
  if (profileSyncTimerId !== null) {
    window.clearTimeout(profileSyncTimerId);
    profileSyncTimerId = null;
  }
  await authService.logout(false);
  clearBackendAccountState();
  applyAnonymousScopeState();
  showAuthGate();
}

function normalizeServerNickname(value: string): string {
  const safe = value.trim().slice(0, 12);
  return safe.length > 0 ? safe : "勇者球球";
}

async function syncRemoteProfile(nextSettings: GameSettings) {
  const session = authService.getSession();
  if (!session) {
    return;
  }

  const response = await authService.updateProfile({
    nickname: normalizeServerNickname(nextSettings.playerName),
    avatarUrl:
      nextSettings.avatarDataUrl.trim().length > 0
        ? nextSettings.avatarDataUrl
        : null,
  });

  if (!response.ok) {
    throw new Error(response.error.message);
  }

  const userScope = getStorageScopeForUser(session.userId);
  const syncedSettings = mergeGameSettings({
    ...loadGameSettings(userScope),
    playerName: response.data.profile.nickname,
    avatarDataUrl: response.data.profile.avatarUrl ?? "",
  });
  saveGameSettings(syncedSettings, userScope);

  suppressRemoteProfileSync = true;
  applyLoadedSettings(syncedSettings);
  suppressRemoteProfileSync = false;
  lobbyUI.refreshAuthStatus();
}

function queueRemoteProfileSync(
  previousSettings: GameSettings,
  nextSettings: GameSettings,
) {
  if (suppressRemoteProfileSync || !authService.getSession()) {
    return;
  }

  const profileChanged =
    previousSettings.playerName !== nextSettings.playerName ||
    previousSettings.avatarDataUrl !== nextSettings.avatarDataUrl;
  if (!profileChanged) {
    return;
  }

  if (profileSyncTimerId !== null) {
    window.clearTimeout(profileSyncTimerId);
  }

  profileSyncTimerId = window.setTimeout(() => {
    void syncRemoteProfile(nextSettings).catch((error) => {
      console.error("Failed to sync profile to backend:", error);
    });
    profileSyncTimerId = null;
  }, 500);
}

async function handleCloudMatchCompletion(payload: {
  clientMatchId: string;
  modeId: LobbyModeId;
  playerRank: number;
  playerMass: number;
  playerWon: boolean;
  finishedAt: string;
}) {
  const result = await progressionService.completeMatch(payload);
  applyUserSummaryToLocalState(result.summary, {
    updateRuntimeSettings: false,
  });
  return result;
}

function applyReducedMotionState() {
  document.documentElement.dataset.reducedMotion = String(
    settings.reducedMotion,
  );
  appRoot.dataset.phase = phase;
}

function syncSettings(nextSettings: GameSettings) {
  const previousSettings = settings;
  applyLoadedSettings(nextSettings, true);
  queueRemoteProfileSync(previousSettings, settings);
}

function destroyCurrentSession() {
  currentSession?.destroy();
  currentSession = null;
}

function showAuthGate() {
  destroyCurrentSession();
  pendingModeForMatch = null;
  activeModeHall = null;
  matchmakingUI.hide(true);
  modeHallUI.hide();
  phase = "auth";
  lobbyUI.refreshProgression();
  lobbyUI.showAuthGate();
  applyReducedMotionState();
}

function requireAuthenticatedSession() {
  if (authService.getSession()) {
    return true;
  }

  showAuthGate();
  return false;
}

function showLobby() {
  if (!authService.getSession()) {
    showAuthGate();
    return;
  }

  destroyCurrentSession();
  pendingModeForMatch = null;
  activeModeHall = null;
  matchmakingUI.hide(true);
  modeHallUI.hide();
  phase = "lobby";
  lobbyUI.refreshProgression();
  lobbyUI.showLobby();
  applyReducedMotionState();
}

function isLobbyModeId(value: string): value is LobbyModeId {
  return (
    value === "ranked" ||
    value === "peak" ||
    value === "classic" ||
    value === "speed" ||
    value === "team" ||
    value === "battleRoyale"
  );
}

function isModeHallTabId(value: string): value is ModeHallTabId {
  return value === "rules" || value === "rewards" || value === "map";
}

function showModeHall(modeId: LobbyModeId, tabId: ModeHallTabId = "rules") {
  if (!requireAuthenticatedSession()) {
    return;
  }

  destroyCurrentSession();
  pendingModeForMatch = modeId;
  activeModeHall = modeId;
  activeModeHallTab = tabId;
  matchmakingUI.hide(true);
  lobbyUI.hideAll();
  modeHallUI.show(modeId, tabId);
  phase = "modeHall";
  applyReducedMotionState();
}

function openSettings(modalOnly: boolean) {
  if (!requireAuthenticatedSession()) {
    return;
  }

  phase = "settings";
  lobbyUI.openSettings(modalOnly);
  applyReducedMotionState();
}

function closeSettings() {
  if (!authService.getSession()) {
    showAuthGate();
    return;
  }

  if (currentSession) {
    phase = "playing";
    lobbyUI.hideAll();
  } else if (matchmakingUI.isActive()) {
    phase = "matching";
    lobbyUI.hideAll();
  } else if (activeModeHall) {
    phase = "modeHall";
    lobbyUI.hideAll();
  } else {
    phase = "lobby";
    lobbyUI.showLobby();
  }
  applyReducedMotionState();
}

function launchGame(modeId: LobbyModeId = "classic") {
  if (!requireAuthenticatedSession()) {
    return;
  }

  destroyCurrentSession();
  pendingModeForMatch = null;
  activeModeHall = modeId;
  matchmakingUI.hide(true);
  modeHallUI.hide();

  currentSession = createGameSession({
    settings,
    modeId,
    onReturnToLobby: showLobby,
    onOpenSettings: () => openSettings(true),
    onCompleteMatch: authService.getSession()
      ? (payload) => handleCloudMatchCompletion(payload)
      : undefined,
  });

  currentSession.mount(gameMount);
  currentSession.startNewGame();

  phase = "playing";
  lobbyUI.hideAll();
  applyReducedMotionState();
}

function mapBackendRoomToModeHallSnapshot(
  room: RoomSnapshot,
  message?: string,
): ModeHallRoomSnapshot {
  return {
    created: room.status !== "closed",
    code: room.inviteCode ?? room.roomId.slice(-6).toUpperCase(),
    leaderId: room.ownerUserId,
    members: room.members.map((member) => ({
      id: member.userId,
      name: member.nickname,
      ready: member.ready,
      isBot: false,
    })),
    lastCheck:
      message ?? `房间同步成功 · ${room.members.length}/${room.maxMembers}`,
  };
}

function syncModeHallRoomSnapshot(
  room: RoomSnapshot,
  message?: string,
): ModeHallRoomSnapshot {
  activeBackendRoomId = room.roomId;
  activeBackendRoomInviteCode = room.inviteCode ?? null;
  lastKnownBackendRoomId = room.roomId;
  lastKnownBackendRoomInviteCode = room.inviteCode ?? null;
  const snapshot = mapBackendRoomToModeHallSnapshot(room, message);
  modeHallUI.setRoomSnapshot(snapshot);
  return snapshot;
}

function clearModeHallRoomSnapshot(message: string) {
  activeBackendRoomId = null;
  activeBackendRoomInviteCode = null;
  modeHallUI.clearRoomSnapshot(message);
}

async function handleModeHallRoomAction(
  action: RoomAction,
): Promise<ModeHallRoomSnapshot | null> {
  const session = authService.getSession();
  if (!session) {
    throw new Error("请先登录后再使用联网房间功能。");
  }

  const modeId = activeModeHall ?? pendingModeForMatch ?? "classic";

  if (action === "create") {
    const result = await roomService.createRoom({
      modeId,
      visibility: "private",
      maxMembers: 4,
      minStartMembers: 2,
      teamMode: modeId === "team" ? "team" : "solo",
    });
    return syncModeHallRoomSnapshot(result.room, "私人房间创建成功。");
  }

  if (action === "join") {
    if (activeBackendRoomId) {
      const snapshot = await roomService.getRoomSnapshot(activeBackendRoomId);
      return syncModeHallRoomSnapshot(snapshot.room, "已同步当前私人房间。");
    }

    const inviteCode =
      activeBackendRoomInviteCode ?? lastKnownBackendRoomInviteCode;
    if (inviteCode) {
      const joined = await roomService.joinRoom({
        inviteCode,
        joinType: "inviteCode",
      });
      return syncModeHallRoomSnapshot(joined.room, "加入私人房间成功。");
    }

    const roomId = lastKnownBackendRoomId;
    if (roomId) {
      const joined = await roomService.joinRoom({
        roomId,
        joinType: "direct",
      });
      return syncModeHallRoomSnapshot(joined.room, "加入私人房间成功。");
    }

    throw new Error("当前没有可加入的私人房间，请先创建房间。");
  }

  if (action === "ready") {
    if (!activeBackendRoomId) {
      throw new Error("请先创建或加入房间。");
    }

    const current = await roomService.getRoomSnapshot(activeBackendRoomId);
    const me = current.room.members.find(
      (member) => member.userId === session.userId,
    );
    if (!me) {
      throw new Error("当前账号不在该房间中。");
    }

    const updated = await roomService.setReady({
      roomId: activeBackendRoomId,
      ready: !me.ready,
    });
    return syncModeHallRoomSnapshot(
      updated.room,
      me.ready ? "你已取消准备。" : "你已准备。",
    );
  }

  if (action === "leave") {
    if (!activeBackendRoomId) {
      throw new Error("请先创建或加入房间。");
    }

    await roomService.leaveRoom({
      roomId: activeBackendRoomId,
    });
    clearModeHallRoomSnapshot("你已离开房间。");
    return modeHallUI.getSnapshot().room;
  }

  return null;
}

function mapLobbyModeToQueueMode(modeId: LobbyModeId) {
  return modeId;
}

function stopBackendMatchmakingPolling() {
  if (backendPollTimerId !== null) {
    window.clearInterval(backendPollTimerId);
    backendPollTimerId = null;
  }
}

function beginBackendMatchmakingPolling() {
  stopBackendMatchmakingPolling();

  backendPollTimerId = window.setInterval(() => {
    if (!backendTicketId) {
      stopBackendMatchmakingPolling();
      return;
    }

    void backendMatchmaking
      .getTicketStatus(backendTicketId)
      .then((state) => {
        matchmakingUI.setExternalProgress({
          stage: state.stage === "matched" ? "confirming" : "searching",
          currentPlayers: state.currentPlayers,
          targetPlayers: state.targetPlayers,
          etaSeconds: state.estimatedWaitSeconds,
          forceConfirming: state.stage === "matched",
        });

        if (state.stage === "matched") {
          stopBackendMatchmakingPolling();
        } else if (state.stage === "cancelled" || state.stage === "failed") {
          backendTicketId = null;
          stopBackendMatchmakingPolling();
        }
      })
      .catch(() => {
        // keep local flow alive when backend polling is unavailable
      });
  }, 1000);
}

async function startBackendMatchmaking(modeId: LobbyModeId = "classic") {
  if (!networkConfig.useBackendMatching) {
    return false;
  }

  const session = authService.getSession();
  if (!session) {
    return false;
  }

  const result = await backendMatchmaking.start({
    modeId: mapLobbyModeToQueueMode(modeId),
  });
  backendTicketId = result.ticketId;
  beginBackendMatchmakingPolling();
  return true;
}

async function handleLoginSubmit(
  payload: LobbyLoginPayload,
): Promise<void> {
  const result = await authService.login({
    method: "password",
    payload: {
      account: payload.account,
      password: payload.password,
    },
  });

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  await syncAuthenticatedAccount(true);
  clearBackendAccountState();
  showLobby();
}

async function handleRegisterSubmit(
  payload: LobbyRegisterPayload,
): Promise<void> {
  const result = await authService.register({
    account: payload.account,
    password: payload.password,
    nickname: payload.nickname,
  });

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  await syncAuthenticatedAccount(true);
  clearBackendAccountState();
  showLobby();
}

function startMatchmaking(modeId: LobbyModeId = "classic") {
  if (!requireAuthenticatedSession()) {
    return;
  }

  destroyCurrentSession();
  pendingModeForMatch = modeId;
  activeModeHall = modeId;
  phase = "matching";
  lobbyUI.hideAll();
  modeHallUI.hide();
  matchmakingUI.start(modeId);
  applyReducedMotionState();

  if (!networkConfig.useBackendMatching) {
    return;
  }

  void startBackendMatchmaking(modeId)
    .then((connected) => {
      if (!connected) return;
      matchmakingUI.startExternal(modeId);
    })
    .catch(() => {
      // Keep local matchmaking flow working even if backend scaffold is unavailable.
    });
}

const matchmakingUI = new MatchmakingUI({
  settings,
  onMatchReady: (modeId) => {
    launchGame(modeId);
  },
  onCancelled: () => {
    const ticketId = backendTicketId;
    backendTicketId = null;
    stopBackendMatchmakingPolling();

    if (ticketId) {
      void backendMatchmaking.cancel(ticketId, "user_cancelled").catch(() => {
        // ignore backend cancel failures to keep local UX smooth
      });
    }

    if (pendingModeForMatch) {
      showModeHall(pendingModeForMatch, activeModeHallTab);
      return;
    }
    showLobby();
  },
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
  },
  onRoomAction: (action) => handleModeHallRoomAction(action),
});

const lobbyUI = new LobbyUI({
  settings,
  onOpenModeHall: (modeId) => {
    showModeHall(modeId, "rules");
  },
  onSettingsChange: syncSettings,
  onSettingsOpened: () => {
    phase = "settings";
    applyReducedMotionState();
  },
  onSettingsClosed: closeSettings,
  onLoginSubmit: handleLoginSubmit,
  onRegisterSubmit: handleRegisterSubmit,
  onLogoutSubmit: logoutToAnonymousScope,
  onRequestDeveloperOverview: loadDeveloperAccountsOverview,
  getAuthStatus: getAuthStatusView,
});

matchmakingUI.mount(overlayMount);
modeHallUI.mount(overlayMount);
lobbyUI.mount(overlayMount);
lobbyUI.refreshAuthStatus();

if (authService.getSession()) {
  showLobby();
} else {
  showAuthGate();
}

if (authService.getSession()) {
  void syncAuthenticatedAccount(false).catch((error) => {
    if (!authService.getSession()) {
      clearBackendAccountState();
      applyAnonymousScopeState();
      showAuthGate();
    } else {
      lobbyUI.refreshAuthStatus();
    }

    console.error("Failed to hydrate authenticated account:", error);
  });
}

window.render_game_to_text = () => {
  const authStatus = getAuthStatusView();
  const payload = {
    phase,
    isPlaying: currentSession !== null,
    playerName: settings.playerName,
    auth: {
      loggedIn: authStatus.loggedIn,
      userLabel: authStatus.userLabel,
      accountLabel: authStatus.accountLabel ?? null,
      userId: authService.getSession()?.userId ?? null,
    },
    progression: loadPlayerProgression(),
    settings: {
      equippedSkinId: settings.equippedSkinId,
      showFps: settings.showFps,
      showMinimap: settings.showMinimap,
      showLeaderboard: settings.showLeaderboard,
      developerMode: settings.developerMode,
      reducedMotion: settings.reducedMotion,
    },
    matching: matchmakingUI.getSnapshot(),
    modeHall: modeHallUI.getSnapshot(),
    pendingModeForMatch,
    session: currentSession?.getSnapshot() ?? null,
  };

  return JSON.stringify(payload);
};

window.advanceTime = (ms: number) => {
  if (!currentSession) {
    return;
  }

  currentSession.advanceTime(ms);
};

window.export_gameplay_tuning = () =>
  JSON.stringify(cloneGameplayTuning(), null, 2);

window.apply_gameplay_tuning = (patch: GameplayTuningPatch | string) => {
  let nextPatch: GameplayTuningPatch;

  if (typeof patch === "string") {
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

window.debug_finish_match = (mode = "auto") => {
  if (!currentSession) {
    return window.render_game_to_text();
  }

  if (mode === "win") {
    currentSession.debugFinishMatch({
      winner: "player",
      subtitle: "Console 调试：强制我方胜利。",
    });
  } else if (mode === "lose") {
    currentSession.debugFinishMatch({
      winner: "bot",
      subtitle: "Console 调试：强制我方失败。",
    });
  } else if (mode === "record") {
    const snapshot = currentSession.getSnapshot();
    const previewMass = Math.max(
      snapshot.playerMass,
      snapshot.match.bestMassRecord + 500,
    );
    currentSession.debugFinishMatch({
      winner: "player",
      playerMass: previewMass,
      forceNewRecord: true,
      subtitle: "Console 调试：新纪录庆祝预览。",
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
    const nextBestMass = Math.max(0, Math.floor(value));
    saveBestMassRecord(nextBestMass);
    setPlayerProgression({ bestMass: nextBestMass });
  }
  lobbyUI.refreshProgression();
  return window.render_game_to_text();
};

window.debug_reset_progression = () => {
  saveBestMassRecord(0);
  resetPlayerProgression();
  lobbyUI.refreshProgression();
  return window.render_game_to_text();
};

window.debug_set_progression = (
  payload: Partial<PlayerProgression> | string,
) => {
  let patch: Partial<PlayerProgression>;
  if (typeof payload === "string") {
    patch = JSON.parse(payload) as Partial<PlayerProgression>;
  } else {
    patch = payload;
  }
  setPlayerProgression(patch);
  if (typeof patch.bestMass === "number" && Number.isFinite(patch.bestMass)) {
    saveBestMassRecord(Math.max(0, Math.floor(patch.bestMass)));
  }
  lobbyUI.refreshProgression();
  return window.render_game_to_text();
};

window.debug_set_mode = (modeId: LobbyModeId) => {
  if (!isLobbyModeId(modeId)) {
    return window.render_game_to_text();
  }
  showModeHall(modeId, "rules");
  return window.render_game_to_text();
};

window.debug_open_mode_hall = (
  modeId: LobbyModeId,
  tabId: ModeHallTabId = "rules",
) => {
  if (!isLobbyModeId(modeId) || !isModeHallTabId(tabId)) {
    return window.render_game_to_text();
  }
  showModeHall(modeId, tabId);
  return window.render_game_to_text();
};

window.debug_room_simulate = (action: RoomAction, payload?: string) => {
  void handleModeHallRoomAction(action)
    .catch(() => {
      modeHallUI.simulateRoom(action, payload);
    })
    .finally(() => {
      window.render_game_to_text();
    });
  return window.render_game_to_text();
};

window.debug_set_zone = (stage: number) => {
  if (currentSession && Number.isFinite(stage)) {
    currentSession.debugSetBattleZone(Math.max(0, Number(stage)));
  }
  return window.render_game_to_text();
};

window.debug_backend_login_demo = async () => {
  const res = await authService.login({
    method: "password",
    payload: {
      account: "demo",
      password: "demo123456",
    },
  });

  if (res.ok) {
    await syncAuthenticatedAccount(true);
    clearBackendAccountState();
  } else {
    lobbyUI.refreshAuthStatus();
  }

  return JSON.stringify({
    ok: res.ok,
    userId: res.ok ? res.data.user.userId : null,
    message: res.ok ? "demo login ok" : res.error.message,
  });
};

window.debug_backend_guest_login = async (
  guestId = `guest_${Math.random().toString(36).slice(2, 8)}`,
) => {
  return JSON.stringify({
    ok: false,
    userId: null,
    guestId,
    message: "guest login is disabled in the current backend flow",
  });
};

window.debug_backend_logout = async () => {
  await logoutToAnonymousScope();
  return JSON.stringify({
    ok: true,
    message: "logout ok",
  });
};

window.debug_backend_match_start = async (modeId: LobbyModeId = "classic") => {
  if (!networkConfig.useBackendMatching) {
    return JSON.stringify({
      ok: false,
      message: "backend matching is disabled by VITE_USE_BACKEND_MATCHING",
    });
  }

  const session = authService.getSession();
  if (!session) {
    return JSON.stringify({
      ok: false,
      message: "not logged in",
    });
  }

  try {
    const data = await backendMatchmaking.start({
      modeId: mapLobbyModeToQueueMode(modeId),
    });
    backendTicketId = data.ticketId;
    return JSON.stringify({
      ok: true,
      ticketId: data.ticketId,
      modeId: data.modeId,
      stage: data.stage,
    });
  } catch (error) {
    return JSON.stringify({
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "backend matchmaking start failed",
    });
  }
};

window.debug_backend_match_cancel = async () => {
  if (!backendTicketId) {
    return JSON.stringify({
      ok: false,
      message: "no active backend ticket",
    });
  }

  try {
    const data = await backendMatchmaking.cancel(
      backendTicketId,
      "user_cancelled",
    );
    backendTicketId = null;
    stopBackendMatchmakingPolling();
    return JSON.stringify({
      ok: true,
      ticketId: data.ticketId,
      stage: data.stage,
    });
  } catch (error) {
    return JSON.stringify({
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "backend matchmaking cancel failed",
    });
  }
};

window.debug_backend_match_status = async () => {
  if (!backendTicketId) {
    return JSON.stringify({
      ok: false,
      message: "no active backend ticket",
    });
  }

  try {
    const data = await backendMatchmaking.getTicketStatus(backendTicketId);
    if (
      data.stage === "cancelled" ||
      data.stage === "failed" ||
      data.stage === "matched"
    ) {
      backendTicketId = data.stage === "matched" ? backendTicketId : null;
    }
    return JSON.stringify({
      ok: true,
      ticketId: data.ticketId,
      stage: data.stage,
      currentPlayers: data.currentPlayers,
      targetPlayers: data.targetPlayers,
      etaSeconds: data.estimatedWaitSeconds,
    });
  } catch (error) {
    return JSON.stringify({
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "backend matchmaking status failed",
    });
  }
};
