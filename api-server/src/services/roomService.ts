import {
  PROTOCOL_ERROR,
  type CreateRoomResponse,
  type GetRoomSnapshotResponse,
  type JoinRoomResponse,
  type LeaveRoomResponse,
  type QueryRoomByInviteCodeResponse,
  type RoomMatchSnapshot,
  type RoomSnapshot,
  type SetReadyResponse,
  type StartRoomMatchResponse,
  type SyncRoomMatchResponse,
} from "@bop/shared-protocol";
import { DomainError } from "../lib/domainError.js";
import {
  addRoomMember,
  createOrReplaceLiveRoomSession,
  createRoomRecord,
  deleteLiveRoomSession,
  deleteRoomRecord,
  getActiveRoomSnapshotByUserId,
  getLiveRoomSessionRow,
  getRoomSnapshotByInviteCode,
  getRoomSnapshotByRoomId,
  reassignRoomOwner,
  removeRoomMember,
  setRoomMemberReadyState,
  updateLiveRoomSessionWithVersion,
  updateRoomMetadata,
} from "../repositories/roomRepository.js";
import { getUserSummary } from "./userService.js";
import {
  applyRoomMatchInput,
  createPublicRoomMatchSnapshot,
  createRoomMatchState,
  simulateRoomMatchState,
  type PersistedRoomMatchState,
} from "./roomMatchSessionService.js";

const DEFAULT_MAX_MEMBERS = 4;
const DEFAULT_MIN_START_MEMBERS = 2;
const MAX_ROOM_MEMBERS = 50;
const MAX_MODE_ID_LENGTH = 32;

function sanitizeText(input: unknown, fallback: string, max = 24): string {
  if (typeof input !== "string") {
    return fallback;
  }
  const trimmed = input.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeVisibility(value: unknown): RoomSnapshot["visibility"] {
  return value === "public" ? "public" : "private";
}

function normalizeTeamMode(value: unknown): RoomSnapshot["teamMode"] {
  return value === "team" ? "team" : "solo";
}

function safeMaxMembers(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return DEFAULT_MAX_MEMBERS;
  }
  return Math.max(2, Math.min(MAX_ROOM_MEMBERS, Math.floor(n)));
}

function safeMinStartMembers(value: unknown, maxMembers: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return Math.min(DEFAULT_MIN_START_MEMBERS, maxMembers);
  }
  return Math.max(2, Math.min(maxMembers, Math.floor(n)));
}

function canStartRoom(room: RoomSnapshot): boolean {
  if (room.status === "closed" || room.status === "inGame") {
    return false;
  }
  if (room.members.length < room.minStartMembers) {
    return false;
  }
  return room.members.every((member) => member.ready || member.role === "owner");
}

function deriveRoomStatus(room: RoomSnapshot): RoomSnapshot["status"] {
  if (room.status === "inGame" || room.status === "closed") {
    return room.status;
  }
  return canStartRoom(room) ? "matching" : "idle";
}

function assignTeamId(room: RoomSnapshot): number | null {
  if (room.teamMode !== "team") {
    return null;
  }
  const teamA = room.members.filter((member) => member.teamId === 0).length;
  const teamB = room.members.filter((member) => member.teamId === 1).length;
  return teamA <= teamB ? 0 : 1;
}

async function getRoomIdentity(userId: string): Promise<{
  nickname: string;
  avatarUrl: string | null;
}> {
  const summary = await getUserSummary(userId);
  return {
    nickname: summary.profile.nickname,
    avatarUrl: summary.profile.avatarUrl ?? null,
  };
}

async function syncDerivedRoomStatus(room: RoomSnapshot): Promise<RoomSnapshot> {
  const nextStatus = deriveRoomStatus(room);
  if (nextStatus === room.status) {
    return room;
  }
  return (
    (await updateRoomMetadata({
      roomId: room.roomId,
      status: nextStatus,
    })) ?? room
  );
}

