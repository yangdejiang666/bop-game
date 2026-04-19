/// Shared protocol package entry
/// Use namespaced exports to avoid symbol collisions across modules.

export * from "./admin.js";
export * from "./errors.js";
export * from "./auth.js";
export * from "./access.js";
export * from "./user.js";
export * from "./room.js";
export * from "./progression.js";
export * from "./matchmaking.js";
export * from "./social.js";
export * from "./preferences.js";
export * from "./ranking.js";
export * from "./platform.js";
export * from "./mail.js";

export * as MatchmakingProtocol from "./matchmaking.js";
export * as WsProtocol from "./ws.js";
