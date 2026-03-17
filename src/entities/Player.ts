import { Controller } from '../core/Controller';
import { Blob } from './Blob';
import { Vector } from '../utils/Vector';
import { gameplayTuning } from '../gameplay/tuning';

export class Player extends Controller {
    private readonly BASE_SPEED = 100; // Reduced for slower, more controlled movement
    private aimDirection: Vector = new Vector(1, 0);

    constructor(x: number, y: number) {
        super();
        this.color = '#3498db';
        const startMass = gameplayTuning.limits.min_cell_mass;
        const startRadius = Math.sqrt(startMass) * 3.5;
        this.addCell(new Blob(x, y, startRadius, this.color));
    }

    // Updated signature: accepts Direction Normalize Vector instead of Target Position
    updateVelocity(direction: Vector) {
        this.setAimDirection(direction);

        // Calculate Center of Mass of all cells
        let centerMassX = 0;
        let centerMassY = 0;
        let totalMass = 0;

        for (const cell of this.cells) {
            centerMassX += cell.position.x * cell.mass;
            centerMassY += cell.position.y * cell.mass;
            totalMass += cell.mass;
        }

        const com = (totalMass > 0)
            ? new Vector(centerMassX / totalMass, centerMassY / totalMass)
            : this.getCenter();

        // Move all cells in the joystick direction
        for (const cell of this.cells) {
            // Validate mass
            if (isNaN(cell.mass) || cell.mass <= 0 || !isFinite(cell.mass)) {
                cell.mass = 50;
                cell.updateRadiusFromMass();
            }

            // 1. Base Movement Speed
            const speed = this.BASE_SPEED / Math.pow(cell.mass, 0.24);
            const moveSpeedValue = Math.max(52, speed * 15);
            const moveVec = direction.mult(moveSpeedValue);

            // 2. Cohesion (Attract to Center of Mass)
            let cohesiveForce = new Vector(0, 0);

            if (this.cells.length > 1) {
                const toCoM = com.sub(cell.position);
                const dist = toCoM.mag();

                if (dist > cell.radius) {
                    // Calculate force
                    let pullStrength = Math.min(dist * 2, 400);

                    // CRITICAL FIX: Cap cohesion so it NEVER overpowers movement logic.
                    // Reduced from 0.8 to 0.25 to prevent "crossing" paths.
                    // This ensures forward movement dominates (shallow convergence).
                    const maxCohesion = moveSpeedValue * 0.25;
                    pullStrength = Math.min(pullStrength, maxCohesion);

                    cohesiveForce = toCoM.normalize().mult(pullStrength);
                }
            }

            // Combine
            const desired = moveVec.add(cohesiveForce);

            const damping = 0.1;

            const newVelX = this.lerp(cell.velocity.x, desired.x, damping);
            const newVelY = this.lerp(cell.velocity.y, desired.y, damping);

            if (!isNaN(newVelX) && !isNaN(newVelY)) {
                cell.velocity = new Vector(newVelX, newVelY);
            }
        }
    }

    setAimDirection(direction: Vector | null) {
        if (!direction) {
            return;
        }

        const magnitude = direction.mag();
        if (!Number.isFinite(magnitude) || magnitude <= 0) {
            return;
        }

        this.aimDirection = direction.normalize();
    }

    getAimDirection(): Vector {
        return new Vector(this.aimDirection.x, this.aimDirection.y);
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
