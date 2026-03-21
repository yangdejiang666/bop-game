import { Controller } from '../core/Controller';
import { Blob } from './Blob';
import { Vector } from '../utils/Vector';
import { gameplayTuning } from '../gameplay/tuning';

export const BOT_STATES = {
    WANDER: 'wander',
    HUNT: 'hunt',
    FLEE: 'flee',
    FEED: 'feed'
} as const;

export type BotState = (typeof BOT_STATES)[keyof typeof BOT_STATES];

export class Bot extends Controller {
    public name: string;
    public state: BotState = BOT_STATES.WANDER;
    public target: Vector | null = null;
    public reactionTimer: number = 0;

    private static names = [
        "Doge", "Wojak", "Pepe", "Bot #1", "VirusSummoner",
        "AgarMaster", "Blobby", "Sphere", "Circle", "NotABot",
        "GigaChad", "Noob", "Pro", "Hacker", "Glitch"
    ];

    constructor(x: number, y: number) {
        super();
        this.name = Bot.names[Math.floor(Math.random() * Bot.names.length)];
        this.displayName = this.name;
        this.color = this.getRandomColor();
        const startMass = gameplayTuning.limits.min_cell_mass;
        const startRadius = Math.sqrt(startMass) * 3.5;
        this.addCell(new Blob(x, y, startRadius, this.color));
    }

    private getRandomColor(): string {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)];
        }
        return color;
    }

    updateVelocity(target: Vector) {
        const center = this.getCenter();
        const direction = target.sub(center).normalize();
        const BASE_SPEED = 95; // Slightly slower than player (player is 100)

        for (const cell of this.cells) {
            // Validate mass before calculation
            if (isNaN(cell.mass) || cell.mass <= 0 || !isFinite(cell.mass)) {
                console.error('Invalid cell mass in Bot.updateVelocity:', cell.mass);
                cell.mass = 50; // Reset to safe value
                cell.updateRadiusFromMass();
            }

            const speed = BASE_SPEED / Math.pow(cell.mass, 0.24);
            const desired = direction.mult(Math.max(46, speed * 14.5) * this.movementSpeedMultiplier);

            // Add cohesion force - cells orbit around the main ball (same as Player)
            let cohesionForce = new Vector(0, 0);

            // Find the largest cell (main ball)
            let mainBall = this.cells[0];
            for (const c of this.cells) {
                if (c.mass > mainBall.mass) {
                    mainBall = c;
                }
            }

            // ===== PHASE DETECTION: Same as Player =====
            if (this.cells.length > 1) {
                let totalDistance = 0;
                let cellsInRange = 0;

                for (const c of this.cells) {
                    if (c !== mainBall) {
                        const distToMain = mainBall.position.sub(c.position).mag();
                        const idealOrbitRadius = mainBall.radius + c.radius;
                        totalDistance += distToMain / idealOrbitRadius;
                        cellsInRange++;
                    }
                }

                const avgNormalizedDist = cellsInRange > 0 ? totalDistance / cellsInRange : 0;

                for (const c of this.cells) {
                    if (c.mergeTimer > 0) {
                        c.mergeState = 'scattered';
                    } else if (avgNormalizedDist > 3.0) {
                        c.mergeState = 'scattered';
                    } else if (avgNormalizedDist > 2.0) {
                        c.mergeState = 'gathering';
                    } else if (avgNormalizedDist > 1.3) {
                        c.mergeState = 'arranged';
                    } else {
                        c.mergeState = 'ready';
                    }
                }
            } else {
                this.cells[0].mergeState = 'ready';
            }

            // Skip cohesion for cells that just exploded - let them scatter
            if (this.cells.length > 1 && cell.mergeTimer <= 0) {
                // Small cells orbit around the largest ball (main ball)
                if (cell !== mainBall) {
                    // This is a small cell - orbit around main ball
                    const toMainBall = mainBall.position.sub(cell.position);
                    const distToMainBall = toMainBall.mag();

                    // Ideal orbit distance: main ball radius + small cell radius (edges touching)
                    const idealOrbitRadius = mainBall.radius + cell.radius;

                    // Calculate distance difference
                    const distanceDiff = distToMainBall - idealOrbitRadius;

                    // If too far or too close, apply correction force
                    if (Math.abs(distanceDiff) > 5) {
                        // Direction to main ball center
                        const dirToMainBall = toMainBall.normalize();

                        // Distance-based cohesion speed
                        const distanceRatio = Math.abs(distanceDiff) / idealOrbitRadius;
                        let cohesionMultiplier = 0.5; // Default

                        // ===== PHASE-BASED COHESION (Same as Player) =====
                        if (cell.mergeState === 'scattered' || cell.mergeState === 'gathering') {
                            // GATHERING PHASE
                            if (distanceRatio > 1.0) {
                                cohesionMultiplier = 5 + distanceRatio * 1.5;
                                cohesionMultiplier = Math.min(cohesionMultiplier, 10);
                            } else if (distanceRatio > 0.5) {
                                cohesionMultiplier = 2 + distanceRatio * 1.5;
                            } else {
                                cohesionMultiplier = 0.5 + distanceRatio;
                            }
                        } else if (cell.mergeState === 'arranged') {
                            // ARRANGED PHASE: Maintain formation
                            cohesionMultiplier = 0.3 + distanceRatio * 0.5;
                        } else {
                            // READY PHASE: Normal merge
                            if (distanceRatio > 1.0) {
                                cohesionMultiplier = 8 + distanceRatio * 2;
                                cohesionMultiplier = Math.min(cohesionMultiplier, 15);
                            } else if (distanceRatio > 0.5) {
                                cohesionMultiplier = 3 + distanceRatio * 2;
                            } else {
                                cohesionMultiplier = 0.5 + distanceRatio * 2;
                            }
                        }

                        // Direction boost when moving towards cells
                        const cellOffsetFromCenter = cell.position.sub(mainBall.position).normalize();
                        const dotProduct = direction.dot(cellOffsetFromCenter);
                        if (dotProduct < -0.3) {
                            cohesionMultiplier *= 1.5;
                        }

                        // If too far: pull inward. If too close: push outward
                        const pullStrength = distanceDiff * cohesionMultiplier * 15;
                        cohesionForce = dirToMainBall.mult(pullStrength);
                    }
                }
            }

            const finalDesired = desired.add(cohesionForce);

            // CRITICAL: Validate velocity to prevent NaN freeze
            if (isNaN(finalDesired.x) || isNaN(finalDesired.y) || !isFinite(finalDesired.x) || !isFinite(finalDesired.y)) {
                cell.velocity = new Vector(0, 0);
                continue;
            }

            cell.velocity = new Vector(
                this.lerp(cell.velocity.x, finalDesired.x, 0.1),
                this.lerp(cell.velocity.y, finalDesired.y, 0.1)
            );
        }
    }

    update(dt: number) {
        for (const cell of this.cells) {
            cell.update(dt);
        }
        this.applyNaturalMassDecay(dt);
    }

    private lerp(start: number, end: number, t: number): number {
        return start + (end - start) * t;
    }
}
