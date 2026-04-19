import type { GameSettings } from "../app/settings";
import type { LobbyModeId } from "./LobbyUI";
import { type LobbyIconId, renderLobbyIcon } from "./icons";
import { getModeDefinition } from "../modes/definitions";

type MatchmakingStage = "idle" | "searching" | "confirming";
const MATCH_SUCCESS_VOICE_ASSET_URL: string | null = null;
const REAL_PLAYER_ONLY_SECONDS = 10;

export interface ExternalMatchProgress {
  stage: MatchmakingStage;
  currentPlayers: number;
  targetPlayers: number;
  etaSeconds: number;
  forceConfirming?: boolean;
}

interface MatchModeMeta {
  name: string;
  iconId: LobbyIconId;
  theme: "gold" | "violet" | "cyan" | "amber" | "purple" | "red";
  targetPlayers: number;
  minStartPlayers: number;
  expectedSeconds: number;
}

function getMatchModeMeta(modeId: LobbyModeId): MatchModeMeta {
  const definition = getModeDefinition(modeId);
  return {
    name: definition.name,
    iconId: definition.iconId,
    theme: definition.theme,
    targetPlayers: definition.matching.targetPlayers,
    minStartPlayers: definition.matching.minStartPlayers,
    expectedSeconds: definition.matching.expectedSeconds,
  };
}

export interface MatchmakingSnapshot {
  visible: boolean;
  modeId: LobbyModeId | null;
  modeName: string;
  stage: MatchmakingStage;
  currentPlayers: number;
  targetPlayers: number;
  progress: number;
  etaSeconds: number;
}

interface MatchmakingUIOptions {
  settings: GameSettings;
  onMatchReady: (modeId: LobbyModeId) => void;
  onCancelled: () => void;
}

export class MatchmakingUI {
  private readonly root: HTMLDivElement;
  private settings: GameSettings;
  private readonly options: MatchmakingUIOptions;

  private readonly titlePrefixEl: HTMLSpanElement;
  private readonly modeNameEl: HTMLSpanElement;
  private readonly modeIconEl: HTMLSpanElement;
  private readonly stageTextEl: HTMLDivElement;
  private readonly statusTextEl: HTMLDivElement;
  private readonly etaTextEl: HTMLSpanElement;
  private readonly currentPlayersEl: HTMLElement;
  private readonly currentPlayersInlineEl: HTMLElement;
  private readonly targetPlayersEl: HTMLSpanElement;
  private readonly progressBarEl: HTMLDivElement;
  private readonly progressLabelEl: HTMLSpanElement;
  private readonly slotsEl: HTMLDivElement;
  private readonly entryStateEl: HTMLDivElement;
  private readonly entryTextEl: HTMLDivElement;
  private readonly tipsEl: HTMLDivElement;

  private modeId: LobbyModeId | null = null;
  private stage: MatchmakingStage = "idle";
  private currentPlayers = 0;
  private targetPlayers = 0;
  private progress = 0;
  private etaSeconds = 0;
  private startAtMs = 0;
  private nextIncreaseAtMs = 0;
  private expectedDurationMs = 0;
  private confirmingUntilMs = 0;
  private frameId: number | null = null;
  private readyTimerId: number | null = null;
  private tipTimerId: number | null = null;
  private visible = false;
  private successCuePlayed = false;
  private successVoiceFallbackUsed = false;
  private successVoiceAudio: HTMLAudioElement | null = null;
  private successVoiceAssetReady: boolean | null = null;
  private externalDriven = false;
  private currentTipIndex = 0;

