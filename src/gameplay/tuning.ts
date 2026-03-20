export interface GameplayTuning {
    presetVersion: string;
    splitImpulseScale: number;
    ejectSpeedScale: number;
    spikeImpulseScale: number;
    limits: {
        min_cell_mass: number;
        max_cells: number;
    };
    split: {
        base_impulse: number;
        mass_impulse_factor: number;
        impulse_decay: number;
        dash_time: number;
        spawn_offset: number;
        spawn_mode: 'touching_then_inertia';
        touch_epsilon: number;
        grace_time: number;
        min_result_mass: number;
        min_trigger_mass: number;
        direction_random_angle: number;
        self_push_factor: number;
    };
    eject: {
        cost_mass: number;
        spawn_mass: number;
        spawn_distance: number;
        launch_speed: number;
        cooldown: number;
        reabsorb_lock: number;
        recoil_factor: number;
    };
    decay: {
        anchor_masses: number[];
        anchor_loss_30s: number[];
        extra_cell_factor: number;
    };
    spike: {
        target_cell_count: number;
        main_cell_ratio: number;
        max_piece_ratio: number;
        piece_mass_cap: number;
        piece_random_factor: number;
        burst_impulse: number;
        burst_impulse_jitter: number;
        min_piece_mass: number;
        spread_angle: number;
        ring_radius_factor: number;
        circle_jitter_angle: number;
        virus_bonus_mass: number;
        virus_feed_mass_gain: number;
        virus_feed_split_feeds: number;
        virus_feed_split_mass: number;
        virus_feed_push_force: number;
        virus_feed_split_speed: number;
        virus_feed_split_distance: number;
        virus_feed_reset_mass: number;
        virus_size_piece_bonus: number;
        virus_size_ring_bonus: number;
        virus_size_impulse_bonus: number;
    };
    merge: {
        lock_time: number;
        min_lock_time: number;
        max_lock_time: number;
        small_piece_factor: number;
        small_piece_ratio_anchor: number;
        low_total_mass_anchor: number;
        high_total_mass_anchor: number;
        low_total_mass_factor: number;
        high_total_mass_factor: number;
        overlap_push_factor: number;
        attract_factor: number;
        cohesion_near_ratio: number;
        cohesion_far_ratio: number;
        cohesion_near_gain: number;
        cohesion_far_gain: number;
        cohesion_pd_damping: number;
        cohesion_max_pull: number;
        cohesion_lock_multiplier: number;
        buddy_pull_gain: number;
        buddy_max_pull: number;
    };
}

export type GameplayTuningPatch = Partial<{
    presetVersion: string;
    splitImpulseScale: number;
    ejectSpeedScale: number;
    spikeImpulseScale: number;
    limits: Partial<GameplayTuning['limits']>;
    split: Partial<GameplayTuning['split']>;
    eject: Partial<GameplayTuning['eject']>;
    decay: Partial<GameplayTuning['decay']>;
    spike: Partial<GameplayTuning['spike']>;
    merge: Partial<GameplayTuning['merge']>;
}>;

export const TUNING_STORAGE_KEY = 'bop:gameplay-tuning';

