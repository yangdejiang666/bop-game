export const WS_PROTOCOL_VERSION = 1 as const;

export type WsScope = 'system' | 'auth' | 'matchmaking' | 'room' | 'game' | 'social';

export interface WsEnvelope<TType extends string = string, TPayload = unknown> {
  v: typeof WS_PROTOCOL_VERSION;
  id: string;
  type: TType;
  ts: number;
  traceId?: string;
  payload: TPayload;
}

export interface WsErrorPayload {
  code: string;
  message: string;
  retriable: boolean;
  details?: Record<string, unknown>;
}

export type WsClientEventType =
  | 'system.hello'
  | 'system.ping'
  | 'auth.resume'
  | 'matchmaking.start'
  | 'matchmaking.cancel'
  | 'room.create'
  | 'room.join'
  | 'room.leave'
  | 'room.ready.set'
  | 'room.team.set'
  | 'room.kick'
  | 'room.invite.accept'
  | 'game.input';

export type WsServerEventType =
  | 'system.welcome'
  | 'system.pong'
  | 'system.error'
  | 'auth.ok'
  | 'auth.expired'
  | 'matchmaking.progress'
  | 'matchmaking.found'
  | 'matchmaking.cancelled'
  | 'room.state'
  | 'room.closed'
  | 'room.error'
  | 'game.snapshot'
  | 'game.event'
  | 'social.notice';

export interface ClientHelloPayload {
  platform: 'web' | 'android' | 'ios' | 'unknown';
  appVersion: string;
  deviceId?: string;
  locale?: string;
  timezone?: string;
}

export interface ClientPingPayload {
  nonce: string;
  sentAt: number;
}

export interface AuthResumePayload {
  accessToken: string;
}

export type MatchModeId = 'ranked' | 'peak' | 'classic' | 'speed' | 'team' | 'battleRoyale';

export interface MatchmakingStartPayload {
  modeId: MatchModeId;
  region?: string;
  partyId?: string;
  mmr?: number;
}

export interface MatchmakingCancelPayload {
  queueTicketId: string;
}

export interface RoomCreatePayload {
  modeId: MatchModeId;
  maxMembers?: number;
  privateRoom?: boolean;
}

export interface RoomJoinPayload {
  roomId?: string;
  inviteCode?: string;
}

export interface RoomLeavePayload {
  roomId: string;
}

export interface RoomReadySetPayload {
  roomId: string;
  ready: boolean;
}

export interface RoomTeamSetPayload {
  roomId: string;
  team: 'A' | 'B' | 'observer';
}

export interface RoomKickPayload {
  roomId: string;
  targetUserId: string;
}

export interface RoomInviteAcceptPayload {
  inviteCode: string;
}

export interface GameInputPayload {
  roomId: string;
  frame: number;
  seq: number;
  move: { x: number; y: number };
  actions?: {
    split?: boolean;
    eject?: boolean;
  };
}

export interface ServerWelcomePayload {
  connectionId: string;
  heartbeatIntervalMs: number;
  serverTime: number;
}

export interface ServerPongPayload {
  nonce: string;
  serverTime: number;
}

export interface AuthOkPayload {
  userId: string;
  nickname: string;
  sessionId: string;
}

export interface AuthExpiredPayload {
  reason: 'token_expired' | 'token_revoked' | 'relogin_required';
}

export interface MatchmakingProgressPayload {
  queueTicketId: string;
  modeId: MatchModeId;
  stage: 'searching' | 'confirming' | 'found';
  currentPlayers: number;
  targetPlayers: number;
  etaSeconds: number;
}

export interface MatchmakingFoundPayload {
  queueTicketId: string;
  roomId: string;
  joinToken: string;
  modeId: MatchModeId;
}

export interface MatchmakingCancelledPayload {
  queueTicketId: string;
  by: 'client' | 'server';
}

export interface RoomMember {
  userId: string;
  nickname: string;
  avatarUrl?: string;
  ready: boolean;
  team: 'A' | 'B' | 'observer';
  leader: boolean;
}

export interface RoomStatePayload {
  roomId: string;
  modeId: MatchModeId;
  state: 'forming' | 'ready' | 'starting' | 'in_game' | 'closed';
  inviteCode?: string;
  members: RoomMember[];
  maxMembers: number;
  canStart: boolean;
}

export interface RoomClosedPayload {
  roomId: string;
  reason: 'disbanded' | 'kicked' | 'game_started' | 'timeout' | 'server_shutdown';
}

export interface RoomErrorPayload extends WsErrorPayload {
  roomId?: string;
}

export interface GameSnapshotPayload {
  roomId: string;
  tick: number;
  ackInputSeq?: number;
  state: Record<string, unknown>;
}

