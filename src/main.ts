import "./style.css";
import "./mode-hall-v2.css";
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
import {
  createGameSession,
  type DebugMatchFinishOptions,
} from "./game/createGameSession";
import {
  createOnlineRoomSession,
} from "./game/createOnlineRoomSession";
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
  type LobbyAuthCapabilities,
  LobbyUI,
  type LobbyAuthStatus,
  type LobbyFeatureId,
  type LobbyLoginPayload,
  type LobbyModeId,
  type LobbyRegisterPayload,
} from "./ui/LobbyUI";
import { MatchmakingUI } from "./ui/MatchmakingUI";
import {
  ModeHallUI,
  type ModeHallSocialFriend,
  type RoomAction,
} from "./ui/ModeHallUI";
import { authService } from "./network/authService";
import { lobbyService } from "./network/lobbyService";
import { MatchmakingService } from "./network/matchmakingService";
import { progressionService } from "./network/progressionService";
import { roomService } from "./network/roomService";
import { userService } from "./network/userService";
import { networkConfig } from "./network/config";
import { HttpProtocolError } from "./network/http";
import { platformService } from "./network/platformService";
import { clerkBridge } from "./platform/clerk";
import { clientPlatformConfig } from "./platform/config";
import {
  captureClientEvent,
  captureClientException,
  clearClientUser,
  identifyClientUser,
  initializeClientTelemetry,
} from "./platform/telemetry";
import type { ModeHallTabId, ModeHallRoomSnapshot } from "./modes/definitions";
import type {
  RoomMatchSnapshot,
  RoomSnapshot,
} from "../shared-protocol/src/room";
import type {
  DeveloperAccountsOverview,
  UserSummary,
} from "../shared-protocol/src/user";
import type { SocialOverview } from "../shared-protocol/src/social";
import type { PlatformConfigResponse } from "../shared-protocol/src/platform";

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

type RuntimeSession = {
  mount(root: HTMLElement): void;
  startNewGame(): void;
  stop(): void;
  destroy(): void;
  applySettings(settings: GameSettings): void;
  getSnapshot(): unknown;
  advanceTime(ms: number): void;
  debugFinishMatch(options?: DebugMatchFinishOptions): void;
  debugSetBestMassRecord(value: number): void;
  debugSetBattleZone(stage: number): void;
};

type CheckoutReturnState = "success" | "cancelled" | null;
type LaunchView = "play" | "hall";

interface InitialLaunchRoute {
  modeId: LobbyModeId;
  view: LaunchView;
}

const appRoot = document.createElement("div");
appRoot.className = "app-root";

const gameMount = document.createElement("div");
gameMount.className = "game-mount";

const overlayMount = document.createElement("div");
overlayMount.className = "overlay-mount";

appRoot.append(gameMount, overlayMount);
document.body.appendChild(appRoot);

initializeClientTelemetry();

const initialLaunchRoute = readInitialLaunchRoute();

setActiveStorageScopeForUser(authService.getSession()?.userId ?? null);

const initialCheckoutReturnState = consumeCheckoutReturnState();

let phase: GamePhase = authService.getSession() ? "lobby" : "auth";
let settings: GameSettings = loadGameSettings();
let currentSession: RuntimeSession | null = null;
let pendingModeForMatch: LobbyModeId | null = null;
let activeModeHall: LobbyModeId | null = null;
let activeModeHallTab: ModeHallTabId = "rules";
let backendTicketId: string | null = null;
let backendPollTimerId: number | null = null;
let pendingOnlineMatchRoomId: string | null = null;
let activeBackendRoomId: string | null = null;
let activeBackendRoomInviteCode: string | null = null;
let lastKnownBackendRoomId: string | null = null;
let lastKnownBackendRoomInviteCode: string | null = null;
let onlineMatchEntryRoomId: string | null = null;
let onlineMatchEntryPromise: Promise<boolean> | null = null;
let profileSyncTimerId: number | null = null;
let roomSnapshotPollTimerId: number | null = null;
let socialPollTimerId: number | null = null;
let suppressRemoteProfileSync = false;
let runtimePlatformConfig: PlatformConfigResponse | null = null;
let currentUserSummary: UserSummary | null = null;
const SOCIAL_POLL_INTERVAL_MS = 20_000;
const backendMatchmaking = new MatchmakingService({});

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

function hydrateRuntimePlatformConfig() {
  void platformService
    .getConfig()
    .then((config) => {
      runtimePlatformConfig = config;
      lobbyUI.refreshAuthStatus();
    })
    .catch((error) => {
      console.error("Failed to hydrate platform config:", error);
    });
}

function getAuthCapabilitiesView(): LobbyAuthCapabilities {
  const auth = runtimePlatformConfig?.auth;
  return {
    emailVerificationEnabled: auth?.emailVerificationEnabled ?? false,
    emailProvider: auth?.emailProvider ?? null,
  };
}

function isStripeShopEnabled() {
  return (
    runtimePlatformConfig?.commerce.stripeEnabled ??
    clientPlatformConfig.stripe.enabled
  );
}

