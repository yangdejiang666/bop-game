import { GameLoop } from '../core/GameLoop';
import { RenderSystem } from '../systems/RenderSystem';
import { Camera } from '../core/Camera';
import { Controller } from '../core/Controller';
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
import { Vector } from '../utils/Vector';
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
import { loadBestMassRecord, saveBestMassRecord } from '../app/bestMassRecord';
import { getSkinOption } from '../app/skins';
import { gameplayTuning } from '../gameplay/tuning';
import { TuningToolbox } from '../ui/TuningToolbox';
import type { LobbyModeId } from '../ui/LobbyUI';
import { renderLobbyIcon, type LobbyIconId } from '../ui/icons';
import { GameAudioManager, type GameAudioDebugState } from '../audio/GameAudioManager';
import { getModeDefinition, type ModeDefinition } from '../modes/definitions';
import {
    getModeMapBlueprint,
    type ModeMapAnchor,
    type ModeMapRectZone
} from '../modes/mapBlueprints';
import {
    createBattleRoyaleRuntime,
    type BattleRoyaleShieldStationDefinition
} from '../modes/battleRoyaleRuntime';
import type { CompleteMatchProgressionResponse } from '../../shared-protocol/src/progression';

const DEFAULT_FOOD_COUNT = 1200;
const DEFAULT_VIRUS_COUNT = 12;
const MAX_VIRUS_COUNT = 64;
const BOT_COUNT = 49;
const LEADERBOARD_SIZE = 10;

type MatchRankTheme = 'gold' | 'silver' | 'bronze' | 'normal';
export type SettlementStage = 'hidden' | 'intro' | 'rank' | 'hero' | 'rewards' | 'actions';

interface MatchTop3Entry {
    rank: 1 | 2 | 3;
    name: string;
    mass: number;
    isPlayer: boolean;
}

interface ModeSettlementStat {
    label: string;
    value: string;
    icon: LobbyIconId;
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

interface SettlementTiming {
    introEnd: number;
    rankEnd: number;
    heroEnd: number;
    rewardsEnd: number;
    total: number;
}

interface SettlementPaceScale {
    intro: number;
    rank: number;
    hero: number;
    rewards: number;
}

interface BattleRoyaleShieldStationState extends BattleRoyaleShieldStationDefinition {
    available: boolean;
    cooldownRemainingSeconds: number;
}

interface BattleZoneSafeRect {
    size: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

interface BattleZoneRuntimeState {
    stage: 0 | 1 | 2 | 3 | 4;
    label: string;
    damagePerSecond: number;
    safeRect: BattleZoneSafeRect;
    suddenDeath: boolean;
}

const FULL_SETTLEMENT_TIMING: SettlementTiming = {
    introEnd: 420,
    rankEnd: 1680,
    heroEnd: 2760,
    rewardsEnd: 3880,
    total: 3880
};

const REDUCED_SETTLEMENT_TIMING: SettlementTiming = {
    introEnd: 120,
    rankEnd: 420,
    heroEnd: 700,
    rewardsEnd: 980,
    total: 980
};

const SETTLEMENT_PACE_SCALES: Record<ModeDefinition['settlement']['revealPace'], SettlementPaceScale> = {
    cinematic: {
        intro: 1.12,
        rank: 1.24,
        hero: 1.1,
        rewards: 1.08
    },
    standard: {
        intro: 1,
        rank: 1,
        hero: 1,
        rewards: 1
    },
    fast: {
        intro: 0.78,
        rank: 0.74,
        hero: 0.82,
        rewards: 0.85
    }
};

function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function randomInRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

function createCenteredSafeRect(worldSize: number, size: number): BattleZoneSafeRect {
    const safeSize = clampNumber(size, 0, worldSize);
    const half = safeSize / 2;
    const center = worldSize / 2;
    return {
        size: safeSize,
        minX: center - half,
        minY: center - half,
        maxX: center + half,
        maxY: center + half
    };
}

function createBattleZoneRuntimeState(
    modeDefinition: ModeDefinition,
    worldSize: number,
    elapsedSeconds: number
): BattleZoneRuntimeState {
    const rules = modeDefinition.gameplay.battleRoyale;
    if (!rules.enabled) {
        return {
            stage: 0,
            label: '未启用',
            damagePerSecond: 0,
            safeRect: createCenteredSafeRect(worldSize, 0),
            suddenDeath: false
        };
    }

    const timings = rules.phaseTimings;
    const safeRect = rules.safeRect;
    if (elapsedSeconds < timings.safeUntilSeconds) {
        return {
            stage: 0,
            label: '全图安全',
            damagePerSecond: rules.damagePerSecond.phase1,
            safeRect: createCenteredSafeRect(worldSize, safeRect.initialSize),
            suddenDeath: false
        };
    }

    if (elapsedSeconds < timings.firstShrinkEndSeconds) {
        const progress = clampNumber(
            (elapsedSeconds - timings.safeUntilSeconds)
                / Math.max(1, timings.firstShrinkEndSeconds - timings.safeUntilSeconds),
            0,
            1
        );
        const size = safeRect.initialSize + (safeRect.phaseOneSize - safeRect.initialSize) * progress;
        return {
            stage: 1,
            label: '第一段收缩',
            damagePerSecond: rules.damagePerSecond.phase1,
            safeRect: createCenteredSafeRect(worldSize, size),
            suddenDeath: false
        };
    }

    if (elapsedSeconds < timings.secondShrinkEndSeconds) {
        const progress = clampNumber(
            (elapsedSeconds - timings.firstShrinkEndSeconds)
                / Math.max(1, timings.secondShrinkEndSeconds - timings.firstShrinkEndSeconds),
            0,
            1
        );
        const size = safeRect.phaseOneSize + (safeRect.phaseTwoSize - safeRect.phaseOneSize) * progress;
        return {
            stage: 2,
            label: '第二段收缩',
            damagePerSecond: rules.damagePerSecond.phase2,
            safeRect: createCenteredSafeRect(worldSize, size),
            suddenDeath: false
        };
    }

    if (elapsedSeconds < timings.collapseEndSeconds) {
        const progress = clampNumber(
            (elapsedSeconds - timings.secondShrinkEndSeconds)
                / Math.max(1, timings.collapseEndSeconds - timings.secondShrinkEndSeconds),
            0,
            1
        );
        const size = safeRect.phaseTwoSize + (safeRect.finalSize - safeRect.phaseTwoSize) * progress;
        return {
            stage: 3,
            label: '终极收缩',
            damagePerSecond: rules.damagePerSecond.phase3,
            safeRect: createCenteredSafeRect(worldSize, size),
            suddenDeath: false
        };
    }

    return {
        stage: 4,
        label: '无安全区',
        damagePerSecond: rules.damagePerSecond.suddenDeath,
        safeRect: createCenteredSafeRect(worldSize, 0),
        suddenDeath: rules.suddenDeath
    };
}

function pickWeightedItem<T extends { weight: number }>(items: T[]): T {
    if (items.length === 0) {
        throw new Error('Cannot pick from an empty weighted list.');
    }

    const totalWeight = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
        return items[Math.floor(Math.random() * items.length)];
    }

