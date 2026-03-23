export type WsConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface WsGatewayOptions {
    url: string;
    accessToken?: string;
    reconnect?: {
        enabled?: boolean;
        maxAttempts?: number;
        baseDelayMs?: number;
        maxDelayMs?: number;
    };
    heartbeat?: {
        enabled?: boolean;
        intervalMs?: number;
        timeoutMs?: number;
    };
    debug?: boolean;
}

export interface WsEnvelope<TPayload = unknown> {
    v: 1;
    id: string;
    type: string;
    ts: number;
    traceId?: string;
    payload: TPayload;
}

export type WsEventHandler<TPayload = unknown> = (event: WsEnvelope<TPayload>) => void;
export type WsErrorHandler = (error: Error) => void;
export type WsStateHandler = (state: WsConnectionState) => void;

interface InternalConfig {
    reconnectEnabled: boolean;
    reconnectMaxAttempts: number;
    reconnectBaseDelayMs: number;
    reconnectMaxDelayMs: number;
    heartbeatEnabled: boolean;
    heartbeatIntervalMs: number;
    heartbeatTimeoutMs: number;
    debug: boolean;
}

function generateId(prefix = 'evt'): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function normalizeConfig(options: WsGatewayOptions): InternalConfig {
    return {
        reconnectEnabled: options.reconnect?.enabled ?? true,
        reconnectMaxAttempts: clamp(options.reconnect?.maxAttempts ?? 10, 0, 999),
        reconnectBaseDelayMs: clamp(options.reconnect?.baseDelayMs ?? 500, 100, 60_000),
        reconnectMaxDelayMs: clamp(options.reconnect?.maxDelayMs ?? 10_000, 500, 120_000),
        heartbeatEnabled: options.heartbeat?.enabled ?? true,
        heartbeatIntervalMs: clamp(options.heartbeat?.intervalMs ?? 8_000, 1_000, 120_000),
        heartbeatTimeoutMs: clamp(options.heartbeat?.timeoutMs ?? 15_000, 1_000, 120_000),
        debug: options.debug ?? false
    };
}

function isWsEnvelope(value: unknown): value is WsEnvelope {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value as Partial<WsEnvelope>;
    return (
        candidate.v === 1 &&
        typeof candidate.id === 'string' &&
        typeof candidate.type === 'string' &&
        typeof candidate.ts === 'number' &&
        'payload' in candidate
    );
}

export class WsGateway {
    private readonly url: string;
    private accessToken?: string;
    private readonly config: InternalConfig;

    private socket: WebSocket | null = null;
    private state: WsConnectionState = 'idle';

    private reconnectAttempts = 0;
    private reconnectTimer: number | null = null;
    private heartbeatIntervalTimer: number | null = null;
    private heartbeatTimeoutTimer: number | null = null;
    private pingNonce: string | null = null;
    private manualClose = false;

    private readonly handlers = new Map<string, Set<WsEventHandler>>();
    private readonly anyHandlers = new Set<WsEventHandler>();
    private readonly errorHandlers = new Set<WsErrorHandler>();
    private readonly stateHandlers = new Set<WsStateHandler>();

    constructor(options: WsGatewayOptions) {
        this.url = options.url;
        this.accessToken = options.accessToken;
        this.config = normalizeConfig(options);
    }

    get connectionState(): WsConnectionState {
        return this.state;
    }

    setAccessToken(token?: string) {
        this.accessToken = token;
    }

    connect() {
        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            return;
        }

        this.manualClose = false;
        this.clearReconnectTimer();
        this.setState('connecting');

        const wsUrl = this.buildConnectUrl();
        this.socket = new WebSocket(wsUrl);

        this.socket.onopen = () => {
            this.log('ws open');
            this.reconnectAttempts = 0;
            this.setState('open');
            this.startHeartbeat();
        };

        this.socket.onmessage = (evt) => {
            this.handleMessage(evt.data);
        };

        this.socket.onerror = () => {
            this.log('ws error');
            this.setState('error');
            this.emitError(new Error('WebSocket connection error.'));
        };

