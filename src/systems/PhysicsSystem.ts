import { Blob } from '../entities/Blob';
import { Food } from '../entities/Food';
import { Virus } from '../entities/Virus';
import { EjectedMass } from '../entities/EjectedMass';
import { QuadTree, Rectangle } from '../utils/QuadTree';
import { Vector } from '../utils/Vector';
import { AbilitySystem } from './AbilitySystem';
import { gameplayTuning } from '../gameplay/tuning';
import { Player } from '../entities/Player';

export class PhysicsSystem {
    private abilitySystem: AbilitySystem;

    constructor(abilitySystem: AbilitySystem) {
        this.abilitySystem = abilitySystem;
    }

    update(
        activeBlobs: Blob[],
        foods: Food[],
        viruses: Virus[],
        quadTree: QuadTree,
        worldWidth: number,
        worldHeight: number
    ) {
        // --- 1. Global Safety Cap (Anti-Freeze) ---
        // Force limit total entities to prevent memory crash
        const MAX_ENTITIES = 1500;
        const totalEntities = foods.length + viruses.length;
        if (totalEntities > MAX_ENTITIES) {
            const toRemove = totalEntities - MAX_ENTITIES;
            // Keep regular pellets stable for gameplay; trim non-pellet entities first.
            const regularFoodIndices: number[] = [];
            for (let i = 0; i < foods.length; i++) {
                if (!this.isEjectedMass(foods[i])) {
                    regularFoodIndices.push(i);
                }
            }

            // Only remove regular food if we have enough
            if (regularFoodIndices.length > 0) {
                const actualRemove = Math.min(toRemove, regularFoodIndices.length);
                // Remove from end to avoid shifting indices
                for (let i = 0; i < actualRemove; i++) {
                    foods.splice(regularFoodIndices[regularFoodIndices.length - 1 - i], 1);
                }
            }
        }

        // --- 2. QuadTree Setup ---
        quadTree.clear();
        foods.forEach(f => {
            if (!isNaN(f.position.x) && !isNaN(f.position.y)) quadTree.insert(f);
        });
        viruses.forEach(v => {
            if (!isNaN(v.position.x) && !isNaN(v.position.y)) quadTree.insert(v);
        });
        activeBlobs.forEach(b => {
            // FIX: Constrain to bounds BEFORE inserting into QuadTree
            // This prevents blobs from being rejected (and vanishing) if they drifted out of bounds
            this.constrainToBounds(b, worldWidth, worldHeight);

            if (!isNaN(b.position.x) && !isNaN(b.position.y) && !isNaN(b.radius) && b.radius > 0) {
                quadTree.insert(b);
            }
        });

        // --- 3. Physics Loop with Time Budget ---
        const startTime = performance.now();
        const TIME_BUDGET_MS = 18; // Soft cap for non-player collision work per frame

        // --- Cohesion Step: Pull same-owner cells together ---
        this.applyCohesion(activeBlobs);

        for (const blob of activeBlobs) {
            // Always enforce boundary constraints (cheap & critical)
            this.constrainToBounds(blob, worldWidth, worldHeight);

            // Keep player collisions deterministic even under low-end device load.
            const isPlayerBlob = blob.owner instanceof Player;
            if (!isPlayerBlob && performance.now() - startTime > TIME_BUDGET_MS) {
                continue;
            }

            if (!blob.owner) continue;

            const range = new Rectangle(
                blob.position.x,
                blob.position.y,
                blob.radius * 2,
                blob.radius * 2
            );

            const nearby = quadTree.query(range);

            for (const other of nearby) {
                if (other === blob) continue;

                // Safety: Check for NaN positions (prevents infinite loop in other logic)
                if (isNaN(other.position.x) || isNaN(other.position.y)) {
                    other.mass = 0; other.radius = 0;
                    continue;
                }

                // Own cell collision (Merge logic or push away)
                if (other.owner === blob.owner) {
                    const dist = blob.position.dist(other.position).mag();
                    const minDist = blob.radius + other.radius;

                    // Push away or Merge
                    if (dist < minDist) {
                        // Check Merge Capability
                        if (blob.mergeTimer <= 0 && other.mergeTimer <= 0) {
                            // User request: Only merge when cells are arranged or ready
                            // This prevents premature merging during gathering phase
                            const blobReady = blob.mergeState === 'arranged' || blob.mergeState === 'ready';
                            const otherReady = other.mergeState === 'arranged' || other.mergeState === 'ready';

                            if (blobReady && otherReady) {
                                // Determine smaller and larger cells
                                const smaller = blob.mass < other.mass ? blob : other;
                                const larger = blob.mass < other.mass ? other : blob;

                                // CRITICAL: Only process merge if THIS blob is the larger one
                                // This prevents double-processing (both blob and other trying to merge)
                                if (blob !== larger) {
                                    continue; // Skip - let the larger blob handle the merge
                                }

                                // User request: Gradual merge - only merge when deeply overlapped
                                // Condition: One cell's edge passes the other's center
                                // This means: dist < larger.radius (larger cell covers smaller's center)
                                // OR dist < smaller.radius (smaller cell's edge past larger's center)
                                const overlapFactor = this.getMergePriorityOverlapFactor(larger, smaller);
                                const deepOverlap = dist < Math.max(larger.radius, smaller.radius) * overlapFactor;

                                if (deepOverlap) {
                                    // INSTANT MERGE: Combine all mass immediately
                                    // This ensures NO mass loss and clean merging
                                    const totalMass = smaller.mass + larger.mass;

                                    // Validate total mass
                                    if (isNaN(totalMass) || totalMass <= 0 || !isFinite(totalMass)) {
                                        console.error('Invalid total mass in merge:', totalMass, 'from', smaller.mass, larger.mass);
                                        continue;
                                    }

                                    // Apply total mass to larger cell
                                    larger.mass = totalMass;
                                    larger.updateRadiusFromMass();

                                    // Remove smaller cell immediately
                                    smaller.owner.removeCell(smaller);
                                    smaller.mass = 0;
                                    smaller.radius = 0;

                                    continue;
                                }
                                // If not deep enough overlap, allow them to keep moving closer
                                // The cohesion force will continue pulling them together
                                // CRITICAL: Skip the push logic below to allow overlap!
                                continue;
                            }
                        }

                        // Push logic (Push apart if not merging)
                        // 球球大作战风格：小球围绕大球边缘排列，不会藏进大球里面
                        let dir = blob.position.sub(other.position).normalize();
                        if (dir.mag() === 0) dir = new Vector(1, 0); // Safety default

                        // 计算需要推开的距离
                        // 确定哪个球大哪个球小
                        const smaller = blob.mass < other.mass ? blob : other;
                        const larger = blob.mass < other.mass ? other : blob;

                        const touchingSeparation = larger.radius + smaller.radius;
                        const targetSeparation = touchingSeparation * (1 + gameplayTuning.split.touch_epsilon);
                        const isSplitGrace = blob.splitGraceTimer > 0 || other.splitGraceTimer > 0;

                        if (isSplitGrace && dist < touchingSeparation * 0.96) {
                            const minimumSeparation = touchingSeparation * (1 + gameplayTuning.split.touch_epsilon * 0.5);
                            const antiStickPush = minimumSeparation - dist;
                            if (antiStickPush > 0) {
                                const totalM = blob.mass + other.mass;
                                const blobRatio = other.mass / totalM;
                                const otherRatio = blob.mass / totalM;
                                blob.position = blob.position.add(dir.mult(antiStickPush * blobRatio * 0.35));
                                other.position = other.position.sub(dir.mult(antiStickPush * otherRatio * 0.35));
                            }
                        }

                        if (dist < targetSeparation) {
                            // 计算需要推开多少
                            const pushDist = targetSeparation - dist;
                            const pushFactor = isSplitGrace
                                ? gameplayTuning.split.self_push_factor
                                : gameplayTuning.merge.overlap_push_factor;

                            // 基于质量分配推力：大球几乎不动，小球移动大部分
                            const totalM = blob.mass + other.mass;
                            const blobRatio = other.mass / totalM;  // blob 移动的比例
                            const otherRatio = blob.mass / totalM;  // other 移动的比例

                            // 应用硬碰撞推力，确保小球不会进入大球内部
                            // Factor 1.0: 完全推开，不允许重叠
                            blob.position = blob.position.add(dir.mult(pushDist * blobRatio * pushFactor));
                            other.position = other.position.sub(dir.mult(pushDist * otherRatio * pushFactor));
                        }
                    }
                    continue;
                }


                const dist = blob.position.dist(other.position).mag();

                // Different collision logic for different entity types:
                // - Food/Virus: Simple radius overlap (edge-to-edge collision is fine)
                // - Enemy cells: Must cover center point (agar.io rule)

                // Check if it's an enemy cell (different owner)
                if (other.owner && other.owner !== blob.owner) {
                    // Agar.io rule: The bigger cell's radius must reach the smaller cell's center
                    // This means: dist < biggerRadius (not dist < radius1 + radius2)
                    const canEat = blob.mass > other.mass * 1.1; // 10% bigger to eat

                    if (canEat && dist < blob.radius) {
                        // Big blob covers small blob's center - EAT IT!
                        this.resolveCollision(blob, other, foods, viruses, worldWidth, worldHeight);
                    } else if (!canEat && dist < other.radius) {
                        // Small blob might be eaten by big blob (reverse check)
                        // This will be handled when we iterate other blob
                    }
                } else {
                    // Separate logic for viruses vs food
                    if (other instanceof Virus) {
                        // User request: Cell edge must cover virus center point
                        // Similar to enemy cell logic: dist < blob.radius
                        if (dist < blob.radius) {
                            this.resolveCollision(blob, other, foods, viruses, worldWidth, worldHeight);
                        }
                    } else {
                        // For food and same-owner cells: use normal edge-to-edge collision
                        const minDist = blob.radius + other.radius;
                        if (dist < minDist) {
                            this.resolveCollision(blob, other, foods, viruses, worldWidth, worldHeight);
                        }
                    }
                }
            }
        }

        // Additional collision check: EjectedMass (in foods array) vs Viruses
        // User request: ejected mass should feed viruses
        for (const food of foods) {
            // Only check EjectedMass, skip regular Food
            if (!this.isEjectedMass(food)) {
                continue;
            }

            for (const virus of viruses) {
                const dist = food.position.dist(virus.position).mag();
                const minDist = food.radius + virus.radius;

                if (dist < minDist) {
                    // Hit! Feed the virus
                    this.resolveCollision(food, virus, foods, viruses, worldWidth, worldHeight);
                }
            }
        }
    }