export const DEFAULT_GAMEPLAY_TUNING: GameplayTuning = {
    presetVersion: 'split_v01',
    splitImpulseScale: 90,
    ejectSpeedScale: 78,
    spikeImpulseScale: 62,
    limits: {
        min_cell_mass: 35,
        max_cells: 16
    },
    split: {
        base_impulse: 60.0,
        mass_impulse_factor: 0.27,
        impulse_decay: 4.2,
        dash_time: 0.25,
        spawn_offset: 1.18,
        spawn_mode: 'touching_then_inertia',
        touch_epsilon: 0.004,
        grace_time: 0.18,
        min_result_mass: 35,
        min_trigger_mass: 70,
        direction_random_angle: 1.2,
        self_push_factor: 0.75
    },
    eject: {
        cost_mass: 14.6,
        spawn_mass: 14.5,
        spawn_distance: 20,
        launch_speed: 18.5,
        cooldown: 0.08,
        reabsorb_lock: 0.32,
        recoil_factor: 0
    },
    decay: {
        // Anchors represent "loss ratio in 30s when idle and not eating".
        anchor_masses: [35, 200, 1000, 5000, 12000],
        anchor_loss_30s: [0.0012, 0.008, 0.02, 0.07, 0.1294],
        extra_cell_factor: 0.02
    },
    spike: {
        target_cell_count: 9,
        main_cell_ratio: 0.4,
        max_piece_ratio: 0.52,
        piece_mass_cap: 100,
        piece_random_factor: 0.02,
        burst_impulse: 16.5,
        burst_impulse_jitter: 0,
        min_piece_mass: 35,
        spread_angle: 360,
        ring_radius_factor: 1.08,
        circle_jitter_angle: 0,
        virus_bonus_mass: 200,
        virus_feed_mass_gain: 10,
        virus_feed_split_feeds: 7,
        virus_feed_split_mass: 550,
        virus_feed_push_force: 50,
        virus_feed_split_speed: 600,
        virus_feed_split_distance: 140,
        virus_feed_reset_mass: 480,
        virus_size_piece_bonus: 3,
        virus_size_ring_bonus: 0.35,
        virus_size_impulse_bonus: 0.25
    },
    merge: {
        lock_time: 8.0,
        min_lock_time: 2.2,
        max_lock_time: 24,
        small_piece_factor: 0.58,
        small_piece_ratio_anchor: 0.25,
        low_total_mass_anchor: 200,
        high_total_mass_anchor: 12000,
        low_total_mass_factor: 0.72,
        high_total_mass_factor: 1.85,
        overlap_push_factor: 0.28,
        attract_factor: 0.16,
        cohesion_near_ratio: 0.18,
        cohesion_far_ratio: 1.4,
        cohesion_near_gain: 5.5,
        cohesion_far_gain: 21,
        cohesion_pd_damping: 0.45,
        cohesion_max_pull: 320,
        cohesion_lock_multiplier: 1.2,
        buddy_pull_gain: 7.5,
        buddy_max_pull: 120
    }
};

export const gameplayTuning: GameplayTuning = cloneGameplayTuning(DEFAULT_GAMEPLAY_TUNING);

function toFiniteNumber(value: unknown, fallback: number, min?: number, max?: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }

    let next = value;
    if (min !== undefined) {
        next = Math.max(min, next);
    }
    if (max !== undefined) {
        next = Math.min(max, next);
    }
    return next;
}

function toLossAnchors(value: unknown, fallback: number[]): number[] {
    const source = Array.isArray(value) ? value : fallback;
    const next = fallback.map((fallbackItem, index) => {
        const current = source[index];
        return toFiniteNumber(current, fallbackItem, 0, 0.95);
    });
    return next;
}

function toMassAnchors(value: unknown, fallback: number[], minMassFloor: number): number[] {
    const source = Array.isArray(value) ? value : fallback;
    const next = fallback.map((fallbackItem, index) => {
        const current = source[index];
        return toFiniteNumber(current, fallbackItem, 1);
    });

    if (next.length === 0) {
        return [minMassFloor, minMassFloor + 1];
    }

    next[0] = Math.max(minMassFloor, next[0]);
    for (let i = 1; i < next.length; i += 1) {
        next[i] = Math.max(next[i], next[i - 1] + 1);
    }
    return next;
}

