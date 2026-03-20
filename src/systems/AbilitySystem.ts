import { Controller } from '../core/Controller';
import { Blob } from '../entities/Blob';
import { Vector } from '../utils/Vector';
import { EjectedMass } from '../entities/EjectedMass';
import { gameplayTuning } from '../gameplay/tuning';

interface SplitStateSnapshot {
    lastSplitMs: number;
    canSplitNow: boolean;
}

export interface SplitMetrics {
    maxDistance: number;
    timeToMaxMs: number;
    peakSpeed: number;
}

export interface EjectMetrics {
    lastCost: number;
    lastSpawnMass: number;
    lastCooldownMs: number;
}

export interface SpikeMetrics {
    mainRatio: number;
    pieceCount: number;
    pieceMasses: number[];
}

interface SplitTrackSample {
    cell: Blob;
    dashDistance: number;
}

interface SplitTrack {
    controller: Controller;
    elapsedMs: number;
    maxDistance: number;
    timeToMaxMs: number;
    peakSpeed: number;
    samples: SplitTrackSample[];
}

export class AbilitySystem {
    private readonly splitStateByController = new WeakMap<Controller, { lastSplitMs: number }>();
    private readonly splitMetricsByController = new WeakMap<Controller, SplitMetrics>();
    private readonly ejectMetricsByController = new WeakMap<Controller, EjectMetrics>();
    private readonly spikeMetricsByController = new WeakMap<Controller, SpikeMetrics>();
    private readonly spikeEventByController = new WeakMap<Controller, number>();
    private readonly splitTracks: SplitTrack[] = [];

    tickRuntime(dt: number) {
        if (dt <= 0 || this.splitTracks.length === 0) {
            return;
        }

        for (let i = this.splitTracks.length - 1; i >= 0; i -= 1) {
            const track = this.splitTracks[i];
            track.elapsedMs += dt * 1000;
            let hasLiveSample = false;

            for (const sample of track.samples) {
                if (!sample.cell || sample.cell.mass <= 0) {
                    continue;
                }

                hasLiveSample = true;
                const dashSpeed = sample.cell.dashVelocity.mag();
                sample.dashDistance += dashSpeed * dt;
                if (sample.dashDistance > track.maxDistance) {
                    track.maxDistance = sample.dashDistance;
                    track.timeToMaxMs = track.elapsedMs;
                }

                const speed = dashSpeed;
                if (speed > track.peakSpeed) {
                    track.peakSpeed = speed;
                }
            }

            const trackEndMs = gameplayTuning.split.dash_time * 1000;
            if (!hasLiveSample || track.elapsedMs >= trackEndMs) {
                this.splitMetricsByController.set(track.controller, {
                    maxDistance: Number(track.maxDistance.toFixed(2)),
                    timeToMaxMs: Number(track.timeToMaxMs.toFixed(1)),
                    peakSpeed: Number(track.peakSpeed.toFixed(2))
                });
                this.splitTracks.splice(i, 1);
            }
        }
    }

