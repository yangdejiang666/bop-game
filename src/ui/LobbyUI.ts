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
import { lobbyService, type LobbyTask, type LobbyFriend } from "../network/lobbyService";

export type LobbyModeId =
  | "ranked"
  | "peak"
  | "classic"
  | "speed"
  | "team"
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
}

type LobbyFeatureId = "shop" | "magic" | "friends";
type StitchModeCardId = "ranked" | "classic5v5" | "peakspeed" | "practice";

interface StitchModeCard {
  id: StitchModeCardId;
  modeId: LobbyModeId;
  kicker: string;
  name: string;
  subtitle: string;
  icon: string;
  theme: "cyan" | "violet" | "gold" | "neutral";
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
    theme: "cyan",
    status: "已开放",
  },
  {
    id: "classic5v5",
    modeId: "classic",
    kicker: "休闲模式",
    name: "经典模式5v5",
    subtitle: "自由吞噬，畅快体验",
    icon: "view_cozy",
    theme: "violet",
    status: "已开放",
  },
  {
    id: "peakspeed",
    modeId: "speed",
    kicker: "极速模式",
    name: "巅峰极速",
    subtitle: "高节奏成长，快速对抗",
    icon: "bolt",
    theme: "gold",
    status: "测试中",
  },
  {
    id: "practice",
    modeId: "classic",
    kicker: "训练室",
    name: "单机练习",
    subtitle: "磨炼你的操作技巧",
    icon: "fitness_center",
    theme: "neutral",
    status: "训练",
  },
];