function sanitizeGameplayTuning(raw: GameplayTuningPatch | GameplayTuning | undefined): GameplayTuning {
    const defaults = DEFAULT_GAMEPLAY_TUNING;
    const source = raw ?? {};

    const limitsSource = source.limits ?? {};
    const splitSource = source.split ?? {};
    const ejectSource = source.eject ?? {};
    const decaySource = source.decay ?? {};
    const spikeSource = source.spike ?? {};
    const mergeSource = source.merge ?? {};

    const minCellMass = toFiniteNumber(
        limitsSource.min_cell_mass,
        defaults.limits.min_cell_mass,
        1
    );
    const maxCells = Math.floor(
        toFiniteNumber(limitsSource.max_cells, defaults.limits.max_cells, 2, 64)
    );

    const splitMinResultMass = toFiniteNumber(
        splitSource.min_result_mass,
        defaults.split.min_result_mass,
        minCellMass
    );

    const splitMinTriggerMass = toFiniteNumber(
        splitSource.min_trigger_mass,
        defaults.split.min_trigger_mass,
        splitMinResultMass * 2
    );

    const minPieceMass = toFiniteNumber(
        spikeSource.min_piece_mass,
        defaults.spike.min_piece_mass,
        minCellMass
    );
    const pieceMassCap = toFiniteNumber(
        spikeSource.piece_mass_cap,
        defaults.spike.piece_mass_cap,
        minPieceMass,
        5000
    );
    const virusFeedResetMass = toFiniteNumber(
        spikeSource.virus_feed_reset_mass,
        defaults.spike.virus_feed_reset_mass,
        minCellMass
    );

    const lowTotalMassAnchor = toFiniteNumber(
        mergeSource.low_total_mass_anchor,
        defaults.merge.low_total_mass_anchor,
        minCellMass
    );
    const highTotalMassAnchor = toFiniteNumber(
        mergeSource.high_total_mass_anchor,
        defaults.merge.high_total_mass_anchor,
        lowTotalMassAnchor + 1
    );
    const minLockTime = toFiniteNumber(
        mergeSource.min_lock_time,
        defaults.merge.min_lock_time,
        0
    );
    const maxLockTime = toFiniteNumber(
        mergeSource.max_lock_time,
        defaults.merge.max_lock_time,
        minLockTime + 0.05
    );
    const lowTotalMassFactor = toFiniteNumber(
        mergeSource.low_total_mass_factor,
        defaults.merge.low_total_mass_factor,
        0.2,
        2
    );
    const highTotalMassFactor = toFiniteNumber(
        mergeSource.high_total_mass_factor,
        defaults.merge.high_total_mass_factor,
        lowTotalMassFactor,
        4
    );
    const cohesionNearRatio = toFiniteNumber(
        mergeSource.cohesion_near_ratio,
        defaults.merge.cohesion_near_ratio,
        0,
        4
    );
    const cohesionFarRatio = toFiniteNumber(
        mergeSource.cohesion_far_ratio,
        defaults.merge.cohesion_far_ratio,
        cohesionNearRatio + 0.01,
        8
    );
    const cohesionNearGain = toFiniteNumber(
        mergeSource.cohesion_near_gain,
        defaults.merge.cohesion_near_gain,
        0,
        100
    );
    const cohesionFarGain = toFiniteNumber(
        mergeSource.cohesion_far_gain,
        defaults.merge.cohesion_far_gain,
        cohesionNearGain,
        160
    );

    const anchorMasses = toMassAnchors(
        decaySource.anchor_masses,
        defaults.decay.anchor_masses,
        minCellMass
    );

    const anchorLosses = toLossAnchors(
        decaySource.anchor_loss_30s,
        defaults.decay.anchor_loss_30s
    );

    const anchorLength = Math.min(anchorMasses.length, anchorLosses.length);
    const safeAnchorMasses = anchorMasses.slice(0, Math.max(2, anchorLength));
    const safeAnchorLosses = anchorLosses.slice(0, Math.max(2, anchorLength));

    return {
        presetVersion: typeof source.presetVersion === 'string' && source.presetVersion.trim().length > 0
            ? source.presetVersion.trim()
            : defaults.presetVersion,
        splitImpulseScale: toFiniteNumber(source.splitImpulseScale, defaults.splitImpulseScale, 1, 300),
        ejectSpeedScale: toFiniteNumber(source.ejectSpeedScale, defaults.ejectSpeedScale, 1, 300),
        spikeImpulseScale: toFiniteNumber(source.spikeImpulseScale, defaults.spikeImpulseScale, 1, 300),
        limits: {
            min_cell_mass: minCellMass,
            max_cells: maxCells
        },
        split: {
            base_impulse: toFiniteNumber(splitSource.base_impulse, defaults.split.base_impulse, 1, 120),
            mass_impulse_factor: toFiniteNumber(splitSource.mass_impulse_factor, defaults.split.mass_impulse_factor, 0.01, 1.2),
            impulse_decay: toFiniteNumber(splitSource.impulse_decay, defaults.split.impulse_decay, 0.1, 30),
            dash_time: toFiniteNumber(splitSource.dash_time, defaults.split.dash_time, 0.05, 2),
            spawn_offset: toFiniteNumber(splitSource.spawn_offset, defaults.split.spawn_offset, 0.8, 2.5),
            spawn_mode: 'touching_then_inertia',
            touch_epsilon: toFiniteNumber(splitSource.touch_epsilon, defaults.split.touch_epsilon, 0, 0.2),
            grace_time: toFiniteNumber(splitSource.grace_time, defaults.split.grace_time, 0, 1.5),
            min_result_mass: splitMinResultMass,
            min_trigger_mass: splitMinTriggerMass,
            direction_random_angle: toFiniteNumber(splitSource.direction_random_angle, defaults.split.direction_random_angle, 0, 12),
            self_push_factor: toFiniteNumber(splitSource.self_push_factor, defaults.split.self_push_factor, 0.01, 1.5)
        },
        eject: {
            cost_mass: toFiniteNumber(ejectSource.cost_mass, defaults.eject.cost_mass, 1, 200),
            spawn_mass: toFiniteNumber(ejectSource.spawn_mass, defaults.eject.spawn_mass, 0.1, 200),
            spawn_distance: toFiniteNumber(ejectSource.spawn_distance, defaults.eject.spawn_distance, 0, 240),
            launch_speed: toFiniteNumber(ejectSource.launch_speed, defaults.eject.launch_speed, 0.5, 120),
            cooldown: toFiniteNumber(ejectSource.cooldown, defaults.eject.cooldown, 0.01, 1),
            reabsorb_lock: toFiniteNumber(ejectSource.reabsorb_lock, defaults.eject.reabsorb_lock, 0, 2),
            recoil_factor: toFiniteNumber(ejectSource.recoil_factor, defaults.eject.recoil_factor, 0, 1)
        },
        decay: {
            anchor_masses: safeAnchorMasses,
            anchor_loss_30s: safeAnchorLosses,
            extra_cell_factor: toFiniteNumber(decaySource.extra_cell_factor, defaults.decay.extra_cell_factor, 0, 0.3)
        },
        spike: {
            target_cell_count: Math.floor(toFiniteNumber(spikeSource.target_cell_count, defaults.spike.target_cell_count, 2, 32)),
            main_cell_ratio: toFiniteNumber(spikeSource.main_cell_ratio, defaults.spike.main_cell_ratio, 0.1, 0.8),
            max_piece_ratio: toFiniteNumber(spikeSource.max_piece_ratio, defaults.spike.max_piece_ratio, 0.2, 0.75),
            piece_mass_cap: pieceMassCap,
            piece_random_factor: toFiniteNumber(spikeSource.piece_random_factor, defaults.spike.piece_random_factor, 0, 0.5),
            burst_impulse: toFiniteNumber(spikeSource.burst_impulse, defaults.spike.burst_impulse, 0.1, 120),
            burst_impulse_jitter: toFiniteNumber(spikeSource.burst_impulse_jitter, defaults.spike.burst_impulse_jitter, 0, 0.3),
            min_piece_mass: minPieceMass,
            spread_angle: toFiniteNumber(spikeSource.spread_angle, defaults.spike.spread_angle, 30, 360),
            ring_radius_factor: toFiniteNumber(spikeSource.ring_radius_factor, defaults.spike.ring_radius_factor, 0.7, 2.2),
            circle_jitter_angle: toFiniteNumber(spikeSource.circle_jitter_angle, defaults.spike.circle_jitter_angle, 0, 15),
            virus_bonus_mass: toFiniteNumber(spikeSource.virus_bonus_mass, defaults.spike.virus_bonus_mass, 0, 2000),
            virus_feed_mass_gain: toFiniteNumber(spikeSource.virus_feed_mass_gain, defaults.spike.virus_feed_mass_gain, 0, 200),
            virus_feed_split_feeds: Math.floor(toFiniteNumber(spikeSource.virus_feed_split_feeds, defaults.spike.virus_feed_split_feeds, 1, 64)),
            virus_feed_split_mass: toFiniteNumber(spikeSource.virus_feed_split_mass, defaults.spike.virus_feed_split_mass, virusFeedResetMass, 10000),
            virus_feed_push_force: toFiniteNumber(spikeSource.virus_feed_push_force, defaults.spike.virus_feed_push_force, 0, 500),
            virus_feed_split_speed: toFiniteNumber(spikeSource.virus_feed_split_speed, defaults.spike.virus_feed_split_speed, 20, 2000),
            virus_feed_split_distance: toFiniteNumber(spikeSource.virus_feed_split_distance, defaults.spike.virus_feed_split_distance, 0, 800),
            virus_feed_reset_mass: virusFeedResetMass,
            virus_size_piece_bonus: toFiniteNumber(spikeSource.virus_size_piece_bonus, defaults.spike.virus_size_piece_bonus, 0, 24),
            virus_size_ring_bonus: toFiniteNumber(spikeSource.virus_size_ring_bonus, defaults.spike.virus_size_ring_bonus, 0, 2),
            virus_size_impulse_bonus: toFiniteNumber(spikeSource.virus_size_impulse_bonus, defaults.spike.virus_size_impulse_bonus, 0, 2)
        },
        merge: {
            lock_time: toFiniteNumber(mergeSource.lock_time, defaults.merge.lock_time, 0, 40),
            min_lock_time: minLockTime,
            max_lock_time: maxLockTime,
            small_piece_factor: toFiniteNumber(mergeSource.small_piece_factor, defaults.merge.small_piece_factor, 0.1, 1),
            small_piece_ratio_anchor: toFiniteNumber(mergeSource.small_piece_ratio_anchor, defaults.merge.small_piece_ratio_anchor, 0.01, 1),
            low_total_mass_anchor: lowTotalMassAnchor,
            high_total_mass_anchor: highTotalMassAnchor,
            low_total_mass_factor: lowTotalMassFactor,
            high_total_mass_factor: highTotalMassFactor,
            overlap_push_factor: toFiniteNumber(mergeSource.overlap_push_factor, defaults.merge.overlap_push_factor, 0.01, 1.5),
            attract_factor: toFiniteNumber(mergeSource.attract_factor, defaults.merge.attract_factor, 0.01, 1.5),
            cohesion_near_ratio: cohesionNearRatio,
            cohesion_far_ratio: cohesionFarRatio,
            cohesion_near_gain: cohesionNearGain,
            cohesion_far_gain: cohesionFarGain,
            cohesion_pd_damping: toFiniteNumber(mergeSource.cohesion_pd_damping, defaults.merge.cohesion_pd_damping, 0, 4),
            cohesion_max_pull: toFiniteNumber(mergeSource.cohesion_max_pull, defaults.merge.cohesion_max_pull, 10, 1200),
            cohesion_lock_multiplier: toFiniteNumber(mergeSource.cohesion_lock_multiplier, defaults.merge.cohesion_lock_multiplier, 0.1, 3),
            buddy_pull_gain: toFiniteNumber(mergeSource.buddy_pull_gain, defaults.merge.buddy_pull_gain, 0, 40),
            buddy_max_pull: toFiniteNumber(mergeSource.buddy_max_pull, defaults.merge.buddy_max_pull, 0, 1000)
        }
    };
}

