export const PROGRESSION_STORAGE_KEY = 'bop:player-progression';

export interface PlayerProgression {
    level: number;
    currentXp: number;
    totalXp: number;
    coins: number;
    totalMatches: number;
    totalWins: number;
    bestMass: number;
}

export interface MatchRewardBreakdown {
    playerRank: number;
    playerMass: number;
    playerWon: boolean;
    isNewRecord: boolean;
    rankBaseXp: number;
    rankBaseCoins: number;
    massBonusXp: number;
    massBonusCoins: number;
    winBonusXp: number;
    winBonusCoins: number;
    recordBonusXp: number;
    recordBonusCoins: number;
    totalXp: number;
    totalCoins: number;
}

export interface ProgressionApplyResult {
    before: PlayerProgression;
    after: PlayerProgression;
    leveledUp: boolean;
    gainedLevels: number;
}

export const DEFAULT_PLAYER_PROGRESSION: PlayerProgression = {
    level: 1,
    currentXp: 0,
    totalXp: 0,
    coins: 0,
    totalMatches: 0,
    totalWins: 0,
    bestMass: 0
};

function clampNonNegativeInteger(value: number, fallback = 0): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(0, Math.floor(value));
}

export function getRequiredXpForLevel(level: number): number {
    const safeLevel = Math.max(1, Math.floor(level));
    return 140 + 60 * safeLevel + 8 * safeLevel * safeLevel;
}

export function sanitizePlayerProgression(raw?: Partial<PlayerProgression>): PlayerProgression {
    const source = raw ?? {};
    const level = Math.max(1, clampNonNegativeInteger(source.level ?? DEFAULT_PLAYER_PROGRESSION.level, 1));
    const currentXp = clampNonNegativeInteger(source.currentXp ?? DEFAULT_PLAYER_PROGRESSION.currentXp);
    const totalXp = clampNonNegativeInteger(source.totalXp ?? DEFAULT_PLAYER_PROGRESSION.totalXp);
    const coins = clampNonNegativeInteger(source.coins ?? DEFAULT_PLAYER_PROGRESSION.coins);
    const totalMatches = clampNonNegativeInteger(source.totalMatches ?? DEFAULT_PLAYER_PROGRESSION.totalMatches);
    const totalWins = clampNonNegativeInteger(source.totalWins ?? DEFAULT_PLAYER_PROGRESSION.totalWins);
    const bestMass = clampNonNegativeInteger(source.bestMass ?? DEFAULT_PLAYER_PROGRESSION.bestMass);

    return {
        level,
        currentXp,
        totalXp,
        coins,
        totalMatches,
        totalWins,
        bestMass
    };
}

export function clonePlayerProgression(source: PlayerProgression): PlayerProgression {
    return {
        level: source.level,
        currentXp: source.currentXp,
        totalXp: source.totalXp,
        coins: source.coins,
        totalMatches: source.totalMatches,
        totalWins: source.totalWins,
        bestMass: source.bestMass
    };
}

export function loadPlayerProgression(): PlayerProgression {
    try {
        const raw = window.localStorage.getItem(PROGRESSION_STORAGE_KEY);
        if (!raw) {
            return clonePlayerProgression(DEFAULT_PLAYER_PROGRESSION);
        }
        const parsed = JSON.parse(raw) as Partial<PlayerProgression>;
        return sanitizePlayerProgression(parsed);
    } catch (error) {
        console.error('Failed to load player progression:', error);
        return clonePlayerProgression(DEFAULT_PLAYER_PROGRESSION);
    }
}

export function savePlayerProgression(progression: PlayerProgression) {
    try {
        const safe = sanitizePlayerProgression(progression);
        window.localStorage.setItem(PROGRESSION_STORAGE_KEY, JSON.stringify(safe));
    } catch (error) {
        console.error('Failed to save player progression:', error);
    }
}

export function resetPlayerProgression(): PlayerProgression {
    const fresh = clonePlayerProgression(DEFAULT_PLAYER_PROGRESSION);
    savePlayerProgression(fresh);
    return fresh;
}

export function setPlayerProgression(next: Partial<PlayerProgression>): PlayerProgression {
    const merged = sanitizePlayerProgression({
        ...loadPlayerProgression(),
        ...next
    });
    savePlayerProgression(merged);
    return merged;
}

function getRankBaseReward(playerRank: number): { xp: number; coins: number } {
    if (playerRank <= 1) {
        return { xp: 320, coins: 260 };
    }
    if (playerRank === 2) {
        return { xp: 250, coins: 200 };
    }
    if (playerRank === 3) {
        return { xp: 200, coins: 150 };
    }
    if (playerRank >= 4 && playerRank <= 10) {
        return { xp: 150, coins: 110 };
    }
    return { xp: 110, coins: 80 };
}

export function computeMatchRewards(
    playerRank: number,
    playerMass: number,
    playerWon: boolean,
    isNewRecord: boolean
): MatchRewardBreakdown {
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
        totalCoins: rankBase.coins + massBonusCoins + winBonusCoins + recordBonusCoins
    };
}

export function applyMatchRewardsToProgression(
    before: PlayerProgression,
    reward: MatchRewardBreakdown
): ProgressionApplyResult {
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
        gainedLevels
    };
}

