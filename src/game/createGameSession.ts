import { GameLoop } from '../core/GameLoop';
import { RenderSystem } from '../systems/RenderSystem';
import { Camera } from '../core/Camera';
import { Player } from '../entities/Player';
import { Bot } from '../entities/Bot';
import { Input } from '../core/Input';
import { PhysicsSystem } from '../systems/PhysicsSystem';
import { AISystem } from '../systems/AISystem';
import {
    AbilitySystem,
    type EjectMetrics,
    type SpikeMetrics,
    type SplitMetrics
} from '../systems/AbilitySystem';
import { QuadTree, Rectangle } from '../utils/QuadTree';
import { Food } from '../entities/Food';
import { Virus } from '../entities/Virus';
import { Blob } from '../entities/Blob';
import { EjectedMass } from '../entities/EjectedMass';
import type { GameSettings } from '../app/settings';
import {
    applyMatchRewardsToProgression,
    computeMatchRewards,
    getRequiredXpForLevel,
    loadPlayerProgression,
    savePlayerProgression,
    type MatchRewardBreakdown,
    type PlayerProgression
} from '../app/progression';
import { gameplayTuning } from '../gameplay/tuning';
import { TuningToolbox } from '../ui/TuningToolbox';
import type { LobbyModeId } from '../ui/LobbyUI';
import { renderLobbyIcon } from '../ui/icons';
import { GameAudioManager, type GameAudioDebugState } from '../audio/GameAudioManager';

const WORLD_SIZE = 6000;
const DEFAULT_FOOD_COUNT = 1200;
const DEFAULT_VIRUS_COUNT = 12;
const MAX_VIRUS_COUNT = 64;
const BOT_COUNT = 49;
const LEADERBOARD_SIZE = 10;
const MATCH_DURATION_SECONDS = 6 * 60;
const BEST_MASS_RECORD_KEY = 'bop:best-mass-record';

type MatchRankTheme = 'gold' | 'silver' | 'bronze' | 'normal';
export type SettlementStage = 'hidden' | 'intro' | 'rank' | 'hero' | 'rewards' | 'actions';

interface MatchTop3Entry {
    rank: 1 | 2 | 3;
    name: string;
    mass: number;
    isPlayer: boolean;
}

interface RankedControllerEntry {
    controller: Player | Bot;
    mass: number;
    isPlayer: boolean;
    name: string;
}

interface MatchModeConfig {
    id: LobbyModeId;
    name: string;
    timed: boolean;
    durationSeconds: number;
    teamMode: boolean;
}

const MATCH_MODE_CONFIG: Record<LobbyModeId, MatchModeConfig> = {
    ranked: {
        id: 'ranked',
        name: '排位赛',
        timed: true,
        durationSeconds: MATCH_DURATION_SECONDS,
        teamMode: false
    },
    peak: {
        id: 'peak',
        name: '巅峰赛',
        timed: false,
        durationSeconds: 0,
        teamMode: false
    },
    classic: {
        id: 'classic',
        name: '经典模式',
        timed: true,
        durationSeconds: MATCH_DURATION_SECONDS,
        teamMode: false
    },
    speed: {
        id: 'speed',
        name: '极速模式',
        timed: false,
        durationSeconds: 0,
        teamMode: false
    },
    team: {
        id: 'team',
        name: '团队模式',
        timed: true,
        durationSeconds: MATCH_DURATION_SECONDS,
        teamMode: true
    },
    battleRoyale: {
        id: 'battleRoyale',
        name: '大逃杀',
        timed: false,
        durationSeconds: 0,
        teamMode: false
    }
};

interface SettlementTiming {
    introEnd: number;
    rankEnd: number;
    heroEnd: number;
    rewardsEnd: number;
    total: number;
}

const FULL_SETTLEMENT_TIMING: SettlementTiming = {
    introEnd: 260,
    rankEnd: 860,
    heroEnd: 2100,
    rewardsEnd: 3200,
    total: 3200
};

const REDUCED_SETTLEMENT_TIMING: SettlementTiming = {
    introEnd: 120,
    rankEnd: 240,
    heroEnd: 500,
    rewardsEnd: 800,
    total: 800
};

export interface GameSessionSnapshot {
    isMounted: boolean;
    isRunning: boolean;
    tuningVersion: string;
    massFloor: number;
    decayRateNow: number;
    playerName: string;
    playerMass: number;
    playerCellCount: number;
    playerCellMasses: number[];
    playerCenter: {
        x: number;
        y: number;
    };
    playerAimDirection: {
        x: number;
        y: number;
    };
    playerMergeTimers: number[];
    score: number;
    elapsedSeconds: number;
    lastSplitMetrics: SplitMetrics;
    lastEjectMetrics: EjectMetrics;
    lastSpikeMetrics: SpikeMetrics;
    splitState: {
        lastSplitMs: number;
        canSplitNow: boolean;
    };
    tuning: {
        maxCells: number;
        splitBaseImpulse: number;
        splitDashTime: number;
        splitLockTime: number;
        splitLockMin: number;
        splitLockMax: number;
        cohesionNearRatio: number;
        cohesionFarRatio: number;
        cohesionNearGain: number;
        cohesionFarGain: number;
        cohesionDamping: number;
        ejectCostMass: number;
        ejectSpawnDistance: number;
        decayLoss30sAt200: number;
        spikeMainRatio: number;
        spikeTargetCells: number;
        spikeMaxPieceRatio: number;
        spikePieceMassCap: number;
        spikeVirusBonusMass: number;
        spikeVirusFeedSplitFeeds: number;
        spikeVirusFeedSplitMass: number;
        spikeVirusFeedSplitDistance: number;
        spikeVirusFeedSplitSpeed: number;
    };
    hud: {
        showFps: boolean;
        showMinimap: boolean;
        showLeaderboard: boolean;
        developerMode: boolean;
    };
    audio: GameAudioDebugState;
    match: {
        modeId: LobbyModeId;
        modeName: string;
        timed: boolean;
        durationSeconds: number;
        remainingSeconds: number;
        isFinished: boolean;
        winnerLabel: string;
        playerWon: boolean;
        bestMassRecord: number;
        playerRank: number;
        playerRankTheme: MatchRankTheme;
        top3: MatchTop3Entry[];
        settlementStage: SettlementStage;
        rewardBreakdown: MatchRewardBreakdown | null;
        progressionBefore: PlayerProgression | null;
        progressionAfter: PlayerProgression | null;
        leveledUp: boolean;
    };
}

export type DebugMatchWinner = 'auto' | 'player' | 'bot' | 'teamA' | 'teamB';

export interface DebugMatchFinishOptions {
    winner?: DebugMatchWinner;
    playerMass?: number;
    forceNewRecord?: boolean;
    subtitle?: string;
}

export interface GameSession {
    mount(root: HTMLElement): void;
    startNewGame(): void;
    stop(): void;
    destroy(): void;
    applySettings(settings: GameSettings): void;
    getSnapshot(): GameSessionSnapshot;
    advanceTime(ms: number): void;
    debugFinishMatch(options?: DebugMatchFinishOptions): void;
    debugSetBestMassRecord(value: number): void;
}

interface CreateGameSessionOptions {
    settings: GameSettings;
    modeId: LobbyModeId;
    onReturnToLobby: () => void;
    onOpenSettings: () => void;
}

interface SessionHudRefs {
    root: HTMLDivElement;
    scoreEl: HTMLDivElement;
    massEl: HTMLDivElement;
    fpsEl: HTMLDivElement;
    gameTimerEl: HTMLDivElement;
    leaderboardContainer: HTMLDivElement;
    lbList: HTMLDivElement;
    minimapContainer: HTMLDivElement;
    minimapCanvas: HTMLCanvasElement;
    minimapCtx: CanvasRenderingContext2D;
    debugContainer: HTMLDivElement;
    toolboxHost: HTMLDivElement;
    massInput: HTMLInputElement;
    foodInput: HTMLInputElement;
    virusInput: HTMLInputElement;
    modeBadgeEl: HTMLDivElement;
    resultOverlay: HTMLDivElement;
    resultTitleEl: HTMLHeadingElement;
    resultSubEl: HTMLDivElement;
    resultRankMainEl: HTMLElement;
    resultPlayerRankCardEl: HTMLDivElement;
    resultPlayerRankHeadEl: HTMLElement;
    resultPlayerRankEl: HTMLElement;
    resultPlayerRankMassEl: HTMLElement;
    resultPodiumItems: Array<{
        rank: 1 | 2 | 3;
        root: HTMLElement;
        nameEl: HTMLElement;
        massEl: HTMLElement;
    }>;
    resultWinnerEl: HTMLDivElement;
    resultMassEl: HTMLDivElement;
    resultBestEl: HTMLDivElement;
    resultRewardXpEl: HTMLDivElement;
    resultRewardCoinsEl: HTMLDivElement;
    resultRewardRecordEl: HTMLDivElement;
    resultGrowthLevelEl: HTMLDivElement;
    resultGrowthMetaEl: HTMLDivElement;
    resultGrowthFillEl: HTMLDivElement;
    resultRecordBannerEl: HTMLDivElement;
    resultBallEl: HTMLDivElement;
    resultActions: {
        lobby: HTMLButtonElement;
        replay: HTMLButtonElement;
    };
}

