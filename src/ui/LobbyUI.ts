import type { GameSettings } from '../app/settings';

interface LobbyUIOptions {
    settings: GameSettings;
    onStartGame: () => void;
    onSettingsChange: (settings: GameSettings) => void;
    onSettingsOpened: () => void;
    onSettingsClosed: () => void;
}

interface ModeOption {
    id: string;
    name: string;
    description: string;
    status: string;
    footerHint: string;
    playable: boolean;
}

export class LobbyUI {
    private root: HTMLDivElement;
    private settings: GameSettings;
    private readonly options: LobbyUIOptions;
    private readonly keydownHandler: (event: KeyboardEvent) => void;
    private readonly modeOptions: Record<string, ModeOption>;
    private selectedModeId: string;

    constructor(options: LobbyUIOptions) {
        this.options = options;
        this.settings = { ...options.settings };

        this.modeOptions = {
            classic: {
                id: 'classic',
                name: '经典模式',
                description: '自由吞噬 · 最接近球球大作战主玩法',
                status: '经典模式已接入',
                footerHint: '昵称会在开始游戏后同步到你的球体名牌',
                playable: true
            },
            speed: {
                id: 'speed',
                name: '极速模式',
                description: '更高刷新率和更激进的成长节奏',
                status: '模式开发中',
                footerHint: '极速模式暂未开放，正在调试节奏和结算逻辑。',
                playable: false
            },
            team: {
                id: 'team',
                name: '团战模式',
                description: '队伍协作与吐球配合入口预留',
                status: '模式开发中',
                footerHint: '团战模式暂未开放，后续会接入组队机制。',
                playable: false
            },
            survival: {
                id: 'survival',
                name: '生存模式',
                description: '缩圈与高压追逐后续接入',
                status: '模式开发中',
                footerHint: '生存模式暂未开放，正在设计节奏和圈机制。',
                playable: false
            }
        };
        this.selectedModeId = 'classic';

        this.root = document.createElement('div');
        this.root.className = 'lobby-overlay';
        this.root.innerHTML = `
            <div class="lobby-backdrop">
                <div class="lobby-orb lobby-orb--one"></div>
                <div class="lobby-orb lobby-orb--two"></div>
                <div class="lobby-orb lobby-orb--three"></div>
            </div>

            <div class="lobby-shell">
                <header class="lobby-topbar">
                    <div class="lobby-brand">
                        <div class="lobby-brand-mark">BOP</div>
                        <div>
                            <div class="lobby-brand-title">球球派对大厅</div>
                            <div class="lobby-brand-subtitle">经典吞噬 · 极速成长 · 轻竞技练习场</div>
                        </div>
                    </div>

                    <div class="lobby-topbar-actions">
                        <div class="lobby-player-pill">
                            <div class="lobby-avatar">球</div>
                            <div>
                                <div class="lobby-player-name" data-player-name></div>
                                <div class="lobby-player-status">本地账号 · 单机演练</div>
                            </div>
                        </div>

                        <div class="lobby-resource-strip">
                            <div class="lobby-resource-card">
                                <span>金币</span>
                                <strong>98,560</strong>
                            </div>
                            <div class="lobby-resource-card">
                                <span>星贝</span>
                                <strong>1,248</strong>
                            </div>
                        </div>

                        <button type="button" class="lobby-ghost-button" data-open-settings>设置</button>
                    </div>
                </header>

                <main class="lobby-grid">
                    <section class="lobby-hero">
                        <div class="lobby-badge">S1 训练赛季</div>
                        <h1>先吃成巨无霸，再一口吞掉整张地图。</h1>
                        <p>
                            先把开局、大厅和设置手感做顺，再继续接玩法和联网。
                            经典模式已经可玩，其他入口先做真实氛围占位。
                        </p>

                        <div class="lobby-highlights">
                            <div class="lobby-highlight-card">
                                <span>对局规模</span>
                                <strong>50 球同场</strong>
                            </div>
                            <div class="lobby-highlight-card">
                                <span>当前模式</span>
                                <strong data-current-mode-label>经典自由战</strong>
                            </div>
                            <div class="lobby-highlight-card">
                                <span>操作提示</span>
                                <strong>空格分裂 / W吐球</strong>
                            </div>
                        </div>
                    </section>

                    <section class="lobby-mode-panel">
                        <div class="lobby-section-heading">
                            <span>模式选择</span>
                            <strong data-mode-status>经典模式已接入</strong>
                        </div>

                        <div class="lobby-mode-card is-active" data-mode-id="classic" tabindex="0" role="button" aria-label="选择经典模式">
                            <div class="lobby-mode-status">推荐</div>
                            <div class="lobby-mode-title">经典模式</div>
                            <div class="lobby-mode-meta">自由吞噬 · 最接近球球大作战主玩法</div>
                            <ul>
                                <li>地图资源丰富，适合测试成长节奏</li>
                                <li>保留分裂、吐球、小地图和排行榜</li>
                                <li>点击开始游戏后直接进入新一局</li>
                            </ul>
                        </div>

                        <div class="lobby-mode-card is-disabled" data-mode-id="speed" tabindex="0" role="button" aria-label="选择极速模式">
                            <div class="lobby-mode-status">即将开放</div>
                            <div class="lobby-mode-title">极速模式</div>
                            <div class="lobby-mode-meta">更高刷新率和更激进的成长节奏</div>
                        </div>

                        <div class="lobby-mode-card is-disabled" data-mode-id="team" tabindex="0" role="button" aria-label="选择团战模式">
                            <div class="lobby-mode-status">即将开放</div>
                            <div class="lobby-mode-title">团战模式</div>
                            <div class="lobby-mode-meta">队伍协作与吐球配合入口预留</div>
                        </div>

                        <div class="lobby-mode-card is-disabled" data-mode-id="survival" tabindex="0" role="button" aria-label="选择生存模式">
                            <div class="lobby-mode-status">即将开放</div>
                            <div class="lobby-mode-title">生存模式</div>
                            <div class="lobby-mode-meta">缩圈与高压追逐后续接入</div>
                        </div>
                    </section>

                    <aside class="lobby-side-panel">
                        <div class="lobby-side-card">
                            <div class="lobby-side-card-title">今日任务</div>
                            <ul>
                                <li>完成 1 场经典对局</li>
                                <li>累计吞噬 200 个彩豆</li>
                                <li>使用 5 次分裂冲刺</li>
                            </ul>
                        </div>

                        <div class="lobby-side-card">
                            <div class="lobby-side-card-title">活动中心</div>
                            <p>大厅视觉、模式入口、任务模块都已经预留布局，后续可以接活动和赛季。</p>
                        </div>

                        <div class="lobby-side-card">
                            <div class="lobby-side-card-title">商城占位</div>
                            <p>皮肤、尾迹、头像框和贵族入口先做展示卡位，不接接口。</p>
                        </div>

                        <div class="lobby-side-card">
                            <div class="lobby-side-card-title">签到位</div>
                            <p>连续签到第 3 天，奖励预览：金币 x300 / 皮肤碎片 x2</p>
                        </div>
                    </aside>
                </main>

                <footer class="lobby-footer">
                    <div class="lobby-footer-copy">
                        <span>已选择</span>
                        <strong data-selected-mode>经典模式</strong>
                        <small data-selected-mode-hint>昵称会在开始游戏后同步到你的球体名牌</small>
                    </div>

                    <div class="lobby-footer-actions">
                        <button type="button" class="lobby-ghost-button" data-open-settings>设置</button>
                        <button type="button" class="lobby-start-button" data-start-game>开始游戏</button>
                    </div>
                </footer>
            </div>

            <div class="settings-overlay">
                <div class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
                    <div class="settings-header">
                        <div>
                            <div class="settings-kicker">本地设置</div>
                            <h2 id="settings-title">对局与界面配置</h2>
                        </div>
                        <button type="button" class="settings-close" data-close-settings aria-label="关闭设置">×</button>
                    </div>

                    <label class="settings-field">
                        <span>玩家昵称</span>
                        <input type="text" name="playerName" maxlength="12" />
                    </label>

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
                        <p>设置保存在本地浏览器，下次打开仍会保留。</p>
                        <button type="button" class="lobby-start-button lobby-start-button--small" data-close-settings>完成</button>
                    </div>
                </div>
            </div>
        `;

        this.keydownHandler = (event) => {
            if (event.key === 'Escape' && this.root.classList.contains('is-settings-open')) {
                this.closeSettings();
            }
        };

        this.bindEvents();
        this.applySettingsToForm();
        this.applySelectedModeUI();
    }

