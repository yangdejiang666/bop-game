import type {
  GetSocialOverviewResponse,
  SearchSocialUserResponse,
  SocialOverview,
} from "../../shared-protocol/src/social";
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

export interface LobbyStatePayload {
  tasks: LobbyTask[];
  friends: LobbyFriend[];
  modeStatus: string;
  overview: SocialOverview | null;
}

/**
 * LobbyService 
 * 负责与后端通信获取大厅聚合数据（任务、在线好友等动态资讯）。
 * 目前处于联调阶段，提供了一套标准的异步 Mock 数据。
 * 稍后可将底层 Promise 替换成真正的 fetch 请求对接外网。
 */
class LobbyServiceImpl {
  public async fetchLobbyData(): Promise<LobbyStatePayload> {
    try {
      const social = await this.fetchSocialOverview();
      return {
        modeStatus: "已开放",
        tasks: this.buildTaskData(),
        friends: this.mapFriendsFromOverview(social),
        overview: social,
      };
    } catch {
      return this.mockData();
    }
  }

  async fetchSocialOverview(): Promise<SocialOverview> {
    const response: GetSocialOverviewResponse = await socialService.getOverview();
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

  private buildTaskData(): LobbyTask[] {
    return [
      {
        id: "task_1",
        icon: "radio_button_checked",
        title: "吞噬500个小球",
        progress: 376,
        total: 500,
        theme: "cyan",
      },
      {
        id: "task_2",
        icon: "groups",
        title: "获得1场团队赛胜利",
        progress: 0,
        total: 1,
        theme: "violet",
      },
      {
        id: "task_3",
        icon: "stars",
        title: "连续签到领奖励",
        progress: 1,
        total: 3,
        theme: "gold",
      },
    ];
  }

  private mockData(): LobbyStatePayload {
    return {
      modeStatus: "已开放",
      tasks: this.buildTaskData(),
      friends: [
        { id: "f_1", gameId: "100000001", name: "Pixie_Dust", status: "在线", accent: "#81ecff" },
        { id: "f_2", gameId: "100000002", name: "Glitch_King", status: "组队中", accent: "#c37fff" },
        { id: "f_3", gameId: "100000003", name: "VoidRunner", status: "空闲", accent: "#ffe483" },
        { id: "f_4", gameId: "100000004", name: "NeonShooter", status: "在线", accent: "#ff6b81" },
      ],
      overview: null,
    };
  }
}

export const lobbyService = new LobbyServiceImpl();
