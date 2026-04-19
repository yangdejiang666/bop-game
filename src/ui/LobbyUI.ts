import type { GameSettings } from "../app/settings";
import {
  type PlayerProgression,
  getRequiredXpForLevel,
  loadPlayerProgression,
} from "../app/progression";
import {
  buildRankEmblemSvg,
  getRankTierLabel,
  RANK_TIERS,
  type RankInfo,
} from "./modeHallRender";
import {
  type SkinOption,
  SKIN_OPTIONS,
  getSkinOption,
  resolveSkinId,
} from "../app/skins";
import type {
  DeveloperAccountsOverview,
  UserSummary,
} from "../../shared-protocol/src/user";
import type {
  RankQueueId,
  RankingLeaderboardEntry,
  RankingOverview,
} from "../../shared-protocol/src/ranking";
import { rankingService } from "../network/rankingService";
import type {
  SocialOverview,
  SocialRelationship,
  SocialSearchResult,
} from "../../shared-protocol/src/social";
import type { InGameMailItem } from "../../shared-protocol/src/mail";
import { networkConfig } from "../network/config";
import {
  lobbyService,
  type LobbyTask,
  type LobbyFriend,
  type LobbyModeSnapshot,
} from "../network/lobbyService";
import { mailService } from "../network/mailService";

export type LobbyModeId =
  | "ranked"
  | "peak"
  | "classic"
  | "battleRoyale";

export interface LobbyAuthStatus {
  loggedIn: boolean;
  userLabel: string;
  accountLabel?: string;
  gameId?: string;
}

export interface LobbyLoginPayload {
  account: string;
  password: string;
}

export interface LobbyRegisterPayload {
  account: string;
  password: string;
  nickname?: string;
  email?: string;
  emailCode?: string;
}

export type LobbyFeatureId = "shop" | "magic" | "friends" | "leaderboard" | "activity" | "signin";
type AuthMode = "login" | "register" | "reset";
type AuthBusyAction =
  | "login"
  | "register"
  | "resetRequest"
  | "resetConfirm"
  | "logout"
  | "clerk"
  | "registerEmailCode"
  | null;
type AuthNoticeTone = "error" | "hint" | "busy";
type AuthFieldTone = "error" | "hint";
type AuthFieldName =
  | "authLoginAccount"
  | "authLoginPassword"
  | "authRegisterNickname"
  | "authRegisterAccount"
  | "authRegisterEmail"
  | "authRegisterEmailCode"
  | "authRegisterPassword"
  | "authRegisterConfirmPassword"
  | "authResetAccount"
  | "authResetCode"
  | "authResetPassword"
  | "authResetConfirmPassword";
type AuthCodeCooldownKey = "registerEmail" | "resetEmail";

export interface LobbyAuthCapabilities {
  emailVerificationEnabled: boolean;
  emailProvider: "disabled" | "local" | "resend" | null;
}

interface AuthFieldFeedback {
  message: string;
  tone: AuthFieldTone;
}

interface LobbyUIOptions {
  settings: GameSettings;
  onOpenModeHall: (modeId: LobbyModeId) => void;
  onSettingsChange: (settings: GameSettings) => void;
  onSettingsOpened: () => void;
  onSettingsClosed: () => void;
  onLoginSubmit?: (payload: LobbyLoginPayload) => Promise<void>;
  onRegisterSubmit?: (payload: LobbyRegisterPayload) => Promise<void>;
  onLogoutSubmit?: () => Promise<void>;
  onRequestDeveloperOverview?: () => Promise<DeveloperAccountsOverview | null>;
  getAuthStatus?: () => LobbyAuthStatus;
  getAuthCapabilities?: () => LobbyAuthCapabilities;
  clerkEnabled?: boolean;
  onClerkLoginStart?: () => Promise<void> | void;
  onFeatureAction?: (feature: LobbyFeatureId) => Promise<void> | void;
  onSendRegisterEmailCode?: (payload: {
    email: string;
  }) => Promise<{ cooldownSeconds?: number }>;
  onRequestPasswordReset?: (payload: {
    account: string;
  }) => Promise<{ challengeId: string; cooldownSeconds?: number }>;
  onConfirmPasswordReset?: (payload: {
    challengeId: string;
    verificationCode: string;
    newPassword: string;
  }) => Promise<void>;
}
type StitchModeCardId =
  | "ranked"
  | "peak"
  | "classic"
  | "battleRoyale";

interface StitchModeCard {
  id: StitchModeCardId;
  modeId: LobbyModeId;
  kicker: string;
  name: string;
  subtitle: string;
  intro: string;
  metrics: Array<{
    label: string;
    value: string;
  }>;
  tags: string[];
  icon: string;
  theme: "cyan" | "violet" | "gold" | "neutral" | "red" | "amber" | "purple";
  status: string;
  bgImage: string;
}

const MAX_PLAYER_NAME_LENGTH = 12;
const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024;
const AUTH_ACCOUNT_MIN_LENGTH = 3;
const AUTH_PASSWORD_MIN_LENGTH = 6;
const AUTH_FIELD_NAMES: AuthFieldName[] = [
  "authLoginAccount",
  "authLoginPassword",
  "authRegisterNickname",
  "authRegisterAccount",
  "authRegisterEmail",
  "authRegisterEmailCode",
  "authRegisterPassword",
  "authRegisterConfirmPassword",
  "authResetAccount",
  "authResetCode",
  "authResetPassword",
  "authResetConfirmPassword",
];

const STITCH_MODE_CARDS: StitchModeCard[] = [
  {
    id: "ranked",
    modeId: "ranked",
    kicker: "竞技模式",
    name: "排位赛",
    subtitle: "向最高荣誉发起冲锋",
    intro: "正式上分入口，节奏稳定，适合盯段位、盯晋级、盯赛季窗口。",
    metrics: [
      { label: "当前段位", value: "暂无" },
      { label: "排位分", value: "暂无" },
      { label: "当前赛季", value: "未开启" },
    ],
    tags: [],
    icon: "trophy",
    theme: "gold",
    status: "暂无数据",
    bgImage: "/assets/images/ranked_bg.png"
  },
  {
    id: "peak",
    modeId: "peak",
    kicker: "精英模式",
    name: "巅峰赛",
    subtitle: "冷感冲榜，争夺更高席位",
    intro: "榜位压力更强，收益更高，适合盯前百和冲资格窗口的人。",
    metrics: [
      { label: "当前榜位", value: "未上榜" },
      { label: "巅峰分", value: "暂无" },
      { label: "当前赛季", value: "未开启" },
    ],
    tags: [],
    icon: "military_tech",
    theme: "violet",
    status: "暂无数据",
    bgImage: "/assets/images/peak_bg.png"
  },
  {
    id: "classic",
    modeId: "classic",
    kicker: "经典模式",
    name: "经典模式",
    subtitle: "主球体舞台，轻快又熟悉",
    intro: "最稳的练手区，适合练球感、刷最佳质量、拉一位好友随时开球。",
    metrics: [
      { label: "最佳纪录", value: "暂无" },
      { label: "总场次", value: "暂无" },
      { label: "胜场", value: "暂无" },
    ],
    tags: [],
    icon: "view_cozy",
    theme: "cyan",
    status: "暂无数据",
    bgImage: "/assets/images/classic_bg.png"
  },
  {
    id: "battleRoyale",
    modeId: "battleRoyale",
    kicker: "生存模式",
    name: "大逃杀",
    subtitle: "缩圈压迫，活到最后",
    intro: "危险圈、终圈运营和风险收益都被拉满，适合硬核求生和残局拉扯。",
    metrics: [
      { label: "最佳纪录", value: "暂无" },
      { label: "总场次", value: "暂无" },
      { label: "胜率", value: "暂无" },
    ],
    tags: [],
    icon: "local_fire_department",
    theme: "red",
    status: "暂无数据",
    bgImage: "/assets/images/royale_bg.png"
  },
];

const FEATURE_TIPS: Record<LobbyFeatureId, string> = {
  shop: "商店入口已预留，可继续接皮肤与道具接口。",
  magic: "魔法屋入口已预留，可继续接抽取与升级接口。",
  friends: "好友入口已预留，可继续接本地/联机社交关系。",
  leaderboard: "排行榜入口已预留，可继续接排名数据接口。",
  activity: "已打开活动与邮件中心，可查看封禁通知和申诉回信。",
  signin: "签到入口已预留，可继续接签到数据接口。",
};

// 提示：静态的 TASK_PRESETS 和 FRIEND_PRESETS 已被移除
// 动态数据改为从 network/lobbyService.ts 中获取

function renderMaterialSymbol(symbol: string, className: string) {
  return `<span class="material-symbols-outlined ${className}" aria-hidden="true">${symbol}</span>`;
}

export class LobbyUI {
  private root: HTMLDivElement;
  private settings: GameSettings;
  private progression: PlayerProgression;
  private readonly options: LobbyUIOptions;
  private readonly keydownHandler: (event: KeyboardEvent) => void;
  private readonly resizeHandler: () => void;
  private selectedCardId: StitchModeCardId = "ranked";
  private selectedModeId: LobbyModeId = "ranked";
  private selectedFeatureId: LobbyFeatureId = "magic";
  private tipTimer: number | null = null;
  private tasks: LobbyTask[] = [];
  private friends: LobbyFriend[] = [];
  private modeSnapshots: Partial<Record<StitchModeCardId, LobbyModeSnapshot>> = {};
  private socialOverview: SocialOverview | null = null;
  private socialSearchResult: SocialSearchResult | null = null;
  private socialBusy = false;
  private socialError = "";
  private lobbyRankInfo: RankInfo = { tierIndex: 0, division: 1, points: 0, stars: 0, totalPoints: 0 };
  private authMode: AuthMode = "login";
  private authBusy = false;
  private authBusyAction: AuthBusyAction = null;
  private authBusyMessage = "";
  private authError = "";
  private authNoticeTone: AuthNoticeTone = "hint";
  private authFieldFeedback: Partial<Record<AuthFieldName, AuthFieldFeedback>> = {};
  private authFocusedField: AuthFieldName | null = null;
  private authFeedbackResetTimer: number | null = null;
  private authResetChallengeId = "";
  private authCodeCooldowns: Record<AuthCodeCooldownKey, number> = {
    registerEmail: 0,
    resetEmail: 0,
  };
  private authCodeCooldownTimer: number | null = null;
  private fitLayoutFrame: number | null = null;
  private fitLayoutTimeout: number | null = null;
  private trayBottomAlignmentTimeout: number | null = null;
  private developerOverview: DeveloperAccountsOverview | null = null;
  private developerOverviewBusy = false;
  private developerOverviewError = "";
  private developerOverviewRequestVersion = 0;
  private rankingOverview: RankingOverview | null = null;
  private rankingLeaderboard: RankingLeaderboardEntry[] = [];
  private rankingSelectedQueue: RankQueueId = "ranked";
  private rankingBusy = false;
  private mailInbox: InGameMailItem[] = [];
  private mailBusy = false;
  private mailError = "";
  private mailDraftByNoticeId: Record<string, string> = {};
  private signinCheckedDays = 0;
  private signinTodayDone = false;

  constructor(options: LobbyUIOptions) {
    this.options = options;
    this.settings = { ...options.settings };
    this.progression = loadPlayerProgression();

    this.root = document.createElement("div");
    this.root.className = "lobby-overlay lobby-stitch-exact";
    this.root.innerHTML = this.buildTemplate();

    this.keydownHandler = (event) => {
      if (
        event.key === "Escape" &&
        this.root.classList.contains("is-settings-open")
      ) {
        this.closeSettings();
      }
    };
    this.resizeHandler = () => {
      this.syncLobbyFit();
      this.scheduleTrayBottomAlignment(96);
    };

    this.bindEvents();
    this.applySelectedModeUI();
    this.applyFeatureSelection();
    this.applySettingsToForm();
    this.applyAuthStatusToView();
    this.renderAuthPanel();
    this.renderDeveloperToolbox();
    this.renderSocialCenter();
    this.renderActivityCenter();
    this.syncDocumentScrollLock();
    this.syncLobbyFit();
  }

  mount(parent: HTMLElement) {
    parent.appendChild(this.root);
    window.addEventListener("keydown", this.keydownHandler);
    window.addEventListener("resize", this.resizeHandler);
    this.syncLobbyFit();
    this.scheduleTrayBottomAlignment(120);
  }

  destroy() {
    window.removeEventListener("keydown", this.keydownHandler);
    window.removeEventListener("resize", this.resizeHandler);
    if (this.tipTimer !== null) {
      window.clearTimeout(this.tipTimer);
      this.tipTimer = null;
    }
    if (this.authFeedbackResetTimer !== null) {
      window.clearTimeout(this.authFeedbackResetTimer);
      this.authFeedbackResetTimer = null;
    }
    if (this.authCodeCooldownTimer !== null) {
      window.clearInterval(this.authCodeCooldownTimer);
      this.authCodeCooldownTimer = null;
    }
    if (this.fitLayoutFrame !== null) {
      window.cancelAnimationFrame(this.fitLayoutFrame);
      this.fitLayoutFrame = null;
    }
    if (this.fitLayoutTimeout !== null) {
      window.clearTimeout(this.fitLayoutTimeout);
      this.fitLayoutTimeout = null;
    }
    if (this.trayBottomAlignmentTimeout !== null) {
      window.clearTimeout(this.trayBottomAlignmentTimeout);
      this.trayBottomAlignmentTimeout = null;
    }
    this.root.classList.remove(
      "is-visible",
      "is-modal-only",
      "is-settings-open",
    );
    this.syncDocumentScrollLock();
    this.root.remove();
  }

  showLobby() {
    this.refreshProgression();
    this.setSkinDrawerOpen(false);
    this.root.classList.add("is-visible");
    this.root.classList.remove(
      "is-modal-only",
      "is-settings-open",
      "is-auth-open",
      "is-auth-required",
    );
    this.syncDocumentScrollLock();
    const tip = this.root.querySelector<HTMLElement>("[data-inline-tip]");
    if (tip) {
      tip.textContent = "选择模式后点击进入分厅，匹配入口会在分厅内触发。";
    }
    (document.activeElement as HTMLElement | null)?.blur();
    this.syncLobbyFit();
    this.scheduleTrayBottomAlignment(140);
    void this.refreshLobbyData();
  }

  showAuthGate() {
    this.refreshProgression();
    this.setSkinDrawerOpen(false);
    this.clearAuthForms();
    this.root.classList.add("is-visible");
    this.root.classList.remove("is-modal-only", "is-settings-open");
    this.openAuthModal("login", true);
    this.syncDocumentScrollLock();
    this.syncLobbyFit();
    this.scheduleTrayBottomAlignment(140);
  }

  private async refreshLobbyData() {
    try {
      const data = await lobbyService.fetchLobbyData();
      this.tasks = data.tasks;
      this.friends = data.friends;
      this.modeSnapshots = data.modeSnapshots;
      this.socialOverview = data.overview;
      this.socialError = "";
      this.socialSearchResult = null;
      if (data.summary) {
        this.progression = this.toProgression(data.summary);
        this.applyProgressionToView();
      }

      const modeGridEl = this.root.querySelector<HTMLElement>("[data-mode-grid]");
      if (modeGridEl) {
        modeGridEl.innerHTML = this.buildModeCards();
      }
      this.applySelectedModeUI();

      const taskListEl = this.root.querySelector<HTMLElement>("[data-task-list-root]");
      if (taskListEl) taskListEl.innerHTML = this.buildTaskRows();
      const taskCounterEl = this.root.querySelector<HTMLElement>("[data-task-counter]");
      if (taskCounterEl) {
        taskCounterEl.textContent = this.buildTaskCounterLabel();
      }
      this.renderFriendsToLobby();
      this.renderSocialCenter();
      void this.refreshBackendPing();
      this.scheduleTrayBottomAlignment(160);
    } catch (e) {
      console.error("Failed to load lobby data", e);
      this.socialError = e instanceof Error ? e.message : "社交数据读取失败。";
      this.modeSnapshots = {};
      this.tasks = [];
      this.friends = [];
      this.socialOverview = null;
      this.socialSearchResult = null;
      const modeGridEl = this.root.querySelector<HTMLElement>("[data-mode-grid]");
      if (modeGridEl) {
        modeGridEl.innerHTML = this.buildModeCards();
      }
      this.applySelectedModeUI();
      const taskListEl = this.root.querySelector<HTMLElement>("[data-task-list-root]");
      if (taskListEl) {
        taskListEl.innerHTML = this.buildTaskRows();
      }
      const taskCounterEl = this.root.querySelector<HTMLElement>("[data-task-counter]");
      if (taskCounterEl) {
        taskCounterEl.textContent = this.buildTaskCounterLabel();
      }
      this.renderFriendsToLobby();
      this.renderSocialCenter();
      void this.refreshBackendPing();
      this.scheduleTrayBottomAlignment(160);
    }
  }

  public async refreshLobbyDataNow() {
    await this.refreshLobbyData();
  }

  public setSocialOverview(overview: SocialOverview | null) {
    this.socialOverview = overview;
    if (overview) {
      this.friends = overview.friends.slice(0, 6).map((friend) => ({
        id: friend.gameId,
        userId: friend.userId,
        gameId: friend.gameId,
        name: friend.nickname,
        status: friend.isOnline ? "在线" : "离线",
        accent: this.resolveFriendAccent(friend.gameId),
      }));
    } else {
      this.friends = [];
    }

    this.renderFriendsToLobby();
    this.renderSocialCenter();
  }

  hideAll() {
    this.root.classList.remove(
      "is-visible",
      "is-modal-only",
      "is-settings-open",
      "is-auth-open",
      "is-auth-required",
      "is-skin-drawer-open",
    );
    this.syncDocumentScrollLock();
  }

  openSettings(modalOnly: boolean) {
    const status = this.options.getAuthStatus?.() ?? {
      loggedIn: false,
      userLabel: "游客",
    };
    if (!status.loggedIn) {
      this.openAuthModal("login", true);
      return;
    }

    this.root.classList.add("is-visible", "is-settings-open");
    this.root.classList.remove("is-auth-open", "is-auth-required");
    this.root.classList.toggle("is-modal-only", modalOnly);
    this.syncDocumentScrollLock();
    this.options.onSettingsOpened();
    void this.refreshDeveloperOverview();
    void this.refreshSocialOverview();
    this.root
      .querySelector<HTMLInputElement>('input[name="playerName"]')
      ?.focus();
  }

  setSettings(settings: GameSettings) {
    this.settings = { ...settings };
    this.applySettingsToForm();
  }

  refreshProgression() {
    this.progression = loadPlayerProgression();
    this.applyProgressionToView();
  }

  refreshAuthStatus() {
    this.applyAuthStatusToView();
    this.renderAuthPanel();
  }

  async refreshDeveloperOverview(force = false) {
    const status = this.options.getAuthStatus?.() ?? {
      loggedIn: false,
      userLabel: "游客",
    };

    if (!status.loggedIn) {
      this.developerOverview = null;
      this.developerOverviewBusy = false;
      this.developerOverviewError = "";
      this.renderDeveloperToolbox();
      return null;
    }

    if (!this.options.onRequestDeveloperOverview) {
      this.developerOverview = null;
      this.developerOverviewBusy = false;
      this.developerOverviewError = "开发者总览服务尚未接入。";
      this.renderDeveloperToolbox();
      return null;
    }

    if (this.developerOverviewBusy && !force) {
      return this.developerOverview;
    }

    const requestVersion = ++this.developerOverviewRequestVersion;
    this.developerOverviewBusy = true;
    this.developerOverviewError = "";
    this.renderDeveloperToolbox();

    try {
      const overview = await this.options.onRequestDeveloperOverview();
      if (requestVersion !== this.developerOverviewRequestVersion) {
        return this.developerOverview;
      }
      this.developerOverview = overview;
      return overview;
    } catch (error) {
      if (requestVersion !== this.developerOverviewRequestVersion) {
        return this.developerOverview;
      }
      this.developerOverview = null;
      this.developerOverviewError =
        error instanceof Error ? error.message : "开发者总览读取失败，请稍后重试。";
      return null;
    } finally {
      if (requestVersion === this.developerOverviewRequestVersion) {
        this.developerOverviewBusy = false;
        this.renderDeveloperToolbox();
      }
    }
  }

