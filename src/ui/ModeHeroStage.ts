import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { gsap } from 'gsap';
import type { ModeDefinition } from '../modes/definitions';

interface ActiveModelState {
    root: THREE.Object3D;
    mixer: THREE.AnimationMixer | null;
}

export class ModeHeroStage {
    private readonly canvas: HTMLCanvasElement;
    private renderer: THREE.WebGLRenderer;
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private clock: THREE.Clock;
    private ambientLight: THREE.AmbientLight;
    private keyLight: THREE.DirectionalLight;
    private rimLight: THREE.PointLight;
    private floorMesh: THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial>;
    private fallbackGroup: THREE.Group | null = null;
    private modelState: ActiveModelState | null = null;
    private frameId: number | null = null;
    private reduceMotion = false;
    private destroyed = false;
    private currentModeId = '';
    private loader: GLTFLoader;
    private dracoLoader: DRACOLoader;
    private readonly resizeObserver: ResizeObserver;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setClearColor(0x000000, 0);

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
        this.camera.position.set(0, 1.45, 4.3);

        this.clock = new THREE.Clock();
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.78);
        this.keyLight = new THREE.DirectionalLight(0x9ad7ff, 1.08);
        this.keyLight.position.set(2.3, 3.6, 2.1);
        this.rimLight = new THREE.PointLight(0x6ee1ff, 1.2, 18, 1.7);
        this.rimLight.position.set(-2.6, 1.7, -2.1);

        this.floorMesh = new THREE.Mesh(
            new THREE.CircleGeometry(1.88, 72),
            new THREE.MeshStandardMaterial({
                color: 0x2ea7ff,
                transparent: true,
                opacity: 0.28,
                roughness: 0.4,
                metalness: 0.2
            })
        );
        this.floorMesh.rotation.x = -Math.PI / 2;
        this.floorMesh.position.y = -1.32;

        this.scene.add(this.ambientLight, this.keyLight, this.rimLight, this.floorMesh);
        this.scene.fog = new THREE.FogExp2(0x08192f, 0.072);

        this.loader = new GLTFLoader();
        this.dracoLoader = new DRACOLoader();
        this.dracoLoader.setDecoderPath('/draco/');
        this.loader.setDRACOLoader(this.dracoLoader);

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.canvas);
        this.resize();
        this.start();
    }

    setReducedMotion(reducedMotion: boolean) {
        this.reduceMotion = reducedMotion;
    }

    async setMode(modeDefinition: ModeDefinition): Promise<void> {
        if (this.currentModeId === modeDefinition.id) {
            return;
        }
        this.currentModeId = modeDefinition.id;
        this.applyTheme(modeDefinition.theme);
        await this.loadModelOrFallback(modeDefinition.heroModelPath);
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.stop();
        this.resizeObserver.disconnect();
        this.clearActiveModel();
        this.clearFallbackGroup();
        this.floorMesh.geometry.dispose();
        this.floorMesh.material.dispose();
        this.renderer.dispose();
        this.dracoLoader.dispose();
    }

    private start() {
        if (this.frameId !== null || this.destroyed) {
            return;
        }
        const loop = () => {
            this.frameId = window.requestAnimationFrame(loop);
            const dt = this.clock.getDelta();

            if (this.modelState?.mixer) {
                this.modelState.mixer.update(dt);
            }

            if (!this.reduceMotion) {
                const t = performance.now() * 0.001;
                if (this.modelState?.root) {
                    this.modelState.root.rotation.y += dt * 0.45;
                    this.modelState.root.position.y = Math.sin(t * 1.1) * 0.08 - 0.05;
                } else if (this.fallbackGroup) {
                    this.fallbackGroup.rotation.y += dt * 0.42;
                    this.fallbackGroup.position.y = Math.sin(t) * 0.06 - 0.06;
                }
                this.floorMesh.material.opacity = 0.22 + Math.abs(Math.sin(t * 1.9)) * 0.12;
            }

            this.renderer.render(this.scene, this.camera);
        };
        loop();
    }

    private stop() {
        if (this.frameId === null) {
            return;
        }
        window.cancelAnimationFrame(this.frameId);
        this.frameId = null;
    }

    private resize() {
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        if (width <= 0 || height <= 0) {
            return;
        }

        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }

    private async loadModelOrFallback(url: string): Promise<void> {
        this.clearActiveModel();
        this.clearFallbackGroup();

        try {
            const gltf = await this.loader.loadAsync(url);
            const root = gltf.scene;
            root.position.set(0, -0.18, 0);

            root.traverse((obj: THREE.Object3D) => {
                if (!(obj instanceof THREE.Mesh)) {
                    return;
                }
                obj.castShadow = false;
                obj.receiveShadow = false;
                if (Array.isArray(obj.material)) {
                    obj.material.forEach((material: THREE.Material) => {
                        material.transparent = true;
                        material.opacity = 1;
                    });
                    return;
                }
                obj.material.transparent = true;
                obj.material.opacity = 1;
            });

            this.scene.add(root);
            const mixer = gltf.animations.length > 0 ? new THREE.AnimationMixer(root) : null;
            if (mixer) {
                gltf.animations.forEach((clip: THREE.AnimationClip) => mixer.clipAction(clip).play());
            }

            this.modelState = {
                root,
                mixer
            };

            gsap.fromTo(
                root.scale,
                { x: 0.2, y: 0.2, z: 0.2 },
                { x: 1, y: 1, z: 1, duration: 0.55, ease: 'back.out(1.4)' }
            );
            gsap.fromTo(root.rotation, { y: -0.55 }, { y: 0, duration: 0.48, ease: 'power2.out' });
        } catch (error) {
            console.warn('[ModeHeroStage] model load failed, fallback to procedural hero:', error);
            this.createFallbackGroup();
        }
    }

    private createFallbackGroup() {
        this.clearFallbackGroup();

        const group = new THREE.Group();
        const core = new THREE.Mesh(
            new THREE.SphereGeometry(1.05, 46, 46),
            new THREE.MeshPhysicalMaterial({
                color: 0x4ab4ff,
                transmission: 0.2,
                roughness: 0.18,
                metalness: 0.1,
                clearcoat: 0.62,
                clearcoatRoughness: 0.16
            })
        );
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(1.4, 0.08, 18, 84),
            new THREE.MeshStandardMaterial({
                color: 0x87f3ff,
                transparent: true,
                opacity: 0.72,
                emissive: 0x48ccff,
                emissiveIntensity: 0.36
            })
        );
        ring.rotation.x = Math.PI / 2;

        const medal = new THREE.Mesh(
            new THREE.CylinderGeometry(0.32, 0.32, 0.08, 36),
            new THREE.MeshStandardMaterial({
                color: 0xffd063,
                roughness: 0.3,
                metalness: 0.75
            })
        );
        medal.position.set(0, 1.24, 0);

        group.add(core, ring, medal);
        group.position.set(0, -0.08, 0);
        this.scene.add(group);
        this.fallbackGroup = group;

        gsap.fromTo(group.scale, { x: 0.2, y: 0.2, z: 0.2 }, { x: 1, y: 1, z: 1, duration: 0.5, ease: 'back.out(1.6)' });
    }

    private clearActiveModel() {
        if (!this.modelState) {
            return;
        }
        const { root, mixer } = this.modelState;
        if (mixer) {
            mixer.stopAllAction();
        }
        root.traverse((obj: THREE.Object3D) => {
            if (!(obj instanceof THREE.Mesh)) {
                return;
            }
            obj.geometry.dispose();
            if (Array.isArray(obj.material)) {
                obj.material.forEach((material: THREE.Material) => material.dispose());
                return;
            }
            obj.material.dispose();
        });
        this.scene.remove(root);
        this.modelState = null;
    }

    private clearFallbackGroup() {
        if (!this.fallbackGroup) {
            return;
        }
        this.fallbackGroup.traverse((obj: THREE.Object3D) => {
            if (!(obj instanceof THREE.Mesh)) {
                return;
            }
            obj.geometry.dispose();
            if (Array.isArray(obj.material)) {
                obj.material.forEach((material: THREE.Material) => material.dispose());
                return;
            }
            obj.material.dispose();
        });
        this.scene.remove(this.fallbackGroup);
        this.fallbackGroup = null;
    }

    private applyTheme(theme: ModeDefinition['theme']) {
        const themePalette: Record<ModeDefinition['theme'], { light: number; rim: number; floor: number }> = {
            gold: { light: 0xffd56f, rim: 0xffae60, floor: 0xffc26a },
            violet: { light: 0xa684ff, rim: 0xc296ff, floor: 0x8b6eff },
            cyan: { light: 0x63ecff, rim: 0x5daeff, floor: 0x58d4ff },
            amber: { light: 0xffb662, rim: 0xffdf89, floor: 0xffac4e },
            purple: { light: 0xbb8aff, rim: 0x88d8ff, floor: 0xaa6aff },
            red: { light: 0xff8b70, rim: 0xffb66e, floor: 0xff7b5f }
        };
        const palette = themePalette[theme];
        this.keyLight.color.setHex(palette.light);
        this.rimLight.color.setHex(palette.rim);
        this.floorMesh.material.color.setHex(palette.floor);
    }
}
