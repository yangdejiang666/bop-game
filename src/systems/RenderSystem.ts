import { Camera } from '../core/Camera';
import { Vector } from '../utils/Vector';
import { Blob } from '../entities/Blob';
import { Player } from '../entities/Player';
import { Bot } from '../entities/Bot';
import { gameplayTuning } from '../gameplay/tuning';
import { Food } from '../entities/Food';
import { Virus } from '../entities/Virus';
import { EjectedMass } from '../entities/EjectedMass';

export class RenderSystem {
    private ctxGame: CanvasRenderingContext2D;
    private ctxBg: CanvasRenderingContext2D;
    private canvasGame: HTMLCanvasElement;
    private canvasBg: HTMLCanvasElement;
    private readonly host: HTMLElement;
    private readonly resizeHandler: () => void;

    get ctx(): CanvasRenderingContext2D {
        return this.ctxGame;
    }

    constructor(host: HTMLElement) {
        this.host = host;

        // 1. Background Layer (z-index 0)
        this.canvasBg = document.createElement('canvas');
        this.canvasBg.style.position = 'absolute';
        this.canvasBg.style.top = '0';
        this.canvasBg.style.left = '0';
        this.canvasBg.style.zIndex = '0';
        this.canvasBg.style.width = '100%';
        this.canvasBg.style.height = '100%';
        this.canvasBg.style.pointerEvents = 'none';
        this.ctxBg = this.canvasBg.getContext('2d')!;
        this.host.appendChild(this.canvasBg);

        // 2. Game Layer (z-index 1)
        this.canvasGame = document.createElement('canvas');
        this.canvasGame.style.position = 'absolute';
        this.canvasGame.style.top = '0';
        this.canvasGame.style.left = '0';
        this.canvasGame.style.zIndex = '1';
        this.canvasGame.style.width = '100%';
        this.canvasGame.style.height = '100%';
        this.canvasGame.style.pointerEvents = 'none';
        this.ctxGame = this.canvasGame.getContext('2d')!;
        this.host.appendChild(this.canvasGame);

        this.resize();
        this.resizeHandler = () => this.resize();
        window.addEventListener('resize', this.resizeHandler);
    }

    resize() {
        this.canvasBg.width = window.innerWidth;
        this.canvasBg.height = window.innerHeight;
        this.canvasGame.width = window.innerWidth;
        this.canvasGame.height = window.innerHeight;
    }

    clear() {
        // Clear both
        this.ctxBg.clearRect(0, 0, this.canvasBg.width, this.canvasBg.height);
        this.ctxGame.clearRect(0, 0, this.canvasGame.width, this.canvasGame.height);
    }

    drawBoundaryWarnings(playerPos: Vector, worldSize: number, camera: Camera) {
        try {
            // Safety check
            if (!playerPos || isNaN(playerPos.x) || isNaN(playerPos.y)) return;

            const ctx = this.ctxGame;
            const warningDistance = 500; // Distance from edge to show warning

            // Pulsating effect (0.3 to 1.0)
            const pulse = Math.sin(performance.now() / 300) * 0.35 + 0.65;

            ctx.save();
            ctx.lineWidth = 8;
            ctx.lineCap = 'round'; // Nicer corners

            // Helper to draw projected world lines
            const drawWorldLine = (x1: number, y1: number, x2: number, y2: number, rawAlpha: number) => {
                const alpha = Math.max(0, Math.min(1, rawAlpha));
                if (alpha <= 0.02) return;

                const p1 = camera.project(new Vector(x1, y1));
                const p2 = camera.project(new Vector(x2, y2));

                ctx.strokeStyle = `rgba(255, 50, 50, ${alpha})`;
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
            };

            // Left Edge (0,0) -> (0,H)
            if (playerPos.x < warningDistance) {
                const alpha = (1 - (playerPos.x / warningDistance)) * pulse;
                drawWorldLine(0, 0, 0, worldSize, alpha);
            }

            // Right Edge (W,0) -> (W,H)
            if (playerPos.x > worldSize - warningDistance) {
                const alpha = (1 - ((worldSize - playerPos.x) / warningDistance)) * pulse;
                drawWorldLine(worldSize, 0, worldSize, worldSize, alpha);
            }

            // Top Edge (0,0) -> (W,0)
            if (playerPos.y < warningDistance) {
                const alpha = (1 - (playerPos.y / warningDistance)) * pulse;
                drawWorldLine(0, 0, worldSize, 0, alpha);
            }

            // Bottom Edge (0,H) -> (W,H)
            if (playerPos.y > worldSize - warningDistance) {
                const alpha = (1 - ((worldSize - playerPos.y) / warningDistance)) * pulse;
                drawWorldLine(0, worldSize, worldSize, worldSize, alpha);
            }

            ctx.restore();
        } catch (e) {
            if (this.ctxGame) this.ctxGame.restore();
        }
    }

