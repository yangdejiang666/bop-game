import { animate } from "@motionone/dom";
import type { GameSettings } from "../app/settings";
import {
  MODE_DEFINITIONS,
  getModeDefinition,
  type ModeDefinition,
  type ModeHallLayoutId,
  type ModeHallRoomSnapshot,
  type ModeHallState,
  type ModeHallTabId,
} from "../modes/definitions";
import type { LobbyModeId } from "./LobbyUI";

export type RoomAction = "create" | "join" | "leave" | "ready";

type SocialTabId = "friends" | "spectate";
type RoomState = ModeHallRoomSnapshot;

interface HeroStageController {
  setReducedMotion(reducedMotion: boolean): void;
  setMode(modeDefinition: ModeDefinition): Promise<void>;
  destroy(): void;
}

export interface ModeHallSnapshot {
  visible: boolean;
  modeId: LobbyModeId | null;
  tabId: ModeHallTabId;
  room: ModeHallRoomSnapshot;
  state: ModeHallState;
}

interface ModeHallUIOptions {
  settings: GameSettings;
  onBackLobby: () => void;
  onOpenSettings: () => void;
  onStartMatch: (modeId: LobbyModeId) => void;
  onRoomAction?: (
    action: RoomAction,
    payload?: string,
  ) => Promise<ModeHallRoomSnapshot | null> | ModeHallRoomSnapshot | null;
}

interface SocialRow {
  title: string;
  meta: string;
  badge: string;
}

const TAB_DEFS: Array<{ id: ModeHallTabId; label: string }> = [
  { id: "rules", label: "规则" },
  { id: "rewards", label: "奖励" },
  { id: "map", label: "地图/教学" },
];

export class ModeHallUI {
  private readonly root: HTMLDivElement;
  private readonly options: ModeHallUIOptions;
  private settings: GameSettings;
  private modeId: LobbyModeId | null = null;
  private activeTab: ModeHallTabId = "rules";
  private visible = false;
  private roomState: RoomState = this.createEmptyRoomState();
  private roomCodeDraft = "";
  private activeSocialTab: SocialTabId = "friends";
  private readonly heroCanvas: HTMLCanvasElement;
  private heroStage: HeroStageController | null = null;
  private heroStageSetup: Promise<void> | null = null;
  private heroState: ModeHallState["heroState"] = "idle";
  private readonly keydownHandler: (event: KeyboardEvent) => void;
  private readonly resizeHandler: () => void;

  constructor(options: ModeHallUIOptions) {
    this.options = options;
    this.settings = { ...options.settings };
    this.root = document.createElement("div");
    this.root.className = "mode-hall-overlay";
    this.root.innerHTML = this.buildTemplate();
    const heroCanvas = this.root.querySelector<HTMLCanvasElement>(
      "[data-modehall-hero-canvas]",
    );
    if (!heroCanvas) {
      throw new Error("Failed to initialize mode hall hero canvas.");
    }
    this.heroCanvas = heroCanvas;
    this.root.dataset.heroState = this.heroState;
    this.root.dataset.ctaState = this.computeCtaState();
    this.root.dataset.reducedMotion = String(this.settings.reducedMotion);

    this.keydownHandler = (event) => {
      if (!this.visible) {
        return;
      }
      if (event.key === "Escape") {
        this.options.onBackLobby();
      }
    };
    this.resizeHandler = () => {
      if (!this.visible) {
        return;
      }
      this.syncBreakpointState();
    };

    this.bindEvents();
  }

  mount(parent: HTMLElement) {
    parent.appendChild(this.root);
    window.addEventListener("keydown", this.keydownHandler);
    window.addEventListener("resize", this.resizeHandler);
  }

  destroy() {
    window.removeEventListener("keydown", this.keydownHandler);
    window.removeEventListener("resize", this.resizeHandler);
    this.heroStage?.destroy();
    this.heroStage = null;
    this.heroStageSetup = null;
    this.root.remove();
  }

  setSettings(nextSettings: GameSettings) {
    this.settings = { ...nextSettings };
    this.root.dataset.reducedMotion = String(this.settings.reducedMotion);
    this.heroStage?.setReducedMotion(this.settings.reducedMotion);
  }

  show(modeId: LobbyModeId, tabId: ModeHallTabId = "rules") {
    this.visible = true;
    this.modeId = modeId;
    this.activeTab = tabId;
    this.activeSocialTab = "friends";
    this.roomState = this.createEmptyRoomState();
    this.roomCodeDraft = "";
    this.root.classList.add("is-visible");
    this.root.dataset.ctaState = this.computeCtaState();
    this.syncBreakpointState();
    void this.refreshView(true);
  }

  hide() {
    this.visible = false;
    this.modeId = null;
    this.roomCodeDraft = "";
    this.root.classList.remove("is-visible");
    this.root.dataset.ctaState = this.computeCtaState();
    delete this.root.dataset.modeLayout;
    delete this.root.dataset.breakpointBucket;
    delete this.root.dataset.roomCreated;
  }