    let cursor = Math.random() * totalWeight;
    for (const item of items) {
        cursor -= Math.max(0, item.weight);
        if (cursor <= 0) {
            return item;
        }
    }
    return items[items.length - 1];
}

function samplePointInRectZone(zone: ModeMapRectZone, padding = 0): Vector {
    const halfWidth = Math.max(24, zone.width / 2 - padding);
    const halfHeight = Math.max(24, zone.height / 2 - padding);
    return new Vector(
        randomInRange(zone.x - halfWidth, zone.x + halfWidth),
        randomInRange(zone.y - halfHeight, zone.y + halfHeight)
    );
}

function samplePointAroundAnchor(anchor: ModeMapAnchor): Vector {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.sqrt(Math.random()) * Math.max(12, anchor.radius);
    return new Vector(
        anchor.x + Math.cos(angle) * distance,
        anchor.y + Math.sin(angle) * distance
    );
}

export interface GameSessionSnapshot {
    isMounted: boolean;
    isRunning: boolean;
    tuningVersion: string;
    massFloor: number;
    decayRateNow: number;
    playerName: string;
    playerSkinId: string;
    playerColor: string;
    playerAccentColor: string;
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
        mapSignature: string;
        worldSize: number;
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
        modeStats: ModeSettlementStat[];
        modeRulesSnapshot: {
            foodTarget: number;
            virusTarget: number;
            decayMultiplier: number;
            speedMultiplier: number;
            scoreMultiplier: number;
            rankPointMultiplier: number;
            battleZone: {
                enabled: boolean;
                shape: "square";
                stage: number;
                label: string;
                damagePerSecond: number;
                suddenDeath: boolean;
                safeRect: BattleZoneSafeRect;
                phaseTimings: ModeDefinition['gameplay']['battleRoyale']['phaseTimings'];
            };
        };
        hudProfile: {
            emphasis: ModeDefinition['hud']['emphasis'];
            showCombo: boolean;
            showTeamPanel: boolean;
            showZoneWarning: boolean;
        };
        settlementProfile: {
            style: ModeDefinition['settlement']['style'];
            title: string;
            subtitle: string;
            revealPace: ModeDefinition['settlement']['revealPace'];
            replayLabel: string;
            lobbyLabel: string;
        };
        roomSimulation: {
            supportsRoom: boolean;
            roomSize: number;
            supportsSpectate: boolean;
            supportsReplay: boolean;
        };
        battleRoyaleState: {
            enabled: boolean;
            safeRect: BattleZoneSafeRect;
            damagePerSecond: number;
            suddenDeath: boolean;
            noRespawn: boolean;
            availableShieldStations: number;
            shieldCharge: number;
            shieldMaxCharge: number;
            shieldSecondsRemaining: number;
            spikeChains: number;
        };
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
    debugSetBattleZone(stage: number): void;
}

interface CreateGameSessionOptions {
    settings: GameSettings;
    modeId: LobbyModeId;
    onReturnToLobby: () => void;
    onOpenSettings: () => void;
    onCompleteMatch?: (payload: {
        clientMatchId: string;
        modeId: LobbyModeId;
        playerRank: number;
        playerMass: number;
        playerWon: boolean;
        finishedAt: string;
    }) => Promise<CompleteMatchProgressionResponse>;
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
    teamSummaryEl: HTMLDivElement;
    teamMassEl: HTMLDivElement;
    teamDeltaEl: HTMLDivElement;
    teamMembersEl: HTMLDivElement;
    zoneAlertEl: HTMLDivElement;
    zoneStatusEl: HTMLDivElement;
    zoneDamageEl: HTMLDivElement;
    zoneShieldEl: HTMLDivElement;
    resultOverlay: HTMLDivElement;
    resultPanelEl: HTMLDivElement;
    resultRankSplashEl: HTMLDivElement;
    resultRankSplashLabelEl: HTMLDivElement;
    resultRankSplashNumberEl: HTMLDivElement;
    resultRankSplashTitleEl: HTMLDivElement;
    resultRankSplashCaptionEl: HTMLDivElement;
    resultRankSplashMedalEl: HTMLDivElement;
    resultKickerEl: HTMLDivElement;
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
    resultModeStatLabelEls: [HTMLSpanElement, HTMLSpanElement, HTMLSpanElement];
    resultModeStatValueEls: [HTMLDivElement, HTMLDivElement, HTMLDivElement];
    resultModeStatIconEls: [HTMLSpanElement, HTMLSpanElement, HTMLSpanElement];
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
    const modeDefinition = getModeDefinition(options.modeId);
    const modeMapBlueprint = getModeMapBlueprint(options.modeId);
    const worldSize = modeMapBlueprint.worldSize;
    const battleRoyaleRuntime = modeDefinition.gameplay.battleRoyale.enabled
        ? createBattleRoyaleRuntime(worldSize)
        : null;
    const modeConfig: MatchModeConfig = {
        id: modeDefinition.id,
        name: modeDefinition.name,
        timed: modeDefinition.gameplay.timed,
        durationSeconds: modeDefinition.gameplay.durationSeconds,
        teamMode: modeDefinition.gameplay.teamMode
    };

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

    let targetFoodCount = modeDefinition.gameplay.foodTarget || DEFAULT_FOOD_COUNT;
    let targetVirusCount = modeDefinition.gameplay.virusTarget || DEFAULT_VIRUS_COUNT;
    let battleZoneRuntime = createBattleZoneRuntimeState(modeDefinition, worldSize, 0);
    let battleRoyaleShieldStations: BattleRoyaleShieldStationState[] = [];
    let battleRoyaleShieldCharge = 0;
    let battleRoyaleShieldMaxCharge = 0;
    let battleRoyaleShieldSecondsRemaining = 0;
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
    let settlementCloudSyncMessage = '';
    let settlementSubtitleBase = '';
    let settlementModeStats: ModeSettlementStat[] = [];
    let viewportResizeBound = false;

    function fitSettlementPanelToViewport() {
        if (!hudRefs) {
            return;
        }

        const panel = hudRefs.resultPanelEl;
        const overlay = hudRefs.resultOverlay;
        panel.style.setProperty('--result-fit-scale', '1');
        panel.classList.remove('is-fit-scaled');

        const panelRect = panel.getBoundingClientRect();
        const actionsWrap = hudRefs.resultActions.lobby.parentElement as HTMLElement | null;
        const rewardsWrap = hudRefs.resultRewardXpEl.closest('.match-result-rewards') as HTMLElement | null;
        const growthWrap = hudRefs.resultGrowthFillEl.closest('.match-result-growth') as HTMLElement | null;
        const stageBottom = Math.max(
            panel.clientHeight,
            actionsWrap ? actionsWrap.getBoundingClientRect().bottom - panelRect.top : 0,
            growthWrap ? growthWrap.getBoundingClientRect().bottom - panelRect.top : 0,
            rewardsWrap ? rewardsWrap.getBoundingClientRect().bottom - panelRect.top : 0
        );
        const naturalWidth = Math.max(panel.scrollWidth, panel.clientWidth);
        const naturalHeight = Math.max(panel.scrollHeight, stageBottom);
        if (naturalWidth <= 0 || naturalHeight <= 0) {
            return;
        }

        const overlayRect = overlay.getBoundingClientRect();
        const overlayStyle = window.getComputedStyle(overlay);
        const overlayPadX = parseFloat(overlayStyle.paddingLeft) + parseFloat(overlayStyle.paddingRight);
        const overlayPadY = parseFloat(overlayStyle.paddingTop) + parseFloat(overlayStyle.paddingBottom);
        const safeInset = 12;
        const availableWidth = Math.max(220, overlayRect.width - overlayPadX - safeInset * 2);
        const availableHeight = Math.max(220, overlayRect.height - overlayPadY - safeInset * 2);

        const widthScale = availableWidth / naturalWidth;
        const heightScale = availableHeight / naturalHeight;
        const targetScale = Math.min(1, widthScale, heightScale);
        const safeScale = Math.max(0.4, targetScale);

        panel.style.setProperty('--result-fit-scale', safeScale.toFixed(4));
        panel.classList.toggle('is-fit-scaled', safeScale < 0.995);
    }

    const handleViewportResize = () => {
        if (!hudRefs) {
            return;
        }
        if (!hudRefs.resultOverlay.classList.contains('is-visible')) {
            return;
        }
        fitSettlementPanelToViewport();
    };

    function ensureMounted() {
        if (!sessionRoot || !worldRoot || !hudRefs) {
            throw new Error('Game session must be mounted before use.');
        }
    }