  constructor(options: MatchmakingUIOptions) {
    this.options = options;
    this.settings = { ...options.settings };
    this.root = document.createElement("div");
    this.root.className = "matchmaking-overlay";
    this.root.innerHTML = `
            <div class="matchmaking-backdrop">
                <div class="matchmaking-grid"></div>
                <div class="matchmaking-orb matchmaking-orb--a"></div>
                <div class="matchmaking-orb matchmaking-orb--b"></div>
                <div class="matchmaking-orb matchmaking-orb--c"></div>
            </div>
            <section class="matchmaking-shell" aria-label="匹配阶段">
                <div class="matchmaking-tech-bracket matchmaking-tech-bracket--tl"></div>
                <div class="matchmaking-tech-bracket matchmaking-tech-bracket--tr"></div>
                <div class="matchmaking-tech-bracket matchmaking-tech-bracket--bl"></div>
                <div class="matchmaking-tech-bracket matchmaking-tech-bracket--br"></div>
                <div class="matchmaking-scanning-line"></div>

                <div class="matchmaking-flow-field" aria-hidden="true">
                    <span class="matchmaking-flow-line matchmaking-flow-line--1"></span>
                    <span class="matchmaking-flow-line matchmaking-flow-line--2"></span>
                    <span class="matchmaking-flow-line matchmaking-flow-line--3"></span>
                    <span class="matchmaking-flow-line matchmaking-flow-line--4"></span>
                </div>

                <!-- 顶部信息条：全服竞技池 -->
                <div class="matchmaking-lobby-pill" data-lobby-pill>
                    <span class="matchmaking-lobby-dot"></span>
                    <span class="matchmaking-lobby-text">全服竞技池</span>
                    <span class="matchmaking-lobby-divider"></span>
                    <span class="matchmaking-lobby-sub" data-min-players>至少 14 人可开局</span>
                </div>

                <button type="button" class="matchmaking-cancel" data-match-cancel>取消</button>

                <h2 class="matchmaking-title">
                    <span class="matchmaking-title-prefix" data-match-title-prefix>匹配中</span>
                    <span class="matchmaking-title-mode">
                        <span class="matchmaking-mode-icon-shell" data-match-mode-icon>${renderLobbyIcon("mode_classic", "matchmaking-mode-icon")}</span>
                        <span data-match-mode>经典模式</span>
                    </span>
                </h2>

                <div class="matchmaking-stage-wrap">
                    <div class="matchmaking-stage" data-match-stage>正在匹配</div>
                    <div class="matchmaking-status" data-match-status>正在寻找对手</div>
                </div>

                <!-- 入场状态提示（匹配成功后显示） -->
                <div class="matchmaking-entry-state" data-entry-state aria-hidden="true">
                    <div class="matchmaking-entry-spinner"></div>
                    <div class="matchmaking-entry-text" data-entry-text>正在建立连接...</div>
                </div>

                <div class="matchmaking-success-stage" aria-hidden="true">
                    <span class="matchmaking-success-beam matchmaking-success-beam--left"></span>
                    <span class="matchmaking-success-beam matchmaking-success-beam--right"></span>
                    <div class="matchmaking-success-label">匹配成功</div>
                </div>

                <div class="matchmaking-visual-core">
                    <div class="matchmaking-ring-stage">
                        <div class="matchmaking-ring matchmaking-ring--outer"></div>
                        <div class="matchmaking-ring matchmaking-ring--mid"></div>
                        <div class="matchmaking-ring matchmaking-ring--inner"></div>
                        <div class="matchmaking-success-ripple"></div>
                        <div class="matchmaking-core">
                            <strong data-match-current>0</strong>
                            <span>已就位</span>
                        </div>
                    </div>

                    <div class="matchmaking-player-slots" data-match-slots>
                        <!-- Slots will be injected here -->
                    </div>
                </div>

                <!-- 动态提示区 -->
                <div class="matchmaking-tips" data-match-tips>
                    <div class="matchmaking-tip-item" data-tip="1">
                        <span class="matchmaking-tip-icon">💡</span>
                        <span class="matchmaking-tip-text">击败对手吸收他们的质量</span>
                    </div>
                    <div class="matchmaking-tip-item" data-tip="2" hidden>
                        <span class="matchmaking-tip-icon">⚡</span>
                        <span class="matchmaking-tip-text">分身可以快速追击或逃跑</span>
                    </div>
                    <div class="matchmaking-tip-item" data-tip="3" hidden>
                        <span class="matchmaking-tip-icon">🛡️</span>
                        <span class="matchmaking-tip-text">吐孢子可以喂养队友或诱饵</span>
                    </div>
                </div>

                <div class="matchmaking-footer-meta">
                    <div class="matchmaking-count-line">
                        已就位 <strong data-match-current-inline>0</strong> / <span data-match-target>0</span>
                    </div>

                    <div class="matchmaking-activity-strip" aria-hidden="true">
                        <span class="matchmaking-activity-bar"></span>
                        <span class="matchmaking-activity-bar"></span>
                        <span class="matchmaking-activity-bar"></span>
                        <span class="matchmaking-activity-bar"></span>
                        <span class="matchmaking-activity-bar"></span>
                        <span class="matchmaking-activity-bar"></span>
                        <span class="matchmaking-activity-bar"></span>
                    </div>

                    <div class="matchmaking-progress-section">
                        <div class="matchmaking-progress-track">
                            <div class="matchmaking-progress-bar" data-match-progress-bar></div>
                            <div class="matchmaking-progress-glow"></div>
                        </div>
                        <div class="matchmaking-progress-meta">
                            <span class="matchmaking-percent" data-match-progress-label>已等待 00:00</span>
                            <span class="matchmaking-eta" data-match-eta>预计 00:00</span>
                        </div>
                    </div>
                </div>
            </section>
        `;

    const titlePrefixEl =
      this.root.querySelector<HTMLSpanElement>("[data-match-title-prefix]");
    const modeNameEl =
      this.root.querySelector<HTMLSpanElement>("[data-match-mode]");
    const modeIconEl = this.root.querySelector<HTMLSpanElement>(
      "[data-match-mode-icon]",
    );
    const stageTextEl =
      this.root.querySelector<HTMLDivElement>("[data-match-stage]");
    const statusTextEl = this.root.querySelector<HTMLDivElement>(
      "[data-match-status]",
    );
    const etaTextEl =
      this.root.querySelector<HTMLSpanElement>("[data-match-eta]");
    const currentPlayersEl = this.root.querySelector<HTMLElement>(
      "[data-match-current]",
    );
    const currentInlineEl = this.root.querySelector<HTMLElement>(
      "[data-match-current-inline]",
    );
    const targetPlayersEl = this.root.querySelector<HTMLSpanElement>(
      "[data-match-target]",
    );
    const progressBarEl = this.root.querySelector<HTMLDivElement>(
      "[data-match-progress-bar]",
    );
    const progressLabelEl = this.root.querySelector<HTMLSpanElement>("[data-match-progress-label]");
    const slotsEl = this.root.querySelector<HTMLDivElement>("[data-match-slots]");
    const cancelButton = this.root.querySelector<HTMLButtonElement>(
      "[data-match-cancel]",
    );
    const entryStateEl = this.root.querySelector<HTMLDivElement>("[data-entry-state]");
    const entryTextEl = this.root.querySelector<HTMLDivElement>("[data-entry-text]");
    const tipsEl = this.root.querySelector<HTMLDivElement>("[data-match-tips]");

    if (
      !titlePrefixEl ||
      !modeNameEl ||
      !modeIconEl ||
      !stageTextEl ||
      !statusTextEl ||
      !etaTextEl ||
      !currentPlayersEl ||
      !currentInlineEl ||
      !targetPlayersEl ||
      !progressBarEl ||
      !progressLabelEl ||
      !slotsEl ||
      !cancelButton
    ) {
      throw new Error("Failed to initialize matchmaking UI.");
    }

    this.titlePrefixEl = titlePrefixEl;
    this.modeNameEl = modeNameEl;
    this.modeIconEl = modeIconEl;
    this.stageTextEl = stageTextEl;
    this.statusTextEl = statusTextEl;
    this.etaTextEl = etaTextEl;
    this.currentPlayersEl = currentPlayersEl;
    this.currentPlayersInlineEl = currentInlineEl;
    this.targetPlayersEl = targetPlayersEl;
    this.progressBarEl = progressBarEl;
    this.progressLabelEl = progressLabelEl;
    this.slotsEl = slotsEl;
    this.entryStateEl = entryStateEl ?? document.createElement("div");
    this.entryTextEl = entryTextEl ?? document.createElement("div");
    this.tipsEl = tipsEl ?? document.createElement("div");

    cancelButton.addEventListener("click", () => {
      this.cancel();
    });

    this.setSettings(this.settings);
    this.syncUI();
  }