function getDefaultStripeProductKey() {
  return (
    runtimePlatformConfig?.commerce.defaultProductKey ??
    clientPlatformConfig.stripe.defaultProductKey
  );
}

function consumeCheckoutReturnState(): CheckoutReturnState {
  const url = new URL(window.location.href);
  const checkout =
    url.searchParams.get("checkout") === "success" ||
      url.searchParams.get("checkout") === "cancelled"
      ? (url.searchParams.get("checkout") as Exclude<CheckoutReturnState, null>)
      : null;

  if (!checkout) {
    return null;
  }

  url.searchParams.delete("checkout");
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, document.title, nextUrl);
  return checkout;
}

function readInitialLaunchRoute(): InitialLaunchRoute | null {
  const url = new URL(window.location.href);
  const mode = url.searchParams.get("mode");
  if (!mode || !isLobbyModeId(mode)) {
    return null;
  }

  const viewParam = url.searchParams.get("view");
  const view: LaunchView = viewParam === "hall" ? "hall" : "play";

  return {
    modeId: mode,
    view,
  };
}

function applyInitialLaunchRoute() {
  if (!initialLaunchRoute || !authService.getSession()) {
    return;
  }

  window.setTimeout(() => {
    if (!authService.getSession()) {
      return;
    }

    if (initialLaunchRoute.view === "hall") {
      showModeHall(initialLaunchRoute.modeId, "rules");
      return;
    }

    launchGame(initialLaunchRoute.modeId);
  }, 0);
}

function applyCheckoutReturnFeedback(state: CheckoutReturnState) {
  if (!state) {
    return;
  }

  captureClientEvent("stripe_checkout_returned", { state });

  if (state === "cancelled") {
    lobbyUI.notify("你已取消本次 Stripe 结算。");
    return;
  }

  if (!authService.getSession()) {
    lobbyUI.notify("支付已完成，但当前登录态已失效，请重新登录后确认到账。");
    return;
  }

  lobbyUI.notify("商城订单已完成，金币和权益已同步到当前账号。");
}

