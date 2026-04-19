import type {
  QueueRatingSummary,
  RankingOverview,
  RankTier,
} from "../../shared-protocol/src/ranking";
import type {
  GetSocialOverviewResponse,
  SearchSocialUserResponse,
  SocialOverview,
} from "../../shared-protocol/src/social";
import type { UserSummary } from "../../shared-protocol/src/user";
import { authService } from "./authService";
import { rankingService } from "./rankingService";
import { socialService } from "./socialService";

export interface LobbyTask {
  id: string;
  icon: string;
  title: string;
  progress: number;
  total: number;
  theme: "cyan" | "violet" | "gold" | "neutral";
}

export interface LobbyFriend {
  id: string;
  userId?: string;
  gameId?: string;
  name: string;
  status: "在线" | "组队中" | "空闲" | "离线";
  accent: string;
}

export type LobbyModeSnapshotId =
  | "ranked"
  | "peak"
  | "classic"
  | "battleRoyale";

export interface LobbyModeMetric {
  label: string;
  value: string;
}

export interface LobbyModeSnapshot {
  status: string;
  metrics: LobbyModeMetric[];
  tags: string[];
  rankLabel?: string;
}

export interface LobbyStatePayload {
  tasks: LobbyTask[];
  friends: LobbyFriend[];
  modeStatus: string;
  overview: SocialOverview | null;
  summary: UserSummary | null;
  modeSnapshots: Partial<Record<LobbyModeSnapshotId, LobbyModeSnapshot>>;
}

class LobbyServiceImpl {
  public async fetchLobbyData(): Promise<LobbyStatePayload> {
    if (!authService.getSession()) {
      return this.buildEmptyPayload();
    }

    const [summaryResult, socialResult, rankingResult] = await Promise.allSettled([
      this.fetchAuthenticatedSummary(),
      this.fetchSocialOverview(),
      this.fetchRankingOverview(),
    ]);

    const summary =
      summaryResult.status === "fulfilled" ? summaryResult.value : null;
    const social =
      socialResult.status === "fulfilled" ? socialResult.value : null;
    const ranking =
      rankingResult.status === "fulfilled" ? rankingResult.value : null;
    const modeSnapshots = this.buildModeSnapshots(summary, ranking);

    return {
      modeStatus: this.resolveGlobalModeStatus(modeSnapshots),
      tasks: [],
      friends: social ? this.mapFriendsFromOverview(social) : [],
      overview: social,
      summary,
      modeSnapshots,
    };
  }

  async fetchSocialOverview(): Promise<SocialOverview> {
    const response: GetSocialOverviewResponse = await socialService.getOverview();
    return response.overview;
  }

  async fetchRankingOverview(): Promise<RankingOverview> {
    const response = await rankingService.getOverview();
    return response.overview;
  }

  async searchFriendByGameId(gameId: string): Promise<SearchSocialUserResponse["result"]> {
    const response = await socialService.searchByGameId(gameId);
    return response.result;
  }

  async sendFriendRequestByGameId(gameId: string) {
    return socialService.createFriendRequest(gameId);
  }

  async acceptFriendRequest(requestId: string) {
    return socialService.acceptFriendRequest(requestId);
  }

  async rejectFriendRequest(requestId: string) {
    return socialService.rejectFriendRequest(requestId);
  }

  async removeFriendByGameId(gameId: string) {
    return socialService.removeFriend(gameId);
  }

  async blockUserByGameId(gameId: string) {
    return socialService.blockUser(gameId);
  }

  async unblockUserByGameId(gameId: string) {
    return socialService.unblockUser(gameId);
  }

  private mapFriendsFromOverview(overview: SocialOverview): LobbyFriend[] {
    return overview.friends.slice(0, 6).map((friend) => ({
      id: friend.gameId,
      userId: friend.userId,
      gameId: friend.gameId,
      name: friend.nickname,
      status: friend.isOnline ? "在线" : "离线",
      accent: this.getAccentColor(friend.gameId),
    }));
  }

  private async fetchAuthenticatedSummary(): Promise<UserSummary> {
    const response = await authService.getMe();
    if (!response.ok) {
      throw new Error(response.error.message);
    }
    return response.data.summary;
  }

  private buildEmptyPayload(): LobbyStatePayload {
    return {
      modeStatus: "待登录",
      tasks: [],
      friends: [],
      overview: null,
      summary: null,
      modeSnapshots: {},
    };
  }

