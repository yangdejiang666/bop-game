import {
  type DeveloperAccountsOverview,
  PROTOCOL_ERROR,
  sanitizePlayerProgression,
  type PublicUserCard,
  type UserBootstrapRequest,
  type UserBootstrapResponse,
  type UserSummary,
  type UserProfile,
} from "@bop/shared-protocol";
import {
  applyBootstrapFromLocal,
  getDeveloperAccountDigestByUserId,
  getDeveloperAccountStats,
  getPublicUserCardById,
  listRecentDeveloperAccounts,
  getUserSummaryById,
  normalizeNickname,
  updateUserProfile,
} from "../repositories/accountRepository.js";

const NICKNAME_MIN = 1;
const NICKNAME_MAX = 12;
const AVATAR_URL_MAX = 2_000_000;

function validateNickname(nickname: string): string {
  const safe = nickname.trim().slice(0, NICKNAME_MAX);
  if (safe.length < NICKNAME_MIN) {
    throw new Error(PROTOCOL_ERROR.USER_INVALID_NAME);
  }
  return safe;
}

function validateAvatarUrl(avatarUrl: string | null): string | null {
  if (avatarUrl === null) {
    return null;
  }
  if (avatarUrl.length > AVATAR_URL_MAX) {
    throw new Error(PROTOCOL_ERROR.USER_INVALID_AVATAR);
  }
  return avatarUrl;
}

export async function getUserSummary(userId: string): Promise<UserSummary> {
  const found = await getUserSummaryById(userId);
  if (!found) {
    throw new Error(PROTOCOL_ERROR.USER_NOT_FOUND);
  }
  return found.summary;
}

export async function getPublicUserCard(
  userId: string,
): Promise<PublicUserCard> {
  const found = await getPublicUserCardById(userId);
  if (!found) {
    throw new Error(PROTOCOL_ERROR.USER_NOT_FOUND);
  }
  return found;
}

export async function getDeveloperAccountsOverview(
  userId: string,
): Promise<DeveloperAccountsOverview> {
  const [stats, currentAccount, recentAccounts] = await Promise.all([
    getDeveloperAccountStats(),
    getDeveloperAccountDigestByUserId(userId),
    listRecentDeveloperAccounts(6),
  ]);

  return {
    stats,
    currentAccount,
    recentAccounts,
  };
}

export async function updateProfile(params: {
  userId: string;
  nickname?: string;
  avatarUrl?: string | null;
}): Promise<UserProfile> {
  const nextNickname =
    params.nickname === undefined ? undefined : validateNickname(params.nickname);
  const shouldSetAvatar = params.avatarUrl !== undefined;
  const nextAvatar = shouldSetAvatar
    ? validateAvatarUrl(params.avatarUrl ?? null)
    : undefined;

  const updated = await updateUserProfile({
    userId: params.userId,
    nickname: nextNickname,
    avatarUrl: nextAvatar,
    setAvatarUrl: shouldSetAvatar,
  });

  if (!updated) {
    throw new Error(PROTOCOL_ERROR.USER_NOT_FOUND);
  }

  return updated;
}

export async function bootstrapUserFromLocal(params: {
  userId: string;
  payload: UserBootstrapRequest;
}): Promise<UserBootstrapResponse> {
  const current = await getUserSummaryById(params.userId);
  if (!current) {
    throw new Error(PROTOCOL_ERROR.USER_NOT_FOUND);
  }

  let migrationApplied = false;
  if (!current.bootstrappedFromLocalAt) {
    const nickname =
      params.payload.nickname === undefined
        ? undefined
        : normalizeNickname(params.payload.nickname, current.summary.profile.nickname);
    const avatarUrl =
      params.payload.avatarUrl === undefined
        ? undefined
        : validateAvatarUrl(params.payload.avatarUrl ?? null);
    const progression = sanitizePlayerProgression(params.payload.progression);
    migrationApplied = await applyBootstrapFromLocal({
      userId: params.userId,
      nickname,
      avatarUrl,
      progression,
    });
  }

  const summary = await getUserSummaryById(params.userId);
  if (!summary) {
    throw new Error(PROTOCOL_ERROR.USER_NOT_FOUND);
  }

  return {
    summary: summary.summary,
    migrationApplied,
  };
}
