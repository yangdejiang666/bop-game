import type { GameSettings } from '../app/settings';
import type { LobbyModeId } from './LobbyUI';

type MatchmakingStage = 'idle' | 'searching' | 'confirming';

interface MatchModeMeta {
    name: string;
    targetPlayers: number;
    minStartPlayers: number;
    expectedSeconds: number;
}

const MODE_META: Record<LobbyModeId, MatchModeMeta> = {
    ranked: {
        name: '排位赛',
        targetPlayers: 50,
        minStartPlayers: 16,
        expectedSeconds: 7.2
    },
    peak: {
        name: '巅峰赛',
        targetPlayers: 50,
        minStartPlayers: 18,
        expectedSeconds: 7.8
    },
    classic: {
        name: '经典模式',
        targetPlayers: 50,
        minStartPlayers: 14,
        expectedSeconds: 6.6
    },
    speed: {
        name: '极速模式',
        targetPlayers: 40,
        minStartPlayers: 12,
        expectedSeconds: 5.4
    },
    team: {
        name: '团队模式',
        targetPlayers: 40,
        minStartPlayers: 12,
        expectedSeconds: 6
    },
    battleRoyale: {
        name: '大逃杀',
        targetPlayers: 60,
        minStartPlayers: 20,
        expectedSeconds: 8.4
    }
};

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

    private readonly modeNameEl: HTMLSpanElement;
    private readonly stageTextEl: HTMLDivElement;
    private readonly statusTextEl: HTMLDivElement;
    private readonly etaTextEl: HTMLSpanElement;
    private readonly currentPlayersEl: HTMLElement;
    private readonly currentPlayersInlineEl: HTMLElement;
    private readonly targetPlayersEl: HTMLSpanElement;
    private readonly progressBarEl: HTMLDivElement;
    private readonly progressLabelEl: HTMLSpanElement;

    private modeId: LobbyModeId | null = null;
    private stage: MatchmakingStage = 'idle';
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
    private visible = false;
    private successCuePlayed = false;
    private audioContext: AudioContext | null = null;
    private audioMasterGain: GainNode | null = null;
    private audioUnlockPending = false;
    private readonly audioUnlockHandler: () => void;

    constructor(options: MatchmakingUIOptions) {
        this.options = options;
        this.settings = { ...options.settings };
        this.root = document.createElement('div');
        this.root.className = 'matchmaking-overlay';
        this.root.innerHTML = `
            <div class="matchmaking-backdrop">
                <div class="matchmaking-orb matchmaking-orb--a"></div>
                <div class="matchmaking-orb matchmaking-orb--b"></div>
                <div class="matchmaking-orb matchmaking-orb--c"></div>
            </div>
            <section class="matchmaking-shell" aria-label="匹配阶段">
                <div class="matchmaking-flow-field" aria-hidden="true">
                    <span class="matchmaking-flow-line matchmaking-flow-line--1"></span>
                    <span class="matchmaking-flow-line matchmaking-flow-line--2"></span>
                    <span class="matchmaking-flow-line matchmaking-flow-line--3"></span>
                    <span class="matchmaking-flow-line matchmaking-flow-line--4"></span>
                </div>
                <button type="button" class="matchmaking-cancel" data-match-cancel>取消匹配</button>
                <div class="matchmaking-kicker">战前匹配</div>
                <h2 class="matchmaking-title">正在匹配 <span data-match-mode>经典模式</span></h2>
                <div class="matchmaking-stage" data-match-stage>搜寻玩家中...</div>

                <div class="matchmaking-ring-stage">
                    <div class="matchmaking-ring matchmaking-ring--outer"></div>
                    <div class="matchmaking-ring matchmaking-ring--mid"></div>
                    <div class="matchmaking-ring matchmaking-ring--inner"></div>
                    <div class="matchmaking-success-ripple"></div>
                    <div class="matchmaking-success-label">匹配成功</div>
                    <div class="matchmaking-core">
                        <strong data-match-current>0</strong>
                        <span>已加入玩家</span>
                    </div>
                </div>

                <div class="matchmaking-count-line">
                    当前人数 <strong data-match-current-inline>0</strong> / <span data-match-target>0</span>
                </div>

                <div class="matchmaking-progress-track">
                    <div class="matchmaking-progress-bar" data-match-progress-bar></div>
                </div>
                <div class="matchmaking-progress-meta">
                    <span data-match-progress-label>0%</span>
                    <span data-match-eta>预计 0 秒</span>
                </div>

                <div class="matchmaking-status" data-match-status>正在连接匹配服务器...</div>
            </section>
        `;

        const modeNameEl = this.root.querySelector<HTMLSpanElement>('[data-match-mode]');
        const stageTextEl = this.root.querySelector<HTMLDivElement>('[data-match-stage]');
        const statusTextEl = this.root.querySelector<HTMLDivElement>('[data-match-status]');
        const etaTextEl = this.root.querySelector<HTMLSpanElement>('[data-match-eta]');
        const currentPlayersEl = this.root.querySelector<HTMLElement>('[data-match-current]');
        const currentInlineEl = this.root.querySelector<HTMLElement>('[data-match-current-inline]');
        const targetPlayersEl = this.root.querySelector<HTMLSpanElement>('[data-match-target]');
        const progressBarEl = this.root.querySelector<HTMLDivElement>('[data-match-progress-bar]');
        const progressLabelEl = this.root.querySelector<HTMLSpanElement>('[data-match-progress-label]');
        const cancelButton = this.root.querySelector<HTMLButtonElement>('[data-match-cancel]');

        if (
            !modeNameEl
            || !stageTextEl
            || !statusTextEl
            || !etaTextEl
            || !currentPlayersEl
            || !currentInlineEl
            || !targetPlayersEl
            || !progressBarEl
            || !progressLabelEl
            || !cancelButton
        ) {
            throw new Error('Failed to initialize matchmaking UI.');
        }

        this.modeNameEl = modeNameEl;
        this.stageTextEl = stageTextEl;
        this.statusTextEl = statusTextEl;
        this.etaTextEl = etaTextEl;
        this.currentPlayersEl = currentPlayersEl;
        this.currentPlayersInlineEl = currentInlineEl;
        this.targetPlayersEl = targetPlayersEl;
        this.progressBarEl = progressBarEl;
        this.progressLabelEl = progressLabelEl;
        this.audioUnlockHandler = () => {
            this.resumeAudioContextIfNeeded();
        };

        cancelButton.addEventListener('click', () => {
            this.cancel();
        });
        window.addEventListener('pointerdown', this.audioUnlockHandler, { passive: true });
        window.addEventListener('click', this.audioUnlockHandler, { passive: true });
        window.addEventListener('keydown', this.audioUnlockHandler);
        window.addEventListener('touchstart', this.audioUnlockHandler, { passive: true });

        this.setSettings(this.settings);
        this.syncUI();
    }

    mount(parent: HTMLElement) {
        parent.appendChild(this.root);
    }

    destroy() {
        this.hide(true);
        window.removeEventListener('pointerdown', this.audioUnlockHandler);
        window.removeEventListener('click', this.audioUnlockHandler);
        window.removeEventListener('keydown', this.audioUnlockHandler);
        window.removeEventListener('touchstart', this.audioUnlockHandler);
        this.audioMasterGain?.disconnect();
        this.audioMasterGain = null;
        if (this.audioContext) {
            this.audioContext.close().catch(() => {
                // no-op
            });
            this.audioContext = null;
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

        const meta = MODE_META[modeId];
        const now = performance.now();
        const jitterFactor = 0.92 + Math.random() * 0.16;

        this.modeId = modeId;
        this.stage = 'searching';
        this.targetPlayers = meta.targetPlayers;
        this.currentPlayers = meta.minStartPlayers + Math.floor(Math.random() * 3);
        this.progress = Math.max(0.03, this.currentPlayers / this.targetPlayers);
        this.startAtMs = now;
        this.nextIncreaseAtMs = now + this.getIncreaseIntervalMs();
        this.expectedDurationMs = meta.expectedSeconds * 1000 * jitterFactor;
        this.confirmingUntilMs = 0;
        this.etaSeconds = Math.max(1, Math.ceil(this.expectedDurationMs / 1000));
        this.visible = true;
        this.successCuePlayed = false;

        this.root.classList.add('is-visible');
        this.root.classList.remove('is-confirming');
        this.syncUI();
        this.loop(now);
    }

    hide(resetState = false) {
        this.root.classList.remove('is-visible', 'is-confirming');
        this.visible = false;
        this.stopLoop();
        this.clearReadyTimer();

        if (resetState) {
            this.modeId = null;
            this.stage = 'idle';
            this.currentPlayers = 0;
            this.targetPlayers = 0;
            this.progress = 0;
            this.etaSeconds = 0;
            this.startAtMs = 0;
            this.nextIncreaseAtMs = 0;
            this.expectedDurationMs = 0;
            this.confirmingUntilMs = 0;
            this.syncUI();
        }
    }

    cancel() {
        if (!this.visible || this.stage === 'confirming') {
            return;
        }
        this.hide(true);
        this.options.onCancelled();
    }

    getSnapshot(): MatchmakingSnapshot {
        const modeMeta = this.modeId ? MODE_META[this.modeId] : null;
        return {
            visible: this.visible,
            modeId: this.modeId,
            modeName: modeMeta?.name ?? '未匹配',
            stage: this.stage,
            currentPlayers: this.currentPlayers,
            targetPlayers: this.targetPlayers,
            progress: Number(this.progress.toFixed(3)),
            etaSeconds: this.etaSeconds
        };
    }

    private loop = (now: number) => {
        if (!this.visible || !this.modeId) {
            return;
        }

        if (this.stage === 'searching') {
            this.tickSearching(now);
        } else if (this.stage === 'confirming' && now >= this.confirmingUntilMs) {
            const modeId = this.modeId;
            this.hide(true);
            this.readyTimerId = window.setTimeout(() => {
                this.readyTimerId = null;
                this.options.onMatchReady(modeId);
            }, this.settings.reducedMotion ? 100 : 260);
            return;
        }

        this.syncUI();
        this.frameId = window.requestAnimationFrame(this.loop);
    };

    private tickSearching(now: number) {
        if (now >= this.nextIncreaseAtMs) {
            const remaining = Math.max(0, this.targetPlayers - this.currentPlayers);
            const burst = remaining <= 5
                ? 1 + Math.floor(Math.random() * 2)
                : 2 + Math.floor(Math.random() * 4);
            this.currentPlayers = Math.min(this.targetPlayers, this.currentPlayers + burst);
            this.nextIncreaseAtMs = now + this.getIncreaseIntervalMs();
        }

        const elapsed = now - this.startAtMs;
        const estimatedProgress = this.expectedDurationMs <= 0 ? 1 : elapsed / this.expectedDurationMs;
        const countProgress = this.targetPlayers <= 0 ? 0 : this.currentPlayers / this.targetPlayers;
        const clampedEstimate = Math.max(0, Math.min(0.96, estimatedProgress));
        this.progress = Math.max(countProgress, clampedEstimate);
        this.etaSeconds = Math.max(0, Math.ceil((this.expectedDurationMs - elapsed) / 1000));

        if (this.currentPlayers >= this.targetPlayers) {
            this.stage = 'confirming';
            this.progress = 1;
            this.etaSeconds = 0;
            this.confirmingUntilMs = now + (this.settings.reducedMotion ? 320 : 1500);
            this.root.classList.add('is-confirming');
            this.playSuccessCue();
        }
    }

    private getIncreaseIntervalMs(): number {
        if (this.settings.reducedMotion) {
            return 120;
        }
        return 90 + Math.random() * 220;
    }

    private syncUI() {
        const modeMeta = this.modeId ? MODE_META[this.modeId] : null;
        const modeName = modeMeta?.name ?? '经典模式';
        const target = Math.max(1, this.targetPlayers);
        const current = Math.max(0, this.currentPlayers);
        const progressPercent = Math.max(0, Math.min(100, this.progress * 100));

        this.modeNameEl.textContent = modeName;
        this.currentPlayersEl.textContent = String(current);
        this.currentPlayersInlineEl.textContent = String(current);
        this.targetPlayersEl.textContent = String(target);
        this.progressBarEl.style.width = `${progressPercent.toFixed(1)}%`;
        this.progressLabelEl.textContent = `${Math.round(progressPercent)}%`;

        if (!this.visible || this.stage === 'idle') {
            this.stageTextEl.textContent = '等待开始匹配...';
            this.statusTextEl.textContent = '点击开始匹配后将进入匹配流程。';
            this.etaTextEl.textContent = '预计 0 秒';
            return;
        }

        if (this.stage === 'confirming') {
            this.stageTextEl.textContent = '匹配成功，准备跃迁';
            this.statusTextEl.textContent = '战术通道已打开，正在同步战场数据。';
            this.etaTextEl.textContent = '即将开始';
            return;
        }

        if (progressPercent < 32) {
            this.stageTextEl.textContent = '搜寻玩家中...';
            this.statusTextEl.textContent = '正在连接匹配服务器并校验网络质量。';
        } else if (progressPercent < 72) {
            this.stageTextEl.textContent = '筛选同段位对手...';
            this.statusTextEl.textContent = '已找到大量候选玩家，正在平衡分房强度。';
        } else {
            this.stageTextEl.textContent = '锁定战场中...';
            this.statusTextEl.textContent = '人数即将满员，正在发放出生点与初始资源。';
        }

        this.etaTextEl.textContent = this.etaSeconds > 0
            ? `预计 ${this.etaSeconds} 秒`
            : '预计 1 秒';
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

    private ensureAudioContext(): boolean {
        if (this.audioContext) {
            return true;
        }

        if (typeof window.AudioContext === 'undefined') {
            return false;
        }

        this.audioContext = new window.AudioContext();
        this.audioMasterGain = this.audioContext.createGain();
        this.audioMasterGain.gain.value = 0.72;
        this.audioMasterGain.connect(this.audioContext.destination);
        return true;
    }

    private resumeAudioContextIfNeeded() {
        if (!this.ensureAudioContext() || !this.audioContext) {
            return;
        }

        if (this.audioContext.state === 'running') {
            return;
        }

        if (this.audioUnlockPending) {
            return;
        }

        this.audioUnlockPending = true;
        this.audioContext.resume().catch(() => {
            // no-op
        }).finally(() => {
            this.audioUnlockPending = false;
        });
    }

    private playSuccessCue() {
        if (this.successCuePlayed) {
            return;
        }
        this.successCuePlayed = true;

        if (!this.ensureAudioContext() || !this.audioContext || !this.audioMasterGain) {
            return;
        }

        this.resumeAudioContextIfNeeded();
        if (this.audioContext.state !== 'running') {
            return;
        }

        const now = this.audioContext.currentTime + 0.01;
        this.playSweep(220, 620, now, 0.34, 0.28, 'triangle');
        this.playSweep(420, 860, now + 0.09, 0.36, 0.22, 'sine');
        this.playSweep(180, 140, now + 0.22, 0.28, 0.24, 'sawtooth');
        this.playSuccessVoice();
    }

    private playSweep(
        fromHz: number,
        toHz: number,
        startTime: number,
        duration: number,
        volume: number,
        wave: OscillatorType
    ) {
        if (!this.audioContext || !this.audioMasterGain) {
            return;
        }

        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        const endTime = startTime + duration;

        osc.type = wave;
        osc.frequency.setValueAtTime(Math.max(50, fromHz), startTime);
        osc.frequency.exponentialRampToValueAtTime(Math.max(60, toHz), endTime);

        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), startTime + duration * 0.28);
        gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

        osc.connect(gain);
        gain.connect(this.audioMasterGain);
        osc.start(startTime);
        osc.stop(endTime + 0.03);
    }

    private playSuccessVoice() {
        if (typeof window.speechSynthesis === 'undefined' || typeof window.SpeechSynthesisUtterance === 'undefined') {
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

            const utterance = new SpeechSynthesisUtterance('匹配成功');
            utterance.lang = 'zh-CN';
            utterance.volume = 1;
            utterance.rate = 0.92;
            utterance.pitch = 1.2;

            const voice = this.pickPreferredChineseFemaleVoice(voices) ?? this.pickFallbackChineseVoice(voices);
            if (voice) {
                utterance.voice = voice;
                utterance.lang = voice.lang;
            }

            synth.cancel();
            synth.speak(utterance);
        };

        speak();
    }

    private pickPreferredChineseFemaleVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
        const femaleNamePattern = /(female|woman|girl|女|xiaoxiao|xiaoyi|晓晓|小艺|小萱|小云|yunxi|huihui|mei-jia|meijia|hsiao|sin-ji)/i;
        return voices.find((voice) => {
            const lang = voice.lang.toLowerCase();
            if (!lang.includes('zh')) {
                return false;
            }
            return femaleNamePattern.test(voice.name);
        }) ?? null;
    }

    private pickFallbackChineseVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
        return voices.find((voice) => voice.lang.toLowerCase().includes('zh')) ?? null;
    }
}