    mount(parent: HTMLElement) {
        parent.appendChild(this.root);
        window.addEventListener('keydown', this.keydownHandler);
    }

    destroy() {
        window.removeEventListener('keydown', this.keydownHandler);
        this.root.remove();
    }

    showLobby() {
        this.root.classList.add('is-visible');
        this.root.classList.remove('is-modal-only', 'is-settings-open');
        const shell = this.root.querySelector<HTMLElement>('.lobby-shell');
        if (shell) {
            shell.scrollTop = 0;
        }
        const grid = this.root.querySelector<HTMLElement>('.lobby-grid');
        if (grid) {
            grid.scrollTop = 0;
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
                return;
            }

            this.hideAll();
            this.options.onStartGame();
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

        const playerNameInput = this.root.querySelector<HTMLInputElement>('input[name="playerName"]');
        playerNameInput?.addEventListener('input', () => {
            const playerName = playerNameInput.value.trim().slice(0, 12) || '勇者球球';
            this.updateSettings({ playerName });
        });

        const toggles = ['showFps', 'showMinimap', 'showLeaderboard', 'developerMode', 'reducedMotion'] as const;
        toggles.forEach((toggleName) => {
            this.root.querySelector<HTMLInputElement>(`input[name="${toggleName}"]`)?.addEventListener('change', (event) => {
                const target = event.currentTarget as HTMLInputElement;
                this.updateSettings({ [toggleName]: target.checked } as Partial<GameSettings>);
            });
        });
    }

