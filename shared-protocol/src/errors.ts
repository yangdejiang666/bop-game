export const PROTOCOL_ERROR = {
    // Common
    UNKNOWN: 'UNKNOWN',
    INVALID_REQUEST: 'INVALID_REQUEST',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    NOT_FOUND: 'NOT_FOUND',
    CONFLICT: 'CONFLICT',
    RATE_LIMITED: 'RATE_LIMITED',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

    // Auth
    AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
    AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
    AUTH_REFRESH_TOKEN_INVALID: 'AUTH_REFRESH_TOKEN_INVALID',
    AUTH_ACCOUNT_BANNED: 'AUTH_ACCOUNT_BANNED',
    AUTH_ACCOUNT_LOCKED: 'AUTH_ACCOUNT_LOCKED',
    AUTH_GUEST_UPGRADE_REQUIRED: 'AUTH_GUEST_UPGRADE_REQUIRED',
    AUTH_DEVICE_NOT_TRUSTED: 'AUTH_DEVICE_NOT_TRUSTED',
    AUTH_VERIFICATION_REQUIRED: 'AUTH_VERIFICATION_REQUIRED',

    // User / Profile
    USER_NOT_FOUND: 'USER_NOT_FOUND',
    USER_NAME_TAKEN: 'USER_NAME_TAKEN',
    USER_INVALID_NAME: 'USER_INVALID_NAME',
    USER_INVALID_AVATAR: 'USER_INVALID_AVATAR',

    // Social
    SOCIAL_NOT_FOUND: 'SOCIAL_NOT_FOUND',
    SOCIAL_INVALID_GAME_ID: 'SOCIAL_INVALID_GAME_ID',
    SOCIAL_CANNOT_ADD_SELF: 'SOCIAL_CANNOT_ADD_SELF',
    SOCIAL_ALREADY_FRIENDS: 'SOCIAL_ALREADY_FRIENDS',
    SOCIAL_NOT_FRIENDS: 'SOCIAL_NOT_FRIENDS',
    SOCIAL_REQUEST_NOT_FOUND: 'SOCIAL_REQUEST_NOT_FOUND',
    SOCIAL_REQUEST_ALREADY_HANDLED: 'SOCIAL_REQUEST_ALREADY_HANDLED',
    SOCIAL_BLOCKED: 'SOCIAL_BLOCKED',

    // Matchmaking / Room
    MATCH_ALREADY_IN_QUEUE: 'MATCH_ALREADY_IN_QUEUE',
    MATCH_NOT_IN_QUEUE: 'MATCH_NOT_IN_QUEUE',
    MATCH_QUEUE_FULL: 'MATCH_QUEUE_FULL',
    MATCH_REGION_UNAVAILABLE: 'MATCH_REGION_UNAVAILABLE',

    ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
    ROOM_FULL: 'ROOM_FULL',
    ROOM_ALREADY_JOINED: 'ROOM_ALREADY_JOINED',
    ROOM_NOT_MEMBER: 'ROOM_NOT_MEMBER',
    ROOM_INVITE_INVALID: 'ROOM_INVITE_INVALID',
    ROOM_PERMISSION_DENIED: 'ROOM_PERMISSION_DENIED',
    ROOM_INVALID_STATE: 'ROOM_INVALID_STATE',
    ROOM_ALREADY_READY: 'ROOM_ALREADY_READY',
    ROOM_START_CONDITION_NOT_MET: 'ROOM_START_CONDITION_NOT_MET',

    // Realtime / Gateway
    WS_UNAUTHORIZED: 'WS_UNAUTHORIZED',
    WS_INVALID_MESSAGE: 'WS_INVALID_MESSAGE',
    WS_HEARTBEAT_TIMEOUT: 'WS_HEARTBEAT_TIMEOUT',
    WS_SESSION_CONFLICT: 'WS_SESSION_CONFLICT'
} as const;

export type ProtocolErrorCode = (typeof PROTOCOL_ERROR)[keyof typeof PROTOCOL_ERROR];

export interface ProtocolErrorDetail {
    field?: string;
    reason?: string;
    [key: string]: unknown;
}

export interface ProtocolErrorPayload {
    code: ProtocolErrorCode;
    message: string;
    details?: ProtocolErrorDetail;
    requestId?: string;
    timestamp: string;
}

export interface ProtocolSuccessPayload<T> {
    ok: true;
    data: T;
    requestId?: string;
    timestamp: string;
}

export interface ProtocolFailurePayload {
    ok: false;
    error: ProtocolErrorPayload;
}

export type ProtocolResponse<T> = ProtocolSuccessPayload<T> | ProtocolFailurePayload;

export function createSuccess<T>(data: T, requestId?: string): ProtocolSuccessPayload<T> {
    return {
        ok: true,
        data,
        requestId,
        timestamp: new Date().toISOString()
    };
}

export function createError(
    code: ProtocolErrorCode,
    message: string,
    options?: {
        details?: ProtocolErrorDetail;
        requestId?: string;
    }
): ProtocolFailurePayload {
    return {
        ok: false,
        error: {
            code,
            message,
            details: options?.details,
            requestId: options?.requestId,
            timestamp: new Date().toISOString()
        }
    };
}

export function isProtocolSuccess<T>(value: ProtocolResponse<T>): value is ProtocolSuccessPayload<T> {
    return value.ok;
}

export function isProtocolFailure<T>(value: ProtocolResponse<T>): value is ProtocolFailurePayload {
    return !value.ok;
}
