import { Router } from "express";
import {
  PROTOCOL_ERROR,
  createError,
  createSuccess,
  type CreateRoomRequest,
  type CreateRoomResponse,
  type GetRoomSnapshotResponse,
  type JoinRoomRequest,
  type JoinRoomResponse,
  type LeaveRoomRequest,
  type LeaveRoomResponse,
  type QueryRoomByInviteCodeResponse,
  type RoomSnapshot,
  type SetReadyRequest,
  type SetReadyResponse,
} from "@bop/shared-protocol";
import { asyncHandler } from "../lib/asyncHandler.js";
import {
  requireAuth,
  type AuthenticatedRequest,
  readRequestId,
} from "../lib/auth.js";
import { getUserSummary } from "../services/userService.js";

type RoomMember = RoomSnapshot["members"][number];
type RoomStatus = RoomSnapshot["status"];
type RoomTeamMode = RoomSnapshot["teamMode"];
type RoomVisibility = RoomSnapshot["visibility"];

interface RoomRecord extends RoomSnapshot {}

const router = Router();

const roomsById = new Map<string, RoomRecord>();
const inviteCodeToRoomId = new Map<string, string>();
const roomIdByUserId = new Map<string, string>();

const DEFAULT_MAX_MEMBERS = 4;
const DEFAULT_MIN_START_MEMBERS = 2;
const MAX_ROOM_MEMBERS = 50;
const MAX_MODE_ID_LENGTH = 32;

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function makeInviteCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function sanitizeText(input: unknown, fallback: string, max = 24): string {
  if (typeof input !== "string") {
    return fallback;
  }
  const trimmed = input.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : fallback;
}

function patchRoomUpdated(room: RoomRecord): void {
  room.version += 1;
  room.updatedAt = nowIso();
}

function cloneSnapshot(room: RoomRecord): RoomSnapshot {
  return {
    ...room,
    members: room.members.map((member) => ({ ...member })),
  };
}

function findMember(room: RoomRecord, userId: string): RoomMember | undefined {
  return room.members.find((member) => member.userId === userId);
}

function normalizeVisibility(value: unknown): RoomVisibility {
  return value === "public" ? "public" : "private";
}

function normalizeTeamMode(value: unknown): RoomTeamMode {
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

function canStartRoom(room: RoomRecord): boolean {
  if (room.status !== "idle") {
    return false;
  }
  if (room.members.length < room.minStartMembers) {
    return false;
  }
  return room.members.every((member) => member.ready || member.role === "owner");
}

function roomStatusAfterReady(room: RoomRecord): RoomStatus {
  return canStartRoom(room) ? "matching" : "idle";
}

function assignTeamId(room: RoomRecord): number | null {
  if (room.teamMode !== "team") {
    return null;
  }

  const teamA = room.members.filter((member) => member.teamId === 0).length;
  const teamB = room.members.filter((member) => member.teamId === 1).length;
  return teamA <= teamB ? 0 : 1;
}

async function getAuthedNickname(userId: string): Promise<string> {
  const summary = await getUserSummary(userId);
  return summary.profile.nickname;
}

function findRoomByInviteCode(inviteCode: string): RoomRecord | null {
  const roomId = inviteCodeToRoomId.get(inviteCode.toUpperCase());
  if (!roomId) {
    return null;
  }
  return roomsById.get(roomId) ?? null;
}

router.post(
  "/create",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) {
      return;
    }

    const body = (request.body ?? {}) as CreateRoomRequest;
    const modeId = sanitizeText(body.modeId, "", MAX_MODE_ID_LENGTH);
    if (!modeId) {
      response.status(400).json(
        createError(PROTOCOL_ERROR.INVALID_REQUEST, "modeId is required.", {
          requestId: readRequestId(request),
          details: { field: "modeId" },
        }),
      );
      return;
    }

    const existingRoomId = roomIdByUserId.get(auth.userId);
    if (existingRoomId) {
      const existingRoom = roomsById.get(existingRoomId);
      if (existingRoom && existingRoom.status !== "closed") {
        response.json(
          createSuccess<CreateRoomResponse>(
            { room: cloneSnapshot(existingRoom) },
            readRequestId(request),
          ),
        );
        return;
      }
    }

    const visibility = normalizeVisibility(body.visibility);
    const teamMode = normalizeTeamMode(body.teamMode);
    const maxMembers = safeMaxMembers(body.maxMembers);
    const minStartMembers = safeMinStartMembers(body.minStartMembers, maxMembers);
    const nickname = await getAuthedNickname(auth.userId);

    let inviteCode: string | null = null;
    if (visibility === "private") {
      inviteCode = makeInviteCode();
      while (inviteCodeToRoomId.has(inviteCode)) {
        inviteCode = makeInviteCode();
      }
    }

    const createdAt = nowIso();
    const owner: RoomMember = {
      userId: auth.userId,
      nickname,
      avatarUrl: "",
      ready: false,
      role: "owner",
      teamId: teamMode === "team" ? 0 : null,
      joinedAt: createdAt,
      isOnline: true,
    };

    const room: RoomRecord = {
      roomId: makeId("room"),
      modeId,
      visibility,
      inviteCode,
      ownerUserId: auth.userId,
      status: "idle",
      teamMode,
      maxMembers,
      minStartMembers,
      members: [owner],
      createdAt,
      updatedAt: createdAt,
      version: 1,
    };

    roomsById.set(room.roomId, room);
    roomIdByUserId.set(auth.userId, room.roomId);
    if (inviteCode) {
      inviteCodeToRoomId.set(inviteCode, room.roomId);
    }

    response.status(201).json(
      createSuccess<CreateRoomResponse>(
        { room: cloneSnapshot(room) },
        readRequestId(request),
      ),
    );
  }),
);

