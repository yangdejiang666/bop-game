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
  name: string;
  status: "在线" | "组队中" | "空闲" | "离线";
  accent: string;
}

export interface LobbyStatePayload {
  tasks: LobbyTask[];
  friends: LobbyFriend[];
  modeStatus: string;
}

/**
 * LobbyService 
 * 负责与后端通信获取大厅聚合数据（任务、在线好友等动态资讯）。
 * 目前处于联调阶段，提供了一套标准的异步 Mock 数据。
 * 稍后可将底层 Promise 替换成真正的 fetch 请求对接外网。
 */
class LobbyServiceImpl {
  public async fetchLobbyData(): Promise<LobbyStatePayload> {
    // 模拟网络延迟 300ms
    return new Promise((resolve) => setTimeout(() => resolve(this.mockData()), 300));
  }

  // 未来：增加单点接管好友邀请接口、每日任务领取接口的方法
  
  private mockData(): LobbyStatePayload {
    return {
      modeStatus: "已开放",
      tasks: [
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
        // [动态联调] 新增的一个网络任务，以验证视图刷新效果
        {
          id: "task_3",
          icon: "stars",
          title: "连续签到领奖励",
          progress: 1,
          total: 3,
          theme: "gold",
        }
      ],
      friends: [
        { id: "f_1", name: "Pixie_Dust", status: "在线", accent: "#81ecff" },
        { id: "f_2", name: "Glitch_King", status: "组队中", accent: "#c37fff" },
        { id: "f_3", name: "VoidRunner", status: "空闲", accent: "#ffe483" },
        // [动态联调] 比静态多一个好友
        { id: "f_4", name: "NeonShooter", status: "在线", accent: "#ff6b81" },
      ]
    };
  }
}

export const lobbyService = new LobbyServiceImpl();