    explode(hitCell: Blob, virusPosition: Vector, controller: Controller, virusRadius = 0) {
        const currentCellCount = controller.cells.length;
        const availableSlots = this.getMaxCells() - currentCellCount + 1;
        if (availableSlots < 2) return;

        const totalMass = hitCell.mass;
        const minMassFloor = gameplayTuning.limits.min_cell_mass;
        if (!Number.isFinite(totalMass) || totalMass <= minMassFloor * 2) {
            return;
        }

        const baseVirusRadius = Math.sqrt(480) * 3.5;
        const safeVirusRadius = Number.isFinite(virusRadius) && virusRadius > 0
            ? virusRadius
            : baseVirusRadius;
        const virusScale = this.clamp(safeVirusRadius / baseVirusRadius, 0.6, 3.5);
        const virusScaleBonus = Math.max(0, virusScale - 1);
        const targetCellCount = Math.max(
            2,
            Math.floor(
                gameplayTuning.spike.target_cell_count
                + virusScaleBonus * gameplayTuning.spike.virus_size_piece_bonus
            )
        );
        // User request: virus-split child cells should have an upper mass cap.
        // This cap limits child size, but does not force them to this value.
        const spikeSplitPieceMassCap = Math.max(
            minMassFloor,
            gameplayTuning.spike.piece_mass_cap
        );
        const minPieceMass = Math.min(
            spikeSplitPieceMassCap,
            Math.max(gameplayTuning.spike.min_piece_mass, minMassFloor)
        );
        let targetCount = Math.floor(totalMass / minPieceMass);
        targetCount = Math.max(2, Math.min(availableSlots, targetCellCount, targetCount));
        let mainMass = 0;
        let pieceMasses: number[] = [];

        // Keep one bigger center cell and place small pieces around it.
        // If mass constraints are tight, reduce piece count until distribution becomes feasible.
        while (targetCount >= 2) {
            const piecesToCreate = targetCount - 1;
            const maxMainByFloor = totalMass - minPieceMass * piecesToCreate;
            if (maxMainByFloor < minMassFloor) {
                targetCount -= 1;
                continue;
            }

            const candidateMainMass = this.clamp(
                totalMass * gameplayTuning.spike.main_cell_ratio,
                minMassFloor,
                maxMainByFloor
            );
            const restMass = totalMass - candidateMainMass;
            const childMaxMass = Math.max(
                minPieceMass,
                Math.min(
                    spikeSplitPieceMassCap,
                    candidateMainMass * gameplayTuning.spike.max_piece_ratio
                )
            );

            if (restMass > childMaxMass * piecesToCreate + 0.0001) {
                targetCount -= 1;
                continue;
            }

            mainMass = candidateMainMass;
            pieceMasses = this.distributeMassWithFloor(
                restMass,
                piecesToCreate,
                minPieceMass,
                gameplayTuning.spike.piece_random_factor,
                childMaxMass
            );
            break;
        }

        if (targetCount < 2 || mainMass <= 0) {
            return;
        }

        const allMasses = [mainMass, ...pieceMasses];
        const controllerTotalMass = this.getTotalMass(controller);
        const centerPosition = new Vector(hitCell.position.x, hitCell.position.y);

        let baseDirection = hitCell.velocity.mag() > 0
            ? hitCell.velocity.normalize()
            : hitCell.position.sub(virusPosition).normalize();
        if (baseDirection.mag() === 0 || !Number.isFinite(baseDirection.x) || !Number.isFinite(baseDirection.y)) {
            const angle = Math.random() * Math.PI * 2;
            baseDirection = new Vector(Math.cos(angle), Math.sin(angle));
        }

        const baseAngle = Math.atan2(baseDirection.y, baseDirection.x);
        const spreadRad = this.degToRad(gameplayTuning.spike.spread_angle);
        const randomAngleRad = this.degToRad(gameplayTuning.spike.circle_jitter_angle);
        const angleStep = pieceMasses.length > 0 ? spreadRad / pieceMasses.length : spreadRad;
        const startAngle = baseAngle - spreadRad / 2;
        const impulseJitter = this.clamp(gameplayTuning.spike.burst_impulse_jitter, 0, 0.3);
        const ringRadiusFactor = gameplayTuning.spike.ring_radius_factor
            * (1 + virusScaleBonus * gameplayTuning.spike.virus_size_ring_bonus);
        const burstImpulseBase = gameplayTuning.spike.burst_impulse
            * (1 + virusScaleBonus * gameplayTuning.spike.virus_size_impulse_bonus);

        const dashTime = gameplayTuning.split.dash_time * 0.9;
        const graceTime = gameplayTuning.split.grace_time;
        const newCells: Blob[] = [];

        const centerMergeLock = this.getMergeLockDuration(controllerTotalMass, mainMass);
        hitCell.mass = mainMass;
        hitCell.updateRadiusFromMass();
        hitCell.position = centerPosition;
        hitCell.mergeTimer = Math.max(hitCell.mergeTimer, centerMergeLock);
        hitCell.splitGraceTimer = Math.max(hitCell.splitGraceTimer, graceTime);
        hitCell.dashVelocity = Vector.zero;
        hitCell.dashTimer = 0;
        hitCell.stretchTimer = 0.1;
        hitCell.stretchDirection = baseDirection;
        hitCell.wobbleIntensity = Math.max(hitCell.wobbleIntensity, 2.8);
        hitCell.velocity = hitCell.velocity.mult(0.35);

        for (let i = 0; i < pieceMasses.length; i += 1) {
            const angle = startAngle + angleStep * (i + 0.5) + this.randomRange(-randomAngleRad, randomAngleRad);
            const dir = new Vector(Math.cos(angle), Math.sin(angle));
            const pieceMass = pieceMasses[i];
            const childRadius = Math.sqrt(pieceMass) * 3.5;
            const spawnDistance = (hitCell.radius + childRadius) * ringRadiusFactor;
            const spawnPos = centerPosition.add(dir.mult(spawnDistance));
            const burstImpulse = burstImpulseBase
                * gameplayTuning.spikeImpulseScale
                * this.randomRange(1 - impulseJitter, 1 + impulseJitter);
            const mergeLock = this.getMergeLockDuration(controllerTotalMass, pieceMass);

            const piece = new Blob(spawnPos.x, spawnPos.y, 0, controller.color, pieceMass);
            piece.mergeTimer = mergeLock;
            piece.splitGraceTimer = graceTime;
            piece.dashVelocity = dir.mult(burstImpulse);
            piece.dashTimer = dashTime;
            piece.stretchTimer = 0.1;
            piece.stretchDirection = dir;
            piece.wobbleIntensity = 2.8;
            newCells.push(piece);
        }

        for (const cell of newCells) {
            controller.addCell(cell);
        }

        const normalizedPieceMasses = allMasses.map((m) => Number(m.toFixed(2)));
        this.spikeMetricsByController.set(controller, {
            mainRatio: Number((mainMass / totalMass).toFixed(4)),
            pieceCount: targetCount,
            pieceMasses: normalizedPieceMasses
        });
        const prevEvent = this.spikeEventByController.get(controller) ?? 0;
        this.spikeEventByController.set(controller, prevEvent + 1);
    }

