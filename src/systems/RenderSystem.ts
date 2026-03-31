import { Camera } from '../core/Camera';
import { Vector } from '../utils/Vector';
import { Blob } from '../entities/Blob';
import { Player } from '../entities/Player';
import { Bot } from '../entities/Bot';
import { gameplayTuning } from '../gameplay/tuning';
import { Food } from '../entities/Food';
import { Virus } from '../entities/Virus';
import { EjectedMass } from '../entities/EjectedMass';
import type {
    BattleRoyaleRedZoneDefinition,
    BattleRoyaleRedZonePhase,
    BattleRoyaleShieldStationDefinition
} from '../modes/battleRoyaleRuntime';

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
            // Player / Bot Cell - keep a stable perfect circle (no jelly deformation)
            ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
            ctx.fillStyle = this.getBlobFillStyle(ctx, blob, screenPos.x, screenPos.y, screenRadius);
            ctx.fill();
            ctx.strokeStyle = this.getBlobStrokeStyle(blob);
            ctx.lineWidth = 2;
            ctx.stroke();

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

    drawBattleZoneSquare(
        worldSize: number,
        safeRect: { minX: number; minY: number; maxX: number; maxY: number; size: number },
        stage: number,
        camera: Camera
    ) {
        const ctx = this.ctxBg;
        const worldTopLeft = camera.project(new Vector(0, 0));
        const worldBottomRight = camera.project(new Vector(worldSize, worldSize));
        const worldX = Math.min(worldTopLeft.x, worldBottomRight.x);
        const worldY = Math.min(worldTopLeft.y, worldBottomRight.y);
        const worldWidth = Math.abs(worldBottomRight.x - worldTopLeft.x);
        const worldHeight = Math.abs(worldBottomRight.y - worldTopLeft.y);
        if (!Number.isFinite(worldWidth) || !Number.isFinite(worldHeight) || worldWidth <= 4 || worldHeight <= 4) {
            return;
        }

        const pulse = Math.sin(performance.now() / 260) * 0.08 + 0.92;
        const fillAlpha = stage >= 4 ? 0.18 : (stage >= 3 ? 0.14 : (stage >= 2 ? 0.1 : 0.08));
        const strokeAlpha = stage >= 4 ? 0.92 : (stage >= 3 ? 0.82 : (stage >= 2 ? 0.72 : 0.58));

        ctx.save();
        ctx.fillStyle = `rgba(255, 78, 78, ${fillAlpha.toFixed(3)})`;

        if (safeRect.size <= 0) {
            ctx.fillRect(worldX, worldY, worldWidth, worldHeight);
            ctx.restore();
            return;
        }

        const safeTopLeft = camera.project(new Vector(safeRect.minX, safeRect.minY));
        const safeBottomRight = camera.project(new Vector(safeRect.maxX, safeRect.maxY));
        const safeX = Math.min(safeTopLeft.x, safeBottomRight.x);
        const safeY = Math.min(safeTopLeft.y, safeBottomRight.y);
        const safeWidth = Math.abs(safeBottomRight.x - safeTopLeft.x);
        const safeHeight = Math.abs(safeBottomRight.y - safeTopLeft.y);

        ctx.fillRect(worldX, worldY, worldWidth, Math.max(0, safeY - worldY));
        ctx.fillRect(worldX, safeY + safeHeight, worldWidth, Math.max(0, worldY + worldHeight - (safeY + safeHeight)));
        ctx.fillRect(worldX, safeY, Math.max(0, safeX - worldX), safeHeight);
        ctx.fillRect(safeX + safeWidth, safeY, Math.max(0, worldX + worldWidth - (safeX + safeWidth)), safeHeight);

        ctx.beginPath();
        ctx.setLineDash(stage >= 3 ? [6, 4] : [12, 8]);
        ctx.lineWidth = stage >= 3 ? 3 : 2.25;
        ctx.strokeStyle = `rgba(132, 234, 255, ${(strokeAlpha * pulse).toFixed(3)})`;
        ctx.rect(safeX, safeY, safeWidth, safeHeight);
        ctx.stroke();
        ctx.restore();
    }

    drawBattleRoyaleRedZones(
        zones: Array<BattleRoyaleRedZoneDefinition & { phase: BattleRoyaleRedZonePhase }>,
        camera: Camera
    ) {
        if (zones.length === 0) {
            return;
        }

        const ctx = this.ctxBg;
        const pulse = Math.sin(performance.now() / 180) * 0.15 + 0.85;

        zones.forEach((zone) => {
            if (zone.phase !== 'warning' && zone.phase !== 'active') {
                return;
            }

            const center = camera.project(new Vector(zone.center.x, zone.center.y));
            const screenRadius = zone.radius * camera.scale;
            if (!Number.isFinite(screenRadius) || screenRadius <= 4) {
                return;
            }

            ctx.save();
            ctx.beginPath();
            ctx.arc(center.x, center.y, screenRadius, 0, Math.PI * 2);

            if (zone.phase === 'warning') {
                ctx.setLineDash([12, 10]);
                ctx.lineWidth = 2.5;
                ctx.strokeStyle = `rgba(255, 210, 118, ${(0.7 * pulse).toFixed(3)})`;
                ctx.stroke();
            } else {
                ctx.fillStyle = `rgba(255, 74, 74, ${(0.12 * pulse).toFixed(3)})`;
                ctx.fill();
                ctx.setLineDash([10, 6]);
                ctx.lineWidth = 3;
                ctx.strokeStyle = `rgba(255, 124, 124, ${(0.9 * pulse).toFixed(3)})`;
                ctx.stroke();
            }

            if (screenRadius >= 24) {
                ctx.fillStyle = zone.phase === 'warning'
                    ? 'rgba(255, 228, 178, 0.92)'
                    : 'rgba(255, 244, 244, 0.96)';
                ctx.font = `bold ${Math.max(11, Math.min(20, screenRadius * 0.16))}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(zone.phase === 'warning' ? 'WARN' : 'RED', center.x, center.y);
            }
            ctx.restore();
        });
    }

    drawBattleRoyaleShieldStations(
        stations: Array<BattleRoyaleShieldStationDefinition & { available: boolean; cooldownRemainingSeconds: number }>,
        camera: Camera
    ) {
        if (stations.length === 0) {
            return;
        }

        const ctx = this.ctxBg;
        const pulse = Math.sin(performance.now() / 240) * 0.12 + 0.88;

        stations.forEach((station) => {
            const center = camera.project(new Vector(station.center.x, station.center.y));
            const screenRadius = station.pickupRadius * camera.scale;
            if (!Number.isFinite(screenRadius) || screenRadius <= 3) {
                return;
            }

            const available = station.available;
            ctx.save();
            ctx.beginPath();
            ctx.arc(center.x, center.y, screenRadius, 0, Math.PI * 2);
            ctx.fillStyle = available
                ? `rgba(65, 239, 228, ${(0.08 * pulse).toFixed(3)})`
                : 'rgba(94, 128, 140, 0.05)';
            ctx.fill();

            ctx.setLineDash(available ? [10, 8] : [4, 10]);
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = available
                ? `rgba(110, 255, 244, ${(0.9 * pulse).toFixed(3)})`
                : 'rgba(126, 160, 172, 0.45)';
            ctx.stroke();

            const coreRadius = Math.max(4, screenRadius * 0.18);
            ctx.beginPath();
            ctx.arc(center.x, center.y, coreRadius, 0, Math.PI * 2);
            ctx.fillStyle = available ? 'rgba(183, 255, 250, 0.94)' : 'rgba(152, 176, 185, 0.74)';
            ctx.fill();

            if (screenRadius >= 20) {
                ctx.fillStyle = available ? 'rgba(205, 255, 250, 0.94)' : 'rgba(170, 190, 198, 0.82)';
                ctx.font = `bold ${Math.max(10, Math.min(18, screenRadius * 0.15))}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(available ? 'SHD' : `${Math.ceil(station.cooldownRemainingSeconds)}`, center.x, center.y - screenRadius * 0.42);
            }
            ctx.restore();
        });
    }

    private getBlobFillStyle(
        ctx: CanvasRenderingContext2D,
        blob: Blob,
        x: number,
        y: number,
        radius: number
    ): string | CanvasGradient {
        const primary = blob.color;
        const accent = blob.owner?.accentColor as string | undefined;

        if (!accent || accent === primary) {
            return primary;
        }

        const gradient = ctx.createRadialGradient(
            x - radius * 0.36,
            y - radius * 0.42,
            Math.max(1, radius * 0.14),
            x,
            y,
            radius * 1.05
        );
        gradient.addColorStop(0, accent);
        gradient.addColorStop(0.5, primary);
        gradient.addColorStop(1, primary);
        return gradient;
    }

    private getBlobStrokeStyle(blob: Blob): string {
        const accent = blob.owner?.accentColor as string | undefined;
        if (accent && accent !== blob.color) {
            return accent;
        }
        return 'rgba(0,0,0,0.1)';
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
