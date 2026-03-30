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
  type ModeQueueVariant,
  type ModeSidebarEntry,
  type ModeSidebarTabId,
} from "../modes/definitions";
import type { LobbyModeId } from "./LobbyUI";
import {
  buildHeaderRibbon,
  buildHudMarkup,
  buildModeHallTemplate,
  buildPartyMembers,
  buildQueueTabs,
  buildSidebarList,
  buildSidebarSummary,
  buildSidebarTabs,
  buildTrayContent,
  buildTrayTabs,
} from "./modeHallRender";

export type RoomAction = "create" | "join" | "leave" | "ready";
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

export interface ModeHallSocialFriend {
  gameId: string;
  nickname: string;
  isOnline: boolean;
}

export class ModeHallUI {
  private readonly root: HTMLDivElement;
  private readonly options: ModeHallUIOptions;
  private settings: GameSettings;
  private visible = false;
  private modeId: LobbyModeId | null = null;
  private activeTrayTab: ModeHallTabId = "rules";
  private activeSidebarTab: ModeSidebarTabId = "friends";
  private activeQueueVariantId: string | null = null;
  private partyPanelExpanded = false;
  private roomState: RoomState = this.createEmptyRoomState();
  private roomCodeDraft = "";
  private socialFriends: ModeHallSocialFriend[] = [];
  private heroState: ModeHallState["heroState"] = "idle";
  private readonly heroCanvas: HTMLCanvasElement;
  private heroStage: HeroStageController | null = null;
  private heroStageSetup: Promise<void> | null = null;
  private readonly keydownHandler: (event: KeyboardEvent) => void;
  private readonly resizeHandler: () => void;
  private fitFrameId: number | null = null;

  constructor(options: ModeHallUIOptions) {
    this.options = options;
    this.settings = { ...options.settings };
    this.root = document.createElement("div");
    this.root.className = "mode-hall-overlay mode-hall-overlay--v2";
    this.root.innerHTML = buildModeHallTemplate();
    const heroCanvas = this.query<HTMLCanvasElement>("[data-modehall-hero-canvas]");
    if (!heroCanvas) {
      throw new Error("Failed to initialize mode hall hero canvas.");
    }
    this.heroCanvas = heroCanvas;
    this.keydownHandler = (event) => {
      if (this.visible && event.key === "Escape") {
        this.options.onBackLobby();
      }
    };
    this.resizeHandler = () => {
      if (this.visible) {
        this.syncBreakpointState();
        this.scheduleViewportFit();
      }
    };
    this.root.dataset.heroState = this.heroState;
    this.root.dataset.reducedMotion = String(this.settings.reducedMotion);
    this.root.dataset.ctaState = this.computeCtaState();
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
    if (this.fitFrameId !== null) {
      window.cancelAnimationFrame(this.fitFrameId);
      this.fitFrameId = null;
    }
    this.heroStage?.destroy();
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
    this.activeTrayTab = tabId;
    this.activeSidebarTab = "friends";
    this.roomState = this.createEmptyRoomState();
    this.roomCodeDraft = "";
    const mode = getModeDefinition(modeId);
    this.activeQueueVariantId = mode.hall.queueVariants[0]?.id ?? null;
    this.partyPanelExpanded = mode.hall.party.defaultExpanded;
    this.root.classList.add("is-visible");
    this.syncBreakpointState();
    this.scheduleViewportFit();
    void this.refreshView(true);
  }

  hide() {
    this.visible = false;
    this.modeId = null;
    this.root.classList.remove("is-visible");
    delete this.root.dataset.modeLayout;
    delete this.root.dataset.stageStyle;
    delete this.root.dataset.partyExpanded;
    delete this.root.dataset.roomCreated;
    this.root.style.setProperty("--mode-hall-fit-scale", "1");
  }