    private resolveCollision(blob: Blob, other: Blob, foods: Food[], viruses: Virus[], worldWidth: number, worldHeight: number) {
        // Prevent double eating (if mass is 0, it's already eaten this frame)
        if (other.mass <= 0) return;

        // 1. Eat Ejected Mass
        if (this.isEjectedMass(other)) {
            if (other.ownerRef && blob.owner === other.ownerRef && other.reabsorbLockTimer > 0) {
                return;
            }

            const massGain = Math.max(0, other.mass);
            if (blob.owner) blob.owner.score += Math.floor(massGain);

            other.mass = 0;
            const index = foods.indexOf(other as unknown as Food);
            if (index > -1) foods.splice(index, 1);

            blob.mass += massGain;
            if (isNaN(blob.mass) || blob.mass < 0 || !isFinite(blob.mass)) {
                console.error('Invalid mass after eating ejected mass:', blob.mass);
                blob.mass = 50;
            }
            blob.updateRadiusFromMass();
        }
        // 2. Eat Food
        else if (other instanceof Food) {
            const massGain = 1; // 1 kg per pellet
            if (blob.owner) blob.owner.score += 1;

            other.mass = 0;
            const index = foods.indexOf(other as Food);
            if (index > -1) {
                foods.splice(index, 1);
                foods.push(new Food(Math.random() * worldWidth, Math.random() * worldHeight));
            }

            blob.mass += massGain;
            if (isNaN(blob.mass) || blob.mass < 0 || !isFinite(blob.mass)) {
                console.error('Invalid mass after eating food:', blob.mass);
                blob.mass = 50;
            }
            blob.updateRadiusFromMass();
        }
        // 2. Hit Virus
        else if (other instanceof Virus) {
            // User request: Check if blob is ejected mass feeding the virus
            if (this.isEjectedMass(blob)) {
                // Feed the virus
                (other as Virus).feed();

                // User request: Push virus in direction of ejected mass
                // Small push force to move virus slightly
                const pushDirection = blob.velocity.normalize();
                const pushForce = 50; // Subtle movement
                (other as Virus).velocity = (other as Virus).velocity.add(pushDirection.mult(pushForce));

                // Remove ejected mass
                const index = foods.indexOf(blob as any);
                if (index > -1) foods.splice(index, 1);

                // Mark as consumed
                blob.mass = 0;

                // Check if virus should split
                if ((other as Virus).canSplit()) {
                    this.splitVirus(other as Virus, viruses);
                }
                return;
            }

            const virusMass = other.mass; // ~480kg

            // User request: If similar size or larger, can interact with virus
            // 90% threshold allows interaction
            if (blob.mass >= virusMass * 0.9) {
                const virusBonusMass = gameplayTuning.spike.virus_bonus_mass;
                // Check cell count to determine behavior
                const ownerCellCount = blob.owner ? blob.owner.cells.length : 0;
                const maxCells = Math.max(2, Math.floor(gameplayTuning.limits.max_cells));

                // Remove and respawn virus first
                const virusPosition = other.position; // Save position for explosion
                const index = viruses.indexOf(other as Virus);
                if (index > -1) {
                    viruses.splice(index, 1);
                    viruses.push(new Virus(Math.random() * worldWidth, Math.random() * worldHeight));
                }

                if (ownerCellCount >= maxCells) {
                    // At max cells - consume virus bonus mass directly (no explosion)
                    blob.mass += virusBonusMass;
                    blob.updateRadiusFromMass();
                    if (blob.owner) blob.owner.score += Math.floor(virusBonusMass);
                } else {
                    // Not at max - User request: Explode into small cells around virus
                    if (blob.owner) {
                        // Add virus bonus mass first
                        blob.mass += virusBonusMass;
                        // Explode from VIRUS position (creates circle around virus)
                        this.abilitySystem.explode(blob, virusPosition, blob.owner, other.radius);
                        // Add score
                        blob.owner.score += Math.floor(virusBonusMass);
                    }
                }
            }
            // else: Too small - no interaction with virus
        }
        // 3. Eat Enemy Cell
        else if (other.owner && other.owner !== blob.owner) {
            if (blob.mass > other.mass * 1.1) {
                blob.mass += other.mass; // Gain full mass
                blob.updateRadiusFromMass();

                // Safe removal with error handling
                try {
                    if (other.owner && other.owner.cells && other.owner.removeCell) {
                        other.owner.removeCell(other);
                    }
                } catch (err) {
                    console.error('Error removing eaten cell:', err);
                }

                other.mass = 0;
                other.radius = 0;
            }
        }
    }