        this.socket.onclose = () => {
            this.log('ws close');
            this.stopHeartbeat();
            this.socket = null;
            this.setState('closed');

            if (!this.manualClose && this.config.reconnectEnabled) {
                this.scheduleReconnect();
            }
        };
    }

    disconnect() {
        this.manualClose = true;
        this.clearReconnectTimer();
        this.stopHeartbeat();

        if (this.socket) {
            try {
                this.socket.close();
            } catch {
                // noop
            }
            this.socket = null;
        }

        this.setState('closed');
    }

    send<TPayload = unknown>(type: string, payload: TPayload, traceId?: string): string {
        const id = generateId('msg');
        const envelope: WsEnvelope<TPayload> = {
            v: 1,
            id,
            type,
            ts: Date.now(),
            traceId,
            payload
        };
        this.sendEnvelope(envelope);
        return id;
    }

    sendEnvelope<TPayload = unknown>(envelope: WsEnvelope<TPayload>) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            this.emitError(new Error(`Cannot send websocket message while state=${this.state}`));
            return;
        }
        this.socket.send(JSON.stringify(envelope));
    }

    on<TPayload = unknown>(type: string, handler: WsEventHandler<TPayload>): () => void {
        const set = this.handlers.get(type) ?? new Set<WsEventHandler>();
        set.add(handler as WsEventHandler);
        this.handlers.set(type, set);

        return () => {
            const target = this.handlers.get(type);
            if (!target) return;
            target.delete(handler as WsEventHandler);
            if (target.size === 0) {
                this.handlers.delete(type);
            }
        };
    }

    onAny(handler: WsEventHandler): () => void {
        this.anyHandlers.add(handler);
        return () => this.anyHandlers.delete(handler);
    }

    onError(handler: WsErrorHandler): () => void {
        this.errorHandlers.add(handler);
        return () => this.errorHandlers.delete(handler);
    }

    onStateChange(handler: WsStateHandler): () => void {
        this.stateHandlers.add(handler);
        return () => this.stateHandlers.delete(handler);
    }

    private buildConnectUrl(): string {
        if (!this.accessToken) {
            return this.url;
        }

        const joiner = this.url.includes('?') ? '&' : '?';
        const encodedToken = encodeURIComponent(this.accessToken);
        return `${this.url}${joiner}accessToken=${encodedToken}`;
    }

    private handleMessage(raw: unknown) {
        if (typeof raw !== 'string') {
            return;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            this.emitError(new Error('Received non-JSON websocket message.'));
            return;
        }

        if (!isWsEnvelope(parsed)) {
            this.emitError(new Error('Received invalid websocket envelope.'));
            return;
        }

        const envelope = parsed as WsEnvelope;
        this.handleSystemEvents(envelope);
        this.emitEvent(envelope);
    }

    private handleSystemEvents(envelope: WsEnvelope) {
        if (envelope.type === 'system.pong') {
            const payload = envelope.payload as { nonce?: string } | null;
            if (payload?.nonce && this.pingNonce && payload.nonce === this.pingNonce) {
                this.clearHeartbeatTimeout();
            }
            return;
        }

        if (envelope.type === 'system.welcome') {
            this.clearHeartbeatTimeout();
            return;
        }
    }

    private startHeartbeat() {
        if (!this.config.heartbeatEnabled) return;

        this.stopHeartbeat();

        this.heartbeatIntervalTimer = window.setInterval(() => {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
            this.pingNonce = generateId('ping');
            this.send('system.ping', {
                nonce: this.pingNonce,
                sentAt: Date.now()
            });
            this.armHeartbeatTimeout();
        }, this.config.heartbeatIntervalMs);
    }

    private stopHeartbeat() {
        if (this.heartbeatIntervalTimer !== null) {
            window.clearInterval(this.heartbeatIntervalTimer);
            this.heartbeatIntervalTimer = null;
        }
        this.clearHeartbeatTimeout();
        this.pingNonce = null;
    }

    private armHeartbeatTimeout() {
        this.clearHeartbeatTimeout();
        this.heartbeatTimeoutTimer = window.setTimeout(() => {
            this.emitError(new Error('WebSocket heartbeat timeout.'));
            if (this.socket) {
                try {
                    this.socket.close();
                } catch {
                    // noop
                }
            }
        }, this.config.heartbeatTimeoutMs);
    }

    private clearHeartbeatTimeout() {
        if (this.heartbeatTimeoutTimer !== null) {
            window.clearTimeout(this.heartbeatTimeoutTimer);
            this.heartbeatTimeoutTimer = null;
        }
    }

    private scheduleReconnect() {
        if (this.reconnectAttempts >= this.config.reconnectMaxAttempts) {
            this.log('reconnect stopped: max attempts reached');
            return;
        }

        this.reconnectAttempts += 1;
        const exponential = this.config.reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempts - 1);
        const jitter = Math.floor(Math.random() * 250);
        const delay = Math.min(this.config.reconnectMaxDelayMs, exponential + jitter);

        this.log(`reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);

        this.clearReconnectTimer();
        this.reconnectTimer = window.setTimeout(() => {
            this.connect();
        }, delay);
    }

    private clearReconnectTimer() {
        if (this.reconnectTimer !== null) {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    private setState(next: WsConnectionState) {
        if (this.state === next) return;
        this.state = next;
        for (const handler of this.stateHandlers) {
            handler(next);
        }
    }

    private emitEvent(envelope: WsEnvelope) {
        const typed = this.handlers.get(envelope.type);
        if (typed) {
            for (const handler of typed) {
                handler(envelope);
            }
        }

        for (const handler of this.anyHandlers) {
            handler(envelope);
        }
    }

    private emitError(error: Error) {
        for (const handler of this.errorHandlers) {
            handler(error);
        }
    }

    private log(message: string) {
        if (!this.config.debug) return;
        console.log(`[WsGateway] ${message}`);
    }
}
