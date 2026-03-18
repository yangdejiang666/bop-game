type OptionalAudioContext = AudioContext | null;

export class GameAudioManager {
    private context: OptionalAudioContext = null;
    private masterGain: GainNode | null = null;
    private musicGain: GainNode | null = null;
    private sfxGain: GainNode | null = null;
    private unlocked = false;
    private wantsMusic = false;
    private musicLoopTimer: number | null = null;
    private droneOscillator: OscillatorNode | null = null;
    private droneGain: GainNode | null = null;
    private melodyStep = 0;
    private lastEjectAtMs = 0;
    private readonly unlockHandler: () => void;

    constructor() {
        this.unlockHandler = () => {
            this.unlockFromGesture();
        };
    }

    start() {
        window.addEventListener('pointerdown', this.unlockHandler, { once: false, passive: true });
        window.addEventListener('keydown', this.unlockHandler);
        window.addEventListener('touchstart', this.unlockHandler, { once: false, passive: true });
        this.ensureContext();
    }

    destroy() {
        window.removeEventListener('pointerdown', this.unlockHandler);
        window.removeEventListener('keydown', this.unlockHandler);
        window.removeEventListener('touchstart', this.unlockHandler);
        this.stopMusic();

        if (this.context) {
            this.context.close().catch(() => {
                // Ignore close errors from disconnected contexts.
            });
        }
        this.context = null;
        this.masterGain = null;
        this.musicGain = null;
        this.sfxGain = null;
        this.unlocked = false;
    }

    requestMusicStart() {
        this.wantsMusic = true;
        this.tryStartMusicLoop();
    }

    stopMusic() {
        if (this.musicLoopTimer !== null) {
            window.clearInterval(this.musicLoopTimer);
            this.musicLoopTimer = null;
        }

        if (this.droneOscillator) {
            try {
                this.droneOscillator.stop();
            } catch {
                // no-op
            }
            this.droneOscillator.disconnect();
            this.droneOscillator = null;
        }

        if (this.droneGain) {
            this.droneGain.disconnect();
            this.droneGain = null;
        }
    }

    playSplit() {
        this.playSweep(640, 380, 0.14, 0.12, 'triangle');
        this.playSweep(280, 190, 0.16, 0.08, 'sine', 0.01);
    }

    playEject() {
        const now = performance.now();
        if (now - this.lastEjectAtMs < 52) {
            return;
        }
        this.lastEjectAtMs = now;
        this.playSweep(430, 270, 0.07, 0.07, 'sawtooth');
    }

    playSpikeBurst() {
        this.playSweep(180, 70, 0.24, 0.2, 'square');
        this.playSweep(600, 190, 0.22, 0.09, 'triangle', 0.02);
    }

    private unlockFromGesture() {
        if (!this.ensureContext() || !this.context) {
            return;
        }
        this.context.resume().catch(() => {
            // Browsers may still block; we'll retry on next gesture.
        });
        this.unlocked = this.context.state === 'running';
        this.tryStartMusicLoop();
    }

    private ensureContext(): boolean {
        if (this.context) {
            return true;
        }

        if (typeof window.AudioContext === 'undefined') {
            return false;
        }

        this.context = new window.AudioContext();
        this.masterGain = this.context.createGain();
        this.masterGain.gain.value = 0.56;
        this.masterGain.connect(this.context.destination);

        this.musicGain = this.context.createGain();
        this.musicGain.gain.value = 0.16;
        this.musicGain.connect(this.masterGain);

        this.sfxGain = this.context.createGain();
        this.sfxGain.gain.value = 0.34;
        this.sfxGain.connect(this.masterGain);

        return true;
    }

    private tryStartMusicLoop() {
        if (!this.wantsMusic || !this.unlocked || !this.context || !this.musicGain) {
            return;
        }
        if (this.musicLoopTimer !== null) {
            return;
        }

        this.startDrone();
        const melodyPattern = [0, 3, 7, 10, 7, 3, 5, 2];
        this.musicLoopTimer = window.setInterval(() => {
            if (!this.context || !this.musicGain || this.context.state !== 'running') {
                return;
            }

            const offset = melodyPattern[this.melodyStep % melodyPattern.length];
            const root = 164.81; // E3
            const melodyFreq = root * Math.pow(2, offset / 12);
            const bassFreq = root * Math.pow(2, (offset - 12) / 12);
            this.playTone(melodyFreq, 0.36, 0.055, 'triangle');
            this.playTone(bassFreq, 0.42, 0.036, 'sine', 0.02);
            this.melodyStep += 1;
        }, 520);
    }

    private startDrone() {
        if (!this.context || !this.musicGain || this.droneOscillator) {
            return;
        }

        const osc = this.context.createOscillator();
        const gain = this.context.createGain();
        osc.type = 'sine';
        osc.frequency.value = 82.41; // E2
        gain.gain.value = 0.022;
        osc.connect(gain);
        gain.connect(this.musicGain);
        osc.start();

        this.droneOscillator = osc;
        this.droneGain = gain;
    }

    private playSweep(
        fromHz: number,
        toHz: number,
        duration: number,
        volume: number,
        waveType: OscillatorType,
        delay = 0
    ) {
        if (!this.context || !this.sfxGain || this.context.state !== 'running') {
            return;
        }

        const osc = this.context.createOscillator();
        const gain = this.context.createGain();
        const startTime = this.context.currentTime + delay;
        const endTime = startTime + duration;
        osc.type = waveType;
        osc.frequency.setValueAtTime(fromHz, startTime);
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, toHz), endTime);

        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), startTime + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

        osc.connect(gain);
        gain.connect(this.sfxGain);
        osc.start(startTime);
        osc.stop(endTime + 0.02);
    }

    private playTone(
        frequency: number,
        duration: number,
        volume: number,
        waveType: OscillatorType,
        delay = 0
    ) {
        if (!this.context || !this.musicGain || this.context.state !== 'running') {
            return;
        }

        const osc = this.context.createOscillator();
        const gain = this.context.createGain();
        const startTime = this.context.currentTime + delay;
        const endTime = startTime + duration;

        osc.type = waveType;
        osc.frequency.setValueAtTime(Math.max(50, frequency), startTime);
        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), startTime + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

        osc.connect(gain);
        gain.connect(this.musicGain);
        osc.start(startTime);
        osc.stop(endTime + 0.02);
    }
}