function getAuthStatusView(): LobbyAuthStatus {
  const session = authService.getSession();
  return {
    loggedIn: !!session,
    userLabel: session?.nickname ?? "游客",
    accountLabel: session?.gameId ? `UID · ${session.gameId}` : "本地试玩档",
    gameId: session?.gameId ?? "",
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
  currentUserSummary = summary;
  identifyClientUser({
    userId: summary.user.id,
    gameId: summary.user.gameId,
    nickname: summary.profile.nickname,
  });
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
  authService.updateSessionAuthorization(summary.user.id, summary.authorization);

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
  if (summary.ban.isBanned) {
    const reason = summary.ban.reason?.trim() || "违规行为";
    const until = summary.ban.until
      ? new Date(summary.ban.until).toLocaleString("zh-CN", { hour12: false })
      : "永久封禁";
    lobbyUI.notify(
      `账号已封禁：${reason}（至 ${until}）。请在游戏内邮件中心查看通知并提交申诉。`,
    );
  }
}

async function loadDeveloperAccountsOverview(): Promise<DeveloperAccountsOverview | null> {
  if (!authService.getSession()) {
    return null;
  }

  const result = await userService.getDeveloperAccountsOverview();
  return result.overview;
}

function toModeHallSocialFriends(overview: SocialOverview): ModeHallSocialFriend[] {
  return [...overview.friends]
    .sort((left, right) => {
      const onlineDiff = Number(right.isOnline) - Number(left.isOnline);
      if (onlineDiff !== 0) {
        return onlineDiff;
      }
      return left.nickname.localeCompare(right.nickname, "zh-Hans-CN");
    })
    .map((friend) => ({
      gameId: friend.gameId,
      nickname: friend.nickname,
      isOnline: friend.isOnline,
    }));
}

function applySocialOverviewToViews(overview: SocialOverview | null) {
  lobbyUI.setSocialOverview(overview);
  modeHallUI.setSocialFriends(overview ? toModeHallSocialFriends(overview) : []);
}

async function pollSocialOverviewOnce() {
  if (!authService.getSession()) {
    applySocialOverviewToViews(null);
    return;
  }

  try {
    const overview = await lobbyService.fetchSocialOverview();
    applySocialOverviewToViews(overview);
  } catch (error) {
    console.error("Failed to sync social overview:", error);
  }
}

function stopSocialPolling(clearState = false) {
  if (socialPollTimerId !== null) {
    window.clearInterval(socialPollTimerId);
    socialPollTimerId = null;
  }

  if (clearState) {
    applySocialOverviewToViews(null);
  }
}

function beginSocialPolling() {
  if (!authService.getSession()) {
    stopSocialPolling(true);
    return;
  }

  if (socialPollTimerId !== null) {
    return;
  }

  void pollSocialOverviewOnce();
  socialPollTimerId = window.setInterval(() => {
    if (!authService.getSession()) {
      stopSocialPolling(true);
      return;
    }
    void pollSocialOverviewOnce();
  }, SOCIAL_POLL_INTERVAL_MS);
}

function applyAnonymousScopeState() {
  currentUserSummary = null;
  clearClientUser();
  setActiveStorageScopeForUser(null);
  suppressRemoteProfileSync = true;
  applyLoadedSettings(loadGameSettings(getAnonymousStorageScope()));
  suppressRemoteProfileSync = false;
  lobbyUI.refreshProgression();
  lobbyUI.refreshAuthStatus();
  applySocialOverviewToViews(null);
  void lobbyUI.refreshDeveloperOverview(true);
}

function resetBackendMatchmakingState() {
  backendTicketId = null;
  pendingOnlineMatchRoomId = null;
  stopBackendMatchmakingPolling();
}

function clearBackendAccountState() {
  resetBackendMatchmakingState();
  activeBackendRoomId = null;
  activeBackendRoomInviteCode = null;
  lastKnownBackendRoomId = null;
  lastKnownBackendRoomInviteCode = null;
  stopRoomSnapshotPolling();
  clearModeHallRoomSnapshot("私人模式链路待连接。");
}

async function logoutToAnonymousScope() {
  if (profileSyncTimerId !== null) {
    window.clearTimeout(profileSyncTimerId);
    profileSyncTimerId = null;
  }
  stopSocialPolling(true);
  await authService.logout(false);
  await clerkBridge.signOut().catch(() => undefined);
  captureClientEvent("auth_logout");
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

  const rawAvatar = nextSettings.avatarDataUrl.trim();
  let avatarUrl: string | null = null;
  if (rawAvatar.length > 0) {
    if (rawAvatar.startsWith("data:")) {
      const uploaded = await platformService.uploadAvatar({
        dataUrl: rawAvatar,
        filename: `${session.userId}-avatar`,
      });
      avatarUrl = uploaded.avatarUrl;
    } else {
      avatarUrl = rawAvatar;
    }
  }

  const response = await authService.updateProfile({
    nickname: normalizeServerNickname(nextSettings.playerName),
    avatarUrl,
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
  if (!authService.getSession()) {
    clearClientUser();
  }
  stopSocialPolling(true);
  destroyCurrentSession();
  stopRoomSnapshotPolling();
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

  console.warn("[main] authentication required but session missing, showing auth gate");
  showAuthGate();
  return false;
}

function showLobby() {
  if (!authService.getSession()) {
    showAuthGate();
    return;
  }

  destroyCurrentSession();
  stopRoomSnapshotPolling();
  pendingModeForMatch = null;
  activeModeHall = null;
  matchmakingUI.hide(true);
  modeHallUI.hide();
  phase = "lobby";
  lobbyUI.refreshProgression();
  lobbyUI.showLobby();
  beginSocialPolling();
  applyReducedMotionState();
}

function isLobbyModeId(value: string): value is LobbyModeId {
  return (
    value === "ranked" ||
    value === "peak" ||
    value === "classic" ||
    value === "battleRoyale"
  );
}

function isModeHallTabId(value: string): value is ModeHallTabId {
  return (
    value === "rules" ||
    value === "rewards" ||
    value === "records" ||
    value === "guide"
  );
}

function showModeHall(modeId: LobbyModeId, tabId: ModeHallTabId = "rules") {
  console.log("[main] showModeHall requested:", { modeId, tabId });
  if (!requireAuthenticatedSession()) {
    return;
  }

  destroyCurrentSession();
  pendingModeForMatch = modeId;
  activeModeHall = modeId;
  activeModeHallTab = tabId;
  console.log("[main] hiding matchmaking and lobby, calling modeHallUI.show");
  matchmakingUI.hide(true);
  lobbyUI.hideAll();
  modeHallUI.show(modeId, tabId);
  phase = "modeHall";
  if (activeBackendRoomId) {
    beginRoomSnapshotPolling();
  } else {
    stopRoomSnapshotPolling();
  }
  beginSocialPolling();
  applyReducedMotionState();
}

function openSettings(modalOnly: boolean) {
  if (!requireAuthenticatedSession()) {
    return;
  }

  phase = "settings";
  lobbyUI.openSettings(modalOnly);
  beginSocialPolling();
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
  stopRoomSnapshotPolling();
  pendingModeForMatch = null;
  activeModeHall = modeId;
  matchmakingUI.hide(true);
  modeHallUI.hide();

  currentSession = createGameSession({
    settings,
    isDeveloper: authService.getSession()?.isDeveloper ?? false,
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

function formatRoomStatusMessage(room: RoomSnapshot) {
  if (room.status === "inGame") {
    return `私人房间对局中 · ${room.members.length}/${room.maxMembers}`;
  }
  if (room.status === "matching") {
    return `房间已满足开局条件 · ${room.members.length}/${room.maxMembers}`;
  }
  if (room.status === "closed") {
    return "房间已关闭。";
  }
  return `房间同步成功 · ${room.members.length}/${room.maxMembers}`;
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
    lastCheck: message ?? formatRoomStatusMessage(room),
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
  stopRoomSnapshotPolling();
  modeHallUI.clearRoomSnapshot(message);
}

function stopRoomSnapshotPolling() {
  if (roomSnapshotPollTimerId !== null) {
    window.clearInterval(roomSnapshotPollTimerId);
    roomSnapshotPollTimerId = null;
  }
}

async function maybeEnterOnlineRoomFromSnapshot(room: RoomSnapshot) {
  if (
    room.status !== "inGame" ||
    currentSession ||
    !authService.getSession()
  ) {
    return false;
  }

  try {
    const result = await roomService.syncRoomMatch({
      roomId: room.roomId,
      input: { moveX: 0, moveY: 0 },
    });
    launchOnlineRoomSession(result.room, result.session, "room");
    return true;
  } catch {
    return false;
  }
}

function beginRoomSnapshotPolling() {
  stopRoomSnapshotPolling();

  roomSnapshotPollTimerId = window.setInterval(() => {
    if (!activeBackendRoomId || !authService.getSession()) {
      stopRoomSnapshotPolling();
      return;
    }

    void roomService
      .getRoomSnapshot(activeBackendRoomId)
      .then(async (result) => {
        syncModeHallRoomSnapshot(result.room);
        const entered = await maybeEnterOnlineRoomFromSnapshot(result.room);
        if (entered) {
          stopRoomSnapshotPolling();
        }
      })
      .catch(() => {
        // Keep the current room state visible and retry on next tick.
      });
  }, 1500);
}

function launchOnlineRoomSession(
  room: RoomSnapshot,
  session: RoomMatchSnapshot,
  source: "room" | "matchmaking" = "room",
) {
  if (!requireAuthenticatedSession()) {
    return;
  }

  destroyCurrentSession();
  stopRoomSnapshotPolling();
  pendingModeForMatch = null;
  activeModeHall = (room.modeId as LobbyModeId) ?? activeModeHall ?? "classic";
  matchmakingUI.hide(true);
  modeHallUI.hide();

  currentSession = createOnlineRoomSession({
    settings,
    isDeveloper: authService.getSession()?.isDeveloper ?? false,
    modeId: (room.modeId as LobbyModeId) ?? "classic",
    roomId: room.roomId,
    initialRoom: room,
    initialSession: session,
    onReturnToModeHall: () => {
      showModeHall((room.modeId as LobbyModeId) ?? "classic", activeModeHallTab);
      if (source === "matchmaking") {
        clearModeHallRoomSnapshot("在线对局已结束，可继续匹配。");
        return;
      }
      syncModeHallRoomSnapshot(
        room,
        session.phase === "finished" ? "在线对局已结束，可继续准备下一局。" : "已返回私人房间。",
      );
      beginRoomSnapshotPolling();
    },
    onOpenSettings: () => openSettings(true),
    onRoomSnapshot: (nextRoom) => {
      if (source === "room") {
        syncModeHallRoomSnapshot(nextRoom);
      }
    },
    onCompleteMatch: authService.getSession()
      ? (payload) => handleCloudMatchCompletion(payload)
      : undefined,
  });

  try {
    currentSession.mount(gameMount);
    currentSession.startNewGame();
  } catch (error) {
    // Canvas 初始化或游戏启动失败，清理并返回分厅
    console.error("Failed to start online room session:", error);
    currentSession?.destroy();
    currentSession = null;
    lobbyUI.notify("游戏启动失败，请刷新页面重试。");
    showModeHall((room.modeId as LobbyModeId) ?? "classic", activeModeHallTab);
    return;
  }

  phase = "playing";
  lobbyUI.hideAll();
  applyReducedMotionState();
}

async function handleModeHallRoomAction(
  action: RoomAction,
  payload?: string,
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
      teamMode: "solo",
    });
    const snapshot = syncModeHallRoomSnapshot(result.room, "私人房间创建成功。");
    beginRoomSnapshotPolling();
    return snapshot;
  }

  if (action === "join") {
    const typedInviteCode = payload?.trim().toUpperCase();
    if (typedInviteCode) {
      const joined = await roomService.joinRoom({
        inviteCode: typedInviteCode,
        joinType: "inviteCode",
      });
      const snapshot = syncModeHallRoomSnapshot(joined.room, "加入私人房间成功。");
      beginRoomSnapshotPolling();
      return snapshot;
    }

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
      const snapshot = syncModeHallRoomSnapshot(joined.room, "加入私人房间成功。");
      beginRoomSnapshotPolling();
      return snapshot;
    }

    const roomId = lastKnownBackendRoomId;
    if (roomId) {
      const joined = await roomService.joinRoom({
        roomId,
        joinType: "direct",
      });
      const snapshot = syncModeHallRoomSnapshot(joined.room, "加入私人房间成功。");
      beginRoomSnapshotPolling();
      return snapshot;
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
    const snapshot = syncModeHallRoomSnapshot(
      updated.room,
      me.ready ? "你已取消准备。" : "你已准备。",
    );
    beginRoomSnapshotPolling();
    return snapshot;
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

async function handleModeHallInviteFriend(gameId: string): Promise<string> {
  const session = authService.getSession();
  if (!session) {
    throw new Error("请先登录后再邀请好友。");
  }
  if (!activeBackendRoomId) {
    throw new Error("请先创建或加入房间后再邀请好友。");
  }

  const result = await roomService.inviteFriendToRoom({
    roomId: activeBackendRoomId,
    targetGameId: gameId,
  });
  return `已向 UID ${result.targetGameId} 发送房间邀请邮件。`;
}

function mapLobbyModeToQueueMode(modeId: LobbyModeId) {
  return modeId;
}

function isSinglePlayerSessionSnapshot(
  snapshot: unknown,
): snapshot is { playerMass: number; match: { bestMassRecord: number } } {
  if (!snapshot || typeof snapshot !== "object") {
    return false;
  }

  const candidate = snapshot as {
    playerMass?: unknown;
    match?: { bestMassRecord?: unknown };
  };

  return (
    typeof candidate.playerMass === "number" &&
    typeof candidate.match?.bestMassRecord === "number"
  );
}

function stopBackendMatchmakingPolling() {
  if (backendPollTimerId !== null) {
    window.clearInterval(backendPollTimerId);
    backendPollTimerId = null;
  }
}

function getProtocolErrorCode(error: unknown): string | null {
  if (error instanceof HttpProtocolError) {
    return error.payload?.error?.code ?? null;
  }

  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }

  return null;
}

function isRetryableOnlineMatchEntryError(error: unknown): boolean {
  const code = getProtocolErrorCode(error);
  // 协议层面的房间未就绪，可以重试
  if (
    code === "ROOM_NOT_FOUND" ||
    code === "ROOM_INVALID_STATE" ||
    code === "ROOM_NOT_MEMBER"
  ) {
    return true;
  }
  // 网络层面的错误（超时、断网、DNS失败）也可以重试
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes("timeout") ||
      msg.includes("fetch") ||
      msg.includes("network") ||
      msg.includes("abort") ||
      msg.includes("failed to fetch") ||
      msg.includes("cors")
    ) {
      return true;
    }
  }
  // HttpProtocolError 且 status 为 0（网络层失败）也重试
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    (error as { status: number }).status === 0
  ) {
    return true;
  }
  return false;
}

async function syncOnlineMatchRoomWithRetry(
  roomId: string,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    onStatus?: (status: "entering" | "syncing" | "ready") => void;
  } = {},
) {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const intervalMs = options.intervalMs ?? 800;
  const startedAt = Date.now();
  let lastError: unknown = null;
  let attempt = 0;

  options.onStatus?.("entering");

  while (Date.now() - startedAt < timeoutMs) {
    attempt++;
    try {
      options.onStatus?.("syncing");
      const result = await roomService.syncRoomMatch({
        roomId,
        input: { moveX: 0, moveY: 0 },
      });
      options.onStatus?.("ready");
      return result;
    } catch (error) {
      lastError = error;
      if (!isRetryableOnlineMatchEntryError(error)) {
        throw error;
      }
      // 前5次快速重试，之后慢一点
      const delay = attempt <= 5 ? intervalMs : Math.min(intervalMs * 2, 2000);
      await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error("在线房间尚未就绪，请稍后重试。");
}

async function waitForMatchedRoomId(
  ticketId: string,
  timeoutMs = 25_000,
): Promise<string | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const state = await backendMatchmaking.getTicketStatus(ticketId);
      const matchedRoomId = state.matchFound?.roomId?.trim() ?? "";
      if (state.stage === "matched" && matchedRoomId) {
        pendingOnlineMatchRoomId = matchedRoomId;
        return matchedRoomId;
      }
      if (state.stage === "cancelled" || state.stage === "failed") {
        return null;
      }
    } catch {
      // retry until timeout
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 600));
  }
  return null;
}

