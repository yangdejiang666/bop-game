import { Vector } from '../utils/Vector';
import type { Camera } from './Camera';

export class Input {
    public mousePos: Vector = new Vector(0, 0);
    public onSplit: () => void = () => { };
    public onEject: () => void = () => { };
    public isEjecting: boolean = false; // Track if W is held down
    private camera: Camera | null = null;
    private readonly mouseMoveHandler: (e: MouseEvent) => void;
    private readonly touchMoveHandler: (e: TouchEvent) => void;
    private readonly touchStartHandler: (e: TouchEvent) => void;
    private readonly keyDownHandler: (e: KeyboardEvent) => void;
    private readonly keyUpHandler: (e: KeyboardEvent) => void;
    private readonly contextMenuHandler: (e: MouseEvent) => void;

    constructor() {
        // Mouse move - track position
        this.mouseMoveHandler = (e) => {
            this.mousePos = new Vector(e.clientX, e.clientY);
        };
        window.addEventListener('mousemove', this.mouseMoveHandler);

        // Touch support for mobile
        this.touchMoveHandler = (e) => {
            if (e.touches.length > 0) {
                const touch = e.touches[0];
                this.mousePos = new Vector(touch.clientX, touch.clientY);
            }
            e.preventDefault(); // Prevent scrolling
        };
        window.addEventListener('touchmove', this.touchMoveHandler, { passive: false });

        this.touchStartHandler = (e) => {
            if (e.touches.length > 0) {
                const touch = e.touches[0];
                this.mousePos = new Vector(touch.clientX, touch.clientY);
            }
        };
        window.addEventListener('touchstart', this.touchStartHandler);

        // Keyboard controls
        this.keyDownHandler = (e) => {
            const target = e.target;
            if (target instanceof HTMLElement) {
                if (
                    target instanceof HTMLInputElement ||
                    target instanceof HTMLTextAreaElement ||
                    target instanceof HTMLButtonElement ||
                    target instanceof HTMLSelectElement ||
                    target.isContentEditable
                ) {
                    return;
                }
            }

            // 按一次空格分身一次（忽略键盘重复事件）
            if (e.code === 'Space' && !e.repeat) {
                e.preventDefault();
                this.onSplit();
            } else if (e.code === 'KeyW') {
                this.isEjecting = true; // Start ejecting
            }
        };
        window.addEventListener('keydown', this.keyDownHandler);

        this.keyUpHandler = (e) => {
            if (e.code === 'KeyW') {
                this.isEjecting = false; // Stop ejecting
            }
        };
        window.addEventListener('keyup', this.keyUpHandler);

        // Prevent context menu
        this.contextMenuHandler = (e) => e.preventDefault();
        window.addEventListener('contextmenu', this.contextMenuHandler);
    }

    /**
     * Set the camera reference for coordinate conversion
     */
    setCamera(camera: Camera): void {
        this.camera = camera;
    }

    /**
     * Get the world position of the mouse cursor
     */
    getMouseWorldPosition(): Vector | null {
        if (!this.camera) return null;
        return this.camera.unproject(this.mousePos);
    }

    /**
     * Get the direction for player movement towards mouse
     * @param playerCenter - The center position of the player in world coordinates
     * Returns normalized direction vector towards mouse
     */
    getMovementDirection(playerCenter: Vector): Vector | null {
        if (!this.camera) return null;

        const mouseWorld = this.camera.unproject(this.mousePos);
        const direction = mouseWorld.sub(playerCenter);

        // Add a small deadzone to prevent jittering when mouse is very close to player
        if (direction.mag() < 5) {
            return null;
        }

        return direction.normalize();
    }

    setMouseScreenPosition(x: number, y: number) {
        this.mousePos = new Vector(x, y);
    }

    destroy() {
        window.removeEventListener('mousemove', this.mouseMoveHandler);
        window.removeEventListener('touchmove', this.touchMoveHandler);
        window.removeEventListener('touchstart', this.touchStartHandler);
        window.removeEventListener('keydown', this.keyDownHandler);
        window.removeEventListener('keyup', this.keyUpHandler);
        window.removeEventListener('contextmenu', this.contextMenuHandler);
    }
}