  mount(parent: HTMLElement) {
    parent.appendChild(this.root);
  }

  destroy() {
    this.hide(true);
    if (typeof window.speechSynthesis !== "undefined") {
      window.speechSynthesis.cancel();
    }
    if (this.successVoiceAudio) {
      this.successVoiceAudio.pause();
      this.successVoiceAudio.src = "";
      this.successVoiceAudio.load();
      this.successVoiceAudio = null;
    }
    this.root.remove();
  }

  setSettings(nextSettings: GameSettings) {
    this.settings = { ...nextSettings };
    this.root.dataset.reducedMotion = String(this.settings.reducedMotion);
  }

  isActive(): boolean {
    return this.visible;
  }

  start(modeId: LobbyModeId) {
    this.stopLoop();
    this.clearReadyTimer();

    const meta = getMatchModeMeta(modeId);
    const now = performance.now();
    this.modeId = modeId;
    this.stage = "searching";
    this.targetPlayers = meta.targetPlayers;
    this.currentPlayers = 1;
    this.progress = Math.max(0.03, this.currentPlayers / this.targetPlayers);
    this.startAtMs = now;
    this.nextIncreaseAtMs = now + this.getIncreaseIntervalMs();
    this.expectedDurationMs =
      Math.max(meta.expectedSeconds, REAL_PLAYER_ONLY_SECONDS) * 1000;
    this.confirmingUntilMs = 0;
    this.etaSeconds = Math.max(1, Math.ceil(this.expectedDurationMs / 1000));
    this.visible = true;
    this.successCuePlayed = false;
    this.successVoiceFallbackUsed = false;
    this.externalDriven = false;

    this.root.classList.add("is-visible");
    this.root.classList.remove("is-confirming");
    this.entryStateEl.setAttribute("aria-hidden", "true");
    this.syncUI();
    this.loop(now);
    this.startTipRotation();
  }

