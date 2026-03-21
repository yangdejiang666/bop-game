import type { GameSettings } from '../app/settings';
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

type LobbyFeatureId = 'shop' | 'magic' | 'friends' | 'leaderboard';
type StitchModeCardId = 'ranked' | 'classic5v5' | 'peakspeed' | 'practice';

interface StitchModeCard {
    id: StitchModeCardId;
    modeId: LobbyModeId;
    kicker: string;
    name: string;
    subtitle: string;
    icon: string;
    theme: 'cyan' | 'violet' | 'gold' | 'neutral';
    status: '已开放' | '测试中' | '训练';
}

interface SkinOption {
    id: string;
    name: string;
    colorA: string;
    colorB: string;
}

const MAX_PLAYER_NAME_LENGTH = 12;
const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024;

const DEFAULT_HERO_IMAGE =
    'https://lh3.googleusercontent.com/aida-public/AB6AXuAyG1gtfnAbSlm5_maFnWieF_Escrr9orwe6W9ajYOpVGUJExLAzsuKv8CgLyDm6eFdXXBogxNnLjrUTsYbd9FY38u07ninLWDRNCmhXE5I2EAa9PDpWw3ErP2zJV3GD-0NOsS9A9zQGskGMfGGzDCwWNIPsngHuEV-TwNpK4SplWcCVoLzZjdjFL_X6zvyogFQQ7Th17N6TAKj2MmLgMQAVdDF8kgNcv0NB9AR1aAKU0ctDQXAeBZlVuz3iRM3vq0gW7TQcNsNIxk';

const STITCH_MODE_CARDS: StitchModeCard[] = [
    {
        id: 'ranked',
        modeId: 'ranked',
        kicker: '竞技模式',
        name: '排位赛',
        subtitle: '向最高荣誉发起冲锋',
        icon: 'trophy',
        theme: 'cyan',
        status: '已开放'
    },
    {
        id: 'classic5v5',
        modeId: 'classic',
        kicker: '休闲模式',
        name: '经典模式5v5',
        subtitle: '自由吞噬，畅快体验',
        icon: 'view_cozy',
        theme: 'violet',
        status: '已开放'
    },
    {
        id: 'peakspeed',
        modeId: 'speed',
        kicker: '极速模式',
        name: '巅峰极速',
        subtitle: '高节奏成长，快速对抗',
        icon: 'bolt',
        theme: 'gold',
        status: '测试中'
    },
    {
        id: 'practice',
        modeId: 'classic',
        kicker: '训练室',
        name: '单机练习',
        subtitle: '磨炼你的操作技巧',
        icon: 'fitness_center',
        theme: 'neutral',
        status: '训练'
    }
];

const FEATURE_SYMBOLS: Record<LobbyFeatureId, string> = {
    shop: 'shopping_bag',
    magic: 'auto_awesome',
    friends: 'group',
    leaderboard: 'leaderboard'
};

const FEATURE_TIPS: Record<LobbyFeatureId, string> = {
    shop: '商店入口已预留，可继续接皮肤与道具接口。',
    magic: '魔法屋入口已预留，可继续接抽取与升级接口。',
    friends: '好友入口已预留，可继续接本地/联机社交关系。',
    leaderboard: '排行榜入口已预留，可继续接赛季与全服榜。'
};

const TASK_PRESETS = [
    { icon: 'radio_button_checked', title: '吞噬500个小球', progress: '376/500', ratio: 0.752, theme: 'cyan' },
    { icon: 'groups', title: '获得1场团队赛胜利', progress: '0/1', ratio: 0, theme: 'violet' }
] as const;

const FRIEND_PRESETS = [
    { name: 'Pixie_Dust', status: '在线', accent: '#81ecff' },
    { name: 'Glitch_King', status: '组队中', accent: '#c37fff' },
    { name: 'VoidRunner', status: '空闲', accent: '#ffe483' }
] as const;

