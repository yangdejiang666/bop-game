/// bop/shared-protocol/src/admin.ts
/// Admin / management panel protocol types
/// Covers: RBAC, user management, bans, audit logs, security events, approvals

import type { UserId } from "./user.js";

// =========================================================
// Role & Permission types (extends existing UserRole)
// =========================================================

/** Extended role including admin tiers */
export type AdminRole = 'player' | 'developer' | 'admin' | 'super_admin';

/** All defined permission keys for RBAC */
export type AdminPermissionKey =
  | 'user:view'
  | 'user:edit'
  | 'user:ban'
  | 'user:batch_export'
  | 'content:manage'
  | 'match:view'
  | 'admin:manage'
  | 'system:config'
  | 'audit:log'
  | 'data:export'
  | 'developer:grant';

/** Permission definition row */
export interface AdminPermission {
  role: 'admin' | 'super_admin';
  permissionKey: AdminPermissionKey;
  description: string;
}

// =========================================================
// Dashboard / Stats
// =========================================================

export interface AdminDashboardStats {
  totalUsers: number;
  activeUsers24h: number;
  newRegistrations24h: number;
  activeBans: number;
  pendingApprovals: number;
  onlineCount: number;           // real-time via SSE/WebSocket
}

// =========================================================
// User Management — List & Detail
// =========================================================

export type UserListSortField = 'createdAt' | 'lastLoginAt' | 'nickname' | 'level' | 'coins' | 'bestMass';
export type SortOrder = 'asc' | 'desc';
export type UserStatusFilter = 'active' | 'banned' | 'deleted' | 'all';
export type RoleFilter = AdminRole | 'all';

export interface AdminUserListQuery {
  page?: number;                 // default 1
  size?: number;                 // default 20, max 100
  status?: UserStatusFilter;
  role?: RoleFilter;
  q?: string;                    // search keyword (matches nickname/account/email/phone/gameId)
  sortField?: UserListSortField;
  sortOrder?: SortOrder;
  registeredAfter?: string;      // ISO datetime
  registeredBefore?: string;     // ISO datetime
}

export interface AdminUserListItem {
  userId: UserId;
  gameId: string;
  nickname: string;
  avatarUrl: string | null;
  account: string | null;        // masked if caller lacks permission
  email: string | null;          // masked
  phone: string | null;          // masked
  role: AdminRole;
  status: UserStatusFilter;
  level: number;
  coins: number;
  bestMass: number;
  totalMatches: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminUserListResponse {
  items: AdminUserListItem[];
  total: number;
  page: number;
  size: number;
  totalPages: number;
}

/** Full user detail — aggregated across multiple tables for admin view */
export interface AdminUserDetail {
  // --- Base ---
  user: {
    id: UserId;
    gameId: string;
    status: UserStatusFilter;
    role: AdminRole;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
    deletedReason: string | null;
  };

  // --- Profile ---
  profile: {
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
  };

  // --- Identities ---
  identities: Array<{
    provider: string;
    providerUid: string;
    account: string | null;
    email: string | null;         // clear text for admin
    phone: string | null;         // clear text for admin
    emailVerified: boolean;
    phoneVerified: boolean;
    boundAt: string;
  }>;

  // --- Ban info ---
  ban: {
    isBanned: boolean;
    reason: string | null;
    bannedUntil: string | null;
    bannedBy: string | null;     // admin userId who banned
    operatorNote: string | null;
    createdAt: string | null;
  };

  // --- Sessions ---
  sessions: Array<{
    sessionId: string;
    deviceId: string;
    deviceName: string | null;
    platform: string;
    ip: string | null;
    countryCode: string | null;
    cityName: string | null;
    riskScore: number;
    lastSeenAt: string;
    createdAt: string;
    isActive: boolean;
  }>;