function parsePersistedState(
  row: Awaited<ReturnType<typeof getLiveRoomSessionRow>>,
): PersistedRoomMatchState | null {
  if (!row || !row.state_json || typeof row.state_json !== "object") {
    return null;
  }

  return row.state_json as PersistedRoomMatchState;
}

async function materializeSessionForUser(params: {
  room: RoomSnapshot;
  userId: string;
  input?: { moveX?: number; moveY?: number };
  requestTimestamp: string;
}): Promise<PersistedRoomMatchState | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const sessionRow = await getLiveRoomSessionRow(params.room.roomId);
    if (!sessionRow) {
      return null;
    }

    const sessionState = parsePersistedState(sessionRow);
    if (!sessionState) {
      return null;
    }

    let nextState = simulateRoomMatchState(
      sessionState,
      params.room,
      params.requestTimestamp,
    );
    nextState = applyRoomMatchInput(
      nextState,
      params.userId,
      params.input,
      params.requestTimestamp,
    );

    const persisted = await updateLiveRoomSessionWithVersion(
      params.room.roomId,
      sessionRow.version,
      nextState,
    );
    if (!persisted) {
      continue;
    }

    const nextRoomStatus = nextState.phase === "finished" ? "idle" : "inGame";
    if (params.room.status !== nextRoomStatus) {
      await updateRoomMetadata({
        roomId: params.room.roomId,
        status: nextRoomStatus,
      });
    }

    return nextState;
  }

  throw new DomainError(
    PROTOCOL_ERROR.CONFLICT,
    "Room live session update conflicted too many times.",
    409,
  );
}

export async function createRoom(params: {
  userId: string;
  modeId: string;
  visibility?: unknown;
  maxMembers?: unknown;
  minStartMembers?: unknown;
  teamMode?: unknown;
}): Promise<CreateRoomResponse> {
  const existingRoom = await getActiveRoomSnapshotByUserId(params.userId);
  if (existingRoom && existingRoom.status !== "closed") {
    return { room: existingRoom };
  }

  const modeId = sanitizeText(params.modeId, "", MAX_MODE_ID_LENGTH);
  if (!modeId) {
    throw new DomainError(
      PROTOCOL_ERROR.INVALID_REQUEST,
      "modeId is required.",
      400,
      { field: "modeId" },
    );
  }

  const visibility = normalizeVisibility(params.visibility);
  const teamMode = normalizeTeamMode(params.teamMode);
  const maxMembers = safeMaxMembers(params.maxMembers);
  const minStartMembers = safeMinStartMembers(params.minStartMembers, maxMembers);
  const profile = await getRoomIdentity(params.userId);

  return {
    room: await createRoomRecord({
      ownerUserId: params.userId,
      modeId,
      visibility,
      teamMode,
      maxMembers,
      minStartMembers,
      nickname: profile.nickname,
      avatarUrl: profile.avatarUrl,
    }),
  };
}

export async function joinRoom(params: {
  userId: string;
  roomId?: string;
  inviteCode?: string;
}): Promise<JoinRoomResponse> {
  const room = params.roomId
    ? await getRoomSnapshotByRoomId(params.roomId)
    : params.inviteCode
      ? await getRoomSnapshotByInviteCode(params.inviteCode)
      : null;

  if (!room) {
    throw new DomainError(
      PROTOCOL_ERROR.ROOM_NOT_FOUND,
      "Room not found.",
      404,
    );
  }
  if (room.status !== "idle") {
    throw new DomainError(
      PROTOCOL_ERROR.ROOM_INVALID_STATE,
      "Room is not joinable right now.",
      409,
      { roomId: room.roomId, status: room.status },
    );
  }

  const existingRoom = await getActiveRoomSnapshotByUserId(params.userId);
  if (existingRoom && existingRoom.roomId !== room.roomId) {
    throw new DomainError(
      PROTOCOL_ERROR.CONFLICT,
      "User already in another room.",
      409,
      { roomId: existingRoom.roomId },
    );
  }

  const existingMember = room.members.find((member) => member.userId === params.userId);
  if (existingMember) {
    return { room };
  }
  if (room.members.length >= room.maxMembers) {
    throw new DomainError(
      PROTOCOL_ERROR.ROOM_FULL,
      "Room is full.",
      409,
      { roomId: room.roomId, maxMembers: room.maxMembers },
    );
  }

  const profile = await getRoomIdentity(params.userId);
  const nextRoom = await addRoomMember({
    roomId: room.roomId,
    userId: params.userId,
    nickname: profile.nickname,
    avatarUrl: profile.avatarUrl,
    teamId: assignTeamId(room),
  });

  if (!nextRoom) {
    throw new DomainError(
      PROTOCOL_ERROR.ROOM_NOT_FOUND,
      "Room not found.",
      404,
    );
  }

  return {
    room: await syncDerivedRoomStatus(nextRoom),
  };
}

