import {
    cloneGameplayTuning,
    gameplayTuning,
    replaceGameplayTuning,
    resetGameplayTuningToDefaults,
    saveGameplayTuningToStorage,
    type GameplayTuning
} from '../gameplay/tuning';

interface TuningToolboxOptions {
    onTuningChanged?: (tuning: GameplayTuning) => void;
}

interface ControlSpec {
    path: string;
    label: string;
    min: number;
    max: number;
    step: number;
    description?: string;
    formatter?: (value: number) => string;
}

interface ControlRefs {
    range: HTMLInputElement;
    number: HTMLInputElement;
    value: HTMLSpanElement;
}

interface ControlGroup {
    title: string;
    controls: ControlSpec[];
}

const PERCENT_FORMATTER = (value: number) => `${(value * 100).toFixed(2)}%`;
const SECOND_FORMATTER = (value: number) => `${value.toFixed(2)}s`;

const CONTROL_GROUPS: ControlGroup[] = [
    {
        title: '分身冲刺与出生',
        controls: [
            { path: 'split.base_impulse', label: '分身基础冲量', min: 5, max: 60, step: 0.1 },
            { path: 'split.mass_impulse_factor', label: '质量阻尼系数', min: 0.05, max: 1, step: 0.01 },
            { path: 'split.impulse_decay', label: '冲量衰减速度', min: 0.1, max: 20, step: 0.1 },
            { path: 'split.dash_time', label: '冲刺持续时间', min: 0.05, max: 1.5, step: 0.01, formatter: SECOND_FORMATTER },
            { path: 'split.spawn_offset', label: '分身出生距离系数', min: 0.8, max: 2.5, step: 0.01 },
            { path: 'split.touch_epsilon', label: '贴边偏移', min: 0, max: 0.08, step: 0.001 },
            { path: 'split.grace_time', label: '分身保护时间', min: 0, max: 0.8, step: 0.01, formatter: SECOND_FORMATTER },
            { path: 'split.self_push_factor', label: '分身软推挤强度', min: 0.05, max: 1, step: 0.01 },
            { path: 'split.direction_random_angle', label: '分身角度抖动(°)', min: 0, max: 8, step: 0.1 }
        ]
    },
    {
        title: '合球时间与阈值',
        controls: [
            { path: 'merge.lock_time', label: '合球基础锁定', min: 0.5, max: 20, step: 0.1, formatter: SECOND_FORMATTER },
            { path: 'merge.min_lock_time', label: '合球最短锁定', min: 0.2, max: 12, step: 0.1, formatter: SECOND_FORMATTER },
            { path: 'merge.max_lock_time', label: '合球最长锁定', min: 4, max: 40, step: 0.1, formatter: SECOND_FORMATTER },
            { path: 'merge.small_piece_factor', label: '小分球锁定系数', min: 0.2, max: 1, step: 0.01 },
            { path: 'merge.small_piece_ratio_anchor', label: '小分球占比阈值', min: 0.05, max: 0.8, step: 0.01, formatter: PERCENT_FORMATTER },
            { path: 'merge.low_total_mass_factor', label: '低总质量锁定系数', min: 0.2, max: 1.5, step: 0.01 },
            { path: 'merge.high_total_mass_factor', label: '高总质量锁定系数', min: 0.5, max: 3.5, step: 0.01 },
            { path: 'merge.low_total_mass_anchor', label: '低总质量锚点', min: 35, max: 4000, step: 5 },
            { path: 'merge.high_total_mass_anchor', label: '高总质量锚点', min: 500, max: 50000, step: 50 }
        ]
    },
    {
        title: '分身回拢（PID风格）',
        controls: [
            { path: 'merge.cohesion_near_ratio', label: '近距离慢回拢阈值', min: 0, max: 2, step: 0.01 },
            { path: 'merge.cohesion_far_ratio', label: '远距离快回拢阈值', min: 0.1, max: 6, step: 0.01 },
            { path: 'merge.cohesion_near_gain', label: '近距离回拢增益', min: 0, max: 80, step: 0.1 },
            { path: 'merge.cohesion_far_gain', label: '远距离回拢增益', min: 0.1, max: 140, step: 0.1 },
            { path: 'merge.cohesion_pd_damping', label: '回拢阻尼（D项）', min: 0, max: 4, step: 0.01 },
            { path: 'merge.cohesion_max_pull', label: '回拢最大拉力', min: 10, max: 1200, step: 1 },
            { path: 'merge.cohesion_lock_multiplier', label: '锁定期回拢倍率', min: 0.1, max: 3, step: 0.01 },
            { path: 'merge.buddy_pull_gain', label: '小球互相回拢增益', min: 0, max: 40, step: 0.1 },
            { path: 'merge.buddy_max_pull', label: '小球互相最大拉力', min: 0, max: 1000, step: 1 },
            { path: 'merge.attract_factor', label: '全局回拢缩放', min: 0.01, max: 1.5, step: 0.01 }
        ]
    },
    {
        title: '吐球成本与节奏',
        controls: [
            { path: 'eject.cost_mass', label: '每次吐球扣质量', min: 1, max: 40, step: 0.1 },
            { path: 'eject.spawn_mass', label: '吐出球质量', min: 0.5, max: 35, step: 0.1 },
            { path: 'eject.spawn_distance', label: '吐球出生距离', min: 0, max: 120, step: 0.5 },
            { path: 'eject.cooldown', label: '吐球冷却', min: 0.01, max: 0.5, step: 0.01, formatter: SECOND_FORMATTER },
            { path: 'eject.launch_speed', label: '吐球基础速度', min: 1, max: 60, step: 0.1 },
            { path: 'eject.reabsorb_lock', label: '原主人回收锁', min: 0, max: 1.5, step: 0.01, formatter: SECOND_FORMATTER },
            { path: 'eject.recoil_factor', label: '吐球后坐系数', min: 0, max: 0.25, step: 0.005 }
        ]
    },
    {
        title: '体积衰减（30秒掉重比例）',
        controls: [
            { path: 'decay.anchor_loss_30s.0', label: '35质量掉重', min: 0, max: 0.02, step: 0.0001, formatter: PERCENT_FORMATTER },
            { path: 'decay.anchor_loss_30s.1', label: '200质量掉重', min: 0, max: 0.05, step: 0.0001, formatter: PERCENT_FORMATTER },
            { path: 'decay.anchor_loss_30s.2', label: '1000质量掉重', min: 0, max: 0.08, step: 0.0001, formatter: PERCENT_FORMATTER },
            { path: 'decay.anchor_loss_30s.3', label: '5000质量掉重', min: 0, max: 0.15, step: 0.0001, formatter: PERCENT_FORMATTER },
            { path: 'decay.anchor_loss_30s.4', label: '12000质量掉重', min: 0, max: 0.25, step: 0.0001, formatter: PERCENT_FORMATTER },
            { path: 'decay.extra_cell_factor', label: '多分球额外衰减', min: 0, max: 0.2, step: 0.001, formatter: PERCENT_FORMATTER }
        ]
    },
    {
        title: '扎刺分裂数量与占比',
        controls: [
            { path: 'limits.max_cells', label: '最大分身数', min: 2, max: 32, step: 1 },
            { path: 'spike.target_cell_count', label: '扎刺目标分身数', min: 2, max: 16, step: 1 },
            { path: 'spike.main_cell_ratio', label: '扎刺主球占比', min: 0.15, max: 0.6, step: 0.01, formatter: PERCENT_FORMATTER },
            { path: 'spike.max_piece_ratio', label: '小球/主球最大比', min: 0.2, max: 0.75, step: 0.01, formatter: PERCENT_FORMATTER },
            { path: 'spike.min_piece_mass', label: '扎刺最小子球质量', min: 1, max: 120, step: 0.5 },
            { path: 'spike.piece_random_factor', label: '扎刺子球随机系数', min: 0, max: 0.3, step: 0.01, formatter: PERCENT_FORMATTER },
            { path: 'spike.burst_impulse', label: '扎刺爆开冲量', min: 1, max: 60, step: 0.1 },
            { path: 'spike.burst_impulse_jitter', label: '爆开速度抖动', min: 0, max: 0.3, step: 0.01, formatter: PERCENT_FORMATTER },
            { path: 'spike.spread_angle', label: '扎刺圆周角度(°)', min: 30, max: 360, step: 1 },
            { path: 'spike.ring_radius_factor', label: '扎刺圆环半径系数', min: 0.7, max: 2.2, step: 0.01 },
            { path: 'spike.circle_jitter_angle', label: '圆周角度抖动(°)', min: 0, max: 15, step: 0.1 },
            { path: 'spike.virus_bonus_mass', label: '吃刺增重质量', min: 0, max: 2000, step: 5 },
            { path: 'spike.virus_feed_mass_gain', label: '喂刺每口增重', min: 0, max: 100, step: 0.1 },
            { path: 'spike.virus_feed_split_feeds', label: '喂刺分裂口数阈值', min: 1, max: 32, step: 1 },
            { path: 'spike.virus_feed_split_mass', label: '喂刺分裂质量阈值', min: 35, max: 2000, step: 1 },
            { path: 'spike.virus_feed_push_force', label: '喂刺推动力', min: 0, max: 300, step: 1 },
            { path: 'spike.virus_feed_split_speed', label: '新刺喷射速度', min: 20, max: 1500, step: 1 },
            { path: 'spike.virus_feed_split_distance', label: '新刺生成距离', min: 0, max: 400, step: 1 },
            { path: 'spike.virus_feed_reset_mass', label: '喂刺分裂后基础质量', min: 35, max: 1200, step: 1 },
            { path: 'spike.virus_size_piece_bonus', label: '大刺额外分球增益', min: 0, max: 16, step: 0.1 },
            { path: 'spike.virus_size_ring_bonus', label: '大刺圆环半径增益', min: 0, max: 2, step: 0.01 },
            { path: 'spike.virus_size_impulse_bonus', label: '大刺爆开速度增益', min: 0, max: 2, step: 0.01 }
        ]
    },
    {
        title: '全局下限与映射',
        controls: [
            { path: 'limits.min_cell_mass', label: '最小细胞质量', min: 1, max: 80, step: 0.5 },
            { path: 'split.min_result_mass', label: '分身后最小质量', min: 1, max: 120, step: 0.5 },
            { path: 'splitImpulseScale', label: '分身速度映射', min: 10, max: 220, step: 1 },
            { path: 'ejectSpeedScale', label: '吐球速度映射', min: 10, max: 220, step: 1 },
            { path: 'spikeImpulseScale', label: '扎刺速度映射', min: 10, max: 220, step: 1 }
        ]
    }
];

