// @ts-nocheck
import type {
  AuthUser,
  DeviceInfo,
  LoginMethod,
  MatchmakingTicketState,
  QueueModeId,
  RoomMemberSnapshot,
  RoomSnapshot,
  RoomTeamMode,
  RoomVisibility,
  TokenPair,
  UserProfile,
} from "@bop/shared-protocol";

type ISODateTimeString = string;

interface UserRecord {
  userId: string;
  account: string;
  passwordHash: string;
  providers: Set<LoginMethod>;
  banned: boolean;
  banReason: string | null;
  banUntil: ISODateTimeString | null;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
  lastLoginAt: ISODateTimeString | null;
}

interface UserIndex {
  byUserId: Map<string, UserRecord>;
  byAccount: Map<string, string>; // account -> userId
}

interface ProfileIndex {
  byUserId: Map<string, UserProfile>;
}

interface AccessTokenRecord {
  accessToken: string;
  userId: string;
  expiresAt: number;
  issuedAt: number;
  sessionId: string;
  deviceId: string;
}

interface RefreshTokenRecord {
  refreshToken: string;
  userId: string;
  expiresAt: number;
  issuedAt: number;
  revokedAt: number | null;
  sessionId: string;
  deviceId: string;
}

interface SessionRecord {
  sessionId: string;
  userId: string;
  deviceId: string;
  platform: string;
  appVersion: string;
  ip?: string;
  userAgent?: string;
  createdAt: ISODateTimeString;
  lastSeenAt: ISODateTimeString;
  revokedAt: ISODateTimeString | null;
}

interface TokenIndex {
  accessByToken: Map<string, AccessTokenRecord>;
  refreshByToken: Map<string, RefreshTokenRecord>;
  sessionsById: Map<string, SessionRecord>;
  sessionIdsByUser: Map<string, Set<string>>;
}

interface QueueTicketRecord extends MatchmakingTicketState {
  cancelled: boolean;
}

interface QueueIndex {
  ticketsById: Map<string, QueueTicketRecord>;
  ticketIdsByUser: Map<string, Set<string>>;
  queuesByMode: Map<QueueModeId, Set<string>>;
}

interface RoomRecord extends RoomSnapshot {}

interface RoomIndex {
  roomsById: Map<string, RoomRecord>;
  roomIdByInviteCode: Map<string, string>;
  roomIdByUserId: Map<string, string>;
}

const ACCESS_TOKEN_TTL_SEC = 60 * 15;
const REFRESH_TOKEN_TTL_SEC = 60 * 60 * 24 * 30;
const DEFAULT_AVATAR = "";
const DEFAULT_MODE: QueueModeId = "classic";

function nowIso(): ISODateTimeString {
  return new Date().toISOString();
}