async function tryEnterOnlineMatchFromBackendTicket(): Promise<boolean> {
  if (!networkConfig.useBackendMatching || !backendTicketId) {
    return false;
  }

  const state = await backendMatchmaking.getTicketStatus(backendTicketId);
  const matchedRoomId = state.matchFound?.roomId?.trim();
  if (state.stage !== "matched" || !matchedRoomId) {
    return false;
  }

  pendingOnlineMatchRoomId = matchedRoomId;
  return tryEnterOnlineMatchFromRoomId(matchedRoomId);
}

async function tryEnterOnlineMatchFromRoomId(
  roomId: string,
): Promise<boolean> {
  const normalizedRoomId = roomId.trim();
  if (!normalizedRoomId) {
    return false;
  }
  if (currentSession) {
    return true;
  }
  if (
    onlineMatchEntryPromise &&
    onlineMatchEntryRoomId === normalizedRoomId
  ) {
    return onlineMatchEntryPromise;
  }

  const entryPromise = (async () => {
    // 进房过程中更新UI状态
    const sync = await syncOnlineMatchRoomWithRetry(normalizedRoomId, {
      onStatus: (status) => {
        if (status === "entering") {
          matchmakingUI.setEntryStatus?.("正在建立连接...");
        } else if (status === "syncing") {
          matchmakingUI.setEntryStatus?.("正在同步战场数据...");
        }
      },
    });

    backendTicketId = null;
    pendingOnlineMatchRoomId = null;
    stopBackendMatchmakingPolling();
    launchOnlineRoomSession(sync.room, sync.session, "matchmaking");
    return true;
  })().catch((error) => {
    // 最终失败时给出更友好的提示
    const code = getProtocolErrorCode(error);
    if (code === "ROOM_NOT_FOUND") {
      throw new Error("房间已关闭或不存在，请重新匹配。");
    } else if (code === "ROOM_NOT_MEMBER") {
      throw new Error("你不在该房间的成员列表中，请重新匹配。");
    } else if (code === "ROOM_INVALID_STATE" && error instanceof Error && error.message?.includes("finished")) {
      throw new Error("房间对局已结束，请返回分厅重新开始。");
    } else if (error instanceof Error && error.message?.includes("timeout")) {
      throw new Error("连接超时，请检查网络后重新匹配。");
    }
    throw error;
  }).finally(() => {
    if (onlineMatchEntryPromise === entryPromise) {
      onlineMatchEntryPromise = null;
      onlineMatchEntryRoomId = null;
    }
  });

  onlineMatchEntryRoomId = normalizedRoomId;
  onlineMatchEntryPromise = entryPromise;
  return entryPromise;
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
          const matchedRoomId = state.matchFound?.roomId?.trim() ?? "";
          if (matchedRoomId && pendingOnlineMatchRoomId !== matchedRoomId) {
            pendingOnlineMatchRoomId = matchedRoomId;
          }
        } else if (state.stage === "cancelled" || state.stage === "failed") {
          backendTicketId = null;
          pendingOnlineMatchRoomId = null;
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

  const existingActiveTicket = await backendMatchmaking
    .getActiveTicket()
    .catch(() => null);
  if (existingActiveTicket) {
    backendTicketId = existingActiveTicket.ticketId;
    pendingOnlineMatchRoomId = existingActiveTicket.matchFound?.roomId?.trim() || null;
    beginBackendMatchmakingPolling();
    return true;
  }

  try {
    const result = await backendMatchmaking.start({
      modeId: mapLobbyModeToQueueMode(modeId),
    });
    backendTicketId = result.ticketId;
    beginBackendMatchmakingPolling();
    return true;
  } catch (error) {
    const matchmakingError =
      error && typeof error === "object"
        ? (error as { code?: string })
        : null;
    if (matchmakingError?.code === "MATCH_ALREADY_IN_QUEUE") {
      const activeTicket = await backendMatchmaking.getActiveTicket();
      if (activeTicket) {
        backendTicketId = activeTicket.ticketId;
        pendingOnlineMatchRoomId = activeTicket.matchFound?.roomId?.trim() || null;
        beginBackendMatchmakingPolling();
        return true;
      }
    }
    throw error;
  }
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
    if (result.error.code === "AUTH_ACCOUNT_BANNED") {
      const details = result.error.details as
        | { banReason?: string; banUntil?: string | null }
        | undefined;
      const reason = details?.banReason?.trim() || "违规行为";
      const until = details?.banUntil
        ? new Date(details.banUntil).toLocaleString("zh-CN", { hour12: false })
        : "永久封禁";
      throw new Error(
        `账号已封禁：${reason}（至 ${until}）。请在游戏内邮件中心提交申诉。`,
      );
    }
    throw new Error(result.error.message);
  }

  captureClientEvent("auth_password_login_succeeded");
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
    email: payload.email,
    emailCode: payload.emailCode,
  });

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  captureClientEvent("auth_password_register_succeeded");
  await syncAuthenticatedAccount(true);
  clearBackendAccountState();
  showLobby();
}