function getValueAtPath(root: GameplayTuning, path: string): number {
    const value = path.split('.').reduce<unknown>((current, part) => {
        if (Array.isArray(current)) {
            const index = Number.parseInt(part, 10);
            if (!Number.isInteger(index) || index < 0 || index >= current.length) {
                return undefined;
            }
            return current[index];
        }

        if (current && typeof current === 'object') {
            return (current as Record<string, unknown>)[part];
        }

        return undefined;
    }, root);

    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function setValueAtPath(root: GameplayTuning, path: string, value: number): boolean {
    const parts = path.split('.');
    let current: unknown = root;

    for (let i = 0; i < parts.length - 1; i += 1) {
        const part = parts[i];

        if (Array.isArray(current)) {
            const index = Number.parseInt(part, 10);
            if (!Number.isInteger(index) || index < 0 || index >= current.length) {
                return false;
            }
            current = current[index];
            continue;
        }

        if (!current || typeof current !== 'object') {
            return false;
        }

        const record = current as Record<string, unknown>;
        if (!(part in record)) {
            return false;
        }
        current = record[part];
    }

    const last = parts[parts.length - 1];
    if (Array.isArray(current)) {
        const index = Number.parseInt(last, 10);
        if (!Number.isInteger(index) || index < 0 || index >= current.length) {
            return false;
        }
        current[index] = value;
        return true;
    }

    if (current && typeof current === 'object') {
        (current as Record<string, unknown>)[last] = value;
        return true;
    }

    return false;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export class TuningToolbox {
    private readonly root: HTMLDivElement;
    private readonly controls = new Map<string, ControlRefs>();
    private readonly options: TuningToolboxOptions;
    private readonly statusEl: HTMLDivElement;
    private readonly previewEl: HTMLTextAreaElement;
    private readonly derivedEl: HTMLDivElement;
    private readonly versionInput: HTMLInputElement;

    constructor(options: TuningToolboxOptions = {}) {
        this.options = options;
        this.root = document.createElement('div');
        this.root.className = 'tuning-toolbox';

        const head = document.createElement('div');
        head.className = 'tuning-toolbox-head';
        this.root.appendChild(head);

        const versionField = document.createElement('label');
        versionField.className = 'tuning-version-field';
        versionField.innerHTML = '<span>参数版本</span>';
        this.versionInput = document.createElement('input');
        this.versionInput.type = 'text';
        this.versionInput.maxLength = 24;
        this.versionInput.value = gameplayTuning.presetVersion;
        versionField.appendChild(this.versionInput);
        head.appendChild(versionField);

        const actionRow = document.createElement('div');
        actionRow.className = 'tuning-action-row';
        head.appendChild(actionRow);

        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.className = 'tuning-action-button';
        saveButton.textContent = '保存本地';
        actionRow.appendChild(saveButton);

        const resetButton = document.createElement('button');
        resetButton.type = 'button';
        resetButton.className = 'tuning-action-button';
        resetButton.textContent = '恢复默认';
        actionRow.appendChild(resetButton);

        const copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.className = 'tuning-action-button';
        copyButton.textContent = '复制 JSON';
        actionRow.appendChild(copyButton);

        this.statusEl = document.createElement('div');
        this.statusEl.className = 'tuning-status';
        this.statusEl.textContent = '实时调参已启用：拖动后立即生效';
        this.root.appendChild(this.statusEl);

        this.derivedEl = document.createElement('div');
        this.derivedEl.className = 'tuning-derived';
        this.root.appendChild(this.derivedEl);

        const body = document.createElement('div');
        body.className = 'tuning-toolbox-body';
        this.root.appendChild(body);

        for (const group of CONTROL_GROUPS) {
            const section = document.createElement('details');
            section.className = 'tuning-group';
            section.open = true;
            body.appendChild(section);

            const summary = document.createElement('summary');
            summary.textContent = group.title;
            section.appendChild(summary);

            const list = document.createElement('div');
            list.className = 'tuning-group-list';
            section.appendChild(list);

            for (const control of group.controls) {
                list.appendChild(this.createControlRow(control));
            }
        }

        this.previewEl = document.createElement('textarea');
        this.previewEl.className = 'tuning-preview';
        this.previewEl.readOnly = true;
        this.previewEl.spellcheck = false;
        this.root.appendChild(this.previewEl);

        this.versionInput.addEventListener('change', () => {
            const next = this.versionInput.value.trim();
            gameplayTuning.presetVersion = next.length > 0 ? next : 'split_custom';
            this.versionInput.value = gameplayTuning.presetVersion;
            this.notifyChange();
            this.syncView();
        });

        saveButton.addEventListener('click', () => {
            saveGameplayTuningToStorage();
            this.setStatus('已保存到本地浏览器，下次启动会自动加载');
        });

        resetButton.addEventListener('click', () => {
            resetGameplayTuningToDefaults();
            this.syncView();
            this.notifyChange();
            this.setStatus('已恢复默认参数并清除本地覆盖');
        });

        copyButton.addEventListener('click', async () => {
            const text = JSON.stringify(cloneGameplayTuning(), null, 2);
            await this.copyText(text);
        });

        this.syncView();
    }

    mount(parent: HTMLElement) {
        parent.appendChild(this.root);
    }

    destroy() {
        this.root.remove();
    }

    private createControlRow(control: ControlSpec): HTMLElement {
        const row = document.createElement('div');
        row.className = 'tuning-control-row';

        const labelWrap = document.createElement('div');
        labelWrap.className = 'tuning-control-label';
        row.appendChild(labelWrap);

        const label = document.createElement('span');
        label.textContent = control.label;
        labelWrap.appendChild(label);

        const value = document.createElement('span');
        value.className = 'tuning-control-value';
        labelWrap.appendChild(value);

        if (control.description) {
            const desc = document.createElement('small');
            desc.textContent = control.description;
            row.appendChild(desc);
        }

        const inputs = document.createElement('div');
        inputs.className = 'tuning-control-inputs';
        row.appendChild(inputs);

        const range = document.createElement('input');
        range.type = 'range';
        range.min = String(control.min);
        range.max = String(control.max);
        range.step = String(control.step);
        inputs.appendChild(range);

        const number = document.createElement('input');
        number.type = 'number';
        number.min = String(control.min);
        number.max = String(control.max);
        number.step = String(control.step);
        inputs.appendChild(number);

        const onValueChange = (raw: string) => {
            const parsed = Number.parseFloat(raw);
            if (!Number.isFinite(parsed)) {
                return;
            }

            const next = clamp(parsed, control.min, control.max);
            const draft = cloneGameplayTuning();
            if (!setValueAtPath(draft, control.path, next)) {
                return;
            }
            this.normalizeDependentRules(draft);
            replaceGameplayTuning(draft);
            this.syncView();
            this.notifyChange();
        };

        range.addEventListener('input', () => onValueChange(range.value));
        number.addEventListener('change', () => onValueChange(number.value));

        this.controls.set(control.path, { range, number, value });
        return row;
    }

    private normalizeDependentRules(draft: GameplayTuning) {
        draft.limits.max_cells = Math.max(2, Math.floor(draft.limits.max_cells));
        draft.limits.min_cell_mass = Math.max(1, draft.limits.min_cell_mass);

        draft.split.min_result_mass = Math.max(
            draft.limits.min_cell_mass,
            draft.split.min_result_mass
        );
        draft.split.min_trigger_mass = Math.max(
            draft.split.min_result_mass * 2,
            draft.split.min_trigger_mass
        );

        draft.spike.min_piece_mass = Math.max(
            draft.limits.min_cell_mass,
            draft.spike.min_piece_mass
        );
        draft.spike.target_cell_count = Math.max(2, Math.floor(draft.spike.target_cell_count));
        draft.spike.max_piece_ratio = clamp(draft.spike.max_piece_ratio, 0.2, 0.75);
        draft.spike.main_cell_ratio = clamp(draft.spike.main_cell_ratio, 0.1, 0.75);
        draft.spike.piece_random_factor = clamp(draft.spike.piece_random_factor, 0, 0.5);
        draft.spike.burst_impulse_jitter = clamp(draft.spike.burst_impulse_jitter, 0, 0.3);
        draft.spike.ring_radius_factor = clamp(draft.spike.ring_radius_factor, 0.7, 2.2);
        draft.spike.circle_jitter_angle = clamp(draft.spike.circle_jitter_angle, 0, 15);
        draft.spike.virus_bonus_mass = Math.max(0, draft.spike.virus_bonus_mass);
        draft.spike.virus_feed_mass_gain = Math.max(0, draft.spike.virus_feed_mass_gain);
        draft.spike.virus_feed_split_feeds = Math.max(1, Math.floor(draft.spike.virus_feed_split_feeds));
        draft.spike.virus_feed_push_force = Math.max(0, draft.spike.virus_feed_push_force);
        draft.spike.virus_feed_split_speed = Math.max(20, draft.spike.virus_feed_split_speed);
        draft.spike.virus_feed_split_distance = Math.max(0, draft.spike.virus_feed_split_distance);
        draft.spike.virus_feed_reset_mass = Math.max(draft.limits.min_cell_mass, draft.spike.virus_feed_reset_mass);
        draft.spike.virus_feed_split_mass = Math.max(draft.spike.virus_feed_reset_mass, draft.spike.virus_feed_split_mass);
        draft.spike.virus_size_piece_bonus = Math.max(0, draft.spike.virus_size_piece_bonus);
        draft.spike.virus_size_ring_bonus = Math.max(0, draft.spike.virus_size_ring_bonus);
        draft.spike.virus_size_impulse_bonus = Math.max(0, draft.spike.virus_size_impulse_bonus);

        if (draft.decay.anchor_masses.length > 0) {
            draft.decay.anchor_masses[0] = Math.max(
                draft.decay.anchor_masses[0],
                draft.limits.min_cell_mass
            );
        }

        draft.merge.min_lock_time = Math.max(0, draft.merge.min_lock_time);
        draft.merge.max_lock_time = Math.max(
            draft.merge.min_lock_time + 0.05,
            draft.merge.max_lock_time
        );
        draft.merge.small_piece_factor = clamp(draft.merge.small_piece_factor, 0.1, 1);
        draft.merge.small_piece_ratio_anchor = clamp(draft.merge.small_piece_ratio_anchor, 0.01, 1);
        draft.merge.low_total_mass_anchor = Math.max(draft.limits.min_cell_mass, draft.merge.low_total_mass_anchor);
        draft.merge.high_total_mass_anchor = Math.max(
            draft.merge.low_total_mass_anchor + 1,
            draft.merge.high_total_mass_anchor
        );
        draft.merge.low_total_mass_factor = Math.max(0.2, draft.merge.low_total_mass_factor);
        draft.merge.high_total_mass_factor = Math.max(
            draft.merge.low_total_mass_factor,
            draft.merge.high_total_mass_factor
        );
        draft.merge.cohesion_near_ratio = Math.max(0, draft.merge.cohesion_near_ratio);
        draft.merge.cohesion_far_ratio = Math.max(
            draft.merge.cohesion_near_ratio + 0.01,
            draft.merge.cohesion_far_ratio
        );
        draft.merge.cohesion_near_gain = Math.max(0, draft.merge.cohesion_near_gain);
        draft.merge.cohesion_far_gain = Math.max(
            draft.merge.cohesion_near_gain,
            draft.merge.cohesion_far_gain
        );
        draft.merge.cohesion_pd_damping = Math.max(0, draft.merge.cohesion_pd_damping);
        draft.merge.cohesion_max_pull = Math.max(10, draft.merge.cohesion_max_pull);
        draft.merge.cohesion_lock_multiplier = Math.max(0.1, draft.merge.cohesion_lock_multiplier);
        draft.merge.buddy_pull_gain = Math.max(0, draft.merge.buddy_pull_gain);
        draft.merge.buddy_max_pull = Math.max(0, draft.merge.buddy_max_pull);
    }

    private notifyChange() {
        if (this.options.onTuningChanged) {
            this.options.onTuningChanged(cloneGameplayTuning());
        }
    }

    private syncView() {
        for (const group of CONTROL_GROUPS) {
            for (const control of group.controls) {
                const refs = this.controls.get(control.path);
                if (!refs) {
                    continue;
                }

                const value = getValueAtPath(gameplayTuning, control.path);
                refs.range.value = String(value);
                refs.number.value = String(Number(value.toFixed(6)));
                refs.value.textContent = control.formatter
                    ? control.formatter(value)
                    : Number(value.toFixed(4)).toString();
            }
        }

        this.versionInput.value = gameplayTuning.presetVersion;
        this.derivedEl.textContent = `分身门槛 ${gameplayTuning.split.min_trigger_mass.toFixed(1)} / 子球下限 ${gameplayTuning.split.min_result_mass.toFixed(1)} / 回拢近远阈值 ${gameplayTuning.merge.cohesion_near_ratio.toFixed(2)}→${gameplayTuning.merge.cohesion_far_ratio.toFixed(2)}`;
        this.previewEl.value = JSON.stringify(cloneGameplayTuning(), null, 2);
    }

    private setStatus(text: string) {
        this.statusEl.textContent = text;
        window.setTimeout(() => {
            if (this.statusEl.textContent === text) {
                this.statusEl.textContent = '实时调参已启用：拖动后立即生效';
            }
        }, 2200);
    }

    private async copyText(text: string) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                this.previewEl.focus();
                this.previewEl.select();
                document.execCommand('copy');
            }
            this.setStatus('当前参数 JSON 已复制，可直接发我做永久写入');
        } catch (error) {
            console.error('Failed to copy tuning JSON:', error);
            this.setStatus('复制失败，请手动复制下方 JSON');
        }
    }
}