function randomId(prefix: string): string {
  const body = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${body}`;
}

function hashPassword(password: string): string {
  // NOTE: in-memory demo hash only. Replace with argon2/bcrypt in production.
  const base = Buffer.from(password, "utf8").toString("base64");
  return `demo$${base}`;
}

function verifyPassword(password: string, hashed: string): boolean {
  return hashPassword(password) === hashed;
}

function sanitizeNickname(
  input: string | undefined,
  fallback = "未命名玩家",
): string {
  const next = (input ?? "").trim().slice(0, 16);
  return next.length > 0 ? next : fallback;
}

function createDefaultProfile(userId: string, nickname: string): UserProfile {
  return {
    userId,
    nickname,
    avatarUrl: DEFAULT_AVATAR,
    level: 1,
    currentXp: 0,
    totalXp: 0,
    coins: 0,
    seasonScore: 0,
    bestMass: 0,
    totalMatches: 0,
    totalWins: 0,
    updatedAt: nowIso(),
  };
}

function toAuthUser(user: UserRecord, profile: UserProfile): AuthUser {
  return {
    userId: user.userId,
    accountId: user.account,
    nickname: profile.nickname,
    avatarUrl: profile.avatarUrl ?? "",
    banned: user.banned,
    banReason: user.banReason ?? undefined,
    banUntil: user.banUntil ?? undefined,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function createTokenPair(): TokenPair {
  return {
    accessToken: randomId("atk"),
    refreshToken: randomId("rtk"),
    expiresIn: ACCESS_TOKEN_TTL_SEC,
    refreshExpiresIn: REFRESH_TOKEN_TTL_SEC,
    tokenType: "Bearer",
  };
}

function ensureSetMap<K>(map: Map<K, Set<string>>, key: K): Set<string> {
  const found = map.get(key);
  if (found) {
    return found;
  }
  const next = new Set<string>();
  map.set(key, next);
  return next;
}

function makeInviteCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export class InMemoryStore {
  private readonly users: UserIndex = {
    byUserId: new Map(),
    byAccount: new Map(),
  };

  private readonly profiles: ProfileIndex = {
    byUserId: new Map(),
  };

  private readonly tokens: TokenIndex = {
    accessByToken: new Map(),
    refreshByToken: new Map(),
    sessionsById: new Map(),
    sessionIdsByUser: new Map(),
  };

  private readonly queue: QueueIndex = {
    ticketsById: new Map(),
    ticketIdsByUser: new Map(),
    queuesByMode: new Map<QueueModeId, Set<string>>([
      ["ranked", new Set()],
      ["peak", new Set()],
      ["classic", new Set()],
      ["speed", new Set()],
      ["team", new Set()],
      ["battleRoyale", new Set()],
    ]),
  };

  private readonly rooms: RoomIndex = {
    roomsById: new Map(),
    roomIdByInviteCode: new Map(),
    roomIdByUserId: new Map(),
  };

  constructor() {
    this.seedDemoUser();
  }

  // -----------------------------
  // User / Profile
  // -----------------------------

  registerByPassword(
    account: string,
    password: string,
    nickname?: string,
  ): {
    user: AuthUser;
    profile: UserProfile;
  } {
    const normalized = account.trim().toLowerCase();
    if (!normalized) {
      throw new Error("account is required");
    }
    if (this.users.byAccount.has(normalized)) {
      throw new Error("account already exists");
    }

    const userId = randomId("usr");
    const createdAt = nowIso();

    const user: UserRecord = {
      userId,
      account: normalized,
      passwordHash: hashPassword(password),
      providers: new Set<LoginMethod>(["password"]),
      banned: false,
      banReason: null,
      banUntil: null,
      createdAt,
      updatedAt: createdAt,
      lastLoginAt: null,
    };

    const profile = createDefaultProfile(
      userId,
      sanitizeNickname(nickname, "勇者球球"),
    );

    this.users.byUserId.set(userId, user);
    this.users.byAccount.set(normalized, userId);
    this.profiles.byUserId.set(userId, profile);

    return {
      user: toAuthUser(user, profile),
      profile,
    };
  }

  loginByPassword(
    account: string,
    password: string,
  ): {
    user: AuthUser;
    profile: UserProfile;
  } {
    const normalized = account.trim().toLowerCase();
    const userId = this.users.byAccount.get(normalized);
    if (!userId) {
      throw new Error("invalid credentials");
    }
    const user = this.users.byUserId.get(userId);
    const profile = this.profiles.byUserId.get(userId);
    if (!user || !profile) {
      throw new Error("user data is corrupted");
    }
    if (!verifyPassword(password, user.passwordHash)) {
      throw new Error("invalid credentials");
    }

    user.lastLoginAt = nowIso();
    user.updatedAt = nowIso();

    return {
      user: toAuthUser(user, profile),
      profile,
    };
  }

  loginAsGuest(guestId: string): {
    user: AuthUser;
    profile: UserProfile;
    isNewUser: boolean;
  } {
    const normalized = `guest:${guestId.trim().toLowerCase() || randomId("g")}`;
    const foundUserId = this.users.byAccount.get(normalized);

    if (foundUserId) {
      const user = this.users.byUserId.get(foundUserId)!;
      const profile = this.profiles.byUserId.get(foundUserId)!;
      user.lastLoginAt = nowIso();
      user.updatedAt = nowIso();
      return {
        user: toAuthUser(user, profile),
        profile,
        isNewUser: false,
      };
    }

    const userId = randomId("usr");
    const createdAt = nowIso();

    const user: UserRecord = {
      userId,
      account: normalized,
      passwordHash: hashPassword(randomId("guest_pwd")),
      providers: new Set<LoginMethod>(["guest"]),
      banned: false,
      banReason: null,
      banUntil: null,
      createdAt,
      updatedAt: createdAt,
      lastLoginAt: createdAt,
    };

    const profile = createDefaultProfile(userId, "游客玩家");
    this.users.byUserId.set(userId, user);
    this.users.byAccount.set(normalized, userId);
    this.profiles.byUserId.set(userId, profile);

    return {
      user: toAuthUser(user, profile),
      profile,
      isNewUser: true,
    };
  }

  getUserProfile(userId: string): UserProfile | null {
    return this.profiles.byUserId.get(userId) ?? null;
  }

  updateUserProfile(
    userId: string,
    patch: Partial<Pick<UserProfile, "nickname" | "avatarUrl">>,
  ): UserProfile {
    const profile = this.profiles.byUserId.get(userId);
    if (!profile) {
      throw new Error("profile not found");
    }

    if (typeof patch.nickname === "string") {
      profile.nickname = sanitizeNickname(patch.nickname, profile.nickname);
    }
    if (patch.avatarUrl !== undefined) {
      profile.avatarUrl = patch.avatarUrl;
    }
    profile.updatedAt = nowIso();

    return profile;
  }

  // -----------------------------
  // Tokens / Sessions
  // -----------------------------

  issueTokenPair(
    userId: string,
    device?: DeviceInfo,
  ): {
    tokens: TokenPair;
    sessionId: string;
  } {
    const user = this.users.byUserId.get(userId);
    if (!user) {
      throw new Error("user not found");
    }

    const pair = createTokenPair();
    const now = Date.now();

    const sessionId = randomId("sess");
    const session: SessionRecord = {
      sessionId,
      userId,
      deviceId: device?.deviceId ?? "unknown-device",
      platform: device?.platform ?? "web",
      appVersion: device?.appVersion ?? "0.0.0",
      ip: device?.ip,
      userAgent: device?.userAgent,
      createdAt: nowIso(),
      lastSeenAt: nowIso(),
      revokedAt: null,
    };

    this.tokens.sessionsById.set(sessionId, session);
    ensureSetMap(this.tokens.sessionIdsByUser, userId).add(sessionId);

    const accessRecord: AccessTokenRecord = {
      accessToken: pair.accessToken,
      userId,
      sessionId,
      deviceId: session.deviceId,
      issuedAt: now,
      expiresAt: now + pair.expiresIn * 1000,
    };
    this.tokens.accessByToken.set(pair.accessToken, accessRecord);

    const refreshRecord: RefreshTokenRecord = {
      refreshToken: pair.refreshToken,
      userId,
      sessionId,
      deviceId: session.deviceId,
      issuedAt: now,
      expiresAt: now + pair.refreshExpiresIn * 1000,
      revokedAt: null,
    };
    this.tokens.refreshByToken.set(pair.refreshToken, refreshRecord);

    return {
      tokens: pair,
      sessionId,
    };
  }

  verifyAccessToken(accessToken: string): {
    userId: string;
    sessionId: string;
  } | null {
    const token = this.tokens.accessByToken.get(accessToken);
    if (!token) {
      return null;
    }
    if (token.expiresAt <= Date.now()) {
      this.tokens.accessByToken.delete(accessToken);
      return null;
    }

    const session = this.tokens.sessionsById.get(token.sessionId);
    if (!session || session.revokedAt) {
      return null;
    }
    session.lastSeenAt = nowIso();

    return {
      userId: token.userId,
      sessionId: token.sessionId,
    };
  }

  refreshTokenPair(
    refreshToken: string,
    device?: Pick<DeviceInfo, "deviceId">,
  ): TokenPair | null {
    const record = this.tokens.refreshByToken.get(refreshToken);
    if (!record || record.revokedAt || record.expiresAt <= Date.now()) {
      return null;
    }

    if (device?.deviceId && device.deviceId !== record.deviceId) {
      return null;
    }

    // rotate refresh token
    record.revokedAt = Date.now();

    // revoke old access tokens in same session
    for (const [token, access] of this.tokens.accessByToken.entries()) {
      if (access.sessionId === record.sessionId) {
        this.tokens.accessByToken.delete(token);
      }
    }

    const pair = createTokenPair();
    const now = Date.now();

    const newAccess: AccessTokenRecord = {
      accessToken: pair.accessToken,
      userId: record.userId,
      sessionId: record.sessionId,
      deviceId: record.deviceId,
      issuedAt: now,
      expiresAt: now + pair.expiresIn * 1000,
    };
    this.tokens.accessByToken.set(pair.accessToken, newAccess);

    const newRefresh: RefreshTokenRecord = {
      refreshToken: pair.refreshToken,
      userId: record.userId,
      sessionId: record.sessionId,
      deviceId: record.deviceId,
      issuedAt: now,
      expiresAt: now + pair.refreshExpiresIn * 1000,
      revokedAt: null,
    };
    this.tokens.refreshByToken.set(pair.refreshToken, newRefresh);

    return pair;
  }

  revokeSessionByRefreshToken(refreshToken: string): boolean {
    const record = this.tokens.refreshByToken.get(refreshToken);
    if (!record) {
      return false;
    }
    this.revokeSession(record.sessionId);
    return true;
  }

  revokeAllSessions(userId: string): number {
    const sessionIds = this.tokens.sessionIdsByUser.get(userId);
    if (!sessionIds) {
      return 0;
    }

    let count = 0;
    for (const sessionId of sessionIds) {
      this.revokeSession(sessionId);
      count += 1;
    }
    return count;
  }

  private revokeSession(sessionId: string): void {
    const session = this.tokens.sessionsById.get(sessionId);
    if (!session) {
      return;
    }
    session.revokedAt = nowIso();

    for (const [token, access] of this.tokens.accessByToken.entries()) {
      if (access.sessionId === sessionId) {
        this.tokens.accessByToken.delete(token);
      }
    }

    for (const refresh of this.tokens.refreshByToken.values()) {
      if (refresh.sessionId === sessionId && !refresh.revokedAt) {
        refresh.revokedAt = Date.now();
      }
    }
  }

  // -----------------------------
  // Matchmaking Queue
  // -----------------------------

  startQueue(
    userId: string,
    modeId: QueueModeId = DEFAULT_MODE,
  ): MatchmakingTicketState {
    const existingIds = this.queue.ticketIdsByUser.get(userId);
    if (existingIds && existingIds.size > 0) {
      // return first active ticket if exists
      for (const tid of existingIds) {
        const ticket = this.queue.ticketsById.get(tid);
        if (
          ticket &&
          !ticket.cancelled &&
          (ticket.stage === "searching" || ticket.stage === "confirming")
        ) {
          return ticket;
        }
      }
    }

    const ticketId = randomId("mm");
    const now = nowIso();

    const ticket: QueueTicketRecord = {
      ticketId,
      userId,
      modeId,
      stage: "searching",
      queuedAt: now,
      updatedAt: now,
      estimatedWaitSeconds: 6,
      currentPlayers: 1,
      targetPlayers: 50,
      minStartPlayers: 12,
      region: "auto",
      cancelled: false,
    };

    this.queue.ticketsById.set(ticketId, ticket);
    ensureSetMap(this.queue.ticketIdsByUser, userId).add(ticketId);
    ensureSetMap(
      this.queue.queuesByMode as Map<QueueModeId, Set<string>>,
      modeId,
    ).add(ticketId);

    return ticket;
  }

  cancelQueue(userId: string, ticketId: string): MatchmakingTicketState | null {
    const ticket = this.queue.ticketsById.get(ticketId);
    if (!ticket || ticket.userId !== userId) {
      return null;
    }

    ticket.stage = "cancelled";
    ticket.updatedAt = nowIso();
    ticket.cancelled = true;

    this.queue.queuesByMode.get(ticket.modeId)?.delete(ticketId);

    return ticket;
  }

  getQueueTicket(ticketId: string): MatchmakingTicketState | null {
    return this.queue.ticketsById.get(ticketId) ?? null;
  }

  listUserQueueTickets(userId: string): MatchmakingTicketState[] {
    const ids = this.queue.ticketIdsByUser.get(userId);
    if (!ids) {
      return [];
    }
    const out: MatchmakingTicketState[] = [];
    for (const id of ids) {
      const ticket = this.queue.ticketsById.get(id);
      if (ticket) {
        out.push(ticket);
      }
    }
    return out;
  }

  // -----------------------------
  // Rooms
  // -----------------------------

  createRoom(params: {
    ownerUserId: string;
    ownerNickname: string;
    modeId: string;
    visibility?: RoomVisibility;
    teamMode?: RoomTeamMode;
    maxMembers?: number;
    minStartMembers?: number;
  }): RoomSnapshot {
    if (this.rooms.roomIdByUserId.has(params.ownerUserId)) {
      throw new Error("owner already in room");
    }

    const roomId = randomId("room");
    let inviteCode: string | null = null;
    if ((params.visibility ?? "private") === "private") {
      do {
        inviteCode = makeInviteCode();
      } while (this.rooms.roomIdByInviteCode.has(inviteCode));
    }

    const ownerMember: RoomMemberSnapshot = {
      userId: params.ownerUserId,
      nickname: sanitizeNickname(params.ownerNickname, "房主"),
      avatarUrl: "",
      ready: false,
      role: "owner",
      teamId: params.teamMode === "team" ? 1 : null,
      joinedAt: nowIso(),
      isOnline: true,
    };

    const room: RoomRecord = {
      roomId,
      modeId: params.modeId,
      visibility: params.visibility ?? "private",
      inviteCode,
      ownerUserId: params.ownerUserId,
      status: "idle",
      teamMode: params.teamMode ?? "solo",
      maxMembers: Math.max(2, Math.min(params.maxMembers ?? 4, 50)),
      minStartMembers: Math.max(1, Math.min(params.minStartMembers ?? 2, 50)),
      members: [ownerMember],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      version: 1,
    };

    this.rooms.roomsById.set(roomId, room);
    if (inviteCode) {
      this.rooms.roomIdByInviteCode.set(inviteCode, roomId);
    }
    this.rooms.roomIdByUserId.set(ownerMember.userId, roomId);

    return room;
  }

  joinRoom(params: {
    userId: string;
    nickname: string;
    roomId?: string;
    inviteCode?: string;
  }): RoomSnapshot {
    let roomId = params.roomId;
    if (!roomId && params.inviteCode) {
      roomId = this.rooms.roomIdByInviteCode.get(
        params.inviteCode.toUpperCase(),
      );
    }
    if (!roomId) {
      throw new Error("room target missing");
    }

    const room = this.rooms.roomsById.get(roomId);
    if (!room) {
      throw new Error("room not found");
    }
    if (this.rooms.roomIdByUserId.has(params.userId)) {
      throw new Error("user already in a room");
    }
    if (room.members.length >= room.maxMembers) {
      throw new Error("room full");
    }

    const exists = room.members.some((m) => m.userId === params.userId);
    if (exists) {
      return room;
    }

    room.members.push({
      userId: params.userId,
      nickname: sanitizeNickname(params.nickname, "玩家"),
      avatarUrl: "",
      ready: false,
      role: "member",
      teamId:
        room.teamMode === "team"
          ? room.members.length % 2 === 0
            ? 1
            : 2
          : null,
      joinedAt: nowIso(),
      isOnline: true,
    });
    room.updatedAt = nowIso();
    room.version += 1;

    this.rooms.roomIdByUserId.set(params.userId, room.roomId);

    return room;
  }

  leaveRoom(
    userId: string,
    roomId: string,
  ): {
    roomClosed: boolean;
    room: RoomSnapshot | null;
    nextOwnerUserId: string | null;
  } {
    const room = this.rooms.roomsById.get(roomId);
    if (!room) {
      throw new Error("room not found");
    }

    const beforeCount = room.members.length;
    room.members = room.members.filter((m) => m.userId !== userId);

    if (room.members.length === beforeCount) {
      throw new Error("user not in room");
    }

    this.rooms.roomIdByUserId.delete(userId);

    if (room.members.length === 0) {
      this.rooms.roomsById.delete(roomId);
      if (room.inviteCode) {
        this.rooms.roomIdByInviteCode.delete(room.inviteCode);
      }
      return {
        roomClosed: true,
        room: null,
        nextOwnerUserId: null,
      };
    }

    let nextOwnerUserId: string | null = null;
    if (room.ownerUserId === userId) {
      const nextOwner = room.members[0];
      room.ownerUserId = nextOwner.userId;
      nextOwner.role = "owner";
      nextOwnerUserId = nextOwner.userId;
      for (let i = 1; i < room.members.length; i += 1) {
        room.members[i].role = "member";
      }
    }

    room.updatedAt = nowIso();
    room.version += 1;

    return {
      roomClosed: false,
      room,
      nextOwnerUserId,
    };
  }

  setRoomReady(userId: string, roomId: string, ready: boolean): RoomSnapshot {
    const room = this.rooms.roomsById.get(roomId);
    if (!room) {
      throw new Error("room not found");
    }

    const member = room.members.find((m) => m.userId === userId);
    if (!member) {
      throw new Error("user not in room");
    }

    member.ready = ready;
    room.updatedAt = nowIso();
    room.version += 1;

    return room;
  }

  getRoomSnapshot(roomId: string): RoomSnapshot | null {
    return this.rooms.roomsById.get(roomId) ?? null;
  }

  getUserCurrentRoom(userId: string): RoomSnapshot | null {
    const roomId = this.rooms.roomIdByUserId.get(userId);
    if (!roomId) {
      return null;
    }
    return this.rooms.roomsById.get(roomId) ?? null;
  }

  // -----------------------------
  // Utilities / Seed
  // -----------------------------

  getAuthUserById(userId: string): AuthUser | null {
    const user = this.users.byUserId.get(userId);
    const profile = this.profiles.byUserId.get(userId);
    if (!user || !profile) {
      return null;
    }
    return toAuthUser(user, profile);
  }

  private seedDemoUser(): void {
    const account = "demo";
    const password = "demo123456";
    const userId = randomId("usr");
    const at = nowIso();

    const user: UserRecord = {
      userId,
      account,
      passwordHash: hashPassword(password),
      providers: new Set<LoginMethod>(["password"]),
      banned: false,
      banReason: null,
      banUntil: null,
      createdAt: at,
      updatedAt: at,
      lastLoginAt: null,
    };

    const profile = createDefaultProfile(userId, "演示玩家");
    profile.coins = 1888;
    profile.level = 5;
    profile.totalXp = 1520;
    profile.currentXp = 180;
    profile.bestMass = 3200;
    profile.totalMatches = 48;
    profile.totalWins = 21;

    this.users.byUserId.set(userId, user);
    this.users.byAccount.set(account, userId);
    this.profiles.byUserId.set(userId, profile);
  }
}

export const store = new InMemoryStore();