    private constrainToBounds(blob: Blob, width: number, height: number) {
        // Safety: Validate inputs
        if (!blob || isNaN(blob.radius) || blob.radius <= 0) {
            return;
        }

        // User requested: Center can reach edge, allowing body to overlap boundary
        const margin = 0;

        // Simply constrain position - let natural friction handle velocity
        // Don't modify velocity to prevent "sticking" issue
        if (blob.position.x < margin) {
            blob.position.x = margin;
        }
        if (blob.position.x > width - margin) {
            blob.position.x = width - margin;
        }
        if (blob.position.y < margin) {
            blob.position.y = margin;
        }
        if (blob.position.y > height - margin) {
            blob.position.y = height - margin;
        }

        // Final safety: ensure position is valid
        if (isNaN(blob.position.x) || isNaN(blob.position.y)) {
            blob.position = new Vector(width / 2, height / 2);
            blob.velocity = new Vector(0, 0);
            console.error('Blob position became NaN at boundary!');
        }
    }

    private splitVirus(virus: Virus, viruses: Virus[]) {
        const pos = virus.position;

        // Remove original virus
        const index = viruses.indexOf(virus);
        if (index > -1) viruses.splice(index, 1);

        // User request: Split in direction of virus movement (last push direction)
        // Use virus velocity to determine split direction
        let splitDirection = virus.velocity.normalize();

        // If virus has no velocity, use random direction
        if (splitDirection.mag() === 0) {
            const angle = Math.random() * Math.PI * 2;
            splitDirection = new Vector(Math.cos(angle), Math.sin(angle));
        }

        const direction1 = splitDirection;
        const direction2 = splitDirection.mult(-1); // Opposite direction

        // Velocity: ejection speed (increased to ~600 px/s for greater separation)
        const velocity = 600;

        const virus1 = new Virus(pos.x, pos.y);
        virus1.velocity = direction1.mult(velocity);

        const virus2 = new Virus(pos.x, pos.y);
        virus2.velocity = direction2.mult(velocity);

        viruses.push(virus1, virus2);
    }