async function handleSendRegisterEmailCode(payload: {
  email: string;
}): Promise<{ cooldownSeconds?: number }> {
  const result = await authService.sendEmailCode({
    email: payload.email,
    purpose: "register",
  });

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  captureClientEvent("auth_register_email_code_sent", {
    provider: getAuthCapabilitiesView().emailProvider ?? "unknown",
  });
  return result.data;
}

async function handleRequestPasswordReset(payload: {
  account: string;
}): Promise<{ challengeId: string; cooldownSeconds?: number }> {
  const result = await authService.requestPasswordReset({
    account: payload.account,
    verifyBy: "email",
  });

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  captureClientEvent("auth_password_reset_requested", {
    provider: getAuthCapabilitiesView().emailProvider ?? "unknown",
  });

  return {
    challengeId: result.data.challengeId,
    cooldownSeconds: 60,
  };
}

async function handleConfirmPasswordReset(payload: {
  challengeId: string;
  verificationCode: string;
  newPassword: string;
}): Promise<void> {
  const result = await authService.confirmPasswordReset({
    challengeId: payload.challengeId,
    verificationCode: payload.verificationCode,
    newPassword: payload.newPassword,
  });

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  captureClientEvent("auth_password_reset_confirmed");
}

async function handleClerkSessionToken(token: string) {
  const result = await authService.login({
    method: "platform",
    payload: {
      provider: "clerk",
      providerToken: token,
    },
  });

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  captureClientEvent("auth_clerk_login_succeeded", {
    isNewUser: result.data.isNewUser,
  });
  await syncAuthenticatedAccount(true);
  clearBackendAccountState();
  showLobby();
}