    split(controller: Controller, targetDirection?: Vector) {
        if (controller.cells.length >= this.getMaxCells()) return;

        const beforeTotal = controller.cells.reduce((sum, cell) => sum + cell.mass, 0);
        if (!Number.isFinite(beforeTotal) || beforeTotal <= 0) return;
        const controllerTotalMass = beforeTotal;

        const availableSlots = this.getMaxCells() - controller.cells.length;
        if (availableSlots <= 0) return;

        const eligibleCells = [...controller.cells]
            .filter((cell) => cell.mass >= gameplayTuning.split.min_trigger_mass && cell.mass / 2 >= gameplayTuning.split.min_result_mass)
            .sort((a, b) => b.mass - a.mass)
            .slice(0, availableSlots);

        if (eligibleCells.length === 0) return;

        let baseDirection: Vector;
        if (targetDirection && targetDirection.mag() > 0) {
            baseDirection = targetDirection.normalize();
        } else {
            baseDirection = controller.cells[0]?.velocity.normalize() ?? new Vector(1, 0);
            if (baseDirection.mag() === 0) {
                baseDirection = new Vector(1, 0);
            }
        }

        const spreadRad = this.degToRad(gameplayTuning.split.direction_random_angle);
        const dashTime = gameplayTuning.split.dash_time;
        const graceTime = gameplayTuning.split.grace_time;
        const minMassFloor = gameplayTuning.limits.min_cell_mass;
        const trackSamples: SplitTrackSample[] = [];
        const newCells: Blob[] = [];

        for (const parentCell of eligibleCells) {
            const parentMassBeforeSplit = parentCell.mass;
            const childMass = Math.max(minMassFloor, parentMassBeforeSplit / 2);
            const mergeLock = this.getMergeLockDuration(controllerTotalMass, childMass);

            parentCell.mass = childMass;
            parentCell.updateRadiusFromMass();
            parentCell.mergeTimer = Math.max(parentCell.mergeTimer, mergeLock);
            parentCell.splitGraceTimer = Math.max(parentCell.splitGraceTimer, graceTime);
            parentCell.stretchTimer = 0.1;
            parentCell.wobbleIntensity = Math.max(parentCell.wobbleIntensity, 1.6);

            const angleJitter = this.randomRange(-spreadRad, spreadRad);
            const dir = this.rotate(baseDirection, angleJitter).normalize();
            parentCell.stretchDirection = dir;

            const radius = Math.max(1, parentCell.radius);
            const dashBase = gameplayTuning.split.base_impulse
                * gameplayTuning.splitImpulseScale
                / Math.pow(radius, gameplayTuning.split.mass_impulse_factor);
            const dashImpulse = dashBase * this.randomRange(0.988, 1.012);
            const dashVelocity = dir.mult(dashImpulse);

            parentCell.dashVelocity = parentCell.dashVelocity.sub(dashVelocity.mult(0.12));
            parentCell.dashTimer = Math.max(parentCell.dashTimer, dashTime * 0.35);

            const childRadius = Math.sqrt(childMass) * 3.5;
            const offsetDistance = (parentCell.radius + childRadius)
                * gameplayTuning.split.spawn_offset
                * (1 + gameplayTuning.split.touch_epsilon);
            const splitPos = parentCell.position.add(dir.mult(offsetDistance));
            const splitCell = new Blob(splitPos.x, splitPos.y, 0, parentCell.color, childMass);
            splitCell.owner = parentCell.owner;
            splitCell.velocity = new Vector(parentCell.velocity.x, parentCell.velocity.y);
            splitCell.dashVelocity = dashVelocity;
            splitCell.dashTimer = dashTime;
            splitCell.mergeTimer = mergeLock;
            splitCell.splitGraceTimer = graceTime;
            splitCell.stretchTimer = 0.1;
            splitCell.stretchDirection = dir;
            splitCell.wobbleIntensity = 2.0;

            newCells.push(splitCell);
            trackSamples.push({ cell: splitCell, dashDistance: 0 });
        }

        for (const cell of newCells) {
            controller.addCell(cell);
        }

        this.splitStateByController.set(controller, { lastSplitMs: performance.now() });
        this.splitTracks.push({
            controller,
            elapsedMs: 0,
            maxDistance: 0,
            timeToMaxMs: 0,
            peakSpeed: 0,
            samples: trackSamples
        });

        const afterTotal = controller.cells.reduce((sum, cell) => sum + cell.mass, 0);
        const diff = Math.abs(afterTotal - beforeTotal);
        if (diff > beforeTotal * 0.0005) {
            console.error(`Split mass drift detected: ${diff.toFixed(4)}kg`);
        }
    }

