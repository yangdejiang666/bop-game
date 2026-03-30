import type { GameSettings } from "../app/settings";
import {
  type PlayerProgression,
  getRequiredXpForLevel,
  loadPlayerProgression,
} from "../app/progression";
import {
  type SkinOption,
  SKIN_OPTIONS,
  getSkinOption,
  resolveSkinId,
} from "../app/skins";
import type { DeveloperAccountsOverview } from "../../shared-protocol/src/user";
import type {
  SocialOverview,
  SocialRelationship,
  SocialSearchResult,
} from "../../shared-protocol/src/social";
import { lobbyService, type LobbyTask, type LobbyFriend } from "../network/lobbyService";

export type LobbyModeId =
  | "ranked"
  | "peak"
  | "classic"
  | "battleRoyale";

export interface LobbyAuthStatus {
  loggedIn: boolean;
  userLabel: string;
  accountLabel?: string;
}

export interface LobbyLoginPayload {
  account: string;
  password: string;
}

export interface LobbyRegisterPayload {
  account: string;
  password: string;
  nickname?: string;
}

export type LobbyFeatureId = "shop" | "magic" | "friends";

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
  clerkEnabled?: boolean;
  onClerkLoginStart?: () => Promise<void> | void;
  onFeatureAction?: (feature: LobbyFeatureId) => Promise<void> | void;
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
  icon: string;
  theme: "cyan" | "violet" | "gold" | "neutral" | "red" | "amber" | "purple";
  status: "已开放" | "测试中" | "训练";
}

const MAX_PLAYER_NAME_LENGTH = 12;
const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024;
const AUTH_ACCOUNT_MIN_LENGTH = 3;
const AUTH_PASSWORD_MIN_LENGTH = 6;

const STITCH_MODE_CARDS: StitchModeCard[] = [
  {
    id: "ranked",
    modeId: "ranked",
    kicker: "竞技模式",
    name: "排位赛",
    subtitle: "向最高荣誉发起冲锋",
    icon: "trophy",
    theme: "gold",
    status: "已开放",
  },
  {
    id: "peak",
    modeId: "peak",
    kicker: "精英模式",
    name: "巅峰赛",
    subtitle: "冷感冲榜，争夺更高席位",
    icon: "military_tech",
    theme: "violet",
    status: "已开放",
  },
  {
    id: "classic",
    modeId: "classic",
    kicker: "经典模式",
    name: "经典模式",
    subtitle: "主球体舞台，轻快又熟悉",
    icon: "view_cozy",
    theme: "cyan",
    status: "已开放",
  },
  {
    id: "battleRoyale",
    modeId: "battleRoyale",
    kicker: "生存模式",
    name: "大逃杀",
    subtitle: "缩圈压迫，活到最后",
    icon: "local_fire_department",
    theme: "red",
    status: "已开放",
  },
];