async function handleLobbyFeatureAction(feature: LobbyFeatureId) {
  if (feature !== "shop") {
    captureClientEvent("lobby_feature_selected", { feature });
    return;
  }

  if (!authService.getSession()) {
    lobbyUI.notify("请先登录账号后再打开商城。");
    return;
  }

  if (!isStripeShopEnabled()) {
    lobbyUI.notify("Stripe 商城还没配置完成，先把价格和密钥补上就能打开。");
    return;
  }

  const productKey = getDefaultStripeProductKey();
  if (!productKey) {
    lobbyUI.notify("商城默认商品还没配置。");
    return;
  }

  try {
    captureClientEvent("shop_checkout_requested", { productKey });
    const checkout = await platformService.createCheckoutSession({
      productKey,
    });
    lobbyUI.notify("正在跳转到 Stripe 结算页...");
    window.location.assign(checkout.checkoutUrl);
  } catch (error) {
    captureClientException(error, {
      action: "stripe_checkout_open",
      productKey,
    });
    lobbyUI.notify(
      error instanceof Error ? error.message : "打开商城失败，请稍后再试。",
    );
  }
}

async function startRoomBackedMatch(modeId: LobbyModeId) {
  if (!activeBackendRoomId) {
    throw new Error("请先创建或加入私人房间。");
  }

  activeModeHall = modeId;
  const result = await roomService.startRoomMatch({
    roomId: activeBackendRoomId,
  });
  syncModeHallRoomSnapshot(result.room, "房主已开局，正在进入在线对局。");
  launchOnlineRoomSession(result.room, result.session, "room");
}

