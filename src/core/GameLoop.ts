export class GameLoop {
    private lastTime: number = 0;
    private accumulator: number = 0;
    private readonly step: number = 1 / 60;
    private isRunning: boolean = false;
    private readonly update: (dt: number) => void;
    private readonly render: () => void;

    constructor(
        update: (dt: number) => void,
        render: () => void
    ) {
        this.update = update;
        this.render = render;
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastTime = performance.now();
        requestAnimationFrame(this.loop);
    }

    stop() {
        this.isRunning = false;
        this.accumulator = 0;
    }

    advanceTime(ms: number) {
        const frameTime = Math.max(0, ms) / 1000;
        this.accumulator += frameTime;

        while (this.accumulator >= this.step) {
            this.update(this.step);
            this.accumulator -= this.step;
        }

        this.render();
    }

    private loop = (time: number) => {
        if (!this.isRunning) return;

        // Calculate delta time in seconds
        const dt = (time - this.lastTime) / 1000;
        this.lastTime = time;

        // Prevent spiral of death if lag allows dt to grow too large
        if (dt > 0.25) {
            this.accumulator = 0; // Skip frames if lag is huge
        } else {
            this.accumulator += dt;
        }

        // Fixed time step update
        while (this.accumulator >= this.step) {
            this.update(this.step);
            this.accumulator -= this.step;
        }

        this.render();
        requestAnimationFrame(this.loop);
    };
}
