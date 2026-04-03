export type QueueModeId =
    | 'ranked'
    | 'peak'
    | 'classic'
    | 'speed'
    | 'team'
    | 'battleRoyale';

export type MatchmakingStage =
    | 'idle'
    | 'searching'
    | 'confirming'
    | 'matched'
    | 'cancelled'
    | 'failed';

export interface StartMatchmakingRequest {
    modeId: QueueModeId;
    region?: string;
    preferredLanguage?: string;
    partyId?: string;
    clientVersion?: string;
}

export interface StartMatchmakingResponse {
    ticketId: string;
    modeId: QueueModeId;
    stage: Extract<MatchmakingStage, 'searching'>;
    queuedAt: string; // RFC3339
    estimatedWaitSeconds: number;
    minStartPlayers: number;
    targetPlayers: number;
    serverTime?: string;
}

export interface CancelMatchmakingRequest {
    ticketId: string;
    reason?: 'user_cancelled' | 'timeout' | 'client_disconnected' | 'replaced';
}

export interface CancelMatchmakingResponse {
    ticketId: string;
    stage: Extract<MatchmakingStage, 'cancelled'>;
    cancelledAt: string; // RFC3339
}

export interface MatchFoundPayload {
    ticketId: string;
    matchId: string;
    roomId: string;
    modeId: QueueModeId;
    server: {
        region: string;
        wsUrl: string;
    };
    players: {
        current: number;
        target: number;
    };
    joinedAt: string; // RFC3339
    confirmationDeadlineAt: string; // RFC3339
}

export interface MatchmakingTicketState {
    ticketId: string;
    userId: string;
    modeId: QueueModeId;
    stage: MatchmakingStage;
    queuedAt: string; // RFC3339
    updatedAt: string; // RFC3339
    estimatedWaitSeconds: number;
    currentPlayers: number;
    targetPlayers: number;
    minStartPlayers: number;
    region?: string;
    clientVersion?: string;
    failureCode?: string;
    failureMessage?: string;
    matchFound?: MatchFoundPayload;
}

export interface MatchmakingProgressEvent {
    type: 'matchmaking.progress';
    payload: Pick<
        MatchmakingTicketState,
        | 'ticketId'
        | 'modeId'
        | 'stage'
        | 'estimatedWaitSeconds'
        | 'currentPlayers'
        | 'targetPlayers'
        | 'minStartPlayers'
        | 'updatedAt'
    >;
}

export interface MatchmakingMatchedEvent {
    type: 'matchmaking.matched';
    payload: MatchFoundPayload;
}

export interface MatchmakingCancelledEvent {
    type: 'matchmaking.cancelled';
    payload: {
        ticketId: string;
        cancelledAt: string; // RFC3339
        reason: string;
    };
}

export interface MatchmakingFailedEvent {
    type: 'matchmaking.failed';
    payload: {
        ticketId: string;
        failedAt: string; // RFC3339
        code: string;
        message: string;
        retriable: boolean;
    };
}

export type MatchmakingEvent =
    | MatchmakingProgressEvent
    | MatchmakingMatchedEvent
    | MatchmakingCancelledEvent
    | MatchmakingFailedEvent;