function startMatchmaking(modeId: LobbyModeId = "classic") {
  if (!requireAuthenticatedSession()) {
    return;
  }
  if (currentUserSummary?.ban.isBanned) {
    const reason = currentUserSummary.ban.reason?.trim() || "违规行为";
    lobbyUI.notify(`当前账号处于封禁状态（${reason}），无法开始对局。请先在游戏邮件中申诉。`);
    return;
  }

  if (activeBackendRoomId) {
    void startRoomBackedMatch(modeId).catch((error) => {
      modeHallUI.setRoomSnapshot({
        ...modeHallUI.getSnapshot().room,
        lastCheck:
          error instanceof Error ? error.message : "私人房间开局失败，请稍后再试。",
      });
    });
    return;
  }

  destroyCurrentSession();
  stopRoomSnapshotPolling();
  resetBackendMatchmakingState();
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
    console.log("[Matchmaking] onMatchReady triggered", {
      modeId,
      hasCurrentSession: !!currentSession,
      phase,
      hasOnlineMatchEntryPromise: !!onlineMatchEntryPromise,
      backendTicketId,
      pendingOnlineMatchRoomId,
      useBackendMatching: networkConfig.useBackendMatching,
    });

    if (currentSession || phase === "playing" || onlineMatchEntryPromise) {
      console.log("[Matchmaking] onMatchReady aborted - already in game");
      return;
    }

    if (networkConfig.useBackendMatching) {
      // 进房失败处理：显示分厅界面和错误提示，让用户可以选择重试
      const handleEntryFailure = (error: unknown, context: string, failedModeId: LobbyModeId) => {
        console.error(`[Matchmaking] ${context}:`, error);
        const code = getProtocolErrorCode(error);
        let message = "进入对局失败，";
        if (code === "ROOM_NOT_FOUND") {
          message += "房间已关闭。";
        } else if (code === "ROOM_NOT_MEMBER") {
          message += "你不在房间成员列表中。";
        } else if (error instanceof Error && error.message?.toLowerCase().includes("timeout")) {
          message += "连接超时。";
        } else {
          message += "请重试或取消匹配。";
        }
        resetBackendMatchmakingState();
        // 显示分厅界面（保持可见），同时显示错误通知
        showModeHall(failedModeId, activeModeHallTab);
        lobbyUI.notify(message);
      };

      if (pendingOnlineMatchRoomId) {
        void tryEnterOnlineMatchFromRoomId(pendingOnlineMatchRoomId).catch((error) => {
          handleEntryFailure(error, "Failed to enter pending matched room", modeId);
        });
        return;
      }

      void (async () => {
        if (backendTicketId) {
          const matchedRoomId = await waitForMatchedRoomId(backendTicketId);
          if (matchedRoomId) {
            await tryEnterOnlineMatchFromRoomId(matchedRoomId);
            return;
          }
        }

        const enteredOnline = await tryEnterOnlineMatchFromBackendTicket();
        if (!enteredOnline) {
          showModeHall(modeId, activeModeHallTab);
          lobbyUI.notify("房间准备中，请稍后重试匹配。");
        }
      })()
        .catch((error) => {
          handleEntryFailure(error, "Failed to enter online match from ticket", modeId);
        });
      return;
    }

    void tryEnterOnlineMatchFromBackendTicket()
      .then((enteredOnline) => {
        if (!enteredOnline) {
          launchGame(modeId);
        }
      })
      .catch(() => {
        launchGame(modeId);
      });
  },
  onCancelled: () => {
    const ticketId = backendTicketId;
    resetBackendMatchmakingState();

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
  onRoomAction: (action, payload) => handleModeHallRoomAction(action, payload),
  onInviteFriendToRoom: (gameId) => handleModeHallInviteFriend(gameId),
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
  onSendRegisterEmailCode: handleSendRegisterEmailCode,
  onRequestPasswordReset: handleRequestPasswordReset,
  onConfirmPasswordReset: handleConfirmPasswordReset,
  clerkEnabled: clientPlatformConfig.clerk.enabled,
  onClerkLoginStart: () => clerkBridge.openSignIn(),
  onLogoutSubmit: logoutToAnonymousScope,
  onFeatureAction: handleLobbyFeatureAction,
  onRequestDeveloperOverview: loadDeveloperAccountsOverview,
  getAuthStatus: getAuthStatusView,
  getAuthCapabilities: getAuthCapabilitiesView,
});