  // --- Login history (recent) ---
  loginHistory: Array<{
    eventType: string;
    ip: string | null;
    deviceId: string | null;
    userAgent: string | null;
    country: string | null;
    severity: number;
    details: Record<string, unknown> | null;
    createdAt: string;
  }>;
}

export interface AdminGetUserResponse {
  user: AdminUserDetail;
}

/** Fields editable by admin */
export interface AdminEditProfileRequest {
  nickname?: string;
  avatarUrl?: string | null;
  role?: AdminRole;               // super_admin only
}

export interface AdminCreateUserRequest {
  account: string;
  password: string;
  nickname: string;
  email?: string;
  phone?: string;
  role?: AdminRole;               // defaults to 'player'
}

// =========================================================
// Ban Management
// =========================================================

export type BanDurationType = '1h' | '6h' | '24h' | '7d' | '30d' | 'permanent' | 'custom';

export interface AdminBanRequest {
  reason: string;                 // required
  duration: BanDurationType;
  customDurationMinutes?: number; // only when duration='custom', max 525600 (1 year)
  note?: string;                  // internal operator note
}

export interface AdminBanResponse {
  bannedUntil: string | null;     // ISO datetime, null = permanent
}

export interface AdminUnbanRequest {
  reason?: string;                // reason for unbanning
}

export interface AdminBanRecord {
  banId: string;
  userId: UserId;
  isBanned: boolean;
  reason: string | null;
  bannedBy: string | null;        // admin nickname or userId
  bannedUntil: string | null;
  operatorNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminBanListQuery {
  status?: 'active' | 'expired' | 'all';
  page?: number;
  size?: number;
}

export interface AdminBanListResponse {
  items: AdminBanRecord[];
  total: number;
  page: number;
  size: number;
}

// =========================================================
// Session Management
// =========================================================

export interface AdminKickSessionResponse {
  kicked: boolean;
}

export interface AdminKickAllSessionsResponse {
  revokedCount: number;
}

// =========================================================
// Password Reset (admin-forced)
// =========================================================

export interface AdminResetPasswordResponse {
  temporaryPassword: string;       // one-time temporary password (shown once!)
  expiresAt: string;
}

// =========================================================
// Audit Logs
// =========================================================

export type AuditTargetType = 'user' | 'ban' | 'role' | 'config' | 'system' | 'session' | 'permission';

export interface AuditLogListQuery {
  actorUserId?: UserId;
  targetId?: UserId;
  targetType?: AuditTargetType;
  action?: string;                // prefix match, e.g. 'user.ban'
  from?: string;                  // ISO datetime
  to?: string;                    // ISO datetime
  page?: number;
  size?: number;
}

export interface AuditLogEntry {
  logId: number;                  // BIGSERIAL
  traceId: string;
  actorUserId: UserId | null;
  actorRole: AdminRole | null;
  actorIp: string | null;
  targetType: AuditTargetType;
  targetId: UserId | null;
  action: string;
  method: string | null;
  path: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  changesOnly: Record<string, { old: unknown; new: unknown }> | null;
  reason: string | null;
  createdAt: string;
}

export interface AuditLogListResponse {
  items: AuditLogEntry[];
  total: number;
  page: number;
  size: number;
}

// =========================================================
// Security Events (read-only for admins)
// =========================================================

export interface SecurityEventListQuery {
  userId?: UserId;
  eventType?: string;
  severity?: number;
  ip?: string;
  from?: string;
  to?: string;
  page?: number;
  size?: number;
}

export interface SecurityEventEntry {
  eventId: string;
  userId: UserId | null;
  eventType: string;
  identityProvider: string | null;
  deviceId: string | null;
  ip: string | null;
  userAgent: string | null;
  countryCode: string | null;
  details: Record<string, unknown> | null;
  severity: number;
  createdAt: string;
}

export interface SecurityEventListResponse {
  items: SecurityEventEntry[];
  total: number;
  page: number;
  size: number;
}

// =========================================================
// Approval / Operation Tickets
// =========================================================

export type TicketOperationType = 'mass_ban' | 'data_export' | 'role_change' | 'config_update';
export type TicketStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'expired' | 'cancelled';

export interface CreateApprovalTicketRequest {
  operationType: TicketOperationType;
  payload: Record<string, unknown>;   // operation-specific params
  expiresInHours?: number;            // default 24
}

export interface ApprovalTicketItem {
  ticketId: string;
  operationType: TicketOperationType;
  status: TicketStatus;
  requesterId: UserId;
  requesterNickname: string;
  requestedAt: string;
  reviewerId: UserId | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  payload: Record<string, unknown>;
  executedAt: string | null;
  executionResult: Record<string, unknown> | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalTicketListQuery {
  status?: TicketStatus;
  requesterId?: UserId;
  page?: number;
  size?: number;
}

export interface ApprovalTicketListResponse {
  items: ApprovalTicketItem[];
  total: number;
  page: number;
  size: number;
}

export interface ApproveTicketRequest {
  reviewNote?: string;
}

export interface RejectTicketRequest {
  reviewNote?: string;
}

// =========================================================
// Data Export (async)
// =========================================================

export interface CreateUserExportRequest {
  format?: 'csv' | 'json';          // default 'csv'
  fields?: string[];                 // specific fields to include (default all non-sensitive)
  filters?: AdminUserListQuery;      // same filter as list endpoint
}

export interface ExportTaskStatus {
  taskId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  downloadUrl?: string | null;
  recordCount?: number | null;
  fileSizeBytes?: number | null;
  error?: string | null;
  createdAt: string;
  completedAt?: string | null;
}
