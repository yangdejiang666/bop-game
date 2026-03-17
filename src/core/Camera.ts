import { Vector } from '../utils/Vector';
import { Controller } from './Controller';

export class Camera {
    public position: Vector = new Vector(0, 0);
    public scale: number = 1;
    public viewportWidth: number = window.innerWidth;
    public viewportHeight: number = window.innerHeight;
    private readonly resizeHandler: () => void;

    constructor() {
        this.resizeHandler = () => {
            this.viewportWidth = window.innerWidth;
            this.viewportHeight = window.innerHeight;
        };

        window.addEventListener('resize', this.resizeHandler);
    }

    // Follow a Controller (Player)
    follow(target: Controller, _dt: number) {
        const targetPos = target.getCenter();

        // Smooth camera movement
        this.position = new Vector(
            this.lerp(this.position.x, targetPos.x, 0.1),
            this.lerp(this.position.y, targetPos.y, 0.1)
        );

        // Dynamic zoom based on cell spread
        // Calculate the bounding box of all cells
        if (target.cells.length === 0) return;

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        for (const cell of target.cells) {
            const x = cell.position.x;
            const y = cell.position.y;
            const r = cell.radius;

            minX = Math.min(minX, x - r);
            maxX = Math.max(maxX, x + r);
            minY = Math.min(minY, y - r);
            maxY = Math.max(maxY, y + r);
        }

        // Calculate spread dimensions
        const spreadWidth = maxX - minX;
        const spreadHeight = maxY - minY;
        const maxSpread = Math.max(spreadWidth, spreadHeight);

        // Base zoom on largest cell size
        const baseRadius = 30;
        const maxR = target.maxRadius || 30;
        const baseScale = 1 / Math.pow(maxR / baseRadius, 0.4);

        // Additional zoom out based on cell spread
        // More spread = zoom out more to keep all cells visible
        const spreadFactor = Math.max(1, maxSpread / 400); // 400 is base spread
        const spreadScale = 1 / Math.pow(spreadFactor, 0.5); // Gentler zoom

        // Combine both factors
        const targetScale = baseScale * spreadScale;

        // Clamp scale to reasonable values
        const clampedScale = Math.max(0.2, Math.min(1.5, targetScale));

        this.scale = this.lerp(this.scale, clampedScale, 0.05);
    }

    // ... (Project/Unproject remain same)
    project(worldPos: Vector): Vector {
        return worldPos
            .sub(this.position)
            .mult(this.scale)
            .add(new Vector(this.viewportWidth / 2, this.viewportHeight / 2));
    }

    unproject(screenPos: Vector): Vector {
        return screenPos
            .sub(new Vector(this.viewportWidth / 2, this.viewportHeight / 2))
            .div(this.scale)
            .add(this.position);
    }

    private lerp(start: number, end: number, t: number): number {
        return start + (end - start) * t;
    }

    destroy() {
        window.removeEventListener('resize', this.resizeHandler);
    }
}
