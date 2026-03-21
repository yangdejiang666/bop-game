import type { GameSettings } from '../app/settings';
import type { LobbyIconId } from './icons';
import {
    type PlayerProgression,
    getRequiredXpForLevel,
    loadPlayerProgression
} from '../app/progression';

export type LobbyModeId = 'ranked' | 'peak' | 'classic' | 'speed' | 'team' | 'battleRoyale';

interface LobbyUIOptions {
    settings: GameSettings;
    onOpenModeHall: (modeId: LobbyModeId) => void;
    onSettingsChange: (settings: GameSettings) => void;
    onSettingsOpened: () => void;
    onSettingsClosed: () => void;
}

interface ModeOption {
    id: LobbyModeId;
    name: string;
    subtitle: string;
    iconId: LobbyIconId;
    theme: 'gold' | 'violet' | 'cyan' | 'amber' | 'purple' | 'red';
    status: string;
    footerHint: string;
    playable: boolean;
}

type LobbyFeatureId = 'shop' | 'magic' | 'friends' | 'leaderboard';

interface SkinOption {
    id: string;
    name: string;
    colorA: string;
    colorB: string;
    glow: string;
}

const MAX_PLAYER_NAME_LENGTH = 12;
const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024;

const SKIN_OPTIONS: SkinOption[] = [
    {
        id: 'classic_blue',
        name: '经典蓝',
        colorA: '#3ec5ff',
        colorB: '#1f6dff',
        glow: 'rgba(46, 174, 255, 0.48)'
    },
    {
        id: 'mint_pop',
        name: '薄荷泡泡',
        colorA: '#56ffc0',
        colorB: '#1ac788',
        glow: 'rgba(40, 236, 169, 0.45)'
    },
    {
        id: 'sunset_lava',
        name: '熔岩余晖',
        colorA: '#ffcf66',
        colorB: '#ff6b4a',
        glow: 'rgba(255, 145, 87, 0.48)'
    },
    {
        id: 'neon_violet',
        name: '霓虹紫电',
        colorA: '#d18bff',
        colorB: '#7657ff',
        glow: 'rgba(154, 120, 255, 0.48)'
    },
    {
        id: 'carbon_shadow',
        name: '碳素暗影',
        colorA: '#8aa0bf',
        colorB: '#3e4f66',
        glow: 'rgba(132, 163, 204, 0.38)'
    }
];

const LOBBY_MODE_ORDER: LobbyModeId[] = [
    'ranked',
    'classic',
    'speed',
    'team',
    'peak',
    'battleRoyale'
];

const MODE_SYMBOLS: Record<LobbyModeId, string> = {
    ranked: 'trophy',
    peak: 'social_leaderboard',
    classic: 'deployed_code',
    speed: 'bolt',
    team: 'groups',
    battleRoyale: 'radio_button_checked'
};

const FEATURE_SYMBOLS: Record<LobbyFeatureId, string> = {
    shop: 'storefront',
    magic: 'auto_awesome',
    friends: 'group',
    leaderboard: 'leaderboard'
};

const TASK_PRESETS = [
    { icon: 'radio_button_checked', title: '累计吞噬 500 个小球', progress: '376 / 500', ratio: 0.752 },
    { icon: 'social_leaderboard', title: '获得 1 场排位赛胜利', progress: '0 / 1', ratio: 0 }
] as const;

const FRIEND_PRESETS = [
    { name: 'Pixie', status: '在线', accent: '#81ecff' },
    { name: 'Glitch', status: '组队中', accent: '#c37fff' },
    { name: 'Void', status: '空闲', accent: '#ffe483' }
] as const;

const LOBBY_HIGHLIGHTS: Array<{
    feature: LobbyFeatureId;
    symbol: string;
    kicker: string;
    title: string;
    subtitle: string;
    theme: 'cyan' | 'gold' | 'violet';
}> = [
    {
        feature: 'shop',
        symbol: 'blur_on',
        kicker: '限时新品',
        title: '幻彩晶核整备场',
        subtitle: '查看详情',
        theme: 'violet'
    },
    {
        feature: 'magic',
        symbol: 'timer',
        kicker: '限时模式',
        title: '重力漂流 · 压缩开局',
        subtitle: '立即加入',
        theme: 'gold'
    },
    {
        feature: 'leaderboard',
        symbol: 'confirmation_number',
        kicker: '赛季通行证',
        title: '提升等级赢取成长奖励',
        subtitle: 'Lv.1 / 100',
        theme: 'cyan'
    }
];

function renderMaterialSymbol(symbol: string, className: string) {
    return `<span class="material-symbols-outlined ${className}" aria-hidden="true">${symbol}</span>`;
}

export class LobbyUI {
    private root: HTMLDivElement;
    private settings: GameSettings;
    private progression: PlayerProgression;
    private readonly options: LobbyUIOptions;
    private readonly keydownHandler: (event: KeyboardEvent) => void;
    private readonly modeOptions: Record<LobbyModeId, ModeOption>;
    private selectedModeId: LobbyModeId;
    private previewCanvas: HTMLCanvasElement | null = null;
    private previewCtx: CanvasRenderingContext2D | null = null;
    private previewFrameId: number | null = null;
    private previewAvatarImage: HTMLImageElement | null = null;
    private previewAvatarSrc = '';
    private tipTimer: number | null = null;
    private selectedFeatureId: LobbyFeatureId | null = 'shop';

