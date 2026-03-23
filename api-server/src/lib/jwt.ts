import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { apiServerConfig } from "./config.js";

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
  expiresAt: number;
}

interface TokenPayload {
  sid: string;
  typ: "access";
}

export function createAccessToken(userId: string, sessionId: string): string {
  return jwt.sign(
    {
      sid: sessionId,
      typ: "access",
    } satisfies TokenPayload,
    apiServerConfig.jwt.accessSecret,
    {
      algorithm: "HS256",
      issuer: apiServerConfig.jwt.issuer,
      audience: apiServerConfig.jwt.audience,
      expiresIn: apiServerConfig.jwt.accessTtlSeconds,
      subject: userId,
    },
  );
}

export function verifyAccessToken(token: string): AccessTokenClaims | null {
  try {
    const verified = jwt.verify(token, apiServerConfig.jwt.accessSecret, {
      algorithms: ["HS256"],
      issuer: apiServerConfig.jwt.issuer,
      audience: apiServerConfig.jwt.audience,
    }) as jwt.JwtPayload & TokenPayload;

    if (
      verified.typ !== "access" ||
      typeof verified.sub !== "string" ||
      typeof verified.sid !== "string" ||
      typeof verified.exp !== "number"
    ) {
      return null;
    }

    return {
      userId: verified.sub,
      sessionId: verified.sid,
      expiresAt: verified.exp,
    };
  } catch {
    return null;
  }
}

export function createOpaqueToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
