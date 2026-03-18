import type { GameSettings } from '../app/settings';

export type LobbyModeId = 'ranked' | 'peak' | 'classic' | 'speed' | 'team' | 'battleRoyale';

interface LobbyUIOptions {
    settings: GameSettings;
    onStartGame: (modeId: LobbyModeId) => void;
    onSettingsChange: (settings: GameSettings) => void;
    onSettingsOpened: () => void;
    onSettingsClosed: () => void;
}

interface ModeOption {
    id: LobbyModeId;
    name: string;
    subtitle: string;
    icon: string;
    status: string;
    footerHint: string;
    playable: boolean;
}

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

export class LobbyUI {
    private root: HTMLDivElement;
    private settings: GameSettings;
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

    constructor(options: LobbyUIOptions) {
        this.options = options;
        this.settings = { ...options.settings };
        this.modeOptions = {
            ranked: {
                id: 'ranked',
                name: '排位赛',
                subtitle: '积分晋级 · 赛季结算',
                icon: '🏆',
                status: '已开放',
                footerHint: '排位赛为 6 分钟限时，点击开始会先进入匹配阶段。',
                playable: true
            },
            peak: {
                id: 'peak',
                name: '巅峰赛',
                subtitle: '高分对抗 · 顶尖段位',
                icon: '📈',
                status: '测试中',
                footerHint: '巅峰赛当前为测试匹配池，点击开始会先进入匹配阶段。',
                playable: true
            },
            classic: {
                id: 'classic',
                name: '经典模式',
                subtitle: '自由吞噬 · 单机可玩',
                icon: '⚪',
                status: '已开放',
                footerHint: '经典模式点击开始会先进入匹配阶段，再进入对局。',
                playable: true
            },
            speed: {
                id: 'speed',
                name: '极速模式',
                subtitle: '高节奏成长 · 快速对抗',
                icon: '⚡',
                status: '测试中',
                footerHint: '极速模式正在调试节奏，点击开始会先进入匹配阶段。',
                playable: true
            },
            team: {
                id: 'team',
                name: '团队模式',
                subtitle: '队伍配合 · 吐球协同',
                icon: '👥',
                status: '已开放',
                footerHint: '团队模式为 6 分钟限时，点击开始会先进行队伍匹配。',
                playable: true
            },
            battleRoyale: {
                id: 'battleRoyale',
                name: '大逃杀',
                subtitle: '缩圈生存 · 极限翻盘',
                icon: '🎯',
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
            tip.textContent = '选择模式后将先进入匹配阶段，其他入口当前为占位。';
        }
        (document.activeElement as HTMLElement | null)?.blur();
    }

    hideAll() {
        this.root.classList.remove('is-visible', 'is-modal-only', 'is-settings-open');
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

    private buildTemplate(): string {
        return `
            <div class="lobby-backdrop">
                <div class="lobby-orb lobby-orb--one"></div>
                <div class="lobby-orb lobby-orb--two"></div>
                <div class="lobby-orb lobby-orb--three"></div>
            </div>

            <div class="lobby-shell lobby-shell--v2">
                <header class="lobby-topbar lobby-topbar--v2">
                    <div class="lobby-profile-card lobby-profile-card--home">
                        <div class="lobby-avatar-stack">
                            <button type="button" class="lobby-avatar-button" data-avatar-trigger aria-label="上传头像">
                                <span class="lobby-avatar-slot" data-avatar-slot>
                                    <img class="lobby-avatar-img" data-avatar-img alt="头像" />
                                    <span class="lobby-avatar-fallback" data-avatar-fallback>球</span>
                                </span>
                                <span class="lobby-avatar-upload-text">更换头像</span>
                            </button>
                        </div>
                        <div class="lobby-profile-meta">
                            <div class="lobby-profile-name-row">
                                <strong data-player-name>个人主页</strong>
                                <span class="lobby-status-dot">在线</span>
                            </div>
                            <label class="lobby-quick-name-wrap">
                                <span>局内昵称</span>
                                <input class="lobby-quick-name-input" data-quick-name type="text" maxlength="${MAX_PLAYER_NAME_LENGTH}" />
                            </label>
                        </div>
                        <button type="button" class="lobby-ghost-button lobby-ghost-button--compact" data-open-settings>个人主页</button>
                    </div>

                    <div class="lobby-brand lobby-brand--v2">
                        <div class="lobby-brand-mark">BOP</div>
                        <div>
                            <div class="lobby-brand-title">球球竞技大厅</div>
                            <div class="lobby-brand-subtitle">模式选择 · 个人资料 · 装扮预览</div>
                        </div>
                    </div>

                    <div class="lobby-right-widgets">
                        <div class="lobby-mini-card">
                            <div class="lobby-mini-card-icon">🎉</div>
                            <div>
                                <strong>活动中心</strong>
                                <small>春季冲榜活动进行中</small>
                            </div>
                        </div>
                        <div class="lobby-mini-card">
                            <div class="lobby-mini-card-icon">🧾</div>
                            <div>
                                <strong>今日任务</strong>
                                <small>3 / 5 已完成</small>
                            </div>
                        </div>
                    </div>
                </header>

                <main class="lobby-main--v2">
                    <section class="lobby-preview-panel--v2">
                        <div class="lobby-panel-head">
                            <div>
                                <strong>装扮投影预览</strong>
                                <small>昵称、头像、皮肤实时联动</small>
                            </div>
                            <span class="lobby-tag" data-current-mode-label>经典模式</span>
                        </div>
                        <canvas class="lobby-preview-canvas" width="560" height="360" data-preview-canvas></canvas>
                        <div class="lobby-skin-strip" role="group" aria-label="皮肤选择">
                            ${this.buildSkinButtons('main')}
                        </div>
                    </section>

                    <section class="lobby-mode-panel--v2">
                        <div class="lobby-panel-head">
                            <div>
                                <strong>模式选择</strong>
                                <small>六模式入口，全部支持匹配，可按模式测试手感</small>
                            </div>
                            <span class="lobby-tag lobby-tag--muted" data-mode-status>已开放</span>
                        </div>
                        <div class="lobby-mode-grid--v2">
                            ${this.buildModeCards()}
                        </div>
                    </section>
                </main>

                <footer class="lobby-bottom--v2">
                    <div class="lobby-feature-strip">
                        <button type="button" class="lobby-feature-button" data-feature="shop">商店</button>
                        <button type="button" class="lobby-feature-button" data-feature="magic">魔法屋</button>
                        <button type="button" class="lobby-feature-button" data-feature="friends">好友</button>
                        <button type="button" class="lobby-feature-button" data-feature="leaderboard">排行榜</button>
                    </div>

                    <div class="lobby-footer-actions--v2">
                        <div class="lobby-selection-copy">
                            <span>当前选择</span>
                            <strong data-selected-mode>经典模式</strong>
                            <small data-selected-mode-hint>经典模式点击开始会先进入匹配阶段，再进入对局。</small>
                        </div>
                        <div class="lobby-action-buttons">
                            <button type="button" class="lobby-ghost-button" data-open-settings>设置</button>
                            <button type="button" class="lobby-start-button" data-start-game>开始匹配</button>
                        </div>
                    </div>

                    <div class="lobby-inline-tip" data-inline-tip aria-live="polite">
                        选择模式后将先进入匹配阶段，其他入口当前为占位。
                    </div>
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
        return Object.values(this.modeOptions).map((mode) => {
            const disabledClass = mode.playable ? '' : ' is-disabled';
            const activeClass = mode.id === this.selectedModeId ? ' is-active' : '';
            return `
                <article
                    class="lobby-mode-card--v2${disabledClass}${activeClass}"
                    data-mode-id="${mode.id}"
                    tabindex="0"
                    role="button"
                    aria-label="选择${mode.name}"
                >
                    <div class="lobby-mode-card-head">
                        <div class="lobby-mode-title-wrap">
                            <span class="lobby-mode-icon">${mode.icon}</span>
                            <strong>${mode.name}</strong>
                        </div>
                        <span>${mode.status}</span>
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

    private bindEvents() {
        this.root.querySelectorAll<HTMLElement>('[data-open-settings]').forEach((element) => {
            element.addEventListener('click', () => this.openSettings(false));
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
            this.options.onStartGame(this.selectedModeId);
        });

        this.root.querySelectorAll<HTMLElement>('[data-mode-id]').forEach((card) => {
            card.addEventListener('click', () => this.selectMode(card.dataset.modeId || 'classic'));
            card.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    this.selectMode(card.dataset.modeId || 'classic');
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
            });
        });

        this.root.querySelectorAll<HTMLElement>('[data-feature]').forEach((button) => {
            button.addEventListener('click', () => {
                const feature = button.dataset.feature || '';
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
        }

        const currentModeLabel = this.root.querySelector<HTMLElement>('[data-current-mode-label]');
        if (currentModeLabel) {
            currentModeLabel.textContent = mode.name;
        }

        const footerMode = this.root.querySelector<HTMLElement>('[data-selected-mode]');
        if (footerMode) {
            footerMode.textContent = mode.name;
        }

        const footerHint = this.root.querySelector<HTMLElement>('[data-selected-mode-hint]');
        if (footerHint) {
            footerHint.textContent = mode.footerHint;
        }

        const startButton = this.root.querySelector<HTMLButtonElement>('[data-start-game]');
        if (startButton) {
            startButton.disabled = !mode.playable;
            startButton.textContent = mode.playable ? '开始匹配' : '敬请期待';
            startButton.classList.toggle('is-disabled', !mode.playable);
        }
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
        this.startPreviewLoop();
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

        const bgGradient = ctx.createLinearGradient(0, 0, width, height);
        bgGradient.addColorStop(0, 'rgba(12, 28, 45, 0.96)');
        bgGradient.addColorStop(0.6, 'rgba(8, 18, 31, 0.98)');
        bgGradient.addColorStop(1, 'rgba(6, 12, 24, 1)');
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, width, height);

        const projectorX = width * 0.5;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.11)';
        ctx.fillRect(projectorX - 18, 12, 36, 12);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
        ctx.fillRect(projectorX - 6, 24, 12, 48);

        const beamGradient = ctx.createRadialGradient(projectorX, 68, 10, projectorX, 68, 240);
        beamGradient.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
        beamGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = beamGradient;
        ctx.beginPath();
        ctx.moveTo(projectorX - 130, 76);
        ctx.lineTo(projectorX + 130, 76);
        ctx.lineTo(projectorX + 240, height - 18);
        ctx.lineTo(projectorX - 240, height - 18);
        ctx.closePath();
        ctx.fill();

        const ballBaseX = width * 0.5;
        const ballBaseY = height * 0.57;
        const offsetX = motionRate * Math.sin(t * 1.4) * 8;
        const offsetY = motionRate * Math.cos(t * 1.1) * 5;
        const pulse = 1 + motionRate * Math.sin(t * 2.2) * 0.03;
        const radius = 78 * pulse;
        const centerX = ballBaseX + offsetX;
        const centerY = ballBaseY + offsetY;

        const glow = ctx.createRadialGradient(centerX, centerY, 22, centerX, centerY, 180);
        glow.addColorStop(0, skin.glow);
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(centerX, centerY, 180, 0, Math.PI * 2);
        ctx.fill();

        const fillGradient = ctx.createLinearGradient(centerX - radius, centerY - radius, centerX + radius, centerY + radius);
        fillGradient.addColorStop(0, skin.colorA);
        fillGradient.addColorStop(1, skin.colorB);
        ctx.fillStyle = fillGradient;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius - 1.5, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.beginPath();
        ctx.arc(centerX - radius * 0.36, centerY - radius * 0.3, radius * 0.2, 0, Math.PI * 2);
        ctx.fill();

        const badgeRadius = 22;
        const badgeX = centerX + radius * 0.58;
        const badgeY = centerY - radius * 0.56;
        ctx.save();
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
        ctx.clip();
        if (this.previewAvatarImage) {
            ctx.drawImage(
                this.previewAvatarImage,
                badgeX - badgeRadius,
                badgeY - badgeRadius,
                badgeRadius * 2,
                badgeRadius * 2
            );
        } else {
            ctx.fillStyle = 'rgba(12, 29, 46, 0.92)';
            ctx.fillRect(badgeX - badgeRadius, badgeY - badgeRadius, badgeRadius * 2, badgeRadius * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
            ctx.font = 'bold 20px "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(displayName.charAt(0) || '球', badgeX, badgeY + 1);
        }
        ctx.restore();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.34)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeRadius + 1, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = 'rgba(0, 0, 0, 0.36)';
        ctx.fillRect(90, height - 64, width - 180, 38);
        ctx.fillStyle = '#eff8ff';
        ctx.font = '700 24px "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(displayName, width * 0.5, height - 45);

        ctx.fillStyle = 'rgba(201, 227, 255, 0.8)';
        ctx.font = '600 14px "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';
        ctx.fillText(`皮肤：${skin.name}`, width * 0.5, 24);
    }
}