    private applyCohesion(blobs: Blob[]) {
        const ownerCells = new Map<unknown, Blob[]>();

        for (const blob of blobs) {
            if (!blob.owner) continue;
            const list = ownerCells.get(blob.owner);
            if (list) {
                list.push(blob);
            } else {
                ownerCells.set(blob.owner, [blob]);
            }
        }

        for (const cells of ownerCells.values()) {
            if (cells.length === 0) continue;

            const mainBall = this.getLargestCell(cells);
            this.updateOwnerMergeStates(cells, mainBall);

            if (cells.length <= 1) continue;

            const ownerMoveDir = this.getOwnerMoveDirection(mainBall.owner, cells);
            for (const cell of cells) {
                if (cell === mainBall || cell.mergeTimer > 0) {
                    continue;
                }

                const toMain = mainBall.position.sub(cell.position);
                const distToMain = toMain.mag();
                if (distToMain <= 0.0001) continue;

                const idealMainDist = Math.max(1, mainBall.radius + cell.radius);
                const relToMain = cell.position.sub(mainBall.position);
                const relNorm = relToMain.mag() > 0 ? relToMain.normalize() : Vector.zero;
                const aheadDot = ownerMoveDir.mag() > 0.0001 ? relNorm.dot(ownerMoveDir) : 0;

                let directionalFactor = 1;
                if (aheadDot > 0.18) {
                    // Small cell is ahead of the big ball: keep forward movement.
                    directionalFactor = 0.25;
                } else if (aheadDot < -0.18) {
                    // Small cell is behind the big ball: cling harder to the main ball.
                    directionalFactor = 1.55;
                }

                let stateFactor = 1;
                if (cell.mergeState === 'gathering') stateFactor = 1.25;
                else if (cell.mergeState === 'arranged') stateFactor = 1.05;
                else if (cell.mergeState === 'ready') stateFactor = 1.35;

                const gapToMain = Math.max(0, distToMain - idealMainDist * 0.92);
                let mainPull = Math.min(gapToMain * 10, 220) * directionalFactor * stateFactor;

                if (aheadDot > 0.25 && distToMain < idealMainDist * 1.45) {
                    mainPull *= 0.1;
                }

                if (mainPull > 0) {
                    cell.velocity = cell.velocity.add(
                        toMain.normalize().mult(mainPull * gameplayTuning.merge.attract_factor)
                    );
                }

                const smallBuddy = this.findNearestSmallBuddy(cell, cells, mainBall);
                if (!smallBuddy) {
                    continue;
                }

                const toBuddy = smallBuddy.position.sub(cell.position);
                const buddyDistance = toBuddy.mag();
                if (buddyDistance <= 0.0001) continue;

                const idealBuddyDist = Math.max(1, cell.radius + smallBuddy.radius);
                if (buddyDistance > idealBuddyDist * 3.5) continue;

                const buddyGap = Math.max(0, buddyDistance - idealBuddyDist * 0.9);
                if (buddyGap <= 0) continue;

                const buddyPull = Math.min(buddyGap * 7.5, 120);
                cell.velocity = cell.velocity.add(
                    toBuddy.normalize().mult(buddyPull * gameplayTuning.merge.attract_factor * 0.75)
                );
            }
        }
    }