  getSnapshot(): ModeHallSnapshot {
    const ctaState = this.computeCtaState();
    this.root.dataset.ctaState = ctaState;
    this.root.dataset.heroState = this.heroState;
    return {
      visible: this.visible,
      modeId: this.modeId,
      tabId: this.activeTab,
      room: {
        created: this.roomState.created,
        code: this.roomState.code,
        leaderId: this.roomState.leaderId,
        members: this.roomState.members.map((member) => ({ ...member })),
        lastCheck: this.roomState.lastCheck,
      },
      state: {
        modeId: this.modeId,
        tabId: this.activeTab,
        roomState: {
          created: this.roomState.created,
          code: this.roomState.code,
          leaderId: this.roomState.leaderId,
          members: this.roomState.members.map((member) => ({ ...member })),
          lastCheck: this.roomState.lastCheck,
        },
        socialTab: this.activeSocialTab,
        heroState: this.heroState,
        ctaState,
        layoutId: this.getCurrentLayoutId(),
        breakpointBucket: this.getBreakpointBucket(),
      },
    } satisfies ModeHallSnapshot;
  }

  simulateRoom(action: RoomAction, payload?: string): ModeHallSnapshot {
    this.applyRoomActionLocal(action, payload);
    return this.getSnapshot();
  }

  setRoomSnapshot(snapshot: ModeHallRoomSnapshot) {
    this.roomState = {
      created: snapshot.created,
      code: snapshot.code,
      leaderId: snapshot.leaderId,
      members: snapshot.members.map((member) => ({ ...member })),
      lastCheck: snapshot.lastCheck,
    };
    this.roomCodeDraft = snapshot.code || this.roomCodeDraft;

    if (this.modeId) {
      const mode = getModeDefinition(this.modeId);
      this.applyRoomView(mode);
      this.applySocialView(mode);
    }
  }

  clearRoomSnapshot(message = "私人模式链路待连接。") {
    this.roomState = this.createEmptyRoomState();
    this.roomCodeDraft = "";
    this.roomState.lastCheck = message;

    if (this.modeId) {
      const mode = getModeDefinition(this.modeId);
      this.applyRoomView(mode);
      this.applySocialView(mode);
    }
  }

  private buildTemplate(): string {
    return `
      <div class="mode-hall-backdrop"></div>
      <section class="mode-hall-shell mode-hall-shell--orb" aria-label="模式分厅">
        <header class="mode-hall-header">
          <div class="mode-hall-header-main">
            <button type="button" class="mode-hall-header-btn mode-hall-header-btn--ghost" data-modehall-back>返回大厅</button>
            <div class="mode-hall-title-wrap">
              <div class="mode-hall-kicker">ORB MODE HALL</div>
              <h2 data-modehall-title>模式分厅</h2>
              <p class="mode-hall-title-caption" data-modehall-title-caption>球球能量准备中</p>
            </div>
          </div>
          <div class="mode-hall-header-ribbon" data-modehall-top-ribbon></div>
          <div class="mode-hall-header-actions">
            <button type="button" class="mode-hall-header-btn" data-modehall-settings>分厅设置</button>
          </div>
        </header>

        <main class="mode-hall-main">
          <section class="mode-hall-hero mode-hall-surface-card">
            <div class="mode-hall-section-label">Orb Core</div>
            <div class="mode-hall-panel-head">
              <strong data-modehall-hero-title>模式主视觉</strong>
              <small data-modehall-hero-subtitle>模式介绍</small>
            </div>
            <p class="mode-hall-hero-summary" data-modehall-hero-summary>球体引擎正在同步模式数据。</p>
            <div class="mode-hall-hero-badges" data-modehall-hero-badges></div>
            <div class="mode-hall-hero-stage-shell">
              <div class="mode-hall-hero-stage">
                <div class="mode-hall-stage-aura"></div>
                <div class="mode-hall-stage-grid"></div>
                <canvas class="mode-hall-hero-canvas" data-modehall-hero-canvas></canvas>
                <div class="mode-hall-stage-orbit mode-hall-stage-orbit--outer"></div>
                <div class="mode-hall-stage-orbit mode-hall-stage-orbit--inner"></div>
                <div class="mode-hall-stage-scanline"></div>
              </div>
              <aside class="mode-hall-hero-stats" data-modehall-hero-metrics></aside>
            </div>
            <div class="mode-hall-hero-bottom">
              <div class="mode-hall-hero-footnote" data-modehall-hero-footnote>实时投影预览</div>
              <div class="mode-hall-cta-cluster">
                <button type="button" class="mode-hall-header-btn mode-hall-header-btn--highlight mode-hall-main-cta" data-modehall-start>立即匹配</button>
                <div class="mode-hall-cta-note">
                  <strong data-modehall-cta-title>准备就绪</strong>
                  <span data-modehall-cta-hint>预计 6 秒进入战场</span>
                </div>
              </div>
            </div>
          </section>

          <section class="mode-hall-operation mode-hall-surface-card">
            <div class="mode-hall-section-label">Room Grid</div>
            <div class="mode-hall-panel-head">
              <strong data-modehall-operation-title>核心操作</strong>
              <small data-modehall-operation-desc>操作说明</small>
            </div>
            <div class="mode-hall-room-strip">
              <article class="mode-hall-room-line">
                <span>房间状态</span>
                <strong data-room-status>待集结</strong>
              </article>
              <article class="mode-hall-room-line">
                <span>房间码</span>
                <strong data-room-code>----</strong>
              </article>
              <article class="mode-hall-room-line">
                <span>队伍席位</span>
                <strong data-room-capacity>0 / 0</strong>
              </article>
            </div>
            <div class="mode-hall-room-entry">
              <label class="mode-hall-room-entry-label" for="mode-hall-room-code-input">加入房间码</label>
              <div class="mode-hall-room-entry-row">
                <input id="mode-hall-room-code-input" class="mode-hall-room-input" data-room-code-input type="text" inputmode="text" maxlength="8" autocomplete="off" spellcheck="false" placeholder="输入 6 位房间码" />
                <button type="button" class="mode-hall-room-copy" data-room-copy>复制邀请码</button>
              </div>
            </div>
            <div class="mode-hall-room-actions">
              <button type="button" data-room-action="create">
                <span>创建房间</span>
                <small>先手开球，拉好友一起进场</small>
              </button>
              <button type="button" data-room-action="join">
                <span>加入房间</span>
                <small>输入房间码快速归队</small>
              </button>
              <button type="button" data-room-action="ready">
                <span>切换准备</span>
                <small>同步当前席位状态</small>
              </button>
              <button type="button" data-room-action="leave">
                <span>离开房间</span>
                <small>退出当前集结队伍</small>
              </button>
            </div>
            <div class="mode-hall-room-members" data-room-members></div>
            <div class="mode-hall-room-tip" data-room-tip>私人模式链路待连接。</div>
          </section>

          <div class="mode-hall-side-column">
            <section class="mode-hall-intel mode-hall-surface-card">
              <div class="mode-hall-section-label">Mode Intel</div>
              <div class="mode-hall-panel-head">
                <strong data-modehall-intel-title>模式情报</strong>
                <small data-modehall-intel-subtitle>分厅追踪</small>
              </div>
              <ul class="mode-hall-intel-list" data-modehall-intel-list></ul>
            </section>

            <section class="mode-hall-social-panel mode-hall-surface-card">
              <div class="mode-hall-section-label">Social</div>
              <div class="mode-hall-panel-head">
                <strong>社交面板</strong>
                <small data-modehall-social-caption>邀请好友或切入观战席</small>
              </div>
              <div class="mode-hall-social-tabs">
                <button type="button" data-social-tab="friends">好友</button>
                <button type="button" data-social-tab="spectate">观战</button>
              </div>
              <div class="mode-hall-social-list" data-modehall-social-list></div>
            </section>
          </div>
        </main>

        <footer class="mode-hall-footer mode-hall-surface-card">
          <div class="mode-hall-footer-head">
            <div class="mode-hall-panel-head">
              <strong data-modehall-footer-title>模式作战指南</strong>
              <small data-modehall-footer-subtitle>切换标签查看重点</small>
            </div>
            <div class="mode-hall-tabs" role="tablist">
              ${TAB_DEFS.map(
                (tab) => `
                  <button type="button" class="mode-hall-tab" data-modehall-tab="${tab.id}" role="tab">
                    ${tab.label}
                  </button>
                `,
              ).join("")}
            </div>
          </div>
          <div class="mode-hall-tab-content" data-modehall-tab-content></div>
        </footer>
      </section>
    `;
  }