    constructor(options: LobbyUIOptions) {
        this.options = options;
        this.settings = { ...options.settings };
        this.progression = loadPlayerProgression();
        this.modeOptions = {
            ranked: {
                id: 'ranked',
                name: '排位赛',
                subtitle: '积分晋级 · 赛季结算',
                iconId: 'mode_ranked',
                theme: 'gold',
                status: '已开放',
                footerHint: '排位赛为 6 分钟限时，点击开始会先进入匹配阶段。',
                playable: true
            },
            peak: {
                id: 'peak',
                name: '巅峰赛',
                subtitle: '高分对抗 · 顶尖段位',
                iconId: 'mode_peak',
                theme: 'violet',
                status: '测试中',
                footerHint: '巅峰赛当前为测试匹配池，点击开始会先进入匹配阶段。',
                playable: true
            },
            classic: {
                id: 'classic',
                name: '经典模式',
                subtitle: '自由吞噬 · 单机可玩',
                iconId: 'mode_classic',
                theme: 'cyan',
                status: '已开放',
                footerHint: '经典模式点击开始会先进入匹配阶段，再进入对局。',
                playable: true
            },
            speed: {
                id: 'speed',
                name: '极速模式',
                subtitle: '高节奏成长 · 快速对抗',
                iconId: 'mode_speed',
                theme: 'amber',
                status: '测试中',
                footerHint: '极速模式正在调试节奏，点击开始会先进入匹配阶段。',
                playable: true
            },
            team: {
                id: 'team',
                name: '团队模式',
                subtitle: '队伍配合 · 吐球协同',
                iconId: 'mode_team',
                theme: 'purple',
                status: '已开放',
                footerHint: '团队模式为 6 分钟限时，点击开始会先进行队伍匹配。',
                playable: true
            },
            battleRoyale: {
                id: 'battleRoyale',
                name: '大逃杀',
                subtitle: '缩圈生存 · 极限翻盘',
                iconId: 'mode_battleRoyale',
                theme: 'red',
                status: '测试中',
                footerHint: '大逃杀当前为测试模式，点击开始会先进入匹配阶段。',
                playable: true
            }
        };
        this.selectedModeId = 'classic';

        this.root = document.createElement('div');
        this.root.className = 'lobby-overlay';
        this.root.innerHTML = this.buildTemplate();

        this.previewCanvas = this.root.querySelector<HTMLCanvasElement>('[data-preview-canvas]');
        this.previewCtx = this.previewCanvas?.getContext('2d') ?? null;

        this.keydownHandler = (event) => {
            if (event.key === 'Escape' && this.root.classList.contains('is-settings-open')) {
                this.closeSettings();
            }
        };

        this.bindEvents();
        this.applySettingsToForm();
        this.applySelectedModeUI();
        this.applyFeatureSelection();
        this.startPreviewLoop();
    }

    mount(parent: HTMLElement) {
        parent.appendChild(this.root);
        window.addEventListener('keydown', this.keydownHandler);
    }

    destroy() {
        window.removeEventListener('keydown', this.keydownHandler);
        this.stopPreviewLoop();
        if (this.tipTimer !== null) {
            window.clearTimeout(this.tipTimer);
            this.tipTimer = null;
        }
        this.root.remove();
    }

    showLobby() {
        this.refreshProgression();
        this.setSkinDrawerOpen(false);
        this.root.classList.add('is-visible');
        this.root.classList.remove('is-modal-only', 'is-settings-open');
        const shell = this.root.querySelector<HTMLElement>('.lobby-shell');
        if (shell) {
            shell.scrollTop = 0;
        }
        const main = this.root.querySelector<HTMLElement>('.lobby-main--v2');
        if (main) {
            main.scrollTop = 0;
        }
        const tip = this.root.querySelector<HTMLElement>('[data-inline-tip]');
        if (tip) {
            tip.textContent = '选择模式后可进入对应分厅，匹配入口在分厅内触发。';
        }
        (document.activeElement as HTMLElement | null)?.blur();
    }

    hideAll() {
        this.root.classList.remove('is-visible', 'is-modal-only', 'is-settings-open');
    }

    openSettings(modalOnly: boolean) {
        this.setSkinDrawerOpen(false);
        this.root.classList.add('is-visible', 'is-settings-open');
        this.root.classList.toggle('is-modal-only', modalOnly);
        this.options.onSettingsOpened();
        this.root.querySelector<HTMLInputElement>('input[name="playerName"]')?.focus();
    }

    setSettings(settings: GameSettings) {
        this.settings = { ...settings };
        this.applySettingsToForm();
    }

    refreshProgression() {
        this.progression = loadPlayerProgression();
        this.applyProgressionToView();
    }

