import type { NextFunction, Request, Response } from "express";
import { PROTOCOL_ERROR, createError } from "@bop/shared-protocol";
import { verifyAccessToken } from "./jwt.js";
import { getActiveSessionById, markSessionSeen } from "../repositories/accountRepository.js";

export interface AuthContext {
  userId: string;
  sessionId: string;
  accessToken: string;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

export function readRequestId(request: Request): string | undefined {
  const value = request.header("x-request-id") ?? request.header("x-trace-id");
  return value?.trim() || undefined;
}

export function extractBearerToken(request: Request): string | null {
  const raw =
    request.header("authorization") ?? request.header("Authorization");

  if (!raw) {
    return null;
  }

  const [scheme, token] = raw.trim().split(/\s+/, 2);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token.trim() || null;
}

async function authenticateRequest(request: Request): Promise<AuthContext | null> {
  const token = extractBearerToken(request);
  if (!token) {
    return null;
  }

  const claims = verifyAccessToken(token);
  if (!claims) {
    return null;
  }

  const session = await getActiveSessionById(claims.sessionId);
  if (!session || session.revokedAt || session.userId !== claims.userId) {
    return null;
  }

  await markSessionSeen(session.sessionId);

  return {
    userId: claims.userId,
    sessionId: claims.sessionId,
    accessToken: token,
  };
}

export async function tryAttachAuth(
  request: AuthenticatedRequest,
): Promise<AuthContext | null> {
  const auth = await authenticateRequest(request);
  if (auth) {
    request.auth = auth;
  }
  return auth;
}

export async function requireAuth(
  request: AuthenticatedRequest,
  response: Response,
): Promise<AuthContext | null> {
  const auth = await authenticateRequest(request);
  if (!auth) {
    response.status(401).json(
      createError(PROTOCOL_ERROR.UNAUTHORIZED, "Missing or invalid bearer token.", {
        requestId: readRequestId(request),
        details: { field: "authorization" },
      }),
    );
    return null;
  }

  request.auth = auth;
  return auth;
}

export async function requireAuthMiddleware(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const auth = await requireAuth(request, response);
  if (!auth) {
    return;
  }
  next();
}