export function createGameSession(options: CreateGameSessionOptions): GameSession {
    let settings = { ...options.settings };
    const modeConfig = MATCH_MODE_CONFIG[options.modeId] ?? MATCH_MODE_CONFIG.classic;

    let mountRoot: HTMLElement | null = null;
    let sessionRoot: HTMLDivElement | null = null;
    let worldRoot: HTMLDivElement | null = null;
    let hudRefs: SessionHudRefs | null = null;

    let input: Input | null = null;
    let camera: Camera | null = null;
    let renderer: RenderSystem | null = null;
    let abilitySystem: AbilitySystem | null = null;
    let physics: PhysicsSystem | null = null;
    let aiSystem: AISystem | null = null;
    let quadTree: QuadTree | null = null;
    let player: Player | null = null;
    let bots: Bot[] = [];
    let foods: Blob[] = [];
    let viruses: Virus[] = [];
    let gameLoop: GameLoop | null = null;
    let tuningToolbox: TuningToolbox | null = null;
    let audioManager: GameAudioManager | null = null;

    let targetFoodCount = DEFAULT_FOOD_COUNT;
    let targetVirusCount = DEFAULT_VIRUS_COUNT;
    let gameStartTime = 0;
    let lastFrameTime = performance.now();
    let frameCount = 0;
    let fps = 60;
    let isRunning = false;
    let matchFinished = false;
    let winnerLabel = '';
    let playerWon = false;
    let playerRank = 0;
    let playerRankTheme: MatchRankTheme = 'normal';
    let top3Result: MatchTop3Entry[] = [];
    let bestMassRecord = loadBestMassRecord();
    let lastPlayerSpikeEventId = 0;
    let settlementStage: SettlementStage = 'hidden';
    let settlementElapsedMs = 0;
    let settlementAnimationFrameId: number | null = null;
    let settlementLastFrameTime = 0;
    let settlementTiming: SettlementTiming = FULL_SETTLEMENT_TIMING;
    let settlementRewardBreakdown: MatchRewardBreakdown | null = null;
    let settlementProgressionBefore: PlayerProgression | null = null;
    let settlementProgressionAfter: PlayerProgression | null = null;
    let settlementLeveledUp = false;

    function ensureMounted() {
        if (!sessionRoot || !worldRoot || !hudRefs) {
            throw new Error('Game session must be mounted before use.');
        }
    }

    function loadBestMassRecord(): number {
        try {
            const raw = window.localStorage.getItem(BEST_MASS_RECORD_KEY);
            const parsed = raw ? Number.parseInt(raw, 10) : 0;
            const progressionBest = loadPlayerProgression().bestMass;
            const localBest = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
            return Math.max(localBest, progressionBest);
        } catch {
            return 0;
        }
    }

    function saveBestMassRecord(value: number) {
        try {
            const safeValue = Math.max(0, Math.floor(value));
            window.localStorage.setItem(BEST_MASS_RECORD_KEY, String(safeValue));
            const progression = loadPlayerProgression();
            if (safeValue > progression.bestMass) {
                progression.bestMass = safeValue;
                savePlayerProgression(progression);
            }
        } catch (error) {
            console.error('Failed to persist best mass record:', error);
        }
    }

    function debugSetBestMassRecord(value: number) {
        if (!Number.isFinite(value)) {
            return;
        }
        bestMassRecord = Math.max(0, Math.floor(value));
        saveBestMassRecord(bestMassRecord);
        const progression = loadPlayerProgression();
        progression.bestMass = Math.max(progression.bestMass, bestMassRecord);
        savePlayerProgression(progression);
    }

    function getElapsedSeconds(now = performance.now()): number {
        if (gameStartTime === 0) {
            return 0;
        }
        return Math.max(0, Math.floor((now - gameStartTime) / 1000));
    }

    function getRemainingSeconds(now = performance.now()): number {
        if (!modeConfig.timed) {
            return 0;
        }
        return Math.max(0, modeConfig.durationSeconds - getElapsedSeconds(now));
    }

    function resolvePlayerDisplayName(rawName: string): string {
        const trimmed = rawName.trim();
        return trimmed.length > 0 ? trimmed : '未命名玩家';
    }

    function getControllerDisplayName(controller: Player | Bot): string {
        return controller === player
            ? resolvePlayerDisplayName(settings.playerName)
            : (controller as Bot).name;
    }

    function getRankTheme(rank: number): MatchRankTheme {
        if (rank === 1) {
            return 'gold';
        }
        if (rank === 2) {
            return 'silver';
        }
        if (rank === 3) {
            return 'bronze';
        }
        return 'normal';
    }

    function buildRankedEntries(playerMassOverride: number | null = null): RankedControllerEntry[] {
        if (!player) {
            return [];
        }

        return [player, ...bots]
            .map((controller) => {
                const isPlayerController = controller === player;
                return {
                    controller,
                    mass: isPlayerController && playerMassOverride !== null
                        ? playerMassOverride
                        : getControllerMass(controller),
                    isPlayer: isPlayerController,
                    name: getControllerDisplayName(controller)
                };
            })
            .sort((a, b) => b.mass - a.mass);
    }

    function getActiveSettlementTiming(): SettlementTiming {
        return settings.reducedMotion ? REDUCED_SETTLEMENT_TIMING : FULL_SETTLEMENT_TIMING;
    }

    function resolveSettlementStage(elapsedMs: number, timing: SettlementTiming): SettlementStage {
        if (elapsedMs <= timing.introEnd) {
            return 'intro';
        }
        if (elapsedMs <= timing.rankEnd) {
            return 'rank';
        }
        if (elapsedMs <= timing.heroEnd) {
            return 'hero';
        }
        if (elapsedMs <= timing.rewardsEnd) {
            return 'rewards';
        }
        return 'actions';
    }

    function setSettlementActionsEnabled(enabled: boolean) {
        if (!hudRefs) {
            return;
        }
        hudRefs.resultActions.lobby.disabled = !enabled;
        hudRefs.resultActions.replay.disabled = !enabled;
        hudRefs.resultOverlay.classList.toggle('is-actions-ready', enabled);
    }

    function stopSettlementAnimation() {
        if (settlementAnimationFrameId !== null) {
            window.cancelAnimationFrame(settlementAnimationFrameId);
            settlementAnimationFrameId = null;
        }
        settlementLastFrameTime = 0;
    }

    function setSettlementStage(nextStage: SettlementStage) {
        if (!hudRefs || settlementStage === nextStage) {
            return;
        }
        settlementStage = nextStage;
        hudRefs.resultOverlay.dataset.settlementStage = nextStage;
        setSettlementActionsEnabled(nextStage === 'actions');
    }

    function applySettlementRewardProgress(progress: number) {
        if (!hudRefs || !settlementRewardBreakdown) {
            return;
        }

        const clampedProgress = Math.max(0, Math.min(1, progress));
        const burstProgress = 1 - Math.pow(1 - clampedProgress, 2.35);
        const smoothProgress = 1 - Math.pow(1 - clampedProgress, 1.6);
        const reward = settlementRewardBreakdown;
        const xpValue = Math.round(reward.totalXp * burstProgress);
        const coinValue = Math.round(reward.totalCoins * burstProgress);
        const massValue = Math.round(reward.playerMass * smoothProgress);
        const bestValue = Math.round(bestMassRecord * smoothProgress);

        hudRefs.resultRewardXpEl.textContent = `+${xpValue}`;
        hudRefs.resultRewardCoinsEl.textContent = `+${coinValue}`;
        hudRefs.resultMassEl.textContent = `${massValue} kg`;
        hudRefs.resultBestEl.textContent = `${bestValue} kg`;

        const recordXp = Math.round(reward.recordBonusXp * burstProgress);
        const recordCoins = Math.round(reward.recordBonusCoins * burstProgress);
        if (recordXp > 0 || recordCoins > 0) {
            hudRefs.resultRewardRecordEl.textContent = `+${recordXp} XP / +${recordCoins} 金币`;
        } else {
            hudRefs.resultRewardRecordEl.textContent = '未触发';
        }

        const progressionAfter = settlementProgressionAfter;
        if (progressionAfter) {
            const requiredXp = getRequiredXpForLevel(progressionAfter.level);
            const xpPreview = Math.round(progressionAfter.currentXp * smoothProgress);
            const fillRatio = requiredXp <= 0 ? 0 : Math.max(0, Math.min(1, xpPreview / requiredXp));
            hudRefs.resultGrowthLevelEl.textContent = `Lv.${progressionAfter.level}`;
            hudRefs.resultGrowthMetaEl.textContent = `${xpPreview} / ${requiredXp} XP · ${progressionAfter.totalWins} 胜 / ${progressionAfter.totalMatches} 局`;
            hudRefs.resultGrowthFillEl.style.width = `${(fillRatio * 100).toFixed(2)}%`;
        }
    }

    function refreshSettlementTimelineVisuals() {
        if (!hudRefs) {
            return;
        }

        const stage = resolveSettlementStage(settlementElapsedMs, settlementTiming);
        setSettlementStage(stage);

        if (stage === 'intro' || stage === 'rank' || stage === 'hero') {
            applySettlementRewardProgress(0);
            return;
        }

        if (stage === 'rewards') {
            const rewardSpan = Math.max(1, settlementTiming.rewardsEnd - settlementTiming.heroEnd);
            const rewardProgress = (settlementElapsedMs - settlementTiming.heroEnd) / rewardSpan;
            applySettlementRewardProgress(rewardProgress);
            return;
        }

        applySettlementRewardProgress(1);
    }

    function advanceSettlementTimeline(ms: number) {
        if (!matchFinished || settlementStage === 'hidden') {
            return;
        }
        settlementElapsedMs = Math.min(settlementTiming.total, settlementElapsedMs + Math.max(0, ms));
        refreshSettlementTimelineVisuals();
        if (settlementElapsedMs >= settlementTiming.total) {
            setSettlementStage('actions');
            stopSettlementAnimation();
        }
    }

    function tickSettlementAnimation(now: number) {
        if (settlementLastFrameTime === 0) {
            settlementLastFrameTime = now;
        }

        const dt = now - settlementLastFrameTime;
        settlementLastFrameTime = now;
        advanceSettlementTimeline(dt);

        if (settlementStage !== 'actions') {
            settlementAnimationFrameId = window.requestAnimationFrame(tickSettlementAnimation);
            return;
        }

        settlementAnimationFrameId = null;
    }

    function startSettlementTimeline() {
        if (!hudRefs) {
            return;
        }

        stopSettlementAnimation();
        settlementTiming = getActiveSettlementTiming();
        settlementElapsedMs = 0;
        settlementStage = 'hidden';
        hudRefs.resultOverlay.dataset.settlementStage = 'intro';
        setSettlementStage('intro');
        applySettlementRewardProgress(0);
        settlementAnimationFrameId = window.requestAnimationFrame(tickSettlementAnimation);
    }

    function createHud(): SessionHudRefs {
        const root = document.createElement('div');
        root.className = 'game-hud';

        const statsPanel = document.createElement('div');
        statsPanel.className = 'hud-panel hud-stats';
        root.appendChild(statsPanel);

        const scoreEl = document.createElement('div');
        scoreEl.className = 'hud-score';
        statsPanel.appendChild(scoreEl);

        const massEl = document.createElement('div');
        massEl.className = 'hud-mass';
        statsPanel.appendChild(massEl);

        const fpsEl = document.createElement('div');
        fpsEl.className = 'hud-fps';
        statsPanel.appendChild(fpsEl);

        const timerWrap = document.createElement('div');
        timerWrap.className = 'hud-panel hud-timer';
        root.appendChild(timerWrap);

        const gameTimerEl = document.createElement('div');
        gameTimerEl.className = 'hud-timer-value';
        timerWrap.appendChild(gameTimerEl);

        const modeBadgeEl = document.createElement('div');
        modeBadgeEl.className = 'hud-timer-mode';
        modeBadgeEl.textContent = modeConfig.name;
        timerWrap.appendChild(modeBadgeEl);

        const actionBar = document.createElement('div');
        actionBar.className = 'hud-action-bar';
        root.appendChild(actionBar);

        const lobbyButton = document.createElement('button');
        lobbyButton.type = 'button';
        lobbyButton.className = 'hud-action-button';
        lobbyButton.textContent = '返回大厅';
        lobbyButton.addEventListener('click', () => {
            stop();
            options.onReturnToLobby();
        });
        actionBar.appendChild(lobbyButton);

        const settingsButton = document.createElement('button');
        settingsButton.type = 'button';
        settingsButton.className = 'hud-action-button hud-action-button--secondary';
        settingsButton.textContent = '设置';
        settingsButton.addEventListener('click', () => {
            options.onOpenSettings();
        });
        actionBar.appendChild(settingsButton);

        const leaderboardContainer = document.createElement('div');
        leaderboardContainer.className = 'hud-panel hud-leaderboard';
        root.appendChild(leaderboardContainer);

        const lbTitle = document.createElement('div');
        lbTitle.className = 'hud-leaderboard-title';
        lbTitle.textContent = '排行榜';
        leaderboardContainer.appendChild(lbTitle);

        const lbList = document.createElement('div');
        lbList.className = 'hud-leaderboard-list';
        leaderboardContainer.appendChild(lbList);

        const minimapContainer = document.createElement('div');
        minimapContainer.className = 'hud-panel hud-minimap';
        root.appendChild(minimapContainer);

        const minimapCanvas = document.createElement('canvas');
        minimapCanvas.width = 150;
        minimapCanvas.height = 150;
        minimapContainer.appendChild(minimapCanvas);

        const debugContainer = document.createElement('div');
        debugContainer.className = 'hud-panel hud-debug';
        root.appendChild(debugContainer);

        debugContainer.innerHTML = `
            <div class="hud-debug-title">Debug / Testing</div>
            <div class="hud-debug-row">
                <input class="hud-debug-input" data-field="mass" type="number" value="100" />
                <button class="hud-debug-button" data-action="mass">Set Mass</button>
            </div>
            <div class="hud-debug-row">
                <input class="hud-debug-input" data-field="food" type="number" value="${DEFAULT_FOOD_COUNT}" />
                <button class="hud-debug-button" data-action="food">Set Food</button>
            </div>
            <div class="hud-debug-row">
                <input class="hud-debug-input" data-field="virus" type="number" value="${DEFAULT_VIRUS_COUNT}" />
                <button class="hud-debug-button" data-action="virus">Set Virus</button>
            </div>
            <div class="hud-debug-divider"></div>
            <div class="hud-debug-title hud-debug-title--small">结算调试接口</div>
            <div class="hud-debug-row hud-debug-row--compact">
                <button class="hud-debug-button" data-action="finish-auto">结束当前局</button>
                <button class="hud-debug-button" data-action="finish-win">我方胜利</button>
            </div>
            <div class="hud-debug-row hud-debug-row--compact">
                <button class="hud-debug-button" data-action="finish-lose">我方失败</button>
                <button class="hud-debug-button" data-action="finish-record">新纪录庆祝</button>
            </div>
            <div class="hud-debug-row">
                <input class="hud-debug-input" data-field="record" type="number" value="${bestMassRecord}" />
                <button class="hud-debug-button" data-action="record-set">设纪录</button>
            </div>
            <div class="hud-debug-row hud-debug-row--compact">
                <button class="hud-debug-button" data-action="record-reset">清空纪录</button>
                <button class="hud-debug-button" data-action="copy-apis">复制接口</button>
            </div>
            <div class="hud-debug-tip" data-debug-tip>开发模式接口：结束当前局、强制胜负、新纪录预览、历史纪录与成长读写。</div>
            <div class="hud-debug-divider"></div>
            <div class="hud-toolbox-host"></div>
        `;

        const massInput = debugContainer.querySelector<HTMLInputElement>('[data-field="mass"]');
        const foodInput = debugContainer.querySelector<HTMLInputElement>('[data-field="food"]');
        const virusInput = debugContainer.querySelector<HTMLInputElement>('[data-field="virus"]');
        const recordInput = debugContainer.querySelector<HTMLInputElement>('[data-field="record"]');
        const toolboxHost = debugContainer.querySelector<HTMLDivElement>('.hud-toolbox-host');
        const debugTip = debugContainer.querySelector<HTMLDivElement>('[data-debug-tip]');

        if (!massInput || !foodInput || !virusInput || !recordInput || !toolboxHost || !debugTip) {
            throw new Error('Failed to initialize debug inputs.');
        }

        const setDebugTip = (text: string) => {
            debugTip.textContent = text;
        };

        debugContainer.querySelector<HTMLButtonElement>('[data-action="mass"]')?.addEventListener('click', (event) => {
            (event.currentTarget as HTMLButtonElement | null)?.blur();
            const val = Number.parseInt(massInput.value, 10);
            if (!player || Number.isNaN(val) || val <= 0 || player.cells.length === 0) {
                return;
            }

            player.cells[0].mass = Math.max(gameplayTuning.limits.min_cell_mass, val);
            player.cells[0].updateRadiusFromMass();
            setDebugTip(`已设置主球质量：${Math.floor(player.cells[0].mass)} kg`);
        });

        debugContainer.querySelector<HTMLButtonElement>('[data-action="food"]')?.addEventListener('click', (event) => {
            (event.currentTarget as HTMLButtonElement | null)?.blur();
            const val = Number.parseInt(foodInput.value, 10);
            if (!Number.isNaN(val) && val >= 0) {
                targetFoodCount = val;
                setDebugTip(`食物目标数量已更新：${targetFoodCount}`);
            }
        });

        debugContainer.querySelector<HTMLButtonElement>('[data-action="virus"]')?.addEventListener('click', (event) => {
            (event.currentTarget as HTMLButtonElement | null)?.blur();
            const val = Number.parseInt(virusInput.value, 10);
            if (!Number.isNaN(val) && val >= 0) {
                targetVirusCount = val;
                setDebugTip(`刺球目标数量已更新：${targetVirusCount}`);
            }
        });

        debugContainer.querySelector<HTMLButtonElement>('[data-action="finish-auto"]')?.addEventListener('click', (event) => {
            (event.currentTarget as HTMLButtonElement | null)?.blur();
            debugFinishMatch();
            setDebugTip('已触发结算：按当前排名统计。');
        });

        debugContainer.querySelector<HTMLButtonElement>('[data-action="finish-win"]')?.addEventListener('click', (event) => {
            (event.currentTarget as HTMLButtonElement | null)?.blur();
            debugFinishMatch({
                winner: modeConfig.teamMode ? 'teamA' : 'player',
                subtitle: '开发者强制结算：我方胜利。'
            });
            setDebugTip('已触发结算：我方胜利。');
        });

        debugContainer.querySelector<HTMLButtonElement>('[data-action="finish-lose"]')?.addEventListener('click', (event) => {
            (event.currentTarget as HTMLButtonElement | null)?.blur();
            debugFinishMatch({
                winner: modeConfig.teamMode ? 'teamB' : 'bot',
                subtitle: '开发者强制结算：我方失败。'
            });
            setDebugTip('已触发结算：我方失败。');
        });

        debugContainer.querySelector<HTMLButtonElement>('[data-action="finish-record"]')?.addEventListener('click', (event) => {
            (event.currentTarget as HTMLButtonElement | null)?.blur();
            const baseMass = player ? getControllerMass(player) : gameplayTuning.limits.min_cell_mass;
            const previewMass = Math.max(baseMass, bestMassRecord + 500);
            debugFinishMatch({
                winner: modeConfig.teamMode ? 'teamA' : 'player',
                playerMass: previewMass,
                forceNewRecord: true,
                subtitle: '开发者强制结算：新纪录庆祝预览。'
            });
            setDebugTip(`已触发新纪录结算预览：${Math.floor(previewMass)} kg`);
        });

        debugContainer.querySelector<HTMLButtonElement>('[data-action="record-set"]')?.addEventListener('click', (event) => {
            (event.currentTarget as HTMLButtonElement | null)?.blur();
            const val = Number.parseInt(recordInput.value, 10);
            if (Number.isNaN(val) || val < 0) {
                return;
            }
            debugSetBestMassRecord(val);
            recordInput.value = String(bestMassRecord);
            setDebugTip(`历史纪录已设置为：${bestMassRecord} kg`);
        });

        debugContainer.querySelector<HTMLButtonElement>('[data-action="record-reset"]')?.addEventListener('click', (event) => {
            (event.currentTarget as HTMLButtonElement | null)?.blur();
            debugSetBestMassRecord(0);
            recordInput.value = '0';
            setDebugTip('历史纪录已清空。');
        });

        debugContainer.querySelector<HTMLButtonElement>('[data-action="copy-apis"]')?.addEventListener('click', async (event) => {
            (event.currentTarget as HTMLButtonElement | null)?.blur();
            const apiText = [
                'window.debug_finish_match(mode?)',
                '  mode: auto | win | lose | record',
                'window.debug_set_best_record(value)',
                'window.debug_reset_progression()',
                'window.debug_set_progression(json)',
                'window.render_game_to_text()',
                'window.advanceTime(ms)'
            ].join('\n');
            try {
                await navigator.clipboard.writeText(apiText);
                setDebugTip('调试接口已复制到剪贴板。');
            } catch {
                setDebugTip('复制失败，请手动查看控制台接口：window.debug_finish_match / window.debug_set_best_record / window.debug_set_progression');
            }
        });

        const resultOverlay = document.createElement('div');
        resultOverlay.className = 'match-result-overlay';
        resultOverlay.innerHTML = `
            <div class="match-result-panel">
                <div class="match-result-cinematic-bg" aria-hidden="true">
                    <span class="match-result-bg-particle"></span>
                    <span class="match-result-bg-particle"></span>
                    <span class="match-result-bg-particle"></span>
                    <span class="match-result-bg-particle"></span>
                </div>
                <div class="match-result-kicker" data-result-kicker>对局结算</div>
                <h2 class="match-result-title" data-result-title>Victory</h2>
                <div class="match-result-rank-main-headline" data-result-rank-main>第 1 名</div>
                <div class="match-result-subtitle" data-result-subtitle>正在统计结果...</div>
                <div class="match-result-rank-stage">
                    <div class="match-result-rank-head">
                        <span>${renderLobbyIcon('crown', 'match-result-rank-head-icon')} 名次结算</span>
                        <strong data-result-player-rank>第 1 名</strong>
                    </div>
                    <div class="match-result-podium">
                        <article class="match-result-podium-item is-silver" data-result-podium-item data-rank="2">
                            <div class="match-result-podium-badge">
                                ${renderLobbyIcon('rank_silver', 'match-result-podium-icon')}
                            </div>
                            <div class="match-result-podium-meta">
                                <strong data-result-podium-name>--</strong>
                                <span data-result-podium-mass>0 kg</span>
                            </div>
                        </article>
                        <article class="match-result-podium-item is-gold" data-result-podium-item data-rank="1">
                            <div class="match-result-podium-badge">
                                ${renderLobbyIcon('rank_gold', 'match-result-podium-icon')}
                            </div>
                            <div class="match-result-phoenix-wings" aria-hidden="true">
                                <span></span>
                                <span></span>
                            </div>
                            <div class="match-result-podium-meta">
                                <strong data-result-podium-name>--</strong>
                                <span data-result-podium-mass>0 kg</span>
                            </div>
                        </article>
                        <article class="match-result-podium-item is-bronze" data-result-podium-item data-rank="3">
                            <div class="match-result-podium-badge">
                                ${renderLobbyIcon('rank_bronze', 'match-result-podium-icon')}
                            </div>
                            <div class="match-result-podium-meta">
                                <strong data-result-podium-name>--</strong>
                                <span data-result-podium-mass>0 kg</span>
                            </div>
                        </article>
                    </div>
                    <div class="match-result-player-rank-card" data-result-player-rank-card>
                        <span>我的名次</span>
                        <strong data-result-player-rank-echo>第 1 名</strong>
                        <em data-result-player-rank-mass>0 kg</em>
                    </div>
                </div>
                <div class="match-result-ball-stage">
                    <div class="match-result-burst"></div>
                    <div class="match-result-energy-lines"></div>
                    <div class="match-result-ball" data-result-ball></div>
                    <div class="match-record-badge" data-result-record-banner>
                        ${renderLobbyIcon('record', 'match-result-record-icon')}
                        <span>新纪录</span>
                    </div>
                </div>
                <div class="match-result-rewards">
                    <div class="match-result-reward-card">
                        <span class="match-result-reward-label">
                            ${renderLobbyIcon('xp', 'match-result-reward-icon')}
                            经验奖励
                        </span>
                        <strong data-result-reward-xp>+0</strong>
                    </div>
                    <div class="match-result-reward-card">
                        <span class="match-result-reward-label">
                            ${renderLobbyIcon('coin', 'match-result-reward-icon')}
                            金币奖励
                        </span>
                        <strong data-result-reward-coins>+0</strong>
                    </div>
                    <div class="match-result-reward-card">
                        <span class="match-result-reward-label">
                            ${renderLobbyIcon('mode_classic', 'match-result-reward-icon')}
                            本局体重
                        </span>
                        <strong data-result-mass>0 kg</strong>
                    </div>
                    <div class="match-result-reward-card">
                        <span class="match-result-reward-label">
                            ${renderLobbyIcon('record', 'match-result-reward-icon')}
                            历史纪录
                        </span>
                        <strong data-result-best>0 kg</strong>
                    </div>
                    <div class="match-result-reward-card">
                        <span class="match-result-reward-label">
                            ${renderLobbyIcon('victory', 'match-result-reward-icon')}
                            胜出方
                        </span>
                        <strong data-result-winner>--</strong>
                    </div>
                    <div class="match-result-reward-card">
                        <span class="match-result-reward-label">
                            ${renderLobbyIcon('record', 'match-result-reward-icon')}
                            纪录加成
                        </span>
                        <strong data-result-reward-record>未触发</strong>
                    </div>
                </div>
                <div class="match-result-growth">
                    <div class="match-result-growth-head">
                        <div class="match-result-growth-level" data-result-growth-level>Lv.1</div>
                        <div class="match-result-growth-meta" data-result-growth-meta>0 / 208 XP</div>
                    </div>
                    <div class="match-result-growth-track">
                        <div class="match-result-growth-fill" data-result-growth-fill></div>
                    </div>
                </div>
                <div class="match-result-actions">
                    <button type="button" class="hud-action-button hud-action-button--secondary" data-result-lobby>返回大厅</button>
                    <button type="button" class="hud-action-button match-result-replay" data-result-replay>再来一局</button>
                </div>
            </div>
        `;
        root.appendChild(resultOverlay);

        const resultTitleEl = resultOverlay.querySelector<HTMLHeadingElement>('[data-result-title]');
        const resultSubEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-subtitle]');
        const resultRankMainEl = resultOverlay.querySelector<HTMLElement>('[data-result-rank-main]');
        const resultPlayerRankCardEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-player-rank-card]');
        const resultPlayerRankEl = resultOverlay.querySelector<HTMLElement>('[data-result-player-rank-echo]');
        const resultPlayerRankHeadEl = resultOverlay.querySelector<HTMLElement>('[data-result-player-rank]');
        const resultPlayerRankMassEl = resultOverlay.querySelector<HTMLElement>('[data-result-player-rank-mass]');
        const resultWinnerEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-winner]');
        const resultMassEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-mass]');
        const resultBestEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-best]');
        const resultRewardXpEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-reward-xp]');
        const resultRewardCoinsEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-reward-coins]');
        const resultRewardRecordEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-reward-record]');
        const resultGrowthLevelEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-growth-level]');
        const resultGrowthMetaEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-growth-meta]');
        const resultGrowthFillEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-growth-fill]');
        const resultRecordBannerEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-record-banner]');
        const resultBallEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-ball]');
        const resultLobbyButton = resultOverlay.querySelector<HTMLButtonElement>('[data-result-lobby]');
        const resultReplayButton = resultOverlay.querySelector<HTMLButtonElement>('[data-result-replay]');
        const resultPodiumItems = Array.from(resultOverlay.querySelectorAll<HTMLElement>('[data-result-podium-item]'))
            .map((item) => {
                const rankValue = Number.parseInt(item.dataset.rank ?? '', 10);
                const nameEl = item.querySelector<HTMLElement>('[data-result-podium-name]');
                const massEl = item.querySelector<HTMLElement>('[data-result-podium-mass]');
                if (!nameEl || !massEl || !Number.isFinite(rankValue) || rankValue < 1 || rankValue > 3) {
                    return null;
                }
                return {
                    rank: rankValue as 1 | 2 | 3,
                    root: item,
                    nameEl,
                    massEl
                };
            })
            .filter((item): item is {
                rank: 1 | 2 | 3;
                root: HTMLElement;
                nameEl: HTMLElement;
                massEl: HTMLElement;
            } => item !== null);

        if (
            !resultTitleEl
            || !resultSubEl
            || !resultRankMainEl
            || !resultPlayerRankCardEl
            || !resultPlayerRankEl
            || !resultPlayerRankHeadEl
            || !resultPlayerRankMassEl
            || !resultWinnerEl
            || !resultMassEl
            || !resultBestEl
            || !resultRewardXpEl
            || !resultRewardCoinsEl
            || !resultRewardRecordEl
            || !resultGrowthLevelEl
            || !resultGrowthMetaEl
            || !resultGrowthFillEl
            || !resultRecordBannerEl
            || !resultBallEl
            || !resultLobbyButton
            || !resultReplayButton
            || resultPodiumItems.length !== 3
        ) {
            throw new Error('Failed to initialize match result overlay.');
        }

        resultLobbyButton.addEventListener('click', () => {
            hideMatchResultOverlay();
            stop();
            options.onReturnToLobby();
        });

        resultReplayButton.addEventListener('click', () => {
            hideMatchResultOverlay();
            startNewGame();
        });

        sessionRoot?.appendChild(root);

        const minimapCtx = minimapCanvas.getContext('2d');
        if (!minimapCtx) {
            throw new Error('Failed to initialize minimap context.');
        }

        return {
            root,
            scoreEl,
            massEl,
            fpsEl,
            gameTimerEl,
            leaderboardContainer,
            lbList,
            minimapContainer,
            minimapCanvas,
            minimapCtx,
            debugContainer,
            toolboxHost,
            massInput,
            foodInput,
            virusInput,
            modeBadgeEl,
            resultOverlay,
            resultTitleEl,
            resultSubEl,
            resultRankMainEl,
            resultPlayerRankCardEl,
            resultPlayerRankHeadEl,
            resultPlayerRankEl,
            resultPlayerRankMassEl,
            resultPodiumItems,
            resultWinnerEl,
            resultMassEl,
            resultBestEl,
            resultRewardXpEl,
            resultRewardCoinsEl,
            resultRewardRecordEl,
            resultGrowthLevelEl,
            resultGrowthMetaEl,
            resultGrowthFillEl,
            resultRecordBannerEl,
            resultBallEl,
            resultActions: {
                lobby: resultLobbyButton,
                replay: resultReplayButton
            }
        };
    }

    function initializeWorld() {
        quadTree = new QuadTree(
            new Rectangle(WORLD_SIZE / 2, WORLD_SIZE / 2, WORLD_SIZE / 2, WORLD_SIZE / 2),
            10
        );

        player = new Player(WORLD_SIZE / 2, WORLD_SIZE / 2);
        player.displayName = resolvePlayerDisplayName(settings.playerName);

        bots = [];
        for (let i = 0; i < BOT_COUNT; i += 1) {
            bots.push(new Bot(Math.random() * WORLD_SIZE, Math.random() * WORLD_SIZE));
        }

        foods = [];
        for (let i = 0; i < targetFoodCount; i += 1) {
            foods.push(new Food(Math.random() * WORLD_SIZE, Math.random() * WORLD_SIZE));
        }

        viruses = [];
        for (let i = 0; i < targetVirusCount; i += 1) {
            viruses.push(new Virus(Math.random() * WORLD_SIZE, Math.random() * WORLD_SIZE));
        }

        gameStartTime = performance.now();
        lastFrameTime = performance.now();
        frameCount = 0;
        fps = 60;
        matchFinished = false;
        winnerLabel = '';
        playerWon = false;
        playerRank = 0;
        playerRankTheme = 'normal';
        top3Result = [];
        lastPlayerSpikeEventId = 0;
        settlementRewardBreakdown = null;
        settlementProgressionBefore = null;
        settlementProgressionAfter = null;
        settlementLeveledUp = false;
        settlementStage = 'hidden';
        settlementElapsedMs = 0;

        input?.setMouseScreenPosition(window.innerWidth / 2, window.innerHeight / 2);

        if (camera && player) {
            camera.position = player.getCenter();
            camera.scale = 1;
        }

        hideMatchResultOverlay();
        syncHud();
    }

    function getControllerMass(controller: { cells: Blob[] }): number {
        return Math.floor(controller.cells.reduce((sum, cell) => sum + cell.mass, 0));
    }

    function hideMatchResultOverlay() {
        if (!hudRefs) {
            return;
        }
        stopSettlementAnimation();
        settlementStage = 'hidden';
        settlementElapsedMs = 0;
        hudRefs.resultOverlay.classList.remove(
            'is-visible',
            'is-record',
            'is-win',
            'is-team-mode',
            'is-level-up',
            'rank-theme-gold',
            'rank-theme-silver',
            'rank-theme-bronze',
            'rank-theme-normal'
        );
        hudRefs.resultOverlay.dataset.settlementStage = 'hidden';
        setSettlementActionsEnabled(false);
    }

    function finalizeTimedMatch(now = performance.now(), debugOptions: DebugMatchFinishOptions = {}) {
        if (matchFinished || !player || !hudRefs) {
            return;
        }

        const forcedWinner = debugOptions.winner ?? 'auto';
        const overridePlayerMass = typeof debugOptions.playerMass === 'number' && Number.isFinite(debugOptions.playerMass)
            ? Math.max(gameplayTuning.limits.min_cell_mass, Math.floor(debugOptions.playerMass))
            : null;
        const rawPlayerMass = getControllerMass(player);
        const playerMass = overridePlayerMass ?? rawPlayerMass;
        const rankedPersonal = buildRankedEntries(playerMass);
        const playerRankIndex = rankedPersonal.findIndex((entry) => entry.isPlayer);
        playerRank = playerRankIndex >= 0 ? playerRankIndex + 1 : rankedPersonal.length + 1;
        playerRankTheme = getRankTheme(playerRank);
        top3Result = [1, 2, 3].map((rankNumber) => {
            const entry = rankedPersonal[rankNumber - 1];
            if (!entry) {
                return {
                    rank: rankNumber as 1 | 2 | 3,
                    name: '虚位以待',
                    mass: 0,
                    isPlayer: false
                };
            }
            return {
                rank: rankNumber as 1 | 2 | 3,
                name: entry.name,
                mass: entry.mass,
                isPlayer: entry.isPlayer
            };
        });

        let resultSubtitle = modeConfig.timed
            ? `${modeConfig.durationSeconds / 60} 分钟结束，按体重排名结算。`
            : '开发者手动结束当前对局，按当前排名结算。';

        if (modeConfig.teamMode) {
            let teamATotal = 0;
            let teamBTotal = 0;

            [player, ...bots].forEach((controller, index) => {
                const mass = controller === player ? playerMass : getControllerMass(controller);
                const isTeamA = index === 0 || index % 2 === 0;
                if (isTeamA) {
                    teamATotal += mass;
                } else {
                    teamBTotal += mass;
                }
            });

            const teamATotalForResult = teamATotal;
            const teamBTotalForResult = teamBTotal;
            const forcedTeam = forcedWinner === 'teamA' || forcedWinner === 'player'
                ? 'teamA'
                : (forcedWinner === 'teamB' || forcedWinner === 'bot' ? 'teamB' : null);
            const winnerIsTeamA = forcedTeam
                ? forcedTeam === 'teamA'
                : teamATotalForResult >= teamBTotalForResult;
            const winnerTeamName = winnerIsTeamA ? '红队' : '蓝队';
            const winnerTeamMass = winnerIsTeamA ? teamATotalForResult : teamBTotalForResult;
            winnerLabel = `${winnerTeamName} ${winnerTeamMass}kg`;
            playerWon = winnerIsTeamA;
            resultSubtitle = modeConfig.timed
                ? `${modeConfig.durationSeconds / 60} 分钟结束，按队伍总质量结算。`
                : '开发者手动结束当前对局，按队伍总质量结算。';
        } else {
            let winner = rankedPersonal[0];
            if (forcedWinner === 'player') {
                winner = rankedPersonal.find((entry) => entry.isPlayer) ?? winner;
            } else if (forcedWinner === 'bot') {
                winner = rankedPersonal.find((entry) => !entry.isPlayer) ?? winner;
            }

            if (winner) {
                winnerLabel = `${winner.name} ${winner.mass}kg`;
                playerWon = winner.isPlayer;
            } else {
                winnerLabel = '未产生胜者';
                playerWon = false;
            }
        }

        if (debugOptions.subtitle?.trim()) {
            resultSubtitle = debugOptions.subtitle.trim();
        }

        const previousBest = bestMassRecord;
        const naturallyNewRecord = playerMass > previousBest;
        const isNewRecord = naturallyNewRecord || Boolean(debugOptions.forceNewRecord);
        const computedBestMass = isNewRecord
            ? (naturallyNewRecord ? playerMass : Math.max(playerMass, previousBest + 1))
            : previousBest;

        settlementRewardBreakdown = computeMatchRewards(playerRank, playerMass, playerWon, isNewRecord);
        const progressionBaseline = loadPlayerProgression();
        const progressionApplied = applyMatchRewardsToProgression({
            ...progressionBaseline,
            bestMass: Math.max(progressionBaseline.bestMass, computedBestMass)
        }, settlementRewardBreakdown);
        settlementProgressionBefore = progressionApplied.before;
        settlementProgressionAfter = progressionApplied.after;
        settlementLeveledUp = progressionApplied.leveledUp;
        savePlayerProgression(progressionApplied.after);

        bestMassRecord = Math.max(computedBestMass, progressionApplied.after.bestMass);
        saveBestMassRecord(bestMassRecord);

        hudRefs.resultTitleEl.textContent = playerWon ? 'Victory!' : 'Battle Over';
        hudRefs.resultSubEl.textContent = resultSubtitle;
        hudRefs.resultRankMainEl.textContent = `第 ${playerRank} 名`;
        hudRefs.resultPlayerRankHeadEl.textContent = `第 ${playerRank} 名`;
        hudRefs.resultPlayerRankEl.textContent = `第 ${playerRank} 名`;
        hudRefs.resultPlayerRankMassEl.textContent = `${playerMass} kg`;
        hudRefs.resultWinnerEl.textContent = winnerLabel;
        hudRefs.resultRewardXpEl.textContent = '+0';
        hudRefs.resultRewardCoinsEl.textContent = '+0';
        hudRefs.resultMassEl.textContent = '0 kg';
        hudRefs.resultBestEl.textContent = '0 kg';
        hudRefs.resultRewardRecordEl.textContent = isNewRecord ? '+0 XP / +0 金币' : '未触发';
        hudRefs.resultGrowthLevelEl.textContent = settlementProgressionAfter
            ? `Lv.${settlementProgressionAfter.level}`
            : 'Lv.1';
        hudRefs.resultGrowthMetaEl.textContent = settlementProgressionAfter
            ? `0 / ${getRequiredXpForLevel(settlementProgressionAfter.level)} XP · ${settlementProgressionAfter.totalWins} 胜 / ${settlementProgressionAfter.totalMatches} 局`
            : '0 / 208 XP';
        hudRefs.resultGrowthFillEl.style.width = '0%';
        hudRefs.resultRecordBannerEl.style.display = isNewRecord ? 'inline-flex' : 'none';
        hudRefs.resultRecordBannerEl.classList.toggle('is-level-up', settlementLeveledUp);

        hudRefs.resultPlayerRankCardEl.classList.remove('is-gold', 'is-silver', 'is-bronze', 'is-normal');
        hudRefs.resultPlayerRankCardEl.classList.add(`is-${playerRankTheme}`);
        hudRefs.resultPodiumItems.forEach((item) => {
            const podiumData = top3Result.find((entry) => entry.rank === item.rank) ?? null;
            const isEmpty = !podiumData || podiumData.mass <= 0;
            item.root.classList.toggle('is-empty', isEmpty);
            item.root.classList.toggle('is-player', Boolean(podiumData?.isPlayer));
            item.nameEl.textContent = podiumData ? podiumData.name : '虚位以待';
            item.massEl.textContent = podiumData && podiumData.mass > 0
                ? `${podiumData.mass} kg`
                : '--';
        });

        const ballScale = Math.max(0, Math.min(1, Math.log(playerMass + 1) / Math.log(16000)));
        const ballSize = 108 + ballScale * 180;
        hudRefs.resultBallEl.style.setProperty('--result-ball-size', `${ballSize.toFixed(0)}px`);
        hudRefs.resultBallEl.style.setProperty('--result-ball-glow', `${(0.42 + ballScale * 0.33).toFixed(2)}`);
        hudRefs.resultBallEl.style.setProperty('--result-ball-energy', `${(0.54 + ballScale * 0.32).toFixed(2)}`);

        hudRefs.resultOverlay.classList.add('is-visible');
        hudRefs.resultOverlay.classList.toggle('is-record', isNewRecord);
        hudRefs.resultOverlay.classList.toggle('is-win', playerWon);
        hudRefs.resultOverlay.classList.toggle('is-team-mode', modeConfig.teamMode);
        hudRefs.resultOverlay.classList.remove('rank-theme-gold', 'rank-theme-silver', 'rank-theme-bronze', 'rank-theme-normal');
        hudRefs.resultOverlay.classList.add(`rank-theme-${playerRankTheme}`);
        hudRefs.resultOverlay.classList.toggle('is-level-up', settlementLeveledUp);
        matchFinished = true;
        stop();

        // Keep snapshot clock stable at match end.
        const frozenElapsedSeconds = modeConfig.timed ? modeConfig.durationSeconds : getElapsedSeconds(now);
        gameStartTime = now - frozenElapsedSeconds * 1000;

        startSettlementTimeline();
    }

    function debugFinishMatch(options: DebugMatchFinishOptions = {}) {
        finalizeTimedMatch(performance.now(), options);
    }

    function syncHud() {
        if (!hudRefs || !player) {
            return;
        }

        hudRefs.scoreEl.innerText = `得分 ${player.score}`;
        const totalMass = Math.floor(player.cells.reduce((sum, cell) => sum + cell.mass, 0));
        hudRefs.massEl.innerText = `质量 ${totalMass} kg`;
        hudRefs.fpsEl.innerText = `FPS ${fps}`;

        const now = performance.now();
        const elapsedSeconds = getElapsedSeconds(now);
        if (modeConfig.timed) {
            const remainingSeconds = getRemainingSeconds(now);
            const minutes = Math.floor(remainingSeconds / 60);
            const seconds = remainingSeconds % 60;
            hudRefs.gameTimerEl.innerText = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            hudRefs.modeBadgeEl.innerText = `${modeConfig.name} · 限时模式`;
        } else {
            const minutes = Math.floor(elapsedSeconds / 60);
            const seconds = elapsedSeconds % 60;
            hudRefs.gameTimerEl.innerText = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            hudRefs.modeBadgeEl.innerText = modeConfig.name;
        }

        hudRefs.leaderboardContainer.style.display = settings.showLeaderboard ? 'block' : 'none';
        hudRefs.minimapContainer.style.display = settings.showMinimap ? 'block' : 'none';
        hudRefs.fpsEl.style.display = settings.showFps ? 'block' : 'none';
        hudRefs.debugContainer.style.display = settings.developerMode ? 'block' : 'none';
    }

    function syncLeaderboard() {
        if (!hudRefs || !player) {
            return;
        }

        const allPlayers = [player, ...bots];
        allPlayers.sort((a, b) => {
            const massA = a.cells.reduce((sum, cell) => sum + cell.mass, 0);
            const massB = b.cells.reduce((sum, cell) => sum + cell.mass, 0);
            return massB - massA;
        });

        hudRefs.lbList.innerHTML = '';
        const playerRank = allPlayers.indexOf(player);
        const inTop = playerRank >= 0 && playerRank < LEADERBOARD_SIZE;

        for (let i = 0; i < Math.min(LEADERBOARD_SIZE, allPlayers.length); i += 1) {
            const current = allPlayers[i];
            const mass = Math.floor(current.cells.reduce((sum, cell) => sum + cell.mass, 0));
            const entry = document.createElement('div');
            entry.className = 'hud-leaderboard-entry';

            if (current === player) {
                entry.classList.add('is-player');
            }

            let rankLabel = `${i + 1}.`;
            if (i === 0) rankLabel = 'No.1';
            if (i === 1) rankLabel = 'No.2';
            if (i === 2) rankLabel = 'No.3';

            const name = current === player
                ? player.displayName
                : (current as Bot).name;

            entry.innerHTML = `<span>${rankLabel} ${name}</span><span>${mass}kg</span>`;
            hudRefs.lbList.appendChild(entry);
        }

        if (!inTop && playerRank !== -1) {
            const separator = document.createElement('div');
            separator.className = 'hud-leaderboard-separator';
            hudRefs.lbList.appendChild(separator);

            const playerMass = Math.floor(player.cells.reduce((sum, cell) => sum + cell.mass, 0));
            const entry = document.createElement('div');
            entry.className = 'hud-leaderboard-entry is-player';
            entry.innerHTML = `<span>${playerRank + 1}. ${player.displayName}</span><span>${playerMass}kg</span>`;
            hudRefs.lbList.appendChild(entry);
        }
    }

    function renderMinimap() {
        if (!hudRefs || !player) {
            return;
        }

        const { minimapCtx } = hudRefs;
        minimapCtx.clearRect(0, 0, 150, 150);

        const playerPos = player.getCenter();
        const minimapX = 5 + (playerPos.x / WORLD_SIZE) * 140;
        const minimapY = 5 + (playerPos.y / WORLD_SIZE) * 140;
        const edgeMargin = 500;

        const showTopEdge = playerPos.y < edgeMargin;
        const showBottomEdge = playerPos.y > WORLD_SIZE - edgeMargin;
        const showLeftEdge = playerPos.x < edgeMargin;
        const showRightEdge = playerPos.x > WORLD_SIZE - edgeMargin;

        if (showTopEdge || showBottomEdge || showLeftEdge || showRightEdge) {
            minimapCtx.strokeStyle = '#ff4d4d';
            minimapCtx.lineWidth = 2;
            minimapCtx.setLineDash([4, 4]);

            if (showTopEdge) {
                minimapCtx.beginPath();
                minimapCtx.moveTo(5, 5);
                minimapCtx.lineTo(145, 5);
                minimapCtx.stroke();
            }

            if (showBottomEdge) {
                minimapCtx.beginPath();
                minimapCtx.moveTo(5, 145);
                minimapCtx.lineTo(145, 145);
                minimapCtx.stroke();
            }

            if (showLeftEdge) {
                minimapCtx.beginPath();
                minimapCtx.moveTo(5, 5);
                minimapCtx.lineTo(5, 145);
                minimapCtx.stroke();
            }

            if (showRightEdge) {
                minimapCtx.beginPath();
                minimapCtx.moveTo(145, 5);
                minimapCtx.lineTo(145, 145);
                minimapCtx.stroke();
            }

            minimapCtx.setLineDash([]);
        }

        minimapCtx.fillStyle = '#10f2a4';
        minimapCtx.beginPath();
        minimapCtx.arc(minimapX, minimapY, 5, 0, Math.PI * 2);
        minimapCtx.fill();

        minimapCtx.strokeStyle = 'rgba(16, 242, 164, 0.6)';
        minimapCtx.lineWidth = 2;
        minimapCtx.stroke();
    }

    function respawnControllers() {
        if (!player) {
            return;
        }

        if (player.cells.length === 0) {
            const startMass = gameplayTuning.limits.min_cell_mass;
            const startRadius = Math.sqrt(startMass) * 3.5;
            const spawnX = Math.random() * (WORLD_SIZE - 1000) + 500;
            const spawnY = Math.random() * (WORLD_SIZE - 1000) + 500;
            const newCell = new Blob(spawnX, spawnY, startRadius, player.color);
            newCell.mass = startMass;
            player.addCell(newCell);
            player.score = 0;
        }

        bots.forEach((bot) => {
            if (bot.cells.length > 0) {
                return;
            }

            const startMass = gameplayTuning.limits.min_cell_mass;
            const startRadius = Math.sqrt(startMass) * 3.5;
            const spawnX = Math.random() * (WORLD_SIZE - 1000) + 500;
            const spawnY = Math.random() * (WORLD_SIZE - 1000) + 500;
            const newCell = new Blob(spawnX, spawnY, startRadius, bot.color);
            newCell.mass = startMass;
            bot.addCell(newCell);
        });
    }

    function update(dt: number) {
        if (!player || !input || !abilitySystem || !physics || !aiSystem || !quadTree || !camera) {
            return;
        }

        if (matchFinished) {
            return;
        }

        respawnControllers();

        const playerCenter = player.getCenter();
        const mouseWorld = input.getMouseWorldPosition();
        if (mouseWorld) {
            player.setAimDirection(mouseWorld.sub(playerCenter));
        }

        const moveDir = input.getMovementDirection(playerCenter);

        if (moveDir) {
            player.updateVelocity(moveDir);
        }

        player.update(dt);

        if (input.isEjecting) {
            const ejectTarget = mouseWorld || playerCenter;
            const ejectCount = abilitySystem.eject(player, foods, ejectTarget);
            if (ejectCount > 0) {
                audioManager?.playEject();
            }
        }

        frameCount += 1;
        const currentTime = performance.now();
        if (currentTime - lastFrameTime >= 1000) {
            fps = frameCount;
            frameCount = 0;
            lastFrameTime = currentTime;
        }

        syncHud();
        syncLeaderboard();

        if (modeConfig.timed && getRemainingSeconds(currentTime) <= 0) {
            finalizeTimedMatch(currentTime);
            return;
        }

        aiSystem.update(bots, player, quadTree, dt, WORLD_SIZE, WORLD_SIZE, abilitySystem);

        foods.forEach((food) => {
            if (food instanceof EjectedMass) {
                food.update(dt, WORLD_SIZE, WORLD_SIZE);
            }
        });

        viruses.forEach((virus) => {
            virus.update(dt);
        });

        const activeBlobs: Blob[] = [
            ...player.cells,
            ...bots.flatMap((bot) => bot.cells)
        ];

        physics.update(activeBlobs, foods as Food[], viruses, quadTree, WORLD_SIZE, WORLD_SIZE, dt);
        abilitySystem.tickRuntime(dt);

        const spikeEventId = abilitySystem.getSpikeEventId(player);
        if (spikeEventId > lastPlayerSpikeEventId) {
            lastPlayerSpikeEventId = spikeEventId;
            audioManager?.playSpikeBurst();
        }

        const foodIndices: number[] = [];
        let foodCount = 0;

        foods.forEach((food, index) => {
            if (!(food instanceof EjectedMass)) {
                foodIndices.push(index);
                foodCount += 1;
            }
        });

        if (foodCount < targetFoodCount) {
            const batch = Math.min(targetFoodCount - foodCount, 20);
            for (let i = 0; i < batch; i += 1) {
                foods.push(new Food(Math.random() * WORLD_SIZE, Math.random() * WORLD_SIZE));
            }
        } else if (foodCount > targetFoodCount + 50) {
            let toRemove = Math.min(foodCount - targetFoodCount, 100);
            for (let i = foodIndices.length - 1; i >= 0 && toRemove > 0; i -= 1) {
                foods.splice(foodIndices[i], 1);
                toRemove -= 1;
            }
        }

        // `targetVirusCount` is baseline spawn target.
        // Feed-split viruses are allowed to exceed baseline so they remain visible.
        if (viruses.length < targetVirusCount && Math.random() < 0.1) {
            viruses.push(new Virus(Math.random() * WORLD_SIZE, Math.random() * WORLD_SIZE));
        } else if (viruses.length > MAX_VIRUS_COUNT) {
            // Safety cap only; do not immediately delete feed-split results.
            const overflow = viruses.length - MAX_VIRUS_COUNT;
            for (let i = 0; i < overflow; i += 1) {
                viruses.pop();
            }
        }

        camera.follow(player, dt);
    }

    function render() {
        if (!renderer || !camera || !quadTree || !player) {
            return;
        }

        const activeRenderer = renderer;
        const activeCamera = camera;

        activeRenderer.clear();
        activeRenderer.drawGrid(activeCamera, settings.reducedMotion);
        activeRenderer.drawWorldBorder(WORLD_SIZE, activeCamera);

        const viewW = activeCamera.viewportWidth / activeCamera.scale;
        const viewH = activeCamera.viewportHeight / activeCamera.scale;
        const viewX = activeCamera.position.x;
        const viewY = activeCamera.position.y;

        const visibleRange = new Rectangle(viewX, viewY, viewW + 100, viewH + 100);
        const visibleEntities = quadTree.query(visibleRange);

        const visibleFoods: Blob[] = [];
        const visibleViruses: Blob[] = [];
        const visibleBlobs: Blob[] = [];

        for (const entity of visibleEntities) {
            if (entity instanceof Food || entity instanceof EjectedMass) {
                visibleFoods.push(entity);
            } else if (entity instanceof Virus) {
                visibleViruses.push(entity);
            } else {
                visibleBlobs.push(entity);
            }
        }

        const playerPos = player.getCenter();
        activeRenderer.drawBoundaryWarnings(playerPos, WORLD_SIZE, activeCamera);

        visibleFoods.forEach((food) => activeRenderer.drawBlob(food, activeCamera));

        const virusThreshold = 432;
        const smallCells = visibleBlobs.filter((blob) => blob.mass < virusThreshold);
        const largeCells = visibleBlobs.filter((blob) => blob.mass >= virusThreshold);

        smallCells.sort((a, b) => a.mass - b.mass);
        smallCells.forEach((blob) => activeRenderer.drawBlob(blob, activeCamera));

        visibleViruses.forEach((virus) => activeRenderer.drawBlob(virus, activeCamera));

        largeCells.sort((a, b) => a.mass - b.mass);
        largeCells.forEach((blob) => activeRenderer.drawBlob(blob, activeCamera));

        renderMinimap();
    }

    function buildLoop() {
        gameLoop = new GameLoop(
            (dt) => update(dt),
            () => render()
        );
    }

    function mount(root: HTMLElement) {
        if (sessionRoot) {
            return;
        }

        mountRoot = root;
        sessionRoot = document.createElement('div');
        sessionRoot.className = 'game-session';

        worldRoot = document.createElement('div');
        worldRoot.className = 'game-world';
        sessionRoot.appendChild(worldRoot);

        mountRoot.appendChild(sessionRoot);

        input = new Input();
        camera = new Camera();
        renderer = new RenderSystem(worldRoot);
        abilitySystem = new AbilitySystem();
        physics = new PhysicsSystem(abilitySystem);
        aiSystem = new AISystem();
        audioManager = new GameAudioManager();
        audioManager.start();

        input.setCamera(camera);
        input.onSplit = () => {
            if (!player) {
                return;
            }

            const beforeCount = player.cells.length;
            const playerCenter = player.getCenter();
            const mouseWorld = input?.getMouseWorldPosition();
            if (mouseWorld) {
                abilitySystem?.split(player, mouseWorld.sub(playerCenter));
            } else {
                abilitySystem?.split(player);
            }

            if (player.cells.length > beforeCount) {
                audioManager?.playSplit();
            }
        };

        hudRefs = createHud();
        tuningToolbox = new TuningToolbox();
        tuningToolbox.mount(hudRefs.toolboxHost);
        buildLoop();
        applySettings(settings);
    }

    function startNewGame() {
        ensureMounted();
        stop();
        initializeWorld();
        audioManager?.requestMusicStart();
        gameLoop?.start();
        isRunning = true;
    }

    function stop() {
        gameLoop?.stop();
        audioManager?.stopMusic();
        isRunning = false;
    }

    function destroy() {
        stop();
        stopSettlementAnimation();
        input?.destroy();
        camera?.destroy();
        renderer?.destroy();
        tuningToolbox?.destroy();
        audioManager?.destroy();
        sessionRoot?.remove();

        hudRefs = null;
        sessionRoot = null;
        worldRoot = null;
        mountRoot = null;
        input = null;
        camera = null;
        renderer = null;
        abilitySystem = null;
        physics = null;
        aiSystem = null;
        quadTree = null;
        player = null;
        bots = [];
        foods = [];
        viruses = [];
        gameLoop = null;
        tuningToolbox = null;
        audioManager = null;
    }

    function applySettings(nextSettings: GameSettings) {
        settings = { ...nextSettings };

        if (sessionRoot) {
            sessionRoot.dataset.reducedMotion = String(settings.reducedMotion);
        }

        if (player) {
            player.displayName = resolvePlayerDisplayName(settings.playerName);
        }

        syncHud();
        syncLeaderboard();
    }

    function getSnapshot(): GameSessionSnapshot {
        const totalMass = player
            ? Math.floor(player.cells.reduce((sum, cell) => sum + cell.mass, 0))
            : 0;
        const playerCellMasses = player ? player.cells.map((cell) => Number(cell.mass.toFixed(2))) : [];
        const playerMergeTimers = player ? player.cells.map((cell) => Number(Math.max(0, cell.mergeTimer).toFixed(2))) : [];
        const playerCenter = player
            ? player.getCenter()
            : { x: 0, y: 0 };
        const playerAimDirection = player
            ? player.getAimDirection()
            : { x: 1, y: 0 };
        const splitState = player && abilitySystem
            ? abilitySystem.getSplitState(player)
            : { lastSplitMs: 0, canSplitNow: false };

        const elapsedSeconds = getElapsedSeconds();
        const remainingSeconds = getRemainingSeconds();
        const audioState = audioManager?.getDebugState() ?? {
            supported: false,
            contextState: 'unavailable',
            unlocked: false,
            wantsMusic: false,
            musicLoopRunning: false,
            splitSfxCount: 0,
            ejectSfxCount: 0,
            spikeSfxCount: 0
        };

        return {
            isMounted: sessionRoot !== null,
            isRunning,
            tuningVersion: gameplayTuning.presetVersion,
            massFloor: gameplayTuning.limits.min_cell_mass,
            decayRateNow: player ? Number(player.getCurrentDecayRate().toFixed(7)) : 0,
            playerName: resolvePlayerDisplayName(settings.playerName),
            playerMass: totalMass,
            playerCellCount: player?.cells.length ?? 0,
            playerCellMasses,
            playerCenter: {
                x: Number(playerCenter.x.toFixed(2)),
                y: Number(playerCenter.y.toFixed(2))
            },
            playerAimDirection: {
                x: Number(playerAimDirection.x.toFixed(4)),
                y: Number(playerAimDirection.y.toFixed(4))
            },
            playerMergeTimers,
            score: player?.score ?? 0,
            elapsedSeconds,
            lastSplitMetrics: player && abilitySystem
                ? abilitySystem.getSplitMetrics(player)
                : { maxDistance: 0, timeToMaxMs: 0, peakSpeed: 0 },
            lastEjectMetrics: player && abilitySystem
                ? abilitySystem.getEjectMetrics(player)
                : { lastCost: 0, lastSpawnMass: 0, lastCooldownMs: 0 },
            lastSpikeMetrics: player && abilitySystem
                ? abilitySystem.getSpikeMetrics(player)
                : { mainRatio: 0, pieceCount: 0, pieceMasses: [] },
            splitState,
            tuning: {
                maxCells: gameplayTuning.limits.max_cells,
                splitBaseImpulse: gameplayTuning.split.base_impulse,
                splitDashTime: gameplayTuning.split.dash_time,
                splitLockTime: gameplayTuning.merge.lock_time,
                splitLockMin: gameplayTuning.merge.min_lock_time,
                splitLockMax: gameplayTuning.merge.max_lock_time,
                cohesionNearRatio: gameplayTuning.merge.cohesion_near_ratio,
                cohesionFarRatio: gameplayTuning.merge.cohesion_far_ratio,
                cohesionNearGain: gameplayTuning.merge.cohesion_near_gain,
                cohesionFarGain: gameplayTuning.merge.cohesion_far_gain,
                cohesionDamping: gameplayTuning.merge.cohesion_pd_damping,
                ejectCostMass: gameplayTuning.eject.cost_mass,
                ejectSpawnDistance: gameplayTuning.eject.spawn_distance,
                decayLoss30sAt200: gameplayTuning.decay.anchor_loss_30s[1] ?? 0,
                spikeMainRatio: gameplayTuning.spike.main_cell_ratio,
                spikeTargetCells: gameplayTuning.spike.target_cell_count,
                spikeMaxPieceRatio: gameplayTuning.spike.max_piece_ratio,
                spikePieceMassCap: gameplayTuning.spike.piece_mass_cap,
                spikeVirusBonusMass: gameplayTuning.spike.virus_bonus_mass,
                spikeVirusFeedSplitFeeds: gameplayTuning.spike.virus_feed_split_feeds,
                spikeVirusFeedSplitMass: gameplayTuning.spike.virus_feed_split_mass,
                spikeVirusFeedSplitDistance: gameplayTuning.spike.virus_feed_split_distance,
                spikeVirusFeedSplitSpeed: gameplayTuning.spike.virus_feed_split_speed
            },
            hud: {
                showFps: settings.showFps,
                showMinimap: settings.showMinimap,
                showLeaderboard: settings.showLeaderboard,
                developerMode: settings.developerMode
            },
            audio: audioState,
            match: {
                modeId: modeConfig.id,
                modeName: modeConfig.name,
                timed: modeConfig.timed,
                durationSeconds: modeConfig.durationSeconds,
                remainingSeconds,
                isFinished: matchFinished,
                winnerLabel,
                playerWon,
                bestMassRecord,
                playerRank,
                playerRankTheme,
                top3: top3Result.map((entry) => ({ ...entry })),
                settlementStage,
                rewardBreakdown: settlementRewardBreakdown ? { ...settlementRewardBreakdown } : null,
                progressionBefore: settlementProgressionBefore ? { ...settlementProgressionBefore } : null,
                progressionAfter: settlementProgressionAfter ? { ...settlementProgressionAfter } : null,
                leveledUp: settlementLeveledUp
            }
        };
    }

    function advanceTime(ms: number) {
        if (matchFinished && settlementStage !== 'hidden') {
            advanceSettlementTimeline(ms);
            return;
        }
        gameLoop?.advanceTime(ms);
    }

    return {
        mount,
        startNewGame,
        stop,
        destroy,
        applySettings,
        getSnapshot,
        advanceTime,
        debugFinishMatch,
        debugSetBestMassRecord
    };
}