    private buildTemplate(): string {
        return `
            <div class="lobby-backdrop">
                <div class="lobby-orb lobby-orb--one"></div>
                <div class="lobby-orb lobby-orb--two"></div>
                <div class="lobby-orb lobby-orb--three"></div>
            </div>

            <div class="lobby-shell lobby-shell--v2">
                <header class="lobby-topbar lobby-dashboard-topbar">
                    <div class="lobby-dashboard-brand">
                        <div class="lobby-dashboard-brand-mark">BOP</div>
                        <div class="lobby-dashboard-brand-copy">
                            <div class="lobby-dashboard-brand-kicker">球球实验室</div>
                            <div class="lobby-brand-title">球球竞技大厅</div>
                            <div class="lobby-brand-subtitle">模式选择 · 个人资料 · 装扮预览</div>
                        </div>
                    </div>

                    <div class="lobby-resource-strip">
                        <article class="lobby-resource-chip">
                            <span class="lobby-resource-chip-icon">
                                ${renderMaterialSymbol('monetization_on', 'lobby-resource-symbol')}
                            </span>
                            <div class="lobby-resource-copy">
                                <small>金币</small>
                                <strong data-progression-coins>0</strong>
                            </div>
                        </article>
                        <article class="lobby-resource-chip">
                            <span class="lobby-resource-chip-icon">
                                ${renderMaterialSymbol('diamond', 'lobby-resource-symbol')}
                            </span>
                            <div class="lobby-resource-copy">
                                <small>经验</small>
                                <strong data-progression-xp-display>0 / 208 XP</strong>
                            </div>
                        </article>
                    </div>

                    <div class="lobby-top-actions">
                        <button type="button" class="lobby-icon-button" data-top-action="activity" aria-label="活动中心">
                            ${renderMaterialSymbol('notifications', 'lobby-icon-button-symbol')}
                        </button>
                        <button type="button" class="lobby-icon-button" data-open-settings aria-label="打开设置">
                            ${renderMaterialSymbol('settings', 'lobby-icon-button-symbol')}
                        </button>
                        <button type="button" class="lobby-top-avatar-button" data-avatar-trigger aria-label="上传头像">
                            <span class="lobby-avatar-slot" data-avatar-slot>
                                <img class="lobby-avatar-img" data-avatar-img alt="头像" />
                                <span class="lobby-avatar-fallback" data-avatar-fallback>球</span>
                            </span>
                            <span class="lobby-top-avatar-online"></span>
                        </button>
                    </div>
                </header>

                <main class="lobby-main--v2 lobby-dashboard-main">
                    <aside class="lobby-hero-column">
                        <section class="lobby-hero-card">
                            <div class="lobby-hero-card-head">
                                <div class="lobby-hero-rankline">
                                    <div class="lobby-hero-kicker-wrap">
                                        <span class="lobby-hero-kicker-dot"></span>
                                        <span class="lobby-hero-kicker">ELITE RANK</span>
                                    </div>
                                    <span class="lobby-rank-chip">
                                        <span data-progression-level>LV. 1</span>
                                    </span>
                                </div>
                                <div class="lobby-hero-name-row">
                                    <strong data-player-name>未命名玩家</strong>
                                </div>
                                <div class="lobby-hero-meta-row">
                                    <span class="lobby-status-dot">在线</span>
                                </div>
                            </div>

                            <div class="lobby-hero-stage-shell">
                                <div class="lobby-hero-stage-ring lobby-hero-stage-ring--outer"></div>
                                <div class="lobby-hero-stage-ring lobby-hero-stage-ring--mid"></div>
                                <div class="lobby-hero-stage-ring lobby-hero-stage-ring--inner"></div>
                                <div class="lobby-hero-stage-axis lobby-hero-stage-axis--v-top"></div>
                                <div class="lobby-hero-stage-axis lobby-hero-stage-axis--v-bottom"></div>
                                <div class="lobby-hero-stage-axis lobby-hero-stage-axis--h-left"></div>
                                <div class="lobby-hero-stage-axis lobby-hero-stage-axis--h-right"></div>
                                <div class="lobby-hero-stage-scanline"></div>
                                <div class="lobby-hero-stage-badge">
                                    ${renderMaterialSymbol('bolt', 'lobby-hero-stage-badge-symbol')}
                                </div>
                                <canvas class="lobby-preview-canvas" width="420" height="560" data-preview-canvas></canvas>
                            </div>

                            <div class="lobby-hero-stats">
                                <article class="lobby-hero-stat-card is-primary">
                                    <small>WIN RATE</small>
                                    <strong data-progression-winrate>0%</strong>
                                </article>
                                <article class="lobby-hero-stat-card is-secondary">
                                    <small>TOTAL MASS</small>
                                    <strong data-progression-best-mass>0 kg</strong>
                                </article>
                            </div>

                            <div class="lobby-hero-actions">
                                <button type="button" class="lobby-start-button lobby-start-button--compact" data-toggle-skins aria-expanded="false">SKINS / CUSTOMIZE</button>
                            </div>

                            <div class="lobby-skin-drawer" data-skin-drawer>
                                <div class="lobby-skin-drawer-head">
                                    <strong>装扮投影预览</strong>
                                    <small>昵称、头像、皮肤实时联动</small>
                                </div>
                                <div class="lobby-skin-strip" role="group" aria-label="皮肤选择">
                                    ${this.buildSkinButtons('main')}
                                </div>
                            </div>
                        </section>

                        <button type="button" class="lobby-season-card" data-feature="leaderboard">
                            <span class="lobby-season-card-icon">
                                ${renderMaterialSymbol('deployed_code_history', 'lobby-season-card-symbol')}
                            </span>
                            <span class="lobby-season-card-copy">
                                <strong>SEASON 12: CYBER NEON</strong>
                                <small>New skins and limited modes.</small>
                            </span>
                        </button>
                    </aside>

                    <section class="lobby-dashboard-stack">
                        <section class="lobby-mode-panel--v2 lobby-dashboard-panel">
                            <div class="lobby-panel-head lobby-panel-head--dashboard">
                                <div>
                                    <strong>模式选择</strong>
                                    <small>六模式入口，全部支持匹配，可按模式测试手感</small>
                                </div>
                                <span class="lobby-tag lobby-tag--muted" data-mode-status>已开放</span>
                            </div>
                            <div class="lobby-mode-grid--v2 lobby-mode-grid--dashboard">
                                ${this.buildModeCards()}
                            </div>
                        </section>

                        <div class="lobby-insight-row">
                            <section class="lobby-dashboard-panel lobby-task-card">
                                <div class="lobby-panel-head lobby-panel-head--dashboard">
                                    <div>
                                        <strong>每日任务</strong>
                                        <small>今日进度与实验目标</small>
                                    </div>
                                    <span class="lobby-mini-chip">2 / 5 已完成</span>
                                </div>
                                <div class="lobby-task-list">
                                    ${this.buildTaskRows()}
                                </div>
                            </section>

                            <section class="lobby-dashboard-panel lobby-friends-card">
                                <div class="lobby-panel-head lobby-panel-head--dashboard">
                                    <div>
                                        <strong>好友在线</strong>
                                        <small>当前有 3 位好友可互动</small>
                                    </div>
                                    <button type="button" class="lobby-link-button" data-feature="friends">查看全部</button>
                                </div>
                                <div class="lobby-friends-strip">
                                    ${this.buildFriendItems()}
                                </div>
                            </section>
                        </div>

                        <section class="lobby-cta-panel lobby-dashboard-panel">
                            <div class="lobby-cta-copy">
                                <span class="lobby-cta-kicker" data-mode-cta-status>已开放</span>
                                <strong data-selected-mode>经典模式</strong>
                                <small data-selected-mode-hint>经典模式点击开始会先进入匹配阶段，再进入对局。</small>
                            </div>
                            <div class="lobby-cta-actions">
                                <button type="button" class="lobby-start-button lobby-dashboard-cta" data-start-game>进入经典模式分厅</button>
                                <button type="button" class="lobby-cta-invite-button" data-feature="friends">
                                    ${renderMaterialSymbol('rocket_launch', 'lobby-cta-invite-symbol')}
                                </button>
                            </div>
                            <div class="lobby-cta-social">
                                <div class="lobby-cta-avatar-cluster">
                                    ${this.buildFriendCluster()}
                                </div>
                                <button type="button" class="lobby-cta-social-button" data-feature="friends">邀请好友</button>
                            </div>
                        </section>
                    </section>
                </main>

                <footer class="lobby-bottom--v2 lobby-dock-shell">
                    <div class="lobby-highlight-strip">
                        ${this.buildHighlightCards()}
                    </div>
                    <div class="lobby-feature-strip lobby-feature-strip--dock">
                        <button type="button" class="lobby-feature-button" data-feature="shop">
                            ${renderMaterialSymbol(FEATURE_SYMBOLS.shop, 'lobby-feature-symbol')}
                            <span>商店</span>
                        </button>
                        <button type="button" class="lobby-feature-button" data-feature="magic">
                            ${renderMaterialSymbol(FEATURE_SYMBOLS.magic, 'lobby-feature-symbol')}
                            <span>魔法屋</span>
                        </button>
                        <button type="button" class="lobby-feature-button" data-feature="friends">
                            ${renderMaterialSymbol(FEATURE_SYMBOLS.friends, 'lobby-feature-symbol')}
                            <span>好友</span>
                        </button>
                        <button type="button" class="lobby-feature-button" data-feature="leaderboard">
                            ${renderMaterialSymbol(FEATURE_SYMBOLS.leaderboard, 'lobby-feature-symbol')}
                            <span>排行榜</span>
                        </button>
                    </div>
                    <div class="lobby-inline-tip" data-inline-tip aria-live="polite">选择模式后可进入对应分厅，匹配入口在分厅内触发。</div>
                </footer>
            </div>

            <input type="file" accept="image/*" data-avatar-input class="lobby-hidden-file-input" />

            <div class="settings-overlay">
                <div class="settings-panel settings-panel--v2" role="dialog" aria-modal="true" aria-labelledby="settings-title">
                    <div class="settings-header">
                        <div>
                            <div class="settings-kicker">本地设置</div>
                            <h2 id="settings-title">账号与对局配置</h2>
                        </div>
                        <button type="button" class="settings-close" data-close-settings aria-label="关闭设置">×</button>
                    </div>

                    <div class="settings-avatar-row">
                        <div class="settings-avatar-slot" data-avatar-slot>
                            <img class="lobby-avatar-img" data-avatar-img alt="头像" />
                            <span class="lobby-avatar-fallback" data-avatar-fallback>球</span>
                        </div>
                        <div class="settings-avatar-actions">
                            <button type="button" class="lobby-ghost-button lobby-ghost-button--compact" data-avatar-trigger>上传头像</button>
                            <button type="button" class="lobby-ghost-button lobby-ghost-button--compact" data-avatar-clear>清空头像</button>
                        </div>
                    </div>

                    <label class="settings-field">
                        <span>玩家昵称</span>
                        <input type="text" name="playerName" maxlength="${MAX_PLAYER_NAME_LENGTH}" />
                    </label>

                    <div class="settings-skin-area">
                        <div class="settings-field-title">皮肤预设</div>
                        <div class="lobby-skin-strip lobby-skin-strip--settings" role="group" aria-label="设置皮肤">
                            ${this.buildSkinButtons('settings')}
                        </div>
                    </div>

                    <div class="settings-grid">
                        <label class="settings-toggle">
                            <input type="checkbox" name="showFps" />
                            <span>显示 FPS</span>
                        </label>
                        <label class="settings-toggle">
                            <input type="checkbox" name="showMinimap" />
                            <span>显示小地图</span>
                        </label>
                        <label class="settings-toggle">
                            <input type="checkbox" name="showLeaderboard" />
                            <span>显示排行榜</span>
                        </label>
                        <label class="settings-toggle">
                            <input type="checkbox" name="developerMode" />
                            <span>开发者模式（显示调参工具箱）</span>
                        </label>
                        <label class="settings-toggle settings-toggle--wide">
                            <input type="checkbox" name="reducedMotion" />
                            <span>减少动效</span>
                        </label>
                    </div>

                    <div class="settings-footer">
                        <p>设置保存在本地浏览器，刷新后仍会保留。</p>
                        <button type="button" class="lobby-start-button lobby-start-button--small" data-close-settings>完成</button>
                    </div>
                </div>
            </div>
        `;
    }