function assignGameplayTuning(target: GameplayTuning, source: GameplayTuning) {
    target.presetVersion = source.presetVersion;
    target.splitImpulseScale = source.splitImpulseScale;
    target.ejectSpeedScale = source.ejectSpeedScale;
    target.spikeImpulseScale = source.spikeImpulseScale;

    target.limits.min_cell_mass = source.limits.min_cell_mass;
    target.limits.max_cells = source.limits.max_cells;

    target.split.base_impulse = source.split.base_impulse;
    target.split.mass_impulse_factor = source.split.mass_impulse_factor;
    target.split.impulse_decay = source.split.impulse_decay;
    target.split.dash_time = source.split.dash_time;
    target.split.spawn_offset = source.split.spawn_offset;
    target.split.spawn_mode = source.split.spawn_mode;
    target.split.touch_epsilon = source.split.touch_epsilon;
    target.split.grace_time = source.split.grace_time;
    target.split.min_result_mass = source.split.min_result_mass;
    target.split.min_trigger_mass = source.split.min_trigger_mass;
    target.split.direction_random_angle = source.split.direction_random_angle;
    target.split.self_push_factor = source.split.self_push_factor;

    target.eject.cost_mass = source.eject.cost_mass;
    target.eject.spawn_mass = source.eject.spawn_mass;
    target.eject.spawn_distance = source.eject.spawn_distance;
    target.eject.launch_speed = source.eject.launch_speed;
    target.eject.cooldown = source.eject.cooldown;
    target.eject.reabsorb_lock = source.eject.reabsorb_lock;
    target.eject.recoil_factor = source.eject.recoil_factor;

    target.decay.anchor_masses = [...source.decay.anchor_masses];
    target.decay.anchor_loss_30s = [...source.decay.anchor_loss_30s];
    target.decay.extra_cell_factor = source.decay.extra_cell_factor;

    target.spike.target_cell_count = source.spike.target_cell_count;
    target.spike.main_cell_ratio = source.spike.main_cell_ratio;
    target.spike.max_piece_ratio = source.spike.max_piece_ratio;
    target.spike.piece_mass_cap = source.spike.piece_mass_cap;
    target.spike.piece_random_factor = source.spike.piece_random_factor;
    target.spike.burst_impulse = source.spike.burst_impulse;
    target.spike.burst_impulse_jitter = source.spike.burst_impulse_jitter;
    target.spike.min_piece_mass = source.spike.min_piece_mass;
    target.spike.spread_angle = source.spike.spread_angle;
    target.spike.ring_radius_factor = source.spike.ring_radius_factor;
    target.spike.circle_jitter_angle = source.spike.circle_jitter_angle;
    target.spike.virus_bonus_mass = source.spike.virus_bonus_mass;
    target.spike.virus_feed_mass_gain = source.spike.virus_feed_mass_gain;
    target.spike.virus_feed_split_feeds = source.spike.virus_feed_split_feeds;
    target.spike.virus_feed_split_mass = source.spike.virus_feed_split_mass;
    target.spike.virus_feed_push_force = source.spike.virus_feed_push_force;
    target.spike.virus_feed_split_speed = source.spike.virus_feed_split_speed;
    target.spike.virus_feed_split_distance = source.spike.virus_feed_split_distance;
    target.spike.virus_feed_reset_mass = source.spike.virus_feed_reset_mass;
    target.spike.virus_size_piece_bonus = source.spike.virus_size_piece_bonus;
    target.spike.virus_size_ring_bonus = source.spike.virus_size_ring_bonus;
    target.spike.virus_size_impulse_bonus = source.spike.virus_size_impulse_bonus;

    target.merge.lock_time = source.merge.lock_time;
    target.merge.min_lock_time = source.merge.min_lock_time;
    target.merge.max_lock_time = source.merge.max_lock_time;
    target.merge.small_piece_factor = source.merge.small_piece_factor;
    target.merge.small_piece_ratio_anchor = source.merge.small_piece_ratio_anchor;
    target.merge.low_total_mass_anchor = source.merge.low_total_mass_anchor;
    target.merge.high_total_mass_anchor = source.merge.high_total_mass_anchor;
    target.merge.low_total_mass_factor = source.merge.low_total_mass_factor;
    target.merge.high_total_mass_factor = source.merge.high_total_mass_factor;
    target.merge.overlap_push_factor = source.merge.overlap_push_factor;
    target.merge.attract_factor = source.merge.attract_factor;
    target.merge.cohesion_near_ratio = source.merge.cohesion_near_ratio;
    target.merge.cohesion_far_ratio = source.merge.cohesion_far_ratio;
    target.merge.cohesion_near_gain = source.merge.cohesion_near_gain;
    target.merge.cohesion_far_gain = source.merge.cohesion_far_gain;
    target.merge.cohesion_pd_damping = source.merge.cohesion_pd_damping;
    target.merge.cohesion_max_pull = source.merge.cohesion_max_pull;
    target.merge.cohesion_lock_multiplier = source.merge.cohesion_lock_multiplier;
    target.merge.buddy_pull_gain = source.merge.buddy_pull_gain;
    target.merge.buddy_max_pull = source.merge.buddy_max_pull;
}

