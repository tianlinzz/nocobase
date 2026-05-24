/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

export interface Mention {
  key: string;
  id: {
    open_id?: string;
    user_id?: string;
    union_id?: string;
  };
  name?: string;
}

export type ParsedContent =
  | { type: 'text'; text: string }
  | { type: 'post'; title?: string; content: unknown }
  | { type: 'image'; imageKey: string }
  | { type: 'file'; fileKey: string; fileName?: string }
  | { type: 'interactive'; card: unknown }
  | { type: 'share_chat'; chatId: string }
  | { type: 'share_user'; userId: string };

export interface ParsedMessage {
  eventId: string;
  messageId: string;
  chatId: string;
  chatType: 'p2p' | 'group';
  senderOpenId: string;
  senderName?: string;
  createTime: number;
  contentType: ParsedContent['type'];
  content: ParsedContent;
  rootMessageId?: string;
  mentions: Mention[];
  isMentionBot: boolean;
}

export interface FeishuMessageContext {
  appId: string;
  appName: string;
  sender: { openId: string; name?: string; userId?: number };
  chat: { chatId: string; chatType: 'p2p' | 'group'; chatName?: string };
  aiConfig: { employeeUsername: string; actAsUserId?: number } | null;
}

export type RouteDecision =
  | { action: 'ai'; context: FeishuMessageContext }
  | {
      action: 'ignore';
      reason: 'no-ai-binding' | 'group-without-mention' | 'unsupported-message';
    };