  private buildTemplate(): string {
    return `
            <div class="stitch-root">
                <div class="stitch-bg-streaks" aria-hidden="true">
                    <span class="stitch-streak stitch-streak--one"></span>
                    <span class="stitch-streak stitch-streak--two"></span>
                </div>

                <!-- 虚化光球 Bokeh -->
                <div class="stitch-bokeh-layer" aria-hidden="true">
                    <div class="stitch-bokeh stitch-bokeh--1"></div>
                    <div class="stitch-bokeh stitch-bokeh--2"></div>
                    <div class="stitch-bokeh stitch-bokeh--3"></div>
                    <div class="stitch-bokeh stitch-bokeh--4"></div>
                </div>

                <!-- 浮动粒子 -->
                <div class="stitch-particles" aria-hidden="true">
                    <span class="stitch-particle stitch-particle--1"></span>
                    <span class="stitch-particle stitch-particle--2"></span>
                    <span class="stitch-particle stitch-particle--3"></span>
                    <span class="stitch-particle stitch-particle--4"></span>
                    <span class="stitch-particle stitch-particle--5"></span>
                    <span class="stitch-particle stitch-particle--6"></span>
                    <span class="stitch-particle stitch-particle--7"></span>
                    <span class="stitch-particle stitch-particle--8"></span>
                </div>

                <!-- 角落装饰线 -->
                <div class="stitch-corner-decor stitch-corner-decor--tl" aria-hidden="true"></div>
                <div class="stitch-corner-decor stitch-corner-decor--tr" aria-hidden="true"></div>
                <div class="stitch-corner-decor stitch-corner-decor--bl" aria-hidden="true"></div>
                <div class="stitch-corner-decor stitch-corner-decor--br" aria-hidden="true"></div>

                <!-- 扫描线 -->
                <div class="stitch-scan-line" aria-hidden="true"></div>

                <div class="stitch-scale-frame" data-lobby-scale-frame>
                    <header class="stitch-topbar stitch-hud-top">
                        <div class="stitch-brand stitch-hud-brand">
                            <svg class="stitch-brand-logo" viewBox="0 0 40 40" width="40" height="40" fill="none" xmlns="http://www.w3.org/2000/svg" style="overflow: visible;">
                                <defs>
                                    <radialGradient id="scifi-core" cx="50%" cy="50%" r="50%">
                                        <stop offset="0%" stop-color="#ffffff"/>
                                        <stop offset="30%" stop-color="#80f0ff"/>
                                        <stop offset="100%" stop-color="#0066ff" stop-opacity="0"/>
                                    </radialGradient>
                                    <linearGradient id="scifi-ring" x1="0%" y1="0%" x2="100%" y2="100%">
                                        <stop offset="0%" stop-color="#00f0ff"/>
                                        <stop offset="50%" stop-color="#b05cff"/>
                                        <stop offset="100%" stop-color="#00f0ff"/>
                                    </linearGradient>
                                    <filter id="scifi-glow" x="-50%" y="-50%" width="200%" height="200%">
                                        <feGaussianBlur stdDeviation="3" result="blur"/>
                                        <feComposite in="SourceGraphic" in2="blur" operator="over"/>
                                    </filter>
                                </defs>
                                <circle cx="20" cy="20" r="16" stroke="url(#scifi-ring)" stroke-width="1.5" stroke-dasharray="60 20" opacity="0.9" filter="url(#scifi-glow)">
                                    <animateTransform attributeName="transform" type="rotate" from="0 20 20" to="360 20 20" dur="8s" repeatCount="indefinite" />
                                </circle>
                                <circle cx="20" cy="20" r="12" stroke="url(#scifi-ring)" stroke-width="1" stroke-dasharray="25 15" opacity="0.6">
                                    <animateTransform attributeName="transform" type="rotate" from="360 20 20" to="0 20 20" dur="5s" repeatCount="indefinite" />
                                </circle>
                                <circle cx="20" cy="20" r="7" fill="url(#scifi-core)" filter="url(#scifi-glow)">
                                    <animate attributeName="r" values="6;8;6" dur="2s" repeatCount="indefinite" />
                                </circle>
                                <circle cx="20" cy="2" r="1.5" fill="#ffffff" filter="url(#scifi-glow)">
                                    <animateTransform attributeName="transform" type="rotate" from="0 20 20" to="360 20 20" dur="4s" repeatCount="indefinite" />
                                </circle>
                                <circle cx="20" cy="38" r="1.5" fill="#80f0ff" filter="url(#scifi-glow)">
                                    <animateTransform attributeName="transform" type="rotate" from="180 20 20" to="540 20 20" dur="4s" repeatCount="indefinite" />
                                </circle>
                            </svg>
                            <div class="stitch-brand-text">
                                <strong class="stitch-brand-title">无畏球球</strong>
                                <div class="stitch-online-counter">
                                    <span class="stitch-online-dot"></span>
                                    <span class="stitch-online-num" data-online-count>1,247</span>
                                    <span>在线</span>
                                </div>
                            </div>
                        </div>

                        <div class="stitch-top-actions stitch-hud-actions">
                            <button type="button" class="stitch-auth-btn stitch-hud-btn-text stitch-hud-btn-text--accent" data-auth-action aria-label="账号操作">
                                ${renderMaterialSymbol("fingerprint", "stitch-hud-btn-symbol")}
                                <span class="stitch-auth-btn-label" data-auth-label>未接入</span>
                            </button>
                            <button type="button" class="stitch-hud-btn" data-open-settings aria-label="设置">
                                ${renderMaterialSymbol("settings", "stitch-hud-btn-symbol")}
                            </button>
                        </div>
                    </header>

                    <!-- 活动公告横幅 -->
                    <div class="stitch-event-banner" data-event-banner>
                        <span class="stitch-event-badge">限时</span>
                        <span class="stitch-event-text">🎉 新赛季「星际征途」已开启 — 首胜获得限定皮肤「极光幻影」</span>
                        <span class="stitch-event-timer">剩余 6天 12:34:56</span>
                    </div>

                    <main class="stitch-main">
                        <aside class="stitch-left-col stitch-tac-sidebar glass-panel">
                            <!-- 皮肤预览舞台 -->
                            <div class="stitch-skin-preview-stage">
                                <div class="stitch-preview-label-id">S-GRADE // PREVIEW</div>
                                <div class="stitch-preview-ball-wrap">
                                    <div class="stitch-preview-ring stitch-preview-ring--outer" aria-hidden="true"></div>
                                    <div class="stitch-preview-ring" aria-hidden="true"></div>
                                    <div class="stitch-preview-ball" data-preview-ball></div>
                                    <div class="stitch-preview-hologram-glow"></div>
                                    <div class="stitch-preview-particles"></div>
                                </div>
                                <div class="stitch-preview-pedestal"></div>
                                <div class="stitch-preview-skin-name-plate">
                                    <small>CURRENT NEURAL SKIN</small>
                                    <strong data-active-skin-title>经典蓝</strong>
                                </div>
                            </div>

                            <!-- 玩家信息 -->
                            <div class="stitch-player-info-section">
                                <div class="stitch-section-header">PROFILE // ENTITY</div>
                                <div class="stitch-player-name-row">
                                    <span class="stitch-player-name-display" data-player-name>勇者球球</span>
                                    <span class="stitch-player-tag">#7788</span>
                                </div>
                                <div class="stitch-player-uid-row">
                                    <span class="stitch-uid-label">ID</span>
                                    <span class="stitch-uid-value" data-player-uid></span>
                                </div>
                                <div class="stitch-rank-badge-row" data-lobby-rank-badge></div>
                                
                                <div class="stitch-player-stats-grid">
                                    <div class="stitch-stat-box">
                                        <div class="stitch-stat-icon">${renderMaterialSymbol("stars", "")}</div>
                                        <div class="stitch-stat-data">
                                            <small>等级</small>
                                            <strong data-progression-level>1</strong>
                                        </div>
                                    </div>
                                    <div class="stitch-stat-box">
                                        <div class="stitch-stat-icon">${renderMaterialSymbol("trending_up", "")}</div>
                                        <div class="stitch-stat-data">
                                            <small>胜率</small>
                                            <strong data-progression-winrate>0%</strong>
                                        </div>
                                    </div>
                                    <div class="stitch-stat-box">
                                        <div class="stitch-stat-icon">${renderMaterialSymbol("weight", "")}</div>
                                        <div class="stitch-stat-data">
                                            <small>最佳</small>
                                            <strong data-progression-best-mass>0</strong>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- 皮肤选择网格 -->
                            <div class="stitch-skin-select-section">
                                <div class="stitch-skin-select-head">
                                    <strong>皮肤</strong>
                                    <small>${SKIN_OPTIONS.length}款</small>
                                </div>
                                <div class="stitch-skin-select-grid">
                                    ${this.buildSkinSelectGrid()}
                                </div>
                            </div>
                        </aside>

                        <section class="stitch-right-col stitch-stage-col">
                            <section class="stitch-mode-panel glass-panel">
                                <div class="stitch-panel-head">
                                    <div>
                                        <strong>模式选择</strong>
                                        <small>选择一个模式，直接进入对应分厅</small>
                                    </div>
                                    <span class="stitch-mode-status" data-mode-status>暂无数据</span>
                                </div>
                                    <div class="stitch-mode-grid" data-mode-grid>
                                        ${this.buildModeCards()}
                                    </div>
                                </section>

                            <div class="stitch-spacer" style="flex:1;"></div>

                            <section class="stitch-core-launch-stage glass-panel">
                                <section class="stitch-launch-brief">
                                    <span class="stitch-launch-brief-kicker">当前入口 / 准备就绪</span>
                                    <div class="stitch-launch-brief-head">
                                        <strong data-selected-mode-name>排位赛</strong>
                                        <span class="stitch-launch-brief-status" data-mode-status>暂无数据</span>
                                    </div>
                                    <p data-selected-mode-subtitle>向最高荣誉发起冲锋</p>
                                    <div class="stitch-launch-brief-stats">
                                        <article class="stitch-launch-brief-stat">
                                            <span>主轴情报</span>
                                            <strong data-selected-mode-metric-a>暂无</strong>
                                        </article>
                                        <article class="stitch-launch-brief-stat">
                                            <span>排队焦点</span>
                                            <strong data-selected-mode-metric-b>暂无</strong>
                                        </article>
                                    </div>
                                    <div class="stitch-launch-brief-tags" data-selected-mode-tags>
                                        <span class="stitch-launch-brief-tag">暂无后端统计</span>
                                    </div>
                                </section>
                                <button type="button" class="stitch-launch-btn" data-start-game>
                                    <div class="stitch-launch-pulse"></div>
                                    <div class="stitch-launch-border"></div>
                                    <div class="stitch-launch-inner">
                                        <span class="stitch-launch-text" data-launch-label>进入排位分厅</span>
                                        <small class="stitch-launch-ms" data-launch-code>// 排位赛频道就绪</small>
                                    </div>
                                    <div class="stitch-launch-flare"></div>
                                </button>
                            </section>
                        </section>
                    </main>
                    
                    <!-- 悬浮 Dock 和 抽屉遮罩 -->
                    <div class="stitch-drawer-backdrop" data-drawer-backdrop></div>
                    
                    <!-- 实时信息横条 -->
                    <div class="stitch-live-ticker">
                        <span class="stitch-ticker-icon">📢</span>
                        <div class="stitch-ticker-track">
                            <div class="stitch-ticker-content">
                                <span class="stitch-ticker-item"><strong>球球小明</strong> 刚刚在大逃杀中获得第1名！</span>
                                <span class="stitch-ticker-item"><strong>暗夜猎手</strong> 解锁了传说皮肤「星河之翼」</span>
                                <span class="stitch-ticker-item"><strong>系统公告</strong> 新模式「团队风暴」即将上线</span>
                                <span class="stitch-ticker-item"><strong>球球大师</strong> 排位赛连胜12局！</span>
                                <span class="stitch-ticker-item"><strong>新赛季</strong> S12「星际征途」火热进行中</span>
                            </div>
                        </div>
                    </div>

                    <footer class="stitch-base-tray">
                        <div class="stitch-tray-plate"></div>
                        <div class="stitch-hud-server-ping stitch-hud-server-ping--bottom">
                            <span class="ping-dot"></span>
                            <span class="ping-ms" data-backend-ping>网络延迟: 检测中 | 正在探测后端</span>
                        </div>
                        <nav class="stitch-tray-nav">
                            <button type="button" class="stitch-tray-btn" data-toggle-drawer="friends" aria-label="好友">
                                ${renderMaterialSymbol("group", "stitch-tray-symbol")}
                                <span>好友</span>
                            </button>
                            <button type="button" class="stitch-tray-btn" data-toggle-drawer="leaderboard" aria-label="排行榜">
                                ${renderMaterialSymbol("leaderboard", "stitch-tray-symbol")}
                                <span>排行榜</span>
                            </button>
                            <button type="button" class="stitch-tray-btn" data-toggle-drawer="shop" aria-label="商店">
                                ${renderMaterialSymbol("shopping_bag", "stitch-tray-symbol")}
                                <span>商店</span>
                            </button>
                            <button type="button" class="stitch-tray-btn" data-toggle-drawer="activity" aria-label="活动">
                                ${renderMaterialSymbol("celebration", "stitch-tray-symbol")}
                                <span>活动</span>
                            </button>
                        </nav>
                        <div class="stitch-tray-glowline"></div>
                    </footer>

                    <!-- 左侧战术抽屉：系统任务 -->
                    <aside class="stitch-z4-drawer is-left" data-drawer-name="tasks">
                        <div class="stitch-z4-glow-edge"></div>
                        <div class="stitch-z4-content glass-panel" style="margin: 20px; border-radius: 20px;">
                            <div class="stitch-z4-head">
                                <div class="stitch-z4-headline">
                                    <span class="stitch-z4-kicker">/ MISSION LOG</span>
                                    <strong>每日签发指令</strong>
                                </div>
                                <span class="stitch-z4-counter" data-task-counter>暂无任务</span>
                            </div>
                            <div class="stitch-z4-body">
                                <div class="stitch-task-list" data-task-list-root>
                                    ${this.buildTaskRows()}
                                </div>
                            </div>
                        </div>
                    </aside>

                    <!-- 右侧情报抽屉：好友中心 -->
                    <aside class="stitch-z4-drawer is-right" data-drawer-name="friends">
                        <div class="stitch-z4-content glass-panel" style="margin: 20px; border-radius: 20px;">
                            <div class="stitch-z4-head">
                                <div class="stitch-z4-headline">
                                    <span class="stitch-z4-kicker">/ SOCIAL HUB</span>
                                    <strong>好友中心</strong>
                                </div>
                                <button type="button" class="stitch-ghost-btn stitch-friend-refresh-btn" data-social-refresh>
                                    ${renderMaterialSymbol("sync", "stitch-friend-refresh-icon")}
                                    <span>刷新</span>
                                </button>
                            </div>

                            <!-- 统计概览 -->
                            <div class="stitch-social-overview-bar" data-social-center>
                                <div class="stitch-social-stat">
                                    <strong data-social-count-friends>--</strong>
                                    <span>好友</span>
                                </div>
                                <div class="stitch-social-stat stitch-social-stat--alert">
                                    <strong data-social-count-incoming>--</strong>
                                    <span>待处理</span>
                                </div>
                                <div class="stitch-social-stat">
                                    <strong data-social-count-outgoing>--</strong>
                                    <span>已发送</span>
                                </div>
                                <div class="stitch-social-stat">
                                    <strong data-social-count-blocks>--</strong>
                                    <span>黑名单</span>
                                </div>
                            </div>

                            <!-- UID 搜索栏 -->
                            <div class="stitch-social-search-bar">
                                <div class="stitch-social-search-input-wrap">
                                    ${renderMaterialSymbol("search", "stitch-social-search-icon")}
                                    <input type="text" inputmode="numeric" pattern="\\d*" maxlength="9"
                                    placeholder="输入 1-11 位 UID 查找玩家"
                                           data-social-search-input
                                           class="stitch-social-search-input" />
                                </div>
                                <button type="button" class="stitch-social-search-btn" data-social-search-btn>
                                    ${renderMaterialSymbol("person_search", "")}
                                </button>
                            </div>
                            <div class="stitch-social-search-result" data-social-search-result></div>

                            <!-- 分页标签 -->
                            <div class="stitch-social-tabs" data-social-tabs>
                                <button type="button" class="stitch-social-tab is-active" data-social-tab="friends">
                                    ${renderMaterialSymbol("group", "")}
                                    <span>好友</span>
                                </button>
                                <button type="button" class="stitch-social-tab" data-social-tab="requests">
                                    ${renderMaterialSymbol("mail", "")}
                                    <span>申请</span>
                                </button>
                                <button type="button" class="stitch-social-tab" data-social-tab="blacklist">
                                    ${renderMaterialSymbol("block", "")}
                                    <span>黑名单</span>
                                </button>
                            </div>

                            <!-- 好友列表 -->
                            <div class="stitch-social-panel" data-social-panel="friends">
                                <div class="stitch-social-list" data-social-friend-list></div>
                            </div>

                            <!-- 申请列表 (收到 + 发出) -->
                            <div class="stitch-social-panel is-hidden" data-social-panel="requests">
                                <div class="stitch-social-sub-label">
                                    ${renderMaterialSymbol("call_received", "")}
                                    <span>收到的申请</span>
                                </div>
                                <div class="stitch-social-list" data-social-incoming-list></div>
                                <div class="stitch-social-sub-label" style="margin-top:12px;">
                                    ${renderMaterialSymbol("call_made", "")}
                                    <span>我发出的</span>
                                </div>
                                <div class="stitch-social-list" data-social-outgoing-list></div>
                            </div>

                            <!-- 黑名单列表 -->
                            <div class="stitch-social-panel is-hidden" data-social-panel="blacklist">
                                <div class="stitch-social-list" data-social-block-list></div>
                            </div>

                            <div class="stitch-social-status-bar" data-social-status>登录后可通过 UID 查找好友。</div>
                        </div>
                        <div class="stitch-z4-glow-edge"></div>
                    </aside>

                    <!-- 排行榜抽屉 -->
                    <aside class="stitch-z4-drawer is-right" data-drawer-name="leaderboard">
                        <div class="stitch-z4-content glass-panel" style="margin: 20px; border-radius: 20px;">
                            <div class="stitch-z4-head">
                                <div class="stitch-z4-headline">
                                    <span class="stitch-z4-kicker">/ RANKING</span>
                                    <strong>段位排行榜</strong>
                                </div>
                                <button type="button" class="stitch-ghost-btn" data-ranking-refresh>刷新</button>
                            </div>
                            <div class="stitch-z4-body" data-ranking-body>
                                <div class="stitch-drawer-tabs" data-ranking-tabs>
                                    <button type="button" class="stitch-drawer-tab is-active" data-ranking-queue="ranked">排位赛</button>
                                    <button type="button" class="stitch-drawer-tab" data-ranking-queue="peak">巅峰赛</button>
                                    <button type="button" class="stitch-drawer-tab" data-ranking-queue="battleRoyale">大逃杀</button>
                                </div>
                                <div class="stitch-ranking-season" data-ranking-season>
                                    <span class="stitch-z4-kicker">当前赛季</span>
                                    <strong data-ranking-season-name>加载中...</strong>
                                </div>
                                <div class="stitch-ranking-my-rank" data-ranking-myrank>
                                    <div class="stitch-ranking-my-card">
                                        <span class="stitch-ranking-my-label">我的段位</span>
                                        <strong data-ranking-my-tier>--</strong>
                                        <span data-ranking-my-score>排位分: --</span>
                                        <span data-ranking-my-winrate>胜率: --</span>
                                    </div>
                                </div>
                                <div class="stitch-ranking-list" data-ranking-list>
                                    <div class="stitch-drawer-empty">
                                        ${renderMaterialSymbol("emoji_events", "stitch-drawer-empty-icon")}
                                        <strong>登录后查看排行榜</strong>
                                        <small>排行数据将从服务器实时拉取</small>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="stitch-z4-glow-edge"></div>
                    </aside>

                    <!-- 商店抽屉 -->
                    <aside class="stitch-z4-drawer is-right" data-drawer-name="shop">
                        <div class="stitch-z4-content glass-panel" style="margin: 20px; border-radius: 20px;">
                            <div class="stitch-z4-head">
                                <div class="stitch-z4-headline">
                                    <span class="stitch-z4-kicker">/ STORE</span>
                                    <strong>皮肤商店</strong>
                                </div>
                                <div class="stitch-shop-coins">
                                    ${renderMaterialSymbol("stars", "stitch-shop-coin-icon")}
                                    <strong data-shop-coins>0</strong>
                                </div>
                            </div>
                            <div class="stitch-z4-body" data-shop-body>
                                <div class="stitch-shop-grid" data-shop-grid>
                                    ${this.buildShopItems()}
                                </div>
                            </div>
                        </div>
                        <div class="stitch-z4-glow-edge"></div>
                    </aside>

                    <!-- 活动抽屉 -->
                    <aside class="stitch-z4-drawer is-right" data-drawer-name="activity">
                        <div class="stitch-z4-content glass-panel" style="margin: 20px; border-radius: 20px;">
                            <div class="stitch-z4-head">
                                <div class="stitch-z4-headline">
                                    <span class="stitch-z4-kicker">/ EVENTS</span>
                                    <strong>活动与邮件中心</strong>
                                </div>
                                <button type="button" class="stitch-z4-link" data-mail-refresh>
                                    ${renderMaterialSymbol("refresh", "")}
                                    <span>刷新</span>
                                </button>
                            </div>
                            <div class="stitch-z4-body" data-activity-body>
                                <div class="stitch-social-status" data-mail-status>点击刷新加载邮件。</div>
                                <div class="stitch-activity-list" data-activity-list>
                                    <article class="stitch-social-card stitch-social-card--empty">
                                        <span class="material-symbols-outlined">mail</span>
                                        <strong>邮件中心</strong>
                                        <small>登录后查看封禁通知、申诉进度和系统回信。</small>
                                    </article>
                                </div>
                            </div>
                        </div>
                        <div class="stitch-z4-glow-edge"></div>
                    </aside>

                </div>

                <div class="stitch-inline-tip" data-inline-tip aria-live="polite"></div>
            </div>

            <input type="file" accept="image/*" data-avatar-input class="stitch-hidden-file-input" />

            <div class="stitch-settings-overlay">
                <div class="stitch-settings-panel" role="dialog" aria-modal="true" aria-labelledby="stitch-settings-title">
                    <div class="stitch-settings-head">
                        <div>
                            <small>SETTINGS</small>
                            <h2 id="stitch-settings-title">游戏设置</h2>
                        </div>
                        <button type="button" class="stitch-settings-close" data-close-settings aria-label="关闭设置">×</button>
                    </div>

                    <div class="stitch-settings-scroll">

                        <!-- 账号概览 -->
                        <section class="stitch-account-hero" aria-label="账号信息">
                            <div class="stitch-account-hero-main">
                                <span class="stitch-avatar-slot stitch-avatar-slot--settings" data-avatar-slot>
                                    <img class="stitch-avatar-img" data-avatar-img alt="头像" />
                                    <span class="stitch-avatar-fallback" data-avatar-fallback>球</span>
                                </span>
                                <div class="stitch-account-hero-meta">
                                    <strong data-settings-account-name>游客</strong>
                                    <div class="stitch-account-hero-badges">
                                        <span class="stitch-account-pill" data-settings-account-badge>游客模式</span>
                                        <span class="stitch-account-pill stitch-account-pill--sub" data-settings-account-state>未登录</span>
                                    </div>
                                    <span class="stitch-account-hero-hint" data-settings-account-hint>登录后同步进度</span>
                                </div>
                                <div class="stitch-settings-avatar-actions">
                                    <button type="button" class="stitch-ghost-btn" data-avatar-trigger>上传头像</button>
                                    <button type="button" class="stitch-ghost-btn" data-avatar-clear>清空</button>
                                </div>
                            </div>
                        </section>

                        <!-- 昵称 -->
                        <section class="stitch-settings-section stitch-settings-card">
                            <div class="stitch-settings-section-head">
                                <div><div class="stitch-settings-title">${renderMaterialSymbol("badge", "stitch-settings-icon")} 昵称</div></div>
                            </div>
                            <label class="stitch-settings-field">
                                <span>玩家昵称</span>
                                <input type="text" name="playerName" maxlength="${MAX_PLAYER_NAME_LENGTH}" placeholder="输入展示昵称" />
                            </label>
                        </section>

                        <!-- 画面与帧率 -->
                        <section class="stitch-settings-section stitch-settings-card">
                            <div class="stitch-settings-section-head">
                                <div><div class="stitch-settings-title">${renderMaterialSymbol("monitor", "stitch-settings-icon")} 画面与帧率</div></div>
                            </div>
                            <div class="stitch-settings-grid">
                                <label class="stitch-settings-toggle">
                                    <input type="checkbox" name="showFps" />
                                    <span>显示帧率 (FPS)</span>
                                </label>
                                <label class="stitch-settings-toggle">
                                    <input type="checkbox" name="reducedMotion" />
                                    <span>减少动效（低配模式）</span>
                                </label>
                                <label class="stitch-settings-toggle">
                                    <input type="checkbox" name="showMinimap" />
                                    <span>显示小地图</span>
                                </label>
                                <label class="stitch-settings-toggle">
                                    <input type="checkbox" name="showLeaderboard" />
                                    <span>显示排行榜</span>
                                </label>
                            </div>
                        </section>

                        <!-- 声音与音效 -->
                        <section class="stitch-settings-section stitch-settings-card">
                            <div class="stitch-settings-section-head">
                                <div><div class="stitch-settings-title">${renderMaterialSymbol("volume_up", "stitch-settings-icon")} 声音与音效</div></div>
                            </div>
                            <div class="stitch-settings-slider-group">
                                <label class="stitch-settings-slider">
                                    <span>主音量</span>
                                    <input type="range" name="masterVolume" min="0" max="100" value="80" />
                                    <output>80%</output>
                                </label>
                                <label class="stitch-settings-slider">
                                    <span>音效</span>
                                    <input type="range" name="sfxVolume" min="0" max="100" value="100" />
                                    <output>100%</output>
                                </label>
                                <label class="stitch-settings-slider">
                                    <span>背景音乐</span>
                                    <input type="range" name="bgmVolume" min="0" max="100" value="50" />
                                    <output>50%</output>
                                </label>
                            </div>
                        </section>

                        <!-- 操作与按键 -->
                        <section class="stitch-settings-section stitch-settings-card">
                            <div class="stitch-settings-section-head">
                                <div><div class="stitch-settings-title">${renderMaterialSymbol("sports_esports", "stitch-settings-icon")} 操作与按键</div></div>
                            </div>
                            <div class="stitch-settings-keybind-list">
                                <div class="stitch-settings-keybind-row">
                                    <span>移动</span><kbd>鼠标 / 触屏拖动</kbd>
                                </div>
                                <div class="stitch-settings-keybind-row">
                                    <span>分裂</span><kbd>空格键</kbd>
                                </div>
                                <div class="stitch-settings-keybind-row">
                                    <span>吐球</span><kbd>W</kbd>
                                </div>
                                <div class="stitch-settings-keybind-row">
                                    <span>加速</span><kbd>Shift / 双击</kbd>
                                </div>
                            </div>
                        </section>

                        <!-- 好友管理 -->
                        <section class="stitch-settings-section stitch-settings-card" data-social-center>
                            <div class="stitch-settings-section-head">
                                <div><div class="stitch-settings-title">${renderMaterialSymbol("group", "stitch-settings-icon")} 好友管理</div></div>
                                <button type="button" class="stitch-ghost-btn" data-social-refresh>刷新</button>
                            </div>
                            <div class="stitch-devtool-summary stitch-social-summary">
                                <article class="stitch-devtool-metric"><strong data-social-count-friends>--</strong><span>好友</span></article>
                                <article class="stitch-devtool-metric"><strong data-social-count-incoming>--</strong><span>待处理</span></article>
                                <article class="stitch-devtool-metric"><strong data-social-count-outgoing>--</strong><span>已申请</span></article>
                                <article class="stitch-devtool-metric"><strong data-social-count-blocks>--</strong><span>黑名单</span></article>
                            </div>
                            <div class="stitch-social-search-row">
                                <label class="stitch-settings-field stitch-social-search-field">
                                    <span>UID 查找</span>
                                    <input type="text" inputmode="numeric" pattern="\\d*" maxlength="11" placeholder="输入 UID" data-social-search-input />
                                </label>
                                <button type="button" class="stitch-ghost-btn" data-social-search-btn>查找</button>
                            </div>
                            <div class="stitch-devtool-list" data-social-search-result></div>
                            <div class="stitch-devtool-list" data-social-friend-list></div>
                            <div class="stitch-devtool-list" data-social-incoming-list></div>
                            <div class="stitch-devtool-list" data-social-outgoing-list></div>
                            <div class="stitch-devtool-list" data-social-block-list></div>
                            <div class="stitch-devtool-status" data-social-status>登录后可查找好友</div>
                        </section>

                        <!-- 开发者（隐藏） -->
                        <section class="stitch-settings-section stitch-settings-card" style="display:none">
                            <div class="stitch-settings-section-head">
                                <div><div class="stitch-settings-title">开发者工具箱</div></div>
                                <button type="button" class="stitch-ghost-btn" data-devtool-refresh>刷新链路</button>
                            </div>
                            <div class="stitch-devtool-summary" data-devtool-summary></div>
                            <div class="stitch-devtool-current" data-devtool-current></div>
                            <div class="stitch-devtool-list" data-devtool-list></div>
                            <div class="stitch-devtool-status" data-devtool-status></div>
                        </section>
                    </div>

                    <footer class="stitch-settings-foot">
                        <button type="button" class="stitch-main-cta stitch-main-cta--small" data-close-settings>完成</button>
                    </footer>
                </div>
            </div>


            <div class="stitch-auth-overlay" data-auth-overlay>
                <div class="stitch-auth-dynamic-bg" aria-hidden="true">
                    <svg class="stitch-auth-grid-map" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                            <pattern id="auth-grid-pattern" width="60" height="60" patternUnits="userSpaceOnUse">
                                <path d="M 60 0 L 0 0 0 60" fill="none" stroke="rgba(0, 240, 255, 0.05)" stroke-width="1"/>
                                <circle cx="60" cy="60" r="1.5" fill="rgba(0, 240, 255, 0.2)"/>
                            </pattern>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#auth-grid-pattern)" style="transform: perspective(1000px) rotateX(60deg) scale(2); transform-origin: top center;" />
                    </svg>
                    <div class="stitch-dynamic-ball ball-1"></div>
                    <div class="stitch-dynamic-ball ball-2"></div>
                    <div class="stitch-dynamic-ball ball-3"></div>
                </div>

                <div class="stitch-auth-shell stitch-auth-shell--compact">
                    <div class="stitch-auth-panel" role="dialog" aria-modal="true" aria-labelledby="stitch-auth-title">
                        <span class="stitch-auth-panel-topline" aria-hidden="true"></span>

                        <div class="stitch-auth-head">
                            <div class="stitch-auth-brand-center">
                                <svg class="stitch-brand-logo" viewBox="0 0 40 40" width="56" height="56" fill="none" xmlns="http://www.w3.org/2000/svg" style="overflow: visible;">
                                    <defs>
                                        <radialGradient id="auth-scifi-core" cx="50%" cy="50%" r="50%">
                                            <stop offset="0%" stop-color="#ffffff"/>
                                            <stop offset="30%" stop-color="#80f0ff"/>
                                            <stop offset="100%" stop-color="#0066ff" stop-opacity="0"/>
                                        </radialGradient>
                                        <linearGradient id="auth-scifi-ring" x1="0%" y1="0%" x2="100%" y2="100%">
                                            <stop offset="0%" stop-color="#00f0ff"/>
                                            <stop offset="50%" stop-color="#b05cff"/>
                                            <stop offset="100%" stop-color="#00f0ff"/>
                                        </linearGradient>
                                        <filter id="auth-scifi-glow" x="-50%" y="-50%" width="200%" height="200%">
                                            <feGaussianBlur stdDeviation="3" result="blur"/>
                                            <feComposite in="SourceGraphic" in2="blur" operator="over"/>
                                        </filter>
                                    </defs>
                                    <circle cx="20" cy="20" r="16" stroke="url(#auth-scifi-ring)" stroke-width="1.5" stroke-dasharray="60 20" opacity="0.9" filter="url(#auth-scifi-glow)">
                                        <animateTransform attributeName="transform" type="rotate" from="0 20 20" to="360 20 20" dur="8s" repeatCount="indefinite" />
                                    </circle>
                                    <circle cx="20" cy="20" r="12" stroke="url(#auth-scifi-ring)" stroke-width="1" stroke-dasharray="25 15" opacity="0.6">
                                        <animateTransform attributeName="transform" type="rotate" from="360 20 20" to="0 20 20" dur="5s" repeatCount="indefinite" />
                                    </circle>
                                    <circle cx="20" cy="20" r="7" fill="url(#auth-scifi-core)" filter="url(#auth-scifi-glow)">
                                        <animate attributeName="r" values="6;8;6" dur="2s" repeatCount="indefinite" />
                                    </circle>
                                    <circle cx="20" cy="2" r="1.5" fill="#ffffff" filter="url(#auth-scifi-glow)">
                                        <animateTransform attributeName="transform" type="rotate" from="0 20 20" to="360 20 20" dur="4s" repeatCount="indefinite" />
                                    </circle>
                                    <circle cx="20" cy="38" r="1.5" fill="#80f0ff" filter="url(#auth-scifi-glow)">
                                        <animateTransform attributeName="transform" type="rotate" from="180 20 20" to="540 20 20" dur="4s" repeatCount="indefinite" />
                                    </circle>
                                </svg>
                                <h2 id="stitch-auth-title" class="stitch-auth-hero-title">无畏球球</h2>
                            </div>
                            <button
                                type="button"
                                class="stitch-settings-close stitch-auth-close-btn"
                                data-auth-close
                                aria-label="关闭账号面板"
                            >
                                ×
                            </button>
                        </div>

                        <section class="stitch-auth-intro" data-auth-intro style="display: none;">
                            <div class="stitch-auth-intro-copy-wrap">
                                <strong data-auth-intro-title></strong>
                                <p data-auth-intro-copy></p>
                            </div>
                        </section>

                        <section class="stitch-auth-account-view" data-auth-account-view>
                            <span class="stitch-auth-account-chip">当前账号</span>
                            <strong data-auth-account-name>未登录</strong>
                            <small data-auth-account-label>云存档未接入</small>
                            <div class="stitch-auth-account-actions">
                                <button
                                    type="button"
                                    class="stitch-main-cta stitch-main-cta--small"
                                    data-auth-switch-mode="login"
                                >
                                    退出并切换账号
                                </button>
                                <button
                                    type="button"
                                    class="stitch-main-cta stitch-main-cta--small"
                                    data-auth-switch-mode="register"
                                >
                                    退出并注册新号
                                </button>
                            </div>
                            <button
                                type="button"
                                class="stitch-main-cta stitch-main-cta--small stitch-auth-logout-btn"
                                data-auth-logout
                            >
                                退出当前账号
                            </button>
                        </section>

                        <div class="stitch-auth-tabs" data-auth-tabs>
                            <button type="button" class="stitch-auth-tab is-active" data-auth-tab="login">登录</button>
                            <button type="button" class="stitch-auth-tab" data-auth-tab="register">注册</button>
                        </div>

                        <div class="stitch-auth-error" data-auth-error aria-live="polite"></div>

                        <form class="stitch-auth-form" data-auth-form="login">
                            <div class="stitch-auth-form-grid">
                                <label class="stitch-auth-field" data-auth-field="authLoginAccount">
                                    <span class="stitch-auth-field-label">
                                        ${renderMaterialSymbol("person", "stitch-auth-field-symbol")}
                                        <span>账号</span>
                                    </span>
                                    <input
                                        type="text"
                                        name="authLoginAccount"
                                        minlength="${AUTH_ACCOUNT_MIN_LENGTH}"
                                        maxlength="64"
                                        autocomplete="username"
                                        placeholder="输入已注册账号"
                                    />
                                    <span
                                        class="stitch-auth-field-popover"
                                        data-auth-field-popover="authLoginAccount"
                                        aria-live="polite"
                                    ></span>
                                </label>
                                <label class="stitch-auth-field" data-auth-field="authLoginPassword">
                                    <span class="stitch-auth-field-label">
                                        ${renderMaterialSymbol("lock", "stitch-auth-field-symbol")}
                                        <span>密码</span>
                                    </span>
                                    <input
                                        type="password"
                                        name="authLoginPassword"
                                        minlength="${AUTH_PASSWORD_MIN_LENGTH}"
                                        maxlength="64"
                                        autocomplete="current-password"
                                        placeholder="输入登录密码"
                                    />
                                    <span
                                        class="stitch-auth-field-popover"
                                        data-auth-field-popover="authLoginPassword"
                                        aria-live="polite"
                                    ></span>
                                </label>
                            </div>
                            <div class="stitch-auth-secondary-link-row">
                                <span class="stitch-auth-secondary-link-line" aria-hidden="true"></span>
                                <button
                                    type="button"
                                    class="stitch-auth-secondary-link"
                                    data-auth-link="forgot"
                                >
                                    忘记密码
                                </button>
                                <span class="stitch-auth-secondary-link-line" aria-hidden="true"></span>
                            </div>
                            <div class="stitch-auth-form-foot">
                                <p class="stitch-auth-form-note" data-auth-form-note="login">登录后自动接管当前本地进度。</p>
                                <button
                                    type="submit"
                                    class="stitch-main-cta stitch-auth-submit-btn"
                                    data-auth-submit="login"
                                >
                                    进入作战大厅
                                </button>
                            </div>
                        </form>

                        <form class="stitch-auth-form" data-auth-form="register">
                            <div class="stitch-auth-form-grid stitch-auth-form-grid--register">
                                <label class="stitch-auth-field" data-auth-field="authRegisterNickname">
                                    <span class="stitch-auth-field-label">
                                        ${renderMaterialSymbol("badge", "stitch-auth-field-symbol")}
                                        <span>昵称（可选）</span>
                                    </span>
                                    <input
                                        type="text"
                                        name="authRegisterNickname"
                                        maxlength="${MAX_PLAYER_NAME_LENGTH}"
                                        autocomplete="nickname"
                                        placeholder="例如：银河球长"
                                    />
                                    <span
                                        class="stitch-auth-field-popover"
                                        data-auth-field-popover="authRegisterNickname"
                                        aria-live="polite"
                                    ></span>
                                </label>
                                <label class="stitch-auth-field" data-auth-field="authRegisterAccount">
                                    <span class="stitch-auth-field-label">
                                        ${renderMaterialSymbol("alternate_email", "stitch-auth-field-symbol")}
                                        <span>账号</span>
                                    </span>
                                    <input
                                        type="text"
                                        name="authRegisterAccount"
                                        minlength="${AUTH_ACCOUNT_MIN_LENGTH}"
                                        maxlength="64"
                                        autocomplete="username"
                                        placeholder="至少 3 位账号"
                                    />
                                    <span
                                        class="stitch-auth-field-popover"
                                        data-auth-field-popover="authRegisterAccount"
                                        aria-live="polite"
                                    ></span>
                                </label>
                                <div class="stitch-auth-verify-block" data-auth-verify-block="register-email">
                                    <label class="stitch-auth-field" data-auth-field="authRegisterEmail">
                                        <span class="stitch-auth-field-label">
                                            ${renderMaterialSymbol("mail", "stitch-auth-field-symbol")}
                                            <span>邮箱</span>
                                        </span>
                                        <input
                                            type="email"
                                            name="authRegisterEmail"
                                            autocomplete="email"
                                            placeholder="用于接收注册验证码"
                                        />
                                        <span
                                            class="stitch-auth-field-popover"
                                            data-auth-field-popover="authRegisterEmail"
                                            aria-live="polite"
                                        ></span>
                                    </label>
                                    <div class="stitch-auth-verify-row" data-auth-verify-row="register-email">
                                        <label class="stitch-auth-field" data-auth-field="authRegisterEmailCode">
                                            <span class="stitch-auth-field-label">
                                                ${renderMaterialSymbol("mark_email_read", "stitch-auth-field-symbol")}
                                                <span>验证码</span>
                                            </span>
                                            <input
                                                type="text"
                                                name="authRegisterEmailCode"
                                                inputmode="numeric"
                                                maxlength="6"
                                                autocomplete="one-time-code"
                                                placeholder="输入 6 位验证码"
                                            />
                                            <span
                                                class="stitch-auth-field-popover"
                                                data-auth-field-popover="authRegisterEmailCode"
                                                aria-live="polite"
                                            ></span>
                                        </label>
                                        <button
                                            type="button"
                                            class="stitch-auth-send-code-btn"
                                            data-auth-send-code="register-email"
                                        >
                                            发送邮箱验证码
                                        </button>
                                    </div>
                                </div>
                                <label class="stitch-auth-field" data-auth-field="authRegisterPassword">
                                    <span class="stitch-auth-field-label">
                                        ${renderMaterialSymbol("vpn_key", "stitch-auth-field-symbol")}
                                        <span>密码</span>
                                    </span>
                                    <input
                                        type="password"
                                        name="authRegisterPassword"
                                        minlength="${AUTH_PASSWORD_MIN_LENGTH}"
                                        maxlength="64"
                                        autocomplete="new-password"
                                        placeholder="至少 6 位密码"
                                    />
                                    <span
                                        class="stitch-auth-field-popover"
                                        data-auth-field-popover="authRegisterPassword"
                                        aria-live="polite"
                                    ></span>
                                </label>
                                <label class="stitch-auth-field" data-auth-field="authRegisterConfirmPassword">
                                    <span class="stitch-auth-field-label">
                                        ${renderMaterialSymbol("verified_user", "stitch-auth-field-symbol")}
                                        <span>确认密码</span>
                                    </span>
                                    <input
                                        type="password"
                                        name="authRegisterConfirmPassword"
                                        minlength="${AUTH_PASSWORD_MIN_LENGTH}"
                                        maxlength="64"
                                        autocomplete="new-password"
                                        placeholder="再次输入密码"
                                    />
                                    <span
                                        class="stitch-auth-field-popover"
                                        data-auth-field-popover="authRegisterConfirmPassword"
                                        aria-live="polite"
                                    ></span>
                                </label>
                            </div>
                            <div class="stitch-auth-form-foot">
                                <p class="stitch-auth-form-note" data-auth-form-note="register">创建完成后会自动登录。</p>
                                <button
                                    type="submit"
                                    class="stitch-main-cta stitch-auth-submit-btn"
                                    data-auth-submit="register"
                                >
                                    注册并开启云档案
                                </button>
                            </div>
                        </form>

                        <div class="stitch-auth-reset-dialog" data-auth-reset-dialog>
                            <button
                                type="button"
                                class="stitch-auth-reset-dialog-backdrop"
                                data-auth-link="back-login"
                                aria-label="关闭找回密码弹窗"
                            ></button>
                            <div class="stitch-auth-reset-dialog-card">
                                <div class="stitch-auth-reset-dialog-head">
                                    <div class="stitch-auth-reset-dialog-copy">
                                        <span class="stitch-auth-reset-dialog-kicker">邮箱找回</span>
                                        <strong>通过绑定邮箱重置密码</strong>
                                        <p>输入账号后发送邮箱验证码，验证通过后设置新密码。</p>
                                    </div>
                                    <button
                                        type="button"
                                        class="stitch-auth-reset-dialog-close"
                                        data-auth-link="back-login"
                                        aria-label="关闭找回密码"
                                    >
                                        ${renderMaterialSymbol("close", "stitch-auth-reset-dialog-close-symbol")}
                                    </button>
                                </div>

                                <form class="stitch-auth-form stitch-auth-form--reset-dialog" data-auth-form="reset">
                                    <div class="stitch-auth-form-grid">
                                        <label class="stitch-auth-field" data-auth-field="authResetAccount">
                                            <span class="stitch-auth-field-label">
                                                ${renderMaterialSymbol("person_search", "stitch-auth-field-symbol")}
                                                <span>账号</span>
                                            </span>
                                            <input
                                                type="text"
                                                name="authResetAccount"
                                                minlength="${AUTH_ACCOUNT_MIN_LENGTH}"
                                                maxlength="64"
                                                autocomplete="username"
                                                placeholder="输入已注册账号"
                                            />
                                            <span
                                                class="stitch-auth-field-popover"
                                                data-auth-field-popover="authResetAccount"
                                                aria-live="polite"
                                            ></span>
                                        </label>
                                        <div class="stitch-auth-verify-block" data-auth-verify-block="reset-email">
                                            <div class="stitch-auth-verify-row" data-auth-verify-row="reset-email">
                                                <label class="stitch-auth-field" data-auth-field="authResetCode">
                                                    <span class="stitch-auth-field-label">
                                                        ${renderMaterialSymbol("mail_lock", "stitch-auth-field-symbol")}
                                                        <span>邮箱验证码</span>
                                                    </span>
                                                    <input
                                                        type="text"
                                                        name="authResetCode"
                                                        inputmode="numeric"
                                                        maxlength="6"
                                                        autocomplete="one-time-code"
                                                        placeholder="输入 6 位验证码"
                                                    />
                                                    <span
                                                        class="stitch-auth-field-popover"
                                                        data-auth-field-popover="authResetCode"
                                                        aria-live="polite"
                                                    ></span>
                                                </label>
                                                <button
                                                    type="button"
                                                    class="stitch-auth-send-code-btn"
                                                    data-auth-send-code="reset-email"
                                                >
                                                    发送找回验证码
                                                </button>
                                            </div>
                                        </div>
                                        <label class="stitch-auth-field" data-auth-field="authResetPassword">
                                            <span class="stitch-auth-field-label">
                                                ${renderMaterialSymbol("lock_reset", "stitch-auth-field-symbol")}
                                                <span>新密码</span>
                                            </span>
                                            <input
                                                type="password"
                                                name="authResetPassword"
                                                minlength="${AUTH_PASSWORD_MIN_LENGTH}"
                                                maxlength="64"
                                                autocomplete="new-password"
                                                placeholder="输入新的登录密码"
                                            />
                                            <span
                                                class="stitch-auth-field-popover"
                                                data-auth-field-popover="authResetPassword"
                                                aria-live="polite"
                                            ></span>
                                        </label>
                                        <label class="stitch-auth-field" data-auth-field="authResetConfirmPassword">
                                            <span class="stitch-auth-field-label">
                                                ${renderMaterialSymbol("task_alt", "stitch-auth-field-symbol")}
                                                <span>确认新密码</span>
                                            </span>
                                            <input
                                                type="password"
                                                name="authResetConfirmPassword"
                                                minlength="${AUTH_PASSWORD_MIN_LENGTH}"
                                                maxlength="64"
                                                autocomplete="new-password"
                                                placeholder="再次输入新密码"
                                            />
                                            <span
                                                class="stitch-auth-field-popover"
                                                data-auth-field-popover="authResetConfirmPassword"
                                                aria-live="polite"
                                            ></span>
                                        </label>
                                    </div>
                                    <div class="stitch-auth-form-foot">
                                        <p class="stitch-auth-form-note" data-auth-form-note="reset">输入账号后发送验证码，邮件会发到该账号绑定邮箱。</p>
                                        <button
                                            type="submit"
                                            class="stitch-main-cta stitch-auth-submit-btn"
                                            data-auth-submit="reset"
                                        >
                                            重置密码并返回登录
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>

                        <div class="stitch-auth-provider-row" data-auth-provider-row>
                            <span class="stitch-auth-provider-note">其他登录方式</span>
                            <button
                                type="button"
                                class="stitch-ghost-btn"
                                data-auth-clerk
                            >
                                使用 Clerk 登录
                            </button>
                        </div>

                        <div class="stitch-auth-bottom-note">
                            <span class="stitch-auth-bottom-note-dot"></span>
                            <span data-auth-bottom-note>没有账号时切到注册，首屏即可完成接入。</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
  }

  private buildModeCards(): string {
    return STITCH_MODE_CARDS.map((card) => {
      const presentation = this.getModeCardPresentation(card);
      const activeClass = card.id === this.selectedCardId ? " is-active" : "";
      const themeClass = ` is-theme-${card.theme}`;

      return `
                <article
                    class="stitch-mode-card flowing-border${themeClass}${activeClass}"
                    data-mode-card-id="${card.id}"
                    data-mode-id="${card.modeId}"
                    tabindex="0"
                    role="button"
                    aria-label="选择${card.name}"
                >
                    <div class="stitch-mode-card-bg" style="background-image: url('${card.bgImage}'); background-size: cover; background-position: center; border-radius: 20px;">
                        <div class="stitch-mode-bg-overlay" style="position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.2)); border-radius: 20px;"></div>
                        <span class="stitch-mode-bg-icon" style="opacity: 0.15; filter: blur(4px);">${renderMaterialSymbol(card.icon, "stitch-mode-bg-symbol")}</span>
                        <div class="stitch-mode-bg-pattern"></div>
                        <div class="stitch-mode-glow-orb"></div>
                    </div>
                    
                    <span class="stitch-mode-icon">${renderMaterialSymbol(card.icon, "stitch-mode-icon-symbol")}</span>
                    <div class="stitch-mode-text-content">
                        <span class="stitch-mode-card-kicker">${card.kicker}</span>
                        <strong class="stitch-mode-card-title">${card.name}</strong>
                        <p class="stitch-mode-card-subtitle">${card.subtitle}</p>
                        <div class="stitch-mode-card-brief">${card.intro}</div>
                        <div class="stitch-mode-card-metrics">
                            ${presentation.metrics
          .map(
            (metric) => `
                                    <article class="stitch-mode-card-metric">
                                        <span>${this.escapeHtml(metric.label)}</span>
                                        <strong>${this.escapeHtml(metric.value)}</strong>
                                    </article>
                                `,
          )
          .join("")}
                        </div>
                        <div class="stitch-mode-card-tags">
                            ${presentation.tags.length > 0
          ? presentation.tags
            .map(
              (tag) =>
                `<span class="stitch-mode-card-tag">${this.escapeHtml(tag)}</span>`,
            )
            .join("")
          : '<span class="stitch-mode-card-tag">暂无后端统计</span>'
        }
                        </div>
                    </div>

                </article>
            `;
    }).join("");
  }

  private buildTaskRows(): string {
    if (!this.tasks.length) {
      return `
            <article class="stitch-task-row stitch-task-row--empty">
                <div class="stitch-task-copy">
                    <strong>暂无后端任务数据</strong>
                    <span>任务接口接通后，这里只显示真实进度。</span>
                </div>
            </article>
        `;
    }

    return this.tasks.map(
      (task) => {
        const ratio = task.total > 0 ? Math.min(task.progress / task.total, 1) : 0;
        return `
            <article class="stitch-task-row">
                <span class="stitch-task-icon is-theme-${task.theme}">
                    ${renderMaterialSymbol(task.icon, "stitch-task-icon-symbol")}
                </span>
                <div class="stitch-task-copy">
                    <strong>${task.title}</strong>
                    <div class="stitch-task-bar">
                        <div class="stitch-task-fill is-theme-${task.theme}" style="width:${(ratio * 100).toFixed(1)}%"></div>
                    </div>
                </div>
                <span class="stitch-task-progress">${task.progress}/${task.total}</span>
            </article>
        `;
      }
    ).join("");
  }

  private buildFriendRows(): string {
    if (!this.friends.length) {
      return `
            <article class="stitch-friend-item stitch-friend-item--empty">
                <strong>暂无好友</strong>
                <small>后端返回好友后会显示在这里</small>
            </article>
            <button type="button" class="stitch-friend-item stitch-friend-add" data-feature="friends" aria-label="邀请好友">
                ${renderMaterialSymbol("add", "stitch-friend-add-symbol")}
            </button>
        `;
    }

    const rows = this.friends.map(
      (friend) => `
            <article class="stitch-friend-item">
                <span class="stitch-friend-avatar" style="--friend-accent:${friend.accent};">${friend.name.charAt(0)}</span>
                <strong>${friend.name}</strong>
                <small>${friend.status}</small>
            </article>
        `
    ).join("");

    return `${rows}
            <button type="button" class="stitch-friend-item stitch-friend-add" data-feature="friends" aria-label="邀请好友">
                ${renderMaterialSymbol("add", "stitch-friend-add-symbol")}
            </button>
        `;
  }

  private buildFriendCluster(): string {
    return this.friends.map(
      (friend) => `
            <span class="stitch-invite-avatar" style="--friend-accent:${friend.accent};">${friend.name.charAt(0)}</span>
        `
    ).join("");
  }

  private resolveFriendAccent(seed: string) {
    const palette = [
      "#81ecff",
      "#c37fff",
      "#ffe483",
      "#ff7d66",
      "#7effb4",
      "#6f90ff",
    ];
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    return palette[hash % palette.length];
  }

  private buildShopItems(): string {
    return SKIN_OPTIONS.map((skin) => {
      const isEquipped = this.settings.equippedSkinId === skin.id;
      const price = skin.id === "classic_blue" ? 0 : 200;
      return `
        <article class="stitch-shop-item${isEquipped ? " is-equipped" : ""}" data-shop-skin="${skin.id}">
            <div class="stitch-shop-item-preview" style="background: ${skin.colorB};">
                <div class="stitch-shop-item-ball" style="background: radial-gradient(circle at 35% 35%, ${skin.colorA}, ${skin.colorB});"></div>
            </div>
            <div class="stitch-shop-item-info">
                <strong>${skin.name}</strong>
                <span class="stitch-shop-item-price">
                    ${price === 0 ? "免费" : `${renderMaterialSymbol("stars", "stitch-shop-price-icon")} ${price}`}
                </span>
            </div>
            <button type="button" class="stitch-shop-item-btn${isEquipped ? " is-equipped" : ""}" data-shop-equip="${skin.id}">
                ${isEquipped ? "已装备" : "装备"}
            </button>
        </article>
      `;
    }).join("");
  }

  private buildSigninDays(): string {
    const rewards = [
      { day: 1, reward: "50 金币", icon: "stars" },
      { day: 2, reward: "100 金币", icon: "stars" },
      { day: 3, reward: "经验卡", icon: "card_giftcard" },
      { day: 4, reward: "200 金币", icon: "stars" },
      { day: 5, reward: "皮肤碎片", icon: "auto_awesome" },
      { day: 6, reward: "300 金币", icon: "stars" },
      { day: 7, reward: "稀有宝箱", icon: "redeem" },
    ];
    const checkedDays = this.signinCheckedDays;
    return rewards.map((r) => {
      const checked = checkedDays >= r.day;
      return `
        <div class="stitch-signin-day${checked ? " is-checked" : ""}">
            <span class="stitch-signin-day-num">Day ${r.day}</span>
            ${renderMaterialSymbol(checked ? "check_circle" : r.icon, "stitch-signin-day-icon")}
            <span class="stitch-signin-day-reward">${r.reward}</span>
        </div>
      `;
    }).join("");
  }

  private renderFriendsToLobby() {
    const friendListEl = this.root.querySelector<HTMLElement>("[data-friend-list-root]");
    if (friendListEl) {
      friendListEl.innerHTML = this.buildFriendRows();
    }

    const friendAvatarsEl = this.root.querySelector<HTMLElement>(".stitch-invite-avatars");
    if (friendAvatarsEl) {
      friendAvatarsEl.innerHTML = this.buildFriendCluster();
    }
  }

  private getSocialRelationshipLabel(relationship: SocialRelationship | "not_found") {
    switch (relationship) {
      case "self":
        return "这是你自己的 UID";
      case "friend":
        return "已是好友";
      case "incoming_pending":
        return "对方向你发来了好友申请";
      case "outgoing_pending":
        return "好友申请待对方同意";
      case "none":
        return "可发起好友申请";
      default:
        return "未找到该 UID";
    }
  }

  private buildSearchActionButtons(result: SocialSearchResult) {
    if (!result.found || !result.user) {
      return "";
    }

    const gameId = this.escapeHtml(result.user.gameId);
    if (result.relationship === "self") {
      return "";
    }
    if (result.relationship === "none") {
      return `
        <button type="button" class="stitch-ghost-btn" data-social-action="send-request" data-game-id="${gameId}">加好友</button>
        <button type="button" class="stitch-ghost-btn" data-social-action="block" data-game-id="${gameId}">加入黑名单</button>
      `;
    }
    if (result.relationship === "friend") {
      return `
        <button type="button" class="stitch-ghost-btn" data-social-action="remove-friend" data-game-id="${gameId}">取关好友</button>
        <button type="button" class="stitch-ghost-btn" data-social-action="block" data-game-id="${gameId}">加入黑名单</button>
      `;
    }
    if (result.relationship === "incoming_pending") {
      return `
        <button type="button" class="stitch-ghost-btn" data-social-action="block" data-game-id="${gameId}">加入黑名单</button>
      `;
    }
    if (result.relationship === "outgoing_pending") {
      return `
        <button type="button" class="stitch-ghost-btn" data-social-action="block" data-game-id="${gameId}">加入黑名单</button>
      `;
    }

    return "";
  }

  private renderSocialCenter() {
    const status = this.options.getAuthStatus?.() ?? {
      loggedIn: false,
      userLabel: "游客",
    };
    const stats = this.socialOverview?.counts;

    this.root
      .querySelectorAll<HTMLElement>("[data-social-count-friends]")
      .forEach((el) => {
        el.textContent = status.loggedIn ? `${stats?.friends ?? 0}` : "--";
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-social-count-incoming]")
      .forEach((el) => {
        el.textContent = status.loggedIn ? `${stats?.incomingRequests ?? 0}` : "--";
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-social-count-outgoing]")
      .forEach((el) => {
        el.textContent = status.loggedIn ? `${stats?.outgoingRequests ?? 0}` : "--";
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-social-count-blocks]")
      .forEach((el) => {
        el.textContent = status.loggedIn ? `${stats?.blocks ?? 0}` : "--";
      });

    const searchHost = this.root.querySelector<HTMLElement>("[data-social-search-result]");
    if (searchHost) {
      if (!status.loggedIn) {
        searchHost.innerHTML = "";
      } else if (!this.socialSearchResult) {
        searchHost.innerHTML = "";
      } else if (!this.socialSearchResult.found || !this.socialSearchResult.user) {
        searchHost.innerHTML = `<div class="stitch-social-card stitch-social-card--empty"><span class="material-symbols-outlined">person_off</span><strong>未找到该 UID</strong><small>请确认对方 UID 是否正确</small></div>`;
      } else {
        const user = this.socialSearchResult.user;
        const accent = this.resolveFriendAccent(user.gameId);
        searchHost.innerHTML = `
          <div class="stitch-social-card stitch-social-card--search" data-social-center>
            <div class="stitch-social-card-left">
              <span class="stitch-social-avatar" style="--friend-accent:${accent}">${this.escapeHtml(user.nickname.charAt(0))}</span>
            </div>
            <div class="stitch-social-card-body">
              <strong>${this.escapeHtml(user.nickname)}</strong>
              <small>UID ${this.escapeHtml(user.gameId)} · ${this.escapeHtml(this.getSocialRelationshipLabel(this.socialSearchResult.relationship))}</small>
            </div>
            <div class="stitch-social-card-actions">
              ${this.buildSearchActionButtons(this.socialSearchResult)}
            </div>
          </div>
        `;
      }
    }

    const friendListHost = this.root.querySelector<HTMLElement>("[data-social-friend-list]");
    if (friendListHost) {
      if (!status.loggedIn) {
        friendListHost.innerHTML = `<div class="stitch-social-card stitch-social-card--empty"><span class="material-symbols-outlined">lock</span><strong>未登录</strong><small>登录后查看好友列表</small></div>`;
      } else if (!this.socialOverview?.friends.length) {
        friendListHost.innerHTML = `<div class="stitch-social-card stitch-social-card--empty"><span class="material-symbols-outlined">group_off</span><strong>暂无好友</strong><small>通过 UID 搜索添加好友</small></div>`;
      } else {
        friendListHost.innerHTML = this.socialOverview.friends
          .map((friend) => {
            const accent = this.resolveFriendAccent(friend.gameId);
            const onlineClass = friend.isOnline ? "is-online" : "is-offline";
            return `
              <div class="stitch-social-card ${onlineClass}" data-social-center>
                <div class="stitch-social-card-left">
                  <span class="stitch-social-avatar" style="--friend-accent:${accent}">${this.escapeHtml(friend.nickname.charAt(0))}</span>
                  <span class="stitch-social-status-dot ${onlineClass}"></span>
                </div>
                <div class="stitch-social-card-body">
                  <strong>${this.escapeHtml(friend.nickname)}</strong>
                  <small>UID ${this.escapeHtml(friend.gameId)} · ${friend.isOnline ? "在线" : `离线 · ${this.escapeHtml(this.formatDateTime(friend.lastSeenAt))}`}</small>
                </div>
                <div class="stitch-social-card-actions">
                  <button type="button" class="stitch-social-action-btn stitch-social-action-btn--danger" data-social-action="remove-friend" data-game-id="${this.escapeHtml(friend.gameId)}" title="取关好友">
                    <span class="material-symbols-outlined">person_remove</span>
                  </button>
                  <button type="button" class="stitch-social-action-btn stitch-social-action-btn--danger" data-social-action="block" data-game-id="${this.escapeHtml(friend.gameId)}" title="加入黑名单">
                    <span class="material-symbols-outlined">block</span>
                  </button>
                </div>
              </div>
            `;
          })
          .join("");
      }
    }

    const incomingHost = this.root.querySelector<HTMLElement>("[data-social-incoming-list]");
    if (incomingHost) {
      if (!status.loggedIn) {
        incomingHost.innerHTML = "";
      } else if (!this.socialOverview?.incomingRequests.length) {
        incomingHost.innerHTML = `<div class="stitch-social-card stitch-social-card--empty"><span class="material-symbols-outlined">inbox</span><small>暂无待处理申请</small></div>`;
      } else {
        incomingHost.innerHTML = this.socialOverview.incomingRequests
          .map((request) => {
            const accent = this.resolveFriendAccent(request.counterpart.gameId);
            return `
              <div class="stitch-social-card stitch-social-card--request" data-social-center>
                <div class="stitch-social-card-left">
                  <span class="stitch-social-avatar" style="--friend-accent:${accent}">${this.escapeHtml(request.counterpart.nickname.charAt(0))}</span>
                </div>
                <div class="stitch-social-card-body">
                  <strong>${this.escapeHtml(request.counterpart.nickname)}</strong>
                  <small>UID ${this.escapeHtml(request.counterpart.gameId)} · ${this.escapeHtml(this.formatDateTime(request.createdAt))}</small>
                </div>
                <div class="stitch-social-card-actions">
                  <button type="button" class="stitch-social-action-btn stitch-social-action-btn--accept" data-social-action="accept-request" data-request-id="${this.escapeHtml(request.requestId)}" title="同意">
                    <span class="material-symbols-outlined">check_circle</span>
                  </button>
                  <button type="button" class="stitch-social-action-btn stitch-social-action-btn--reject" data-social-action="reject-request" data-request-id="${this.escapeHtml(request.requestId)}" title="拒绝">
                    <span class="material-symbols-outlined">cancel</span>
                  </button>
                  <button type="button" class="stitch-social-action-btn stitch-social-action-btn--danger" data-social-action="block" data-game-id="${this.escapeHtml(request.counterpart.gameId)}" title="拉黑">
                    <span class="material-symbols-outlined">block</span>
                  </button>
                </div>
              </div>
            `;
          })
          .join("");
      }
    }

    const outgoingHost = this.root.querySelector<HTMLElement>("[data-social-outgoing-list]");
    if (outgoingHost) {
      if (!status.loggedIn) {
        outgoingHost.innerHTML = "";
      } else if (!this.socialOverview?.outgoingRequests.length) {
        outgoingHost.innerHTML = `<div class="stitch-social-card stitch-social-card--empty"><span class="material-symbols-outlined">send</span><small>暂无已发送申请</small></div>`;
      } else {
        outgoingHost.innerHTML = this.socialOverview.outgoingRequests
          .map((request) => {
            const accent = this.resolveFriendAccent(request.counterpart.gameId);
            return `
              <div class="stitch-social-card stitch-social-card--pending" data-social-center>
                <div class="stitch-social-card-left">
                  <span class="stitch-social-avatar" style="--friend-accent:${accent}">${this.escapeHtml(request.counterpart.nickname.charAt(0))}</span>
                </div>
                <div class="stitch-social-card-body">
                  <strong>${this.escapeHtml(request.counterpart.nickname)}</strong>
                  <small>UID ${this.escapeHtml(request.counterpart.gameId)} · 等待对方同意</small>
                </div>
                <div class="stitch-social-card-actions">
                  <span class="stitch-social-pending-badge">待确认</span>
                </div>
              </div>
            `;
          })
          .join("");
      }
    }

    const blockHost = this.root.querySelector<HTMLElement>("[data-social-block-list]");
    if (blockHost) {
      if (!status.loggedIn) {
        blockHost.innerHTML = "";
      } else if (!this.socialOverview?.blocks.length) {
        blockHost.innerHTML = `<div class="stitch-social-card stitch-social-card--empty"><span class="material-symbols-outlined">shield</span><strong>黑名单为空</strong><small>当前没有拉黑记录</small></div>`;
      } else {
        blockHost.innerHTML = this.socialOverview.blocks
          .map((blocked) => {
            const accent = this.resolveFriendAccent(blocked.gameId);
            return `
              <div class="stitch-social-card stitch-social-card--blocked" data-social-center>
                <div class="stitch-social-card-left">
                  <span class="stitch-social-avatar stitch-social-avatar--blocked" style="--friend-accent:${accent}">${this.escapeHtml(blocked.nickname.charAt(0))}</span>
                </div>
                <div class="stitch-social-card-body">
                  <strong>${this.escapeHtml(blocked.nickname)}</strong>
                  <small>UID ${this.escapeHtml(blocked.gameId)} · ${this.escapeHtml(this.formatDateTime(blocked.blockedAt))}</small>
                </div>
                <div class="stitch-social-card-actions">
                  <button type="button" class="stitch-social-action-btn stitch-social-action-btn--accept" data-social-action="unblock" data-game-id="${this.escapeHtml(blocked.gameId)}" title="解除拉黑">
                    <span class="material-symbols-outlined">lock_open</span>
                  </button>
                </div>
              </div>
            `;
          })
          .join("");
      }
    }

    const socialRefreshButton = this.root.querySelector<HTMLButtonElement>(
      "[data-social-refresh]",
    );
    if (socialRefreshButton) {
      socialRefreshButton.disabled = this.socialBusy || !status.loggedIn;
    }

    const socialStatus = this.root.querySelector<HTMLElement>("[data-social-status]");
    if (socialStatus) {
      if (!status.loggedIn) {
        socialStatus.textContent = "登录后可通过 UID 查找好友、处理申请和管理黑名单。";
      } else if (this.socialBusy) {
        socialStatus.textContent = "正在同步社交数据...";
      } else if (this.socialError) {
        socialStatus.textContent = this.socialError;
      } else if (this.socialOverview) {
        socialStatus.textContent = `在线好友 ${this.socialOverview.friends.filter(f => f.isOnline).length}/${this.socialOverview.counts.friends}，待处理 ${this.socialOverview.counts.incomingRequests} 条申请`;
      } else {
        socialStatus.textContent = "点击刷新加载好友数据";
      }
    }
  }

  private getMailCategoryLabel(mail: InGameMailItem): string {
    if (mail.category === "ban_notice") return "封禁通知";
    if (mail.category === "ban_appeal") return "申诉提交";
    if (mail.category === "appeal_reply") return "申诉回信";
    return "系统邮件";
  }

  private shouldShowAppealComposer(mail: InGameMailItem): boolean {
    return (
      mail.category === "ban_notice" &&
      (mail.appealStatus === "pending" || mail.appealStatus === "submitted" || mail.appealStatus === "reviewing")
    );
  }

  private renderActivityCenter() {
    const status = this.options.getAuthStatus?.() ?? {
      loggedIn: false,
      userLabel: "游客",
    };
    const listHost = this.root.querySelector<HTMLElement>("[data-activity-list]");
    const statusHost = this.root.querySelector<HTMLElement>("[data-mail-status]");
    const refreshButton = this.root.querySelector<HTMLButtonElement>("[data-mail-refresh]");

    if (refreshButton) {
      refreshButton.disabled = this.mailBusy || !status.loggedIn;
    }

    if (!status.loggedIn) {
      if (statusHost) {
        statusHost.textContent = "登录后查看封禁通知、申诉进度和系统回信。";
      }
      if (listHost) {
        listHost.innerHTML = `
          <article class="stitch-social-card stitch-social-card--empty">
            <span class="material-symbols-outlined">lock</span>
            <strong>未登录</strong>
            <small>登录后可使用游戏内邮件申诉封禁。</small>
          </article>
        `;
      }
      return;
    }

    if (statusHost) {
      if (this.mailBusy) {
        statusHost.textContent = "正在同步邮件...";
      } else if (this.mailError) {
        statusHost.textContent = this.mailError;
      } else {
        const unreadCount = this.mailInbox.filter((item) => !item.readAt).length;
        statusHost.textContent = `共 ${this.mailInbox.length} 封邮件，未读 ${unreadCount} 封。`;
      }
    }

    if (!listHost) {
      return;
    }

    if (!this.mailInbox.length) {
      listHost.innerHTML = `
        <article class="stitch-social-card stitch-social-card--empty">
          <span class="material-symbols-outlined">mark_email_unread</span>
          <strong>暂无邮件</strong>
          <small>当前没有系统通知或申诉记录。</small>
        </article>
      `;
      return;
    }

    listHost.innerHTML = this.mailInbox
      .map((mail) => {
        const unreadBadge = !mail.readAt
          ? `<span class="stitch-social-pending-badge">未读</span>`
          : "";
        const appealDraft = this.mailDraftByNoticeId[mail.id] ?? "";
        const categoryLabel = this.escapeHtml(this.getMailCategoryLabel(mail));
        const canAppeal = this.shouldShowAppealComposer(mail);
        const appealStatus = this.escapeHtml(mail.appealStatus);
        const metaTime = this.escapeHtml(this.formatDateTime(mail.createdAt));
        return `
          <article class="stitch-social-card stitch-social-card--search" data-social-center>
            <div class="stitch-social-card-body" style="width:100%">
              <strong>${this.escapeHtml(mail.subject)}</strong>
              <small>${categoryLabel} · ${metaTime} · 状态 ${appealStatus}</small>
              <small style="white-space:pre-wrap;margin-top:8px;">${this.escapeHtml(mail.body)}</small>
              <div class="stitch-social-actions-inline">
                ${unreadBadge}
                ${!mail.readAt ? `<button type="button" class="stitch-ghost-btn" data-mail-action="mark-read" data-mail-id="${this.escapeHtml(mail.id)}">标记已读</button>` : ""}
              </div>
              ${canAppeal ? `
                <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px;">
                  <textarea
                    class="stitch-social-search-input"
                    rows="3"
                    maxlength="2000"
                    data-mail-appeal-input="${this.escapeHtml(mail.id)}"
                    placeholder="填写申诉理由（会通过游戏内邮件发给管理员）"
                  >${this.escapeHtml(appealDraft)}</textarea>
                  <div class="stitch-social-actions-inline">
                    <button type="button" class="stitch-ghost-btn" data-mail-action="submit-appeal" data-mail-id="${this.escapeHtml(mail.id)}">提交申诉</button>
                  </div>
                </div>
              ` : ""}
            </div>
          </article>
        `;
      })
      .join("");
  }

  private buildSkinSelectGrid(): string {
    return SKIN_OPTIONS.map((skin, idx) => {
      const rarity = idx % 5 === 0 ? "mythic" : idx % 3 === 0 ? "epic" : "rare";
      return `
            <button
                type="button"
                class="stitch-skin-select-item"
                data-skin-id="${skin.id}"
                data-skin-group="main"
                data-rarity="${rarity}"
                style="--skin-a:${skin.colorA};--skin-b:${skin.colorB};"
            >
                <div class="stitch-skin-item-bg"></div>
                <div class="stitch-skin-select-ball"
                     style="background: radial-gradient(circle at 35% 35%, rgba(255,255,255,0.3), transparent 50%), radial-gradient(circle, ${skin.colorA}, ${skin.colorB});">
                </div>
                <div class="stitch-skin-rarity-bar"></div>
                <span class="stitch-skin-select-label">${skin.name}</span>
                <div class="stitch-skin-selection-indicator"></div>
            </button>
        `;
    }).join("");
  }

  private bindEvents() {
    this.root
      .querySelectorAll<HTMLElement>("[data-toggle-drawer]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const targetDrawer = button.dataset.toggleDrawer;
          const currentDrawer = this.root.dataset.activeDrawer;
          if (currentDrawer === targetDrawer) {
            this.root.dataset.activeDrawer = "";
          } else {
            this.root.dataset.activeDrawer = targetDrawer;
            if (targetDrawer === "friends") void this.refreshSocialOverview();
            if (targetDrawer === "leaderboard") void this.refreshRankingDrawer();
            if (targetDrawer === "shop") this.refreshShopDrawer();
            if (targetDrawer === "activity") void this.refreshActivityCenter();
          }
        });
      });

    this.root
      .querySelector<HTMLElement>("[data-drawer-backdrop]")
      ?.addEventListener("click", () => {
        this.root.dataset.activeDrawer = "";
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-open-settings]")
      .forEach((element) => {
        element.addEventListener("click", () => this.openSettings(false));
      });

    this.root
      .querySelector<HTMLElement>("[data-devtool-refresh]")
      ?.addEventListener("click", () => {
        void this.refreshDeveloperOverview(true);
      });

    this.root
      .querySelector<HTMLElement>("[data-social-refresh]")
      ?.addEventListener("click", () => {
        void this.refreshSocialOverview();
      });

    this.root
      .querySelector<HTMLElement>("[data-mail-refresh]")
      ?.addEventListener("click", () => {
        void this.refreshActivityCenter();
      });

    this.root
      .querySelector<HTMLElement>("[data-ranking-refresh]")
      ?.addEventListener("click", () => {
        void this.refreshRankingDrawer();
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-ranking-queue]")
      .forEach((tab) => {
        tab.addEventListener("click", () => {
          const queueId = tab.dataset.rankingQueue as RankQueueId;
          this.rankingSelectedQueue = queueId;
          this.root.querySelectorAll<HTMLElement>("[data-ranking-queue]").forEach((t) =>
            t.classList.toggle("is-active", t.dataset.rankingQueue === queueId),
          );
          void this.refreshRankingDrawer();
        });
      });

    this.root
      .querySelector<HTMLElement>("[data-shop-grid]")
      ?.addEventListener("click", (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-shop-equip]");
        if (!btn) return;
        const skinId = btn.dataset.shopEquip ?? "";
        if (skinId) {
          this.updateSettings({ equippedSkinId: skinId });
          this.refreshShopDrawer();
          this.showFeatureTip(`已装备皮肤: ${getSkinOption(skinId).name}`);
        }
      });

    this.root
      .querySelector<HTMLElement>("[data-signin-action]")
      ?.addEventListener("click", () => {
        this.handleSigninAction();
      });

    this.root
      .querySelector<HTMLElement>("[data-social-search-btn]")
      ?.addEventListener("click", () => {
        void this.handleSocialSearch();
      });

    this.root
      .querySelector<HTMLInputElement>("[data-social-search-input]")
      ?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }
        event.preventDefault();
        void this.handleSocialSearch();
      });

    this.root
      .querySelector<HTMLElement>('[data-drawer-name="friends"]')
      ?.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        const actionEl = target?.closest<HTMLElement>("[data-social-action]");
        if (actionEl) {
          const action = actionEl.dataset.socialAction ?? "";
          const requestId = actionEl.dataset.requestId ?? "";
          const gameId = actionEl.dataset.gameId ?? "";
          void this.handleSocialAction(action, { requestId, gameId });
          return;
        }
        const tabEl = target?.closest<HTMLElement>("[data-social-tab]");
        if (tabEl) {
          const tabName = tabEl.dataset.socialTab ?? "friends";
          this.root.querySelectorAll<HTMLElement>("[data-social-tab]").forEach((t) =>
            t.classList.toggle("is-active", t.dataset.socialTab === tabName),
          );
          this.root.querySelectorAll<HTMLElement>("[data-social-panel]").forEach((p) =>
            p.classList.toggle("is-hidden", p.dataset.socialPanel !== tabName),
          );
        }
      });

    this.root
      .querySelector<HTMLElement>('[data-drawer-name="activity"]')
      ?.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        const actionEl = target?.closest<HTMLElement>("[data-mail-action]");
        if (!actionEl) {
          return;
        }
        const action = actionEl.dataset.mailAction ?? "";
        const mailId = actionEl.dataset.mailId ?? "";
        void this.handleMailAction(action, mailId);
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-close-settings]")
      .forEach((element) => {
        element.addEventListener("click", () => this.closeSettings());
      });

    this.root
      .querySelector<HTMLElement>(".stitch-settings-overlay")
      ?.addEventListener("click", (event) => {
        if (event.target === event.currentTarget) {
          this.closeSettings();
        }
      });

    this.root
      .querySelector<HTMLElement>("[data-top-action]")
      ?.addEventListener("click", () => {
        this.showFeatureTip("已打开活动与邮件中心，可查看系统通知和申诉处理。");
      });

    this.root
      .querySelector<HTMLElement>("[data-auth-action]")
      ?.addEventListener("click", () => {
        const status = this.options.getAuthStatus?.();
        const loggedIn = status?.loggedIn ?? false;
        this.openAuthModal("login", !loggedIn);
      });

    this.root
      .querySelector<HTMLElement>("[data-auth-overlay]")
      ?.addEventListener("click", (event) => {
        if (
          event.target === event.currentTarget &&
          !this.authBusy &&
          !this.isAuthGateLocked()
        ) {
          this.closeAuthModal();
        }
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-auth-close]")
      .forEach((element) => {
        element.addEventListener("click", () => {
          if (!this.authBusy && !this.isAuthGateLocked()) {
            this.closeAuthModal();
          }
        });
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-auth-tab]")
      .forEach((element) => {
        element.addEventListener("click", () => {
          const nextMode = element.dataset.authTab;
          const mode: AuthMode = nextMode === "register" ? "register" : "login";
          this.setAuthMode(mode);
        });
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-auth-link]")
      .forEach((element) => {
        element.addEventListener("click", () => {
          if (this.authBusy) {
            return;
          }

          const nextAction = element.dataset.authLink ?? "";
          if (nextAction === "forgot") {
            this.setAuthMode("reset");
            return;
          }

          if (nextAction === "back-login") {
            this.setAuthMode("login");
          }
        });
      });

    this.root
      .querySelectorAll<HTMLInputElement>("[data-auth-form] input")
      .forEach((input) => {
        input.addEventListener("focus", () => {
          if (this.isAuthFieldName(input.name)) {
            this.authFocusedField = input.name;
            this.renderAuthPanel();
          }
        });

        input.addEventListener("blur", () => {
          if (this.authFocusedField === input.name) {
            this.authFocusedField = null;
            this.renderAuthPanel();
          }
        });

        input.addEventListener("input", () => {
          if (!this.isAuthFieldName(input.name)) {
            return;
          }

          if (input.name === "authResetAccount") {
            this.authResetChallengeId = "";
          }
          delete this.authFieldFeedback[input.name];
          if (this.authError) {
            this.authError = "";
            this.authNoticeTone = "hint";
          }
          this.renderAuthPanel();
        });
      });

    this.root
      .querySelectorAll<HTMLButtonElement>("[data-auth-send-code]")
      .forEach((button) => {
        button.addEventListener("click", async () => {
          const mode = button.dataset.authSendCode ?? "";
          if (mode === "reset-email") {
            await this.handleSendPasswordResetCode();
            return;
          }
          await this.handleSendRegisterVerificationCode();
        });
      });

    this.bindAuthShowcaseMotion();

    this.root
      .querySelector<HTMLElement>("[data-auth-clerk]")
      ?.addEventListener("click", async () => {
        if (this.authBusy) {
          return;
        }
        this.authBusy = true;
        this.authBusyAction = "clerk";
        this.authBusyMessage = "正在打开 Clerk 登录面板...";
        this.resetAuthFeedbackState();
        this.authNoticeTone = "busy";
        this.renderAuthPanel();
        try {
          await this.options.onClerkLoginStart?.();
          this.showFeatureTip("Clerk 登录面板已打开，完成验证后会自动接入当前大厅。");
        } catch (error) {
          this.authError = this.formatAuthErrorMessage(
            error instanceof Error ? error.message : "Clerk 登录启动失败。",
            "login",
          );
          this.authNoticeTone = "error";
          this.triggerAuthFeedbackMotion();
        } finally {
          this.authBusy = false;
          this.authBusyAction = null;
          this.authBusyMessage = "";
          this.renderAuthPanel();
        }
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-auth-switch-mode]")
      .forEach((element) => {
        element.addEventListener("click", async () => {
          const nextMode: AuthMode = element.dataset.authSwitchMode === "register"
            ? "register"
            : "login";
          await this.handleLogoutAndSwitchMode(nextMode);
        });
      });

    this.root
      .querySelector<HTMLElement>("[data-auth-logout]")
      ?.addEventListener("click", async () => {
        if (this.authBusy) {
          return;
        }
        this.authBusy = true;
        this.authBusyAction = "logout";
        this.authBusyMessage = "正在退出当前账号...";
        this.resetAuthFeedbackState();
        this.authNoticeTone = "busy";
        this.renderAuthPanel();
        try {
          await this.options.onLogoutSubmit?.();
          this.clearAuthForms();
          this.showFeatureTip("账号已退出，需要重新登录后才能继续。");
        } catch (error) {
          this.authError = this.formatAuthErrorMessage(
            error instanceof Error ? error.message : "退出登录失败，请重试。",
            "logout",
          );
          this.authNoticeTone = "error";
          this.triggerAuthFeedbackMotion();
        } finally {
          this.authBusy = false;
          this.authBusyAction = null;
          this.authBusyMessage = "";
          this.applyAuthStatusToView();
          this.renderAuthPanel();
        }
      });

    this.root
      .querySelector<HTMLFormElement>('[data-auth-form="login"]')
      ?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (this.authBusy) {
          return;
        }

        const accountInput = this.root.querySelector<HTMLInputElement>(
          'input[name="authLoginAccount"]',
        );
        const passwordInput = this.root.querySelector<HTMLInputElement>(
          'input[name="authLoginPassword"]',
        );
        const account = accountInput?.value.trim() ?? "";
        const password = passwordInput?.value ?? "";

        if (account.length < AUTH_ACCOUNT_MIN_LENGTH) {
          this.showAuthValidationError(
            ["authLoginAccount"],
            "账号至少 3 位。",
          );
          return;
        }
        if (password.length < AUTH_PASSWORD_MIN_LENGTH) {
          this.showAuthValidationError(
            ["authLoginPassword"],
            "密码至少 6 位。",
          );
          return;
        }

        this.resetAuthFeedbackState();
        this.authBusy = true;
        this.authBusyAction = "login";
        this.authBusyMessage = "正在接入账号...";
        this.authNoticeTone = "busy";
        this.renderAuthPanel();
        try {
          await this.options.onLoginSubmit?.({ account, password });
          this.clearAuthForms();
          this.showFeatureTip("账号登录成功，云存档已接管当前大厅。");
        } catch (error) {
          const rawMessage =
            error instanceof Error ? error.message : "登录失败，请重试。";
          this.authError = this.formatAuthErrorMessage(rawMessage, "login");
          this.authNoticeTone = "error";
          this.authFieldFeedback = this.resolveAuthFieldFeedback(
            rawMessage,
            "login",
          );
          this.triggerAuthFeedbackMotion(Object.keys(this.authFieldFeedback) as AuthFieldName[]);
        } finally {
          this.authBusy = false;
          this.authBusyAction = null;
          this.authBusyMessage = "";
          this.applyAuthStatusToView();
          this.renderAuthPanel();
        }
      });

    this.root
      .querySelector<HTMLFormElement>('[data-auth-form="register"]')
      ?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (this.authBusy) {
          return;
        }

        const nickname = this.root
          .querySelector<HTMLInputElement>('input[name="authRegisterNickname"]')
          ?.value.trim();
        const account = this.root
          .querySelector<HTMLInputElement>('input[name="authRegisterAccount"]')
          ?.value.trim() ?? "";
        const email = this.root
          .querySelector<HTMLInputElement>('input[name="authRegisterEmail"]')
          ?.value.trim() ?? "";
        const emailCode = this.root
          .querySelector<HTMLInputElement>('input[name="authRegisterEmailCode"]')
          ?.value.trim() ?? "";
        const password = this.root
          .querySelector<HTMLInputElement>('input[name="authRegisterPassword"]')
          ?.value ?? "";
        const confirmPassword = this.root
          .querySelector<HTMLInputElement>('input[name="authRegisterConfirmPassword"]')
          ?.value ?? "";
        if (account.length < AUTH_ACCOUNT_MIN_LENGTH) {
          this.showAuthValidationError(
            ["authRegisterAccount"],
            "账号至少 3 位。",
          );
          return;
        }
        if (password.length < AUTH_PASSWORD_MIN_LENGTH) {
          this.showAuthValidationError(
            ["authRegisterPassword"],
            "密码至少 6 位。",
          );
          return;
        }
        if (!this.isValidEmail(email)) {
          this.showAuthValidationError(
            ["authRegisterEmail"],
            "注册必须填写有效邮箱。",
          );
          return;
        }
        if (!/^\d{6}$/.test(emailCode)) {
          this.showAuthValidationError(
            ["authRegisterEmailCode"],
            "注册必须填写 6 位邮箱验证码。",
          );
          return;
        }
        if (password !== confirmPassword) {
          this.showAuthValidationError(
            ["authRegisterConfirmPassword"],
            "两次输入的密码不一致。",
          );
          return;
        }

        this.resetAuthFeedbackState();
        this.authBusy = true;
        this.authBusyAction = "register";
        this.authBusyMessage = "正在创建账号并校验验证码...";
        this.authNoticeTone = "busy";
        this.renderAuthPanel();
        try {
          await this.options.onRegisterSubmit?.({
            account,
            password,
            nickname: nickname && nickname.length > 0 ? nickname : undefined,
            email: email || undefined,
            emailCode: emailCode || undefined,
          });
          this.clearAuthForms();
          this.showFeatureTip("账号注册成功，已自动登录并接管云存档。");
        } catch (error) {
          const rawMessage =
            error instanceof Error ? error.message : "注册失败，请重试。";
          this.authError = this.formatAuthErrorMessage(rawMessage, "register");
          this.authNoticeTone = "error";
          this.authFieldFeedback = this.resolveAuthFieldFeedback(
            rawMessage,
            "register",
          );
          this.triggerAuthFeedbackMotion(Object.keys(this.authFieldFeedback) as AuthFieldName[]);
        } finally {
          this.authBusy = false;
          this.authBusyAction = null;
          this.authBusyMessage = "";
          this.applyAuthStatusToView();
          this.renderAuthPanel();
        }
      });

    this.root
      .querySelector<HTMLFormElement>('[data-auth-form="reset"]')
      ?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (this.authBusy) {
          return;
        }

        const account = this.root
          .querySelector<HTMLInputElement>('input[name="authResetAccount"]')
          ?.value.trim() ?? "";
        const verificationCode = this.root
          .querySelector<HTMLInputElement>('input[name="authResetCode"]')
          ?.value.trim() ?? "";
        const newPassword = this.root
          .querySelector<HTMLInputElement>('input[name="authResetPassword"]')
          ?.value ?? "";
        const confirmPassword = this.root
          .querySelector<HTMLInputElement>('input[name="authResetConfirmPassword"]')
          ?.value ?? "";

        if (account.length < AUTH_ACCOUNT_MIN_LENGTH) {
          this.showAuthValidationError(
            ["authResetAccount"],
            "先输入要找回的账号。",
          );
          return;
        }
        if (!this.authResetChallengeId.trim()) {
          this.showAuthValidationError(
            ["authResetAccount"],
            "先发送邮箱验证码，再填写新密码。",
          );
          return;
        }
        if (!/^\d{6}$/.test(verificationCode)) {
          this.showAuthValidationError(
            ["authResetCode"],
            "请输入 6 位邮箱验证码。",
          );
          return;
        }
        if (newPassword.length < AUTH_PASSWORD_MIN_LENGTH) {
          this.showAuthValidationError(
            ["authResetPassword"],
            "新密码至少 6 位。",
          );
          return;
        }
        if (newPassword !== confirmPassword) {
          this.showAuthValidationError(
            ["authResetConfirmPassword"],
            "两次输入的新密码不一致。",
          );
          return;
        }

        this.resetAuthFeedbackState();
        this.authBusy = true;
        this.authBusyAction = "resetConfirm";
        this.authBusyMessage = "正在校验邮箱验证码并重置密码...";
        this.authNoticeTone = "busy";
        this.renderAuthPanel();

        try {
          if (!this.options.onConfirmPasswordReset) {
            throw new Error("邮箱找回服务尚未接入。");
          }

          await this.options.onConfirmPasswordReset({
            challengeId: this.authResetChallengeId,
            verificationCode,
            newPassword,
          });

          const loginAccountInput = this.root.querySelector<HTMLInputElement>(
            'input[name="authLoginAccount"]',
          );
          if (loginAccountInput) {
            loginAccountInput.value = account;
          }

          this.authResetChallengeId = "";
          this.setAuthMode("login");
          this.authError = "密码已重置，请使用新密码登录。";
          this.authNoticeTone = "hint";
          this.renderAuthPanel();
          this.focusAuthField("authLoginPassword");
        } catch (error) {
          const rawMessage =
            error instanceof Error ? error.message : "密码重置失败，请稍后重试。";
          this.authError = this.formatAuthErrorMessage(rawMessage, "reset");
          this.authNoticeTone = "error";
          this.authFieldFeedback = this.resolveAuthFieldFeedback(
            rawMessage,
            "reset",
          );
          if (!Object.keys(this.authFieldFeedback).length) {
            this.authFieldFeedback.authResetCode = {
              message: this.authError,
              tone: "error",
            };
          }
          this.triggerAuthFeedbackMotion(
            Object.keys(this.authFieldFeedback) as AuthFieldName[],
          );
        } finally {
          this.authBusy = false;
          this.authBusyAction = null;
          this.authBusyMessage = "";
          this.renderAuthPanel();
        }
      });

    this.root
      .querySelector<HTMLElement>("[data-start-game]")
      ?.addEventListener("click", () => {
        const status = this.options.getAuthStatus?.();
        if (!status?.loggedIn) {
          this.openAuthModal("login", true);
          this.showFeatureTip("请先登录或注册账号，完成验证后再进入游戏。");
          return;
        }
        this.hideAll();
        console.log("[LobbyUI] calling onOpenModeHall", this.selectedModeId);
        this.options.onOpenModeHall(this.selectedModeId);
      });

    this.root
      .querySelector<HTMLElement>("[data-mode-grid]")
      ?.addEventListener("click", (event) => {
        const card = (event.target as HTMLElement | null)?.closest<HTMLElement>(
          "[data-mode-card-id]",
        );
        if (!card) {
          return;
        }
        const cardId = card.dataset.modeCardId ?? "";
        this.selectModeCard(cardId);
      });

    this.root
      .querySelector<HTMLElement>("[data-mode-grid]")
      ?.addEventListener("keydown", (event) => {
        const card = (event.target as HTMLElement | null)?.closest<HTMLElement>(
          "[data-mode-card-id]",
        );
        if (!card) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          const cardId = card.dataset.modeCardId ?? "";
          this.selectModeCard(cardId);
        }
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-toggle-skins]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const nextOpen = !this.root.classList.contains("is-skin-drawer-open");
          this.setSkinDrawerOpen(nextOpen);
        });
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-feature]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const feature = button.dataset.feature ?? "";
          if (!this.isLobbyFeatureId(feature)) {
            return;
          }
          this.selectedFeatureId = feature;
          this.applyFeatureSelection();
          void this.options.onFeatureAction?.(feature);
          this.showFeatureTip(FEATURE_TIPS[feature]);
        });
      });

    const avatarInput = this.root.querySelector<HTMLInputElement>(
      "[data-avatar-input]",
    );
    this.root
      .querySelectorAll<HTMLElement>("[data-avatar-trigger]")
      .forEach((button) => {
        button.addEventListener("click", () => avatarInput?.click());
      });

    avatarInput?.addEventListener("change", async () => {
      const file = avatarInput.files?.[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        this.showFeatureTip("请上传图片文件。");
        avatarInput.value = "";
        return;
      }
      if (file.size > MAX_AVATAR_SIZE_BYTES) {
        this.showFeatureTip("头像文件过大，请选择 2MB 以内图片。");
        avatarInput.value = "";
        return;
      }

      try {
        const dataUrl = await this.readFileAsDataUrl(file);
        this.updateSettings({ avatarDataUrl: dataUrl });
        this.showFeatureTip("头像已更新并保存到本地。");
      } catch {
        this.showFeatureTip("头像读取失败，请重试。");
      }
      avatarInput.value = "";
    });

    this.root
      .querySelector<HTMLElement>("[data-avatar-clear]")
      ?.addEventListener("click", () => {
        this.updateSettings({ avatarDataUrl: "" });
        this.showFeatureTip("头像已清空。");
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-skin-id]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const skinId = button.dataset.skinId ?? SKIN_OPTIONS[0].id;
          this.updateSettings({ equippedSkinId: skinId });
          if (button.dataset.skinGroup === "main") {
            this.setSkinDrawerOpen(false);
          }
        });
      });

    this.root
      .querySelector<HTMLInputElement>('input[name="playerName"]')
      ?.addEventListener("input", (event) => {
        const target = event.currentTarget as HTMLInputElement;
        this.updateSettings({
          playerName: this.normalizePlayerName(target.value),
        });
      });

    const toggles = [
      "showFps",
      "showMinimap",
      "showLeaderboard",
      "developerMode",
      "reducedMotion",
    ] as const;
    toggles.forEach((name) => {
      this.root
        .querySelector<HTMLInputElement>(`input[name="${name}"]`)
        ?.addEventListener("change", (event) => {
          const target = event.currentTarget as HTMLInputElement;
          this.updateSettings({
            [name]: target.checked,
          } as Partial<GameSettings>);
        });
    });
  }

  private async handleSocialSearch() {
    const status = this.options.getAuthStatus?.() ?? {
      loggedIn: false,
      userLabel: "游客",
    };
    if (!status.loggedIn) {
      this.socialError = "请先登录后再查找好友。";
      this.renderSocialCenter();
      return;
    }

    const input = this.root.querySelector<HTMLInputElement>("[data-social-search-input]");
    const gameId = input?.value.trim() ?? "";
    if (!/^\d{1,11}$/.test(gameId)) {
      this.socialError = "请输入 1-11 位数字 UID。";
      this.renderSocialCenter();
      return;
    }

    this.socialBusy = true;
    this.socialError = "";
    this.renderSocialCenter();
    try {
      const result = await lobbyService.searchFriendByGameId(gameId);
      this.socialSearchResult = result;
      this.socialError = "";
    } catch (error) {
      this.socialError = error instanceof Error ? error.message : "好友搜索失败。";
    } finally {
      this.socialBusy = false;
      this.renderSocialCenter();
    }
  }

  private async refreshSocialOverview() {
    const status = this.options.getAuthStatus?.() ?? {
      loggedIn: false,
      userLabel: "游客",
    };
    if (!status.loggedIn) {
      this.socialOverview = null;
      this.socialError = "";
      this.socialSearchResult = null;
      this.renderSocialCenter();
      return;
    }

    this.socialBusy = true;
    this.socialError = "";
    this.renderSocialCenter();
    try {
      const overview = await lobbyService.fetchSocialOverview();
      this.setSocialOverview(overview);
      this.socialError = "";
    } catch (error) {
      this.socialError = error instanceof Error ? error.message : "社交数据刷新失败。";
    } finally {
      this.socialBusy = false;
      this.renderSocialCenter();
    }
  }

  private async refreshActivityCenter() {
    const status = this.options.getAuthStatus?.() ?? {
      loggedIn: false,
      userLabel: "游客",
    };
    if (!status.loggedIn) {
      this.mailInbox = [];
      this.mailError = "";
      this.mailBusy = false;
      this.renderActivityCenter();
      return;
    }

    this.mailBusy = true;
    this.mailError = "";
    this.renderActivityCenter();
    try {
      const inbox = await mailService.getInbox();
      this.mailInbox = inbox.items;
      this.mailError = "";
    } catch (error) {
      this.mailError = error instanceof Error ? error.message : "邮件刷新失败。";
    } finally {
      this.mailBusy = false;
      this.renderActivityCenter();
    }
  }

  private async handleMailAction(action: string, mailId: string) {
    const trimmedMailId = mailId.trim();
    if (!trimmedMailId || this.mailBusy) {
      return;
    }

    this.mailBusy = true;
    this.mailError = "";
    this.renderActivityCenter();
    try {
      if (action === "mark-read") {
        await mailService.markRead(trimmedMailId);
        this.showFeatureTip("邮件已标记为已读。");
      } else if (action === "submit-appeal") {
        const input = this.root.querySelector<HTMLTextAreaElement>(
          `[data-mail-appeal-input="${trimmedMailId}"]`,
        );
        const message = input?.value.trim() ?? "";
        this.mailDraftByNoticeId[trimmedMailId] = message;
        if (!message) {
          this.mailError = "请先填写申诉理由。";
          return;
        }
        await mailService.submitBanAppeal({
          banNoticeMailId: trimmedMailId,
          message,
        });
        this.mailDraftByNoticeId[trimmedMailId] = "";
        this.showFeatureTip("申诉已提交，管理员会通过游戏内邮件回信。");
      }
      const inbox = await mailService.getInbox();
      this.mailInbox = inbox.items;
    } catch (error) {
      this.mailError = error instanceof Error ? error.message : "邮件操作失败。";
    } finally {
      this.mailBusy = false;
      this.renderActivityCenter();
    }
  }

  private async handleSocialAction(
    action: string,
    payload: { requestId?: string; gameId?: string },
  ) {
    const status = this.options.getAuthStatus?.() ?? {
      loggedIn: false,
      userLabel: "游客",
    };
    if (!status.loggedIn || this.socialBusy) {
      return;
    }

    const requestId = payload.requestId?.trim() ?? "";
    const gameId = payload.gameId?.trim() ?? "";

    this.socialBusy = true;
    this.socialError = "";
    this.renderSocialCenter();

    try {
      if (action === "send-request") {
        await lobbyService.sendFriendRequestByGameId(gameId);
        this.showFeatureTip("好友申请已发出。");
      } else if (action === "accept-request") {
        await lobbyService.acceptFriendRequest(requestId);
        this.showFeatureTip("已同意好友申请。");
      } else if (action === "reject-request") {
        await lobbyService.rejectFriendRequest(requestId);
        this.showFeatureTip("已拒绝好友申请。");
      } else if (action === "remove-friend") {
        await lobbyService.removeFriendByGameId(gameId);
        this.showFeatureTip("已取关该好友。");
      } else if (action === "block") {
        await lobbyService.blockUserByGameId(gameId);
        this.showFeatureTip("已加入黑名单。");
      } else if (action === "unblock") {
        await lobbyService.unblockUserByGameId(gameId);
        this.showFeatureTip("已解除黑名单。");
      }

      await this.refreshSocialOverview();
      if (this.socialSearchResult?.user?.gameId === gameId) {
        this.socialSearchResult = await lobbyService.searchFriendByGameId(gameId);
      }
    } catch (error) {
      this.socialError = error instanceof Error ? error.message : "社交操作失败。";
    } finally {
      this.socialBusy = false;
      this.renderSocialCenter();
    }
  }

  private async refreshRankingDrawer() {
    const status = this.options.getAuthStatus?.() ?? { loggedIn: false, userLabel: "游客" };
    if (!status.loggedIn) {
      this.renderRankingList();
      return;
    }
    if (this.rankingBusy) return;
    this.rankingBusy = true;
    this.renderRankingList();
    try {
      const [overviewRes, leaderboardRes] = await Promise.allSettled([
        rankingService.getOverview(),
        rankingService.getLeaderboard(this.rankingSelectedQueue),
      ]);
      if (overviewRes.status === "fulfilled") {
        this.rankingOverview = overviewRes.value.overview;
      }
      if (leaderboardRes.status === "fulfilled") {
        this.rankingLeaderboard = leaderboardRes.value.entries;
      }
    } catch {
      /* silently fail */
    } finally {
      this.rankingBusy = false;
      this.renderRankingList();
    }
  }

  private renderRankingList() {
    const status = this.options.getAuthStatus?.() ?? { loggedIn: false, userLabel: "游客" };
    const seasonEl = this.root.querySelector<HTMLElement>("[data-ranking-season-name]");
    if (seasonEl) {
      seasonEl.textContent = this.rankingOverview?.currentSeason?.name ?? "暂无赛季";
    }

    const myRankEl = this.root.querySelector<HTMLElement>("[data-ranking-myrank]");
    if (myRankEl) {
      const queue = this.rankingOverview?.queues.find(
        (q) => q.queueId === this.rankingSelectedQueue,
      );
      const tierEl = myRankEl.querySelector<HTMLElement>("[data-ranking-my-tier]");
      const scoreEl = myRankEl.querySelector<HTMLElement>("[data-ranking-my-score]");
      const winrateEl = myRankEl.querySelector<HTMLElement>("[data-ranking-my-winrate]");
      if (tierEl) tierEl.textContent = queue ? `${queue.tier} ${queue.division}` : "--";
      if (scoreEl) scoreEl.textContent = queue ? `排位分: ${queue.rankScore}` : "排位分: --";
      if (winrateEl) winrateEl.textContent = queue ? `胜率: ${(queue.winRate * 100).toFixed(1)}%` : "胜率: --";
    }

    const listEl = this.root.querySelector<HTMLElement>("[data-ranking-list]");
    if (!listEl) return;

    if (!status.loggedIn) {
      listEl.innerHTML = `<div class="stitch-drawer-empty">
        ${renderMaterialSymbol("emoji_events", "stitch-drawer-empty-icon")}
        <strong>登录后查看排行榜</strong><small>排行数据将从服务器实时拉取</small></div>`;
      return;
    }
    if (this.rankingBusy) {
      listEl.innerHTML = `<div class="stitch-drawer-empty">
        ${renderMaterialSymbol("sync", "stitch-drawer-empty-icon stitch-spin")}
        <strong>正在加载排行榜...</strong></div>`;
      return;
    }
    if (!this.rankingLeaderboard.length) {
      listEl.innerHTML = `<div class="stitch-drawer-empty">
        ${renderMaterialSymbol("emoji_events", "stitch-drawer-empty-icon")}
        <strong>暂无排行数据</strong><small>参加比赛后将显示排名</small></div>`;
      return;
    }

    listEl.innerHTML = `
      <div class="stitch-ranking-table">
        <div class="stitch-ranking-table-head">
          <span>#</span><span>玩家</span><span>段位</span><span>分数</span><span>胜率</span>
        </div>
        ${this.rankingLeaderboard.slice(0, 50).map((entry, i) => `
          <div class="stitch-ranking-table-row${i < 3 ? ` is-top-${i + 1}` : ""}">
            <span class="stitch-ranking-pos">${entry.rankPosition}</span>
            <span class="stitch-ranking-name">${this.escapeHtml(entry.nickname)}</span>
            <span class="stitch-ranking-tier">${entry.tier} ${entry.division}</span>
            <span class="stitch-ranking-score">${entry.rankScore}</span>
            <span class="stitch-ranking-wr">${entry.matchesPlayed > 0 ? ((entry.wins / entry.matchesPlayed) * 100).toFixed(1) : 0}%</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  private refreshShopDrawer() {
    const gridEl = this.root.querySelector<HTMLElement>("[data-shop-grid]");
    if (gridEl) gridEl.innerHTML = this.buildShopItems();
    const coinsEl = this.root.querySelector<HTMLElement>("[data-shop-coins]");
    if (coinsEl) {
      const summary = this.options.getAuthStatus?.()?.loggedIn ? "0" : "0";
      coinsEl.textContent = summary;
    }
  }

  private refreshSigninDrawer() {
    const gridEl = this.root.querySelector<HTMLElement>("[data-signin-grid]");
    if (gridEl) gridEl.innerHTML = this.buildSigninDays();
    const streakEl = this.root.querySelector<HTMLElement>("[data-signin-streak]");
    if (streakEl) streakEl.textContent = `${this.signinCheckedDays}`;
    const btnEl = this.root.querySelector<HTMLElement>("[data-signin-action]");
    if (btnEl) {
      const btn = btnEl as HTMLButtonElement;
      btn.disabled = this.signinTodayDone;
      if (this.signinTodayDone) {
        btn.innerHTML = `${renderMaterialSymbol("check_circle", "")} <span>今日已签到</span>`;
      }
    }
    const statusEl = this.root.querySelector<HTMLElement>("[data-signin-status]");
    if (statusEl) {
      const status = this.options.getAuthStatus?.() ?? { loggedIn: false, userLabel: "游客" };
      statusEl.textContent = !status.loggedIn
        ? "登录后可每日签到领取奖励"
        : this.signinTodayDone
          ? `已连续签到 ${this.signinCheckedDays} 天，明天继续！`
          : "点击按钮完成今日签到";
    }
  }

  private handleSigninAction() {
    const status = this.options.getAuthStatus?.() ?? { loggedIn: false, userLabel: "游客" };
    if (!status.loggedIn) {
      this.showFeatureTip("请先登录后再签到。");
      return;
    }
    if (this.signinTodayDone) {
      this.showFeatureTip("今日已签到，明天再来！");
      return;
    }
    this.signinCheckedDays += 1;
    this.signinTodayDone = true;
    this.refreshSigninDrawer();
    this.showFeatureTip(`签到成功！已连续签到 ${this.signinCheckedDays} 天`);
  }

  private selectModeCard(cardId: string) {
    if (!this.isStitchModeCardId(cardId)) {
      return;
    }

    this.selectedCardId = cardId;
    const card = this.getSelectedCard();
    this.selectedModeId = card.modeId;
    this.applySelectedModeUI();
  }

  private applySelectedModeUI() {
    const selectedCard = this.getSelectedCard();
    const presentation = this.getModeCardPresentation(selectedCard);

    this.root
      .querySelectorAll<HTMLElement>("[data-mode-card-id]")
      .forEach((card) => {
        const active = card.dataset.modeCardId === this.selectedCardId;
        card.classList.toggle("is-active", active);
        card.setAttribute("aria-pressed", active ? "true" : "false");
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-current-mode-name]")
      .forEach((el) => {
        el.textContent = selectedCard.name;
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-selected-mode-name]")
      .forEach((el) => {
        el.textContent = selectedCard.name;
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-selected-mode-subtitle]")
      .forEach((el) => {
        el.textContent = selectedCard.subtitle;
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-selected-mode-metric-a]")
      .forEach((el) => {
        el.textContent = presentation.metrics[0]?.value ?? "暂无";
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-selected-mode-metric-b]")
      .forEach((el) => {
        el.textContent = presentation.metrics[1]?.value ?? "暂无";
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-mode-status]")
      .forEach((el) => {
        el.textContent = presentation.status;
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-launch-label]")
      .forEach((el) => {
        el.textContent = `进入${selectedCard.name}`;
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-launch-code]")
      .forEach((el) => {
        el.textContent = `// ${selectedCard.name}${presentation.status === "实时同步" ? "统计已同步" : "等待后端数据"}`;
      });

    const launchTags = this.root.querySelector<HTMLElement>("[data-selected-mode-tags]");
    if (launchTags) {
      launchTags.innerHTML = presentation.tags.length > 0
        ? presentation.tags
          .map((tag) => `<span class="stitch-launch-brief-tag">${this.escapeHtml(tag)}</span>`)
          .join("")
        : '<span class="stitch-launch-brief-tag">暂无后端统计</span>';
    }

    const rankedTierLabel =
      this.modeSnapshots.ranked?.rankLabel ??
      presentation.rankLabel ??
      "暂无数据";
    this.root
      .querySelectorAll<HTMLElement>("[data-ranked-tier-label]")
      .forEach((el) => {
        el.textContent = rankedTierLabel;
      });

    this.root.dataset.modeTheme = selectedCard.theme;
  }