    private buildModeCards(): string {
        return LOBBY_MODE_ORDER.map((modeId) => {
            const mode = this.modeOptions[modeId];
            const disabledClass = mode.playable ? '' : ' is-disabled';
            const activeClass = mode.id === this.selectedModeId ? ' is-active' : '';
            const themeClass = ` is-theme-${mode.theme}`;
            const sizeClass = mode.id === 'peak' || mode.id === 'battleRoyale'
                ? ' is-wide'
                : ' is-primary';
            const statusClass = mode.status === '已开放'
                ? ' is-open'
                : mode.status === '测试中'
                    ? ' is-testing'
                    : ' is-locked';
            return `
                <article
                    class="lobby-mode-card--v2${disabledClass}${activeClass}${themeClass}${sizeClass}"
                    data-mode-id="${mode.id}"
                    tabindex="0"
                    role="button"
                    aria-label="选择${mode.name}"
                >
                    <div class="lobby-mode-card-head">
                        <div class="lobby-mode-title-wrap">
                            <span class="lobby-mode-icon">
                                ${renderMaterialSymbol(MODE_SYMBOLS[mode.id], 'lobby-mode-icon-symbol')}
                            </span>
                            <strong>${mode.name}</strong>
                        </div>
                        <span class="lobby-mode-status-badge${statusClass}">${mode.status}</span>
                    </div>
                    <p>${mode.subtitle}</p>
                </article>
            `;
        }).join('');
    }

    private buildSkinButtons(group: 'main' | 'settings'): string {
        return SKIN_OPTIONS.map((skin) => `
            <button
                type="button"
                class="lobby-skin-chip"
                data-skin-id="${skin.id}"
                data-skin-group="${group}"
                style="--skin-a:${skin.colorA};--skin-b:${skin.colorB};--skin-glow:${skin.glow};"
            >
                <span class="lobby-skin-chip-dot"></span>
                <span>${skin.name}</span>
            </button>
        `).join('');
    }

    private buildFriendCluster(): string {
        return FRIEND_PRESETS.map((friend) => `
            <span class="lobby-cta-avatar" style="--friend-accent:${friend.accent}">
                ${friend.name.slice(0, 1)}
            </span>
        `).join('');
    }

    private buildHighlightCards(): string {
        return LOBBY_HIGHLIGHTS.map((item) => `
            <button type="button" class="lobby-highlight-card is-theme-${item.theme}" data-feature="${item.feature}">
                <span class="lobby-highlight-icon">
                    ${renderMaterialSymbol(item.symbol, 'lobby-highlight-symbol')}
                </span>
                <span class="lobby-highlight-copy">
                    <small>${item.kicker}</small>
                    <strong>${item.title}</strong>
                    <em>${item.subtitle}</em>
                </span>
            </button>
        `).join('');
    }

    private buildTaskRows(): string {
        return TASK_PRESETS.map((task) => `
            <article class="lobby-task-row">
                <span class="lobby-task-icon">
                    ${renderMaterialSymbol(task.icon, 'lobby-task-symbol')}
                </span>
                <div class="lobby-task-copy">
                    <strong>${task.title}</strong>
                    <div class="lobby-task-progress">
                        <div class="lobby-task-progress-fill" style="width:${(task.ratio * 100).toFixed(1)}%"></div>
                    </div>
                </div>
                <span class="lobby-task-meta">${task.progress}</span>
            </article>
        `).join('');
    }

