import type { DeveloperToolKey, RestrictedFeatureKey, UserRole } from "./auth.js";

export interface DeveloperToolboxConfig {
  enabled: boolean;
  toolKeys: DeveloperToolKey[];
  managedByUserId: string | null;
}

export interface UserPlaytimePolicy {
  requiredSeconds: number;
  accumulatedSeconds: number;
  remainingSeconds: number;
  canExitMatch: boolean;
  activeSessionId: string | null;
  lastHeartbeatAt: string | null;
  unlockedFeatureKeys: RestrictedFeatureKey[];
  pendingFeatureKeys: RestrictedFeatureKey[];
}

export interface UserAuthorization {
  role: UserRole;
  isDeveloper: boolean;
  managedByDeveloperToolbox: boolean;
  developerToolbox: DeveloperToolboxConfig;
  playtimePolicy: UserPlaytimePolicy;
}

export interface StartPlaytimeSessionRequest {
  matchId?: string;
  modeId?: string;
}

export interface StartPlaytimeSessionResponse {
  authorization: UserAuthorization;
  serverTime: string;
}

export interface HeartbeatPlaytimeSessionRequest {
  playSessionId: string;
  matchId?: string;
  modeId?: string;
}

export interface HeartbeatPlaytimeSessionResponse {
  authorization: UserAuthorization;
  deltaSeconds: number;
  serverTime: string;
}

export interface FinishPlaytimeSessionRequest {
  playSessionId: string;
  matchId?: string;
  modeId?: string;
  reason?: "completed" | "user_exit" | "disconnect" | "server_shutdown";
}

export interface FinishPlaytimeSessionResponse {
  authorization: UserAuthorization;
  deltaSeconds: number;
  serverTime: string;
}

export interface CheckFeatureAccessRequest {
  featureKey: RestrictedFeatureKey;
}

export interface CheckFeatureAccessResponse {
  featureKey: RestrictedFeatureKey;
  allowed: boolean;
  authorization: UserAuthorization;
  serverTime: string;
}
