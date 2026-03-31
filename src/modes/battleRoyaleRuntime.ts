export type BattleRoyaleRedZonePhase = "idle" | "warning" | "active" | "cooldown";

export interface BattleRoyalePoint {
  x: number;
  y: number;
}

export interface BattleRoyaleRedZoneDefinition {
  id: string;
  center: BattleRoyalePoint;
  radius: number;
  warningStartSeconds: number;
  activeStartSeconds: number;
  activeEndSeconds: number;
  damagePerSecond: number;
}

export interface BattleRoyaleShieldStationDefinition {
  id: string;
  center: BattleRoyalePoint;
  pickupRadius: number;
  respawnSeconds: number;
  shieldAmount: number;
  shieldDurationSeconds: number;
}

export interface BattleRoyaleSpikeChainDefinition {
  id: string;
  nodes: BattleRoyalePoint[];
  virusMass: number;
}

export interface BattleRoyaleRuntimeDefinition {
  redZones: BattleRoyaleRedZoneDefinition[];
  shieldStations: BattleRoyaleShieldStationDefinition[];
  spikeChains: BattleRoyaleSpikeChainDefinition[];
}

function ratioPoint(worldSize: number, xRatio: number, yRatio: number): BattleRoyalePoint {
  return {
    x: Math.round(worldSize * xRatio),
    y: Math.round(worldSize * yRatio),
  };
}

function lineNodes(
  worldSize: number,
  startXRatio: number,
  startYRatio: number,
  endXRatio: number,
  endYRatio: number,
  count: number,
): BattleRoyalePoint[] {
  const safeCount = Math.max(2, count);
  const nodes: BattleRoyalePoint[] = [];
  for (let index = 0; index < safeCount; index += 1) {
    const t = index / (safeCount - 1);
    nodes.push(
      ratioPoint(
        worldSize,
        startXRatio + (endXRatio - startXRatio) * t,
        startYRatio + (endYRatio - startYRatio) * t,
      ),
    );
  }
  return nodes;
}

export function createBattleRoyaleRuntime(worldSize: number): BattleRoyaleRuntimeDefinition {
  return {
    redZones: [
      {
        id: "alpha",
        center: ratioPoint(worldSize, 0.24, 0.28),
        radius: Math.round(worldSize * 0.087),
        warningStartSeconds: 12,
        activeStartSeconds: 22,
        activeEndSeconds: 50,
        damagePerSecond: 11,
      },
      {
        id: "bravo",
        center: ratioPoint(worldSize, 0.72, 0.34),
        radius: Math.round(worldSize * 0.081),
        warningStartSeconds: 78,
        activeStartSeconds: 88,
        activeEndSeconds: 118,
        damagePerSecond: 13,
      },
      {
        id: "charlie",
        center: ratioPoint(worldSize, 0.48, 0.76),
        radius: Math.round(worldSize * 0.093),
        warningStartSeconds: 148,
        activeStartSeconds: 158,
        activeEndSeconds: 190,
        damagePerSecond: 15,
      },
      {
        id: "delta",
        center: ratioPoint(worldSize, 0.62, 0.55),
        radius: Math.round(worldSize * 0.072),
        warningStartSeconds: 220,
        activeStartSeconds: 228,
        activeEndSeconds: 262,
        damagePerSecond: 17,
      },
    ],
    shieldStations: [
      {
        id: "north-west",
        center: ratioPoint(worldSize, 0.19, 0.18),
        pickupRadius: 120,
        respawnSeconds: 36,
        shieldAmount: 88,
        shieldDurationSeconds: 14,
      },
      {
        id: "north-east",
        center: ratioPoint(worldSize, 0.81, 0.24),
        pickupRadius: 120,
        respawnSeconds: 36,
        shieldAmount: 88,
        shieldDurationSeconds: 14,
      },
      {
        id: "south-west",
        center: ratioPoint(worldSize, 0.27, 0.78),
        pickupRadius: 120,
        respawnSeconds: 42,
        shieldAmount: 96,
        shieldDurationSeconds: 16,
      },
      {
        id: "south-east",
        center: ratioPoint(worldSize, 0.76, 0.74),
        pickupRadius: 120,
        respawnSeconds: 42,
        shieldAmount: 96,
        shieldDurationSeconds: 16,
      },
    ],
    spikeChains: [
      {
        id: "north-canyon",
        nodes: lineNodes(worldSize, 0.31, 0.18, 0.44, 0.34, 5),
        virusMass: 520,
      },
      {
        id: "center-pass",
        nodes: lineNodes(worldSize, 0.56, 0.36, 0.68, 0.58, 6),
        virusMass: 540,
      },
      {
        id: "south-ridge",
        nodes: lineNodes(worldSize, 0.22, 0.69, 0.4, 0.83, 5),
        virusMass: 520,
      },
    ],
  };
}

export function resolveBattleRoyaleRedZonePhase(
  zone: BattleRoyaleRedZoneDefinition,
  elapsedSeconds: number,
): BattleRoyaleRedZonePhase {
  if (elapsedSeconds < zone.warningStartSeconds) {
    return "idle";
  }
  if (elapsedSeconds < zone.activeStartSeconds) {
    return "warning";
  }
  if (elapsedSeconds < zone.activeEndSeconds) {
    return "active";
  }
  return "cooldown";
}
