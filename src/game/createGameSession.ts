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
import { gameplayTuning } from '../gameplay/tuning';
import { TuningToolbox } from '../ui/TuningToolbox';
import type { LobbyModeId } from '../ui/LobbyUI';
import { GameAudioManager } from '../audio/GameAudioManager';

const WORLD_SIZE = 6000;
const DEFAULT_FOOD_COUNT = 1200;
const DEFAULT_VIRUS_COUNT = 12;
const MAX_VIRUS_COUNT = 64;
const BOT_COUNT = 49;
const LEADERBOARD_SIZE = 10;
const MATCH_DURATION_SECONDS = 6 * 60;
const BEST_MASS_RECORD_KEY = 'bop:best-mass-record';

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
    resultWinnerEl: HTMLDivElement;
    resultMassEl: HTMLDivElement;
    resultBestEl: HTMLDivElement;
    resultRecordBannerEl: HTMLDivElement;
    resultBallEl: HTMLDivElement;
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
    let bestMassRecord = loadBestMassRecord();
    let lastPlayerSpikeEventId = 0;

    function ensureMounted() {
        if (!sessionRoot || !worldRoot || !hudRefs) {
            throw new Error('Game session must be mounted before use.');
        }
    }

    function loadBestMassRecord(): number {
        try {
            const raw = window.localStorage.getItem(BEST_MASS_RECORD_KEY);
            const parsed = raw ? Number.parseInt(raw, 10) : 0;
            return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
        } catch {
            return 0;
        }
    }

    function saveBestMassRecord(value: number) {
        try {
            window.localStorage.setItem(BEST_MASS_RECORD_KEY, String(Math.max(0, Math.floor(value))));
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
            <div class="hud-debug-tip" data-debug-tip>开发模式接口：结束当前局、强制胜负、新纪录预览、历史纪录读写。</div>
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
                'window.render_game_to_text()',
                'window.advanceTime(ms)'
            ].join('\n');
            try {
                await navigator.clipboard.writeText(apiText);
                setDebugTip('调试接口已复制到剪贴板。');
            } catch {
                setDebugTip('复制失败，请手动查看控制台接口：window.debug_finish_match / window.debug_set_best_record');
            }
        });

        const resultOverlay = document.createElement('div');
        resultOverlay.className = 'match-result-overlay';
        resultOverlay.innerHTML = `
            <div class="match-result-panel">
                <div class="match-result-kicker">对局结算</div>
                <h2 class="match-result-title" data-result-title>比赛结束</h2>
                <div class="match-result-subtitle" data-result-subtitle>正在统计结果...</div>
                <div class="match-result-ball-stage">
                    <div class="match-result-burst"></div>
                    <div class="match-result-ball" data-result-ball></div>
                </div>
                <div class="match-result-stats">
                    <div class="match-result-stat">
                        <span>本局体重</span>
                        <strong data-result-mass>0 kg</strong>
                    </div>
                    <div class="match-result-stat">
                        <span>历史纪录</span>
                        <strong data-result-best>0 kg</strong>
                    </div>
                    <div class="match-result-stat">
                        <span>胜出方</span>
                        <strong data-result-winner>--</strong>
                    </div>
                </div>
                <div class="match-record-banner" data-result-record-banner>新纪录达成！</div>
                <div class="match-result-actions">
                    <button type="button" class="hud-action-button hud-action-button--secondary" data-result-lobby>返回大厅</button>
                    <button type="button" class="hud-action-button match-result-replay" data-result-replay>再来一局</button>
                </div>
            </div>
        `;
        root.appendChild(resultOverlay);

        const resultTitleEl = resultOverlay.querySelector<HTMLHeadingElement>('[data-result-title]');
        const resultSubEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-subtitle]');
        const resultWinnerEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-winner]');
        const resultMassEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-mass]');
        const resultBestEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-best]');
        const resultRecordBannerEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-record-banner]');
        const resultBallEl = resultOverlay.querySelector<HTMLDivElement>('[data-result-ball]');

        if (!resultTitleEl || !resultSubEl || !resultWinnerEl || !resultMassEl || !resultBestEl || !resultRecordBannerEl || !resultBallEl) {
            throw new Error('Failed to initialize match result overlay.');
        }

        resultOverlay.querySelector<HTMLButtonElement>('[data-result-lobby]')?.addEventListener('click', () => {
            hideMatchResultOverlay();
            stop();
            options.onReturnToLobby();
        });

        resultOverlay.querySelector<HTMLButtonElement>('[data-result-replay]')?.addEventListener('click', () => {
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
            resultWinnerEl,
            resultMassEl,
            resultBestEl,
            resultRecordBannerEl,
            resultBallEl
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
        lastPlayerSpikeEventId = 0;

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
        hudRefs.resultOverlay.classList.remove('is-visible', 'is-record', 'is-win');
    }

    function finalizeTimedMatch(now = performance.now(), debugOptions: DebugMatchFinishOptions = {}) {
        if (matchFinished || !player || !hudRefs) {
            return;
        }

        const allControllers = [player, ...bots];
        const forcedWinner = debugOptions.winner ?? 'auto';
        const overridePlayerMass = typeof debugOptions.playerMass === 'number' && Number.isFinite(debugOptions.playerMass)
            ? Math.max(gameplayTuning.limits.min_cell_mass, Math.floor(debugOptions.playerMass))
            : null;
        const rawPlayerMass = getControllerMass(player);
        const playerMass = overridePlayerMass ?? rawPlayerMass;
        const playerMassDelta = playerMass - rawPlayerMass;
        let resultSubtitle = modeConfig.timed
            ? `${modeConfig.durationSeconds / 60} 分钟结束，按体重排名结算。`
            : '开发者手动结束当前对局，按当前排名结算。';

        if (modeConfig.teamMode) {
            let teamATotal = 0;
            let teamBTotal = 0;

            allControllers.forEach((controller, index) => {
                const mass = getControllerMass(controller);
                const isTeamA = index === 0 || index % 2 === 0;
                if (isTeamA) {
                    teamATotal += mass;
                } else {
                    teamBTotal += mass;
                }
            });

            const teamATotalForResult = teamATotal + playerMassDelta;
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
            const ranked = allControllers
                .map((controller) => ({
                    controller,
                    mass: controller === player ? playerMass : getControllerMass(controller)
                }))
                .sort((a, b) => b.mass - a.mass);

            let winner = ranked[0];
            if (forcedWinner === 'player') {
                winner = ranked.find((entry) => entry.controller === player) ?? winner;
            } else if (forcedWinner === 'bot') {
                winner = ranked.find((entry) => entry.controller !== player) ?? winner;
            }

            if (winner) {
                const winnerName = winner.controller === player
                    ? resolvePlayerDisplayName(settings.playerName)
                    : (winner.controller as Bot).name;
                winnerLabel = `${winnerName} ${winner.mass}kg`;
                playerWon = winner.controller === player;
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
        if (isNewRecord) {
            bestMassRecord = naturallyNewRecord
                ? playerMass
                : Math.max(playerMass, previousBest + 1);
            saveBestMassRecord(bestMassRecord);
        }

        hudRefs.resultTitleEl.textContent = playerWon ? '胜利！' : '比赛结束';
        hudRefs.resultSubEl.textContent = resultSubtitle;
        hudRefs.resultWinnerEl.textContent = winnerLabel;
        hudRefs.resultMassEl.textContent = `${playerMass} kg`;
        hudRefs.resultBestEl.textContent = `${bestMassRecord} kg`;
        hudRefs.resultRecordBannerEl.style.display = isNewRecord ? 'block' : 'none';

        const ballScale = Math.max(0, Math.min(1, Math.log(playerMass + 1) / Math.log(16000)));
        const ballSize = 108 + ballScale * 180;
        hudRefs.resultBallEl.style.setProperty('--result-ball-size', `${ballSize.toFixed(0)}px`);
        hudRefs.resultBallEl.style.setProperty('--result-ball-glow', `${(0.42 + ballScale * 0.33).toFixed(2)}`);

        hudRefs.resultOverlay.classList.add('is-visible');
        hudRefs.resultOverlay.classList.toggle('is-record', isNewRecord);
        hudRefs.resultOverlay.classList.toggle('is-win', playerWon);
        matchFinished = true;
        stop();

        // Keep snapshot clock stable at match end.
        const frozenElapsedSeconds = modeConfig.timed ? modeConfig.durationSeconds : getElapsedSeconds(now);
        gameStartTime = now - frozenElapsedSeconds * 1000;
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
            match: {
                modeId: modeConfig.id,
                modeName: modeConfig.name,
                timed: modeConfig.timed,
                durationSeconds: modeConfig.durationSeconds,
                remainingSeconds,
                isFinished: matchFinished,
                winnerLabel,
                playerWon,
                bestMassRecord
            }
        };
    }

    function advanceTime(ms: number) {
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