  private closeSettings() {
    const wasModalOnly = this.root.classList.contains("is-modal-only");
    this.root.classList.remove("is-settings-open", "is-modal-only");
    if (!wasModalOnly) {
      this.root.classList.add("is-visible");
    }
    this.syncDocumentScrollLock();
    this.options.onSettingsClosed();
  }

  private openAuthModal(mode: AuthMode, required = false) {
    this.resetAuthFeedbackState();
    this.authBusy = false;
    this.authBusyAction = null;
    this.authBusyMessage = "";
    this.root.classList.add("is-auth-open");
    this.root.classList.toggle("is-auth-required", required);
    this.setAuthMode(mode);
    this.syncDocumentScrollLock();
    this.focusAuthField();
  }

  private closeAuthModal(force = false) {
    if (this.isAuthGateLocked() && !force) {
      return;
    }
    this.root.classList.remove("is-auth-open");
    this.root.classList.remove("is-auth-required");
    this.resetAuthFeedbackState(true);
    this.authBusy = false;
    this.authBusyAction = null;
    this.authBusyMessage = "";
    this.renderAuthPanel();
    this.syncDocumentScrollLock();
  }

  private setAuthMode(mode: AuthMode) {
    this.authMode = mode;
    this.resetAuthFeedbackState();
    this.renderAuthPanel();
    if (this.root.classList.contains("is-auth-open")) {
      window.setTimeout(() => this.focusAuthField(), 0);
    }
  }