    drawWorldBorder(worldSize: number, camera: Camera) {
        const ctx = this.ctxBg; // Draw on background layer

        // Project corners
        const tl = camera.project(new Vector(0, 0));
        const tr = camera.project(new Vector(worldSize, 0));
        const br = camera.project(new Vector(worldSize, worldSize));
        const bl = camera.project(new Vector(0, worldSize));

        ctx.save();
        ctx.beginPath();
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#880000'; // Dark Red perma-border
        ctx.lineJoin = 'round';

        ctx.moveTo(tl.x, tl.y);
        ctx.lineTo(tr.x, tr.y);
        ctx.lineTo(br.x, br.y);
        ctx.lineTo(bl.x, bl.y);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
    }

    drawGrid(camera: Camera, reducedMotion: boolean = false) {
        // Use Background Context
        const ctx = this.ctxBg;

        const worldGridStep = 50;
        const minPixelStep = reducedMotion ? 32 : 24;
        const basePixelStep = worldGridStep * camera.scale;
        if (!Number.isFinite(basePixelStep) || basePixelStep <= 0) {
            return;
        }

        const stepMultiplier = Math.max(1, Math.ceil(minPixelStep / basePixelStep));
        const actualWorldStep = worldGridStep * stepMultiplier;
        const actualPixelStep = actualWorldStep * camera.scale;
        if (actualPixelStep < 8) {
            return;
        }

        ctx.beginPath();
        const normalizedScale = this.clamp((camera.scale - 0.16) / 0.84, 0, 1);
        const baseAlpha = reducedMotion ? 0.06 : 0.08;
        const alpha = baseAlpha + normalizedScale * (reducedMotion ? 0.08 : 0.14);
        ctx.strokeStyle = `rgba(206, 222, 235, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 1;

        const cx = this.canvasBg.width / 2;
        const cy = this.canvasBg.height / 2;

        const startX = this.mod(cx - (camera.position.x * camera.scale), actualPixelStep);
        const startY = this.mod(cy - (camera.position.y * camera.scale), actualPixelStep);

        // Vertical lines
        for (let x = startX - actualPixelStep; x < this.canvasBg.width + actualPixelStep; x += actualPixelStep) {
            const alignedX = Math.round(x) + 0.5;
            ctx.moveTo(alignedX, 0);
            ctx.lineTo(alignedX, this.canvasBg.height);
        }

        // Horizontal lines
        for (let y = startY - actualPixelStep; y < this.canvasBg.height + actualPixelStep; y += actualPixelStep) {
            const alignedY = Math.round(y) + 0.5;
            ctx.moveTo(0, alignedY);
            ctx.lineTo(this.canvasBg.width, alignedY);
        }

        ctx.stroke();
    }

    drawBlob(blob: Blob, camera: Camera) {
        const ctx = this.ctxGame;
        const screenPos = camera.project(blob.position);
        const screenRadius = blob.radius * camera.scale;
        const padding = screenRadius;

        if (
            screenPos.x + padding < 0 ||
            screenPos.x - padding > this.canvasGame.width ||
            screenPos.y + padding < 0 ||
            screenPos.y - padding > this.canvasGame.height
        ) {
            return;
        }

        ctx.beginPath();

        // Check owner type
        let isPlayer = false;
        let isBot = false;
        const isVirus = blob instanceof Virus;
        const isFood = blob instanceof Food || blob instanceof EjectedMass || blob.isEjected;

        if (blob.owner instanceof Player) isPlayer = true;
        if (blob.owner instanceof Bot) isBot = true;

        // Render Logic
        if (isVirus) {
            this.drawVirusShape(ctx, screenPos.x, screenPos.y, screenRadius);
            ctx.fillStyle = blob.color;
            ctx.fill();
            ctx.strokeStyle = '#b2ebf2';
            ctx.lineWidth = 4;
            ctx.stroke();
        } else if (isFood) {
            ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
            ctx.fillStyle = blob.color;
            ctx.fill();
        } else {
            // Player / Bot Cell - JELLY EFFECT
            const hasStretch = blob.stretchTimer > 0 && blob.stretchDirection.mag() > 0;
            if (hasStretch) {
                const stretchProgress = this.clamp(blob.stretchTimer / 0.1, 0, 1);
                const forwardScale = 1 + 0.08 * stretchProgress;
                const sideScale = 1 - 0.06 * stretchProgress;
                const stretchAngle = Math.atan2(blob.stretchDirection.y, blob.stretchDirection.x);

                ctx.save();
                ctx.translate(screenPos.x, screenPos.y);
                ctx.rotate(stretchAngle);
                ctx.scale(forwardScale, sideScale);
                this.drawSoftCircle(ctx, 0, 0, screenRadius, blob);
                ctx.fillStyle = blob.color;
                ctx.fill();
                ctx.strokeStyle = 'rgba(0,0,0,0.1)';
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.restore();
            } else {
                this.drawSoftCircle(ctx, screenPos.x, screenPos.y, screenRadius, blob);
                ctx.fillStyle = blob.color;
                ctx.fill();
                ctx.strokeStyle = 'rgba(0,0,0,0.1)';
                ctx.lineWidth = 2;
                ctx.stroke();
            }

            this.drawDashTrail(ctx, screenPos.x, screenPos.y, screenRadius, blob);
        }

        // Name
        if (isPlayer || isBot) {
            ctx.fillStyle = '#fff';
            ctx.font = `bold ${Math.max(10, screenRadius * 0.3)}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            let name = 'Unknown';
            if (isPlayer) name = blob.owner.displayName ?? 'Player';
            if (isBot) name = (blob.owner as Bot).name;

            ctx.fillText(name, screenPos.x, screenPos.y);



            // Draw direction arrow on ALL player cells - always align to player aim direction.
            if (isPlayer && blob.owner) {
                const owner = blob.owner as Player;
                const aimDirection = owner.getAimDirection();
                const arrowDirection = aimDirection.mag() > 0.0001
                    ? aimDirection
                    : blob.velocity;

                if (arrowDirection.mag() > 0.0001) {
                    this.drawDirectionArrow(ctx, screenPos.x, screenPos.y, screenRadius, arrowDirection);
                }
            }
        }
    }

    private drawDirectionArrow(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        radius: number,
        direction: Vector
    ) {
        if (direction.mag() === 0) return;

        const angle = Math.atan2(direction.y, direction.x);

        // Pulsating opacity effect (0.3 to 0.7)
        const pulseSpeed = 3;
        const pulse = Math.sin(performance.now() / 200 * pulseSpeed) * 0.2 + 0.5;

        // Arrow size - shorter and stubbier
        const arrowLength = radius * 0.25; // Reduced from 0.4 for shorter arrow
        const arrowWidth = radius * 0.35;  // Increased from 0.25 for stubbier look

        // Position arrow on edge of circle
        const arrowDist = radius + 8; // Closer to cell
        const arrowX = x + Math.cos(angle) * arrowDist;
        const arrowY = y + Math.sin(angle) * arrowDist;

        ctx.save();
        ctx.translate(arrowX, arrowY);
        ctx.rotate(angle);

        // Draw arrow (pointing right, then rotated) - stubbier shape
        ctx.beginPath();
        ctx.moveTo(arrowLength, 0); // Arrow tip
        ctx.lineTo(-arrowLength * 0.6, -arrowWidth); // Adjusted for stubbier shape
        ctx.lineTo(-arrowLength * 0.6, arrowWidth);
        ctx.closePath();

        // Semi-transparent fill with pulse effect
        ctx.fillStyle = `rgba(255, 255, 255, ${pulse})`;
        ctx.fill();

        // Subtle stroke
        ctx.strokeStyle = `rgba(0, 0, 0, ${pulse * 0.5})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.restore();
    }

    private drawDashTrail(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        radius: number,
        blob: Blob
    ) {
        if (blob.dashTimer <= 0) return;

        let trailDir = blob.dashVelocity.normalize();
        if (trailDir.mag() === 0) {
            trailDir = blob.velocity.normalize();
        }
        if (trailDir.mag() === 0) return;

        const progress = this.clamp(blob.dashTimer / gameplayTuning.split.dash_time, 0, 1);
        if (progress <= 0) return;

        ctx.save();
        for (let i = 1; i <= 2; i += 1) {
            const offset = radius * (0.8 + i * 0.6);
            const trailRadius = radius * (0.33 - i * 0.09) * progress;
            if (trailRadius <= 0.2) continue;

            const alpha = this.clamp((0.2 - i * 0.06) * progress, 0, 1);
            ctx.beginPath();
            ctx.arc(
                x - trailDir.x * offset,
                y - trailDir.y * offset,
                trailRadius,
                0,
                Math.PI * 2
            );
            ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
            ctx.fill();
        }
        ctx.restore();
    }

    private drawSoftCircle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, blob: Blob) {
        // Optimization & Visual Preference: 
        // Only wobble if intensity > 0.01 (triggered by split/impact)
        if (blob.wobbleIntensity <= 0.01) {
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.closePath();
            return;
        }

        // High resolution for smoothness during wobble
        // Cap max points to prevent rendering freeze on huge blobs
        const points = Math.min(150, Math.max(40, Math.floor(radius * 1.5)));
        const step = (Math.PI * 2) / points;
        const time = performance.now() / 150;

        // Use stored intensity
        const intensity = blob.wobbleIntensity;

        // Generate points
        const coords: { x: number, y: number }[] = [];
        for (let i = 0; i < points; i++) {
            const theta = i * step;
            // Lower frequency noise for smoother wobble
            const offset = Math.sin(theta * 2 + time + blob.wobblePhase) *
                Math.cos(theta * 3 - time) *
                (radius * 0.05 * intensity);

            const r = radius + offset;
            coords.push({
                x: x + Math.cos(theta) * r,
                y: y + Math.sin(theta) * r
            });
        }

        ctx.beginPath();
        // Smooth curve
        const first = coords[0];
        const last = coords[coords.length - 1];
        ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);

        for (let i = 0; i < coords.length; i++) {
            const p1 = coords[i];
            const p2 = coords[(i + 1) % coords.length];
            const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
            ctx.quadraticCurveTo(p1.x, p1.y, mid.x, mid.y);
        }
        ctx.closePath();
    }

    private drawVirusShape(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
        const spikes = 20;
        const step = (Math.PI * 2) / spikes;
        for (let i = 0; i < spikes; i++) {
            const r = (i % 2 === 0) ? radius : radius * 0.9;
            const a = i * step;
            const px = x + Math.cos(a) * r;
            const py = y + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
    }

    destroy() {
        window.removeEventListener('resize', this.resizeHandler);
        this.canvasBg.remove();
        this.canvasGame.remove();
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.min(max, Math.max(min, value));
    }

    private mod(value: number, modulus: number): number {
        return ((value % modulus) + modulus) % modulus;
    }
}