  startExternal(modeId: LobbyModeId) {
    // 如果已经在 confirming 阶段，不要重置状态
    if (this.stage === "confirming") {
      this.externalDriven = true;
      return;
    }
    this.start(modeId);
    this.externalDriven = true;
    this.stageTextEl.textContent = "连接中";
    this.statusTextEl.textContent = "正在同步服务器进度";
  }

  setExternalProgress(progress: ExternalMatchProgress) {
    if (!this.visible || !this.modeId) {
      return;
    }

    this.externalDriven = true;
    this.stage = progress.stage;
    this.targetPlayers = Math.max(1, progress.targetPlayers);
    this.currentPlayers = Math.max(
      0,
      Math.min(progress.currentPlayers, this.targetPlayers),
    );
    this.etaSeconds = Math.max(0, progress.etaSeconds);
    this.progress =
      this.targetPlayers <= 0
        ? 0
        : Math.max(0, Math.min(1, this.currentPlayers / this.targetPlayers));

    if (
      (progress.forceConfirming || progress.stage === "confirming") &&
      this.stage !== "confirming"
    ) {
      console.log("[MatchmakingUI] Entering confirming stage from external progress", {
        currentStage: this.stage,
        forceConfirming: progress.forceConfirming,
        progressStage: progress.stage,
      });
      this.enterConfirming(performance.now());
      return;
    }

    this.syncUI();
  }

  hide(resetState = false) {
    this.root.classList.remove("is-visible", "is-confirming");
    this.visible = false;
    this.stopLoop();
    this.clearReadyTimer();
    this.clearTipRotation();
    this.entryStateEl.setAttribute("aria-hidden", "true");
    if (this.successVoiceAudio) {
      this.successVoiceAudio.pause();
      this.successVoiceAudio.currentTime = 0;
    }

    if (resetState) {
      this.modeId = null;
      this.stage = "idle";
      this.currentPlayers = 0;
      this.targetPlayers = 0;
      this.progress = 0;
      this.etaSeconds = 0;
      this.startAtMs = 0;
      this.nextIncreaseAtMs = 0;
      this.expectedDurationMs = 0;
      this.confirmingUntilMs = 0;
      this.externalDriven = false;
      this.syncUI();
    }
  }

  cancel() {
    if (!this.visible || this.stage === "confirming") {
      return;
    }
    this.hide(true);
    this.options.onCancelled();
  }

  getSnapshot(): MatchmakingSnapshot {
    const modeMeta = this.modeId ? getMatchModeMeta(this.modeId) : null;
    return {
      visible: this.visible,
      modeId: this.modeId,
      modeName: modeMeta?.name ?? "未匹配",
      stage: this.stage,
      currentPlayers: this.currentPlayers,
      targetPlayers: this.targetPlayers,
      progress: Number(this.progress.toFixed(3)),
      etaSeconds: this.etaSeconds,
    };
  }