    private getLargestCell(cells: Blob[]): Blob {
        let largest = cells[0];
        for (let i = 1; i < cells.length; i += 1) {
            if (cells[i].mass > largest.mass) {
                largest = cells[i];
            }
        }
        return largest;
    }

    private updateOwnerMergeStates(cells: Blob[], mainBall: Blob) {
        if (cells.length === 1) {
            cells[0].mergeState = cells[0].mergeTimer > 0 ? 'scattered' : 'ready';
            return;
        }

        let ratioSum = 0;
        let count = 0;

        for (const cell of cells) {
            if (cell === mainBall) continue;
            const dist = mainBall.position.dist(cell.position).mag();
            const ideal = Math.max(1, mainBall.radius + cell.radius);
            ratioSum += dist / ideal;
            count += 1;
        }

        const avgNormalizedDist = count > 0 ? ratioSum / count : 0;

        for (const cell of cells) {
            if (cell.mergeTimer > 0) {
                cell.mergeState = 'scattered';
                continue;
            }

            if (avgNormalizedDist > 2.6) {
                cell.mergeState = 'gathering';
            } else if (avgNormalizedDist > 1.4) {
                cell.mergeState = 'arranged';
            } else {
                cell.mergeState = 'ready';
            }
        }
    }

    private findNearestSmallBuddy(cell: Blob, cells: Blob[], mainBall: Blob): Blob | null {
        const smallThreshold = mainBall.mass * 0.45;
        if (cell.mass > smallThreshold || cell.mergeTimer > 0) {
            return null;
        }

        let best: Blob | null = null;
        let bestDist = Infinity;

        for (const other of cells) {
            if (other === cell || other === mainBall) continue;
            if (other.mass > smallThreshold || other.mergeTimer > 0) continue;

            const dist = cell.position.dist(other.position).mag();
            if (dist < bestDist) {
                bestDist = dist;
                best = other;
            }
        }

        return best;
    }

