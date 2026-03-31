import { Blob } from '../entities/Blob';
import { Vector } from '../utils/Vector';
import { gameplayTuning } from '../gameplay/tuning';

export class Controller {
    public cells: Blob[] = [];
    public color: string = '#fff';
    public accentColor: string = '#fff';
    public score: number = 0; // Pellets eaten count
    public displayName: string = 'Player';
    public movementSpeedMultiplier: number = 1;
    public decayRateMultiplier: number = 1;
    public hazardShield: number = 0;
    public hazardShieldMax: number = 0;
    public hazardShieldTimer: number = 0;

    constructor() { }

    addCell(blob: Blob) {
        blob.color = this.color;
        blob.owner = this;
        this.cells.push(blob);
    }

    setVisualColors(primaryColor: string, accentColor?: string) {
        this.color = primaryColor;
        this.accentColor = accentColor ?? primaryColor;
        this.cells.forEach((cell) => {
            cell.color = this.color;
        });
    }

    setModeMultipliers(moveSpeedMultiplier: number, decayRateMultiplier: number) {
        this.movementSpeedMultiplier = Math.max(0.2, moveSpeedMultiplier);
        this.decayRateMultiplier = Math.max(0.1, decayRateMultiplier);
    }

    grantHazardShield(amount: number, durationSeconds: number) {
        const safeAmount = Math.max(0, amount);
        const safeDuration = Math.max(0, durationSeconds);
        if (safeAmount <= 0 || safeDuration <= 0) {
            return;
        }

        this.hazardShield = Math.max(this.hazardShield, safeAmount);
        this.hazardShieldMax = Math.max(this.hazardShieldMax, safeAmount);
        this.hazardShieldTimer = Math.max(this.hazardShieldTimer, safeDuration);
    }

    clearHazardShield() {
        this.hazardShield = 0;
        this.hazardShieldMax = 0;
        this.hazardShieldTimer = 0;
    }

    absorbHazardDamage(amount: number): number {
        if (!Number.isFinite(amount) || amount <= 0) {
            return 0;
        }

        if (this.hazardShieldTimer <= 0 || this.hazardShield <= 0) {
            return amount;
        }

        const absorbed = Math.min(amount, this.hazardShield);
        this.hazardShield = Math.max(0, this.hazardShield - absorbed);

        if (this.hazardShield <= 0) {
            this.clearHazardShield();
        }

        return amount - absorbed;
    }

    getHazardShieldRatio(): number {
        if (this.hazardShieldMax <= 0) {
            return 0;
        }
        return Math.min(1, Math.max(0, this.hazardShield / this.hazardShieldMax));
    }

    protected tickHazardShield(dt: number) {
        if (dt <= 0 || this.hazardShieldTimer <= 0) {
            return;
        }

        this.hazardShieldTimer = Math.max(0, this.hazardShieldTimer - dt);
        if (this.hazardShieldTimer <= 0 || this.hazardShield <= 0) {
            this.clearHazardShield();
        }
    }

    removeCell(blob: Blob) {
        const idx = this.cells.indexOf(blob);
        if (idx !== -1) {
            this.cells.splice(idx, 1);
        }
    }

    protected applyNaturalMassDecay(dt: number) {
        if (dt <= 0 || this.cells.length === 0) return;

        const totalMass = this.cells.reduce((sum, cell) => sum + cell.mass, 0);
        if (!Number.isFinite(totalMass) || totalMass <= 0) return;

        const baseRate = this.getDecayRate(totalMass);
        if (baseRate <= 0) return;
        const finalRate = baseRate
            * this.decayRateMultiplier
            * (1 + (this.cells.length - 1) * gameplayTuning.decay.extra_cell_factor);

        const totalLoss = totalMass * finalRate * dt;
        if (!Number.isFinite(totalLoss) || totalLoss <= 0) return;
        const massFloor = gameplayTuning.limits.min_cell_mass;

        for (const cell of this.cells) {
            if (!Number.isFinite(cell.mass) || cell.mass <= 0) continue;

            const share = cell.mass / totalMass;
            const massLoss = totalLoss * share;
            if (massLoss <= 0) continue;

            cell.mass = Math.max(massFloor, cell.mass - massLoss);
            if (massLoss > 0.05) {
                cell.updateRadiusFromMass();
            }
        }
    }

    getCurrentDecayRate(): number {
        const totalMass = this.cells.reduce((sum, cell) => sum + cell.mass, 0);
        if (!Number.isFinite(totalMass) || totalMass <= 0) return 0;
        const baseRate = this.getDecayRate(totalMass);
        if (baseRate <= 0) return 0;
        return baseRate
            * this.decayRateMultiplier
            * (1 + (this.cells.length - 1) * gameplayTuning.decay.extra_cell_factor);
    }

    // Calculate center of mass / geometry for camera following
    getCenter(): Vector {
        if (this.cells.length === 0) return new Vector(0, 0);

        let sumX = 0, sumY = 0, totalMass = 0;
        for (const cell of this.cells) {
            sumX += cell.position.x * cell.mass;
            sumY += cell.position.y * cell.mass;
            totalMass += cell.mass;
        }

        if (totalMass === 0) return this.cells[0].position;
        return new Vector(sumX / totalMass, sumY / totalMass);
    }

    get maxRadius(): number {
        let max = 0;
        for (const c of this.cells) if (c.radius > max) max = c.radius;
        return max;
    }

    private getDecayRate(totalMass: number): number {
        const masses = gameplayTuning.decay.anchor_masses;
        const losses = gameplayTuning.decay.anchor_loss_30s;
        if (masses.length === 0 || losses.length === 0 || masses.length !== losses.length) {
            return 0;
        }

        if (totalMass <= masses[0]) {
            return losses[0] / 30;
        }

        for (let i = 1; i < masses.length; i += 1) {
            const leftMass = masses[i - 1];
            const rightMass = masses[i];
            if (totalMass <= rightMass) {
                const leftLoss = losses[i - 1];
                const rightLoss = losses[i];
                const t = (totalMass - leftMass) / (rightMass - leftMass);
                const loss30 = leftLoss + (rightLoss - leftLoss) * t;
                return loss30 / 30;
            }
        }

        return losses[losses.length - 1] / 30;
    }
}
