import {
  JSON_HEADERS,
  MODE_CONFIG,
  NICKNAME_MAX,
  NICKNAME_MIN,
  AVATAR_URL_MAX,
} from "./constants.js";

export function nowIso() {
  return new Date().toISOString();
}

export function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function toBoolean(value) {
  return value === 1 || value === true;
}

export function numericEnv(envValue, fallback) {
  const next = Number(envValue);
  if (!Number.isFinite(next) || next <= 0) {
    return fallback;
  }
  return Math.floor(next);
}

export function normalizeBindings(params) {
  return params.map((value) => (value === undefined ? null : value));
}

export function withCors(request, headers = new Headers()) {
  const origin = request.headers.get("origin");
  headers.set("access-control-allow-origin", origin || "*");
  headers.set("access-control-allow-methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
  headers.set(
    "access-control-allow-headers",
    "authorization,content-type,x-request-id,x-device-id,x-app-version",
  );
  headers.set("vary", "Origin");
  return headers;
}

export function jsonResponse(request, status, payload) {
  const headers = withCors(request, new Headers(JSON_HEADERS));
  return new Response(JSON.stringify(payload), {
    status,
    headers,
  });
}

export function success(request, requestId, data, status = 200) {
  return jsonResponse(request, status, {
    ok: true,
    data,
    requestId,
    timestamp: nowIso(),
  });
}

export function failure(request, requestId, status, code, message, details) {
  return jsonResponse(request, status, {
    ok: false,
    error: {
      code,
      message,
      details,
      requestId,
      timestamp: nowIso(),
    },
  });
}

export function readRequestId(request) {
  return request.headers.get("x-request-id")?.trim() || newId("req");
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function normalizeAccount(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function normalizeNickname(value, fallback = "勇者球球") {
  const safe =
    typeof value === "string" ? value.trim().slice(0, NICKNAME_MAX) : "";
  return safe.length > 0 ? safe : fallback;
}

export function validateNickname(value) {
  const safe =
    typeof value === "string" ? value.trim().slice(0, NICKNAME_MAX) : "";
  if (safe.length < NICKNAME_MIN) {
    return null;
  }
  return safe;
}

export function validateAvatarUrl(value) {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.length > AVATAR_URL_MAX) {
    return undefined;
  }
  return value;
}

export function clampNonNegativeInteger(value, fallback = 0) {
  const next = Number(value);
  if (!Number.isFinite(next)) {
    return fallback;
  }
  return Math.max(0, Math.floor(next));
}

export function sanitizePlayerProgression(raw = {}) {
  return {
    level: Math.max(1, clampNonNegativeInteger(raw.level, 1)),
    currentXp: clampNonNegativeInteger(raw.currentXp, 0),
    totalXp: clampNonNegativeInteger(raw.totalXp, 0),
    coins: clampNonNegativeInteger(raw.coins, 0),
    totalMatches: clampNonNegativeInteger(raw.totalMatches, 0),
    totalWins: clampNonNegativeInteger(raw.totalWins, 0),
    bestMass: clampNonNegativeInteger(raw.bestMass, 0),
  };
}

export function clonePlayerProgression(source) {
  return {
    level: source.level,
    currentXp: source.currentXp,
    totalXp: source.totalXp,
    coins: source.coins,
    totalMatches: source.totalMatches,
    totalWins: source.totalWins,
    bestMass: source.bestMass,
  };
}

export function getRequiredXpForLevel(level) {
  const safeLevel = Math.max(1, Math.floor(level));
  return 140 + 60 * safeLevel + 8 * safeLevel * safeLevel;
}

function getRankBaseReward(playerRank) {
  if (playerRank <= 1) return { xp: 320, coins: 260 };
  if (playerRank === 2) return { xp: 250, coins: 200 };
  if (playerRank === 3) return { xp: 200, coins: 150 };
  if (playerRank >= 4 && playerRank <= 10) return { xp: 150, coins: 110 };
  return { xp: 110, coins: 80 };
}

export function computeMatchRewards(
  playerRank,
  playerMass,
  playerWon,
  isNewRecord,
) {
  const safeRank = Math.max(1, Math.floor(playerRank));
  const safeMass = Math.max(0, Math.floor(playerMass));
  const rankBase = getRankBaseReward(safeRank);
  const massBonusXp = Math.floor(safeMass / 1400);
  const massBonusCoins = Math.floor(safeMass / 1800);
  const winBonusXp = playerWon ? 80 : 0;
  const winBonusCoins = playerWon ? 50 : 0;
  const recordBonusXp = isNewRecord ? 160 : 0;
  const recordBonusCoins = isNewRecord ? 100 : 0;

  return {
    playerRank: safeRank,
    playerMass: safeMass,
    playerWon,
    isNewRecord,
    rankBaseXp: rankBase.xp,
    rankBaseCoins: rankBase.coins,
    massBonusXp,
    massBonusCoins,
    winBonusXp,
    winBonusCoins,
    recordBonusXp,
    recordBonusCoins,
    totalXp: rankBase.xp + massBonusXp + winBonusXp + recordBonusXp,
    totalCoins:
      rankBase.coins + massBonusCoins + winBonusCoins + recordBonusCoins,
  };
}

export function applyMatchRewardsToProgression(before, reward) {
  const next = clonePlayerProgression(before);
  next.totalMatches += 1;
  if (reward.playerWon) {
    next.totalWins += 1;
  }

  next.coins += reward.totalCoins;
  next.totalXp += reward.totalXp;
  next.currentXp += reward.totalXp;
  next.bestMass = Math.max(next.bestMass, reward.playerMass);

  let gainedLevels = 0;
  while (next.currentXp >= getRequiredXpForLevel(next.level)) {
    next.currentXp -= getRequiredXpForLevel(next.level);
    next.level += 1;
    gainedLevels += 1;
  }

  return {
    before: clonePlayerProgression(before),
    after: sanitizePlayerProgression(next),
    leveledUp: gainedLevels > 0,
    gainedLevels,
  };
}

export function isSupportedModeId(value) {
  return Object.prototype.hasOwnProperty.call(MODE_CONFIG, value);
}

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
