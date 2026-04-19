export type InGameMailCategory =
  | "ban_notice"
  | "ban_appeal"
  | "appeal_reply"
  | "system";

export type InGameMailSenderType = "system" | "player" | "admin";

export type InGameMailAppealStatus =
  | "none"
  | "pending"
  | "submitted"
  | "reviewing"
  | "resolved"
  | "rejected";

export interface InGameMailItem {
  id: string;
  threadId: string | null;
  ownerUserId: string;
  senderType: InGameMailSenderType;
  senderUserId: string | null;
  senderLabel: string;
  category: InGameMailCategory;
  subject: string;
  body: string;
  relatedBanId: string | null;
  appealStatus: InGameMailAppealStatus;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GetInGameInboxResponse {
  items: InGameMailItem[];
  unreadCount: number;
}

export interface MarkInGameMailReadResponse {
  success: true;
  mailId: string;
  readAt: string;
}

export interface CreateBanAppealRequest {
  banNoticeMailId: string;
  message: string;
}

export interface CreateBanAppealResponse {
  success: true;
  appealMailId: string;
  submittedAt: string;
}

export interface AdminListAppealsResponse {
  items: InGameMailItem[];
}

export interface AdminReplyAppealRequest {
  message: string;
  decision: "reviewing" | "resolved" | "rejected";
}

export interface AdminReplyAppealResponse {
  success: true;
  replyMailId: string;
}