  private buildModeSnapshots(
    summary: UserSummary | null,
    ranking: RankingOverview | null,
  ): Partial<Record<LobbyModeSnapshotId, LobbyModeSnapshot>> {
    const currentSeasonName = ranking?.currentSeason?.name ?? "未开启";
    const queueById = new Map(
      (ranking?.queues ?? []).map((queue) => [queue.queueId, queue]),
    );
    const rankedQueue = queueById.get("ranked");
    const peakQueue = queueById.get("peak");
    const battleQueue = queueById.get("battleRoyale");
    const globalWinRate = this.formatWinRate(
      summary?.profile.totalWins ?? 0,
      summary?.profile.totalMatches ?? 0,
    );

    return {
      ranked: {
        status: rankedQueue ? "实时同步" : "暂无数据",
        rankLabel: this.formatQueueRankLabel(rankedQueue),
        metrics: [
          {
            label: "当前段位",
            value: this.formatQueueRankLabel(rankedQueue),
          },
          {
            label: "排位分",
            value: rankedQueue ? `${rankedQueue.rankScore}` : "暂无",
          },
          {
            label: "当前赛季",
            value: currentSeasonName,
          },
        ],
        tags: this.compactTags([
          rankedQueue ? `对局 ${rankedQueue.matchesPlayed}` : null,
          rankedQueue ? `胜率 ${this.formatQueueWinRate(rankedQueue)}` : null,
          rankedQueue?.bestLeaderboardPosition
            ? `榜位 #${rankedQueue.bestLeaderboardPosition}`
            : "未上榜",
        ]),
      },
      peak: {
        status: peakQueue ? "实时同步" : "暂无数据",
        rankLabel: this.formatQueueRankLabel(peakQueue),
        metrics: [
          {
            label: "当前榜位",
            value: peakQueue?.bestLeaderboardPosition
              ? `#${peakQueue.bestLeaderboardPosition}`
              : "未上榜",
          },
          {
            label: "巅峰分",
            value: peakQueue ? `${peakQueue.rankScore}` : "暂无",
          },
          {
            label: "当前赛季",
            value: currentSeasonName,
          },
        ],
        tags: this.compactTags([
          peakQueue ? `段位 ${this.formatQueueRankLabel(peakQueue)}` : null,
          peakQueue ? `胜率 ${this.formatQueueWinRate(peakQueue)}` : null,
          peakQueue ? `对局 ${peakQueue.matchesPlayed}` : null,
        ]),
      },
      classic: {
        status: summary ? "实时同步" : "暂无数据",
        rankLabel: this.formatQueueRankLabel(rankedQueue),
        metrics: [
          {
            label: "最佳纪录",
            value: summary ? this.formatMass(summary.profile.bestMass) : "暂无",
          },
          {
            label: "总场次",
            value: summary ? `${summary.profile.totalMatches}` : "暂无",
          },
          {
            label: "胜场",
            value: summary ? `${summary.profile.totalWins}` : "暂无",
          },
        ],
        tags: this.compactTags([
          summary ? `胜率 ${globalWinRate}` : null,
          summary ? `等级 Lv.${summary.profile.level}` : null,
          summary ? `金币 ${summary.profile.coins}` : null,
        ]),
      },
      battleRoyale: {
        status: summary || battleQueue ? "实时同步" : "暂无数据",
        rankLabel: this.formatQueueRankLabel(battleQueue),
        metrics: [
          {
            label: "最佳纪录",
            value: summary ? this.formatMass(summary.profile.bestMass) : "暂无",
          },
          {
            label: "总场次",
            value: battleQueue
              ? `${battleQueue.matchesPlayed}`
              : summary
                ? `${summary.profile.totalMatches}`
                : "暂无",
          },
          {
            label: "胜率",
            value: battleQueue
              ? this.formatQueueWinRate(battleQueue)
              : summary
                ? globalWinRate
                : "暂无",
          },
        ],
        tags: this.compactTags([
          battleQueue ? `分数 ${battleQueue.rankScore}` : null,
          battleQueue ? `段位 ${this.formatQueueRankLabel(battleQueue)}` : null,
          summary ? `金币 ${summary.profile.coins}` : null,
        ]),
      },
    };
  }

  private resolveGlobalModeStatus(
    snapshots: Partial<Record<LobbyModeSnapshotId, LobbyModeSnapshot>>,
  ): string {
    return (
      snapshots.ranked?.status ??
      snapshots.classic?.status ??
      "暂无数据"
    );
  }

  private getAccentColor(seed: string) {
    const palette = [
      "#81ecff",
      "#c37fff",
      "#ffe483",
      "#ff7d66",
      "#7effb4",
      "#6f90ff",
    ];
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    return palette[hash % palette.length];
  }

  private formatQueueRankLabel(queue: QueueRatingSummary | undefined): string {
    if (!queue) {
      return "暂无数据";
    }
    return `${this.localizeTier(queue.tier)} ${this.toRoman(queue.division)}`;
  }

  private formatQueueWinRate(queue: QueueRatingSummary): string {
    return `${(queue.winRate * 100).toFixed(1)}%`;
  }

  private formatWinRate(wins: number, matches: number): string {
    if (matches <= 0) {
      return "0.0%";
    }
    return `${((wins / matches) * 100).toFixed(1)}%`;
  }

  private localizeTier(tier: RankTier): string {
    switch (tier) {
      case "Bronze":
        return "青铜";
      case "Silver":
        return "白银";
      case "Gold":
        return "黄金";
      case "Platinum":
        return "铂金";
      case "Diamond":
        return "钻石";
      case "Master":
        return "大师";
      case "Grandmaster":
        return "宗师";
      default:
        return tier;
    }
  }

  private toRoman(division: number): string {
    switch (Math.max(1, Math.min(5, Math.floor(division)))) {
      case 1:
        return "I";
      case 2:
        return "II";
      case 3:
        return "III";
      case 4:
        return "IV";
      case 5:
        return "V";
      default:
        return "I";
    }
  }

  private formatMass(value: number): string {
    const safeValue = Math.max(0, Math.floor(value));
    if (safeValue >= 1_000_000) {
      return `${(safeValue / 1_000_000).toFixed(1)}M`;
    }
    return `${safeValue} kg`;
  }

  private compactTags(values: Array<string | null | undefined>): string[] {
    return values
      .map((value) => value?.trim() ?? "")
      .filter((value) => value.length > 0)
      .slice(0, 3);
  }
}

export const lobbyService = new LobbyServiceImpl();