export async function leaveRoom(params: {
  userId: string;
  roomId: string;
}): Promise<LeaveRoomResponse> {
  const room = await getRoomSnapshotByRoomId(params.roomId);
  if (!room) {
    throw new DomainError(
      PROTOCOL_ERROR.ROOM_NOT_FOUND,
      "Room not found.",
      404,
    );
  }

  const member = room.members.find((entry) => entry.userId === params.userId);
  if (!member) {
    throw new DomainError(
      PROTOCOL_ERROR.ROOM_NOT_MEMBER,
      "You are not in this room.",
      403,
    );
  }

  if (room.members.length === 1) {
    await deleteLiveRoomSession(room.roomId);
    await deleteRoomRecord(room.roomId);
    return {
      roomId: room.roomId,
      leftUserId: params.userId,
      roomClosed: true,
      nextOwnerUserId: null,
    };
  }

  const nextOwner =
    room.ownerUserId === params.userId
      ? room.members.find((entry) => entry.userId !== params.userId) ?? null
      : null;

  const removed = await removeRoomMember({
    roomId: room.roomId,
    userId: params.userId,
  });

  let updatedRoom = removed;
  if (!updatedRoom) {
    throw new DomainError(
      PROTOCOL_ERROR.ROOM_NOT_FOUND,
      "Room not found.",
      404,
    );
  }

  if (nextOwner) {
    updatedRoom = (await reassignRoomOwner(room.roomId, nextOwner.userId)) ?? updatedRoom;
  }
  updatedRoom = await syncDerivedRoomStatus(updatedRoom);

  return {
    roomId: room.roomId,
    leftUserId: params.userId,
    roomClosed: false,
    nextOwnerUserId: nextOwner?.userId ?? null,
  };
}

export async function setReadyState(params: {
  userId: string;
  roomId: string;
  ready: boolean;
}): Promise<SetReadyResponse> {
  const room = await getRoomSnapshotByRoomId(params.roomId);
  if (!room) {
    throw new DomainError(
      PROTOCOL_ERROR.ROOM_NOT_FOUND,
      "Room not found.",
      404,
    );
  }
  if (!room.members.some((member) => member.userId === params.userId)) {
    throw new DomainError(
      PROTOCOL_ERROR.ROOM_NOT_MEMBER,
      "You are not in this room.",
      403,
    );
  }

  const updated = await setRoomMemberReadyState(params);
  if (!updated) {
    throw new DomainError(
      PROTOCOL_ERROR.ROOM_NOT_FOUND,
      "Room not found.",
      404,
    );
  }

  return {
    room: await syncDerivedRoomStatus(updated),
  };
}

export async function getRoomSnapshot(
  roomId: string,
): Promise<GetRoomSnapshotResponse> {
  const room = await getRoomSnapshotByRoomId(roomId);
  if (!room) {
    throw new DomainError(
      PROTOCOL_ERROR.ROOM_NOT_FOUND,
      "Room not found.",
      404,
    );
  }
  return { room };
}