    eject(controller: Controller, foodList: Blob[], targetPos: Vector): number {
        const costMass = gameplayTuning.eject.cost_mass;
        const spawnMass = gameplayTuning.eject.spawn_mass;
        const spawnDistance = gameplayTuning.eject.spawn_distance;
        const launchSpeed = gameplayTuning.eject.launch_speed * gameplayTuning.ejectSpeedScale;
        const cooldown = gameplayTuning.eject.cooldown;
        const minMassFloor = gameplayTuning.limits.min_cell_mass;
        let ejectedCount = 0;

        for (const cell of controller.cells) {
            if (cell.mass - costMass < minMassFloor) continue;
            if (cell.ejectTimer > 0) continue;

            cell.mass -= costMass;
            if (!Number.isFinite(cell.mass) || cell.mass < minMassFloor) {
                cell.mass = minMassFloor;
            }
            cell.updateRadiusFromMass();

            let dir = targetPos.sub(cell.position).normalize();
            if (dir.mag() === 0 || !Number.isFinite(dir.x) || !Number.isFinite(dir.y)) {
                dir = new Vector(1, 0);
            }

            const spawnPos = cell.position.add(dir.mult(cell.radius + spawnDistance));
            const eject = new EjectedMass(
                spawnPos.x,
                spawnPos.y,
                controller.color,
                dir.mult(launchSpeed),
                spawnMass
            );
            eject.ownerRef = controller;
            eject.reabsorbLockTimer = gameplayTuning.eject.reabsorb_lock;

            foodList.push(eject);

            cell.ejectTimer = cooldown;
            cell.velocity = cell.velocity.sub(dir.mult(launchSpeed * gameplayTuning.eject.recoil_factor));
            ejectedCount += 1;
        }

        if (ejectedCount > 0) {
            this.ejectMetricsByController.set(controller, {
                lastCost: costMass,
                lastSpawnMass: spawnMass,
                lastCooldownMs: cooldown * 1000
            });
        }

        return ejectedCount;
    }

    getSplitState(controller: Controller): SplitStateSnapshot {
        const state = this.splitStateByController.get(controller);
        const lastSplitMs = state?.lastSplitMs ?? 0;
        const canSplitNow = this.canSplit(controller);
        return {
            lastSplitMs,
            canSplitNow
        };
    }

    getSplitMetrics(controller: Controller): SplitMetrics {
        return this.splitMetricsByController.get(controller) ?? {
            maxDistance: 0,
            timeToMaxMs: 0,
            peakSpeed: 0
        };
    }

    getEjectMetrics(controller: Controller): EjectMetrics {
        return this.ejectMetricsByController.get(controller) ?? {
            lastCost: gameplayTuning.eject.cost_mass,
            lastSpawnMass: gameplayTuning.eject.spawn_mass,
            lastCooldownMs: gameplayTuning.eject.cooldown * 1000
        };
    }