  private loop = (now: number) => {
    if (!this.visible || !this.modeId) {
      return;
    }

    if (!this.externalDriven && this.stage === "searching") {
      this.tickSearching(now);
    } else if (this.stage === "confirming" && now >= this.confirmingUntilMs) {
      const modeId = this.modeId;
      console.log("[MatchmakingUI] Confirming complete, triggering onMatchReady", {
        modeId,
        confirmingUntilMs: this.confirmingUntilMs,
        now,
        diff: now - this.confirmingUntilMs,
      });
      this.hide(true);
      this.readyTimerId = window.setTimeout(
        () => {
          this.readyTimerId = null;
          this.options.onMatchReady(modeId);
        },
        this.settings.reducedMotion ? 100 : 260,
      );
      return;
    }

    this.syncUI();
    this.frameId = window.requestAnimationFrame(this.loop);
  };

  private tickSearching(now: number) {
    const elapsed = now - this.startAtMs;
    const estimatedProgress =
      this.expectedDurationMs <= 0 ? 1 : elapsed / this.expectedDurationMs;
    const realPlayerWindowElapsed = elapsed >= REAL_PLAYER_ONLY_SECONDS * 1000;

    if (realPlayerWindowElapsed && now >= this.nextIncreaseAtMs) {
      this.currentPlayers = this.targetPlayers;
      this.nextIncreaseAtMs = now + this.getIncreaseIntervalMs();
    }

    const countProgress =
      this.targetPlayers <= 0 ? 0 : this.currentPlayers / this.targetPlayers;
    const clampedEstimate = Math.max(0, Math.min(0.96, estimatedProgress));
    this.progress = realPlayerWindowElapsed
      ? Math.max(countProgress, clampedEstimate)
      : Math.max(0.03, countProgress);
    this.etaSeconds = Math.max(
      0,
      Math.ceil((this.expectedDurationMs - elapsed) / 1000),
    );

    if (this.currentPlayers >= this.targetPlayers) {
      this.enterConfirming(now);
    }
  }

  private enterConfirming(_now: number) {
    this.stage = "confirming";
    this.progress = 1;
    this.etaSeconds = 0;
    // 使用 performance.now() 确保与动画循环时间基准一致
    // 防止时间戳不一致导致的过早触发
    const minConfirmingDuration = this.settings.reducedMotion ? 800 : 2200;
    this.confirmingUntilMs = performance.now() + minConfirmingDuration;
    this.root.classList.add("is-confirming");

    // Success sequence status updates
    const sequence = [
      { delay: 0, text: "对局已锁定" },
      { delay: 420, text: "匹配成功" },
      { delay: 920, text: "正在入场" },
      { delay: 1480, text: "马上开始" },
    ];

    sequence.forEach((item) => {
      window.setTimeout(() => {
        if (this.visible && this.stage === "confirming") {
          this.statusTextEl.textContent = item.text;
        }
      }, item.delay);
    });

    void this.playSuccessCue();
  }

  private getIncreaseIntervalMs(): number {
    if (this.settings.reducedMotion) {
      return 120;
    }
    return 90 + Math.random() * 220;
  }

