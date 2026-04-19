import type {
  CheckFeatureAccessRequest,
  CheckFeatureAccessResponse,
  FinishPlaytimeSessionRequest,
  FinishPlaytimeSessionResponse,
  GetDeveloperAccountsOverviewResponse,
  HeartbeatPlaytimeSessionRequest,
  HeartbeatPlaytimeSessionResponse,
  StartPlaytimeSessionRequest,
  StartPlaytimeSessionResponse,
  UserAuthorization,
  UserBootstrapRequest,
  UserBootstrapResponse,
} from "../../shared-protocol/src";
import { BaseService } from "./BaseService";

/**
 * 用户服务 — 本地引导配置、开发者账号概览。
 */
export class UserService extends BaseService {
  async bootstrapLocalProfile(
    payload: UserBootstrapRequest,
  ): Promise<UserBootstrapResponse> {
    return this.authPost<UserBootstrapResponse, UserBootstrapRequest>(
      "/user/bootstrap",
      payload,
    );
  }

  async getDeveloperAccountsOverview(): Promise<GetDeveloperAccountsOverviewResponse> {
    return this.authGet<GetDeveloperAccountsOverviewResponse>("/user/dev/accounts-overview");
  }

  async getAuthorization(): Promise<{ authorization: UserAuthorization }> {
    return this.authGet<{ authorization: UserAuthorization }>("/user/authorization");
  }

  async startPlaytimeSession(
    payload: StartPlaytimeSessionRequest,
  ): Promise<StartPlaytimeSessionResponse> {
    return this.authPost<StartPlaytimeSessionResponse, StartPlaytimeSessionRequest>(
      "/user/playtime/start",
      payload,
    );
  }

  async heartbeatPlaytimeSession(
    payload: HeartbeatPlaytimeSessionRequest,
  ): Promise<HeartbeatPlaytimeSessionResponse> {
    return this.authPost<HeartbeatPlaytimeSessionResponse, HeartbeatPlaytimeSessionRequest>(
      "/user/playtime/heartbeat",
      payload,
    );
  }

  async finishPlaytimeSession(
    payload: FinishPlaytimeSessionRequest,
  ): Promise<FinishPlaytimeSessionResponse> {
    return this.authPost<FinishPlaytimeSessionResponse, FinishPlaytimeSessionRequest>(
      "/user/playtime/finish",
      payload,
    );
  }

  async checkFeatureAccess(
    payload: CheckFeatureAccessRequest,
  ): Promise<CheckFeatureAccessResponse> {
    return this.authPost<CheckFeatureAccessResponse, CheckFeatureAccessRequest>(
      "/user/feature/check",
      payload,
    );
  }
}

export const userService = new UserService();
