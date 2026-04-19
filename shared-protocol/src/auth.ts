export type LoginMethod =
  | 'password'
  | 'guest'
  | 'sms'
  | 'apple'
  | 'wechat'
  | 'platform';

export type DeveloperToolKey =
  | 'debug_console'
  | 'player_account_admin'
  | 'match_live_ops'
  | 'economy_tuning'
  | 'content_pipeline'
  | 'analytics_center';

export type RestrictedFeatureKey =
  | 'exit_match'
  | 'ranked_queue'
  | 'social_chat'
  | 'advanced_matchmaking';

/** User role — determines dev-tool access, game exit rules, and admin capabilities. */
export type UserRole = 'player' | 'developer' | 'admin' | 'super_admin';

/**
 * Developer account prefix.
 * Any account whose lowercased form starts with this prefix
 * will automatically be assigned the "developer" role on registration.
 */
export const DEVELOPER_ACCOUNT_PREFIX = 'dev_';

export type DevicePlatform = 'web' | 'android' | 'ios' | 'windows' | 'macos' | 'linux';

export interface DeviceInfo {
  deviceId: string;
  platform: DevicePlatform;
  appVersion: string;
  osVersion?: string;
  deviceModel?: string;
  ip?: string;
  userAgent?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
  tokenType: 'Bearer';
}

export interface AuthUser {
  userId: string;
  gameId: string;
  accountId: string;
  nickname: string;
  avatarUrl: string;
  banned: boolean;
  banReason?: string;
  banUntil?: string;
  role: UserRole;
  developerToolbox: {
    enabled: boolean;
    toolKeys: DeveloperToolKey[];
  };
  playtimePolicy: {
    requiredSeconds: number;
    accumulatedSeconds: number;
    remainingSeconds: number;
    canExitMatch: boolean;
    unlockedFeatureKeys: RestrictedFeatureKey[];
    pendingFeatureKeys: RestrictedFeatureKey[];
  };
  createdAt: string;
  updatedAt: string;
}

export interface LoginRiskMeta {
  riskLevel: 'low' | 'medium' | 'high';
  requiresVerification: boolean;
  reasonCodes: string[];
}

export interface RegisterByPasswordRequest {
  account: string;
  password: string;
  nickname?: string;
  registerAsDeveloper?: boolean;
  developerRegistrationCode?: string;
  email?: string;
  emailCode?: string;
  mobileCountryCode?: string;
  mobile?: string;
  mobileCode?: string;
  device?: DeviceInfo;
}

export interface RegisterByPasswordResponse {
  user: AuthUser;
  tokens: TokenPair;
  isNewUser: true;
}

export interface LoginByPasswordRequest {
  account: string;
  password: string;
  device?: DeviceInfo;
}

export interface LoginByGuestRequest {
  guestId: string;
  device?: DeviceInfo;
}

export interface LoginBySmsRequest {
  countryCode: string;
  mobile: string;
  code: string;
  device?: DeviceInfo;
}

export interface LoginByAppleRequest {
  identityToken: string;
  authorizationCode?: string;
  device?: DeviceInfo;
}

export interface LoginByWechatRequest {
  code: string;
  device?: DeviceInfo;
}

export interface LoginByPlatformRequest {
  provider: string;
  providerToken: string;
  device?: DeviceInfo;
}

export type LoginRequest =
  | { method: 'password'; payload: LoginByPasswordRequest }
  | { method: 'guest'; payload: LoginByGuestRequest }
  | { method: 'sms'; payload: LoginBySmsRequest }
  | { method: 'apple'; payload: LoginByAppleRequest }
  | { method: 'wechat'; payload: LoginByWechatRequest }
  | { method: 'platform'; payload: LoginByPlatformRequest };

export interface LoginResponse {
  user: AuthUser;
  tokens: TokenPair;
  method: LoginMethod;
  isNewUser: boolean;
  riskMeta?: LoginRiskMeta;
  serverTime: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
  device?: Pick<DeviceInfo, 'deviceId' | 'platform' | 'appVersion'>;
}

export interface RefreshTokenResponse {
  tokens: TokenPair;
  serverTime: string;
}

export interface LogoutRequest {
  refreshToken?: string;
  allDevices?: boolean;
}

export interface LogoutResponse {
  success: true;
  serverTime: string;
}

export type VerificationPurpose =
  | 'login'
  | 'register'
  | 'resetPassword'
  | 'bindMobile'
  | 'bindEmail';

export interface SendSmsCodeRequest {
  countryCode: string;
  mobile: string;
  purpose: VerificationPurpose;
}

export interface SendSmsCodeResponse {
  success: true;
  cooldownSeconds: number;
  serverTime: string;
}

export interface SendEmailCodeRequest {
  email: string;
  purpose: VerificationPurpose;
}

export interface SendEmailCodeResponse {
  success: true;
  cooldownSeconds: number;
  serverTime: string;
}

export interface RequestPasswordResetRequest {
  account: string;
  verifyBy: 'sms' | 'email';
}

export interface RequestPasswordResetResponse {
  success: true;
  challengeId: string;
  serverTime: string;
}

export interface ConfirmPasswordResetRequest {
  challengeId: string;
  verificationCode: string;
  newPassword: string;
}

export interface ConfirmPasswordResetResponse {
  success: true;
  serverTime: string;
}

export interface BindMobileRequest {
  countryCode: string;
  mobile: string;
  code: string;
}

export interface BindMobileResponse {
  success: true;
  mobileMasked: string;
  serverTime: string;
}

export interface BindEmailRequest {
  email: string;
  code: string;
}

export interface BindEmailResponse {
  success: true;
  emailMasked: string;
  serverTime: string;
}

export interface DeviceSession {
  sessionId: string;
  deviceId: string;
  platform: DevicePlatform;
  appVersion: string;
  ip?: string;
  userAgent?: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface ListDeviceSessionsResponse {
  sessions: DeviceSession[];
  serverTime: string;
}

export interface RevokeDeviceSessionRequest {
  sessionId: string;
}

export interface RevokeDeviceSessionResponse {
  success: true;
  serverTime: string;
}