export async function queryRoomByInviteCode(
  inviteCode: string,
): Promise<QueryRoomByInviteCodeResponse> {
  const room = await getRoomSnapshotByInviteCode(inviteCode);
  if (!room) {
    throw new DomainError(
      PROTOCOL_ERROR.ROOM_NOT_FOUND,
      "Room not found.",
      404,
    );
  }
  return { room };
}

export async function startRoomMatch(params: {
  userId: string;
  roomId: string;
}): Promise<StartRoomMatchResponse> {
  let room = await getRoomSnapshotByRoomId(params.roomId);
  if (!room) {
    throw new DomainError(
      PROTOCOL_ERROR.ROOM_NOT_FOUND,
      "Room not found.",
      404,
    );
  }
  if (room.ownerUserId !== params.userId) {
    throw new DomainError(
      PROTOCOL_ERROR.ROOM_PERMISSION_DENIED,
      "Only the room owner can start a private match.",
      403,
      { roomId: room.roomId },
    );
  }
  if (!canStartRoom(room)) {
    throw new DomainError(
      PROTOCOL_ERROR.ROOM_START_CONDITION_NOT_MET,
      "Room is not ready to start.",
      409,
      {
        roomId: room.roomId,
        minStartMembers: room.minStartMembers,
        memberCount: room.members.length,
      },
    );
  }

  const timestamp = new Date().toISOString();
  const existingRow = await getLiveRoomSessionRow(room.roomId);
  const existingState = parsePersistedState(existingRow);
  if (existingState && existingState.phase === "running") {
    const materialized = await materializeSessionForUser({
      room,
      userId: params.userId,
      input: { moveX: 0, moveY: 0 },
      requestTimestamp: timestamp,
    });
    room = (await getRoomSnapshotByRoomId(room.roomId)) ?? room;

    if (!materialized) {
      throw new DomainError(
        PROTOCOL_ERROR.ROOM_INVALID_STATE,
        "Room live session is unavailable.",
        409,
      );
    }

    return {
      room,
      session: createPublicRoomMatchSnapshot(materialized, params.userId),
    };
  }

  const state = createRoomMatchState(room, timestamp);
  await createOrReplaceLiveRoomSession(state);
  room = (await updateRoomMetadata({
    roomId: room.roomId,
    status: "inGame",
  })) ?? room;

  return {
    room,
    session: createPublicRoomMatchSnapshot(state, params.userId),
  };
}

export async function syncRoomMatch(params: {
  userId: string;
  roomId: string;
  input?: { moveX?: number; moveY?: number };
}): Promise<SyncRoomMatchResponse> {
  let room = await getRoomSnapshotByRoomId(params.roomId);
  if (!room) {
    throw new DomainError(
      PROTOCOL_ERROR.ROOM_NOT_FOUND,
      "Room not found.",
      404,
    );
  }

  if (!room.members.some((member) => member.userId === params.userId)) {
    throw new DomainError(
      PROTOCOL_ERROR.ROOM_NOT_MEMBER,
      "You are not in this room.",
      403,
      { roomId: room.roomId },
    );
  }

  const existingRow = await getLiveRoomSessionRow(room.roomId);
  if (!existingRow) {
    throw new DomainError(
      PROTOCOL_ERROR.ROOM_INVALID_STATE,
      "Room match has not started yet.",
      409,
      { roomId: room.roomId, status: room.status },
    );
  }

  const session = await materializeSessionForUser({
    room,
    userId: params.userId,
    input: params.input,
    requestTimestamp: new Date().toISOString(),
  });

  if (!session) {
    throw new DomainError(
      PROTOCOL_ERROR.ROOM_INVALID_STATE,
      "Room live session is unavailable.",
      409,
    );
  }

  room = (await getRoomSnapshotByRoomId(room.roomId)) ?? room;

  return {
    room,
    session: createPublicRoomMatchSnapshot(session, params.userId),
  };
}