  private formatDurationClock(totalSeconds: number): string {
    const safeSeconds = Math.max(0, totalSeconds);
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  private getEstimatedTotalMs(elapsedMs: number): number {
    if (!this.visible || this.stage === "idle") {
      return 0;
    }

    if (this.externalDriven && this.etaSeconds > 0) {
      return Math.max(this.expectedDurationMs, elapsedMs + this.etaSeconds * 1000);
    }

    return this.expectedDurationMs;
  }

  private syncUI() {
    const modeMeta = this.modeId ? getMatchModeMeta(this.modeId) : null;
    const modeName = modeMeta?.name ?? "经典模式";
    const modeIcon = modeMeta?.iconId ?? "mode_classic";
    const target = Math.max(1, this.targetPlayers);
    const current = Math.max(0, this.currentPlayers);
    const progressPercent = Math.max(0, Math.min(100, this.progress * 100));
    const elapsedMs =
      this.visible && this.startAtMs > 0
        ? Math.max(0, performance.now() - this.startAtMs)
        : 0;
    const elapsedLabel = `已等待 ${this.formatDurationClock(
      Math.floor(elapsedMs / 1000),
    )}`;
    const estimatedLabel = `预计 ${this.formatDurationClock(
      Math.ceil(this.getEstimatedTotalMs(elapsedMs) / 1000),
    )}`;

    this.modeNameEl.textContent = modeName;
    this.modeIconEl.innerHTML = renderLobbyIcon(
      modeIcon,
      "matchmaking-mode-icon",
    );
    this.root.dataset.modeTheme = modeMeta?.theme ?? "cyan";
    this.currentPlayersEl.textContent = String(current);
    this.currentPlayersInlineEl.textContent = String(current);
    this.targetPlayersEl.textContent = String(target);
    this.progressBarEl.style.width = `${progressPercent.toFixed(1)}%`;

    this.syncSlots(current, target);

    if (!this.visible || this.stage === "idle") {
      this.titlePrefixEl.textContent = "等待中";
      this.stageTextEl.textContent = "等待开始";
      this.statusTextEl.textContent = "点击开始匹配";
      this.progressLabelEl.textContent = "已等待 00:00";
      this.etaTextEl.textContent = "预计 00:00";
      return;
    }

    if (this.stage === "confirming") {
      this.titlePrefixEl.textContent = "匹配成功";
      this.stageTextEl.textContent = "准备进入";
      this.statusTextEl.textContent = this.externalDriven
        ? "房间已锁定，正在载入战场"
        : "对局已锁定，正在进入战场";
      this.progressLabelEl.textContent = `本次耗时 ${this.formatDurationClock(
        Math.floor(elapsedMs / 1000),
      )}`;
      this.etaTextEl.textContent = "即将进入";
      return;
    }

    this.titlePrefixEl.textContent = "匹配中";
    this.progressLabelEl.textContent = elapsedLabel;
    this.etaTextEl.textContent = estimatedLabel;

    if (progressPercent < 48) {
      this.stageTextEl.textContent = "正在匹配";
      this.statusTextEl.textContent = this.externalDriven
        ? "队列同步中"
        : "正在为你寻找对手";
    } else if (progressPercent < 86) {
      this.stageTextEl.textContent = "队伍集结中";
      this.statusTextEl.textContent = this.externalDriven
        ? "房间准备中"
        : "更多玩家正在加入";
    } else {
      this.stageTextEl.textContent = "即将进入";
      this.statusTextEl.textContent = this.externalDriven
        ? "房间即将就绪"
        : "本局正在锁定";
    }
  }

  private syncSlots(current: number, target: number) {
    const existingCount = this.slotsEl.children.length;
    if (existingCount !== target) {
      this.slotsEl.innerHTML = "";
      for (let i = 0; i < target; i++) {
        const slot = document.createElement("div");
        slot.className = "matchmaking-player-slot";
        slot.innerHTML = `
                    <div class="matchmaking-player-slot-inner"></div>
                    <div class="matchmaking-player-slot-glow"></div>
                `;
        this.slotsEl.appendChild(slot);
      }
    }

    const slots = this.slotsEl.querySelectorAll(".matchmaking-player-slot");
    slots.forEach((slot, i) => {
      const isFilled = i < current;
      const wasFilled = slot.classList.contains("is-filled");

      if (isFilled && !wasFilled) {
        slot.classList.add("is-filled");
        if (!this.settings.reducedMotion) {
          slot.animate(
            [
              { transform: "scale(1)", filter: "brightness(1)" },
              { transform: "scale(1.2)", filter: "brightness(2)" },
              { transform: "scale(1)", filter: "brightness(1.5)" },
            ],
            { duration: 400, easing: "ease-out" },
          );
        }
      } else if (!isFilled && wasFilled) {
        slot.classList.remove("is-filled");
      }
    });

    this.root.dataset.allReady = String(current >= target);
  }

  private stopLoop() {
    if (this.frameId !== null) {
      window.cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  private clearReadyTimer() {
    if (this.readyTimerId !== null) {
      window.clearTimeout(this.readyTimerId);
      this.readyTimerId = null;
    }
  }

  private async playSuccessCue(): Promise<void> {
    if (this.successCuePlayed) {
      return;
    }
    this.successCuePlayed = true;
    const playedByLocalVoice = await this.playSuccessVoiceFromAsset();
    if (!playedByLocalVoice) {
      this.playSuccessVoiceBySpeechSynthesis();
    }
  }

  private async playSuccessVoiceFromAsset(): Promise<boolean> {
    if (!this.visible || this.stage !== "confirming") {
      return false;
    }
    if (typeof window.Audio === "undefined") {
      return false;
    }

    const assetAvailable = await this.ensureSuccessVoiceAsset();
    if (!assetAvailable) {
      return false;
    }

    const audio = this.ensureSuccessVoiceAudio();
    audio.volume = 1;
    audio.currentTime = 0;

    try {
      await audio.play();
      return true;
    } catch {
      return false;
    }
  }

  private async ensureSuccessVoiceAsset(): Promise<boolean> {
    if (!MATCH_SUCCESS_VOICE_ASSET_URL) {
      this.successVoiceAssetReady = false;
      return false;
    }

    if (this.successVoiceAssetReady !== null) {
      return this.successVoiceAssetReady;
    }

    this.successVoiceAssetReady = true;
    return true;
  }

  private ensureSuccessVoiceAudio(): HTMLAudioElement {
    if (this.successVoiceAudio) {
      return this.successVoiceAudio;
    }

    const audio = new Audio(MATCH_SUCCESS_VOICE_ASSET_URL ?? "");
    audio.preload = "auto";
    audio.volume = 1;
    audio.addEventListener("error", () => {
      if (this.visible && this.stage === "confirming") {
        this.playSuccessVoiceBySpeechSynthesis();
      }
    });
    this.successVoiceAudio = audio;
    return audio;
  }

  private playSuccessVoiceBySpeechSynthesis() {
    if (this.successVoiceFallbackUsed) {
      return;
    }
    this.successVoiceFallbackUsed = true;
    if (
      typeof window.speechSynthesis === "undefined" ||
      typeof window.SpeechSynthesisUtterance === "undefined"
    ) {
      return;
    }

    const synth = window.speechSynthesis;
    const speak = (isRetry = false) => {
      const voices = synth.getVoices();
      if (!voices.length && !isRetry) {
        window.setTimeout(() => {
          speak(true);
        }, 120);
        return;
      }

      const utterance = new SpeechSynthesisUtterance("匹配成功");
      utterance.lang = "zh-CN";
      utterance.volume = 1;
      utterance.rate = 0.94;
      utterance.pitch = 1.05;

      const voice =
        this.pickPreferredChineseFemaleVoice(voices) ??
        this.pickFallbackChineseVoice(voices);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }

      synth.cancel();
      synth.speak(utterance);
    };

    speak();
  }

  private pickPreferredChineseFemaleVoice(
    voices: SpeechSynthesisVoice[],
  ): SpeechSynthesisVoice | null {
    const femaleNamePattern =
      /(female|woman|girl|女|xiaoxiao|xiaoyi|晓晓|小艺|小萱|小云|yunxi|huihui|mei-jia|meijia|hsiao|sin-ji)/i;
    return (
      voices.find((voice) => {
        const lang = voice.lang.toLowerCase();
        if (!lang.includes("zh")) {
          return false;
        }
        return femaleNamePattern.test(voice.name);
      }) ?? null
    );
  }

  private pickFallbackChineseVoice(
    voices: SpeechSynthesisVoice[],
  ): SpeechSynthesisVoice | null {
    return (
      voices.find((voice) => voice.lang.toLowerCase().includes("zh")) ?? null
    );
  }

  /**
   * 设置入场状态文本（匹配成功后进房阶段显示）
   */
  setEntryStatus(text: string) {
    this.entryTextEl.textContent = text;
    this.entryStateEl.setAttribute("aria-hidden", "false");
    this.root.classList.add("is-entering");
  }

  /**
   * 清除入场状态
   */
  clearEntryStatus() {
    this.entryStateEl.setAttribute("aria-hidden", "true");
    this.root.classList.remove("is-entering");
  }

  /**
   * 启动提示轮换
   */
  private startTipRotation() {
    this.clearTipRotation();
    this.currentTipIndex = 0;
    this.rotateTip();
    this.tipTimerId = window.setInterval(() => {
      this.currentTipIndex = (this.currentTipIndex + 1) % 3;
      this.rotateTip();
    }, 6000);
  }

  /**
   * 轮换显示提示
   */
  private rotateTip() {
    const tips = this.tipsEl.querySelectorAll("[data-tip]");
    tips.forEach((tip, index) => {
      if (index === this.currentTipIndex) {
        tip.removeAttribute("hidden");
        tip.classList.add("is-active");
      } else {
        tip.setAttribute("hidden", "");
        tip.classList.remove("is-active");
      }
    });
  }

  /**
   * 清除提示轮换
   */
  private clearTipRotation() {
    if (this.tipTimerId !== null) {
      window.clearInterval(this.tipTimerId);
      this.tipTimerId = null;
    }
  }
}
