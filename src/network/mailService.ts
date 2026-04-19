import type {
  CreateBanAppealRequest,
  CreateBanAppealResponse,
  GetInGameInboxResponse,
  MarkInGameMailReadResponse,
} from "../../shared-protocol/src/mail";
import { BaseService } from "./BaseService";

class MailService extends BaseService {
  async getInbox(): Promise<GetInGameInboxResponse> {
    return this.authGet<GetInGameInboxResponse>("/mail/inbox");
  }

  async markRead(mailId: string): Promise<MarkInGameMailReadResponse> {
    return this.authPost<MarkInGameMailReadResponse>(`/mail/${mailId}/read`);
  }

  async submitBanAppeal(
    payload: CreateBanAppealRequest,
  ): Promise<CreateBanAppealResponse> {
    return this.authPost<CreateBanAppealResponse, CreateBanAppealRequest>(
      "/mail/appeals",
      payload,
    );
  }
}

export const mailService = new MailService();