const SKIN_OPTIONS: SkinOption[] = [
    { id: 'classic_blue', name: '经典蓝', colorA: '#81ecff', colorB: '#4f7dff' },
    { id: 'mint_pop', name: '薄荷泡泡', colorA: '#56ffc0', colorB: '#1ac788' },
    { id: 'sunset_lava', name: '熔岩余晖', colorA: '#ffcf66', colorB: '#ff6b4a' },
    { id: 'neon_violet', name: '霓虹紫电', colorA: '#d18bff', colorB: '#7657ff' }
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
    private selectedCardId: StitchModeCardId = 'ranked';
    private selectedModeId: LobbyModeId = 'ranked';
    private selectedFeatureId: LobbyFeatureId = 'magic';
    private tipTimer: number | null = null;

    constructor(options: LobbyUIOptions) {
        this.options = options;
        this.settings = { ...options.settings };
        this.progression = loadPlayerProgression();

        this.root = document.createElement('div');
        this.root.className = 'lobby-overlay lobby-stitch-exact';
        this.root.innerHTML = this.buildTemplate();

        this.keydownHandler = (event) => {
            if (event.key === 'Escape' && this.root.classList.contains('is-settings-open')) {
                this.closeSettings();
            }
        };

        this.bindEvents();
        this.applySelectedModeUI();
        this.applyFeatureSelection();
        this.applySettingsToForm();
    }

    mount(parent: HTMLElement) {
        parent.appendChild(this.root);
        window.addEventListener('keydown', this.keydownHandler);
    }

    destroy() {
        window.removeEventListener('keydown', this.keydownHandler);
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
        const tip = this.root.querySelector<HTMLElement>('[data-inline-tip]');
        if (tip) {
            tip.textContent = '选择模式后点击进入分厅，匹配入口会在分厅内触发。';
        }
        (document.activeElement as HTMLElement | null)?.blur();
    }

    hideAll() {
        this.root.classList.remove('is-visible', 'is-modal-only', 'is-settings-open', 'is-skin-drawer-open');
    }

    openSettings(modalOnly: boolean) {
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
            <div class="stitch-root">
                <div class="stitch-bg-streaks" aria-hidden="true">
                    <span class="stitch-streak stitch-streak--one"></span>
                    <span class="stitch-streak stitch-streak--two"></span>
                </div>

                <header class="stitch-topbar glass-panel">
                    <div class="stitch-brand">
                        <strong class="stitch-brand-title">球球实验室</strong>
                    </div>

                    <div class="stitch-resource-bar shimmer">
                        <article class="stitch-resource-chip">
                            <span class="stitch-resource-icon">
                                ${renderMaterialSymbol('stars', 'stitch-resource-symbol')}
                            </span>
                            <span class="stitch-resource-copy">
                                <small>金币</small>
                                <strong data-progression-coins>0</strong>
                            </span>
                        </article>
                        <article class="stitch-resource-chip">
                            <span class="stitch-resource-icon">
                                ${renderMaterialSymbol('diamond', 'stitch-resource-symbol')}
                            </span>
                            <span class="stitch-resource-copy">
                                <small>经验</small>
                                <strong data-progression-xp-display>0 / 208 XP</strong>
                            </span>
                        </article>
                        <button type="button" class="stitch-resource-add" data-feature="shop" aria-label="商店">
                            ${renderMaterialSymbol('add', 'stitch-resource-add-symbol')}
                        </button>
                    </div>

                    <div class="stitch-top-actions">
                        <button type="button" class="stitch-icon-btn" data-top-action="activity" aria-label="活动">
                            ${renderMaterialSymbol('notifications', 'stitch-icon-btn-symbol')}
                        </button>
                        <button type="button" class="stitch-icon-btn" data-open-settings aria-label="设置">
                            ${renderMaterialSymbol('settings', 'stitch-icon-btn-symbol')}
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
                                    <span>ELITE RANK</span>
                                </div>
                                <span class="stitch-level-chip" data-progression-level>LV. 1</span>
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
                                    <img data-hero-image alt="主球预览" src="${DEFAULT_HERO_IMAGE}" />
                                </div>
                                <button type="button" class="stitch-stage-bolt" data-avatar-trigger aria-label="更换头像">
                                    ${renderMaterialSymbol('bolt', 'stitch-stage-bolt-symbol')}
                                </button>
                            </div>

                            <div class="stitch-stat-grid">
                                <article class="stitch-stat-tile">
                                    <small>WIN RATE</small>
                                    <strong data-progression-winrate>0%</strong>
                                </article>
                                <article class="stitch-stat-tile is-secondary">
                                    <small>TOTAL MASS</small>
                                    <strong data-progression-best-mass>0 kg</strong>
                                </article>
                            </div>

                            <button type="button" class="stitch-skins-btn btn-sweep" data-toggle-skins aria-expanded="false">
                                SKINS / CUSTOMIZE
                            </button>

                            <section class="stitch-skin-drawer" data-skin-drawer>
                                <div class="stitch-skin-drawer-head">
                                    <strong>本地皮肤预设</strong>
                                    <small>点击即时切换主球视觉</small>
                                </div>
                                <div class="stitch-skin-list">
                                    ${this.buildSkinButtons('main')}
                                </div>
                            </section>
                        </article>

                        <button type="button" class="stitch-season-card shimmer" data-feature="leaderboard">
                            <span class="stitch-season-icon">
                                ${renderMaterialSymbol('deployed_code_history', 'stitch-season-symbol')}
                            </span>
                            <span class="stitch-season-copy">
                                <strong>SEASON 12: CYBER NEON</strong>
                                <small>New skins and limited modes.</small>
                            </span>
                        </button>
                    </section>

                    <section class="stitch-right-col">
                        <section class="stitch-mode-panel glass-panel">
                            <div class="stitch-panel-head">
                                <div>
                                    <strong>模式选择</strong>
                                    <small>4 卡同构入口，按参考稿布局</small>
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
                                ${renderMaterialSymbol('rocket_launch', 'stitch-main-cta-symbol')}
                            </button>
                            <div class="stitch-invite-strip glass-panel">
                                <div class="stitch-invite-avatars">
                                    ${this.buildFriendCluster()}
                                </div>
                                <button type="button" class="stitch-invite-btn" data-feature="friends">
                                    ${renderMaterialSymbol('person_add', 'stitch-invite-btn-symbol')}
                                    <span>邀请好友</span>
                                </button>
                            </div>
                        </section>
                    </section>
                </main>

                <section class="stitch-activity-row">
                    <button type="button" class="stitch-activity-card is-violet shimmer" data-feature="shop">
                        <span class="stitch-activity-icon">${renderMaterialSymbol('blur_on', 'stitch-activity-symbol')}</span>
                        <span class="stitch-activity-copy">
                            <small>限时新品</small>
                            <strong>幻彩晶核整备场</strong>
                            <em>查看详情</em>
                        </span>
                    </button>
                    <button type="button" class="stitch-activity-card is-gold shimmer" data-feature="magic">
                        <span class="stitch-activity-icon">${renderMaterialSymbol('timer', 'stitch-activity-symbol')}</span>
                        <span class="stitch-activity-copy">
                            <small>限时模式</small>
                            <strong>重力漂流 · 压缩开局</strong>
                            <em>立即加入</em>
                        </span>
                    </button>
                    <button type="button" class="stitch-activity-card is-cyan shimmer" data-feature="leaderboard">
                        <span class="stitch-activity-icon">${renderMaterialSymbol('confirmation_number', 'stitch-activity-symbol')}</span>
                        <span class="stitch-activity-copy">
                            <small>赛季通行证</small>
                            <strong>提升等级赢取成长奖励</strong>
                            <em>Lv. 1 / 100</em>
                        </span>
                    </button>
                </section>

                <nav class="stitch-dock glass-panel">
                    <button type="button" class="stitch-dock-item" data-feature="shop">
                        ${renderMaterialSymbol(FEATURE_SYMBOLS.shop, 'stitch-dock-symbol')}
                        <span>商店</span>
                    </button>
                    <button type="button" class="stitch-dock-item" data-feature="magic">
                        ${renderMaterialSymbol(FEATURE_SYMBOLS.magic, 'stitch-dock-symbol')}
                        <span>魔法屋</span>
                    </button>
                    <button type="button" class="stitch-dock-item" data-feature="friends">
                        ${renderMaterialSymbol(FEATURE_SYMBOLS.friends, 'stitch-dock-symbol')}
                        <span>好友</span>
                    </button>
                    <button type="button" class="stitch-dock-item" data-feature="leaderboard">
                        ${renderMaterialSymbol(FEATURE_SYMBOLS.leaderboard, 'stitch-dock-symbol')}
                        <span>排行榜</span>
                    </button>
                </nav>

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
                            ${this.buildSkinButtons('settings')}
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
                            <input type="checkbox" name="showLeaderboard" />
                            <span>显示排行榜</span>
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

                    <footer class="stitch-settings-foot">
                        <small>设置仅保存在本地浏览器。</small>
                        <button type="button" class="stitch-main-cta stitch-main-cta--small" data-close-settings>完成</button>
                    </footer>
                </div>
            </div>
        `;
    }

    private buildModeCards(): string {
        return STITCH_MODE_CARDS.map((card) => {
            const activeClass = card.id === this.selectedCardId ? ' is-active' : '';
            const themeClass = ` is-theme-${card.theme}`;
            const statusClass = card.status === '已开放'
                ? ' is-open'
                : card.status === '测试中'
                    ? ' is-testing'
                    : ' is-training';

            return `
                <article
                    class="stitch-mode-card flowing-border${themeClass}${activeClass}"
                    data-mode-card-id="${card.id}"
                    data-mode-id="${card.modeId}"
                    tabindex="0"
                    role="button"
                    aria-label="选择${card.name}"
                >
                    <span class="stitch-mode-icon">${renderMaterialSymbol(card.icon, 'stitch-mode-icon-symbol')}</span>
                    <span class="stitch-mode-card-status${statusClass}">${card.status}</span>
                    <span class="stitch-mode-card-kicker">${card.kicker}</span>
                    <strong>${card.name}</strong>
                    <p>${card.subtitle}</p>
                </article>
            `;
        }).join('');
    }

    private buildTaskRows(): string {
        return TASK_PRESETS.map((task) => `
            <article class="stitch-task-row">
                <span class="stitch-task-icon is-theme-${task.theme}">
                    ${renderMaterialSymbol(task.icon, 'stitch-task-icon-symbol')}
                </span>
                <div class="stitch-task-copy">
                    <strong>${task.title}</strong>
                    <div class="stitch-task-bar">
                        <div class="stitch-task-fill is-theme-${task.theme}" style="width:${(task.ratio * 100).toFixed(1)}%"></div>
                    </div>
                </div>
                <span class="stitch-task-progress">${task.progress}</span>
            </article>
        `).join('');
    }

    private buildFriendRows(): string {
        const rows = FRIEND_PRESETS.map((friend) => `
            <article class="stitch-friend-item">
                <span class="stitch-friend-avatar" style="--friend-accent:${friend.accent};">${friend.name.charAt(0)}</span>
                <strong>${friend.name}</strong>
                <small>${friend.status}</small>
            </article>
        `).join('');

        return `${rows}
            <button type="button" class="stitch-friend-item stitch-friend-add" data-feature="friends" aria-label="邀请好友">
                ${renderMaterialSymbol('add', 'stitch-friend-add-symbol')}
            </button>
        `;
    }

    private buildFriendCluster(): string {
        return FRIEND_PRESETS.map((friend) => `
            <span class="stitch-invite-avatar" style="--friend-accent:${friend.accent};">${friend.name.charAt(0)}</span>
        `).join('');
    }

    private buildSkinButtons(group: 'main' | 'settings'): string {
        return SKIN_OPTIONS.map((skin) => `
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
        `).join('');
    }

    private bindEvents() {
        this.root.querySelectorAll<HTMLElement>('[data-open-settings]').forEach((element) => {
            element.addEventListener('click', () => this.openSettings(false));
        });

        this.root.querySelectorAll<HTMLElement>('[data-close-settings]').forEach((element) => {
            element.addEventListener('click', () => this.closeSettings());
        });

        this.root.querySelector<HTMLElement>('.stitch-settings-overlay')?.addEventListener('click', (event) => {
            if (event.target === event.currentTarget) {
                this.closeSettings();
            }
        });

        this.root.querySelector<HTMLElement>('[data-top-action]')?.addEventListener('click', () => {
            this.showFeatureTip('活动中心正在整理新的实验任务与限时挑战。');
        });

        this.root.querySelector<HTMLElement>('[data-start-game]')?.addEventListener('click', () => {
            this.hideAll();
            this.options.onOpenModeHall(this.selectedModeId);
        });

        this.root.querySelectorAll<HTMLElement>('[data-mode-card-id]').forEach((card) => {
            card.addEventListener('click', () => {
                const cardId = card.dataset.modeCardId ?? '';
                this.selectModeCard(cardId);
            });

            card.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    const cardId = card.dataset.modeCardId ?? '';
                    this.selectModeCard(cardId);
                }
            });
        });

        this.root.querySelectorAll<HTMLElement>('[data-toggle-skins]').forEach((button) => {
            button.addEventListener('click', () => {
                const nextOpen = !this.root.classList.contains('is-skin-drawer-open');
                this.setSkinDrawerOpen(nextOpen);
            });
        });

        this.root.querySelectorAll<HTMLElement>('[data-feature]').forEach((button) => {
            button.addEventListener('click', () => {
                const feature = button.dataset.feature ?? '';
                if (!this.isLobbyFeatureId(feature)) {
                    return;
                }
                this.selectedFeatureId = feature;
                this.applyFeatureSelection();
                this.showFeatureTip(FEATURE_TIPS[feature]);
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
            this.showFeatureTip('头像已清空。');
        });

        this.root.querySelectorAll<HTMLElement>('[data-skin-id]').forEach((button) => {
            button.addEventListener('click', () => {
                const skinId = button.dataset.skinId ?? SKIN_OPTIONS[0].id;
                this.updateSettings({ equippedSkinId: skinId });
                if (button.dataset.skinGroup === 'main') {
                    this.setSkinDrawerOpen(false);
                }
            });
        });

        this.root.querySelector<HTMLInputElement>('input[name="playerName"]')?.addEventListener('input', (event) => {
            const target = event.currentTarget as HTMLInputElement;
            this.updateSettings({ playerName: this.normalizePlayerName(target.value) });
        });

        const toggles = ['showFps', 'showMinimap', 'showLeaderboard', 'developerMode', 'reducedMotion'] as const;
        toggles.forEach((name) => {
            this.root.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.addEventListener('change', (event) => {
                const target = event.currentTarget as HTMLInputElement;
                this.updateSettings({ [name]: target.checked } as Partial<GameSettings>);
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

        this.root.querySelectorAll<HTMLElement>('[data-mode-card-id]').forEach((card) => {
            const active = card.dataset.modeCardId === this.selectedCardId;
            card.classList.toggle('is-active', active);
            card.setAttribute('aria-pressed', active ? 'true' : 'false');
        });

        this.root.querySelectorAll<HTMLElement>('[data-current-mode-name]').forEach((el) => {
            el.textContent = selectedCard.name;
        });
        this.root.querySelectorAll<HTMLElement>('[data-selected-mode-name]').forEach((el) => {
            el.textContent = selectedCard.name;
        });
        this.root.querySelectorAll<HTMLElement>('[data-selected-mode-subtitle]').forEach((el) => {
            el.textContent = selectedCard.subtitle;
        });
        this.root.querySelectorAll<HTMLElement>('[data-mode-status]').forEach((el) => {
            el.textContent = selectedCard.status;
        });

        this.root.dataset.modeTheme = selectedCard.theme;
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
        const playerName = this.normalizePlayerName(this.settings.playerName);
        if (playerName !== this.settings.playerName) {
            this.settings.playerName = playerName;
        }

        const displayName = this.getDisplayName();
        this.root.querySelectorAll<HTMLElement>('[data-player-name]').forEach((el) => {
            el.textContent = displayName;
        });

        const nameInput = this.root.querySelector<HTMLInputElement>('input[name="playerName"]');
        if (nameInput && nameInput.value !== this.settings.playerName) {
            nameInput.value = this.settings.playerName;
        }

        const checkboxes = ['showFps', 'showMinimap', 'showLeaderboard', 'developerMode', 'reducedMotion'] as const;
        checkboxes.forEach((key) => {
            const checkbox = this.root.querySelector<HTMLInputElement>(`input[name="${key}"]`);
            if (checkbox) {
                checkbox.checked = this.settings[key];
            }
        });

        const skinId = this.resolveSkinId(this.settings.equippedSkinId);
        if (skinId !== this.settings.equippedSkinId) {
            this.settings.equippedSkinId = skinId;
        }

        this.root.querySelectorAll<HTMLElement>('[data-skin-id]').forEach((button) => {
            const selected = button.dataset.skinId === skinId;
            button.classList.toggle('is-active', selected);
            button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });

        const activeSkin = SKIN_OPTIONS.find((skin) => skin.id === skinId) ?? SKIN_OPTIONS[0];
        this.root.style.setProperty('--stitch-skin-a', activeSkin.colorA);
        this.root.style.setProperty('--stitch-skin-b', activeSkin.colorB);
        this.root.dataset.reducedMotion = String(this.settings.reducedMotion);

        this.syncAvatarSlots();
        this.syncHeroImage();
        this.applyProgressionToView();
    }

    private applyProgressionToView() {
        const level = Math.max(1, this.progression.level);
        const currentXp = Math.max(0, this.progression.currentXp);
        const requiredXp = Math.max(1, getRequiredXpForLevel(level));
        const totalMatches = Math.max(0, this.progression.totalMatches);
        const totalWins = Math.max(0, this.progression.totalWins);
        const winRate = totalMatches > 0 ? (totalWins / totalMatches) * 100 : 0;

        this.root.querySelectorAll<HTMLElement>('[data-progression-level]').forEach((el) => {
            el.textContent = `LV. ${level}`;
        });
        this.root.querySelectorAll<HTMLElement>('[data-progression-coins]').forEach((el) => {
            el.textContent = `${this.progression.coins}`;
        });
        this.root.querySelectorAll<HTMLElement>('[data-progression-xp-display]').forEach((el) => {
            el.textContent = `${currentXp} / ${requiredXp} XP`;
        });
        this.root.querySelectorAll<HTMLElement>('[data-progression-winrate]').forEach((el) => {
            el.textContent = `${winRate.toFixed(1)}%`;
        });
        this.root.querySelectorAll<HTMLElement>('[data-progression-best-mass]').forEach((el) => {
            el.textContent = this.formatMass(this.progression.bestMass);
        });
        this.root.querySelectorAll<HTMLElement>('[data-progression-growth-meta]').forEach((el) => {
            el.textContent = `${totalWins} 胜 / ${totalMatches} 局`;
        });
    }

    private syncAvatarSlots() {
        const avatarUrl = this.settings.avatarDataUrl.trim();
        const hasAvatar = avatarUrl.length > 0;
        const fallbackChar = this.getDisplayName().charAt(0) || '球';

        this.root.querySelectorAll<HTMLElement>('[data-avatar-slot]').forEach((slot) => {
            const img = slot.querySelector<HTMLImageElement>('[data-avatar-img]');
            const fallback = slot.querySelector<HTMLElement>('[data-avatar-fallback]');
            if (!img || !fallback) return;

            if (hasAvatar) {
                img.src = avatarUrl;
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

    private syncHeroImage() {
        const heroImage = this.root.querySelector<HTMLImageElement>('[data-hero-image]');
        if (!heroImage) return;
        heroImage.src = this.settings.avatarDataUrl.trim().length > 0
            ? this.settings.avatarDataUrl
            : DEFAULT_HERO_IMAGE;
    }

    private showFeatureTip(message: string) {
        const tip = this.root.querySelector<HTMLElement>('[data-inline-tip]');
        if (tip) {
            tip.textContent = message;
        }

        this.root.classList.add('is-inline-tip-active');
        if (this.tipTimer !== null) {
            window.clearTimeout(this.tipTimer);
        }
        this.tipTimer = window.setTimeout(() => {
            this.root.classList.remove('is-inline-tip-active');
            this.tipTimer = null;
        }, 2400);
    }

    private applyFeatureSelection() {
        this.root.querySelectorAll<HTMLElement>('[data-feature]').forEach((button) => {
            const feature = button.dataset.feature ?? '';
            const active = feature === this.selectedFeatureId;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    private setSkinDrawerOpen(open: boolean) {
        this.root.classList.toggle('is-skin-drawer-open', open);
        this.root.querySelectorAll<HTMLElement>('[data-toggle-skins]').forEach((button) => {
            button.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
    }

    private getSelectedCard(): StitchModeCard {
        return STITCH_MODE_CARDS.find((card) => card.id === this.selectedCardId) ?? STITCH_MODE_CARDS[0];
    }

    private normalizePlayerName(raw: string): string {
        return raw.trim().slice(0, MAX_PLAYER_NAME_LENGTH);
    }

    private getDisplayName(): string {
        return this.settings.playerName.trim().length > 0 ? this.settings.playerName : '勇者球球';
    }

    private resolveSkinId(rawSkinId: string): string {
        return SKIN_OPTIONS.some((skin) => skin.id === rawSkinId) ? rawSkinId : SKIN_OPTIONS[0].id;
    }

    private isStitchModeCardId(value: string): value is StitchModeCardId {
        return STITCH_MODE_CARDS.some((card) => card.id === value);
    }

    private isLobbyFeatureId(value: string): value is LobbyFeatureId {
        return value === 'shop' || value === 'magic' || value === 'friends' || value === 'leaderboard';
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
}