const FEATURE_SYMBOLS: Record<LobbyFeatureId, string> = {
  shop: "shopping_bag",
  magic: "auto_awesome",
  friends: "group",
};

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
  private authMode: "login" | "register" = "login";
  private authBusy = false;
  private authError = "";
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
    this.resizeHandler = () => this.syncLobbyFit();

    this.bindEvents();
    this.applySelectedModeUI();
    this.applyFeatureSelection();
    this.applySettingsToForm();
    this.applyAuthStatusToView();
    this.renderAuthPanel();
    this.renderDeveloperToolbox();
    this.syncDocumentScrollLock();
    this.syncLobbyFit();
  }

  mount(parent: HTMLElement) {
    parent.appendChild(this.root);
    window.addEventListener("keydown", this.keydownHandler);
    window.addEventListener("resize", this.resizeHandler);
    this.syncLobbyFit();
  }

  destroy() {
    window.removeEventListener("keydown", this.keydownHandler);
    window.removeEventListener("resize", this.resizeHandler);
    if (this.tipTimer !== null) {
      window.clearTimeout(this.tipTimer);
      this.tipTimer = null;
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
    this.refreshLobbyData();
  }

  showAuthGate() {
    this.refreshProgression();
    this.setSkinDrawerOpen(false);
    this.clearAuthForms();
    this.root.classList.add("is-visible");
    this.root.classList.remove("is-modal-only", "is-settings-open");
    this.openAuthModal("register", true);
    this.syncDocumentScrollLock();
    this.syncLobbyFit();
  }

  private async refreshLobbyData() {
    try {
      const data = await lobbyService.fetchLobbyData();
      this.tasks = data.tasks;
      this.friends = data.friends;

      const modeStatusEl = this.root.querySelector<HTMLElement>("[data-mode-status]");
      if (modeStatusEl) modeStatusEl.textContent = data.modeStatus;

      const taskListEl = this.root.querySelector<HTMLElement>(".stitch-task-list");
      if (taskListEl) taskListEl.innerHTML = this.buildTaskRows();

      const friendListEl = this.root.querySelector<HTMLElement>(".stitch-friend-list");
      if (friendListEl) friendListEl.innerHTML = this.buildFriendRows();

      const friendAvatarsEl = this.root.querySelector<HTMLElement>(".stitch-invite-avatars");
      if (friendAvatarsEl) friendAvatarsEl.innerHTML = this.buildFriendCluster();
    } catch (e) {
      console.error("Failed to load lobby data", e);
    }
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
      this.openAuthModal("register", true);
      return;
    }

    this.root.classList.add("is-visible", "is-settings-open");
    this.root.classList.remove("is-auth-open", "is-auth-required");
    this.root.classList.toggle("is-modal-only", modalOnly);
    this.syncDocumentScrollLock();
    this.options.onSettingsOpened();
    void this.refreshDeveloperOverview();
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
                    <header class="stitch-topbar glass-panel">
                        <div class="stitch-brand">
                            <strong class="stitch-brand-title">球球实验室</strong>
                        </div>

                        <div class="stitch-resource-bar shimmer">
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

                        <div class="stitch-top-actions">
                            <button type="button" class="stitch-icon-btn" data-top-action="activity" aria-label="活动">
                                ${renderMaterialSymbol("notifications", "stitch-icon-btn-symbol")}
                            </button>
                            <button type="button" class="stitch-rename-btn" data-open-settings aria-label="修改名字">
                                ${renderMaterialSymbol("edit_square", "stitch-rename-btn-symbol")}
                                <span>修改名字</span>
                            </button>
                            <button type="button" class="stitch-auth-btn" data-auth-action aria-label="账号操作">
                                <span class="stitch-auth-btn-label" data-auth-label>游客登录</span>
                            </button>
                            <button type="button" class="stitch-icon-btn" data-open-settings aria-label="设置">
                                ${renderMaterialSymbol("settings", "stitch-icon-btn-symbol")}
                            </button>
                            <button type="button" class="stitch-avatar-btn" data-avatar-trigger aria-label="上传头像">
                                <span class="stitch-avatar-slot" data-avatar-slot>
                                    <img class="stitch-avatar-img" data-avatar-img alt="头像" />
                                    <span class="stitch-avatar-fallback" data-avatar-fallback>球</span>
                                </span>
                                <span class="stitch-avatar-online"></span>
                            </button>
                        </div>
                    </header>

                    <main class="stitch-main">
                        <section class="stitch-left-col">
                            <article class="stitch-profile-card glass-panel">
                                <div class="stitch-profile-head">
                                    <div class="stitch-profile-kicker">
                                        <span class="stitch-profile-kicker-dot"></span>
                                        <span>精英评级</span>
                                    </div>
                                    <span class="stitch-level-chip" data-progression-level>1级</span>
                                </div>
                                <h2 class="stitch-profile-name" data-player-name>勇者球球</h2>

                                <div class="stitch-profile-meta">
                                    <span class="stitch-online-state">在线</span>
                                    <span class="stitch-current-mode" data-current-mode-name>排位赛</span>
                                    <span data-progression-growth-meta>0 胜 / 0 局</span>
                                </div>

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
                                    <span class="stitch-ball-skin-name" data-active-skin-name>当前皮肤 · 经典蓝</span>
                                    <button type="button" class="stitch-stage-bolt" data-toggle-skins aria-label="切换皮肤">
                                        ${renderMaterialSymbol("palette", "stitch-stage-bolt-symbol")}
                                    </button>
                                </div>

                                <div class="stitch-stat-grid">
                                    <article class="stitch-stat-tile">
                                        <small>胜率</small>
                                        <strong data-progression-winrate>0%</strong>
                                    </article>
                                    <article class="stitch-stat-tile is-secondary">
                                        <small>历史体重</small>
                                        <strong data-progression-best-mass>0 kg</strong>
                                    </article>
                                </div>

                                <button type="button" class="stitch-skins-btn btn-sweep" data-toggle-skins aria-expanded="false">
                                    更换皮肤
                                </button>

                                <section class="stitch-skin-drawer" data-skin-drawer>
                                    <div class="stitch-skin-drawer-head">
                                        <strong>本地皮肤</strong>
                                        <small>点击即可切换主球外观</small>
                                    </div>
                                    <div class="stitch-skin-list">
                                        ${this.buildSkinButtons("main")}
                                    </div>
                                </section>
                            </article>

                            <article class="stitch-season-card shimmer" aria-label="私人模式开发进度">
                                <span class="stitch-season-icon">
                                    ${renderMaterialSymbol("deployed_code_history", "stitch-season-symbol")}
                                </span>
                                <span class="stitch-season-copy">
                                    <strong>私人模式联调中</strong>
                                    <small>注册完成后可继续测试房间与开发链路。</small>
                                </span>
                            </article>
                        </section>

                        <section class="stitch-right-col">
                            <section class="stitch-mode-panel glass-panel">
                                <div class="stitch-panel-head">
                                    <div>
                                        <strong>模式选择</strong>
                                        <small>4 张主模式卡，点击后进入对应分厅</small>
                                    </div>
                                    <span class="stitch-mode-status" data-mode-status>已开放</span>
                                </div>
                                    <div class="stitch-mode-grid">
                                        ${this.buildModeCards()}
                                    </div>
                                </section>

                            <div class="stitch-info-grid">
                                <section class="stitch-panel glass-panel">
                                    <div class="stitch-panel-head">
                                        <div>
                                            <strong>每日任务</strong>
                                            <small>今日进度与实验目标</small>
                                        </div>
                                        <span class="stitch-mini-chip">2 / 5 已完成</span>
                                    </div>
                                    <div class="stitch-task-list">
                                        ${this.buildTaskRows()}
                                    </div>
                                </section>

                                <section class="stitch-panel glass-panel">
                                    <div class="stitch-panel-head">
                                        <div>
                                            <strong>好友在线</strong>
                                            <small>当前有 3 位好友可互动</small>
                                        </div>
                                        <button type="button" class="stitch-link-btn" data-feature="friends">查看全部</button>
                                    </div>
                                    <div class="stitch-friend-list">
                                        ${this.buildFriendRows()}
                                    </div>
                                </section>
                            </div>

                            <section class="stitch-cta-row">
                                <button type="button" class="stitch-main-cta btn-sweep btn-neon-glow" data-start-game>
                                    <span>进入分厅</span>
                                    ${renderMaterialSymbol("rocket_launch", "stitch-main-cta-symbol")}
                                </button>
                                <div class="stitch-invite-strip glass-panel">
                                    <div class="stitch-invite-avatars">
                                        ${this.buildFriendCluster()}
                                    </div>
                                    <button type="button" class="stitch-invite-btn" data-feature="friends">
                                        ${renderMaterialSymbol("person_add", "stitch-invite-btn-symbol")}
                                        <span>邀请好友</span>
                                    </button>
                                </div>
                            </section>
                        </section>
                    </main>

                    <section class="stitch-activity-row">
                        <button type="button" class="stitch-activity-card is-violet shimmer" data-feature="shop">
                            <span class="stitch-activity-icon">${renderMaterialSymbol("blur_on", "stitch-activity-symbol")}</span>
                            <span class="stitch-activity-copy">
                                <small>限时新品</small>
                                <strong>幻彩晶核整备场</strong>
                                <em>查看详情</em>
                            </span>
                        </button>
                        <button type="button" class="stitch-activity-card is-gold shimmer" data-feature="magic">
                            <span class="stitch-activity-icon">${renderMaterialSymbol("timer", "stitch-activity-symbol")}</span>
                            <span class="stitch-activity-copy">
                                <small>限时模式</small>
                                <strong>重力漂流 · 压缩开局</strong>
                                <em>立即加入</em>
                            </span>
                        </button>
                    </section>

                    <nav class="stitch-dock glass-panel">
                        <button type="button" class="stitch-dock-item" data-feature="shop">
                            ${renderMaterialSymbol(FEATURE_SYMBOLS.shop, "stitch-dock-symbol")}
                            <span>商店</span>
                        </button>
                        <button type="button" class="stitch-dock-item" data-feature="magic">
                            ${renderMaterialSymbol(FEATURE_SYMBOLS.magic, "stitch-dock-symbol")}
                            <span>魔法屋</span>
                        </button>
                        <button type="button" class="stitch-dock-item" data-feature="friends">
                            ${renderMaterialSymbol(FEATURE_SYMBOLS.friends, "stitch-dock-symbol")}
                            <span>好友</span>
                        </button>
                    </nav>
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
                <div class="stitch-auth-panel" role="dialog" aria-modal="true" aria-labelledby="stitch-auth-title">
                    <div class="stitch-auth-head">
                        <div>
                            <small data-auth-head-kicker>账号中心</small>
                            <h2 id="stitch-auth-title" data-auth-head-title>登录与云存档</h2>
                        </div>
                        <button type="button" class="stitch-settings-close" data-auth-close aria-label="关闭账号面板">×</button>
                    </div>

                    <section class="stitch-auth-intro" data-auth-intro>
                        <strong data-auth-intro-title>注册账号后才能开始游戏</strong>
                        <p data-auth-intro-copy>先完成账号和密码注册，账号资料会保存下来，之后再进入大厅、私人模式和开发者工具箱。</p>
                    </section>

                    <div class="stitch-auth-tabs" data-auth-tabs>
                        <button type="button" class="stitch-auth-tab is-active" data-auth-tab="login">登录</button>
                        <button type="button" class="stitch-auth-tab" data-auth-tab="register">注册</button>
                    </div>

                    <div class="stitch-auth-error" data-auth-error aria-live="polite"></div>

                    <section class="stitch-auth-account-view" data-auth-account-view>
                        <strong data-auth-account-name>未登录</strong>
                        <small data-auth-account-label>登录后可同步资料与进度</small>
                        <button type="button" class="stitch-main-cta stitch-main-cta--small" data-auth-logout>退出登录</button>
                    </section>

                    <form class="stitch-auth-form" data-auth-form="login">
                        <label class="stitch-settings-field">
                            <span>账号</span>
                            <input type="text" name="authLoginAccount" minlength="${AUTH_ACCOUNT_MIN_LENGTH}" maxlength="64" autocomplete="username" />
                        </label>
                        <label class="stitch-settings-field">
                            <span>密码</span>
                            <input type="password" name="authLoginPassword" minlength="${AUTH_PASSWORD_MIN_LENGTH}" maxlength="64" autocomplete="current-password" />
                        </label>
                        <button type="submit" class="stitch-main-cta stitch-main-cta--small" data-auth-submit="login">登录并同步</button>
                    </form>

                    <form class="stitch-auth-form" data-auth-form="register">
                        <label class="stitch-settings-field">
                            <span>昵称（可选）</span>
                            <input type="text" name="authRegisterNickname" maxlength="${MAX_PLAYER_NAME_LENGTH}" autocomplete="nickname" />
                        </label>
                        <label class="stitch-settings-field">
                            <span>账号</span>
                            <input type="text" name="authRegisterAccount" minlength="${AUTH_ACCOUNT_MIN_LENGTH}" maxlength="64" autocomplete="username" />
                        </label>
                        <label class="stitch-settings-field">
                            <span>密码</span>
                            <input type="password" name="authRegisterPassword" minlength="${AUTH_PASSWORD_MIN_LENGTH}" maxlength="64" autocomplete="new-password" />
                        </label>
                        <label class="stitch-settings-field">
                            <span>确认密码</span>
                            <input type="password" name="authRegisterConfirmPassword" minlength="${AUTH_PASSWORD_MIN_LENGTH}" maxlength="64" autocomplete="new-password" />
                        </label>
                        <button type="submit" class="stitch-main-cta stitch-main-cta--small" data-auth-submit="register">注册并开始同步</button>
                    </form>
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
        this.openAuthModal(loggedIn ? "login" : "register", !loggedIn);
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
          this.openAuthModal("register", true);
          this.showFeatureTip("请先注册账号并登录，完成保存后再进入游戏。");
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
    this.setAuthMode(required ? "register" : mode);
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

    this.root.dataset.authMode = this.authMode;
    this.root.classList.toggle("is-auth-busy", this.authBusy);
    this.root.classList.toggle("is-auth-required", authLocked);

    const headKicker = this.root.querySelector<HTMLElement>("[data-auth-head-kicker]");
    if (headKicker) {
      headKicker.textContent = authLocked ? "账号前置门禁" : "账号中心";
    }

    const headTitle = this.root.querySelector<HTMLElement>("[data-auth-head-title]");
    if (headTitle) {
      headTitle.textContent = authLocked ? "注册账号后才能开始游戏" : "登录与云存档";
    }

    const introTitle = this.root.querySelector<HTMLElement>("[data-auth-intro-title]");
    if (introTitle) {
      introTitle.textContent = authLocked
        ? "请先完成账号注册或登录"
        : status.loggedIn
          ? "当前账号已连接到云端链路"
          : "登录后可同步战绩与资料";
    }

    const introCopy = this.root.querySelector<HTMLElement>("[data-auth-intro-copy]");
    if (introCopy) {
      introCopy.textContent = authLocked
        ? "账号、密码和基础资料保存成功后，才能进入大厅、匹配和私人模式。"
        : status.loggedIn
          ? "你可以在设置里的开发者工具箱查看账号数量、当前账号和最近注册账号。"
          : "你可以先注册一个新账号，也可以切换到登录页使用已有账号。";
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

    this.root
      .querySelectorAll<HTMLButtonElement>("[data-auth-submit], [data-auth-logout]")
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
            <span>UID · ${this.escapeHtml(current.userId)}</span>
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
                <span>Lv.${account.level} · ${account.totalMatches} 局 · ${this.escapeHtml(this.formatDateTime(account.createdAt))}</span>
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
      .querySelectorAll<HTMLElement>("[data-active-skin-name]")
      .forEach((el) => {
        el.textContent = `当前皮肤 · ${activeSkin.name}`;
      });
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

    const desktopLike = window.innerWidth > 1024;
    this.root.style.setProperty("--stitch-fit-scale", "1");

    if (!desktopLike) {
      return;
    }

    const rootRect = this.root.getBoundingClientRect();
    const naturalWidth = frame.scrollWidth;
    const naturalHeight = frame.scrollHeight;
    if (
      rootRect.width <= 0 ||
      rootRect.height <= 0 ||
      naturalWidth <= 0 ||
      naturalHeight <= 0
    ) {
      return;
    }

    const rootStyle = window.getComputedStyle(this.root);
    const rootPaddingRight = Number.parseFloat(rootStyle.paddingRight) || 0;
    const rootPaddingBottom = Number.parseFloat(rootStyle.paddingBottom) || 0;
    const frameRect = frame.getBoundingClientRect();
    const offsetX = Math.max(0, frameRect.left - rootRect.left);
    const offsetY = Math.max(0, frameRect.top - rootRect.top);
    const safeInset = 4;
    const availableWidth = Math.max(
      0,
      rootRect.width - offsetX - rootPaddingRight - safeInset,
    );
    const availableHeight = Math.max(
      0,
      rootRect.height - offsetY - rootPaddingBottom - safeInset,
    );

    const childRects = Array.from(frame.children).map((child) => {
      const element = child as HTMLElement;
      return {
        right: element.offsetLeft + element.offsetWidth,
        bottom: element.offsetTop + element.offsetHeight,
      };
    });

    const contentWidth = childRects.reduce(
      (max, rect) => Math.max(max, rect.right),
      0,
    );
    const contentHeight = childRects.reduce(
      (max, rect) => Math.max(max, rect.bottom),
      0,
    );
    const naturalContentWidth = Math.max(naturalWidth, contentWidth);
    const naturalContentHeight = Math.max(
      naturalHeight,
      contentHeight,
      this.root.scrollHeight,
    );

    const scaleX = availableWidth / naturalContentWidth;
    const scaleY = availableHeight / naturalContentHeight;
    let scale = Math.min(1, scaleX, scaleY);
    if (window.innerWidth <= 1366) {
      scale *= 0.88;
    } else if (window.innerHeight <= 820) {
      scale *= 0.94;
    }
    scale = Math.min(1, scale);
    this.root.style.setProperty("--stitch-fit-scale", scale.toFixed(4));
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
    if (!status.loggedIn && this.root.classList.contains("is-visible")) {
      this.root.classList.add("is-auth-required");
    }
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
