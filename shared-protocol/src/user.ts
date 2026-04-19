import type { PlayerProgression } from "./progression.js";

import type { UserAuthorization } from "./access.js";
import type { UserRole } from "./auth.js";

export type UserId = string;
export type DeviceId = string;
export type ISODateTimeString = string;

export type UserStatus = 'active' | 'banned' | 'deleted';
export type AccountProvider =
  | 'guest'
  | 'password'
  | 'phone'
  | 'apple'
  | 'wechat'
  | 'platform';

export interface UserBase {
  id: UserId;
  gameId: string;
  status: UserStatus;
  role: UserRole;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
  lastLoginAt: ISODateTimeString | null;
}

export interface UserIdentity {
  provider: AccountProvider;
  providerUid: string;
  email?: string | null;
  phone?: string | null;
  username?: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  boundAt: ISODateTimeString;
}

export interface UserBanInfo {
  isBanned: boolean;
  reason: string | null;
  until: ISODateTimeString | null;
}

export interface UserProfile {
  userId: UserId;
  nickname: string;
  avatarUrl: string | null;
  level: number;
  currentXp: number;
  totalXp: number;
  coins: number;
  seasonScore: number;
  bestMass: number;
  totalMatches: number;
  totalWins: number;
  updatedAt: ISODateTimeString;
}

export interface UserSkinOwnership {
  userId: UserId;
  skinId: string;
  owned: boolean;
  equipped: boolean;
  acquiredAt: ISODateTimeString | null;
}

export interface UserInventoryItem {
  userId: UserId;
  itemId: string;
  quantity: number;
  expiresAt: ISODateTimeString | null;
  updatedAt: ISODateTimeString;
}

export interface UserSessionDevice {
  userId: UserId;
  deviceId: DeviceId;
  deviceName: string;
  platform: 'android' | 'ios' | 'web' | 'unknown';
  appVersion: string | null;
  ip: string | null;
  lastSeenAt: ISODateTimeString;
  createdAt: ISODateTimeString;
}

export interface UserSummary {
  user: UserBase;
  profile: UserProfile;
  ban: UserBanInfo;
  identities: UserIdentity[];
  authorization: UserAuthorization;
}

export interface PublicUserCard {
  userId: UserId;
  gameId: string;
  nickname: string;
  avatarUrl: string | null;
  level: number;
  bestMass: number;
  seasonScore: number;
}

export interface DeveloperAccountDigest {
  userId: UserId;
  gameId: string;
  nickname: string;
  account: string | null;
  provider: AccountProvider;
  status: UserStatus;
  level: number;
  bestMass: number;
  totalMatches: number;
  createdAt: ISODateTimeString;
  lastLoginAt: ISODateTimeString | null;
}

export interface DeveloperAccountStats {
  totalAccounts: number;
  activeAccounts: number;
  passwordAccounts: number;
  recentLoginCount24h: number;
}

export interface DeveloperAccountsOverview {
  stats: DeveloperAccountStats;
  currentAccount: DeveloperAccountDigest | null;
  recentAccounts: DeveloperAccountDigest[];
}

export interface UpdateProfileRequest {
  nickname?: string;
  avatarUrl?: string | null;
}

export interface UpdateProfileResponse {
  profile: UserProfile;
}

export interface GetMeResponse {
  summary: UserSummary;
}

export interface GetPublicUserResponse {
  user: PublicUserCard;
}

export interface GetDeveloperAccountsOverviewResponse {
  overview: DeveloperAccountsOverview;
}

export interface UserBootstrapRequest {
  nickname?: string;
  avatarUrl?: string | null;
  progression?: Partial<PlayerProgression>;
  source: 'local_storage';
}

export interface UserBootstrapResponse {
  summary: UserSummary;
  migrationApplied: boolean;
}