export function cloneGameplayTuning(source: GameplayTuning = gameplayTuning): GameplayTuning {
    return sanitizeGameplayTuning(source);
}

export function replaceGameplayTuning(next: GameplayTuning): GameplayTuning {
    const normalized = sanitizeGameplayTuning(next);
    assignGameplayTuning(gameplayTuning, normalized);
    return cloneGameplayTuning(gameplayTuning);
}

export function applyGameplayTuningPatch(patch: GameplayTuningPatch): GameplayTuning {
    const merged = sanitizeGameplayTuning({
        ...cloneGameplayTuning(gameplayTuning),
        ...patch,
        limits: {
            ...gameplayTuning.limits,
            ...patch.limits
        },
        split: {
            ...gameplayTuning.split,
            ...patch.split
        },
        eject: {
            ...gameplayTuning.eject,
            ...patch.eject
        },
        decay: {
            ...gameplayTuning.decay,
            ...patch.decay
        },
        spike: {
            ...gameplayTuning.spike,
            ...patch.spike
        },
        merge: {
            ...gameplayTuning.merge,
            ...patch.merge
        }
    });

    assignGameplayTuning(gameplayTuning, merged);
    return cloneGameplayTuning(gameplayTuning);
}

export function saveGameplayTuningToStorage() {
    try {
        window.localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(gameplayTuning));
    } catch (error) {
        console.error('Failed to save gameplay tuning:', error);
    }
}

export function loadGameplayTuningFromStorage(): GameplayTuning | null {
    try {
        const raw = window.localStorage.getItem(TUNING_STORAGE_KEY);
        if (!raw) {
            return null;
        }

        const parsed = JSON.parse(raw) as GameplayTuningPatch;
        const normalized = sanitizeGameplayTuning(parsed);
        assignGameplayTuning(gameplayTuning, normalized);
        return cloneGameplayTuning(gameplayTuning);
    } catch (error) {
        console.error('Failed to load gameplay tuning:', error);
        return null;
    }
}

export function resetGameplayTuningToDefaults(): GameplayTuning {
    assignGameplayTuning(gameplayTuning, cloneGameplayTuning(DEFAULT_GAMEPLAY_TUNING));
    try {
        window.localStorage.removeItem(TUNING_STORAGE_KEY);
    } catch (error) {
        console.error('Failed to reset gameplay tuning storage:', error);
    }
    return cloneGameplayTuning(gameplayTuning);
}

if (typeof window !== 'undefined') {
    loadGameplayTuningFromStorage();
}
