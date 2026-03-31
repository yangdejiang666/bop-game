const WORLD_SIZE = 6000;
const START_MASS = 140;
const FOOD_MASS = 6;
const FOOD_RADIUS = 8;
const RESPAWN_DELAY_MS = 3000;

const MODE_RULES = {
  ranked: { durationMs: 210000, foodCount: 96, baseSpeed: 274 },
  peak: { durationMs: 210000, foodCount: 96, baseSpeed: 268 },
  classic: { durationMs: 180000, foodCount: 84, baseSpeed: 282 },
  speed: { durationMs: 150000, foodCount: 90, baseSpeed: 312 },
  team: { durationMs: 180000, foodCount: 88, baseSpeed: 278 },
  battleRoyale: { durationMs: 180000, foodCount: 80, baseSpeed: 272 },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function normalizeVector(x, y) {
  const safeX = Number.isFinite(x) ? x : 0;
  const safeY = Number.isFinite(y) ? y : 0;
  const length = Math.hypot(safeX, safeY);
  if (length < 0.0001) {
    return { x: 0, y: 0 };
  }
  return {
    x: safeX / length,
    y: safeY / length,
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makePalette(seedValue) {
  const hue = hashString(seedValue) % 360;
  const accentHue = (hue + 32) % 360;
  return {
    color: `hsl(${hue} 78% 56%)`,
    accentColor: `hsl(${accentHue} 88% 70%)`,
  };
}

function radiusForMass(mass) {
  return Math.max(18, Math.sqrt(Math.max(1, mass)) * 2.18);
}

function moveSpeedForMass(mass, modeId) {
  const rules = MODE_RULES[modeId] || MODE_RULES.classic;
  const scaled = rules.baseSpeed / Math.pow(Math.max(1, mass) / START_MASS, 0.18);
  return clamp(scaled, 108, rules.baseSpeed);
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function createFood(index) {
  return {
    id: `food_${index}_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`,
    x: round(randomBetween(72, WORLD_SIZE - 72)),
    y: round(randomBetween(72, WORLD_SIZE - 72)),
    mass: FOOD_MASS,
  };
}

function spawnPosition(index, total) {
  const center = WORLD_SIZE / 2;
  const radius = Math.min(920, 320 + total * 48);
  const angle = (Math.PI * 2 * index) / Math.max(1, total);
  return {
    x: round(center + Math.cos(angle) * radius),
    y: round(center + Math.sin(angle) * radius),
  };
}

function ensurePlayerRoomShape(member, index, total, modeId) {
  const palette = makePalette(member.userId);
  const position = spawnPosition(index, total);
  const mass = START_MASS;

  return {
    userId: member.userId,
    nickname: member.nickname,
    color: palette.color,
    accentColor: palette.accentColor,
    x: position.x,
    y: position.y,
    mass,
    radius: round(radiusForMass(mass)),
    score: 0,
    alive: true,
    respawnAt: null,
    input: { x: 0, y: 0 },
    lastInputAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    modeId,
  };
}

function buildLeaderboard(players) {
  return [...players]
    .sort((left, right) => {
      if (right.mass !== left.mass) {
        return right.mass - left.mass;
      }
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.nickname.localeCompare(right.nickname, "zh-CN");
    })
    .map((player) => ({
      userId: player.userId,
      nickname: player.nickname,
      mass: Math.floor(player.mass),
      score: player.score,
      alive: player.alive,
    }));
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

export function createRoomMatchState(roomSnapshot, startedAt = new Date().toISOString()) {
  const rules = MODE_RULES[roomSnapshot.modeId] || MODE_RULES.classic;
  const totalMembers = roomSnapshot.members.length;
  const players = roomSnapshot.members.map((member, index) =>
    ensurePlayerRoomShape(member, index, totalMembers, roomSnapshot.modeId),
  );
  const foods = Array.from({ length: rules.foodCount }, (_, index) =>
    createFood(index),
  );
  const endsAt = new Date(Date.parse(startedAt) + rules.durationMs).toISOString();

  return {
    sessionId: `roomsess_${crypto.randomUUID().replaceAll("-", "")}`,
    roomId: roomSnapshot.roomId,
    modeId: roomSnapshot.modeId,
    roomCode: roomSnapshot.inviteCode || null,
    phase: "running",
    tick: 0,
    version: 1,
    worldSize: WORLD_SIZE,
    startedAt,
    endsAt,
    lastSimulatedAt: startedAt,
    winnerUserId: null,
    foods,
    players,
    leaderboard: buildLeaderboard(players),
  };
}

function syncPlayersWithRoom(state, roomSnapshot) {
  const nextPlayers = [];
  const existingPlayers = new Map(
    state.players.map((player) => [player.userId, player]),
  );

  roomSnapshot.members.forEach((member, index) => {
    const existing = existingPlayers.get(member.userId);
    if (existing) {
      nextPlayers.push({
        ...existing,
        nickname: member.nickname,
      });
      return;
    }

    nextPlayers.push(
      ensurePlayerRoomShape(
        member,
        index,
        roomSnapshot.members.length,
        roomSnapshot.modeId,
      ),
    );
  });

  return {
    ...state,
    roomCode: roomSnapshot.inviteCode || null,
    players: nextPlayers,
  };
}

function applyFoodCollision(player, food) {
  player.mass += food.mass;
  player.score += 1;
  player.radius = round(radiusForMass(player.mass));
  return createFood(hashString(food.id));
}

function eliminatePlayer(winner, loser, nowIso) {
  winner.mass += loser.mass * 0.82;
  winner.score += 12;
  winner.radius = round(radiusForMass(winner.mass));

  const respawnAt = new Date(Date.parse(nowIso) + RESPAWN_DELAY_MS).toISOString();
  const respawn = spawnPosition(
    hashString(loser.userId) % 8,
    Math.max(2, hashString(winner.userId) % 6),
  );

  loser.mass = START_MASS;
  loser.radius = round(radiusForMass(START_MASS));
  loser.alive = false;
  loser.respawnAt = respawnAt;
  loser.x = respawn.x;
  loser.y = respawn.y;
  loser.input = { x: 0, y: 0 };
}

export function simulateRoomMatchState(inputState, roomSnapshot, nowIso) {
  const state = syncPlayersWithRoom(cloneState(inputState), roomSnapshot);
  const nowMs = Date.parse(nowIso);
  const lastSimulatedAtMs = Date.parse(state.lastSimulatedAt || state.startedAt);
  const elapsedMs = clamp(nowMs - lastSimulatedAtMs, 0, 220);
  const dt = elapsedMs / 1000;

  if (state.phase === "finished") {
    state.lastSimulatedAt = nowIso;
    state.version += 1;
    state.leaderboard = buildLeaderboard(state.players);
    return state;
  }

  if (nowMs >= Date.parse(state.endsAt)) {
    state.phase = "finished";
    state.lastSimulatedAt = nowIso;
    state.tick += 1;
    state.version += 1;
    state.leaderboard = buildLeaderboard(state.players);
    state.winnerUserId = state.leaderboard[0]?.userId || null;
    return state;
  }

  if (dt > 0) {
    for (const player of state.players) {
      if (!player.alive) {
        if (player.respawnAt && Date.parse(player.respawnAt) <= nowMs) {
          player.alive = true;
          player.respawnAt = null;
        }
        continue;
      }

      const input = normalizeVector(player.input?.x ?? 0, player.input?.y ?? 0);
      const speed = moveSpeedForMass(player.mass, state.modeId);
      player.x = round(
        clamp(player.x + input.x * speed * dt, player.radius, WORLD_SIZE - player.radius),
      );
      player.y = round(
        clamp(player.y + input.y * speed * dt, player.radius, WORLD_SIZE - player.radius),
      );
    }

    for (const player of state.players) {
      if (!player.alive) {
        continue;
      }

      for (let index = 0; index < state.foods.length; index += 1) {
        const food = state.foods[index];
        const dx = player.x - food.x;
        const dy = player.y - food.y;
        const eatDistance = player.radius + FOOD_RADIUS;
        if (dx * dx + dy * dy <= eatDistance * eatDistance) {
          state.foods[index] = applyFoodCollision(player, food);
        }
      }
    }

    const alivePlayers = [...state.players]
      .filter((player) => player.alive)
      .sort((left, right) => right.mass - left.mass);

    for (let leftIndex = 0; leftIndex < alivePlayers.length; leftIndex += 1) {
      const larger = alivePlayers[leftIndex];
      if (!larger.alive) {
        continue;
      }

      for (
        let rightIndex = alivePlayers.length - 1;
        rightIndex > leftIndex;
        rightIndex -= 1
      ) {
        const smaller = alivePlayers[rightIndex];
        if (!smaller.alive || larger.userId === smaller.userId) {
          continue;
        }

        if (larger.mass < smaller.mass * 1.12) {
          continue;
        }

        const dx = larger.x - smaller.x;
        const dy = larger.y - smaller.y;
        const eatDistance = Math.max(
          larger.radius * 0.88,
          larger.radius - smaller.radius * 0.22,
        );
        if (dx * dx + dy * dy > eatDistance * eatDistance) {
          continue;
        }

        eliminatePlayer(larger, smaller, nowIso);
      }
    }
  }

  state.lastSimulatedAt = nowIso;
  state.tick += 1;
  state.version += 1;
  state.leaderboard = buildLeaderboard(state.players);
  state.winnerUserId = state.leaderboard[0]?.userId || null;
  return state;
}

export function applyRoomMatchInput(inputState, userId, rawInput, nowIso) {
  const state = cloneState(inputState);
  const player = state.players.find((entry) => entry.userId === userId);
  if (!player) {
    return state;
  }

  const safeMove = normalizeVector(rawInput?.moveX ?? 0, rawInput?.moveY ?? 0);
  player.input = {
    x: round(safeMove.x, 4),
    y: round(safeMove.y, 4),
  };
  player.lastInputAt = nowIso;
  player.lastSeenAt = nowIso;
  return state;
}

export function createPublicRoomMatchSnapshot(state, localPlayerId = null) {
  return {
    sessionId: state.sessionId,
    roomId: state.roomId,
    modeId: state.modeId,
    roomCode: state.roomCode || null,
    phase: state.phase,
    tick: state.tick,
    version: state.version,
    worldSize: state.worldSize,
    serverTime: state.lastSimulatedAt,
    startedAt: state.startedAt,
    endsAt: state.endsAt,
    winnerUserId: state.winnerUserId || null,
    leaderboard: state.leaderboard.map((entry) => ({ ...entry })),
    players: state.players.map((player) => ({
      userId: player.userId,
      nickname: player.nickname,
      color: player.color,
      accentColor: player.accentColor,
      x: round(player.x),
      y: round(player.y),
      mass: Math.floor(player.mass),
      radius: round(player.radius),
      score: player.score,
      alive: !!player.alive,
      respawnAt: player.respawnAt || null,
    })),
    foods: state.foods.map((food) => ({
      id: food.id,
      x: round(food.x),
      y: round(food.y),
      mass: Math.floor(food.mass),
    })),
    localPlayerId,
  };
}
