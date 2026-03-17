import { Vector } from '../utils/Vector';
import { gameplayTuning } from '../gameplay/tuning';

export class Blob {
    public position: Vector;
    public velocity: Vector = new Vector(0, 0);
    public radius: number = 0;
    public color: string;
    public mass: number = 0;

    // Timers
    public mergeTimer: number = 0;
    public splitBoostTimer: number = 0;
    public dashVelocity: Vector = new Vector(0, 0);
    public dashTimer: number = 0;
    public splitGraceTimer: number = 0;
    public ejectTimer: number = 0;
    public isEjected: boolean = false;

    // Merge state tracking for gradual gathering
    public mergeState: 'scattered' | 'gathering' | 'arranged' | 'ready' = 'scattered';

    // Visuals
    public wobblePhase: number = Math.random() * Math.PI * 2;
    public wobbleIntensity: number = 0;
    public stretchTimer: number = 0;
    public stretchDirection: Vector = new Vector(1, 0);

    public owner: any = null;

    constructor(x: number, y: number, radius: number, color: string, initialMass?: number) {
        this.position = new Vector(x, y);
        this.color = color;

        // If initialMass is provided, use it directly (avoids circular calculation)
        if (initialMass !== undefined) {
            this.mass = initialMass;
            this.updateRadiusFromMass();
        } else {
            // Otherwise, calculate mass from radius (original behavior)
            this.radius = radius;
            this.updateMassFromRadius();
        }
    }

    updateMassFromRadius() {
        // Formula: Mass = (Radius / 3.5)^2
        const calculatedMass = (this.radius / 3.5) * (this.radius / 3.5);

        // CRITICAL: Validate mass to prevent NaN and negatives
        if (isNaN(calculatedMass) || calculatedMass < 0 || !isFinite(calculatedMass)) {
            console.error('Invalid mass calculated:', calculatedMass, 'from radius:', this.radius);
            this.mass = 30; // Reset to safe default (30kg)
            this.radius = Math.sqrt(30) * 3.5;
        } else {
            this.mass = Math.max(1, calculatedMass); // Minimum 1kg
        }
    }

    updateRadiusFromMass() {
        // Visual Scale: Radius = sqrt(Mass) * 3.5
        // CRITICAL: Validate before sqrt to prevent NaN
        if (isNaN(this.mass) || this.mass < 0 || !isFinite(this.mass)) {
            console.error('Invalid mass for radius calc:', this.mass);
            this.mass = 30; // Safety default
        }
        this.mass = Math.max(1, this.mass); // Ensure positive
        this.radius = Math.sqrt(this.mass) * 3.5;
    }

    update(dt: number) {
        let dashContribution = Vector.zero;
        if (this.dashTimer > 0 && this.dashVelocity.mag() > 0) {
            const tailWindow = 0.1;
            const tailFactor = this.dashTimer < tailWindow
                ? Math.max(0, this.dashTimer / tailWindow)
                : 1;
            dashContribution = this.dashVelocity.mult(tailFactor);
            const dashDecay = Math.exp(-gameplayTuning.split.impulse_decay * dt);
            this.dashVelocity = this.dashVelocity.mult(dashDecay);
        }

        this.position = this.position.add(this.velocity.add(dashContribution).mult(dt));

        // Split boost controls post-split glide distance; merge lock should not affect friction.
        const friction = this.splitBoostTimer > 0 ? 0.955 : 0.9;
        this.velocity = this.velocity.mult(friction);

        if (this.mergeTimer > 0) this.mergeTimer -= dt;
        if (this.splitBoostTimer > 0) this.splitBoostTimer -= dt;
        if (this.dashTimer > 0) this.dashTimer -= dt;
        if (this.splitGraceTimer > 0) this.splitGraceTimer -= dt;
        if (this.ejectTimer > 0) this.ejectTimer -= dt;
        if (this.stretchTimer > 0) this.stretchTimer -= dt;

        if (this.dashTimer <= 0) {
            this.dashTimer = 0;
            this.dashVelocity = Vector.zero;
        }
        if (this.splitGraceTimer < 0) this.splitGraceTimer = 0;
        if (this.stretchTimer < 0) this.stretchTimer = 0;

        // Wobble Decay
        if (this.wobbleIntensity > 0) {
            this.wobbleIntensity -= dt * 2;
            if (this.wobbleIntensity < 0) this.wobbleIntensity = 0;
        }

    }
}
