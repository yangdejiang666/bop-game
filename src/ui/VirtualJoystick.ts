import { Vector } from '../utils/Vector';

export class VirtualJoystick {
    public position: Vector; // Base position in screen coordinates
    public baseRadius: number = 60;
    public handleRadius: number = 30;
    public handleOffset: Vector = new Vector(0, 0); // Handle offset from base center
    public isDragging: boolean = false;
    public visible: boolean = false; // Initially hidden

    constructor(x: number, y: number) {
        this.position = new Vector(x, y);
    }

    setPosition(x: number, y: number) {
        this.position = new Vector(x, y);
    }

    /**
     * Get the direction vector from the joystick (normalized)
     * Returns null if joystick is centered
     */
    getDirection(): Vector | null {
        if (this.handleOffset.mag() < 5) return null; // Dead zone
        return this.handleOffset.normalize();
    }

    /**
     * Get the strength/magnitude of the joystick input (0 to 1)
     */
    getStrength(): number {
        const mag = this.handleOffset.mag();
        return Math.min(mag / this.baseRadius, 1.0);
    }

    /**
     * Check if a screen position is within the joystick base
     */
    isInBounds(screenPos: Vector): boolean {
        // Since joystick appears on click, we don't really check bounds for *start*
        // But for continued interaction or multi-touch, we might.
        // For dynamic joystick, the base is where you clicked.
        const dist = screenPos.sub(this.position).mag();
        return dist <= this.baseRadius;
    }

    /**
     * Handle mouse/touch down event
     */
    handleMouseDown(screenPos: Vector): boolean {
        // For dynamic joystick, we accept the down event as the start
        // The calling code (Input.ts) sets position first
        this.isDragging = true;
        this.updateHandlePosition(screenPos);
        return true;
    }

    /**
     * Handle mouse/touch move event
     */
    handleMouseMove(screenPos: Vector): void {
        if (this.isDragging) {
            this.updateHandlePosition(screenPos);
        }
    }

    /**
     * Handle mouse/touch up event
     */
    handleMouseUp(): void {
        if (this.isDragging) {
            this.isDragging = false;
            this.handleOffset = new Vector(0, 0); // Reset to center
        }
    }

    /**
     * Update handle position based on mouse/touch position
     */
    private updateHandlePosition(screenPos: Vector): void {
        const offset = screenPos.sub(this.position);

        // No clamping for visual "pulling" effect? 
        // Standard joystick usually clamps handle visually to base radius.
        const mag = offset.mag();

        if (mag > this.baseRadius) {
            // Clamp to base radius
            this.handleOffset = offset.normalize().mult(this.baseRadius);
        } else {
            this.handleOffset = offset;
        }
    }

    /**
     * Render the joystick on the canvas
     */
    render(ctx: CanvasRenderingContext2D): void {
        if (!this.visible) return;

        ctx.save();

        // Draw base (outer circle)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(this.position.x + this.baseRadius, this.position.y);
        ctx.arc(this.position.x, this.position.y, this.baseRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Draw handle (inner circle)
        const handlePos = this.position.add(this.handleOffset);
        const handleAlpha = this.isDragging ? 0.9 : 0.6;
        ctx.fillStyle = `rgba(0, 255, 136, ${handleAlpha})`;
        ctx.strokeStyle = `rgba(0, 255, 136, ${handleAlpha * 0.8})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(handlePos.x + this.handleRadius, handlePos.y);
        ctx.arc(handlePos.x, handlePos.y, this.handleRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Draw direction indicator line when dragging
        if (this.isDragging && this.handleOffset.mag() > 5) {
            ctx.strokeStyle = 'rgba(0, 255, 136, 0.5)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(this.position.x, this.position.y);
            ctx.lineTo(handlePos.x, handlePos.y);
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * Update joystick position (for window resize)
     */
    updatePosition(x: number, y: number): void {
        this.position = new Vector(x, y);
    }
}