  private bindEvents() {
    this.root
      .querySelector<HTMLElement>("[data-modehall-back]")
      ?.addEventListener("click", () => {
        this.options.onBackLobby();
      });

    this.root
      .querySelector<HTMLElement>("[data-modehall-settings]")
      ?.addEventListener("click", () => {
        this.options.onOpenSettings();
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-modehall-start]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          if (!this.modeId) {
            return;
          }
          this.options.onStartMatch(this.modeId);
        });
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-modehall-tab]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const tabId = button.dataset.modehallTab;
          if (!this.isTabId(tabId)) {
            return;
          }
          this.activeTab = tabId;
          void this.refreshView(false);
        });
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-room-action]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const action = button.dataset.roomAction;
          if (!this.isRoomAction(action)) {
            return;
          }
          const payload =
            action === "join" ? this.getPendingRoomCodePayload() : undefined;
          void this.applyRoomAction(action, payload);
        });
      });

    this.root
      .querySelector<HTMLElement>("[data-room-copy]")
      ?.addEventListener("click", () => {
        void this.copyRoomCode();
      });

    this.root
      .querySelector<HTMLInputElement>("[data-room-code-input]")
      ?.addEventListener("input", (event) => {
        const input = event.currentTarget as HTMLInputElement;
        const nextValue = this.normalizeRoomCode(input.value);
        input.value = nextValue;
        this.roomCodeDraft = nextValue;
      });

    this.root
      .querySelector<HTMLInputElement>("[data-room-code-input]")
      ?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }
        event.preventDefault();
        void this.applyRoomAction("join", this.getPendingRoomCodePayload());
      });

    this.root
      .querySelectorAll<HTMLElement>("[data-social-tab]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const socialTab = button.dataset.socialTab;
          if (!this.isSocialTabId(socialTab)) {
            return;
          }
          this.activeSocialTab = socialTab;
          if (this.modeId) {
            this.applySocialView(getModeDefinition(this.modeId));
          }
        });
      });
  }

  private async refreshView(playEntryAnimation: boolean) {
    if (!this.modeId) {
      return;
    }

    const mode = getModeDefinition(this.modeId);
    this.root.dataset.modeTheme = mode.theme;
    this.root.dataset.modeLayout = mode.layout.id;
    this.root.dataset.roomCreated = String(this.roomState.created);
    this.syncBreakpointState();
    this.root.dataset.ctaState = this.computeCtaState();
    this.root.style.setProperty(
      "--mode-main-columns",
      mode.layout.columnsDesktop,
    );
    this.root.style.setProperty("--mode-left-rows", mode.layout.leftRows);
    this.root.style.setProperty("--mode-center-rows", mode.layout.centerRows);
    this.root.style.setProperty("--mode-right-rows", mode.layout.rightRows);
    this.root.style.setProperty(
      "--mode-footer-columns",
      mode.layout.footerColumns,
    );

    this.setText("[data-modehall-title]", `${mode.name}分厅`);
    this.setText("[data-modehall-title-caption]", mode.hall.heroSubtitle);
    this.setText("[data-modehall-hero-title]", mode.hall.heroTitle);
    this.setText("[data-modehall-hero-subtitle]", mode.hall.heroSubtitle);
    this.setText("[data-modehall-hero-summary]", this.buildHeroSummary(mode));
    this.setText(
      "[data-modehall-hero-footnote]",
      `${mode.name} · ${this.buildHeroFootnote(mode)}`,
    );
    this.setText("[data-modehall-operation-title]", mode.hall.operationTitle);
    this.setText(
      "[data-modehall-operation-desc]",
      mode.hall.operationDescription,
    );
    this.setText("[data-modehall-intel-title]", mode.hall.intelTitle);
    this.setText(
      "[data-modehall-intel-subtitle]",
      `${this.formatDuration(mode.gameplay.durationSeconds)}局时 · ${mode.matching.minStartPlayers}人可开`,
    );
    this.setText(
      "[data-modehall-social-caption]",
      mode.social.supportsSpectate
        ? "邀请好友或切入观战席"
        : "好友集结，专注即时开球",
    );
    this.setText(
      "[data-modehall-cta-title]",
      mode.social.supportsRoom ? "匹配与房间双线并行" : "立即单人开局",
    );
    this.setText(
      "[data-modehall-cta-hint]",
      `预计 ${mode.matching.expectedSeconds.toFixed(1)} 秒进入战场 · ${mode.matching.targetPlayers} 人目标同场`,
    );
    this.setText("[data-modehall-footer-title]", `${mode.name}作战指南`);

    const topRibbon = this.root.querySelector<HTMLElement>(
      "[data-modehall-top-ribbon]",
    );
    if (topRibbon) {
      topRibbon.innerHTML = this.buildTopRibbon(mode);
    }

    const heroBadges = this.root.querySelector<HTMLElement>(
      "[data-modehall-hero-badges]",
    );
    if (heroBadges) {
      heroBadges.innerHTML = this.buildHeroBadges(mode);
    }

    const heroMetrics = this.root.querySelector<HTMLElement>(
      "[data-modehall-hero-metrics]",
    );
    if (heroMetrics) {
      heroMetrics.innerHTML = this.buildHeroMetrics(mode);
    }

    const intelList = this.root.querySelector<HTMLElement>(
      "[data-modehall-intel-list]",
    );
    if (intelList) {
      intelList.innerHTML = mode.hall.intelEntries
        .map(
          (entry, index) => `
            <li>
              <strong>${String(index + 1).padStart(2, "0")}</strong>
              <span>${this.escapeHtml(entry)}</span>
            </li>
          `,
        )
        .join("");
    }

    this.applyTabContent(mode);
    this.applyRoomView(mode);
    this.applySocialView(mode);
    this.syncTabButtons();
    await this.ensureHeroStage();
    if (this.heroStage) {
      await this.heroStage.setMode(mode);
      this.heroState = "ready";
      this.root.dataset.heroState = this.heroState;
    }

    if (playEntryAnimation && !this.settings.reducedMotion) {
      this.playEntryAnimation();
    }
  }

  private applyTabContent(mode: ModeDefinition) {
    const contentHost = this.root.querySelector<HTMLElement>(
      "[data-modehall-tab-content]",
    );
    if (!contentHost) {
      return;
    }

    this.setText(
      "[data-modehall-footer-subtitle]",
      this.getTabLeadCopy(mode, this.activeTab),
    );

    const lines = mode.hall.tabContent[this.activeTab] ?? [];
    contentHost.innerHTML = lines
      .map(
        (line, index) => `
          <article class="mode-hall-tab-card">
            <span class="mode-hall-tab-index">${String(index + 1).padStart(2, "0")}</span>
            <div class="mode-hall-tab-copy">
              <strong>${this.escapeHtml(this.getTabCardTitle(this.activeTab, index + 1))}</strong>
              <span>${this.escapeHtml(line)}</span>
            </div>
          </article>
        `,
      )
      .join("");
  }

  private applyRoomView(mode: ModeDefinition) {
    const roomStatus =
      this.root.querySelector<HTMLElement>("[data-room-status]");
    const roomCode = this.root.querySelector<HTMLElement>("[data-room-code]");
    const roomTip = this.root.querySelector<HTMLElement>("[data-room-tip]");
    const roomMembers = this.root.querySelector<HTMLElement>(
      "[data-room-members]",
    );
    const roomCapacity = this.root.querySelector<HTMLElement>(
      "[data-room-capacity]",
    );
    const roomInput = this.root.querySelector<HTMLInputElement>(
      "[data-room-code-input]",
    );
    const copyButton = this.root.querySelector<HTMLButtonElement>(
      "[data-room-copy]",
    );
    const actionButtons =
      this.root.querySelectorAll<HTMLButtonElement>("[data-room-action]");

    this.root.dataset.roomCreated = String(this.roomState.created);

    if (roomStatus) {
      roomStatus.textContent = this.getRoomStatusLabel(mode);
    }
    if (roomCode) {
      roomCode.textContent = this.roomState.created ? this.roomState.code : "----";
    }
    if (roomCapacity) {
      roomCapacity.textContent = `${this.roomState.members.length} / ${mode.social.roomSize}`;
    }
    if (roomTip) {
      roomTip.textContent = this.roomState.lastCheck || "私人模式链路待连接。";
    }

    if (roomInput) {
      roomInput.disabled = !mode.social.supportsRoom || this.roomState.created;
      roomInput.placeholder = mode.social.supportsRoom
        ? this.roomState.created
          ? "房间已创建，可直接复制邀请码"
          : "输入 6 位房间码"
        : "该模式暂不支持私人房间";
      roomInput.value = this.roomState.created
        ? this.roomState.code
        : this.roomCodeDraft;
    }

    if (copyButton) {
      copyButton.disabled = !this.roomState.created;
    }

    if (roomMembers) {
      roomMembers.innerHTML = this.buildRoomMemberCards(mode);
    }

    actionButtons.forEach((button) => {
      if (!mode.social.supportsRoom) {
        button.disabled = true;
        return;
      }

      const action = button.dataset.roomAction;
      if (action === "create" || action === "join") {
        button.disabled = this.roomState.created;
        return;
      }

      button.disabled = !this.roomState.created;
    });
  }

  private async applyRoomAction(action: RoomAction, payload?: string) {
    const mode = this.modeId
      ? getModeDefinition(this.modeId)
      : MODE_DEFINITIONS.classic;
    const bridge = this.options.onRoomAction;
    const normalizedPayload =
      action === "join" ? this.normalizeRoomCode(payload ?? "") : payload;

    if (action === "join" && !this.roomState.created && !normalizedPayload) {
      this.roomState.lastCheck = "请输入房间码后再加入房间。";
      this.applyRoomView(mode);
      return;
    }

    if (!bridge) {
      this.applyRoomActionLocal(action, normalizedPayload);
      return;
    }

    try {
      const bridged = await bridge(action, normalizedPayload);
      if (bridged) {
        this.roomState = {
          created: bridged.created,
          code: bridged.code,
          leaderId: bridged.leaderId,
          members: bridged.members.map((member) => ({ ...member })),
          lastCheck: bridged.lastCheck,
        };
        this.roomCodeDraft = bridged.code || this.roomCodeDraft;
        this.applyRoomView(mode);
        this.applySocialView(mode);
        return;
      }

      this.roomState.lastCheck = "房间服务当前不可用。";
      this.applyRoomView(mode);
      this.applySocialView(mode);
    } catch (error) {
      this.roomState.lastCheck =
        error instanceof Error ? error.message : "房间操作失败，请稍后重试。";
      this.applyRoomView(mode);
      this.applySocialView(mode);
    }
  }

  private applyRoomActionLocal(action: RoomAction, payload?: string) {
    const mode = this.modeId
      ? getModeDefinition(this.modeId)
      : MODE_DEFINITIONS.classic;

    if (!mode.social.supportsRoom) {
      this.roomState.lastCheck = "该模式当前不支持房间功能。";
      this.applyRoomView(mode);
      return;
    }

    if (action === "create") {
      const code = this.createRoomCode();
      this.roomState = {
        created: true,
        code,
        leaderId: "player",
        members: [
          {
            id: "player",
            name: this.settings.playerName.trim() || "未命名玩家",
            ready: false,
            isBot: false,
          },
        ],
        lastCheck: "本地私人房间已创建，可继续测试加入、准备与离队。",
      };
      this.roomCodeDraft = code;
      this.applyRoomView(mode);
      this.applySocialView(mode);
      return;
    }

    if (action === "join") {
      const inviteCode = this.normalizeRoomCode(payload ?? "");
      if (!inviteCode) {
        this.roomState.lastCheck = "请输入房间码后再加入房间。";
        this.applyRoomView(mode);
        return;
      }

      if (this.roomState.created) {
        this.roomState.lastCheck = "你当前已在房间中。";
      } else {
        this.roomState = {
          created: true,
          code: inviteCode,
          leaderId: "captain",
          members: [
            {
              id: "captain",
              name: "房主泡泡",
              ready: true,
              isBot: true,
            },
            {
              id: "player",
              name: this.settings.playerName.trim() || "未命名玩家",
              ready: false,
              isBot: false,
            },
          ],
          lastCheck: "已加入本地私人房间。",
        };
        this.roomCodeDraft = inviteCode;
      }
      this.applyRoomView(mode);
      this.applySocialView(mode);
      return;
    }

    if (!this.roomState.created) {
      this.roomState.lastCheck = "请先创建或加入房间。";
      this.applyRoomView(mode);
      return;
    }

    if (action === "ready") {
      const target = this.roomState.members.find(
        (member) => member.id === "player",
      );
      if (target) {
        target.ready = !target.ready;
        this.roomState.lastCheck = target.ready
          ? "你已准备，等待全员开球。"
          : "你已取消准备。";
      } else {
        this.roomState.lastCheck = "当前房间中未找到你的席位。";
      }
    } else if (action === "leave") {
      this.roomState = this.createEmptyRoomState();
      this.roomCodeDraft = "";
      this.roomState.lastCheck = "你已离开房间。";
    }

    this.applyRoomView(mode);
    this.applySocialView(mode);
  }

  private playEntryAnimation() {
    const shell = this.root.querySelector<HTMLElement>(".mode-hall-shell");
    const cards = Array.from(
      this.root.querySelectorAll<HTMLElement>(".mode-hall-surface-card"),
    );
    const tabCards = Array.from(
      this.root.querySelectorAll<HTMLElement>(".mode-hall-tab-card"),
    );

    if (shell) {
      const shellAnimation = animate(
        shell,
        {
          opacity: [0.58, 1],
          transform: [
            "translateY(20px) scale(0.985)",
            "translateY(0px) scale(1)",
          ],
        },
        { duration: 0.32, easing: "ease-out" },
      );
      void shellAnimation.finished
        .catch(() => undefined)
        .then(() => {
          shell.style.removeProperty("transform");
          shell.style.removeProperty("opacity");
        });
    }

    cards.forEach((card, index) => {
      animate(
        card,
        {
          opacity: [0, 1],
          transform: ["translateY(22px)", "translateY(0px)"],
        },
        { duration: 0.34, delay: index * 0.045, easing: "ease-out" },
      );
    });

    tabCards.forEach((card, index) => {
      animate(
        card,
        {
          opacity: [0, 1],
          transform: ["translateY(14px)", "translateY(0px)"],
        },
        { duration: 0.26, delay: index * 0.04, easing: "ease-out" },
      );
    });
  }

  private syncTabButtons() {
    this.root
      .querySelectorAll<HTMLElement>("[data-modehall-tab]")
      .forEach((button) => {
        const isActive = button.dataset.modehallTab === this.activeTab;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-selected", isActive ? "true" : "false");
      });
  }

  private applySocialView(mode: ModeDefinition) {
    const host = this.root.querySelector<HTMLElement>(
      "[data-modehall-social-list]",
    );
    if (!host) {
      return;
    }

    this.root
      .querySelectorAll<HTMLElement>("[data-social-tab]")
      .forEach((button) => {
        const isActive = button.dataset.socialTab === this.activeSocialTab;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });

    const rows = this.getSocialRows(mode, this.activeSocialTab);
    host.innerHTML = rows
      .map(
        (row) => `
          <article class="mode-hall-social-row">
            <span class="mode-hall-social-orb">${this.escapeHtml(this.getInitialGlyph(row.title))}</span>
            <div class="mode-hall-social-copy">
              <strong>${this.escapeHtml(row.title)}</strong>
              <span>${this.escapeHtml(row.meta)}</span>
            </div>
            <em>${this.escapeHtml(row.badge)}</em>
          </article>
        `,
      )
      .join("");
  }

  private getSocialRows(
    mode: ModeDefinition,
    tabId: SocialTabId,
  ): SocialRow[] {
    if (tabId === "friends") {
      return [
        {
          title: "泡泡喵",
          meta: `${mode.name} · 在线等你组队`,
          badge: "邀请",
        },
        {
          title: "团子队长",
          meta: this.roomState.created
            ? `房间 ${this.roomState.code} · 可拉进来`
            : "空闲中 · 随时可以开球",
          badge: "组队",
        },
        {
          title: "旋风仔",
          meta: mode.social.supportsReplay
            ? "刚打完上一局 · 可一起复盘"
            : "当前空闲 · 适合快速开局",
          badge: mode.social.supportsReplay ? "复盘" : "待命",
        },
      ];
    }

    if (!mode.social.supportsSpectate) {
      return [
        {
          title: "观战暂未开放",
          meta: "该模式主打即开即打，当前没有观战席。",
          badge: "关闭",
        },
      ];
    }

    return [
      {
        title: "高分观战席 A",
        meta: `${mode.name} · 正在激战中`,
        badge: "进入",
      },
      {
        title: "热门回放 #17",
        meta: mode.social.supportsReplay
          ? "2 分钟前 · 可直接复盘"
          : "观战已开放 · 回放待接入",
        badge: mode.social.supportsReplay ? "观看" : "稍后",
      },
      {
        title: "训练复盘",
        meta: `${this.formatDuration(mode.gameplay.durationSeconds)}标准局 · 技巧参考`,
        badge: "学习",
      },
    ];
  }

  private async ensureHeroStage() {
    if (this.heroStage) {
      return;
    }

    if (this.heroStageSetup) {
      await this.heroStageSetup;
      return;
    }

    this.heroState = "loading";
    this.root.dataset.heroState = this.heroState;

    this.heroStageSetup = (async () => {
      try {
        const module = await import("./ModeHeroStage");
        if (!this.root.isConnected) {
          return;
        }
        const stage = new module.ModeHeroStage(this.heroCanvas);
        stage.setReducedMotion(this.settings.reducedMotion);
        this.heroStage = stage;
        this.heroState = "ready";
      } catch (error) {
        console.error("[ModeHallUI] Failed to initialize hero stage:", error);
        this.heroState = "fallback";
      } finally {
        this.root.dataset.heroState = this.heroState;
        this.heroStageSetup = null;
      }
    })();

    await this.heroStageSetup;
  }

  private computeCtaState(): ModeHallState["ctaState"] {
    if (!this.modeId) {
      return "idle";
    }
    return "ready";
  }

  private setText(selector: string, text: string) {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (element) {
      element.textContent = text;
    }
  }

  private buildTopRibbon(mode: ModeDefinition): string {
    const items = [
      {
        label: "预计匹配",
        value: `${mode.matching.expectedSeconds.toFixed(1)}s`,
      },
      {
        label: "开局门槛",
        value: `${mode.matching.minStartPlayers}人`,
      },
      {
        label: "积分倍率",
        value: this.formatMultiplier(mode.gameplay.scoreMultiplier),
      },
    ];

    return items
      .map(
        (item) => `
          <article class="mode-hall-ribbon-chip">
            <span>${this.escapeHtml(item.label)}</span>
            <strong>${this.escapeHtml(item.value)}</strong>
          </article>
        `,
      )
      .join("");
  }

  private buildHeroSummary(mode: ModeDefinition): string {
    const roomCopy = mode.social.supportsRoom
      ? `支持 ${mode.social.roomSize} 人房间集结`
      : "暂不开放私人房间";
    const spectateCopy = mode.social.supportsSpectate
      ? "可切入观战位围观高分对局"
      : "专注即时开局与快速对抗";
    return `${this.formatDuration(mode.gameplay.durationSeconds)}节奏战，目标 ${mode.matching.targetPlayers} 名玩家同场。${roomCopy}，${spectateCopy}。`;
  }

  private buildHeroFootnote(mode: ModeDefinition): string {
    if (mode.gameplay.battleRoyale.enabled) {
      return `缩圈 ${mode.gameplay.battleRoyale.shrinkStartSeconds}s 后开启，圈外每秒掉血 ${mode.gameplay.battleRoyale.outOfZoneDamagePerSecond}`;
    }
    if (mode.gameplay.teamMode) {
      return `协作贡献已纳入结算，${mode.social.roomSize} 人房间优先适配`;
    }
    return `${mode.matching.minStartPlayers} 人可开局 · ${mode.matching.targetPlayers} 人目标同场`;
  }

  private buildHeroBadges(mode: ModeDefinition): string {
    const badges = [
      `局时 ${this.formatDuration(mode.gameplay.durationSeconds)}`,
      `房间 ${mode.social.roomSize} 席`,
      mode.gameplay.teamMode ? "团队联动" : "自由吞噬",
      mode.social.supportsSpectate ? "观战开启" : "观战关闭",
    ];

    return badges
      .map(
        (badge) => `<span class="mode-hall-hero-badge">${this.escapeHtml(badge)}</span>`,
      )
      .join("");
  }

  private buildHeroMetrics(mode: ModeDefinition): string {
    const metrics = [
      {
        label: "成长速率",
        value: this.formatMultiplier(mode.gameplay.speedMultiplier),
      },
      {
        label: "衰减系数",
        value: this.formatMultiplier(mode.gameplay.decayMultiplier),
      },
      {
        label: "积分收益",
        value: this.formatMultiplier(mode.gameplay.rankPointMultiplier),
      },
      {
        label: "模式节奏",
        value: this.getHudEmphasisLabel(mode),
      },
    ];

    return metrics
      .map(
        (metric) => `
          <article class="mode-hall-hero-stat">
            <span>${this.escapeHtml(metric.label)}</span>
            <strong>${this.escapeHtml(metric.value)}</strong>
          </article>
        `,
      )
      .join("");
  }

  private buildRoomMemberCards(mode: ModeDefinition): string {
    if (!mode.social.supportsRoom) {
      return `
        <article class="mode-hall-room-member mode-hall-room-member--empty">
          <span class="mode-hall-room-member-orb">!</span>
          <div class="mode-hall-room-member-copy">
            <strong>该模式未开放房间</strong>
            <span>当前只支持直接匹配进入对局</span>
          </div>
          <em>关闭</em>
        </article>
      `;
    }

    const cards: string[] = [];
    const seats = Math.max(mode.social.roomSize, this.roomState.members.length);

    for (let index = 0; index < seats; index += 1) {
      const member = this.roomState.members[index];
      if (!member) {
        cards.push(`
          <article class="mode-hall-room-member mode-hall-room-member--empty">
            <span class="mode-hall-room-member-orb">${index + 1}</span>
            <div class="mode-hall-room-member-copy">
              <strong>${this.roomState.created ? "等待加入" : "空席位"}</strong>
              <span>${this.roomState.created ? "队伍仍可继续集结" : "创建或加入房间后点亮席位"}</span>
            </div>
            <em>待命</em>
          </article>
        `);
        continue;
      }

      const roleParts = [
        member.id === this.roomState.leaderId ? "队长" : member.isBot ? "占位" : "队员",
      ];
      if (member.id === "player") {
        roleParts.push("你");
      }
      const readyLabel = member.ready ? "已准备" : member.isBot ? "待加入" : "未准备";
      const classNames = ["mode-hall-room-member"];
      if (member.ready) {
        classNames.push("is-ready");
      }
      if (member.id === "player") {
        classNames.push("is-self");
      }
      if (member.id === this.roomState.leaderId) {
        classNames.push("is-leader");
      }

      cards.push(`
        <article class="${classNames.join(" ")}">
          <span class="mode-hall-room-member-orb">${this.escapeHtml(this.getInitialGlyph(member.name))}</span>
          <div class="mode-hall-room-member-copy">
            <strong>${this.escapeHtml(member.name)}</strong>
            <span>${this.escapeHtml(roleParts.join(" · "))}</span>
          </div>
          <em>${this.escapeHtml(readyLabel)}</em>
        </article>
      `);
    }

    return cards.join("");
  }

  private getRoomStatusLabel(mode: ModeDefinition): string {
    if (!mode.social.supportsRoom) {
      return "未开放";
    }
    if (!this.roomState.created) {
      return "待集结";
    }
    const humanMembers = this.roomState.members.filter((member) => !member.isBot);
    const readyCount = humanMembers.filter((member) => member.ready).length;
    if (readyCount > 0 && readyCount === humanMembers.length) {
      return "全员待发";
    }
    return "房间进行中";
  }

  private async copyRoomCode() {
    if (!this.roomState.created || !this.roomState.code) {
      return;
    }

    const mode = this.modeId
      ? getModeDefinition(this.modeId)
      : MODE_DEFINITIONS.classic;

    try {
      await navigator.clipboard.writeText(this.roomState.code);
      this.roomState.lastCheck = `房间码 ${this.roomState.code} 已复制。`;
    } catch {
      this.roomState.lastCheck = "复制失败，请手动记录房间码。";
    }

    this.applyRoomView(mode);
  }

  private getTabCardTitle(tabId: ModeHallTabId, index: number): string {
    if (tabId === "rules") {
      return `规则要点 ${index}`;
    }
    if (tabId === "rewards") {
      return `奖励节点 ${index}`;
    }
    return `地图提示 ${index}`;
  }

  private getTabLeadCopy(mode: ModeDefinition, tabId: ModeHallTabId): string {
    const label =
      TAB_DEFS.find((tab) => tab.id === tabId)?.label ?? "模式说明";
    const lead = mode.hall.tabContent[tabId]?.[0] ?? "切换标签查看当前模式说明。";
    return `${label} · ${lead}`;
  }

  private getHudEmphasisLabel(mode: ModeDefinition): string {
    switch (mode.hud.emphasis) {
      case "competitive":
        return "竞技压迫";
      case "elite":
        return "高压冲榜";
      case "casual":
        return "舒展成长";
      case "rush":
        return "极速爆发";
      case "team":
        return "协同推进";
      case "survival":
        return "生存拉扯";
      default:
        return "标准";
    }
  }

  private formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remain = seconds % 60;
    if (remain === 0) {
      return `${minutes} 分钟`;
    }
    return `${minutes} 分 ${remain} 秒`;
  }

  private formatMultiplier(value: number): string {
    return `${value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}x`;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  private normalizeRoomCode(value: string): string {
    return value.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 8);
  }

  private getPendingRoomCodePayload(): string | undefined {
    const input = this.root.querySelector<HTMLInputElement>(
      "[data-room-code-input]",
    );
    const normalized = this.normalizeRoomCode(input?.value ?? this.roomCodeDraft);
    this.roomCodeDraft = normalized;
    if (input) {
      input.value = normalized;
    }
    return normalized || undefined;
  }

  private getInitialGlyph(value: string): string {
    return value.trim().charAt(0).toUpperCase() || "O";
  }

  private isTabId(tabId: string | undefined): tabId is ModeHallTabId {
    return tabId === "rules" || tabId === "rewards" || tabId === "map";
  }

  private isRoomAction(action: string | undefined): action is RoomAction {
    return (
      action === "create" ||
      action === "join" ||
      action === "leave" ||
      action === "ready"
    );
  }

  private isSocialTabId(value: string | undefined): value is SocialTabId {
    return value === "friends" || value === "spectate";
  }

  private createRoomCode(): string {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i += 1) {
      const idx = Math.floor(Math.random() * alphabet.length);
      code += alphabet[idx];
    }
    return code;
  }

  private syncBreakpointState() {
    this.root.dataset.breakpointBucket = this.getBreakpointBucket();
  }

  private getCurrentLayoutId(): ModeHallLayoutId | null {
    if (!this.modeId) {
      return null;
    }
    return getModeDefinition(this.modeId).layout.id;
  }

  private getBreakpointBucket(): ModeHallState["breakpointBucket"] {
    const width = window.innerWidth;
    if (width >= 1440) {
      return "desktop";
    }
    if (width >= 1280) {
      return "laptop";
    }
    if (width >= 1024) {
      return "tablet";
    }
    return "mobile";
  }

  private createEmptyRoomState(): RoomState {
    return {
      created: false,
      code: "",
      leaderId: null,
      members: [],
      lastCheck: "私人模式链路待连接。",
    };
  }
}