    private buildFriendItems(): string {
        return FRIEND_PRESETS.map((friend) => `
            <article class="lobby-friend-pill">
                <span class="lobby-friend-avatar" style="--friend-accent:${friend.accent};">${friend.name.charAt(0)}</span>
                <strong>${friend.name}</strong>
                <small>${friend.status}</small>
            </article>
        `).join('');
    }

    private bindEvents() {
        this.root.querySelectorAll<HTMLElement>('[data-open-settings]').forEach((element) => {
            element.addEventListener('click', () => this.openSettings(false));
        });

        this.root.querySelectorAll<HTMLElement>('[data-toggle-skins]').forEach((element) => {
            element.addEventListener('click', () => {
                const next = !this.root.classList.contains('is-skin-drawer-open');
                this.setSkinDrawerOpen(next);
            });
        });

        this.root.querySelectorAll<HTMLElement>('[data-top-action]').forEach((element) => {
            element.addEventListener('click', () => {
                this.showFeatureTip('活动中心正在整理新的实验任务与限时挑战。');
            });
        });

        this.root.querySelectorAll<HTMLElement>('[data-close-settings]').forEach((element) => {
            element.addEventListener('click', () => this.closeSettings());
        });

        this.root.querySelector<HTMLElement>('.settings-overlay')?.addEventListener('click', (event) => {
            if (event.target === event.currentTarget) {
                this.closeSettings();
            }
        });

        this.root.querySelector<HTMLElement>('[data-start-game]')?.addEventListener('click', () => {
            const mode = this.modeOptions[this.selectedModeId];
            if (!mode.playable) {
                this.root.classList.add('is-mode-locked');
                window.setTimeout(() => this.root.classList.remove('is-mode-locked'), 240);
                this.showFeatureTip(`${mode.name} 当前不可用，请稍后重试。`);
                return;
            }

            this.hideAll();
            this.options.onOpenModeHall(this.selectedModeId);
        });

        this.root.querySelectorAll<HTMLElement>('[data-mode-id]').forEach((card) => {
            card.addEventListener('click', () => {
                const modeId = card.dataset.modeId || 'classic';
                if (modeId === this.selectedModeId) {
                    this.hideAll();
                    this.options.onOpenModeHall(this.selectedModeId);
                    return;
                }
                this.selectMode(modeId);
            });
            card.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    const modeId = card.dataset.modeId || 'classic';
                    if (modeId === this.selectedModeId) {
                        this.hideAll();
                        this.options.onOpenModeHall(this.selectedModeId);
                        return;
                    }
                    this.selectMode(modeId);
                }
            });
        });

        this.root.addEventListener('pointermove', (event) => {
            if (this.settings.reducedMotion) return;
            const rect = this.root.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / rect.width - 0.5) * 12;
            const y = ((event.clientY - rect.top) / rect.height - 0.5) * 12;
            this.root.style.setProperty('--parallax-x', `${x.toFixed(2)}px`);
            this.root.style.setProperty('--parallax-y', `${y.toFixed(2)}px`);
        });

        this.root.addEventListener('pointerleave', () => {
            this.root.style.setProperty('--parallax-x', '0px');
            this.root.style.setProperty('--parallax-y', '0px');
        });

        const quickNameInput = this.root.querySelector<HTMLInputElement>('[data-quick-name]');
        quickNameInput?.addEventListener('input', () => {
            this.updateSettings({ playerName: this.normalizePlayerName(quickNameInput.value) });
        });

        const settingsNameInput = this.root.querySelector<HTMLInputElement>('input[name="playerName"]');
        settingsNameInput?.addEventListener('input', () => {
            this.updateSettings({ playerName: this.normalizePlayerName(settingsNameInput.value) });
        });

        const toggles = ['showFps', 'showMinimap', 'showLeaderboard', 'developerMode', 'reducedMotion'] as const;
        toggles.forEach((toggleName) => {
            this.root.querySelector<HTMLInputElement>(`input[name="${toggleName}"]`)?.addEventListener('change', (event) => {
                const target = event.currentTarget as HTMLInputElement;
                this.updateSettings({ [toggleName]: target.checked } as Partial<GameSettings>);
            });
        });

        const avatarInput = this.root.querySelector<HTMLInputElement>('[data-avatar-input]');
        this.root.querySelectorAll<HTMLElement>('[data-avatar-trigger]').forEach((button) => {
            button.addEventListener('click', () => avatarInput?.click());
        });

        avatarInput?.addEventListener('change', async () => {
            const file = avatarInput.files?.[0];
            if (!file) return;

            if (!file.type.startsWith('image/')) {
                this.showFeatureTip('请上传图片文件。');
                avatarInput.value = '';
                return;
            }

            if (file.size > MAX_AVATAR_SIZE_BYTES) {
                this.showFeatureTip('头像文件过大，请选择 2MB 以内图片。');
                avatarInput.value = '';
                return;
            }

            try {
                const dataUrl = await this.readFileAsDataUrl(file);
                this.updateSettings({ avatarDataUrl: dataUrl });
                this.showFeatureTip('头像已更新并保存到本地。');
            } catch {
                this.showFeatureTip('头像读取失败，请重试。');
            }
            avatarInput.value = '';
        });

        this.root.querySelector<HTMLElement>('[data-avatar-clear]')?.addEventListener('click', () => {
            this.updateSettings({ avatarDataUrl: '' });
            this.showFeatureTip('已清空头像，恢复默认。');
        });

        this.root.querySelectorAll<HTMLElement>('[data-skin-id]').forEach((button) => {
            button.addEventListener('click', () => {
                const skinId = button.dataset.skinId || SKIN_OPTIONS[0].id;
                this.updateSettings({ equippedSkinId: skinId });
                if (button.dataset.skinGroup === 'main') {
                    this.setSkinDrawerOpen(false);
                }
            });
        });

        this.root.querySelectorAll<HTMLElement>('[data-feature]').forEach((button) => {
            button.addEventListener('click', () => {
                const feature = button.dataset.feature || '';
                if (
                    feature === 'shop'
                    || feature === 'magic'
                    || feature === 'friends'
                    || feature === 'leaderboard'
                ) {
                    this.selectedFeatureId = feature;
                    this.applyFeatureSelection();
                }
                const tips: Record<string, string> = {
                    shop: '商店入口已预留，后续可接皮肤与道具。',
                    magic: '魔法屋入口已预留，后续可接抽取与升级。',
                    friends: '好友系统入口已预留，后续接本地/联机关系。',
                    leaderboard: '排行榜入口已预留，后续可接全服榜单。'
                };
                this.showFeatureTip(tips[feature] ?? '该功能入口已预留。');
            });
        });
    }

    private selectMode(modeId: string) {
        if (!this.isLobbyModeId(modeId)) {
            return;
        }

        this.selectedModeId = modeId;
        this.applySelectedModeUI();
    }

    private applySelectedModeUI() {
        const mode = this.modeOptions[this.selectedModeId];
        this.root.querySelectorAll<HTMLElement>('[data-mode-id]').forEach((card) => {
            const selected = card.dataset.modeId === this.selectedModeId;
            card.classList.toggle('is-active', selected);
            card.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });

        const heading = this.root.querySelector<HTMLElement>('[data-mode-status]');
        if (heading) {
            heading.textContent = mode.status;
            heading.classList.remove('is-open', 'is-testing', 'is-locked');
            heading.classList.add(
                mode.status === '已开放'
                    ? 'is-open'
                    : mode.status === '测试中'
                        ? 'is-testing'
                        : 'is-locked'
            );
        }

        const currentModeLabel = this.root.querySelector<HTMLElement>('[data-current-mode-label]');
        if (currentModeLabel) {
            currentModeLabel.textContent = mode.name;
        }
        const currentModeIcon = this.root.querySelector<HTMLElement>('[data-current-mode-icon]');
        if (currentModeIcon) {
            currentModeIcon.innerHTML = renderMaterialSymbol(MODE_SYMBOLS[mode.id], 'lobby-hero-mode-symbol');
        }

        const footerMode = this.root.querySelector<HTMLElement>('[data-selected-mode]');
        if (footerMode) {
            footerMode.textContent = mode.name;
        }

        const footerHint = this.root.querySelector<HTMLElement>('[data-selected-mode-hint]');
        if (footerHint) {
            footerHint.textContent = mode.footerHint;
        }

        const ctaStatus = this.root.querySelector<HTMLElement>('[data-mode-cta-status]');
        if (ctaStatus) {
            ctaStatus.textContent = mode.status;
        }

        const startButton = this.root.querySelector<HTMLButtonElement>('[data-start-game]');
        if (startButton) {
            startButton.disabled = !mode.playable;
            startButton.textContent = mode.playable ? `进入${mode.name}分厅` : '敬请期待';
            startButton.classList.toggle('is-disabled', !mode.playable);
        }

        this.root.dataset.modeTheme = mode.theme;
    }

    private closeSettings() {
        const wasModalOnly = this.root.classList.contains('is-modal-only');
        this.root.classList.remove('is-settings-open', 'is-modal-only');
        if (!wasModalOnly) {
            this.root.classList.add('is-visible');
        }
        this.options.onSettingsClosed();
    }

    private updateSettings(patch: Partial<GameSettings>) {
        this.settings = {
            ...this.settings,
            ...patch
        };
        this.options.onSettingsChange(this.settings);
        this.applySettingsToForm();
    }

    private applySettingsToForm() {
        const name = this.normalizePlayerName(this.settings.playerName);
        if (name !== this.settings.playerName) {
            this.settings.playerName = name;
        }

        const displayName = this.getDisplayName();

        this.root.querySelectorAll<HTMLElement>('[data-player-name]').forEach((el) => {
            el.textContent = displayName;
        });

        const quickNameInput = this.root.querySelector<HTMLInputElement>('[data-quick-name]');
        if (quickNameInput && quickNameInput.value !== this.settings.playerName) {
            quickNameInput.value = this.settings.playerName;
        }

        const settingsNameInput = this.root.querySelector<HTMLInputElement>('input[name="playerName"]');
        if (settingsNameInput && settingsNameInput.value !== this.settings.playerName) {
            settingsNameInput.value = this.settings.playerName;
        }

        const checkboxes = ['showFps', 'showMinimap', 'showLeaderboard', 'developerMode', 'reducedMotion'] as const;
        checkboxes.forEach((nameKey) => {
            const checkbox = this.root.querySelector<HTMLInputElement>(`input[name="${nameKey}"]`);
            if (checkbox) {
                checkbox.checked = this.settings[nameKey];
            }
        });

        const safeSkinId = this.resolveSkinId(this.settings.equippedSkinId);
        if (safeSkinId !== this.settings.equippedSkinId) {
            this.settings.equippedSkinId = safeSkinId;
        }

        this.root.querySelectorAll<HTMLElement>('[data-skin-id]').forEach((button) => {
            const selected = button.dataset.skinId === safeSkinId;
            button.classList.toggle('is-active', selected);
            button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });

        this.root.dataset.reducedMotion = String(this.settings.reducedMotion);
        if (this.settings.reducedMotion) {
            this.root.style.setProperty('--parallax-x', '0px');
            this.root.style.setProperty('--parallax-y', '0px');
        }

        this.syncAvatarSlots();
        this.syncPreviewAvatarImage();
        this.applyProgressionToView();
        this.startPreviewLoop();
    }

    private applyProgressionToView() {
        const level = Math.max(1, this.progression.level);
        const currentXp = Math.max(0, this.progression.currentXp);
        const requiredXp = getRequiredXpForLevel(level);
        const safeRatio = requiredXp <= 0 ? 0 : Math.max(0, Math.min(1, currentXp / requiredXp));
        const winRate = this.progression.totalMatches > 0
            ? ((this.progression.totalWins / this.progression.totalMatches) * 100).toFixed(1)
            : '0.0';
        const bestMass = Math.max(0, Math.round(this.progression.bestMass));

        this.root.querySelectorAll<HTMLElement>('[data-progression-level]').forEach((el) => {
            el.textContent = `Lv.${level}`;
        });

        this.root.querySelectorAll<HTMLElement>('[data-progression-coins]').forEach((el) => {
            el.textContent = `${this.progression.coins}`;
        });

        this.root.querySelectorAll<HTMLElement>('[data-progression-growth-meta]').forEach((el) => {
            el.textContent = `${this.progression.totalWins} 胜 / ${this.progression.totalMatches} 局`;
        });

        this.root.querySelectorAll<HTMLElement>('[data-progression-xp-fill]').forEach((el) => {
            el.style.width = `${(safeRatio * 100).toFixed(2)}%`;
        });

        this.root.querySelectorAll<HTMLElement>('[data-progression-xp-text]').forEach((el) => {
            el.textContent = `${currentXp} / ${requiredXp} XP`;
        });

        this.root.querySelectorAll<HTMLElement>('[data-progression-xp-display]').forEach((el) => {
            el.textContent = `${currentXp} / ${requiredXp} XP`;
        });

        this.root.querySelectorAll<HTMLElement>('[data-progression-winrate]').forEach((el) => {
            el.textContent = `${winRate}%`;
        });

        this.root.querySelectorAll<HTMLElement>('[data-progression-best-mass]').forEach((el) => {
            el.textContent = `${bestMass} kg`;
        });
    }

    private syncAvatarSlots() {
        const hasAvatar = this.settings.avatarDataUrl.trim().length > 0;
        const fallbackChar = this.getDisplayName().charAt(0) || '球';

        this.root.querySelectorAll<HTMLElement>('[data-avatar-slot]').forEach((slot) => {
            const img = slot.querySelector<HTMLImageElement>('[data-avatar-img]');
            const fallback = slot.querySelector<HTMLElement>('[data-avatar-fallback]');
            if (!img || !fallback) {
                return;
            }

            if (hasAvatar) {
                img.src = this.settings.avatarDataUrl;
                img.classList.add('is-visible');
                fallback.classList.remove('is-visible');
                slot.classList.add('has-avatar');
            } else {
                img.removeAttribute('src');
                img.classList.remove('is-visible');
                fallback.textContent = fallbackChar;
                fallback.classList.add('is-visible');
                slot.classList.remove('has-avatar');
            }
        });
    }

    private syncPreviewAvatarImage() {
        const src = this.settings.avatarDataUrl.trim();
        if (!src) {
            this.previewAvatarSrc = '';
            this.previewAvatarImage = null;
            return;
        }

        if (this.previewAvatarSrc === src && this.previewAvatarImage) {
            return;
        }

        const image = new Image();
        image.onload = () => {
            this.previewAvatarImage = image;
            this.previewAvatarSrc = src;
        };
        image.onerror = () => {
            this.previewAvatarImage = null;
            this.previewAvatarSrc = '';
        };
        image.src = src;
    }

    private normalizePlayerName(raw: string): string {
        return raw.trim().slice(0, MAX_PLAYER_NAME_LENGTH);
    }

    private getDisplayName(): string {
        return this.settings.playerName.trim().length > 0
            ? this.settings.playerName
            : '未命名玩家';
    }

    private resolveSkinId(rawSkinId: string): string {
        return SKIN_OPTIONS.some((skin) => skin.id === rawSkinId)
            ? rawSkinId
            : SKIN_OPTIONS[0].id;
    }

    private isLobbyModeId(modeId: string): modeId is LobbyModeId {
        return modeId in this.modeOptions;
    }

    private showFeatureTip(message: string) {
        const tipEl = this.root.querySelector<HTMLElement>('[data-inline-tip]');
        if (tipEl) {
            tipEl.textContent = message;
        }

        this.root.classList.add('is-inline-tip-active');
        if (this.tipTimer !== null) {
            window.clearTimeout(this.tipTimer);
        }
        this.tipTimer = window.setTimeout(() => {
            this.root.classList.remove('is-inline-tip-active');
            this.tipTimer = null;
        }, 2200);
    }

    private applyFeatureSelection() {
        this.root.querySelectorAll<HTMLElement>('[data-feature]').forEach((button) => {
            const featureId = button.dataset.feature ?? '';
            button.classList.toggle('is-active', featureId === this.selectedFeatureId);
            button.setAttribute('aria-pressed', featureId === this.selectedFeatureId ? 'true' : 'false');
        });
    }

    private setSkinDrawerOpen(isOpen: boolean) {
        this.root.classList.toggle('is-skin-drawer-open', isOpen);
        this.root.querySelectorAll<HTMLElement>('[data-toggle-skins]').forEach((button) => {
            button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });
    }

    private readFileAsDataUrl(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                if (typeof reader.result === 'string') {
                    resolve(reader.result);
                } else {
                    reject(new Error('Failed to read avatar data URL.'));
                }
            };
            reader.onerror = () => reject(reader.error ?? new Error('Failed to read avatar file.'));
            reader.readAsDataURL(file);
        });
    }

    private startPreviewLoop() {
        if (!this.previewCanvas || !this.previewCtx) {
            return;
        }

        this.stopPreviewLoop();
        if (this.settings.reducedMotion) {
            this.drawPreview(performance.now());
            return;
        }

        const step = (timestamp: number) => {
            this.drawPreview(timestamp);
            this.previewFrameId = window.requestAnimationFrame(step);
        };

        this.previewFrameId = window.requestAnimationFrame(step);
    }

    private stopPreviewLoop() {
        if (this.previewFrameId !== null) {
            window.cancelAnimationFrame(this.previewFrameId);
            this.previewFrameId = null;
        }
    }

    private drawPreview(timestamp: number) {
        if (!this.previewCanvas || !this.previewCtx) {
            return;
        }

        const canvas = this.previewCanvas;
        const ctx = this.previewCtx;
        const width = canvas.width;
        const height = canvas.height;
        const motionRate = this.settings.reducedMotion ? 0 : 1;
        const t = timestamp * 0.001;

        const skin = SKIN_OPTIONS.find((item) => item.id === this.settings.equippedSkinId) ?? SKIN_OPTIONS[0];
        const displayName = this.getDisplayName();

        ctx.clearRect(0, 0, width, height);

        const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
        bgGradient.addColorStop(0, 'rgba(10, 22, 44, 0.98)');
        bgGradient.addColorStop(0.45, 'rgba(8, 18, 35, 1)');
        bgGradient.addColorStop(1, 'rgba(5, 14, 28, 1)');
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, width, height);

        const panelGlow = ctx.createRadialGradient(width * 0.5, height * 0.36, 0, width * 0.5, height * 0.36, width * 0.74);
        panelGlow.addColorStop(0, 'rgba(129, 236, 255, 0.22)');
        panelGlow.addColorStop(1, 'rgba(129, 236, 255, 0)');
        ctx.fillStyle = panelGlow;
        ctx.fillRect(0, 0, width, height);

        const panelGlowSecondary = ctx.createRadialGradient(width * 0.7, height * 0.22, 0, width * 0.7, height * 0.22, width * 0.54);
        panelGlowSecondary.addColorStop(0, 'rgba(195, 127, 255, 0.16)');
        panelGlowSecondary.addColorStop(1, 'rgba(195, 127, 255, 0)');
        ctx.fillStyle = panelGlowSecondary;
        ctx.fillRect(0, 0, width, height);

        const ringCenterX = width * 0.5;
        const ringCenterY = height * 0.43;
        const offsetX = motionRate * Math.sin(t * 1.1) * 3;
        const offsetY = motionRate * Math.cos(t * 1.3) * 2;
        const centerX = ringCenterX + offsetX;
        const centerY = ringCenterY + offsetY;

        ctx.strokeStyle = 'rgba(129, 236, 255, 0.12)';
        ctx.lineWidth = 1;
        for (let index = 0; index < 12; index += 1) {
            const y = 56 + index * 18 + motionRate * Math.sin(t * 0.8 + index) * 1.6;
            ctx.beginPath();
            ctx.moveTo(28, y);
            ctx.lineTo(width - 28, y);
            ctx.stroke();
        }

        const ringStroke = (radius: number, alpha: number, widthPx: number, rotation = 0) => {
            ctx.save();
            ctx.translate(ringCenterX, ringCenterY);
            ctx.rotate(rotation);
            ctx.beginPath();
            ctx.strokeStyle = `rgba(129, 236, 255, ${alpha})`;
            ctx.lineWidth = widthPx;
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        };

        ringStroke(116, 0.18, 1.4, t * 0.12);
        ringStroke(136, 0.08, 1, -t * 0.08);
        ringStroke(92, 0.26, 1.8, 0);

        const markerLine = (x1: number, y1: number, x2: number, y2: number) => {
            ctx.strokeStyle = 'rgba(129, 236, 255, 0.24)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        };

        markerLine(ringCenterX, 28, ringCenterX, 44);
        markerLine(ringCenterX, height - 120, ringCenterX, height - 104);
        markerLine(20, ringCenterY, 36, ringCenterY);
        markerLine(width - 36, ringCenterY, width - 20, ringCenterY);

        const stageGlow = ctx.createRadialGradient(centerX, centerY, 30, centerX, centerY, 168);
        stageGlow.addColorStop(0, 'rgba(129, 236, 255, 0.18)');
        stageGlow.addColorStop(0.58, 'rgba(129, 236, 255, 0.06)');
        stageGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = stageGlow;
        ctx.beginPath();
        ctx.arc(centerX, centerY, 168, 0, Math.PI * 2);
        ctx.fill();

        const coreRadius = 92;
        const glow = ctx.createRadialGradient(centerX, centerY, 22, centerX, centerY, 150);
        glow.addColorStop(0, 'rgba(129, 236, 255, 0.34)');
        glow.addColorStop(0.5, skin.glow);
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(centerX, centerY, 150, 0, Math.PI * 2);
        ctx.fill();

        const shellGradient = ctx.createLinearGradient(centerX - coreRadius, centerY - coreRadius, centerX + coreRadius, centerY + coreRadius);
        shellGradient.addColorStop(0, 'rgba(129, 236, 255, 0.84)');
        shellGradient.addColorStop(0.46, 'rgba(195, 127, 255, 0.78)');
        shellGradient.addColorStop(1, 'rgba(129, 236, 255, 0.84)');
        ctx.fillStyle = shellGradient;
        ctx.beginPath();
        ctx.arc(centerX, centerY, coreRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(230, 237, 255, 0.96)';
        ctx.beginPath();
        ctx.arc(centerX, centerY, coreRadius - 10, 0, Math.PI * 2);
        ctx.fill();

        const artSize = 108;
        const artX = centerX - artSize / 2;
        const artY = centerY - artSize / 2;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(artX, artY, artSize, artSize, 2);
        ctx.clip();
        if (this.previewAvatarImage) {
            ctx.drawImage(
                this.previewAvatarImage,
                artX,
                artY,
                artSize,
                artSize
            );
        } else {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(artX, artY, artSize, artSize);
            const mockRadius = 34;
            const mockX = centerX;
            const mockY = centerY + 2;
            const mockGradient = ctx.createRadialGradient(mockX - 12, mockY - 16, 4, mockX, mockY, mockRadius);
            mockGradient.addColorStop(0, '#d9c1a1');
            mockGradient.addColorStop(0.6, '#bf9b72');
            mockGradient.addColorStop(1, '#86623d');
            ctx.fillStyle = mockGradient;
            ctx.beginPath();
            ctx.arc(mockX, mockY, mockRadius, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = 'rgba(92, 65, 41, 0.18)';
            ctx.lineWidth = 1;
            for (let i = 0; i < 8; i += 1) {
                const yy = mockY - mockRadius + (i + 1) * 8;
                ctx.beginPath();
                ctx.arc(mockX, yy, 12 + (i % 2) * 2, 0, Math.PI);
                ctx.stroke();
            }
        }
        ctx.restore();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(artX, artY, artSize, artSize, 2);
        ctx.stroke();

        const gloss = ctx.createRadialGradient(centerX - 28, centerY - 32, 0, centerX - 28, centerY - 32, 34);
        gloss.addColorStop(0, 'rgba(255,255,255,0.38)');
        gloss.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gloss;
        ctx.beginPath();
        ctx.arc(centerX - 28, centerY - 30, 34, 0, Math.PI * 2);
        ctx.fill();

        const stageShadow = ctx.createLinearGradient(0, centerY + coreRadius * 0.25, 0, centerY + coreRadius);
        stageShadow.addColorStop(0, 'rgba(0,0,0,0)');
        stageShadow.addColorStop(1, 'rgba(0,0,0,0.32)');
        ctx.fillStyle = stageShadow;
        ctx.beginPath();
        ctx.arc(centerX, centerY, coreRadius - 2, 0, Math.PI * 2);
        ctx.fill();

        const badgeRadius = 24;
        const badgeX = centerX + 72;
        const badgeY = centerY - 18;
        ctx.fillStyle = 'rgba(7, 20, 38, 0.94)';
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#eff8ff';
        ctx.font = '800 24px "Plus Jakarta Sans","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((displayName.charAt(0) || '球').slice(0, 1), badgeX, badgeY + 1);

        ctx.fillStyle = 'rgba(230, 243, 255, 0.72)';
        ctx.font = '700 11px "Plus Jakarta Sans","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';
        ctx.fillText(`SKIN · ${skin.name}`, width * 0.5, 22);
    }
}