    function clampPointToWorld(point: Vector, margin = 140): Vector {
        const safeMargin = Math.max(0, Math.min(margin, worldSize / 2));
        return new Vector(
            clampNumber(point.x, safeMargin, worldSize - safeMargin),
            clampNumber(point.y, safeMargin, worldSize - safeMargin)
        );
    }

    function sampleSpawnPoint(): Vector {
        const zone = pickWeightedItem(modeMapBlueprint.spawnZones);
        return clampPointToWorld(samplePointInRectZone(zone, 110), 180);
    }

    function sampleFoodSpawnPoint(): Vector {
        if (modeMapBlueprint.foodHotspots.length === 0 || Math.random() < 0.14) {
            return clampPointToWorld(
                new Vector(Math.random() * worldSize, Math.random() * worldSize),
                80
            );
        }

        const hotspot = pickWeightedItem(modeMapBlueprint.foodHotspots);
        return clampPointToWorld(samplePointAroundAnchor(hotspot), 80);
    }

    function sampleVirusSpawnPoint(): Vector {
        if (modeMapBlueprint.virusAnchors.length === 0) {
            return clampPointToWorld(
                new Vector(Math.random() * worldSize, Math.random() * worldSize),
                180
            );
        }

        const anchor = pickWeightedItem(modeMapBlueprint.virusAnchors);
        return clampPointToWorld(samplePointAroundAnchor(anchor), 180);
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

    function updateBattleZoneState(elapsedSeconds: number) {
        battleZoneRuntime = createBattleZoneRuntimeState(modeDefinition, worldSize, elapsedSeconds);
    }

    function isInsideSafeRect(point: Vector, safeRect: BattleZoneSafeRect): boolean {
        return point.x >= safeRect.minX
            && point.x <= safeRect.maxX
            && point.y >= safeRect.minY
            && point.y <= safeRect.maxY;
    }

    function refreshPlayerShieldTelemetry() {
        if (!player) {
            battleRoyaleShieldCharge = 0;
            battleRoyaleShieldMaxCharge = 0;
            battleRoyaleShieldSecondsRemaining = 0;
            return;
        }

        battleRoyaleShieldCharge = Math.max(0, player.hazardShield);
        battleRoyaleShieldMaxCharge = Math.max(0, player.hazardShieldMax);
        battleRoyaleShieldSecondsRemaining = Math.max(0, player.hazardShieldTimer);
    }

    function updateShieldStations(dt: number) {
        if (!battleRoyaleRuntime || !modeDefinition.gameplay.battleRoyale.enabled) {
            return;
        }

        battleRoyaleShieldStations.forEach((station) => {
            if (!station.available) {
                station.cooldownRemainingSeconds = Math.max(0, station.cooldownRemainingSeconds - dt);
                if (station.cooldownRemainingSeconds <= 0) {
                    station.available = true;
                }
            }
        });

        const controllers: Controller[] = player ? [player, ...bots] : [...bots];

        for (const station of battleRoyaleShieldStations) {
            if (!station.available) {
                continue;
            }

            const claimant = controllers.find((controller) => {
                if (controller.cells.length === 0) {
                    return false;
                }
                const center = controller.getCenter();
                return center.dist(new Vector(station.center.x, station.center.y)).mag() <= station.pickupRadius;
            });

            if (!claimant) {
                continue;
            }

            claimant.grantHazardShield(station.shieldAmount, station.shieldDurationSeconds);
            station.available = false;
            station.cooldownRemainingSeconds = station.respawnSeconds;
        }

        refreshPlayerShieldTelemetry();
    }

    function applyBattleZoneDamage(controller: Controller, dt: number) {
        const zone = modeDefinition.gameplay.battleRoyale;
        if (!zone.enabled || dt <= 0 || controller.cells.length === 0) {
            return;
        }

        const damageTotal = battleZoneRuntime.damagePerSecond * dt;
        if (damageTotal <= 0) {
            return;
        }

        const shouldDamageAll = battleZoneRuntime.suddenDeath || battleZoneRuntime.safeRect.size <= 0;

        for (let index = controller.cells.length - 1; index >= 0; index -= 1) {
            const cell = controller.cells[index];
            if (!shouldDamageAll && isInsideSafeRect(cell.position, battleZoneRuntime.safeRect)) {
                continue;
            }

            const remainingDamage = controller.absorbHazardDamage(damageTotal);
            if (remainingDamage <= 0) {
                continue;
            }

            const nextMass = cell.mass - remainingDamage;
            if (nextMass <= 0) {
                controller.removeCell(cell);
                continue;
            }

            if (nextMass !== cell.mass) {
                cell.mass = nextMass;
                cell.updateRadiusFromMass();
            }
        }

        refreshPlayerShieldTelemetry();
    }

    function maybeFinalizeBattleRoyaleByElimination(now: number) {
        if (!modeDefinition.gameplay.battleRoyale.enabled || matchFinished || !player) {
            return;
        }

        const liveControllers = [player, ...bots].filter((controller) => controller.cells.length > 0);
        if (player.cells.length === 0) {
            finalizeTimedMatch(now, {
                winner: 'bot',
                subtitle: '危险区已吞没我方，生存对局提前结算。'
            });
            return;
        }

        if (liveControllers.length <= 1) {
            finalizeTimedMatch(now, {
                winner: 'player',
                subtitle: '场上仅剩我方存活，生存对局提前结算。'
            });
        }
    }

    function resolvePlayerDisplayName(rawName: string): string {
        const trimmed = rawName.trim();
        return trimmed.length > 0 ? trimmed : '未命名玩家';
    }

    function applyPlayerVisualSkin() {
        if (!player) {
            return;
        }

        const skin = getSkinOption(settings.equippedSkinId);
        player.setVisualColors(skin.colorB, skin.colorA);
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

    function formatRankLabel(rank: number): string {
        return `NO.${Math.max(1, rank)}`;
    }

    function getRankSplashPresentation(rank: number): {
        title: string;
        caption: string;
        icon: LobbyIconId;
    } {
        if (modeConfig.id === 'battleRoyale') {
            if (rank === 1) {
                return {
                    title: 'LAST ONE',
                    caption: 'SURVIVAL CROWNED',
                    icon: 'crown'
                };
            }
            if (rank <= 3) {
                return {
                    title: 'SURVIVOR',
                    caption: 'TOP THREE ESCAPE',
                    icon: rank === 2 ? 'rank_silver' : 'rank_bronze'
                };
            }
            return {
                title: 'ALMOST OUT',
                caption: 'STAY INSIDE THE ZONE',
                icon: 'mode_battleRoyale'
            };
        }

        if (modeConfig.id === 'peak') {
            if (rank === 1) {
                return {
                    title: 'PEAK ASCENT',
                    caption: 'ELITE PEDESTAL',
                    icon: 'crown'
                };
            }
            if (rank <= 3) {
                return {
                    title: 'ELITE FINISH',
                    caption: 'CLIMB CONTINUES',
                    icon: rank === 2 ? 'rank_silver' : 'rank_bronze'
                };
            }
            return {
                title: 'ALMOST ELITE',
                caption: 'PUSH FOR THE TOP',
                icon: 'mode_peak'
            };
        }

        if (modeConfig.id === 'ranked') {
            if (rank === 1) {
                return {
                    title: 'RANK GLORY',
                    caption: 'CROWNED IN GOLD',
                    icon: 'crown'
                };
            }
            if (rank <= 3) {
                return {
                    title: 'RANK CLIMB',
                    caption: 'POINTS SECURED',
                    icon: rank === 2 ? 'rank_silver' : 'rank_bronze'
                };
            }
            return {
                title: 'RANK BATTLE',
                caption: 'KEEP CLIMBING',
                icon: 'mode_ranked'
            };
        }

        if (rank === 1) {
            return {
                title: 'VICTORY',
                caption: 'CLASSIC CROWN',
                icon: 'crown'
            };
        }

        if (rank === 2) {
            return {
                title: 'RUNNER UP',
                caption: 'ELITE FINISH',
                icon: 'rank_silver'
            };
        }

        if (rank === 3) {
            return {
                title: 'TOP THREE',
                caption: 'STRONG FINISH',
                icon: 'rank_bronze'
            };
        }

        return {
            title: 'So Close',
            caption: 'KEEP CLIMBING',
            icon: 'rank_silver'
        };
    }

    function scaleSettlementTiming(base: SettlementTiming): SettlementTiming {
        const pace = modeDefinition.settlement.revealPace;
        const scale = SETTLEMENT_PACE_SCALES[pace];
        const introDuration = Math.max(80, Math.round(base.introEnd * scale.intro));
        const rankDuration = Math.max(180, Math.round((base.rankEnd - base.introEnd) * scale.rank));
        const heroDuration = Math.max(200, Math.round((base.heroEnd - base.rankEnd) * scale.hero));
        const rewardsDuration = Math.max(220, Math.round((base.rewardsEnd - base.heroEnd) * scale.rewards));

        const introEnd = introDuration;
        const rankEnd = introEnd + rankDuration;
        const heroEnd = rankEnd + heroDuration;
        const rewardsEnd = heroEnd + rewardsDuration;
        return {
            introEnd,
            rankEnd,
            heroEnd,
            rewardsEnd,
            total: rewardsEnd
        };
    }

    function buildModeSettlementStats(
        playerRankValue: number,
        playerMassValue: number
    ): ModeSettlementStat[] {
        const safeRank = formatRankLabel(playerRankValue);

        if (modeConfig.id === 'ranked') {
            return [
                {
                    label: '排位倍率',
                    value: `${modeDefinition.gameplay.rankPointMultiplier.toFixed(2)}x`,
                    icon: 'mode_ranked'
                },
                {
                    label: '赛季积分估值',
                    value: `${Math.max(1, Math.floor(playerMassValue / 12))}`,
                    icon: 'xp'
                },
                {
                    label: '最终名次',
                    value: safeRank,
                    icon: 'crown'
                }
            ];
        }

        if (modeConfig.id === 'peak') {
            return [
                {
                    label: '巅峰系数',
                    value: `${(modeDefinition.gameplay.rankPointMultiplier * modeDefinition.gameplay.scoreMultiplier).toFixed(2)}x`,
                    icon: 'mode_peak'
                },
                {
                    label: '高压衰减',
                    value: `${modeDefinition.gameplay.decayMultiplier.toFixed(2)}x`,
                    icon: 'record'
                },
                {
                    label: '冲榜名次',
                    value: safeRank,
                    icon: 'rank_silver'
                }
            ];
        }

        if (modeConfig.id === 'battleRoyale') {
            return [
                {
                    label: '安全圈终态',
                    value: `${battleZoneRuntime.label} · ${Math.floor(battleZoneRuntime.safeRect.size)}m`,
                    icon: 'mode_battleRoyale'
                },
                {
                    label: '圈外伤害',
                    value: `${battleZoneRuntime.damagePerSecond}/秒`,
                    icon: 'record'
                },
                {
                    label: '生存名次',
                    value: safeRank,
                    icon: 'crown'
                }
            ];
        }

        return [
            {
                label: '成长倍率',
                value: `${modeDefinition.gameplay.scoreMultiplier.toFixed(2)}x`,
                icon: 'mode_classic'
            },
            {
                label: '当前体重',
                value: `${playerMassValue}kg`,
                icon: 'coin'
            },
            {
                label: '最终名次',
                value: safeRank,
                icon: 'crown'
            }
        ];
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
        const baseTiming = settings.reducedMotion ? REDUCED_SETTLEMENT_TIMING : FULL_SETTLEMENT_TIMING;
        return scaleSettlementTiming(baseTiming);
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
            window.requestAnimationFrame(() => fitSettlementPanelToViewport());
            return;
        }

        if (stage === 'rewards') {
            const rewardSpan = Math.max(1, settlementTiming.rewardsEnd - settlementTiming.heroEnd);
            const rewardProgress = (settlementElapsedMs - settlementTiming.heroEnd) / rewardSpan;
            applySettlementRewardProgress(rewardProgress);
            window.requestAnimationFrame(() => fitSettlementPanelToViewport());
            return;
        }

        applySettlementRewardProgress(1);
        window.requestAnimationFrame(() => fitSettlementPanelToViewport());
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
        root.dataset.hudEmphasis = modeDefinition.hud.emphasis;

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

        const teamSummaryEl = document.createElement('div');
        teamSummaryEl.className = 'hud-panel hud-team-summary';
        teamSummaryEl.innerHTML = `
            <div class="hud-team-summary-title">团队概览</div>
            <div class="hud-team-summary-mass" data-team-mass>我方 0kg / 敌方 0kg</div>
            <div class="hud-team-summary-delta" data-team-delta>质量差 0kg</div>
            <div class="hud-team-summary-members" data-team-members>队友在线：0</div>
        `;
        root.appendChild(teamSummaryEl);

        const teamMassEl = teamSummaryEl.querySelector<HTMLDivElement>('[data-team-mass]');
        const teamDeltaEl = teamSummaryEl.querySelector<HTMLDivElement>('[data-team-delta]');
        const teamMembersEl = teamSummaryEl.querySelector<HTMLDivElement>('[data-team-members]');
        if (!teamMassEl || !teamDeltaEl || !teamMembersEl) {
            throw new Error('Failed to initialize team summary HUD.');
        }

        const zoneAlertEl = document.createElement('div');
        zoneAlertEl.className = 'hud-panel hud-zone-alert';
        zoneAlertEl.innerHTML = `
            <div class="hud-zone-alert-title">安全圈协议</div>
            <div class="hud-zone-alert-status" data-zone-status>等待收缩</div>
            <div class="hud-zone-alert-damage" data-zone-damage>圈外伤害 0 / 秒</div>
            <div class="hud-zone-alert-shield" data-zone-shield>护盾站 0 / 0</div>
        `;
        root.appendChild(zoneAlertEl);

        const zoneStatusEl = zoneAlertEl.querySelector<HTMLDivElement>('[data-zone-status]');
        const zoneDamageEl = zoneAlertEl.querySelector<HTMLDivElement>('[data-zone-damage]');
        const zoneShieldEl = zoneAlertEl.querySelector<HTMLDivElement>('[data-zone-shield]');
        if (!zoneStatusEl || !zoneDamageEl || !zoneShieldEl) {
            throw new Error('Failed to initialize zone alert HUD.');
        }

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
            <div class="match-result-rank-splash" data-result-rank-splash>
                <div class="match-result-rank-splash-rays" aria-hidden="true"></div>
                <div class="match-result-rank-splash-inner">
                    <div class="match-result-rank-splash-kicker" data-result-rank-splash-label>NO.1</div>
                    <div class="match-result-rank-splash-stage">
                        <div class="match-result-rank-splash-wings" aria-hidden="true">
                            <span></span>
                            <span></span>
                        </div>
                        <div class="match-result-rank-splash-medal-shell" data-result-rank-splash-medal>
                            ${renderLobbyIcon('crown', 'match-result-rank-splash-medal-icon')}
                        </div>
                        <div class="match-result-rank-splash-number" data-result-rank-splash-number>1</div>
                    </div>
                    <div class="match-result-rank-splash-title" data-result-rank-splash-title>CHAMPION</div>
                    <div class="match-result-rank-splash-caption" data-result-rank-splash-caption>CROWNED IN GOLD</div>
                </div>
            </div>
            <div class="match-result-panel">
                <div class="match-result-cinematic-bg" aria-hidden="true">
                    <span class="match-result-bg-particle"></span>
                    <span class="match-result-bg-particle"></span>
                    <span class="match-result-bg-particle"></span>
                    <span class="match-result-bg-particle"></span>
                </div>
                <div class="match-result-kicker" data-result-kicker>MATCH RESULT</div>
                <h2 class="match-result-title" data-result-title>Victory</h2>
                <div class="match-result-rank-main-headline" data-result-rank-main>1</div>
                <div class="match-result-subtitle" data-result-subtitle>正在统计结果...</div>
                <div class="match-result-rank-stage">
                    <div class="match-result-rank-head">
                        <span>${renderLobbyIcon('crown', 'match-result-rank-head-icon')} PODIUM</span>
                        <strong data-result-player-rank>RANK 1</strong>
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
                        <span>MY RANK</span>
                        <strong data-result-player-rank-echo>RANK 1</strong>
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
                <div class="match-result-mode-stats">
                    <div class="match-result-reward-card match-result-mode-stat-card">
                        <span class="match-result-reward-label">
                            <span data-result-mode-stat-icon="0">${renderLobbyIcon('mode_classic', 'match-result-reward-icon')}</span>
                            <span data-result-mode-stat-label="0">模式统计A</span>
                        </span>
                        <strong data-result-mode-stat-value="0">--</strong>
                    </div>
                    <div class="match-result-reward-card match-result-mode-stat-card">
                        <span class="match-result-reward-label">
                            <span data-result-mode-stat-icon="1">${renderLobbyIcon('record', 'match-result-reward-icon')}</span>
                            <span data-result-mode-stat-label="1">模式统计B</span>
                        </span>
                        <strong data-result-mode-stat-value="1">--</strong>
                    </div>
                    <div class="match-result-reward-card match-result-mode-stat-card">
                        <span class="match-result-reward-label">
                            <span data-result-mode-stat-icon="2">${renderLobbyIcon('crown', 'match-result-reward-icon')}</span>
                            <span data-result-mode-stat-label="2">模式统计C</span>
                        </span>
                        <strong data-result-mode-stat-value="2">--</strong>
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

        const resultPanelEl = resultOverlay.querySelector<HTMLDivElement>('.match-result-panel');
        const resultRankSplashEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-rank-splash]');
        const resultRankSplashLabelEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-rank-splash-label]');
        const resultRankSplashNumberEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-rank-splash-number]');
        const resultRankSplashTitleEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-rank-splash-title]');
        const resultRankSplashCaptionEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-rank-splash-caption]');
        const resultRankSplashMedalEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-rank-splash-medal]');
        const resultKickerEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-kicker]');
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
        const resultModeStatLabelNodeList = resultOverlay.querySelectorAll<HTMLSpanElement>('[data-result-mode-stat-label]');
        const resultModeStatValueNodeList = resultOverlay.querySelectorAll<HTMLDivElement>('[data-result-mode-stat-value]');
        const resultModeStatIconNodeList = resultOverlay.querySelectorAll<HTMLSpanElement>('[data-result-mode-stat-icon]');
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
            || !resultPanelEl
            || !resultRankSplashEl
            || !resultRankSplashLabelEl
            || !resultRankSplashNumberEl
            || !resultRankSplashTitleEl
            || !resultRankSplashCaptionEl
            || !resultRankSplashMedalEl
            || !resultKickerEl
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
            || resultModeStatLabelNodeList.length !== 3
            || resultModeStatValueNodeList.length !== 3
            || resultModeStatIconNodeList.length !== 3
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

        const resultModeStatLabelEls = [
            resultModeStatLabelNodeList[0],
            resultModeStatLabelNodeList[1],
            resultModeStatLabelNodeList[2]
        ] as [HTMLSpanElement, HTMLSpanElement, HTMLSpanElement];
        const resultModeStatValueEls = [
            resultModeStatValueNodeList[0],
            resultModeStatValueNodeList[1],
            resultModeStatValueNodeList[2]
        ] as [HTMLDivElement, HTMLDivElement, HTMLDivElement];
        const resultModeStatIconEls = [
            resultModeStatIconNodeList[0],
            resultModeStatIconNodeList[1],
            resultModeStatIconNodeList[2]
        ] as [HTMLSpanElement, HTMLSpanElement, HTMLSpanElement];

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
            teamSummaryEl,
            teamMassEl,
            teamDeltaEl,
            teamMembersEl,
            zoneAlertEl,
            zoneStatusEl,
            zoneDamageEl,
            zoneShieldEl,
            resultOverlay,
            resultPanelEl,
            resultRankSplashEl,
            resultRankSplashLabelEl,
            resultRankSplashNumberEl,
            resultRankSplashTitleEl,
            resultRankSplashCaptionEl,
            resultRankSplashMedalEl,
            resultKickerEl,
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
            resultModeStatLabelEls,
            resultModeStatValueEls,
            resultModeStatIconEls,
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
        targetFoodCount = modeDefinition.gameplay.foodTarget || DEFAULT_FOOD_COUNT;
        targetVirusCount = modeDefinition.gameplay.virusTarget || DEFAULT_VIRUS_COUNT;
        battleZoneRuntime = createBattleZoneRuntimeState(modeDefinition, worldSize, 0);
        battleRoyaleShieldStations = battleRoyaleRuntime
            ? battleRoyaleRuntime.shieldStations.map((station) => ({
                ...station,
                available: true,
                cooldownRemainingSeconds: 0
            }))
            : [];
        battleRoyaleShieldCharge = 0;
        battleRoyaleShieldMaxCharge = 0;
        battleRoyaleShieldSecondsRemaining = 0;

        quadTree = new QuadTree(
            new Rectangle(worldSize / 2, worldSize / 2, worldSize / 2, worldSize / 2),
            10
        );

        const playerSpawn = sampleSpawnPoint();
        player = new Player(playerSpawn.x, playerSpawn.y);
        player.displayName = resolvePlayerDisplayName(settings.playerName);
        applyPlayerVisualSkin();
        player.setModeMultipliers(modeDefinition.gameplay.speedMultiplier, modeDefinition.gameplay.decayMultiplier);

        bots = [];
        for (let i = 0; i < BOT_COUNT; i += 1) {
            const spawn = sampleSpawnPoint();
            const bot = new Bot(spawn.x, spawn.y);
            bot.setModeMultipliers(modeDefinition.gameplay.speedMultiplier, modeDefinition.gameplay.decayMultiplier);
            bots.push(bot);
        }

        foods = [];
        for (let i = 0; i < targetFoodCount; i += 1) {
            const spawn = sampleFoodSpawnPoint();
            foods.push(new Food(spawn.x, spawn.y));
        }

        viruses = [];
        for (let i = 0; i < targetVirusCount; i += 1) {
            const spawn = sampleVirusSpawnPoint();
            viruses.push(new Virus(spawn.x, spawn.y));
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
        settlementModeStats = [];
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
        settlementCloudSyncMessage = '';
        settlementSubtitleBase = '';
        hudRefs.resultPanelEl.style.setProperty('--result-fit-scale', '1');
        hudRefs.resultPanelEl.classList.remove('is-fit-scaled');
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
        delete hudRefs.resultOverlay.dataset.modeTheme;
        delete hudRefs.resultOverlay.dataset.settlementStyle;
        hudRefs.resultOverlay.dataset.settlementStage = 'hidden';
        setSettlementActionsEnabled(false);
    }

    function toPlayerProgressionSnapshot(profile: {
        level: number;
        currentXp: number;
        totalXp: number;
        coins: number;
        totalMatches: number;
        totalWins: number;
        bestMass: number;
    }): PlayerProgression {
        return {
            level: profile.level,
            currentXp: profile.currentXp,
            totalXp: profile.totalXp,
            coins: profile.coins,
            totalMatches: profile.totalMatches,
            totalWins: profile.totalWins,
            bestMass: profile.bestMass
        };
    }

    function applySettlementSyncCopy() {
        if (!hudRefs) {
            return;
        }

        const syncCopy = settlementCloudSyncMessage.trim();
        hudRefs.resultSubEl.textContent = syncCopy.length > 0
            ? `${settlementSubtitleBase} · ${syncCopy}`
            : settlementSubtitleBase;
    }

    async function syncCloudMatchResult(payload: {
        clientMatchId: string;
        playerRank: number;
        playerMass: number;
        playerWon: boolean;
    }) {
        if (!options.onCompleteMatch) {
            return;
        }

        settlementCloudSyncMessage = '云存档同步中';
        applySettlementSyncCopy();

        try {
            const result = await options.onCompleteMatch({
                clientMatchId: payload.clientMatchId,
                modeId: options.modeId,
                playerRank: payload.playerRank,
                playerMass: payload.playerMass,
                playerWon: payload.playerWon,
                finishedAt: new Date().toISOString()
            });

            settlementCloudSyncMessage = result.duplicate ? '云存档已去重' : '云存档已同步';
            settlementRewardBreakdown = result.rewardBreakdown;
            settlementProgressionAfter = toPlayerProgressionSnapshot(result.summary.profile);
            settlementLeveledUp = settlementProgressionBefore
                ? result.summary.profile.level > settlementProgressionBefore.level
                : settlementLeveledUp;
            bestMassRecord = Math.max(bestMassRecord, result.summary.profile.bestMass);
            savePlayerProgression(settlementProgressionAfter);
            saveBestMassRecord(bestMassRecord);
            if (hudRefs) {
                hudRefs.resultRecordBannerEl.classList.toggle('is-level-up', settlementLeveledUp);
            }
            applySettlementSyncCopy();
            applySettlementRewardProgress(1);
        } catch (error) {
            settlementCloudSyncMessage = '云存档未同步';
            applySettlementSyncCopy();
            if (error instanceof Error) {
                console.error('Failed to sync match settlement:', error);
            }
        }
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
        let teamATotalForResult = 0;
        let teamBTotalForResult = 0;

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

            teamATotalForResult = teamATotal;
            teamBTotalForResult = teamBTotal;
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

        const rawReward = computeMatchRewards(playerRank, playerMass, playerWon, isNewRecord);
        const rewardMultiplier = Math.max(
            0.5,
            modeDefinition.gameplay.scoreMultiplier * modeDefinition.gameplay.rankPointMultiplier
        );
        settlementRewardBreakdown = {
            ...rawReward,
            totalXp: Math.max(1, Math.floor(rawReward.totalXp * rewardMultiplier)),
            totalCoins: Math.max(1, Math.floor(rawReward.totalCoins * rewardMultiplier))
        };
        const progressionBaseline = loadPlayerProgression();
        const progressionApplied = applyMatchRewardsToProgression({
            ...progressionBaseline,
            bestMass: Math.max(progressionBaseline.bestMass, computedBestMass)
        }, settlementRewardBreakdown);
        settlementProgressionBefore = progressionApplied.before;
        settlementProgressionAfter = progressionApplied.after;
        settlementLeveledUp = progressionApplied.leveledUp;
        settlementCloudSyncMessage = options.onCompleteMatch ? '云存档同步中' : '';

        if (!options.onCompleteMatch) {
            savePlayerProgression(progressionApplied.after);
            bestMassRecord = Math.max(computedBestMass, progressionApplied.after.bestMass);
            saveBestMassRecord(bestMassRecord);
        } else {
            bestMassRecord = Math.max(computedBestMass, progressionApplied.after.bestMass);
        }

        const rankLabel = formatRankLabel(playerRank);
        const rankNumber = String(playerRank);
        const splashPresentation = getRankSplashPresentation(playerRank);

        hudRefs.resultKickerEl.textContent = modeDefinition.settlement.title;
        hudRefs.resultTitleEl.textContent = splashPresentation.title;
        settlementSubtitleBase = `${modeDefinition.settlement.subtitle} · ${resultSubtitle}`;
        applySettlementSyncCopy();
        hudRefs.resultRankMainEl.textContent = rankNumber;
        hudRefs.resultPlayerRankHeadEl.textContent = rankLabel;
        hudRefs.resultPlayerRankEl.textContent = rankLabel;
        hudRefs.resultPlayerRankMassEl.textContent = `${playerMass} kg`;
        hudRefs.resultRankSplashLabelEl.textContent = rankLabel;
        hudRefs.resultRankSplashNumberEl.textContent = rankNumber;
        hudRefs.resultRankSplashTitleEl.textContent = splashPresentation.title;
        hudRefs.resultRankSplashCaptionEl.textContent = splashPresentation.caption;
        hudRefs.resultRankSplashMedalEl.innerHTML = renderLobbyIcon(
            splashPresentation.icon,
            'match-result-rank-splash-medal-icon'
        );
        hudRefs.resultWinnerEl.textContent = winnerLabel;
        hudRefs.resultRewardXpEl.textContent = '+0';
        hudRefs.resultRewardCoinsEl.textContent = '+0';
        hudRefs.resultMassEl.textContent = '0 kg';
        hudRefs.resultBestEl.textContent = '0 kg';
        hudRefs.resultRewardRecordEl.textContent = isNewRecord ? '+0 XP / +0 金币' : '未触发';
        settlementModeStats = buildModeSettlementStats(playerRank, playerMass);
        hudRefs.resultModeStatLabelEls.forEach((el, index) => {
            const stat = settlementModeStats[index];
            el.textContent = stat ? stat.label : '--';
        });
        hudRefs.resultModeStatValueEls.forEach((el, index) => {
            const stat = settlementModeStats[index];
            el.textContent = stat ? stat.value : '--';
        });
        hudRefs.resultModeStatIconEls.forEach((el, index) => {
            const stat = settlementModeStats[index];
            el.innerHTML = renderLobbyIcon(stat ? stat.icon : 'record', 'match-result-reward-icon');
        });
        hudRefs.resultGrowthLevelEl.textContent = settlementProgressionAfter
            ? `Lv.${settlementProgressionAfter.level}`
            : 'Lv.1';
        hudRefs.resultGrowthMetaEl.textContent = settlementProgressionAfter
            ? `0 / ${getRequiredXpForLevel(settlementProgressionAfter.level)} XP · ${settlementProgressionAfter.totalWins} 胜 / ${settlementProgressionAfter.totalMatches} 局`
            : '0 / 208 XP';
        hudRefs.resultGrowthFillEl.style.width = '0%';
        hudRefs.resultRecordBannerEl.style.display = isNewRecord ? 'inline-flex' : 'none';
        hudRefs.resultRecordBannerEl.classList.toggle('is-level-up', settlementLeveledUp);
        hudRefs.resultActions.replay.textContent = modeDefinition.settlement.cta.replay;
        hudRefs.resultActions.lobby.textContent = modeDefinition.settlement.cta.lobby;

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
        hudRefs.resultOverlay.dataset.modeTheme = modeDefinition.theme;
        hudRefs.resultOverlay.dataset.settlementStyle = modeDefinition.settlement.style;
        hudRefs.resultOverlay.classList.remove('rank-theme-gold', 'rank-theme-silver', 'rank-theme-bronze', 'rank-theme-normal');
        hudRefs.resultOverlay.classList.add(`rank-theme-${playerRankTheme}`);
        hudRefs.resultOverlay.classList.toggle('is-level-up', settlementLeveledUp);
        fitSettlementPanelToViewport();
        window.requestAnimationFrame(() => fitSettlementPanelToViewport());
        matchFinished = true;
        stop();

        // Keep snapshot clock stable at match end.
        const frozenElapsedSeconds = modeConfig.timed ? modeConfig.durationSeconds : getElapsedSeconds(now);
        gameStartTime = now - frozenElapsedSeconds * 1000;

        startSettlementTimeline();
        if (options.onCompleteMatch) {
            void syncCloudMatchResult({
                clientMatchId: crypto.randomUUID(),
                playerRank,
                playerMass,
                playerWon
            });
        }
    }

    function debugFinishMatch(options: DebugMatchFinishOptions = {}) {
        finalizeTimedMatch(performance.now(), options);
    }

    function debugSetBattleZone(stage: number) {
        const zone = modeDefinition.gameplay.battleRoyale;
        if (!zone.enabled) {
            return;
        }

        const normalizedStage = Math.max(0, Math.min(4, Math.floor(stage)));
        const timings = zone.phaseTimings;
        const previewTimes = [
            0,
            timings.safeUntilSeconds + 20,
            timings.firstShrinkEndSeconds + 10,
            timings.secondShrinkEndSeconds + 35,
            timings.suddenDeathStartSeconds + 5
        ];
        battleZoneRuntime = createBattleZoneRuntimeState(
            modeDefinition,
            worldSize,
            previewTimes[normalizedStage] ?? 0
        );
        syncHud();
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
        updateBattleZoneState(elapsedSeconds);
        if (modeConfig.timed) {
            const remainingSeconds = getRemainingSeconds(now);
            const minutes = Math.floor(remainingSeconds / 60);
            const seconds = remainingSeconds % 60;
            hudRefs.gameTimerEl.innerText = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            if (modeDefinition.hud.showZoneWarning && modeDefinition.gameplay.battleRoyale.enabled) {
                hudRefs.modeBadgeEl.innerText = `${modeConfig.name} · ${battleZoneRuntime.label}`;
            } else {
                hudRefs.modeBadgeEl.innerText = `${modeConfig.name} · 限时模式`;
            }
        } else {
            const minutes = Math.floor(elapsedSeconds / 60);
            const seconds = elapsedSeconds % 60;
            hudRefs.gameTimerEl.innerText = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            hudRefs.modeBadgeEl.innerText = modeConfig.name;
        }

        if (modeDefinition.hud.showTeamPanel && modeConfig.teamMode) {
            const controllers = [player, ...bots];
            let alliedMass = 0;
            let enemyMass = 0;
            let allies = 0;
            controllers.forEach((controller, index) => {
                const mass = Math.floor(controller.cells.reduce((sum, cell) => sum + cell.mass, 0));
                const isAllied = index === 0 || index % 2 === 0;
                if (isAllied) {
                    alliedMass += mass;
                    allies += 1;
                } else {
                    enemyMass += mass;
                }
            });
            const delta = alliedMass - enemyMass;
            hudRefs.teamMassEl.innerText = `我方 ${alliedMass}kg / 敌方 ${enemyMass}kg`;
            hudRefs.teamDeltaEl.innerText = `质量差 ${delta >= 0 ? '+' : ''}${delta}kg`;
            hudRefs.teamMembersEl.innerText = `我方成员 ${allies} / 敌方成员 ${Math.max(0, controllers.length - allies)}`;
        }

        if (modeDefinition.hud.showZoneWarning && modeDefinition.gameplay.battleRoyale.enabled) {
            const zoneLabel = battleZoneRuntime.stage === 0
                ? '全图安全'
                : (battleZoneRuntime.suddenDeath ? '无安全区' : battleZoneRuntime.label);
            const availableShieldStations = battleRoyaleShieldStations.filter((station) => station.available).length;
            const shieldLabel = battleRoyaleShieldSecondsRemaining > 0
                ? `护盾 ${Math.round(battleRoyaleShieldCharge)}/${Math.round(battleRoyaleShieldMaxCharge)} · ${battleRoyaleShieldSecondsRemaining.toFixed(1)}s`
                : `护盾站 ${availableShieldStations}/${battleRoyaleShieldStations.length}`;
            const rectLabel = battleZoneRuntime.safeRect.size > 0
                ? `边长 ${Math.floor(battleZoneRuntime.safeRect.size)}m`
                : '全图危险';
            hudRefs.zoneStatusEl.innerText = `${zoneLabel} · ${rectLabel}`;
            hudRefs.zoneDamageEl.innerText = `圈外伤害 ${battleZoneRuntime.damagePerSecond}/秒`;
            hudRefs.zoneShieldEl.innerText = `${shieldLabel} · 方形安全区`;
        }

        hudRefs.leaderboardContainer.style.display = settings.showLeaderboard ? 'block' : 'none';
        hudRefs.minimapContainer.style.display = settings.showMinimap ? 'block' : 'none';
        hudRefs.fpsEl.style.display = settings.showFps ? 'block' : 'none';
        hudRefs.debugContainer.style.display = settings.developerMode ? 'block' : 'none';
        hudRefs.teamSummaryEl.style.display = modeDefinition.hud.showTeamPanel ? 'block' : 'none';
        hudRefs.zoneAlertEl.style.display = modeDefinition.hud.showZoneWarning ? 'block' : 'none';
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
        minimapCtx.fillStyle = 'rgba(7, 16, 30, 0.94)';
        minimapCtx.fillRect(0, 0, 150, 150);

        const scale = 140 / worldSize;
        const project = (value: number) => 5 + value * scale;

        minimapCtx.strokeStyle = 'rgba(132, 204, 255, 0.24)';
        minimapCtx.lineWidth = 1;
        minimapCtx.strokeRect(5, 5, 140, 140);

        minimapCtx.fillStyle = 'rgba(102, 195, 255, 0.08)';
        modeMapBlueprint.safeCorridors.forEach((corridor) => {
            const left = project(corridor.x - corridor.width / 2);
            const top = project(corridor.y - corridor.height / 2);
            const width = corridor.width * scale;
            const height = corridor.height * scale;
            minimapCtx.fillRect(left, top, width, height);
        });

        modeMapBlueprint.foodHotspots.forEach((hotspot) => {
            minimapCtx.beginPath();
            minimapCtx.arc(project(hotspot.x), project(hotspot.y), Math.max(2, hotspot.radius * scale * 0.35), 0, Math.PI * 2);
            minimapCtx.fillStyle = modeDefinition.id === 'battleRoyale'
                ? 'rgba(255, 184, 94, 0.16)'
                : 'rgba(102, 234, 171, 0.14)';
            minimapCtx.fill();
        });

        modeMapBlueprint.virusAnchors.forEach((anchor) => {
            minimapCtx.beginPath();
            minimapCtx.arc(project(anchor.x), project(anchor.y), Math.max(2, anchor.radius * scale * 0.22), 0, Math.PI * 2);
            minimapCtx.fillStyle = 'rgba(97, 255, 146, 0.55)';
            minimapCtx.fill();
        });

        if (modeDefinition.gameplay.battleRoyale.enabled) {
            minimapCtx.fillStyle = 'rgba(255, 72, 72, 0.12)';
            minimapCtx.fillRect(5, 5, 140, 140);
            if (battleZoneRuntime.safeRect.size > 0) {
                const safeLeft = project(battleZoneRuntime.safeRect.minX);
                const safeTop = project(battleZoneRuntime.safeRect.minY);
                const safeSize = battleZoneRuntime.safeRect.size * scale;
                minimapCtx.clearRect(safeLeft, safeTop, safeSize, safeSize);
                minimapCtx.fillStyle = 'rgba(115, 236, 255, 0.12)';
                minimapCtx.fillRect(safeLeft, safeTop, safeSize, safeSize);
                minimapCtx.strokeStyle = battleZoneRuntime.suddenDeath
                    ? 'rgba(255, 176, 176, 0.75)'
                    : 'rgba(115, 236, 255, 0.75)';
                minimapCtx.lineWidth = 2;
                minimapCtx.setLineDash(battleZoneRuntime.stage >= 3 ? [6, 4] : [10, 6]);
                minimapCtx.strokeRect(safeLeft, safeTop, safeSize, safeSize);
                minimapCtx.setLineDash([]);
            }
        }

        const playerPos = player.getCenter();
        const minimapX = project(playerPos.x);
        const minimapY = project(playerPos.y);
        const edgeMargin = 500;

        const showTopEdge = playerPos.y < edgeMargin;
        const showBottomEdge = playerPos.y > worldSize - edgeMargin;
        const showLeftEdge = playerPos.x < edgeMargin;
        const showRightEdge = playerPos.x > worldSize - edgeMargin;

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

        if (modeDefinition.gameplay.battleRoyale.enabled) {
            return;
        }

        if (player.cells.length === 0) {
            const startMass = gameplayTuning.limits.min_cell_mass;
            const startRadius = Math.sqrt(startMass) * 3.5;
            const spawn = sampleSpawnPoint();
            const spawnX = spawn.x;
            const spawnY = spawn.y;
            const newCell = new Blob(spawnX, spawnY, startRadius, player.color);
            newCell.mass = startMass;
            player.addCell(newCell);
            player.setModeMultipliers(modeDefinition.gameplay.speedMultiplier, modeDefinition.gameplay.decayMultiplier);
            player.score = 0;
        }

        bots.forEach((bot) => {
            if (bot.cells.length > 0) {
                return;
            }

            const startMass = gameplayTuning.limits.min_cell_mass;
            const startRadius = Math.sqrt(startMass) * 3.5;
            const spawn = sampleSpawnPoint();
            const spawnX = spawn.x;
            const spawnY = spawn.y;
            const newCell = new Blob(spawnX, spawnY, startRadius, bot.color);
            newCell.mass = startMass;
            bot.addCell(newCell);
            bot.setModeMultipliers(modeDefinition.gameplay.speedMultiplier, modeDefinition.gameplay.decayMultiplier);
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
        const elapsedSeconds = getElapsedSeconds(currentTime);
        updateBattleZoneState(elapsedSeconds);
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

        if (modeDefinition.gameplay.battleRoyale.enabled) {
            updateShieldStations(dt);
            applyBattleZoneDamage(player, dt);
            bots.forEach((bot) => applyBattleZoneDamage(bot, dt));
            maybeFinalizeBattleRoyaleByElimination(currentTime);
            if (matchFinished) {
                return;
            }
        }

        aiSystem.update(bots, player, quadTree, dt, worldSize, worldSize, abilitySystem);

        foods.forEach((food) => {
            if (food instanceof EjectedMass) {
                food.update(dt, worldSize, worldSize);
            }
        });

        viruses.forEach((virus) => {
            virus.update(dt);
        });

        const activeBlobs: Blob[] = [
            ...player.cells,
            ...bots.flatMap((bot) => bot.cells)
        ];

        physics.update(activeBlobs, foods as Food[], viruses, quadTree, worldSize, worldSize, dt);
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
                const spawn = sampleFoodSpawnPoint();
                foods.push(new Food(spawn.x, spawn.y));
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
            const spawn = sampleVirusSpawnPoint();
            viruses.push(new Virus(spawn.x, spawn.y));
        } else if (viruses.length > MAX_VIRUS_COUNT) {
            // Safety cap only; do not immediately delete feed-split results.
            const overflow = viruses.length - MAX_VIRUS_COUNT;
            for (let i = 0; i < overflow; i += 1) {
                viruses.pop();
            }
        }

        if (modeDefinition.gameplay.battleRoyale.enabled) {
            maybeFinalizeBattleRoyaleByElimination(currentTime);
            if (matchFinished) {
                return;
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
        activeRenderer.drawWorldBorder(worldSize, activeCamera);
        if (modeDefinition.gameplay.battleRoyale.enabled) {
            activeRenderer.drawBattleZoneSquare(worldSize, battleZoneRuntime.safeRect, battleZoneRuntime.stage, activeCamera);
            activeRenderer.drawBattleRoyaleShieldStations(battleRoyaleShieldStations, activeCamera);
        }

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
        activeRenderer.drawBoundaryWarnings(playerPos, worldSize, activeCamera);

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
        sessionRoot.dataset.modeId = modeDefinition.id;
        sessionRoot.dataset.hudProfile = modeDefinition.hud.emphasis;
        sessionRoot.dataset.settlementProfile = modeDefinition.settlement.style;

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

        if (!viewportResizeBound) {
            window.addEventListener('resize', handleViewportResize);
            viewportResizeBound = true;
        }

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
        if (viewportResizeBound) {
            window.removeEventListener('resize', handleViewportResize);
            viewportResizeBound = false;
        }
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
            applyPlayerVisualSkin();
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
        updateBattleZoneState(elapsedSeconds);
        refreshPlayerShieldTelemetry();
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
            playerSkinId: settings.equippedSkinId,
            playerColor: player?.color ?? getSkinOption(settings.equippedSkinId).colorB,
            playerAccentColor: player?.accentColor ?? getSkinOption(settings.equippedSkinId).colorA,
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
                mapSignature: modeMapBlueprint.mapSignature,
                worldSize,
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
                leveledUp: settlementLeveledUp,
                modeStats: settlementModeStats.map((item) => ({ ...item })),
                modeRulesSnapshot: {
                    foodTarget: targetFoodCount,
                    virusTarget: targetVirusCount,
                    decayMultiplier: modeDefinition.gameplay.decayMultiplier,
                    speedMultiplier: modeDefinition.gameplay.speedMultiplier,
                    scoreMultiplier: modeDefinition.gameplay.scoreMultiplier,
                    rankPointMultiplier: modeDefinition.gameplay.rankPointMultiplier,
                    battleZone: {
                        enabled: modeDefinition.gameplay.battleRoyale.enabled,
                        shape: modeDefinition.gameplay.battleRoyale.shape,
                        stage: battleZoneRuntime.stage,
                        label: battleZoneRuntime.label,
                        damagePerSecond: battleZoneRuntime.damagePerSecond,
                        suddenDeath: battleZoneRuntime.suddenDeath,
                        safeRect: { ...battleZoneRuntime.safeRect },
                        phaseTimings: { ...modeDefinition.gameplay.battleRoyale.phaseTimings }
                    }
                },
                hudProfile: {
                    emphasis: modeDefinition.hud.emphasis,
                    showCombo: modeDefinition.hud.showCombo,
                    showTeamPanel: modeDefinition.hud.showTeamPanel,
                    showZoneWarning: modeDefinition.hud.showZoneWarning
                },
                settlementProfile: {
                    style: modeDefinition.settlement.style,
                    title: modeDefinition.settlement.title,
                    subtitle: modeDefinition.settlement.subtitle,
                    revealPace: modeDefinition.settlement.revealPace,
                    replayLabel: modeDefinition.settlement.cta.replay,
                    lobbyLabel: modeDefinition.settlement.cta.lobby
                },
                roomSimulation: {
                    supportsRoom: modeDefinition.social.supportsRoom,
                    roomSize: modeDefinition.social.roomSize,
                    supportsSpectate: modeDefinition.social.supportsSpectate,
                    supportsReplay: modeDefinition.social.supportsReplay
                },
                battleRoyaleState: {
                    enabled: modeDefinition.gameplay.battleRoyale.enabled,
                    safeRect: { ...battleZoneRuntime.safeRect },
                    damagePerSecond: battleZoneRuntime.damagePerSecond,
                    suddenDeath: battleZoneRuntime.suddenDeath,
                    noRespawn: modeDefinition.gameplay.battleRoyale.enabled,
                    availableShieldStations: battleRoyaleShieldStations.filter((station) => station.available).length,
                    shieldCharge: Number(battleRoyaleShieldCharge.toFixed(2)),
                    shieldMaxCharge: Number(battleRoyaleShieldMaxCharge.toFixed(2)),
                    shieldSecondsRemaining: Number(battleRoyaleShieldSecondsRemaining.toFixed(2)),
                    spikeChains: battleRoyaleRuntime?.spikeChains.length ?? 0
                }
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
        debugSetBestMassRecord,
        debugSetBattleZone
    };
}