    getSpikeMetrics(controller: Controller): SpikeMetrics {
        return this.spikeMetricsByController.get(controller) ?? {
            mainRatio: 0,
            pieceCount: 0,
            pieceMasses: []
        };
    }

    getSpikeEventId(controller: Controller): number {
        return this.spikeEventByController.get(controller) ?? 0;
    }

    canSplit(controller: Controller): boolean {
        if (controller.cells.length >= this.getMaxCells()) return false;
        return controller.cells.some(
            (cell) => cell.mass >= gameplayTuning.split.min_trigger_mass && cell.mass / 2 >= gameplayTuning.split.min_result_mass
        );
    }

    private getMaxCells(): number {
        return Math.max(2, Math.floor(gameplayTuning.limits.max_cells));
    }

    private getTotalMass(controller: Controller): number {
        const totalMass = controller.cells.reduce((sum, cell) => sum + cell.mass, 0);
        if (!Number.isFinite(totalMass) || totalMass <= 0) {
            return gameplayTuning.limits.min_cell_mass;
        }
        return totalMass;
    }

    private getMergeLockDuration(totalMass: number, pieceMass: number): number {
        const merge = gameplayTuning.merge;

        const safeTotalMass = Math.max(gameplayTuning.limits.min_cell_mass, totalMass);
        const safePieceMass = Math.max(gameplayTuning.limits.min_cell_mass, pieceMass);

        const pieceRatio = this.clamp(safePieceMass / safeTotalMass, 0, 1);
        const ratioProgress = this.clamp(
            (pieceRatio - merge.small_piece_ratio_anchor) / merge.small_piece_ratio_anchor,
            0,
            1
        );
        const pieceFactor = merge.small_piece_factor
            + (1 - merge.small_piece_factor) * ratioProgress;

        const massProgress = this.clamp(
            (safeTotalMass - merge.low_total_mass_anchor)
            / (merge.high_total_mass_anchor - merge.low_total_mass_anchor),
            0,
            1
        );
        const massFactor = merge.low_total_mass_factor
            + (merge.high_total_mass_factor - merge.low_total_mass_factor) * massProgress;

        const rawLock = merge.lock_time * pieceFactor * massFactor;
        return this.clamp(rawLock, merge.min_lock_time, merge.max_lock_time);
    }

    private degToRad(degrees: number): number {
        return (degrees * Math.PI) / 180;
    }

    private rotate(vector: Vector, angle: number): Vector {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return new Vector(
            vector.x * cos - vector.y * sin,
            vector.x * sin + vector.y * cos
        );
    }

    private randomRange(min: number, max: number): number {
        return min + (max - min) * Math.random();
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.min(max, Math.max(min, value));
    }

    private distributeMassWithFloor(
        totalMass: number,
        count: number,
        floorMass: number,
        randomFactor: number,
        maxMass?: number
    ): number[] {
        const base = new Array<number>(count).fill(floorMass);
        const remaining = totalMass - floorMass * count;
        if (remaining <= 0) {
            return base;
        }

        const weights: number[] = [];
        for (let i = 0; i < count; i += 1) {
            weights.push(Math.max(0.01, 1 + this.randomRange(-randomFactor, randomFactor)));
        }
        const weightSum = weights.reduce((sum, v) => sum + v, 0);
        if (weightSum <= 0) return base;

        const masses = base.map((value, index) => value + (remaining * weights[index]) / weightSum);

        if (maxMass === undefined || maxMass <= floorMass) {
            return masses;
        }

        let overflow = 0;
        for (let i = 0; i < masses.length; i += 1) {
            if (masses[i] > maxMass) {
                overflow += masses[i] - maxMass;
                masses[i] = maxMass;
            }
        }

        for (let guard = 0; guard < 8 && overflow > 0.0001; guard += 1) {
            const receivers: number[] = [];
            for (let i = 0; i < masses.length; i += 1) {
                if (masses[i] < maxMass - 0.0001) {
                    receivers.push(i);
                }
            }

            if (receivers.length === 0) break;
            const share = overflow / receivers.length;
            let distributed = 0;

            for (const index of receivers) {
                const room = maxMass - masses[index];
                const add = Math.min(room, share);
                masses[index] += add;
                distributed += add;
            }

            overflow -= distributed;
            if (distributed <= 0.0001) break;
        }

        if (overflow > 0.0001) {
            masses[0] += overflow;
        }

        return masses;
    }
}
