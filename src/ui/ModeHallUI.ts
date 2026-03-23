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
    this.root.classList.add("is-visible");
    this.root.dataset.ctaState = this.computeCtaState();
    this.syncBreakpointState();
    void this.refreshView(true);
  }

  hide() {
    this.visible = false;
    this.modeId = null;
    this.root.classList.remove("is-visible");
    this.root.dataset.ctaState = this.computeCtaState();
    delete this.root.dataset.modeLayout;
    delete this.root.dataset.breakpointBucket;
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

    if (this.modeId) {
      this.applyRoomView(getModeDefinition(this.modeId));
    }
  }

  clearRoomSnapshot(message = "私人模式链路待连接。") {
    this.roomState = this.createEmptyRoomState();
    this.roomState.lastCheck = message;

    if (this.modeId) {
      this.applyRoomView(getModeDefinition(this.modeId));
    }
  }

  private buildTemplate(): string {
    return `
            <div class="mode-hall-backdrop"></div>
            <section class="mode-hall-shell" aria-label="模式分厅">
                <header class="mode-hall-header">
                    <button type="button" class="mode-hall-header-btn" data-modehall-back>返回大厅</button>
                    <div class="mode-hall-title-wrap">
                        <div class="mode-hall-kicker">MODE HALL</div>
                        <h2 data-modehall-title>模式分厅</h2>
                    </div>
                    <div class="mode-hall-header-actions">
                        <button type="button" class="mode-hall-header-btn" data-modehall-settings>设置</button>
                        <button type="button" class="mode-hall-header-btn mode-hall-header-btn--highlight" data-modehall-start>开始匹配</button>
                    </div>
                </header>

                <main class="mode-hall-main">
                    <section class="mode-hall-hero">
                        <div class="mode-hall-panel-head">
                            <strong data-modehall-hero-title>模式主视觉</strong>
                            <small data-modehall-hero-subtitle>模式介绍</small>
                        </div>
                        <div class="mode-hall-hero-stage">
                            <canvas class="mode-hall-hero-canvas" data-modehall-hero-canvas></canvas>
                        </div>
                        <div class="mode-hall-hero-footnote" data-modehall-hero-footnote>实时投影预览</div>
                    </section>

                    <section class="mode-hall-operation">
                        <div class="mode-hall-panel-head">
                            <strong data-modehall-operation-title>核心操作</strong>
                            <small data-modehall-operation-desc>操作说明</small>
                        </div>
                        <div class="mode-hall-room-strip">
                            <div class="mode-hall-room-line">
                                <span>房间状态</span>
                                <strong data-room-status>未创建</strong>
                            </div>
                            <div class="mode-hall-room-line">
                                <span>房间码</span>
                                <strong data-room-code>----</strong>
                            </div>
                        </div>
                        <div class="mode-hall-room-box" data-modehall-room-box>
                            <div class="mode-hall-room-actions">
                                <button type="button" data-room-action="create">创建私人房间</button>
                                <button type="button" data-room-action="join">加入私人房间</button>
                                <button type="button" data-room-action="ready">切换准备</button>
                                <button type="button" data-room-action="leave">离开房间</button>
                            </div>
                            <div class="mode-hall-room-members" data-room-members></div>
                        </div>
                        <div class="mode-hall-room-tip" data-room-tip>私人模式链路待连接。</div>
                    </section>

                    <section class="mode-hall-intel">
                        <div class="mode-hall-panel-head">
                            <strong data-modehall-intel-title>模式情报</strong>
                        </div>
                        <ul class="mode-hall-intel-list" data-modehall-intel-list></ul>
                        <div class="mode-hall-social-tabs">
                            <button type="button" data-social-tab="friends">好友</button>
                            <button type="button" data-social-tab="spectate">观战</button>
                        </div>
                        <div class="mode-hall-social-list" data-modehall-social-list></div>
                    </section>
                </main>

                <footer class="mode-hall-footer">
                    <div class="mode-hall-tabs" role="tablist">
                        ${TAB_DEFS.map(
                          (tab) => `
                            <button type="button" class="mode-hall-tab" data-modehall-tab="${tab.id}" role="tab">
                                ${tab.label}
                            </button>
                        `,
                        ).join("")}
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
      .querySelector<HTMLElement>("[data-modehall-start]")
      ?.addEventListener("click", () => {
        if (!this.modeId) {
          return;
        }
        this.options.onStartMatch(this.modeId);
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
          void this.applyRoomAction(action);
        });
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
    this.setText("[data-modehall-hero-title]", mode.hall.heroTitle);
    this.setText("[data-modehall-hero-subtitle]", mode.hall.heroSubtitle);
    this.setText(
      "[data-modehall-hero-footnote]",
      `${mode.name} · 实时投影预览`,
    );
    this.setText("[data-modehall-operation-title]", mode.hall.operationTitle);
    this.setText(
      "[data-modehall-operation-desc]",
      mode.hall.operationDescription,
    );
    this.setText("[data-modehall-intel-title]", mode.hall.intelTitle);

    const intelList = this.root.querySelector<HTMLElement>(
      "[data-modehall-intel-list]",
    );
    if (intelList) {
      intelList.innerHTML = mode.hall.intelEntries
        .map((entry) => `<li>${entry}</li>`)
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
    const lines = mode.hall.tabContent[this.activeTab] ?? [];
    contentHost.innerHTML = lines
      .map(
        (line, index) =>
          `<article class="mode-hall-tab-card"><strong>${index + 1}</strong><span>${line}</span></article>`,
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
    const actionButtons =
      this.root.querySelectorAll<HTMLButtonElement>("[data-room-action]");

    if (roomStatus) {
      roomStatus.textContent = this.roomState.created ? "已创建" : "未创建";
    }
    if (roomCode) {
      roomCode.textContent = this.roomState.created
        ? this.roomState.code
        : "----";
    }
    if (roomTip) {
      roomTip.textContent = this.roomState.lastCheck || "私人模式链路待连接。";
    }

    if (roomMembers) {
      if (!this.roomState.created) {
        roomMembers.innerHTML =
          '<div class="mode-hall-room-member mode-hall-room-member--empty">创建私人房间后可查看队伍席位。</div>';
      } else {
        roomMembers.innerHTML = this.roomState.members
          .map((member) => {
            const role =
              member.id === this.roomState.leaderId
                ? "队长"
                : member.isBot
                  ? "占位"
                  : "成员";
            const readyLabel = member.ready ? "已准备" : "未准备";
            return `
                        <div class="mode-hall-room-member">
                            <strong>${member.name}</strong>
                            <span>${role}</span>
                            <em>${readyLabel}</em>
                        </div>
                    `;
          })
          .join("");
      }
    }

    actionButtons.forEach((button) => {
      if (!mode.social.supportsRoom) {
        button.disabled = true;
        return;
      }

      const action = button.dataset.roomAction;
      if (action === "create") {
        button.disabled = this.roomState.created;
        return;
      }

      if (action === "join") {
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

    if (!bridge) {
      this.applyRoomActionLocal(action, payload);
      return;
    }

    try {
      const bridged = await bridge(action, payload);
      if (bridged) {
        this.roomState = {
          created: bridged.created,
          code: bridged.code,
          leaderId: bridged.leaderId,
          members: bridged.members.map((member) => ({ ...member })),
          lastCheck: bridged.lastCheck,
        };
        this.applyRoomView(mode);
        return;
      }

      this.roomState.lastCheck = "房间服务当前不可用。";
      this.applyRoomView(mode);
    } catch (error) {
      this.roomState.lastCheck =
        error instanceof Error ? error.message : "房间操作失败，请稍后重试。";
      this.applyRoomView(mode);
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
      this.roomState = {
        created: true,
        code: this.createRoomCode(),
        leaderId: "player",
        members: [
          {
            id: "player",
            name: this.settings.playerName.trim() || "未命名玩家",
            ready: false,
            isBot: false,
          },
        ],
        lastCheck: "本地私人房间已创建，可继续测试加入/准备/离开。",
      };
      this.applyRoomView(mode);
      return;
    }

    if (action === "join") {
      if (this.roomState.created) {
        this.roomState.lastCheck = "你当前已在房间中。";
      } else {
        this.roomState = {
          created: true,
          code: payload?.trim().toUpperCase() || this.createRoomCode(),
          leaderId: "captain",
          members: [
            {
              id: "captain",
              name: "队长",
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
      }
      this.applyRoomView(mode);
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
          ? "你已准备。"
          : "你已取消准备。";
      } else {
        this.roomState.lastCheck = "当前房间中未找到你的席位。";
      }
    } else if (action === "leave") {
      this.roomState = this.createEmptyRoomState();
      this.roomState.lastCheck = "你已离开房间。";
    }

    this.applyRoomView(mode);
  }

  private playEntryAnimation() {
    const shell = this.root.querySelector<HTMLElement>(".mode-hall-shell");
    const cards = Array.from(
      this.root.querySelectorAll<HTMLElement>(".mode-hall-tab-card"),
    );
    if (shell) {
      const shellAnimation = animate(
        shell,
        {
          opacity: [0.6, 1],
          transform: ["translateY(14px)", "translateY(0px)"],
        },
        { duration: 0.28, easing: "ease-out" },
      );
      void shellAnimation.finished
        .catch(() => undefined)
        .then(() => {
          // Clear inline transform left by animation so fixed CTA can stay viewport-fixed on mobile.
          shell.style.removeProperty("transform");
          shell.style.removeProperty("opacity");
        });
    }
    if (cards.length > 0) {
      cards.forEach((card, index) => {
        animate(
          card,
          {
            opacity: [0, 1],
            transform: ["translateY(20px)", "translateY(0px)"],
          },
          { duration: 0.28, delay: index * 0.055, easing: "ease-out" },
        );
      });
    }
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
                    <strong>${row.title}</strong>
                    <span>${row.meta}</span>
                </article>
            `,
      )
      .join("");
  }

  private getSocialRows(
    mode: ModeDefinition,
    tabId: SocialTabId,
  ): Array<{ title: string; meta: string }> {
    if (tabId === "friends") {
      return [
        { title: "Doge", meta: `${mode.name} · 在线` },
        { title: "Circle", meta: "空闲中 · 可邀请" },
        { title: "Wojak", meta: `${mode.name} · 组队中` },
      ];
    }

    return [
      { title: "观战位 A", meta: `${mode.name} · 可进入` },
      { title: "高分回放 #17", meta: "2 分钟前 · 可观看" },
      { title: "训练复盘", meta: "本地演示 · 预留入口" },
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