router.post(
  "/join",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) {
      return;
    }

    const body = (request.body ?? {}) as JoinRoomRequest;
    let room: RoomRecord | null = null;
    if (body.roomId?.trim()) {
      room = roomsById.get(body.roomId.trim()) ?? null;
    } else if (body.inviteCode?.trim()) {
      room = findRoomByInviteCode(body.inviteCode.trim());
    }

    if (!room) {
      response.status(404).json(
        createError(PROTOCOL_ERROR.ROOM_NOT_FOUND, "Room not found.", {
          requestId: readRequestId(request),
        }),
      );
      return;
    }

    if (room.status !== "idle") {
      response.status(409).json(
        createError(
          PROTOCOL_ERROR.ROOM_INVALID_STATE,
          "Room is not joinable right now.",
          {
            requestId: readRequestId(request),
            details: { roomId: room.roomId, status: room.status },
          },
        ),
      );
      return;
    }

    const existingRoomId = roomIdByUserId.get(auth.userId);
    if (existingRoomId && existingRoomId !== room.roomId) {
      response.status(409).json(
        createError(PROTOCOL_ERROR.CONFLICT, "User already in another room.", {
          requestId: readRequestId(request),
          details: { roomId: existingRoomId },
        }),
      );
      return;
    }

    const existingMember = findMember(room, auth.userId);
    if (existingMember) {
      response.json(
        createSuccess<JoinRoomResponse>(
          { room: cloneSnapshot(room) },
          readRequestId(request),
        ),
      );
      return;
    }

    if (room.members.length >= room.maxMembers) {
      response.status(409).json(
        createError(PROTOCOL_ERROR.ROOM_FULL, "Room is full.", {
          requestId: readRequestId(request),
          details: { roomId: room.roomId, maxMembers: room.maxMembers },
        }),
      );
      return;
    }

    room.members.push({
      userId: auth.userId,
      nickname: await getAuthedNickname(auth.userId),
      avatarUrl: "",
      ready: false,
      role: "member",
      teamId: assignTeamId(room),
      joinedAt: nowIso(),
      isOnline: true,
    });
    roomIdByUserId.set(auth.userId, room.roomId);
    patchRoomUpdated(room);

    response.json(
      createSuccess<JoinRoomResponse>(
        { room: cloneSnapshot(room) },
        readRequestId(request),
      ),
    );
  }),
);

