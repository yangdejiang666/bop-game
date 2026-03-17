import { Blob } from './Blob';
import { Vector } from '../utils/Vector';

export class EjectedMass extends Blob {
    public ownerRef: unknown = null;
    public reabsorbLockTimer: number = 0;

    constructor(x: number, y: number, color: string, velocity: Vector, mass: number = 15) {
        super(x, y, 8, color); // Small radius for ejected mass
        this.velocity = velocity;
        this.mass = mass; // Dynamic mass based on ejecting cell
        this.updateRadiusFromMass(); // Update radius based on mass
        this.isEjected = true;
    }

    update(dt: number, worldWidth?: number, worldHeight?: number) {
        // Ejected mass has high drag
        this.position = this.position.add(this.velocity.mult(dt));
        this.velocity = this.velocity.mult(0.9); // Strong friction
        if (this.reabsorbLockTimer > 0) {
            this.reabsorbLockTimer -= dt;
            if (this.reabsorbLockTimer < 0) {
                this.reabsorbLockTimer = 0;
            }
        }

        // Boundary constraint
        if (worldWidth && worldHeight) {
            const margin = this.radius;
            if (this.position.x < margin) this.position.x = margin;
            if (this.position.x > worldWidth - margin) this.position.x = worldWidth - margin;
            if (this.position.y < margin) this.position.y = margin;
            if (this.position.y > worldHeight - margin) this.position.y = worldHeight - margin;
        }
    }
}