    private selectMode(modeId: string) {
        if (!this.modeOptions[modeId]) {
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
        if (heading) heading.textContent = mode.status;

        const currentModeLabel = this.root.querySelector<HTMLElement>('[data-current-mode-label]');
        if (currentModeLabel) currentModeLabel.textContent = mode.playable ? '经典自由战' : `${mode.name}（预览）`;

        const footerMode = this.root.querySelector<HTMLElement>('[data-selected-mode]');
        if (footerMode) footerMode.textContent = mode.name;

        const footerHint = this.root.querySelector<HTMLElement>('[data-selected-mode-hint]');
        if (footerHint) footerHint.textContent = mode.footerHint;

        const startButton = this.root.querySelector<HTMLButtonElement>('[data-start-game]');
        if (startButton) {
            startButton.disabled = !mode.playable;
            startButton.textContent = mode.playable ? '开始游戏' : '敬请期待';
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
        const playerNameEl = this.root.querySelector<HTMLElement>('[data-player-name]');
        if (playerNameEl) {
            playerNameEl.textContent = this.settings.playerName;
        }

        const playerNameInput = this.root.querySelector<HTMLInputElement>('input[name="playerName"]');
        if (playerNameInput && playerNameInput.value !== this.settings.playerName) {
            playerNameInput.value = this.settings.playerName;
        }

        const checkboxes = ['showFps', 'showMinimap', 'showLeaderboard', 'developerMode', 'reducedMotion'] as const;
        checkboxes.forEach((name) => {
            const checkbox = this.root.querySelector<HTMLInputElement>(`input[name="${name}"]`);
            if (checkbox) {
                checkbox.checked = this.settings[name];
            }
        });

        this.root.dataset.reducedMotion = String(this.settings.reducedMotion);
        if (this.settings.reducedMotion) {
            this.root.style.setProperty('--parallax-x', '0px');
            this.root.style.setProperty('--parallax-y', '0px');
        }
    }
}