matchmakingUI.mount(overlayMount);
modeHallUI.mount(overlayMount);
lobbyUI.mount(overlayMount);
lobbyUI.refreshAuthStatus();
hydrateRuntimePlatformConfig();

void clerkBridge
  .initialize({
    onSessionToken: handleClerkSessionToken,
    onSignedOut: async () => {
      if (authService.getSession()?.method === "platform") {
        await logoutToAnonymousScope();
      }
    },
  })
  .then(async () => {
    if (!authService.getSession()) {
      await clerkBridge.resumeExistingSession();
    }
  })
  .catch((error) => {
    console.error("Failed to initialize Clerk bridge:", error);
    captureClientException(error, {
      phase: "startup",
      provider: "clerk",
    });
  });

if (authService.getSession()) {
  showLobby();
} else {
  showAuthGate();
}

applyInitialLaunchRoute();

if (authService.getSession()) {
  void syncAuthenticatedAccount(false)
    .then(() => {
      applyCheckoutReturnFeedback(initialCheckoutReturnState);
    })
    .catch((error) => {
      if (!authService.getSession()) {
        clearBackendAccountState();
        applyAnonymousScopeState();
        showAuthGate();
      } else {
        lobbyUI.refreshAuthStatus();
      }

      console.error("Failed to hydrate authenticated account:", error);
    });
} else {
  applyCheckoutReturnFeedback(initialCheckoutReturnState);
}

window.addEventListener("error", (event) => {
  captureClientException(event.error ?? new Error(event.message), {
    source: "window.error",
  });
});

window.addEventListener("unhandledrejection", (event) => {
  captureClientException(event.reason, {
    source: "window.unhandledrejection",
  });
});

/**
 * Register developer-only global console APIs.
 * Only available when current user has isDeveloper=true.
 */
function registerDeveloperDebugApis(): void {
  const session = authService.getSession();
  if (!session?.isDeveloper) {
    // Still expose a minimal info function (read-only).
    window.render_game_to_text = () =>
      JSON.stringify({
        phase,
        auth: { loggedIn: authService.isLoggedIn() },
        note: "Debug APIs require a developer account.",
      });
    // All other debug functions become no-ops.
    const noop = (): string => JSON.stringify({ ok: false, message: "Developer access required." });
    window.advanceTime = (_ms: number): void => { };
    window.export_gameplay_tuning = noop;
    window.apply_gameplay_tuning = (): string => noop();
    window.reset_gameplay_tuning = noop;
    window.debug_finish_match = (): string => noop();
    window.debug_set_best_record = (): string => noop();
    window.debug_reset_progression = (): string => noop();
    window.debug_set_progression = (): string => noop();
    window.debug_set_mode = (): string => noop();
    window.debug_open_mode_hall = (): string => noop();
    window.debug_room_simulate = (): string => noop();
    window.debug_set_zone = (): string => noop();
    window.debug_backend_login_demo = async (): Promise<string> => Promise.resolve(noop());
    window.debug_backend_guest_login = async (): Promise<string> => Promise.resolve(JSON.stringify({ ok: false, message: "guest login is disabled" }));
    window.debug_backend_logout = async (): Promise<string> => Promise.resolve(noop());
    window.debug_backend_match_start = async (): Promise<string> => Promise.resolve(noop());
    window.debug_backend_match_cancel = async (): Promise<string> => Promise.resolve(noop());
    window.debug_backend_match_status = async (): Promise<string> => Promise.resolve(noop());
    return;
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
        gameId: authService.getSession()?.gameId ?? null,
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
      if (!isSinglePlayerSessionSnapshot(snapshot)) {
        return window.render_game_to_text();
      }
      const previewMass = Math.max(snapshot.playerMass, snapshot.match.bestMassRecord + 500);
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
}

registerDeveloperDebugApis();
window.addEventListener("bop:auth-session-changed", () => {
  registerDeveloperDebugApis();
});

