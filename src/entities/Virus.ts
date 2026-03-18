import { Blob } from './Blob';

export class Virus extends Blob {
    public static readonly BASE_MASS = 480;
    public static readonly BASE_RADIUS = Math.sqrt(Virus.BASE_MASS) * 3.5;
    public feedCount: number = 0;

    constructor(x: number, y: number, initialMass: number = Virus.BASE_MASS) {
        super(x, y, Virus.BASE_RADIUS, '#33ff33');
        this.mass = Math.max(1, initialMass);
        this.updateRadiusFromMass();
        this.feedCount = 0;
    }

    feed(massGain: number) {
        this.feedCount++;
        this.mass = Math.max(1, this.mass + Math.max(0, massGain));
        this.updateRadiusFromMass();
    }

    canSplit(feedThreshold: number, splitMassThreshold: number): boolean {
        return this.feedCount >= Math.max(1, Math.floor(feedThreshold))
            || this.mass >= Math.max(1, splitMassThreshold);
    }

    resetAfterSplit(resetMass: number) {
        this.feedCount = 0;
        this.mass = Math.max(1, resetMass);
        this.updateRadiusFromMass();
    }
}