  getSnapshot(): ModeHallSnapshot {
    return {
      visible: this.visible,
      modeId: this.modeId,
      tabId: this.activeTrayTab,
      room: this.cloneRoomState(),
      state: {
        modeId: this.modeId,
        tabId: this.activeTrayTab,
        trayTab: this.activeTrayTab,
        roomState: this.cloneRoomState(),
        sidebarTab: this.activeSidebarTab,
        heroState: this.heroState,
        ctaState: this.computeCtaState(),
        layoutId: this.getCurrentLayoutId(),
        breakpointBucket: this.getBreakpointBucket(),
        queueVariantId: this.activeQueueVariantId,
        partyPanelExpanded: this.partyPanelExpanded,
      },
    };
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
    if (snapshot.created || snapshot.members.length > 0) {
      this.partyPanelExpanded = true;
    }
    if (this.modeId) {
      const mode = getModeDefinition(this.modeId);
      this.renderPartyPanel(mode);
      this.renderSidebarList(mode);
    }
    this.scheduleViewportFit();
  }

  setSocialFriends(friends: ModeHallSocialFriend[]) {
    this.socialFriends = [...friends];
    if (this.modeId) {
      this.renderSidebarList(getModeDefinition(this.modeId));
    }
    this.scheduleViewportFit();
  }

  clearRoomSnapshot(message = "私人模式链路待连接。") {
    this.roomState = this.createEmptyRoomState();
    this.roomCodeDraft = "";
    this.roomState.lastCheck = message;
    if (this.modeId) {
      const mode = getModeDefinition(this.modeId);
      this.partyPanelExpanded = mode.hall.party.defaultExpanded;
      this.renderPartyPanel(mode);
      this.renderSidebarList(mode);
    }
    this.scheduleViewportFit();
  }