  private renderAuthPanel() {
    const status = this.options.getAuthStatus?.() ?? {
      loggedIn: false,
      userLabel: "游客",
    };
    const capabilities = this.getAuthCapabilities();
    const authLocked = this.isAuthGateLocked();
    const authBaseMode = this.authMode === "register" ? "register" : "login";
    const usingRegisterMode = !status.loggedIn && authBaseMode === "register";
    const usingResetMode = !status.loggedIn && this.authMode === "reset";
    const sceneBadge = authLocked
      ? "账号验证"
      : status.loggedIn
        ? "云存档在线"
        : usingRegisterMode
          ? "创建账号"
          : "账号登录";
    const sceneTitle = authLocked
      ? "完成验证后解锁作战大厅"
      : status.loggedIn
        ? `${status.userLabel} 已接入星港网络`
        : usingRegisterMode
          ? "创建你的球球作战身份"
          : "使用已有账号返回战场";
    const sceneSubtitle = authLocked
      ? "账号是进入大厅、匹配和私人模式的前置条件"
      : status.loggedIn
        ? "当前账号正在托管你的资料、战绩与本地进度"
        : usingRegisterMode
          ? "注册成功后自动登录，并立即接管当前本地档案"
          : "输入账号与密码，继续你的上一段作战记录";
    const sceneCopy = authLocked
      ? "先完成账号注册或登录，后面的大厅、匹配、私人模式和开发者链路才会全部点亮。"
      : status.loggedIn
        ? "账号已经在线，接下来可以直接进入模式大厅，也能继续查看当前账号的云端标签。"
        : usingRegisterMode
          ? "建议先注册一个稳定账号，后续昵称、战绩、私人房和功能联调都会挂在这份身份上。"
          : "如果你已经有账号，直接输入账号和密码即可回到上一次的云端作战进度。";
    const introTitleText = authLocked
      ? "先完成账号验证"
      : status.loggedIn
        ? "当前账号已接入"
        : usingRegisterMode
          ? "注册后立即进入大厅"
          : "账号密码直接进入";
    const introCopyText = authLocked
      ? "登录或注册后即可进入大厅。"
      : status.loggedIn
        ? "当前账号已在线，可直接继续。"
        : usingRegisterMode
          ? "只保留必要字段，注册完成后自动登录。"
          : "输入账号和密码，继续当前进度。";
    const bottomNoteText = authLocked
      ? "完成账号验证后即可进入大厅。"
      : status.loggedIn
        ? "当前账号已接管本地资料。"
        : usingRegisterMode
          ? "注册成功后会自动登录。"
          : "没有账号时切到注册即可。";
    const registerNoteText = usingRegisterMode
      ? capabilities.emailVerificationEnabled
        ? "注册时必须填写邮箱并完成邮箱验证码验证。"
        : "注册界面会要求邮箱和验证码；如果云端邮件服务未就绪，发送时会直接报错。"
      : "登录后自动接管当前本地进度。";
    const resetNoteText = this.authResetChallengeId
      ? "验证码已发出，输入邮箱验证码与新密码后即可完成找回。"
      : capabilities.emailVerificationEnabled
        ? "输入账号后发送验证码，邮件会发到该账号绑定邮箱。"
        : "输入账号后可尝试发送验证码；如果云端邮件服务未就绪，接口会直接返回错误。";

    this.root.dataset.authMode = this.authMode;
    this.root.classList.toggle("is-auth-busy", this.authBusy);
    this.root.classList.toggle("is-auth-required", authLocked);

    const headKicker = this.root.querySelector<HTMLElement>("[data-auth-head-kicker]");
    if (headKicker) {
      headKicker.textContent = sceneBadge;
    }

    const headTitle = this.root.querySelector<HTMLElement>("[data-auth-head-title]");
    if (headTitle) {
      headTitle.textContent = authLocked
        ? "完成账号验证后才能开始游戏"
        : status.loggedIn
          ? "当前账号"
          : usingRegisterMode
            ? "创建新账号"
            : "账号登录";
    }

    const sceneBadgeEl = this.root.querySelector<HTMLElement>("[data-auth-scene-badge]");
    if (sceneBadgeEl) {
      sceneBadgeEl.textContent = sceneBadge;
    }

    const sceneTitleEl = this.root.querySelector<HTMLElement>("[data-auth-scene-title]");
    if (sceneTitleEl) {
      sceneTitleEl.textContent = sceneTitle;
    }

    const sceneSubtitleEl = this.root.querySelector<HTMLElement>("[data-auth-scene-subtitle]");
    if (sceneSubtitleEl) {
      sceneSubtitleEl.textContent = sceneSubtitle;
    }

    const sceneCopyEl = this.root.querySelector<HTMLElement>("[data-auth-scene-copy]");
    if (sceneCopyEl) {
      sceneCopyEl.textContent = sceneCopy;
    }

    const introTitle = this.root.querySelector<HTMLElement>("[data-auth-intro-title]");
    if (introTitle) {
      introTitle.textContent = introTitleText;
    }

    const introCopy = this.root.querySelector<HTMLElement>("[data-auth-intro-copy]");
    if (introCopy) {
      introCopy.textContent = introCopyText;
    }

    this.root
      .querySelectorAll<HTMLElement>("[data-auth-tab]")
      .forEach((element) => {
        const active = element.dataset.authTab === authBaseMode;
        element.classList.toggle("is-active", active);
        element.setAttribute("aria-pressed", active ? "true" : "false");
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-auth-account-view]")
      .forEach((element) => {
        element.style.display = status.loggedIn ? "grid" : "none";
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-auth-close]")
      .forEach((element) => {
        element.style.display = authLocked ? "none" : "";
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-auth-tabs], [data-auth-form]")
      .forEach((element) => {
        if (element.hasAttribute("data-auth-tabs")) {
          (element as HTMLElement).style.display = status.loggedIn ? "none" : "";
          return;
        }
        const formMode = (element as HTMLElement).dataset.authForm;
        const visible =
          !status.loggedIn &&
          ((formMode === "login" && authBaseMode === "login") ||
            (formMode === "register" && authBaseMode === "register") ||
            (formMode === "reset" && usingResetMode));
        (element as HTMLElement).style.display = visible ? "grid" : "none";
      });

    const resetDialog = this.root.querySelector<HTMLElement>("[data-auth-reset-dialog]");
    if (resetDialog) {
      const visible = !status.loggedIn && usingResetMode;
      resetDialog.style.display = visible ? "grid" : "none";
      resetDialog.setAttribute("aria-hidden", visible ? "false" : "true");
    }

    AUTH_FIELD_NAMES.forEach((fieldName) => {
      const fieldHost = this.root.querySelector<HTMLElement>(
        `[data-auth-field="${fieldName}"]`,
      );
      const fieldPopover = this.root.querySelector<HTMLElement>(
        `[data-auth-field-popover="${fieldName}"]`,
      );
      const input = fieldHost?.querySelector<HTMLInputElement>("input");
      const feedback = this.getAuthFieldFeedback(fieldName, status.loggedIn);
      const hasFeedback = Boolean(feedback.message);

      if (fieldHost) {
        fieldHost.classList.toggle("has-popover", hasFeedback);
        fieldHost.classList.toggle("is-invalid", feedback.tone === "error");
        fieldHost.classList.toggle("is-hinting", feedback.tone === "hint" && hasFeedback);
        fieldHost.dataset.state = feedback.tone;
      }

      if (fieldPopover) {
        fieldPopover.textContent = feedback.message;
        fieldPopover.classList.toggle("is-visible", hasFeedback);
        fieldPopover.dataset.tone = feedback.tone;
      }

      if (input) {
        input.setAttribute("aria-invalid", feedback.tone === "error" ? "true" : "false");
      }
    });

    const authNotice = this.authBusy
      ? this.authBusyMessage || "正在提交账号请求..."
      : this.authError;
    const authNoticeTone = this.authBusy ? "busy" : this.authNoticeTone;
    const errorEl = this.root.querySelector<HTMLElement>("[data-auth-error]");
    if (errorEl) {
      errorEl.textContent = authNotice;
      errorEl.classList.toggle("is-visible", Boolean(authNotice));
      errorEl.dataset.tone = authNoticeTone;
    }

    const clerkProviderRow = this.root.querySelector<HTMLElement>(
      "[data-auth-provider-row]",
    );
    if (clerkProviderRow) {
      clerkProviderRow.style.display =
        !status.loggedIn && this.options.clerkEnabled ? "flex" : "none";
    }

    const clerkButton = this.root.querySelector<HTMLButtonElement>("[data-auth-clerk]");
    if (clerkButton) {
      clerkButton.disabled = this.authBusy;
      clerkButton.textContent = this.authBusyAction === "clerk"
        ? "正在打开 Clerk..."
        : "使用 Clerk 登录";
    }

    this.root
      .querySelectorAll<HTMLElement>("[data-auth-account-name]")
      .forEach((element) => {
        element.textContent = status.loggedIn ? status.userLabel : "未登录";
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-auth-account-label]")
      .forEach((element) => {
        element.textContent = status.loggedIn
          ? status.accountLabel ?? "云存档已连接"
          : "登录后可同步资料与进度";
      });

    const bottomNote = this.root.querySelector<HTMLElement>("[data-auth-bottom-note]");
    if (bottomNote) {
      bottomNote.textContent = bottomNoteText;
    }

    const loginNote = this.root.querySelector<HTMLElement>(
      '[data-auth-form-note="login"]',
    );
    if (loginNote) {
      loginNote.textContent =
        "登录后自动接管当前本地进度。";
    }

    const registerNote = this.root.querySelector<HTMLElement>(
      '[data-auth-form-note="register"]',
    );
    if (registerNote) {
      registerNote.textContent = registerNoteText;
    }

    const resetNote = this.root.querySelector<HTMLElement>(
      '[data-auth-form-note="reset"]',
    );
    if (resetNote) {
      resetNote.textContent = resetNoteText;
    }

    const loginSubmitButton = this.root.querySelector<HTMLButtonElement>(
      '[data-auth-submit="login"]',
    );
    if (loginSubmitButton) {
      loginSubmitButton.textContent =
        this.authBusyAction === "login" && !status.loggedIn && !usingRegisterMode
          ? "正在接入账号..."
          : "进入作战大厅";
    }

    const registerSubmitButton = this.root.querySelector<HTMLButtonElement>(
      '[data-auth-submit="register"]',
    );
    if (registerSubmitButton) {
      registerSubmitButton.textContent =
        this.authBusyAction === "register" && !status.loggedIn && usingRegisterMode
          ? "正在创建账号..."
          : "注册并进入大厅";
    }

    const resetSubmitButton = this.root.querySelector<HTMLButtonElement>(
      '[data-auth-submit="reset"]',
    );
    if (resetSubmitButton) {
      resetSubmitButton.textContent =
        this.authBusyAction === "resetConfirm" && !status.loggedIn && usingResetMode
          ? "正在重置密码..."
          : "重置密码并返回登录";
    }

    const logoutButton = this.root.querySelector<HTMLButtonElement>("[data-auth-logout]");
    if (logoutButton) {
      logoutButton.textContent =
        this.authBusyAction === "logout" ? "正在退出..." : "退出当前账号";
    }

    this.root
      .querySelectorAll<HTMLElement>("[data-auth-verify-block]")
      .forEach((element) => {
        const blockType = element.dataset.authVerifyBlock ?? "";
        const visible =
          !status.loggedIn &&
          ((blockType === "register-email" && usingRegisterMode) ||
            (blockType === "reset-email" && usingResetMode));
        element.style.display = visible ? "grid" : "none";
      });

    this.root
      .querySelectorAll<HTMLButtonElement>("[data-auth-send-code]")
      .forEach((button) => {
        const sendMode = button.dataset.authSendCode ?? "";
        const cooldown =
          sendMode === "reset-email"
            ? this.authCodeCooldowns.resetEmail
            : this.authCodeCooldowns.registerEmail;
        button.disabled = this.authBusy || cooldown > 0;
        button.textContent =
          this.authBusyAction === "registerEmailCode" &&
            sendMode === "register-email"
            ? "发送中..."
            : this.authBusyAction === "resetRequest" && sendMode === "reset-email"
              ? "发送中..."
              : cooldown > 0
                ? `${cooldown}s 后重发`
                : sendMode === "reset-email"
                  ? "发送找回验证码"
                  : "发送邮箱验证码";
      });

    this.root
      .querySelectorAll<HTMLButtonElement>(
        "[data-auth-submit], [data-auth-logout], [data-auth-clerk], [data-auth-link], [data-auth-switch-mode]",
      )
      .forEach((button) => {
        button.disabled = this.authBusy;
      });
  }

  private async handleLogoutAndSwitchMode(nextMode: AuthMode) {
    if (this.authBusy) {
      return;
    }

    const targetMode: AuthMode = nextMode === "register" ? "register" : "login";
    this.authBusy = true;
    this.authBusyAction = "logout";
    this.authBusyMessage = targetMode === "register"
      ? "正在退出当前账号并切换到注册..."
      : "正在退出当前账号并切换到登录...";
    this.resetAuthFeedbackState();
    this.authNoticeTone = "busy";
    this.renderAuthPanel();

    try {
      await this.options.onLogoutSubmit?.();
      this.clearAuthForms();
      this.setAuthMode(targetMode);
      this.showFeatureTip(
        targetMode === "register"
          ? "已退出当前账号，请直接注册新账号。"
          : "已退出当前账号，请登录其他账号。",
      );
    } catch (error) {
      this.authError = this.formatAuthErrorMessage(
        error instanceof Error ? error.message : "退出登录失败，请重试。",
        "logout",
      );
      this.authNoticeTone = "error";
      this.triggerAuthFeedbackMotion();
    } finally {
      this.authBusy = false;
      this.authBusyAction = null;
      this.authBusyMessage = "";
      this.applyAuthStatusToView();
      this.renderAuthPanel();
    }
  }

  private renderDeveloperToolbox() {
    const status = this.options.getAuthStatus?.() ?? {
      loggedIn: false,
      userLabel: "游客",
    };
    const summaryHost = this.root.querySelector<HTMLElement>("[data-devtool-summary]");
    const currentHost = this.root.querySelector<HTMLElement>("[data-devtool-current]");
    const listHost = this.root.querySelector<HTMLElement>("[data-devtool-list]");
    const statusHost = this.root.querySelector<HTMLElement>("[data-devtool-status]");
    const refreshButton = this.root.querySelector<HTMLButtonElement>("[data-devtool-refresh]");

    if (refreshButton) {
      refreshButton.disabled = this.developerOverviewBusy || !status.loggedIn;
      refreshButton.textContent = this.developerOverviewBusy ? "刷新中..." : "刷新链路";
    }

    if (summaryHost) {
      if (!status.loggedIn) {
        summaryHost.innerHTML = this.buildDeveloperMetricCards([
          { label: "账号总数", value: "--" },
          { label: "可用账号", value: "--" },
          { label: "密码账号", value: "--" },
          { label: "24h 登录", value: "--" },
        ]);
      } else if (this.developerOverview) {
        summaryHost.innerHTML = this.buildDeveloperMetricCards([
          { label: "账号总数", value: `${this.developerOverview.stats.totalAccounts}` },
          { label: "可用账号", value: `${this.developerOverview.stats.activeAccounts}` },
          { label: "密码账号", value: `${this.developerOverview.stats.passwordAccounts}` },
          { label: "24h 登录", value: `${this.developerOverview.stats.recentLoginCount24h}` },
        ]);
      } else {
        summaryHost.innerHTML = this.buildDeveloperMetricCards([
          { label: "账号总数", value: "..." },
          { label: "可用账号", value: "..." },
          { label: "密码账号", value: "..." },
          { label: "24h 登录", value: "..." },
        ]);
      }
    }

    if (currentHost) {
      if (!status.loggedIn) {
        currentHost.innerHTML = `
          <article class="stitch-devtool-card stitch-devtool-card--empty">
            <strong>当前账号</strong>
            <span>登录后显示当前链路绑定的账号资料。</span>
          </article>
        `;
      } else if (this.developerOverview?.currentAccount) {
        const current = this.developerOverview.currentAccount;
        currentHost.innerHTML = `
          <article class="stitch-devtool-card">
            <strong>当前账号</strong>
            <span>昵称 · ${this.escapeHtml(current.nickname)}</span>
            <span>账号 · ${this.escapeHtml(current.account ?? "未绑定")}</span>
            <span>UID · ${this.escapeHtml(current.gameId)}</span>
            <span>创建于 · ${this.escapeHtml(this.formatDateTime(current.createdAt))}</span>
          </article>
        `;
      } else {
        currentHost.innerHTML = `
          <article class="stitch-devtool-card stitch-devtool-card--empty">
            <strong>当前账号</strong>
            <span>已登录，但当前账号摘要暂时未返回。</span>
          </article>
        `;
      }
    }

    if (listHost) {
      if (!status.loggedIn) {
        listHost.innerHTML = "";
      } else if (this.developerOverview?.recentAccounts.length) {
        listHost.innerHTML = this.developerOverview.recentAccounts
          .map(
            (account) => `
              <article class="stitch-devtool-row">
                <strong>${this.escapeHtml(account.nickname)}</strong>
                <span>${this.escapeHtml(account.account ?? "未绑定账号")} · ${this.escapeHtml(account.provider)}</span>
                <span>UID ${this.escapeHtml(account.gameId)} · Lv.${account.level} · ${account.totalMatches} 局 · ${this.escapeHtml(this.formatDateTime(account.createdAt))}</span>
              </article>
            `,
          )
          .join("");
      } else {
        listHost.innerHTML = `
          <article class="stitch-devtool-row stitch-devtool-row--empty">
            <strong>最近账号</strong>
            <span>暂无可展示的账号记录。</span>
          </article>
        `;
      }
    }

    if (statusHost) {
      if (!status.loggedIn) {
        statusHost.textContent = "登录后可查看账号数量与基本信息。";
      } else if (this.developerOverviewBusy) {
        statusHost.textContent = "正在拉取开发者账号总览...";
      } else if (this.developerOverviewError) {
        statusHost.textContent = this.developerOverviewError;
      } else if (this.developerOverview) {
        statusHost.textContent = `最近返回 ${this.developerOverview.recentAccounts.length} 条账号摘要，可用于确认注册链路已打通。`;
      } else {
        statusHost.textContent = "点击“刷新链路”即可读取当前开发者总览。";
      }
    }
  }

  private updateSettings(patch: Partial<GameSettings>) {
    this.settings = {
      ...this.settings,
      ...patch,
    };
    this.options.onSettingsChange(this.settings);
    this.applySettingsToForm();
  }

  private applySettingsToForm() {
    const playerName = this.normalizePlayerName(this.settings.playerName);
    if (playerName !== this.settings.playerName) {
      this.settings.playerName = playerName;
    }

    const displayName = this.getDisplayName();
    this.root
      .querySelectorAll<HTMLElement>("[data-player-name]")
      .forEach((el) => {
        el.textContent = displayName;
      });

    const nameInput = this.root.querySelector<HTMLInputElement>(
      'input[name="playerName"]',
    );
    if (nameInput && nameInput.value !== this.settings.playerName) {
      nameInput.value = this.settings.playerName;
    }

    const checkboxes = [
      "showFps",
      "showMinimap",
      "showLeaderboard",
      "developerMode",
      "reducedMotion",
    ] as const;
    checkboxes.forEach((key) => {
      const checkbox = this.root.querySelector<HTMLInputElement>(
        `input[name="${key}"]`,
      );
      if (checkbox) {
        checkbox.checked = this.settings[key];
      }
    });

    const skinId = resolveSkinId(this.settings.equippedSkinId);
    if (skinId !== this.settings.equippedSkinId) {
      this.settings.equippedSkinId = skinId;
    }

    this.root
      .querySelectorAll<HTMLElement>("[data-skin-id]")
      .forEach((button) => {
        const selected = button.dataset.skinId === skinId;
        button.classList.toggle("is-active", selected);
        button.setAttribute("aria-pressed", selected ? "true" : "false");
      });

    const activeSkin = getSkinOption(skinId);
    this.root.style.setProperty("--stitch-skin-a", activeSkin.colorA);
    this.root.style.setProperty("--stitch-skin-b", activeSkin.colorB);
    this.root.style.setProperty("--stitch-skin-glow", activeSkin.colorA);
    this.root.dataset.reducedMotion = String(this.settings.reducedMotion);

    this.syncAvatarSlots();
    this.syncActiveSkinPreview(activeSkin);
    this.applyProgressionToView();
    this.applyAuthStatusToView();
    this.renderDeveloperToolbox();
    this.syncLobbyFit();
  }

  private applyProgressionToView() {
    const level = Math.max(1, this.progression.level);
    const currentXp = Math.max(0, this.progression.currentXp);
    const requiredXp = Math.max(1, getRequiredXpForLevel(level));
    const totalMatches = Math.max(0, this.progression.totalMatches);
    const totalWins = Math.max(0, this.progression.totalWins);
    const winRate = totalMatches > 0 ? (totalWins / totalMatches) * 100 : 0;

    this.root
      .querySelectorAll<HTMLElement>("[data-progression-level]")
      .forEach((el) => {
        el.textContent = `${level}级`;
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-progression-coins]")
      .forEach((el) => {
        el.textContent = `${this.progression.coins}`;
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-progression-xp-display]")
      .forEach((el) => {
        el.textContent = `${currentXp} / ${requiredXp} XP`;
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-progression-winrate]")
      .forEach((el) => {
        el.textContent = `${winRate.toFixed(1)}%`;
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-progression-best-mass]")
      .forEach((el) => {
        el.textContent = this.formatMass(this.progression.bestMass);
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-progression-growth-meta]")
      .forEach((el) => {
        el.textContent = `${totalWins} 胜 / ${totalMatches} 局`;
      });
    this.renderLobbyRankBadge();
  }

  setLobbyRankInfo(rank: RankInfo) {
    this.lobbyRankInfo = rank;
    this.renderLobbyRankBadge();
  }

  private renderLobbyRankBadge() {
    const tier = RANK_TIERS[this.lobbyRankInfo.tierIndex];
    if (!tier) return;
    const label = getRankTierLabel(this.lobbyRankInfo);
    const chipHtml = `
      <div class="stitch-rank-chip">
        <div class="stitch-rank-chip-icon">${buildRankEmblemSvg(this.lobbyRankInfo, 24)}</div>
        <span class="stitch-rank-chip-label" style="color:${tier.color1}">${label}</span>
      </div>`;
    const el = this.root.querySelector<HTMLElement>("[data-lobby-rank-badge]");
    if (el) el.innerHTML = chipHtml;
  }

  private syncAvatarSlots() {
    const avatarUrl = this.settings.avatarDataUrl.trim();
    const hasAvatar = avatarUrl.length > 0;
    const fallbackChar = this.getDisplayName().charAt(0) || "球";

    this.root
      .querySelectorAll<HTMLElement>("[data-avatar-slot]")
      .forEach((slot) => {
        const img = slot.querySelector<HTMLImageElement>("[data-avatar-img]");
        const fallback = slot.querySelector<HTMLElement>(
          "[data-avatar-fallback]",
        );
        if (!img || !fallback) return;

        if (hasAvatar) {
          img.src = avatarUrl;
          img.classList.add("is-visible");
          fallback.classList.remove("is-visible");
          slot.classList.add("has-avatar");
        } else {
          img.removeAttribute("src");
          img.classList.remove("is-visible");
          fallback.textContent = fallbackChar;
          fallback.classList.add("is-visible");
          slot.classList.remove("has-avatar");
        }
      });
  }

  private syncActiveSkinPreview(activeSkin: SkinOption) {
    this.root
      .querySelectorAll<HTMLElement>("[data-active-skin-label]")
      .forEach((el) => {
        el.textContent = `挂载中 · ${activeSkin.name}`;
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-active-skin-title]")
      .forEach((el) => {
        el.textContent = activeSkin.name;
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-active-skin-code]")
      .forEach((el) => {
        el.textContent = activeSkin.code;
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-active-skin-series]")
      .forEach((el) => {
        el.textContent = activeSkin.series;
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-active-skin-rarity]")
      .forEach((el) => {
        el.textContent = activeSkin.rarity;
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-active-skin-finish]")
      .forEach((el) => {
        el.textContent = activeSkin.finish;
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-active-skin-scenario]")
      .forEach((el) => {
        el.textContent = activeSkin.scenario;
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-active-skin-signal]")
      .forEach((el) => {
        el.textContent = activeSkin.signal;
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-active-skin-signature]")
      .forEach((el) => {
        el.textContent = activeSkin.signature;
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-active-skin-palette]")
      .forEach((el) => {
        el.textContent = `${activeSkin.colorA.toUpperCase()} / ${activeSkin.colorB.toUpperCase()}`;
      });
  }

  notify(message: string) {
    this.showFeatureTip(message);
  }

  private showFeatureTip(message: string) {
    const tip = this.root.querySelector<HTMLElement>("[data-inline-tip]");
    if (tip) {
      tip.textContent = message;
    }

    this.root.classList.add("is-inline-tip-active");
    if (this.tipTimer !== null) {
      window.clearTimeout(this.tipTimer);
    }
    this.tipTimer = window.setTimeout(() => {
      this.root.classList.remove("is-inline-tip-active");
      this.tipTimer = null;
    }, 2400);
  }

  private applyFeatureSelection() {
    this.root
      .querySelectorAll<HTMLElement>("[data-feature]")
      .forEach((button) => {
        const feature = button.dataset.feature ?? "";
        const active = feature === this.selectedFeatureId;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
  }

  private setSkinDrawerOpen(open: boolean) {
    this.root.classList.toggle("is-skin-drawer-open", open);
    this.root
      .querySelectorAll<HTMLElement>("[data-toggle-skins]")
      .forEach((button) => {
        button.setAttribute("aria-expanded", open ? "true" : "false");
      });
    this.syncLobbyFit();
  }

  private syncLobbyFit() {
    const frame = this.root.querySelector<HTMLElement>(
      "[data-lobby-scale-frame]",
    );
    if (!frame) return;

    if (this.fitLayoutFrame !== null) {
      window.cancelAnimationFrame(this.fitLayoutFrame);
      this.fitLayoutFrame = null;
    }
    if (this.fitLayoutTimeout !== null) {
      window.clearTimeout(this.fitLayoutTimeout);
      this.fitLayoutTimeout = null;
    }

    this.root.style.setProperty("--stitch-fit-scale", "1");
    this.root.style.setProperty("--stitch-fit-bottom-offset", "0px");

    if (window.innerWidth <= 1024) {
      return;
    }
  }

  private scheduleTrayBottomAlignment(delayMs = 96) {
    if (this.trayBottomAlignmentTimeout !== null) {
      window.clearTimeout(this.trayBottomAlignmentTimeout);
    }

    this.trayBottomAlignmentTimeout = window.setTimeout(() => {
      this.alignTrayToViewportBottom();
      this.trayBottomAlignmentTimeout = null;
    }, delayMs);
  }

  private alignTrayToViewportBottom() {
    if (window.innerWidth <= 1024) {
      this.root.style.setProperty("--stitch-fit-bottom-offset", "0px");
      return;
    }

    const tray = this.root.querySelector<HTMLElement>(".stitch-base-tray");
    if (!tray) {
      return;
    }

    const rootStyle = window.getComputedStyle(this.root);
    const appliedScale =
      Number.parseFloat(rootStyle.getPropertyValue("--stitch-fit-scale")) || 1;
    if (appliedScale <= 0) {
      return;
    }

    const trayRect = tray.getBoundingClientRect();
    const visualBottomGap = Math.max(0, window.innerHeight - trayRect.bottom);
    const nextOffset =
      visualBottomGap <= 0.5
        ? 0
        : Math.min(240, visualBottomGap / appliedScale);

    this.root.style.setProperty(
      "--stitch-fit-bottom-offset",
      `${nextOffset.toFixed(2)}px`,
    );
  }

  private syncDocumentScrollLock() {
    const locked =
      this.root.classList.contains("is-visible") ||
      this.root.classList.contains("is-settings-open") ||
      this.root.classList.contains("is-auth-open");
    const overflowValue = locked ? "hidden" : "";
    document.documentElement.style.overflow = overflowValue;
    document.body.style.overflow = overflowValue;
    document.body.style.overscrollBehavior = locked ? "none" : "";
  }

  private applyAuthStatusToView() {
    const status = this.options.getAuthStatus?.() ?? {
      loggedIn: false,
      userLabel: "游客",
    };
    const label = status.loggedIn ? `已登录 · ${status.userLabel}` : "注册后开始";
    const accountBadge = status.loggedIn ? "云端在线" : "游客模式";
    const accountState = status.loggedIn ? "已认证账号" : "未登录";
    const accountHint = status.loggedIn
      ? status.accountLabel ?? "云存档已连接"
      : "登录后可同步资料与进度";

    this.root
      .querySelectorAll<HTMLElement>("[data-auth-label]")
      .forEach((el) => {
        el.textContent = label;
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-settings-account-name]")
      .forEach((el) => {
        el.textContent = status.loggedIn ? status.userLabel : "游客";
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-settings-account-badge]")
      .forEach((el) => {
        el.textContent = accountBadge;
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-settings-account-state]")
      .forEach((el) => {
        el.textContent = accountState;
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-settings-account-hint]")
      .forEach((el) => {
        el.textContent = accountHint;
      });

    const uid = status.gameId ?? "";
    this.root
      .querySelectorAll<HTMLElement>("[data-player-uid]")
      .forEach((el) => {
        el.textContent = uid ? uid : "—";
      });

    this.root.dataset.authState = status.loggedIn ? "loggedIn" : "guest";

    if (!status.loggedIn) {
      if (this.root.classList.contains("is-visible")) {
        this.root.classList.add("is-auth-required");
      }
      this.modeSnapshots = {};
      this.tasks = [];
      this.socialOverview = null;
      this.socialSearchResult = null;
      this.socialError = "";
      this.friends = [];
      this.mailInbox = [];
      this.mailError = "";
      this.mailBusy = false;
      this.mailDraftByNoticeId = {};
      const modeGridEl = this.root.querySelector<HTMLElement>("[data-mode-grid]");
      if (modeGridEl) {
        modeGridEl.innerHTML = this.buildModeCards();
      }
      this.applySelectedModeUI();
      const taskListEl = this.root.querySelector<HTMLElement>("[data-task-list-root]");
      if (taskListEl) {
        taskListEl.innerHTML = this.buildTaskRows();
      }
      const taskCounterEl = this.root.querySelector<HTMLElement>("[data-task-counter]");
      if (taskCounterEl) {
        taskCounterEl.textContent = this.buildTaskCounterLabel();
      }
      this.renderFriendsToLobby();
    }
    this.renderSocialCenter();
    this.renderActivityCenter();
    this.renderDeveloperToolbox();
    this.renderAuthPanel();
  }

  private isAuthGateLocked() {
    const status = this.options.getAuthStatus?.() ?? {
      loggedIn: false,
      userLabel: "游客",
    };
    return this.root.classList.contains("is-auth-required") && !status.loggedIn;
  }

  private clearAuthForms() {
    this.resetAuthFeedbackState(true);
    this.authResetChallengeId = "";

    AUTH_FIELD_NAMES.forEach((name) => {
      const input = this.root.querySelector<HTMLInputElement>(
        `input[name="${name}"]`,
      );
      if (input) {
        input.value = "";
      }
    });
  }

  private resetAuthFeedbackState(clearFocus = false) {
    this.authError = "";
    this.authNoticeTone = "hint";
    this.authFieldFeedback = {};
    if (clearFocus) {
      this.authFocusedField = null;
    }
  }

  private showAuthValidationError(
    fieldNames: AuthFieldName[],
    message: string,
  ) {
    this.resetAuthFeedbackState();
    this.authError = message;
    this.authNoticeTone = "error";
    fieldNames.forEach((fieldName) => {
      this.authFieldFeedback[fieldName] = {
        message,
        tone: "error",
      };
    });

    const primaryField = fieldNames[0];
    if (primaryField) {
      this.authFocusedField = primaryField;
    }

    this.renderAuthPanel();
    if (primaryField) {
      this.focusAuthField(primaryField);
    }
    this.triggerAuthFeedbackMotion(fieldNames);
  }

  private async handleSendRegisterVerificationCode() {
    if (this.authBusy) {
      return;
    }
    if (this.authCodeCooldowns.registerEmail > 0) {
      return;
    }

    const email = this.root
      .querySelector<HTMLInputElement>('input[name="authRegisterEmail"]')
      ?.value.trim() ?? "";
    if (!this.isValidEmail(email)) {
      this.showAuthValidationError(
        ["authRegisterEmail"],
        "先输入一个有效邮箱，再发送验证码。",
      );
      return;
    }

    this.resetAuthFeedbackState();
    this.authBusy = true;
    this.authBusyAction = "registerEmailCode";
    this.authBusyMessage = "正在发送邮箱验证码...";
    this.authNoticeTone = "busy";
    this.renderAuthPanel();

    try {
      const result = this.options.onSendRegisterEmailCode
        ? await this.options.onSendRegisterEmailCode({
          email,
        })
        : (() => {
          throw new Error("邮箱验证码服务尚未接入。");
        })();

      this.startAuthCodeCooldown(
        "registerEmail",
        Math.max(1, Math.ceil(result?.cooldownSeconds ?? 60)),
      );
      this.authError = "邮箱验证码已发出，请去收件箱或垃圾邮件里查看。";
      this.authNoticeTone = "hint";
      this.renderAuthPanel();
      this.focusAuthField("authRegisterEmailCode");
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : "验证码发送失败，请稍后重试。";
      this.authError = this.formatAuthErrorMessage(rawMessage, "register");
      this.authNoticeTone = "error";
      this.authFieldFeedback = this.resolveAuthFieldFeedback(
        rawMessage,
        "register",
      );
      if (!Object.keys(this.authFieldFeedback).length) {
        this.authFieldFeedback.authRegisterEmail = {
          message: this.authError,
          tone: "error",
        };
      }
      this.triggerAuthFeedbackMotion(
        Object.keys(this.authFieldFeedback) as AuthFieldName[],
      );
    } finally {
      this.authBusy = false;
      this.authBusyAction = null;
      this.authBusyMessage = "";
      this.renderAuthPanel();
    }
  }

  private async handleSendPasswordResetCode() {
    if (this.authBusy) {
      return;
    }
    if (this.authCodeCooldowns.resetEmail > 0) {
      return;
    }

    const account = this.root
      .querySelector<HTMLInputElement>('input[name="authResetAccount"]')
      ?.value.trim() ?? "";
    if (account.length < AUTH_ACCOUNT_MIN_LENGTH) {
      this.showAuthValidationError(
        ["authResetAccount"],
        "先输入已注册账号，再发送找回验证码。",
      );
      return;
    }

    this.resetAuthFeedbackState();
    this.authResetChallengeId = "";
    this.authBusy = true;
    this.authBusyAction = "resetRequest";
    this.authBusyMessage = "正在发送找回验证码...";
    this.authNoticeTone = "busy";
    this.renderAuthPanel();

    try {
      if (!this.options.onRequestPasswordReset) {
        throw new Error("邮箱找回服务尚未接入。");
      }

      const result = await this.options.onRequestPasswordReset({
        account,
      });

      this.authResetChallengeId = result.challengeId;
      this.startAuthCodeCooldown(
        "resetEmail",
        Math.max(1, Math.ceil(result.cooldownSeconds ?? 60)),
      );
      this.authError =
        "如果该账号已绑定邮箱，验证码已发送，请检查收件箱或垃圾邮件。";
      this.authNoticeTone = "hint";
      this.renderAuthPanel();
      this.focusAuthField("authResetCode");
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : "找回验证码发送失败，请稍后重试。";
      this.authError = this.formatAuthErrorMessage(rawMessage, "reset");
      this.authNoticeTone = "error";
      this.authFieldFeedback = this.resolveAuthFieldFeedback(
        rawMessage,
        "reset",
      );
      if (!Object.keys(this.authFieldFeedback).length) {
        this.authFieldFeedback.authResetAccount = {
          message: this.authError,
          tone: "error",
        };
      }
      this.triggerAuthFeedbackMotion(
        Object.keys(this.authFieldFeedback) as AuthFieldName[],
      );
    } finally {
      this.authBusy = false;
      this.authBusyAction = null;
      this.authBusyMessage = "";
      this.renderAuthPanel();
    }
  }

  private startAuthCodeCooldown(kind: AuthCodeCooldownKey, seconds: number) {
    this.authCodeCooldowns[kind] = Math.max(0, Math.floor(seconds));
    if (
      this.authCodeCooldownTimer === null &&
      Object.values(this.authCodeCooldowns).some((value) => value > 0)
    ) {
      this.authCodeCooldownTimer = window.setInterval(() => {
        (Object.keys(this.authCodeCooldowns) as AuthCodeCooldownKey[]).forEach(
          (cooldownKey) => {
            this.authCodeCooldowns[cooldownKey] = Math.max(
              0,
              this.authCodeCooldowns[cooldownKey] - 1,
            );
          },
        );

        if (
          !Object.values(this.authCodeCooldowns).some((value) => value > 0) &&
          this.authCodeCooldownTimer !== null
        ) {
          window.clearInterval(this.authCodeCooldownTimer);
          this.authCodeCooldownTimer = null;
        }
        this.renderAuthPanel();
      }, 1000);
    }
    this.renderAuthPanel();
  }

  private getAuthCapabilities(): LobbyAuthCapabilities {
    return (
      this.options.getAuthCapabilities?.() ?? {
        emailVerificationEnabled: false,
        emailProvider: null,
      }
    );
  }

  private isValidEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }

  private resolveAuthFieldFeedback(
    message: string,
    mode: "login" | "register" | "reset" | "logout",
  ): Partial<Record<AuthFieldName, AuthFieldFeedback>> {
    const lower = message.trim().toLowerCase();

    if (
      mode === "login" &&
      (lower.includes("invalid credentials") ||
        lower.includes("auth_invalid_credentials"))
    ) {
      return {
        authLoginAccount: {
          message: "账号不存在，或者和这组密码不匹配。",
          tone: "error",
        },
        authLoginPassword: {
          message: "密码错误，或者与当前账号不对应。",
          tone: "error",
        },
      };
    }

    if (mode === "register" && lower.includes("account already exists")) {
      return {
        authRegisterAccount: {
          message: "这个账号已经被注册了，换一个新的账号 ID。",
          tone: "error",
        },
      };
    }

    if (mode === "register" && lower.includes("email is already bound")) {
      return {
        authRegisterEmail: {
          message: "这个邮箱已经绑定过其他账号了。",
          tone: "error",
        },
      };
    }

    if (mode === "register" && lower.includes("email address is invalid")) {
      return {
        authRegisterEmail: {
          message: "邮箱格式不正确，请重新检查。",
          tone: "error",
        },
      };
    }

    if (
      (mode === "register" || mode === "reset") &&
      (lower.includes("verification code is invalid") ||
        lower.includes("verification code is missing") ||
        lower.includes("verification code is expired") ||
        lower.includes("already been used") ||
        lower.includes("password reset challenge is invalid"))
    ) {
      if (mode === "reset") {
        return {
          authResetCode: {
            message: "邮箱验证码不正确、已过期，或者已经被使用。",
            tone: "error",
          },
        };
      }
      const emailFilled = Boolean(
        this.root
          .querySelector<HTMLInputElement>('input[name="authRegisterEmail"]')
          ?.value.trim(),
      );
      if (emailFilled) {
        return {
          authRegisterEmailCode: {
            message: "邮箱验证码不正确、已过期，或者已经被使用。",
            tone: "error",
          },
        };
      }
    }

    return {};
  }

  private getAuthFieldFeedback(fieldName: AuthFieldName, loggedIn: boolean) {
    const emptyState: AuthFieldFeedback = { message: "", tone: "hint" };
    if (loggedIn || this.getAuthModeForField(fieldName) !== this.authMode) {
      return emptyState;
    }

    const explicitFeedback = this.authFieldFeedback[fieldName];
    if (explicitFeedback) {
      return explicitFeedback;
    }

    return emptyState;
  }

  private getAuthModeForField(fieldName: AuthFieldName): AuthMode {
    if (fieldName.startsWith("authLogin")) {
      return "login";
    }
    if (fieldName.startsWith("authReset")) {
      return "reset";
    }
    return "register";
  }

  private isAuthFieldName(value: string): value is AuthFieldName {
    return AUTH_FIELD_NAMES.includes(value as AuthFieldName);
  }

  private triggerAuthFeedbackMotion(fieldNames: AuthFieldName[] = []) {
    const panel = this.root.querySelector<HTMLElement>(".stitch-auth-panel");
    const fields = fieldNames
      .map((fieldName) =>
        this.root.querySelector<HTMLElement>(`[data-auth-field="${fieldName}"]`),
      )
      .filter((field): field is HTMLElement => Boolean(field));

    panel?.classList.remove("is-feedback-error");
    fields.forEach((field) => field.classList.remove("is-feedback-bump"));

    void panel?.offsetWidth;
    fields.forEach((field) => {
      void field.offsetWidth;
    });

    panel?.classList.add("is-feedback-error");
    fields.forEach((field) => field.classList.add("is-feedback-bump"));

    if (this.authFeedbackResetTimer !== null) {
      window.clearTimeout(this.authFeedbackResetTimer);
    }

    this.authFeedbackResetTimer = window.setTimeout(() => {
      panel?.classList.remove("is-feedback-error");
      fields.forEach((field) => field.classList.remove("is-feedback-bump"));
      this.authFeedbackResetTimer = null;
    }, 620);
  }

  private bindAuthShowcaseMotion() {
    const showcase = this.root.querySelector<HTMLElement>("[data-auth-showcase]");
    if (!showcase) {
      return;
    }

    const resetMotion = () => {
      showcase.classList.remove("is-pointer-active");
      showcase.style.setProperty("--stitch-auth-tilt-x", "0deg");
      showcase.style.setProperty("--stitch-auth-tilt-y", "0deg");
      showcase.style.setProperty("--stitch-auth-stage-shift-x", "0px");
      showcase.style.setProperty("--stitch-auth-stage-shift-y", "0px");
      showcase.style.setProperty("--stitch-auth-signal-shift-x", "0px");
      showcase.style.setProperty("--stitch-auth-signal-shift-y", "0px");
      showcase.style.setProperty("--stitch-auth-glint-x", "50%");
      showcase.style.setProperty("--stitch-auth-glint-y", "50%");
    };

    const updateMotion = (clientX: number, clientY: number) => {
      if (!showcase.isConnected) {
        return;
      }
      const rect = showcase.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }


      const ratioX = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const ratioY = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
      const normalizedX = (ratioX - 0.5) * 2;
      const normalizedY = (ratioY - 0.5) * 2;

      showcase.classList.add("is-pointer-active");
      showcase.style.setProperty(
        "--stitch-auth-tilt-x",
        `${(-normalizedY * 7).toFixed(2)}deg`,
      );
      showcase.style.setProperty(
        "--stitch-auth-tilt-y",
        `${(normalizedX * 9).toFixed(2)}deg`,
      );
      showcase.style.setProperty(
        "--stitch-auth-stage-shift-x",
        `${(normalizedX * 10).toFixed(2)}px`,
      );
      showcase.style.setProperty(
        "--stitch-auth-stage-shift-y",
        `${(normalizedY * -8).toFixed(2)}px`,
      );
      showcase.style.setProperty(
        "--stitch-auth-signal-shift-x",
        `${(normalizedX * -6).toFixed(2)}px`,
      );
      showcase.style.setProperty(
        "--stitch-auth-signal-shift-y",
        `${(normalizedY * -10).toFixed(2)}px`,
      );
      showcase.style.setProperty(
        "--stitch-auth-glint-x",
        `${(ratioX * 100).toFixed(2)}%`,
      );
      showcase.style.setProperty(
        "--stitch-auth-glint-y",
        `${(ratioY * 100).toFixed(2)}%`,
      );
    };

    resetMotion();

    showcase.addEventListener("pointermove", (event) => {
      if (
        event.pointerType &&
        event.pointerType !== "mouse" &&
        event.pointerType !== "pen"
      ) {
        return;
      }
      updateMotion(event.clientX, event.clientY);
    });
    showcase.addEventListener("pointerleave", resetMotion);
    showcase.addEventListener("pointercancel", resetMotion);
  }

  private formatAuthErrorMessage(
    message: string,
    mode: "login" | "register" | "reset" | "logout",
  ) {
    const raw = message.trim();

    if (!raw) {
      if (mode === "register") {
        return "注册失败，请重试。";
      }
      if (mode === "reset") {
        return "密码找回失败，请重试。";
      }
      if (mode === "login") {
        return "登录失败，请重试。";
      }
      return "退出登录失败，请重试。";
    }

    const lower = raw.toLowerCase();
    if (lower.includes("account already exists")) {
      return "这个账号已经注册过了，请直接登录或换一个新账号。";
    }
    if (lower.includes("email is already bound")) {
      return "这个邮箱已经绑定到其他账号了，换一个邮箱再试。";
    }
    if (
      lower.includes("invalid credentials") ||
      lower.includes("auth_invalid_credentials")
    ) {
      return "账号或密码不对，请检查后重试。";
    }
    if (
      lower.includes("verification code is invalid") ||
      lower.includes("verification code is missing") ||
      lower.includes("verification code is expired") ||
      lower.includes("already been used") ||
      lower.includes("password reset challenge is invalid")
    ) {
      return "验证码不正确、已过期，或者已经被使用。";
    }
    if (lower.includes("email address is invalid")) {
      return "邮箱格式不正确，请重新检查。";
    }
    if (lower.includes("requested too frequently")) {
      return "发送太频繁了，稍等一会儿再重试。";
    }
    if (lower.includes("email delivery is not configured")) {
      return "邮箱服务还没配置完成，当前无法发送邮件验证码。";
    }
    if (
      lower.includes("failed to fetch") ||
      lower.includes("network request failed") ||
      lower.includes("service unavailable")
    ) {
      return "账号服务暂时连不上，请稍后再试。";
    }

    return raw;
  }

  private focusAuthField(fieldName?: AuthFieldName) {
    const selector =
      fieldName
        ? `input[name="${fieldName}"]`
        : this.authMode === "reset"
          ? 'input[name="authResetAccount"]'
          : this.authMode === "register"
            ? 'input[name="authRegisterAccount"]'
            : 'input[name="authLoginAccount"]';
    this.root.querySelector<HTMLInputElement>(selector)?.focus();
  }

  private buildDeveloperMetricCards(
    items: Array<{ label: string; value: string }>,
  ) {
    return items
      .map(
        (item) => `
          <article class="stitch-devtool-metric">
            <strong>${this.escapeHtml(item.value)}</strong>
            <span>${this.escapeHtml(item.label)}</span>
          </article>
        `,
      )
      .join("");
  }

  private formatDateTime(value: string | null) {
    if (!value) {
      return "暂无";
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    const month = `${parsed.getMonth() + 1}`.padStart(2, "0");
    const day = `${parsed.getDate()}`.padStart(2, "0");
    const hours = `${parsed.getHours()}`.padStart(2, "0");
    const minutes = `${parsed.getMinutes()}`.padStart(2, "0");
    return `${month}-${day} ${hours}:${minutes}`;
  }

  private getModeCardPresentation(card: StitchModeCard) {
    const snapshot = this.modeSnapshots[card.id];
    return {
      metrics: snapshot?.metrics?.length ? snapshot.metrics : card.metrics,
      tags: snapshot?.tags ?? card.tags,
      status: snapshot?.status ?? card.status,
      rankLabel: snapshot?.rankLabel ?? "暂无数据",
    };
  }

  private buildTaskCounterLabel() {
    if (!this.tasks.length) {
      return "暂无任务";
    }
    const finishedCount = this.tasks.filter(
      (task) => task.progress >= task.total,
    ).length;
    return `${finishedCount} / ${this.tasks.length}`;
  }

  private toProgression(summary: UserSummary): PlayerProgression {
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

  private escapeHtml(value: string) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  private getSelectedCard(): StitchModeCard {
    return (
      STITCH_MODE_CARDS.find((card) => card.id === this.selectedCardId) ??
      STITCH_MODE_CARDS[0]
    );
  }

  private normalizePlayerName(raw: string): string {
    return raw.trim().slice(0, MAX_PLAYER_NAME_LENGTH);
  }

  private getDisplayName(): string {
    return this.settings.playerName.trim().length > 0
      ? this.settings.playerName
      : "勇者球球";
  }

  private isStitchModeCardId(value: string): value is StitchModeCardId {
    return STITCH_MODE_CARDS.some((card) => card.id === value);
  }

  private isLobbyFeatureId(value: string): value is LobbyFeatureId {
    return value === "shop" || value === "magic" || value === "friends" || value === "leaderboard" || value === "activity" || value === "signin";
  }

  private formatMass(rawMass: number): string {
    const value = Math.max(0, Math.floor(rawMass));
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`;
    }
    return `${value} kg`;
  }

  private resolveBackendHealthUrl() {
    try {
      const baseUrl = networkConfig.apiBaseUrl.startsWith("http")
        ? new URL(networkConfig.apiBaseUrl)
        : new URL(networkConfig.apiBaseUrl, window.location.origin);
      baseUrl.pathname = "/healthz";
      baseUrl.search = "";
      baseUrl.hash = "";
      return baseUrl.toString();
    } catch {
      return `${window.location.origin}/healthz`;
    }
  }

  private async refreshBackendPing() {
    const pingLabel = this.root.querySelector<HTMLElement>("[data-backend-ping]");
    if (!pingLabel) {
      return;
    }

    pingLabel.textContent = "网络延迟: 检测中 | 正在探测后端";
    const startedAt = performance.now();

    try {
      const response = await fetch(this.resolveBackendHealthUrl(), {
        cache: "no-store",
      });
      if (!response.ok) {
        pingLabel.textContent = "网络延迟: -- | 后端响应异常";
        return;
      }
      const elapsedMs = Math.max(1, Math.round(performance.now() - startedAt));
      pingLabel.textContent = `网络延迟: ${elapsedMs}ms | 后端在线`;
    } catch {
      pingLabel.textContent = "网络延迟: -- | 后端暂不可达";
    }
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
        } else {
          reject(new Error("Failed to read avatar data URL."));
        }
      };
      reader.onerror = () =>
        reject(reader.error ?? new Error("Failed to read avatar file."));
      reader.readAsDataURL(file);
    });
  }
}