export interface GameEventPayload {
  roomId: string;
  tick: number;
  event:
    | 'player_joined'
    | 'player_left'
    | 'player_eliminated'
    | 'match_started'
    | 'match_finished'
    | 'zone_changed';
  data?: Record<string, unknown>;
}

export interface SocialNoticePayload {
  kind: 'friend_online' | 'friend_invite' | 'system_announcement';
  title: string;
  content: string;
  extra?: Record<string, unknown>;
}

export type ClientHelloEvent = WsEnvelope<'system.hello', ClientHelloPayload>;
export type ClientPingEvent = WsEnvelope<'system.ping', ClientPingPayload>;
export type AuthResumeEvent = WsEnvelope<'auth.resume', AuthResumePayload>;
export type MatchmakingStartEvent = WsEnvelope<'matchmaking.start', MatchmakingStartPayload>;
export type MatchmakingCancelEvent = WsEnvelope<'matchmaking.cancel', MatchmakingCancelPayload>;
export type RoomCreateEvent = WsEnvelope<'room.create', RoomCreatePayload>;
export type RoomJoinEvent = WsEnvelope<'room.join', RoomJoinPayload>;
export type RoomLeaveEvent = WsEnvelope<'room.leave', RoomLeavePayload>;
export type RoomReadySetEvent = WsEnvelope<'room.ready.set', RoomReadySetPayload>;
export type RoomTeamSetEvent = WsEnvelope<'room.team.set', RoomTeamSetPayload>;
export type RoomKickEvent = WsEnvelope<'room.kick', RoomKickPayload>;
export type RoomInviteAcceptEvent = WsEnvelope<'room.invite.accept', RoomInviteAcceptPayload>;
export type GameInputEvent = WsEnvelope<'game.input', GameInputPayload>;

export type ServerWelcomeEvent = WsEnvelope<'system.welcome', ServerWelcomePayload>;
export type ServerPongEvent = WsEnvelope<'system.pong', ServerPongPayload>;
export type ServerErrorEvent = WsEnvelope<'system.error', WsErrorPayload>;
export type AuthOkEvent = WsEnvelope<'auth.ok', AuthOkPayload>;
export type AuthExpiredEvent = WsEnvelope<'auth.expired', AuthExpiredPayload>;
export type MatchmakingProgressEvent = WsEnvelope<'matchmaking.progress', MatchmakingProgressPayload>;
export type MatchmakingFoundEvent = WsEnvelope<'matchmaking.found', MatchmakingFoundPayload>;
export type MatchmakingCancelledEvent = WsEnvelope<'matchmaking.cancelled', MatchmakingCancelledPayload>;
export type RoomStateEvent = WsEnvelope<'room.state', RoomStatePayload>;
export type RoomClosedEvent = WsEnvelope<'room.closed', RoomClosedPayload>;
export type RoomErrorEvent = WsEnvelope<'room.error', RoomErrorPayload>;
export type GameSnapshotEvent = WsEnvelope<'game.snapshot', GameSnapshotPayload>;
export type GameEvent = WsEnvelope<'game.event', GameEventPayload>;
export type SocialNoticeEvent = WsEnvelope<'social.notice', SocialNoticePayload>;

export type ClientEvent =
  | ClientHelloEvent
  | ClientPingEvent
  | AuthResumeEvent
  | MatchmakingStartEvent
  | MatchmakingCancelEvent
  | RoomCreateEvent
  | RoomJoinEvent
  | RoomLeaveEvent
  | RoomReadySetEvent
  | RoomTeamSetEvent
  | RoomKickEvent
  | RoomInviteAcceptEvent
  | GameInputEvent;

export type ServerEvent =
  | ServerWelcomeEvent
  | ServerPongEvent
  | ServerErrorEvent
  | AuthOkEvent
  | AuthExpiredEvent
  | MatchmakingProgressEvent
  | MatchmakingFoundEvent
  | MatchmakingCancelledEvent
  | RoomStateEvent
  | RoomClosedEvent
  | RoomErrorEvent
  | GameSnapshotEvent
  | GameEvent
  | SocialNoticeEvent;

export function createWsEnvelope<TType extends string, TPayload>(
  type: TType,
  payload: TPayload,
  id: string,
  traceId?: string
): WsEnvelope<TType, TPayload> {
  return {
    v: WS_PROTOCOL_VERSION,
    id,
    type,
    ts: Date.now(),
    traceId,
    payload
  };
}

export function isWsEnvelope(value: unknown): value is WsEnvelope {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<WsEnvelope>;
  return (
    candidate.v === WS_PROTOCOL_VERSION &&
    typeof candidate.id === 'string' &&
    typeof candidate.type === 'string' &&
    typeof candidate.ts === 'number' &&
    'payload' in candidate
  );
}