    private getOwnerMoveDirection(owner: unknown, cells: Blob[]): Vector {
        if (owner && typeof owner === 'object') {
            const maybeOwner = owner as {
                getAimDirection?: () => Vector;
            };

            if (typeof maybeOwner.getAimDirection === 'function') {
                const aim = maybeOwner.getAimDirection();
                if (aim.mag() > 0.0001) {
                    return aim.normalize();
                }
            }
        }

        let weightedX = 0;
        let weightedY = 0;
        let totalWeight = 0;

        for (const cell of cells) {
            const speed = cell.velocity.mag();
            if (speed <= 0.0001) continue;

            const dir = cell.velocity.normalize();
            const weight = Math.max(1, Math.sqrt(Math.max(1, cell.mass)));
            weightedX += dir.x * weight;
            weightedY += dir.y * weight;
            totalWeight += weight;
        }

        if (totalWeight <= 0.0001) {
            return Vector.zero;
        }

        return new Vector(weightedX / totalWeight, weightedY / totalWeight).normalize();
    }

    private getMergePriorityOverlapFactor(larger: Blob, smaller: Blob): number {
        const ownerDir = this.getOwnerMoveDirection(larger.owner, [larger, smaller]);
        if (ownerDir.mag() <= 0.0001) {
            return 0.8;
        }

        const relative = smaller.position.sub(larger.position);
        if (relative.mag() <= 0.0001) {
            return 0.85;
        }

        const frontDot = relative.normalize().dot(ownerDir);
        if (frontDot < -0.15) {
            // Small is behind big: merge sooner.
            return 0.96;
        }

        if (frontDot > 0.15) {
            // Small is in front of big: keep moving before merging.
            return 0.7;
        }

        return 0.82;
    }

    private isEjectedMass(blob: Blob | Food): blob is EjectedMass {
        return blob instanceof EjectedMass || blob.isEjected === true;
    }
}

