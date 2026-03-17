import { Blob } from './Blob';

export class Virus extends Blob {
    public feedCount: number = 0; // Track fed ejected mass count
    public readonly SPLIT_THRESHOLD = 7; // Split after 7 feeds

    constructor(x: number, y: number) {
        // Radius for ~480kg: sqrt(480) * 3.5 = 76.7
        super(x, y, 76.7, '#33ff33'); // Green, larger size
        // Manually set mass to match 480kg visual
        this.mass = 480;
        this.feedCount = 0;
    }

    feed() {
        this.feedCount++;

        // User request: Visual feedback - virus grows when fed
        // Add mass to make it visibly larger
        this.mass += 10; // Small increment per feed
        this.updateRadiusFromMass();
    }

    canSplit(): boolean {
        return this.feedCount >= this.SPLIT_THRESHOLD;
    }
}