router.post(
  "/leave",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) {
      return;
    }

    const body = (request.body ?? {}) as LeaveRoomRequest;
    const roomId = sanitizeText(body.roomId, "", 64);
    if (!roomId) {
      response.status(400).json(
        createError(PROTOCOL_ERROR.INVALID_REQUEST, "roomId is required.", {
          requestId: readRequestId(request),
          details: { field: "roomId" },
        }),
      );
      return;
    }

    const room = roomsById.get(roomId);
    if (!room) {
      response.status(404).json(
        createError(PROTOCOL_ERROR.ROOM_NOT_FOUND, "Room not found.", {
          requestId: readRequestId(request),
        }),
      );
      return;
    }

    const index = room.members.findIndex((member) => member.userId === auth.userId);
    if (index < 0) {
      response.status(403).json(
        createError(PROTOCOL_ERROR.ROOM_NOT_MEMBER, "You are not in this room.", {
          requestId: readRequestId(request),
        }),
      );
      return;
    }

    room.members.splice(index, 1);
    roomIdByUserId.delete(auth.userId);

    let roomClosed = false;
    let nextOwnerUserId: string | null = null;

    if (room.members.length === 0) {
      roomClosed = true;
      room.status = "closed";
      roomsById.delete(room.roomId);
      if (room.inviteCode) {
        inviteCodeToRoomId.delete(room.inviteCode);
      }
    } else {
      if (room.ownerUserId === auth.userId) {
        const nextOwner = room.members[0];
        if (!nextOwner) {
          throw new Error("room owner transfer failed");
        }
        nextOwner.role = "owner";
        room.ownerUserId = nextOwner.userId;
        nextOwnerUserId = nextOwner.userId;

        for (let i = 1; i < room.members.length; i += 1) {
          const member = room.members[i];
          if (member) {
            member.role = "member";
          }
        }
      }

      room.status = roomStatusAfterReady(room);
      patchRoomUpdated(room);
    }

    const payload: LeaveRoomResponse = {
      roomId,
      leftUserId: auth.userId,
      roomClosed,
      nextOwnerUserId,
    };
    response.json(createSuccess(payload, readRequestId(request)));
  }),
);

router.post(
  "/ready",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) {
      return;
    }

    const body = (request.body ?? {}) as SetReadyRequest;
    const roomId = sanitizeText(body.roomId, "", 64);
    if (!roomId) {
      response.status(400).json(
        createError(PROTOCOL_ERROR.INVALID_REQUEST, "roomId is required.", {
          requestId: readRequestId(request),
          details: { field: "roomId" },
        }),
      );
      return;
    }

    const room = roomsById.get(roomId);
    if (!room) {
      response.status(404).json(
        createError(PROTOCOL_ERROR.ROOM_NOT_FOUND, "Room not found.", {
          requestId: readRequestId(request),
        }),
      );
      return;
    }

    const member = findMember(room, auth.userId);
    if (!member) {
      response.status(403).json(
        createError(PROTOCOL_ERROR.ROOM_NOT_MEMBER, "You are not in this room.", {
          requestId: readRequestId(request),
        }),
      );
      return;
    }

    member.ready = Boolean(body.ready);
    room.status = roomStatusAfterReady(room);
    patchRoomUpdated(room);

    const payload: SetReadyResponse = {
      room: cloneSnapshot(room),
    };
    response.json(createSuccess(payload, readRequestId(request)));
  }),
);

router.get(
  "/invite/:inviteCode",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) {
      return;
    }

    const inviteCode = sanitizeText(request.params.inviteCode, "", 16).toUpperCase();
    if (!inviteCode) {
      response.status(400).json(
        createError(PROTOCOL_ERROR.INVALID_REQUEST, "inviteCode is required.", {
          requestId: readRequestId(request),
          details: { field: "inviteCode" },
        }),
      );
      return;
    }

    const room = findRoomByInviteCode(inviteCode);
    if (!room) {
      response.status(404).json(
        createError(PROTOCOL_ERROR.ROOM_NOT_FOUND, "Room not found.", {
          requestId: readRequestId(request),
        }),
      );
      return;
    }

    const payload: QueryRoomByInviteCodeResponse = {
      room: cloneSnapshot(room),
    };
    response.json(createSuccess(payload, readRequestId(request)));
  }),
);

router.get(
  "/:roomId",
  asyncHandler(async (request, response) => {
    const auth = await requireAuth(request as AuthenticatedRequest, response);
    if (!auth) {
      return;
    }

    const roomId = sanitizeText(request.params.roomId, "", 64);
    if (!roomId) {
      response.status(400).json(
        createError(PROTOCOL_ERROR.INVALID_REQUEST, "roomId is required.", {
          requestId: readRequestId(request),
          details: { field: "roomId" },
        }),
      );
      return;
    }

    const room = roomsById.get(roomId);
    if (!room) {
      response.status(404).json(
        createError(PROTOCOL_ERROR.ROOM_NOT_FOUND, "Room not found.", {
          requestId: readRequestId(request),
        }),
      );
      return;
    }

    const payload: GetRoomSnapshotResponse = {
      room: cloneSnapshot(room),
    };
    response.json(createSuccess(payload, readRequestId(request)));
  }),
);

export default router;