  private bindEvents() {
    this.query<HTMLElement>("[data-modehall-back]")?.addEventListener("click", () => this.options.onBackLobby());
    this.query<HTMLElement>("[data-modehall-settings]")?.addEventListener("click", () => this.options.onOpenSettings());
    this.query<HTMLElement>("[data-modehall-start]")?.addEventListener("click", () => {
      if (this.modeId) {
        this.options.onStartMatch(this.modeId);
      }
    });
    this.root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      const drawerToggle = target.closest<HTMLElement>("[data-modehall-drawer-toggle]");
      if (drawerToggle) {
        const drawerName = drawerToggle.dataset.modehallDrawerToggle;
        if (this.root.dataset.activeDrawer === drawerName) {
            this.root.dataset.activeDrawer = "";
        } else {
            this.root.dataset.activeDrawer = drawerName;
        }
        return;
      }

      if (target.closest("[data-modehall-backdrop]")) {
        this.root.dataset.activeDrawer = "";
        return;
      }

      const queueButton = target.closest<HTMLElement>("[data-queue-variant]");
      if (queueButton && queueButton.dataset.queueVariant) {
        this.activeQueueVariantId = queueButton.dataset.queueVariant;
        if (this.modeId) this.renderQueueAndCta(getModeDefinition(this.modeId));
        return;
      }
      const trayButton = target.closest<HTMLElement>("[data-tray-tab]");
      if (trayButton && this.isTrayTabId(trayButton.dataset.trayTab) && this.modeId) {
        this.activeTrayTab = trayButton.dataset.trayTab;
        this.renderTray(getModeDefinition(this.modeId));
        return;
      }
      const sidebarButton = target.closest<HTMLElement>("[data-sidebar-tab]");
      if (sidebarButton && this.isSidebarTabId(sidebarButton.dataset.sidebarTab) && this.modeId) {
        this.activeSidebarTab = sidebarButton.dataset.sidebarTab;
        this.renderSidebarTabsOnly();
        this.renderSidebarList(getModeDefinition(this.modeId));
        return;
      }
      if (target.closest("[data-modehall-party-toggle]") && this.modeId) {
        this.partyPanelExpanded = !this.partyPanelExpanded;
        this.renderPartyPanel(getModeDefinition(this.modeId));
        return;
      }
      const roomActionButton = target.closest<HTMLElement>("[data-room-action]");
      if (roomActionButton && this.isRoomAction(roomActionButton.dataset.roomAction)) {
        const payload = roomActionButton.dataset.roomAction === "join" ? this.getPendingRoomCodePayload() : undefined;
        void this.applyRoomAction(roomActionButton.dataset.roomAction, payload);
        return;
      }
      if (target.closest("[data-room-copy]")) {
        void this.copyRoomCode();
      }
    });
    this.query<HTMLInputElement>("[data-room-code-input]")?.addEventListener("input", (event) => {
      const input = event.currentTarget as HTMLInputElement;
      input.value = this.normalizeRoomCode(input.value);
      this.roomCodeDraft = input.value;
    });
    this.query<HTMLInputElement>("[data-room-code-input]")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.applyRoomAction("join", this.getPendingRoomCodePayload());
      }
    });
  }

  private async refreshView(playEntryAnimation: boolean) {
    if (!this.modeId) return;
    const mode = getModeDefinition(this.modeId);
    this.root.dataset.modeTheme = mode.theme;
    this.root.dataset.modeLayout = mode.layout.id;
    this.root.dataset.stageStyle = mode.layout.stageStyle;
    this.root.dataset.ctaAnchor = mode.layout.ctaAnchor;
    this.root.dataset.partyExpanded = String(this.partyPanelExpanded);
    this.root.dataset.roomCreated = String(this.roomState.created);
    this.root.dataset.heroState = this.heroState;
    this.root.dataset.ctaState = this.computeCtaState();
    this.setText("[data-modehall-kicker]", mode.hall.sceneAccent.overline);
    this.setText("[data-modehall-title]", `${mode.name}分厅`);
    this.setText("[data-modehall-title-caption]", mode.hall.identityHud.subtitle);
    this.setHtml("[data-modehall-hud-left]", buildHudMarkup(mode));
    this.renderStage(mode);
    this.renderQueueAndCta(mode);
    this.renderSidebar(mode);
    this.renderTray(mode);
    this.renderPartyPanel(mode);
    await this.ensureHeroStage();
    if (this.heroStage) {
      await this.heroStage.setMode(mode);
      this.heroState = "ready";
      this.root.dataset.heroState = this.heroState;
    }
    this.scheduleViewportFit();
    if (playEntryAnimation && !this.settings.reducedMotion) {
      this.playEntryAnimation();
    }
  }

  private renderStage(mode: ModeDefinition) {
    const variant = this.getActiveVariant(mode);
    this.setHtml("[data-modehall-header-ribbon]", buildHeaderRibbon(`${this.getVariantEta(mode, variant).toFixed(1)}s`, mode.matching.minStartPlayers, variant?.label ?? mode.name));
    this.setText("[data-modehall-stage-overline]", mode.hall.sceneAccent.overline);
    this.setText("[data-modehall-stage-title]", mode.hall.sceneAccent.title);
    this.setText("[data-modehall-stage-subtitle]", mode.hall.sceneAccent.subtitle);
    this.setHtml("[data-modehall-stage-watermark]", mode.hall.sceneAccent.spotlight.map((item) => `<span>${item}</span>`).join(""));
    this.setHtml("[data-modehall-spotlights]", mode.hall.sceneAccent.spotlight.map((item) => `<span class="mode-hall-spotlight-chip">${item}</span>`).join(""));
    this.setHtml("[data-modehall-stage-notches]", mode.hall.sceneAccent.stageNotches.map((item) => `<span class="mode-hall-stage-notch">${item}</span>`).join(""));
    this.setHtml(
      "[data-modehall-stage-rail]",
      [
        ["当前状态", mode.hall.sceneAccent.statusLabel, variant?.hint ?? "准备进入队列"],
        ["预计匹配", `${this.getVariantEta(mode, variant).toFixed(1)} 秒`, `${mode.matching.minStartPlayers} 人可开局`],
        ["房间能力", mode.social.supportsRoom ? `${mode.social.roomSize} 人房间` : "不支持房间", mode.gameplay.teamMode ? "团队模式默认展开房间台" : "位于次级抽屉"],
        ["模式节奏", this.getHudEmphasisLabel(mode), mode.gameplay.battleRoyale.enabled ? `圈外伤害 ${mode.gameplay.battleRoyale.outOfZoneDamagePerSecond}/秒` : `积分收益 ${this.formatMultiplier(mode.gameplay.rankPointMultiplier)}`],
      ]
        .map(
          ([label, value, note]) => `
            <article class="mode-hall-stage-stat">
              <span>${label}</span>
              <strong>${value}</strong>
              <small>${note}</small>
            </article>
          `,
        )
        .join(""),
    );
  }

  private renderQueueAndCta(mode: ModeDefinition) {
    const variant = this.getActiveVariant(mode);
    this.setHtml("[data-modehall-queue-tabs]", buildQueueTabs(mode.hall.queueVariants, this.activeQueueVariantId));
    this.setText("[data-modehall-cta-kicker]", mode.hall.sceneAccent.statusLabel);
    this.setText("[data-modehall-cta-label]", mode.hall.sceneAccent.ctaLabel);
    this.setText("[data-modehall-cta-hint]", `${mode.hall.sceneAccent.ctaHint} · ${variant?.label ?? mode.name} · ${this.getVariantEta(mode, variant).toFixed(1)} 秒`);
    const button = this.query<HTMLButtonElement>("[data-modehall-start]");
    if (button) button.textContent = mode.hall.sceneAccent.ctaLabel;
  }

  private renderSidebar(mode: ModeDefinition) {
    this.setHtml("[data-modehall-sidebar-summary]", buildSidebarSummary(mode));
    this.renderSidebarTabsOnly();
    this.renderSidebarList(mode);
  }

  private renderSidebarTabsOnly() {
    this.setHtml("[data-modehall-sidebar-tabs]", buildSidebarTabs(this.activeSidebarTab));
  }

  private renderSidebarList(mode: ModeDefinition) {
    let rows: ModeSidebarEntry[] = [];
    if (this.activeSidebarTab === "friends") {
      rows = this.socialFriends.length > 0
        ? this.socialFriends.slice(0, 4).map((friend) => ({
            title: friend.nickname,
            meta: `UID ${friend.gameId} · ${friend.isOnline ? "在线可邀" : "当前离线"}`,
            badge: friend.isOnline ? "在线" : "离线",
          }))
        : [
            { title: "泡泡喵", meta: `${mode.name} · 在线等你组队`, badge: "邀请" },
            { title: "团子队长", meta: this.roomState.created ? `房间 ${this.roomState.code} · 可拉进来` : "空闲中 · 随时开球", badge: "组队" },
            { title: "旋风仔", meta: mode.social.supportsReplay ? "刚打完上一局 · 可一起复盘" : "当前空闲 · 适合快速开局", badge: mode.social.supportsReplay ? "复盘" : "待命" },
          ];
    } else if (this.activeSidebarTab === "leaderboard") {
      rows = mode.hall.leaderboardEntries;
    } else {
      rows = mode.hall.spectateEntries;
    }
    this.setHtml("[data-modehall-sidebar-list]", buildSidebarList(rows));
    this.scheduleViewportFit();
  }

  private renderTray(mode: ModeDefinition) {
    this.setHtml("[data-modehall-tray-tabs]", buildTrayTabs(mode, this.activeTrayTab));
    this.setHtml("[data-modehall-tray-content]", buildTrayContent(mode, this.activeTrayTab));
  }

  private renderPartyPanel(mode: ModeDefinition) {
    this.root.dataset.partyExpanded = String(this.partyPanelExpanded);
    this.root.dataset.roomCreated = String(this.roomState.created);
    this.setText("[data-modehall-party-kicker]", mode.hall.party.primaryLabel);
    this.setText("[data-modehall-party-title]", mode.hall.party.drawerTitle);
    this.setText("[data-modehall-party-hint]", mode.hall.party.drawerHint);
    const toggle = this.query<HTMLButtonElement>("[data-modehall-party-toggle]");
    if (toggle) toggle.textContent = this.partyPanelExpanded ? "收起" : "展开";
    const body = this.query<HTMLElement>("[data-modehall-party-body]");
    if (body) body.hidden = !this.partyPanelExpanded;
    this.setText("[data-room-status]", this.getRoomStatusLabel(mode));
    this.setText("[data-room-code]", this.roomState.created ? this.roomState.code : "----");
    this.setText("[data-room-capacity]", `${this.roomState.members.length} / ${mode.social.roomSize}`);
    this.setText("[data-room-tip]", this.roomState.lastCheck || "私人模式链路待连接。");
    this.setHtml("[data-room-members]", buildPartyMembers(mode, this.roomState));
    const roomInput = this.query<HTMLInputElement>("[data-room-code-input]");
    if (roomInput) {
      roomInput.disabled = !mode.social.supportsRoom || this.roomState.created;
      roomInput.placeholder = mode.social.supportsRoom ? (this.roomState.created ? "房间已创建，可直接复制邀请码" : "输入 6 位房间码") : "该模式暂不支持私人房间";
      roomInput.value = this.roomState.created ? this.roomState.code : this.roomCodeDraft;
    }
    const copyButton = this.query<HTMLButtonElement>("[data-room-copy]");
    if (copyButton) copyButton.disabled = !this.roomState.created;
    this.root.querySelectorAll<HTMLButtonElement>("[data-room-action]").forEach((button) => {
      if (!mode.social.supportsRoom) {
        button.disabled = true;
      } else if (button.dataset.roomAction === "create" || button.dataset.roomAction === "join") {
        button.disabled = this.roomState.created;
      } else {
        button.disabled = !this.roomState.created;
      }
    });
    this.scheduleViewportFit();
  }

  private async applyRoomAction(action: RoomAction, payload?: string) {
    const mode = this.modeId ? getModeDefinition(this.modeId) : MODE_DEFINITIONS.classic;
    const bridge = this.options.onRoomAction;
    const normalizedPayload = action === "join" ? this.normalizeRoomCode(payload ?? "") : payload;
    if (action === "join" && !this.roomState.created && !normalizedPayload) {
      this.roomState.lastCheck = "请输入房间码后再加入房间。";
      this.renderPartyPanel(mode);
      return;
    }
    if (!bridge) {
      this.applyRoomActionLocal(action, normalizedPayload);
      return;
    }
    try {
      const bridged = await bridge(action, normalizedPayload);
      if (bridged) {
        this.roomState = { created: bridged.created, code: bridged.code, leaderId: bridged.leaderId, members: bridged.members.map((member) => ({ ...member })), lastCheck: bridged.lastCheck };
        this.roomCodeDraft = bridged.code || this.roomCodeDraft;
        this.partyPanelExpanded = this.partyPanelExpanded || bridged.created;
      } else {
        this.roomState.lastCheck = "房间服务当前不可用。";
      }
    } catch (error) {
      this.roomState.lastCheck = error instanceof Error ? error.message : "房间操作失败，请稍后重试。";
    }
    this.renderPartyPanel(mode);
    this.renderSidebarList(mode);
  }

  private applyRoomActionLocal(action: RoomAction, payload?: string) {
    const mode = this.modeId ? getModeDefinition(this.modeId) : MODE_DEFINITIONS.classic;
    if (!mode.social.supportsRoom) {
      this.roomState.lastCheck = "该模式当前不支持房间功能。";
      this.renderPartyPanel(mode);
      return;
    }
    if (action === "create") {
      const code = this.createRoomCode();
      this.roomState = { created: true, code, leaderId: "player", members: [{ id: "player", name: this.settings.playerName.trim() || "未命名玩家", ready: false, isBot: false }], lastCheck: "本地私人房间已创建，可继续测试加入、准备与离队。" };
      this.roomCodeDraft = code;
      this.partyPanelExpanded = true;
    } else if (action === "join") {
      const inviteCode = this.normalizeRoomCode(payload ?? "");
      if (!inviteCode) {
        this.roomState.lastCheck = "请输入房间码后再加入房间。";
        this.renderPartyPanel(mode);
        return;
      }
      this.roomState = {
        created: true,
        code: inviteCode,
        leaderId: "captain",
        members: [
          { id: "captain", name: "房主泡泡", ready: true, isBot: true },
          { id: "player", name: this.settings.playerName.trim() || "未命名玩家", ready: false, isBot: false },
        ],
        lastCheck: "已加入本地私人房间。",
      };
      this.roomCodeDraft = inviteCode;
      this.partyPanelExpanded = true;
    } else if (!this.roomState.created) {
      this.roomState.lastCheck = "请先创建或加入房间。";
    } else if (action === "ready") {
      const target = this.roomState.members.find((member) => member.id === "player");
      if (target) {
        target.ready = !target.ready;
        this.roomState.lastCheck = target.ready ? "你已准备，等待全员开球。" : "你已取消准备。";
      }
    } else if (action === "leave") {
      this.roomState = this.createEmptyRoomState();
      this.roomCodeDraft = "";
      this.roomState.lastCheck = "你已离开房间。";
      this.partyPanelExpanded = mode.hall.party.defaultExpanded;
    }
    this.renderPartyPanel(mode);
    this.renderSidebarList(mode);
  }

  private async copyRoomCode() {
    if (!this.roomState.created || !this.roomState.code) return;
    const mode = this.modeId ? getModeDefinition(this.modeId) : MODE_DEFINITIONS.classic;
    try {
      await navigator.clipboard.writeText(this.roomState.code);
      this.roomState.lastCheck = `房间码 ${this.roomState.code} 已复制。`;
    } catch {
      this.roomState.lastCheck = "复制失败，请手动记录房间码。";
    }
    this.renderPartyPanel(mode);
  }

  private playEntryAnimation() {
    const shell = this.query<HTMLElement>(".mode-hall-shell--scene");
    const blocks = Array.from(this.root.querySelectorAll<HTMLElement>(".mode-hall-hud-left, .mode-hall-stage-shell, .mode-hall-sidebar-right, .mode-hall-party-panel"));
    if (shell) {
      const animation = animate(shell, { opacity: [0.58, 1], transform: ["translateY(28px) scale(0.95)", "translateY(0px) scale(1)"] }, { duration: 0.6, easing: [0.34, 1.56, 0.64, 1] });
      void animation.finished.catch(() => undefined).then(() => {
        shell.style.removeProperty("transform");
        shell.style.removeProperty("opacity");
        this.scheduleViewportFit();
      });
    }
    blocks.forEach((block, index) => {
      animate(block, { opacity: [0, 1], transform: ["translateY(36px) scale(0.92)", "translateY(0px) scale(1)"] }, { duration: 0.8, delay: index * 0.05, easing: [0.34, 1.56, 0.64, 1] });
    });
  }

  private async ensureHeroStage() {
    if (this.heroStage) return;
    if (this.heroStageSetup) {
      await this.heroStageSetup;
      return;
    }
    this.heroState = "loading";
    this.root.dataset.heroState = this.heroState;
    this.heroStageSetup = (async () => {
      try {
        const module = await import("./ModeHeroStage");
        if (!this.root.isConnected) return;
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
    return this.modeId ? "ready" : "idle";
  }

  private getActiveVariant(mode: ModeDefinition): ModeQueueVariant | null {
    return mode.hall.queueVariants.find((variant) => variant.id === this.activeQueueVariantId) ?? mode.hall.queueVariants[0] ?? null;
  }

  private getVariantEta(mode: ModeDefinition, variant: ModeQueueVariant | null): number {
    return Number((mode.matching.expectedSeconds * (variant?.etaMultiplier ?? 1)).toFixed(1));
  }

  private getRoomStatusLabel(mode: ModeDefinition): string {
    if (!mode.social.supportsRoom) return "未开放";
    if (!this.roomState.created) return "待集结";
    const humans = this.roomState.members.filter((member) => !member.isBot);
    const readyCount = humans.filter((member) => member.ready).length;
    return readyCount > 0 && readyCount === humans.length ? "全员待发" : "房间进行中";
  }

  private getHudEmphasisLabel(mode: ModeDefinition): string {
    switch (mode.hud.emphasis) {
      case "competitive": return "竞技压迫";
      case "elite": return "高压冲榜";
      case "casual": return "舒展成长";
      case "rush": return "极速爆发";
      case "team": return "协同推进";
      case "survival": return "生存拉扯";
      default: return "标准";
    }
  }

  private cloneRoomState(): ModeHallRoomSnapshot {
    return { created: this.roomState.created, code: this.roomState.code, leaderId: this.roomState.leaderId, members: this.roomState.members.map((member) => ({ ...member })), lastCheck: this.roomState.lastCheck };
  }

  private formatMultiplier(value: number): string {
    return `${value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}x`;
  }

  private normalizeRoomCode(value: string): string {
    return value.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 8);
  }

  private getPendingRoomCodePayload(): string | undefined {
    const input = this.query<HTMLInputElement>("[data-room-code-input]");
    const normalized = this.normalizeRoomCode(input?.value ?? this.roomCodeDraft);
    this.roomCodeDraft = normalized;
    if (input) input.value = normalized;
    return normalized || undefined;
  }

  private isRoomAction(action: string | undefined): action is RoomAction {
    return action === "create" || action === "join" || action === "leave" || action === "ready";
  }

  private isSidebarTabId(value: string | undefined): value is ModeSidebarTabId {
    return value === "friends" || value === "leaderboard" || value === "spectate";
  }

  private isTrayTabId(value: string | undefined): value is ModeHallTabId {
    return value === "rules" || value === "rewards" || value === "records" || value === "guide";
  }

  private createRoomCode(): string {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    return code;
  }

  private syncBreakpointState() {
    this.root.dataset.breakpointBucket = this.getBreakpointBucket();
  }

  private scheduleViewportFit() {
    if (this.fitFrameId !== null) {
      window.cancelAnimationFrame(this.fitFrameId);
    }
    this.fitFrameId = window.requestAnimationFrame(() => {
      this.fitFrameId = null;
      this.syncViewportFit();
    });
  }

  private syncViewportFit() {
    const shell = this.query<HTMLElement>(".mode-hall-shell--scene");
    if (!shell || !this.visible || window.innerWidth < 1024) {
      this.root.style.setProperty("--mode-hall-fit-scale", "1");
      return;
    }

    this.root.style.setProperty("--mode-hall-fit-scale", "1");
    const availableWidth = Math.max(320, window.innerWidth - 40);
    const availableHeight = Math.max(320, window.innerHeight - 40);
    const naturalWidth = shell.offsetWidth;
    const naturalHeight = shell.offsetHeight;

    if (!naturalWidth || !naturalHeight) {
      return;
    }

    const scale = Math.min(
      1,
      availableWidth / naturalWidth,
      availableHeight / naturalHeight,
    );
    this.root.style.setProperty(
      "--mode-hall-fit-scale",
      String(Number(scale.toFixed(4))),
    );
  }

  private getCurrentLayoutId(): ModeHallLayoutId | null {
    return this.modeId ? getModeDefinition(this.modeId).layout.id : null;
  }

  private getBreakpointBucket(): ModeHallState["breakpointBucket"] {
    const width = window.innerWidth;
    if (width >= 1440) return "desktop";
    if (width >= 1280) return "laptop";
    if (width >= 1024) return "tablet";
    return "mobile";
  }

  private createEmptyRoomState(): RoomState {
    return { created: false, code: "", leaderId: null, members: [], lastCheck: "私人模式链路待连接。" };
  }

  private setText(selector: string, text: string) {
    const element = this.query<HTMLElement>(selector);
    if (element) element.textContent = text;
  }

  private setHtml(selector: string, html: string) {
    const element = this.query<HTMLElement>(selector);
    if (element) element.innerHTML = html;
  }

  private query<T extends Element>(selector: string): T | null {
    return this.root.querySelector<T>(selector);
  }
}