const FEATURE_TIPS: Record<LobbyFeatureId, string> = {
  shop: "商店入口已预留，可继续接皮肤与道具接口。",
  magic: "魔法屋入口已预留，可继续接抽取与升级接口。",
  friends: "好友入口已预留，可继续接本地/联机社交关系。",
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
  private socialOverview: SocialOverview | null = null;
  private socialSearchResult: SocialSearchResult | null = null;
  private socialBusy = false;
  private socialError = "";
  private authMode: "login" | "register" = "login";
  private authBusy = false;
  private authError = "";
  private fitLayoutFrame: number | null = null;
  private fitLayoutTimeout: number | null = null;
  private trayBottomAlignmentTimeout: number | null = null;
  private developerOverview: DeveloperAccountsOverview | null = null;
  private developerOverviewBusy = false;
  private developerOverviewError = "";
  private developerOverviewRequestVersion = 0;

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
      this.socialOverview = data.overview;
      this.socialError = "";
      this.socialSearchResult = null;

      const modeStatusEl = this.root.querySelector<HTMLElement>("[data-mode-status]");
      if (modeStatusEl) modeStatusEl.textContent = data.modeStatus;

      const taskListEl = this.root.querySelector<HTMLElement>("[data-task-list-root]");
      if (taskListEl) taskListEl.innerHTML = this.buildTaskRows();
      this.renderFriendsToLobby();
      this.renderSocialCenter();
      this.scheduleTrayBottomAlignment(160);
    } catch (e) {
      console.error("Failed to load lobby data", e);
      this.socialError = e instanceof Error ? e.message : "社交数据读取失败。";
      this.renderSocialCenter();
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
                <div class="stitch-scale-frame" data-lobby-scale-frame>
                    <header class="stitch-topbar stitch-hud-top">
                        <div class="stitch-brand stitch-hud-brand">
                            <div class="stitch-hud-server-ping">
                                <span class="ping-dot"></span>
                                <span class="ping-ms">18ms</span>
                            </div>
                            <strong class="stitch-brand-title">球球实验室</strong>
                        </div>

                        <div class="stitch-resource-bar stitch-hud-resources">
                            <article class="stitch-resource-chip">
                                <span class="stitch-resource-icon">
                                    ${renderMaterialSymbol("stars", "stitch-resource-symbol")}
                                </span>
                                <span class="stitch-resource-copy">
                                    <small>金币</small>
                                    <strong data-progression-coins>0</strong>
                                </span>
                            </article>
                            <article class="stitch-resource-chip">
                                <span class="stitch-resource-icon">
                                    ${renderMaterialSymbol("diamond", "stitch-resource-symbol")}
                                </span>
                                <span class="stitch-resource-copy">
                                    <small>经验</small>
                                    <strong data-progression-xp-display>0 / 208 XP</strong>
                                </span>
                            </article>
                            <button type="button" class="stitch-resource-add" data-feature="shop" aria-label="商店">
                                ${renderMaterialSymbol("add", "stitch-resource-add-symbol")}
                            </button>
                        </div>

                        <div class="stitch-top-actions stitch-hud-actions">
                            <button type="button" class="stitch-hud-btn" data-top-action="activity" aria-label="活动">
                                ${renderMaterialSymbol("notifications", "stitch-hud-btn-symbol")}
                            </button>
                            <button type="button" class="stitch-hud-btn-text" data-open-settings aria-label="修改名字">
                                ${renderMaterialSymbol("edit_square", "stitch-hud-btn-symbol")}
                                <span>身份设置</span>
                            </button>
                            <button type="button" class="stitch-auth-btn stitch-hud-btn-text stitch-hud-btn-text--accent" data-auth-action aria-label="账号操作">
                                ${renderMaterialSymbol("fingerprint", "stitch-hud-btn-symbol")}
                                <span class="stitch-auth-btn-label" data-auth-label>未接入</span>
                            </button>
                            <button type="button" class="stitch-hud-btn" data-open-settings aria-label="设置">
                                ${renderMaterialSymbol("settings", "stitch-hud-btn-symbol")}
                            </button>
                        </div>
                    </header>

                    <main class="stitch-main">
                        <aside class="stitch-left-col stitch-tac-sidebar">
                            <div class="stitch-tac-drawer">
                                <!-- 窄身常驻监控区 -->
                                <div class="stitch-tac-collapsed">
                                    <div class="stitch-tac-badge" data-progression-level>1 级</div>
                                    <div class="stitch-tac-online-dot"></div>
                                    <div class="stitch-tac-vert-name" data-player-name>勇者球球</div>
                                </div>
                                
                                <!-- 展开后的战术详图区 -->
                                <div class="stitch-tac-expanded">
                                    <div class="stitch-tac-head">
                                        <div class="stitch-tac-kicker"><span class="stitch-tac-kicker-dot"></span> 皮肤战术档案 // TAC-NET </div>
                                        <h2 class="stitch-tac-name" data-player-name>勇者球球</h2>
                                        <div class="stitch-tac-meta">
                                            <span class="stitch-online-state">信号在线</span>
                                            <span class="stitch-current-mode" data-current-mode-name>排位赛</span>
                                        </div>
                                    </div>

                                    <div class="stitch-tac-model-stage">
                                        <div class="stitch-ball-stage">
                                            <span class="stitch-ring stitch-ring--outer"></span>
                                            <span class="stitch-ring stitch-ring--mid"></span>
                                            <span class="stitch-ring stitch-ring--inner"></span>
                                            <span class="stitch-crosshair stitch-crosshair--h"></span>
                                            <span class="stitch-crosshair stitch-crosshair--v"></span>
                                            <div class="stitch-ball-core ball-glow">
                                                <span class="stitch-ball-surface"></span>
                                                <span class="stitch-ball-highlight"></span>
                                                <span class="stitch-ball-sheen"></span>
                                            </div>
                                            <span class="stitch-ball-skin-name" data-active-skin-label>挂载中 · 经典蓝</span>
                                            <button type="button" class="stitch-stage-bolt" data-toggle-skins aria-label="切换挂载">
                                                ${renderMaterialSymbol("palette", "stitch-stage-bolt-symbol")}
                                            </button>
                                        </div>
                                    </div>

                                    <section class="stitch-skin-profile">
                                        <div class="stitch-skin-profile-head">
                                            <small>当前挂载 / SKIN DOSSIER</small>
                                            <strong data-active-skin-title>经典蓝</strong>
                                            <span data-active-skin-signature>蓝白双层护膜，轮廓稳定，适合长时间主界面展示。</span>
                                        </div>
                                        <div class="stitch-skin-spectrum">
                                            <span class="stitch-skin-swatch stitch-skin-swatch--a" aria-hidden="true"></span>
                                            <span class="stitch-skin-swatch stitch-skin-swatch--b" aria-hidden="true"></span>
                                            <span class="stitch-skin-spectrum-copy" data-active-skin-palette>#81ECFF / #4F7DFF</span>
                                        </div>
                                        <div class="stitch-skin-meta-grid">
                                            <article class="stitch-skin-meta-card">
                                                <small>代号</small>
                                                <strong data-active-skin-code>AX-01</strong>
                                            </article>
                                            <article class="stitch-skin-meta-card">
                                                <small>系列</small>
                                                <strong data-active-skin-series>标准竞技</strong>
                                            </article>
                                            <article class="stitch-skin-meta-card">
                                                <small>稀有度</small>
                                                <strong data-active-skin-rarity>标准</strong>
                                            </article>
                                            <article class="stitch-skin-meta-card">
                                                <small>工艺</small>
                                                <strong data-active-skin-finish>冷光镜面</strong>
                                            </article>
                                            <article class="stitch-skin-meta-card">
                                                <small>场景</small>
                                                <strong data-active-skin-scenario>大厅常驻</strong>
                                            </article>
                                            <article class="stitch-skin-meta-card">
                                                <small>信号</small>
                                                <strong data-active-skin-signal>冷调清晰</strong>
                                            </article>
                                        </div>
                                    </section>

                                    <div class="stitch-tac-data-grid">
                                        <article class="stitch-tac-radar">
                                            <small>全局表现 / WR</small>
                                            <strong data-progression-winrate>0%</strong>
                                            <span data-progression-growth-meta>0 胜 / 0 局</span>
                                        </article>
                                        <article class="stitch-tac-radar is-accent">
                                            <small>峰值质量 / PI PEAK</small>
                                            <strong data-progression-best-mass>0 kg</strong>
                                        </article>
                                    </div>

                                    <button type="button" class="stitch-tac-action-btn btn-sweep" data-toggle-skins aria-expanded="false">
                                        :: 变更装甲贴花
                                    </button>

                                    <section class="stitch-skin-drawer" data-skin-drawer>
                                        <div class="stitch-skin-drawer-head">
                                            <strong>本地烤漆方案</strong>
                                            <small>点击注入主球外观</small>
                                        </div>
                                        <div class="stitch-skin-list">
                                            ${this.buildSkinButtons("main")}
                                        </div>
                                    </section>
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
                                    <span class="stitch-mode-status" data-mode-status>已开放</span>
                                </div>
                                    <div class="stitch-mode-grid">
                                        ${this.buildModeCards()}
                                    </div>
                                </section>

                            <div class="stitch-spacer" style="flex:1;"></div>

                            <section class="stitch-core-launch-stage">
                                <button type="button" class="stitch-launch-btn" data-start-game>
                                    <div class="stitch-launch-pulse"></div>
                                    <div class="stitch-launch-border"></div>
                                    <div class="stitch-launch-inner">
                                        <span class="stitch-launch-text">引擎启动</span>
                                        <small class="stitch-launch-ms">// START</small>
                                    </div>
                                    <div class="stitch-launch-flare"></div>
                                </button>
                            </section>
                        </section>
                    </main>
                    
                    <!-- 悬浮 Dock 和 抽屉遮罩 -->
                    <div class="stitch-drawer-backdrop" data-drawer-backdrop></div>
                    
                    <footer class="stitch-base-tray">
                        <div class="stitch-tray-plate"></div>
                        <nav class="stitch-tray-nav">
                            <button type="button" class="stitch-tray-btn" data-toggle-drawer="tasks" aria-label="任务中心">
                                ${renderMaterialSymbol("library_add_check", "stitch-tray-symbol")}
                                <span>指令站 / TASK</span>
                            </button>
                            <button type="button" class="stitch-tray-btn" data-toggle-drawer="friends" aria-label="好友列表">
                                ${renderMaterialSymbol("groups", "stitch-tray-symbol")}
                                <span>通讯栈 / SOCIAL</span>
                            </button>
                            <button type="button" class="stitch-tray-btn" data-feature="shop" aria-label="商城">
                                ${renderMaterialSymbol("storefront", "stitch-tray-symbol")}
                                <span>黑市交易 / MARKET</span>
                            </button>
                            <button type="button" class="stitch-tray-btn" data-feature="magic" aria-label="魔法屋">
                                ${renderMaterialSymbol("auto_awesome", "stitch-tray-symbol")}
                                <span>量子祈愿 / WISH</span>
                            </button>
                        </nav>
                        <div class="stitch-tray-glowline"></div>
                    </footer>

                    <!-- 左侧战术抽屉：系统任务 -->
                    <aside class="stitch-z4-drawer is-left" data-drawer-name="tasks">
                        <div class="stitch-z4-glow-edge"></div>
                        <div class="stitch-z4-content">
                            <div class="stitch-z4-head">
                                <div class="stitch-z4-headline">
                                    <span class="stitch-z4-kicker">/ MISSION LOG</span>
                                    <strong>每日签发指令</strong>
                                </div>
                                <span class="stitch-z4-counter">2 / 5</span>
                            </div>
                            <div class="stitch-z4-body">
                                <div class="stitch-task-list" data-task-list-root>
                                    ${this.buildTaskRows()}
                                </div>
                            </div>
                        </div>
                    </aside>

                    <!-- 右侧情报抽屉：星港通讯录 -->
                    <aside class="stitch-z4-drawer is-right" data-drawer-name="friends">
                        <div class="stitch-z4-content">
                            <div class="stitch-z4-head">
                                <div class="stitch-z4-headline">
                                    <span class="stitch-z4-kicker">/ SOCIAL LINK</span>
                                    <strong>星港突击小队</strong>
                                </div>
                                <button type="button" class="stitch-z4-link" data-feature="friends">:: 同步全站</button>
                            </div>
                            <div class="stitch-z4-body">
                                <div class="stitch-friend-list" data-friend-list-root>
                                    ${this.buildFriendRows()}
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
                            <small>本地设置</small>
                            <h2 id="stitch-settings-title">账号与显示配置</h2>
                        </div>
                        <button type="button" class="stitch-settings-close" data-close-settings aria-label="关闭设置">×</button>
                    </div>

                    <div class="stitch-settings-avatar-row">
                        <span class="stitch-avatar-slot stitch-avatar-slot--settings" data-avatar-slot>
                            <img class="stitch-avatar-img" data-avatar-img alt="头像" />
                            <span class="stitch-avatar-fallback" data-avatar-fallback>球</span>
                        </span>
                        <div class="stitch-settings-avatar-actions">
                            <button type="button" class="stitch-ghost-btn" data-avatar-trigger>上传头像</button>
                            <button type="button" class="stitch-ghost-btn" data-avatar-clear>清空头像</button>
                        </div>
                    </div>

                    <label class="stitch-settings-field">
                        <span>玩家昵称</span>
                        <input type="text" name="playerName" maxlength="${MAX_PLAYER_NAME_LENGTH}" />
                    </label>

                    <div class="stitch-settings-section">
                        <div class="stitch-settings-title">皮肤预设</div>
                        <div class="stitch-skin-list stitch-skin-list--settings">
                            ${this.buildSkinButtons("settings")}
                        </div>
                    </div>

                    <div class="stitch-settings-grid">
                        <label class="stitch-settings-toggle">
                            <input type="checkbox" name="showFps" />
                            <span>显示 FPS</span>
                        </label>
                        <label class="stitch-settings-toggle">
                            <input type="checkbox" name="showMinimap" />
                            <span>显示小地图</span>
                        </label>
                        <label class="stitch-settings-toggle">
                            <input type="checkbox" name="developerMode" />
                            <span>开发者模式（默认关闭）</span>
                        </label>
                        <label class="stitch-settings-toggle stitch-settings-toggle--wide">
                            <input type="checkbox" name="reducedMotion" />
                            <span>减少动效</span>
                        </label>
                    </div>

                    <section class="stitch-settings-section stitch-settings-section--social" data-social-center>
                        <div class="stitch-settings-section-head">
                            <div>
                                <div class="stitch-settings-title">好友与黑名单</div>
                                <small>通过 9 位 UID 查找好友，打通申请、取关与黑名单链路。</small>
                            </div>
                            <button type="button" class="stitch-ghost-btn" data-social-refresh>刷新社交</button>
                        </div>

                        <div class="stitch-devtool-summary stitch-social-summary">
                            <article class="stitch-devtool-metric">
                                <strong data-social-count-friends>--</strong>
                                <span>好友数</span>
                            </article>
                            <article class="stitch-devtool-metric">
                                <strong data-social-count-incoming>--</strong>
                                <span>待处理申请</span>
                            </article>
                            <article class="stitch-devtool-metric">
                                <strong data-social-count-outgoing>--</strong>
                                <span>我发出的申请</span>
                            </article>
                            <article class="stitch-devtool-metric">
                                <strong data-social-count-blocks>--</strong>
                                <span>黑名单</span>
                            </article>
                        </div>

                        <div class="stitch-social-search-row">
                            <label class="stitch-settings-field stitch-social-search-field">
                                <span>UID 查找</span>
                                <input type="text" inputmode="numeric" pattern="\\d*" maxlength="9" placeholder="输入 9 位 UID" data-social-search-input />
                            </label>
                            <button type="button" class="stitch-ghost-btn" data-social-search-btn>查找</button>
                        </div>

                        <div class="stitch-devtool-list" data-social-search-result></div>
                        <div class="stitch-devtool-list" data-social-friend-list></div>
                        <div class="stitch-devtool-list" data-social-incoming-list></div>
                        <div class="stitch-devtool-list" data-social-outgoing-list></div>
                        <div class="stitch-devtool-list" data-social-block-list></div>
                        <div class="stitch-devtool-status" data-social-status>登录后可通过 UID 查找好友、处理申请和管理黑名单。</div>
                    </section>

                    <section class="stitch-settings-section stitch-settings-section--developer">
                        <div class="stitch-settings-section-head">
                            <div>
                                <div class="stitch-settings-title">开发者工具箱</div>
                                <small>确认账号注册、保存和读取链路已经打通。</small>
                            </div>
                            <button type="button" class="stitch-ghost-btn" data-devtool-refresh>刷新链路</button>
                        </div>
                        <div class="stitch-devtool-summary" data-devtool-summary></div>
                        <div class="stitch-devtool-current" data-devtool-current></div>
                        <div class="stitch-devtool-list" data-devtool-list></div>
                        <div class="stitch-devtool-status" data-devtool-status>登录后可查看账号数量与基本信息。</div>
                    </section>

                    <footer class="stitch-settings-foot">
                        <small>显示设置保存在浏览器，账号与基础资料会同步到后端。</small>
                        <button type="button" class="stitch-main-cta stitch-main-cta--small" data-close-settings>完成</button>
                    </footer>
                </div>
            </div>

            <div class="stitch-auth-overlay" data-auth-overlay>
                <div class="stitch-auth-shell">
                    <section class="stitch-auth-showcase" aria-hidden="true">
                        <div class="stitch-auth-showcase-top">
                            <span class="stitch-auth-scene-badge" data-auth-scene-badge>星港准入通道</span>
                            <strong class="stitch-auth-showcase-brand">球球实验室</strong>
                            <p class="stitch-auth-showcase-copy" data-auth-scene-copy>
                                注册后开启云存档、战绩同步和私人房联机入口，先把你的作战身份接进来。
                            </p>
                        </div>

                        <div class="stitch-auth-stage">
                            <span class="stitch-auth-stage-glow"></span>
                            <span class="stitch-auth-orbit stitch-auth-orbit--outer"></span>
                            <span class="stitch-auth-orbit stitch-auth-orbit--mid"></span>
                            <span class="stitch-auth-orbit stitch-auth-orbit--inner"></span>
                            <span class="stitch-auth-spark stitch-auth-spark--one"></span>
                            <span class="stitch-auth-spark stitch-auth-spark--two"></span>
                            <span class="stitch-auth-spark stitch-auth-spark--three"></span>

                            <div class="stitch-auth-core">
                                <span class="stitch-auth-core-surface"></span>
                                <span class="stitch-auth-core-highlight"></span>
                                <span class="stitch-auth-core-grid"></span>
                            </div>

                            <article class="stitch-auth-signal-card">
                                <small>银河指挥频道</small>
                                <strong data-auth-scene-title>作战身份校验中</strong>
                                <span data-auth-scene-subtitle>账号接入后即可进入大厅、匹配与私人模式</span>
                            </article>
                        </div>

                        <div class="stitch-auth-feature-grid">
                            <article class="stitch-auth-feature-card">
                                <span class="stitch-auth-feature-icon">
                                    ${renderMaterialSymbol("cloud_sync", "stitch-auth-feature-symbol")}
                                </span>
                                <small>云端资料</small>
                                <strong>本地进度自动接管</strong>
                            </article>
                            <article class="stitch-auth-feature-card">
                                <span class="stitch-auth-feature-icon">
                                    ${renderMaterialSymbol("sports_esports", "stitch-auth-feature-symbol")}
                                </span>
                                <small>作战大厅</small>
                                <strong>登录后直达模式分厅</strong>
                            </article>
                            <article class="stitch-auth-feature-card">
                                <span class="stitch-auth-feature-icon">
                                    ${renderMaterialSymbol("shield_lock", "stitch-auth-feature-symbol")}
                                </span>
                                <small>安全接入</small>
                                <strong>账号密码链路先行</strong>
                            </article>
                        </div>
                    </section>

                    <div class="stitch-auth-panel" role="dialog" aria-modal="true" aria-labelledby="stitch-auth-title">
                        <span class="stitch-auth-panel-topline" aria-hidden="true"></span>

                        <div class="stitch-auth-head">
                            <div class="stitch-auth-head-copy">
                                <small data-auth-head-kicker>账号中心</small>
                                <h2 id="stitch-auth-title" data-auth-head-title>登录与云存档</h2>
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

                        <section class="stitch-auth-intro" data-auth-intro>
                            <div class="stitch-auth-intro-copy-wrap">
                                <strong data-auth-intro-title>注册账号后才能开始游戏</strong>
                                <p data-auth-intro-copy>先完成账号和密码注册，账号资料会保存下来，之后再进入大厅、私人模式和开发者工具箱。</p>
                            </div>
                            <div class="stitch-auth-intro-chips">
                                <span>账号密码直连</span>
                                <span>战绩自动同步</span>
                                <span>大厅快速接入</span>
                            </div>
                        </section>

                        <div class="stitch-auth-tabs" data-auth-tabs>
                            <button type="button" class="stitch-auth-tab is-active" data-auth-tab="login">已有账号登录</button>
                            <button type="button" class="stitch-auth-tab" data-auth-tab="register">创建新账号</button>
                        </div>

                        <div class="stitch-auth-error" data-auth-error aria-live="polite"></div>
                        <div class="stitch-auth-provider-row" data-auth-provider-row>
                            <button
                                type="button"
                                class="stitch-ghost-btn"
                                data-auth-clerk
                            >
                                使用 Clerk 登录
                            </button>
                        </div>

                        <section class="stitch-auth-account-view" data-auth-account-view>
                            <span class="stitch-auth-account-chip">云端身份在线</span>
                            <strong data-auth-account-name>未登录</strong>
                            <small data-auth-account-label>登录后可同步资料与进度</small>
                            <button
                                type="button"
                                class="stitch-main-cta stitch-main-cta--small stitch-auth-logout-btn"
                                data-auth-logout
                            >
                                退出当前账号
                            </button>
                        </section>

                        <form class="stitch-auth-form" data-auth-form="login">
                            <div class="stitch-auth-form-grid">
                                <label class="stitch-auth-field">
                                    <span class="stitch-auth-field-label">
                                        ${renderMaterialSymbol("person", "stitch-auth-field-symbol")}
                                        <span>账号 ID</span>
                                    </span>
                                    <input
                                        type="text"
                                        name="authLoginAccount"
                                        minlength="${AUTH_ACCOUNT_MIN_LENGTH}"
                                        maxlength="64"
                                        autocomplete="username"
                                        placeholder="输入已注册账号"
                                    />
                                </label>
                                <label class="stitch-auth-field">
                                    <span class="stitch-auth-field-label">
                                        ${renderMaterialSymbol("lock", "stitch-auth-field-symbol")}
                                        <span>安全密码</span>
                                    </span>
                                    <input
                                        type="password"
                                        name="authLoginPassword"
                                        minlength="${AUTH_PASSWORD_MIN_LENGTH}"
                                        maxlength="64"
                                        autocomplete="current-password"
                                        placeholder="输入登录密码"
                                    />
                                </label>
                            </div>
                            <div class="stitch-auth-form-foot">
                                <p class="stitch-auth-form-note">登录成功后会自动接管当前本地进度，并同步昵称、战绩与后续开发者链路。</p>
                                <button
                                    type="submit"
                                    class="stitch-main-cta stitch-main-cta--small stitch-auth-submit-btn"
                                    data-auth-submit="login"
                                >
                                    进入作战大厅
                                </button>
                            </div>
                        </form>

                        <form class="stitch-auth-form" data-auth-form="register">
                            <div class="stitch-auth-form-grid stitch-auth-form-grid--register">
                                <label class="stitch-auth-field">
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
                                </label>
                                <label class="stitch-auth-field">
                                    <span class="stitch-auth-field-label">
                                        ${renderMaterialSymbol("alternate_email", "stitch-auth-field-symbol")}
                                        <span>新账号</span>
                                    </span>
                                    <input
                                        type="text"
                                        name="authRegisterAccount"
                                        minlength="${AUTH_ACCOUNT_MIN_LENGTH}"
                                        maxlength="64"
                                        autocomplete="username"
                                        placeholder="至少 3 位账号"
                                    />
                                </label>
                                <label class="stitch-auth-field">
                                    <span class="stitch-auth-field-label">
                                        ${renderMaterialSymbol("vpn_key", "stitch-auth-field-symbol")}
                                        <span>登录密码</span>
                                    </span>
                                    <input
                                        type="password"
                                        name="authRegisterPassword"
                                        minlength="${AUTH_PASSWORD_MIN_LENGTH}"
                                        maxlength="64"
                                        autocomplete="new-password"
                                        placeholder="至少 6 位密码"
                                    />
                                </label>
                                <label class="stitch-auth-field">
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
                                </label>
                            </div>
                            <div class="stitch-auth-form-foot">
                                <p class="stitch-auth-form-note">建议先创建正式账号，后续大厅、匹配和私人模式都将沿用同一份云端身份。</p>
                                <button
                                    type="submit"
                                    class="stitch-main-cta stitch-main-cta--small stitch-auth-submit-btn"
                                    data-auth-submit="register"
                                >
                                    注册并开启云档案
                                </button>
                            </div>
                        </form>

                        <div class="stitch-auth-bottom-note">
                            <span class="stitch-auth-bottom-note-dot"></span>
                            <span data-auth-bottom-note>当前阶段先开放账号密码接入，后续可继续扩展更多登录方式。</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
  }

  private buildModeCards(): string {
    return STITCH_MODE_CARDS.map((card) => {
      const activeClass = card.id === this.selectedCardId ? " is-active" : "";
      const themeClass = ` is-theme-${card.theme}`;
      const statusClass =
        card.status === "已开放"
          ? " is-open"
          : card.status === "测试中"
            ? " is-testing"
            : " is-training";

      return `
                <article
                    class="stitch-mode-card flowing-border${themeClass}${activeClass}"
                    data-mode-card-id="${card.id}"
                    data-mode-id="${card.modeId}"
                    tabindex="0"
                    role="button"
                    aria-label="选择${card.name}"
                >
                    <div class="stitch-mode-card-bg">
                        <span class="stitch-mode-bg-icon">${renderMaterialSymbol(card.icon, "stitch-mode-bg-symbol")}</span>
                        <div class="stitch-mode-bg-pattern"></div>
                        <div class="stitch-mode-glow-orb"></div>
                    </div>
                    
                    <span class="stitch-mode-icon">${renderMaterialSymbol(card.icon, "stitch-mode-icon-symbol")}</span>
                    <span class="stitch-mode-card-status${statusClass}">${card.status}</span>
                    <span class="stitch-mode-card-kicker">${card.kicker}</span>
                    <strong>${card.name}</strong>
                    <p>${card.subtitle}</p>
                </article>
            `;
    }).join("");
  }

  private buildTaskRows(): string {
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
        searchHost.innerHTML = `<article class="stitch-devtool-row stitch-devtool-row--empty"><strong>UID 查找</strong><span>登录后可通过 9 位 UID 搜索好友。</span></article>`;
      } else if (!this.socialSearchResult) {
        searchHost.innerHTML = `<article class="stitch-devtool-row stitch-devtool-row--empty"><strong>UID 查找</strong><span>输入 9 位 UID 可发起好友申请或加入黑名单。</span></article>`;
      } else if (!this.socialSearchResult.found || !this.socialSearchResult.user) {
        searchHost.innerHTML = `<article class="stitch-devtool-row stitch-devtool-row--empty"><strong>未找到该 UID</strong><span>请确认对方 UID 是否正确。</span></article>`;
      } else {
        const user = this.socialSearchResult.user;
        searchHost.innerHTML = `
          <article class="stitch-devtool-row">
            <strong>${this.escapeHtml(user.nickname)} · UID ${this.escapeHtml(user.gameId)}</strong>
            <span>${this.escapeHtml(this.getSocialRelationshipLabel(this.socialSearchResult.relationship))}</span>
            <div class="stitch-social-actions-inline">
              ${this.buildSearchActionButtons(this.socialSearchResult)}
            </div>
          </article>
        `;
      }
    }

    const friendListHost = this.root.querySelector<HTMLElement>("[data-social-friend-list]");
    if (friendListHost) {
      if (!status.loggedIn) {
        friendListHost.innerHTML = "";
      } else if (!this.socialOverview?.friends.length) {
        friendListHost.innerHTML = `<article class="stitch-devtool-row stitch-devtool-row--empty"><strong>好友列表</strong><span>当前暂无好友。</span></article>`;
      } else {
        friendListHost.innerHTML = this.socialOverview.friends
          .map(
            (friend) => `
              <article class="stitch-devtool-row">
                <strong>${this.escapeHtml(friend.nickname)} · UID ${this.escapeHtml(friend.gameId)}</strong>
                <span>${friend.isOnline ? "在线" : "离线"} · 上次活跃 ${this.escapeHtml(this.formatDateTime(friend.lastSeenAt))}</span>
                <div class="stitch-social-actions-inline">
                  <button type="button" class="stitch-ghost-btn" data-social-action="remove-friend" data-game-id="${this.escapeHtml(friend.gameId)}">取关好友</button>
                  <button type="button" class="stitch-ghost-btn" data-social-action="block" data-game-id="${this.escapeHtml(friend.gameId)}">加入黑名单</button>
                </div>
              </article>
            `,
          )
          .join("");
      }
    }

    const incomingHost = this.root.querySelector<HTMLElement>("[data-social-incoming-list]");
    if (incomingHost) {
      if (!status.loggedIn) {
        incomingHost.innerHTML = "";
      } else if (!this.socialOverview?.incomingRequests.length) {
        incomingHost.innerHTML = `<article class="stitch-devtool-row stitch-devtool-row--empty"><strong>待处理申请</strong><span>暂无待处理申请。</span></article>`;
      } else {
        incomingHost.innerHTML = this.socialOverview.incomingRequests
          .map(
            (request) => `
              <article class="stitch-devtool-row">
                <strong>${this.escapeHtml(request.counterpart.nickname)} · UID ${this.escapeHtml(request.counterpart.gameId)}</strong>
                <span>申请时间 · ${this.escapeHtml(this.formatDateTime(request.createdAt))}</span>
                <div class="stitch-social-actions-inline">
                  <button type="button" class="stitch-ghost-btn" data-social-action="accept-request" data-request-id="${this.escapeHtml(request.requestId)}">同意</button>
                  <button type="button" class="stitch-ghost-btn" data-social-action="reject-request" data-request-id="${this.escapeHtml(request.requestId)}">拒绝</button>
                  <button type="button" class="stitch-ghost-btn" data-social-action="block" data-game-id="${this.escapeHtml(request.counterpart.gameId)}">拉黑</button>
                </div>
              </article>
            `,
          )
          .join("");
      }
    }

    const outgoingHost = this.root.querySelector<HTMLElement>("[data-social-outgoing-list]");
    if (outgoingHost) {
      if (!status.loggedIn) {
        outgoingHost.innerHTML = "";
      } else if (!this.socialOverview?.outgoingRequests.length) {
        outgoingHost.innerHTML = `<article class="stitch-devtool-row stitch-devtool-row--empty"><strong>我发出的申请</strong><span>暂无待同意申请。</span></article>`;
      } else {
        outgoingHost.innerHTML = this.socialOverview.outgoingRequests
          .map(
            (request) => `
              <article class="stitch-devtool-row">
                <strong>${this.escapeHtml(request.counterpart.nickname)} · UID ${this.escapeHtml(request.counterpart.gameId)}</strong>
                <span>申请中 · ${this.escapeHtml(this.formatDateTime(request.createdAt))}</span>
              </article>
            `,
          )
          .join("");
      }
    }

    const blockHost = this.root.querySelector<HTMLElement>("[data-social-block-list]");
    if (blockHost) {
      if (!status.loggedIn) {
        blockHost.innerHTML = "";
      } else if (!this.socialOverview?.blocks.length) {
        blockHost.innerHTML = `<article class="stitch-devtool-row stitch-devtool-row--empty"><strong>黑名单</strong><span>当前没有拉黑记录。</span></article>`;
      } else {
        blockHost.innerHTML = this.socialOverview.blocks
          .map(
            (blocked) => `
              <article class="stitch-devtool-row">
                <strong>${this.escapeHtml(blocked.nickname)} · UID ${this.escapeHtml(blocked.gameId)}</strong>
                <span>拉黑于 · ${this.escapeHtml(this.formatDateTime(blocked.blockedAt))}</span>
                <div class="stitch-social-actions-inline">
                  <button type="button" class="stitch-ghost-btn" data-social-action="unblock" data-game-id="${this.escapeHtml(blocked.gameId)}">解除拉黑</button>
                </div>
              </article>
            `,
          )
          .join("");
      }
    }

    const socialRefreshButton = this.root.querySelector<HTMLButtonElement>(
      "[data-social-refresh]",
    );
    if (socialRefreshButton) {
      socialRefreshButton.disabled = this.socialBusy || !status.loggedIn;
      socialRefreshButton.textContent = this.socialBusy ? "同步中..." : "刷新社交";
    }

    const socialStatus = this.root.querySelector<HTMLElement>("[data-social-status]");
    if (socialStatus) {
      if (!status.loggedIn) {
        socialStatus.textContent = "登录后可通过 UID 查找好友、处理申请和管理黑名单。";
      } else if (this.socialBusy) {
        socialStatus.textContent = "正在同步社交链路...";
      } else if (this.socialError) {
        socialStatus.textContent = this.socialError;
      } else if (this.socialOverview) {
        socialStatus.textContent = `好友 ${this.socialOverview.counts.friends} 人，待处理申请 ${this.socialOverview.counts.incomingRequests} 条。`;
      } else {
        socialStatus.textContent = "点击“刷新社交”读取好友与黑名单状态。";
      }
    }
  }

  private buildSkinButtons(group: "main" | "settings"): string {
    return SKIN_OPTIONS.map(
      (skin) => `
            <button
                type="button"
                class="stitch-skin-chip"
                data-skin-id="${skin.id}"
                data-skin-group="${group}"
                style="--skin-a:${skin.colorA};--skin-b:${skin.colorB};"
            >
                <span class="stitch-skin-chip-dot"></span>
                <span>${skin.name}</span>
            </button>
        `,
    ).join("");
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
      .querySelector<HTMLElement>("[data-social-center]")
      ?.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        const actionEl = target?.closest<HTMLElement>("[data-social-action]");
        if (!actionEl) {
          return;
        }

        const action = actionEl.dataset.socialAction ?? "";
        const requestId = actionEl.dataset.requestId ?? "";
        const gameId = actionEl.dataset.gameId ?? "";
        void this.handleSocialAction(action, { requestId, gameId });
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
        this.showFeatureTip("活动中心正在整理新的实验任务与限时挑战。");
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
          const mode = element.dataset.authTab === "register" ? "register" : "login";
          this.setAuthMode(mode);
        });
      });

    this.root
      .querySelector<HTMLElement>("[data-auth-clerk]")
      ?.addEventListener("click", async () => {
        if (this.authBusy) {
          return;
        }
        this.authBusy = true;
        this.authError = "";
        this.renderAuthPanel();
        try {
          await this.options.onClerkLoginStart?.();
          this.showFeatureTip("Clerk 登录面板已打开，完成验证后会自动接入当前大厅。");
        } catch (error) {
          this.authError = this.formatAuthErrorMessage(
            error instanceof Error ? error.message : "Clerk 登录启动失败。",
            "login",
          );
        } finally {
          this.authBusy = false;
          this.renderAuthPanel();
        }
      });

    this.root
      .querySelector<HTMLElement>("[data-auth-logout]")
      ?.addEventListener("click", async () => {
        if (this.authBusy) {
          return;
        }
        this.authBusy = true;
        this.authError = "";
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
        } finally {
          this.authBusy = false;
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
          this.authError = "账号至少 3 位。";
          this.renderAuthPanel();
          return;
        }
        if (password.length < AUTH_PASSWORD_MIN_LENGTH) {
          this.authError = "密码至少 6 位。";
          this.renderAuthPanel();
          return;
        }

        this.authBusy = true;
        this.authError = "";
        this.renderAuthPanel();
        try {
          await this.options.onLoginSubmit?.({ account, password });
          this.clearAuthForms();
          this.showFeatureTip("账号登录成功，云存档已接管当前大厅。");
        } catch (error) {
          this.authError = this.formatAuthErrorMessage(
            error instanceof Error ? error.message : "登录失败，请重试。",
            "login",
          );
        } finally {
          this.authBusy = false;
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
        const password = this.root
          .querySelector<HTMLInputElement>('input[name="authRegisterPassword"]')
          ?.value ?? "";
        const confirmPassword = this.root
          .querySelector<HTMLInputElement>('input[name="authRegisterConfirmPassword"]')
          ?.value ?? "";

        if (account.length < AUTH_ACCOUNT_MIN_LENGTH) {
          this.authError = "账号至少 3 位。";
          this.renderAuthPanel();
          return;
        }
        if (password.length < AUTH_PASSWORD_MIN_LENGTH) {
          this.authError = "密码至少 6 位。";
          this.renderAuthPanel();
          return;
        }
        if (password !== confirmPassword) {
          this.authError = "两次输入的密码不一致。";
          this.renderAuthPanel();
          return;
        }

        this.authBusy = true;
        this.authError = "";
        this.renderAuthPanel();
        try {
          await this.options.onRegisterSubmit?.({
            account,
            password,
            nickname: nickname && nickname.length > 0 ? nickname : undefined,
          });
          this.clearAuthForms();
          this.showFeatureTip("账号注册成功，已自动登录并接管云存档。");
        } catch (error) {
          this.authError = this.formatAuthErrorMessage(
            error instanceof Error ? error.message : "注册失败，请重试。",
            "register",
          );
        } finally {
          this.authBusy = false;
          this.applyAuthStatusToView();
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
        this.options.onOpenModeHall(this.selectedModeId);
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-mode-card-id]")
      .forEach((card) => {
        card.addEventListener("click", () => {
          const cardId = card.dataset.modeCardId ?? "";
          this.selectModeCard(cardId);
        });

        card.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            const cardId = card.dataset.modeCardId ?? "";
            this.selectModeCard(cardId);
          }
        });
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
          this.showFeatureTip(FEATURE_TIPS[feature]);
          void this.options.onFeatureAction?.(feature);
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
    if (!/^\d{9}$/.test(gameId)) {
      this.socialError = "请输入 9 位数字 UID。";
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
      .querySelectorAll<HTMLElement>("[data-mode-status]")
      .forEach((el) => {
        el.textContent = selectedCard.status;
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

  private openAuthModal(mode: "login" | "register", required = false) {
    this.authError = "";
    this.authBusy = false;
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
    this.authError = "";
    this.authBusy = false;
    this.renderAuthPanel();
    this.syncDocumentScrollLock();
  }

  private setAuthMode(mode: "login" | "register") {
    this.authMode = mode;
    this.renderAuthPanel();
  }

  private renderAuthPanel() {
    const status = this.options.getAuthStatus?.() ?? {
      loggedIn: false,
      userLabel: "游客",
    };
    const authLocked = this.isAuthGateLocked();
    const usingRegisterMode = !status.loggedIn && this.authMode === "register";
    const sceneBadge = authLocked
      ? "星港准入校验"
      : status.loggedIn
        ? "云端身份已连接"
        : usingRegisterMode
          ? "新兵登记通道"
          : "老兵回归通道";
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
      ? "先完成账号准入，再解锁整个大厅"
      : status.loggedIn
        ? "当前账号已接入云端身份中心"
        : usingRegisterMode
          ? "先登记新身份，再正式进入战场"
          : "已有账号可以直接快速登录";
    const introCopyText = authLocked
      ? "账号、密码和基础资料保存成功后，才能进入大厅、匹配和私人模式。"
      : status.loggedIn
        ? "你可以继续使用当前账号，也可以退出后重新切换别的测试账号。"
        : usingRegisterMode
          ? "注册完成后会自动登录，并把当前本地资料同步到你的新账号下面。"
          : "登录后可继续同步昵称、战绩和开发者工具箱里的账号信息。";
    const bottomNoteText = authLocked
      ? "先做完账号接入，整个初始主界面才会完全解锁。"
      : status.loggedIn
        ? "当前账号已经接管本地资料，你可以随时进入模式大厅继续测试。"
        : usingRegisterMode
          ? "注册账号后会直接进入大厅，无需二次登录。"
          : "如果没有账号，可以直接切到“创建新账号”完成首次接入。";

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
          ? "当前账号与云存档"
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
        const active = element.dataset.authTab === this.authMode;
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
        const visible = !status.loggedIn && formMode === this.authMode;
        (element as HTMLElement).style.display = visible ? "grid" : "none";
      });

    const errorEl = this.root.querySelector<HTMLElement>("[data-auth-error]");
    if (errorEl) {
      errorEl.textContent = this.authError || (this.authBusy ? "正在提交账号请求..." : "");
      errorEl.classList.toggle("is-visible", Boolean(this.authError || this.authBusy));
    }

    const clerkProviderRow = this.root.querySelector<HTMLElement>(
      "[data-auth-provider-row]",
    );
    if (clerkProviderRow) {
      clerkProviderRow.style.display =
        !status.loggedIn && this.options.clerkEnabled ? "block" : "none";
    }

    const clerkButton = this.root.querySelector<HTMLButtonElement>("[data-auth-clerk]");
    if (clerkButton) {
      clerkButton.disabled = this.authBusy;
      clerkButton.textContent = this.authBusy
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

    const loginSubmitButton = this.root.querySelector<HTMLButtonElement>(
      '[data-auth-submit="login"]',
    );
    if (loginSubmitButton) {
      loginSubmitButton.textContent =
        this.authBusy && !status.loggedIn && !usingRegisterMode
          ? "正在接入账号..."
          : "进入作战大厅";
    }

    const registerSubmitButton = this.root.querySelector<HTMLButtonElement>(
      '[data-auth-submit="register"]',
    );
    if (registerSubmitButton) {
      registerSubmitButton.textContent =
        this.authBusy && !status.loggedIn && usingRegisterMode
          ? "正在创建身份..."
          : "注册并开启云档案";
    }

    const logoutButton = this.root.querySelector<HTMLButtonElement>("[data-auth-logout]");
    if (logoutButton) {
      logoutButton.textContent = this.authBusy ? "正在退出..." : "退出当前账号";
    }

    this.root
      .querySelectorAll<HTMLButtonElement>(
        "[data-auth-submit], [data-auth-logout], [data-auth-clerk]",
      )
      .forEach((button) => {
        button.disabled = this.authBusy;
      });
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

    if (window.innerWidth <= 1024) {
      this.root.style.setProperty("--stitch-fit-scale", "1");
      this.root.style.setProperty("--stitch-fit-bottom-offset", "0px");
      return;
    }

    this.root.style.setProperty("--stitch-fit-scale", "1");
    this.root.style.setProperty("--stitch-fit-bottom-offset", "0px");

    const rootStyle = window.getComputedStyle(this.root);
    const horizontalPadding =
      Number.parseFloat(rootStyle.paddingLeft) +
      Number.parseFloat(rootStyle.paddingRight);
    const verticalPadding =
      Number.parseFloat(rootStyle.paddingTop) +
      Number.parseFloat(rootStyle.paddingBottom);

    const availableWidth = Math.max(0, this.root.clientWidth - horizontalPadding);
    const availableHeight = Math.max(
      0,
      this.root.clientHeight - verticalPadding,
    );

    if (availableWidth <= 0 || availableHeight <= 0) {
      return;
    }

    const naturalWidth = Math.max(frame.scrollWidth, frame.offsetWidth);
    const naturalHeight = Math.max(frame.scrollHeight, frame.offsetHeight);
    if (naturalWidth <= 0 || naturalHeight <= 0) {
      return;
    }

    const safeInset = 6;
    const scale = Math.min(
      1,
      (availableWidth - safeInset) / naturalWidth,
      (availableHeight - safeInset) / naturalHeight,
    );

    const appliedScale = Math.max(0.72, scale);

    this.root.style.setProperty(
      "--stitch-fit-scale",
      String(appliedScale).slice(0, 6),
    );

    this.fitLayoutFrame = window.requestAnimationFrame(() => {
      this.alignTrayToViewportBottom();
      this.fitLayoutFrame = null;
    });
    this.fitLayoutTimeout = window.setTimeout(() => {
      this.alignTrayToViewportBottom();
      this.fitLayoutTimeout = null;
    }, 48);
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
    if (visualBottomGap <= 0.5) {
      return;
    }

    const currentOffset =
      Number.parseFloat(
        rootStyle.getPropertyValue("--stitch-fit-bottom-offset"),
      ) || 0;
    const nextOffset = currentOffset + visualBottomGap / appliedScale;
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

    this.root
      .querySelectorAll<HTMLElement>("[data-auth-label]")
      .forEach((el) => {
        el.textContent = label;
      });

    this.root.dataset.authState = status.loggedIn ? "loggedIn" : "guest";
    if (!status.loggedIn) {
      if (this.root.classList.contains("is-visible")) {
        this.root.classList.add("is-auth-required");
      }
      this.socialOverview = null;
      this.socialSearchResult = null;
      this.socialError = "";
      this.friends = [];
      this.renderFriendsToLobby();
    }
    this.renderSocialCenter();
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
    const inputNames = [
      "authLoginAccount",
      "authLoginPassword",
      "authRegisterNickname",
      "authRegisterAccount",
      "authRegisterPassword",
      "authRegisterConfirmPassword",
    ] as const;

    inputNames.forEach((name) => {
      const input = this.root.querySelector<HTMLInputElement>(
        `input[name="${name}"]`,
      );
      if (input) {
        input.value = "";
      }
    });
  }

  private formatAuthErrorMessage(
    message: string,
    mode: "login" | "register" | "logout",
  ) {
    const raw = message.trim();

    if (!raw) {
      if (mode === "register") {
        return "注册失败，请重试。";
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
    if (
      lower.includes("invalid credentials") ||
      lower.includes("auth_invalid_credentials")
    ) {
      return "账号或密码不对，请检查后重试。";
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

  private focusAuthField() {
    const selector =
      this.authMode === "register"
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
    return value === "shop" || value === "magic" || value === "friends";
  }

  private formatMass(rawMass: number): string {
    const value = Math.max(0, Math.floor(rawMass));
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`;
    }
    return `${value} kg`;
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
