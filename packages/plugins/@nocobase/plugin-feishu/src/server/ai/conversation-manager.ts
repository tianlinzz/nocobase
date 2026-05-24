/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

export interface ConversationInfo {
  sessionId: string;
  isNew: boolean;
}

export interface GetOrCreateSessionParams {
  appId: string;
  chatId: string;
  chatType: 'p2p' | 'group';
  senderOpenId: string;
}

/**
 * In-memory tracker for Feishu → AI conversation sessionIds.
 *
 * Phase 4 keeps no persistence here; the plan-ai layer maintains the actual
 * `aiConversations` row. We only need to know whether this process has seen
 * the sessionId before so the bridge can mark "new" sessions for downstream
 * logic (e.g. greeting messages in later phases).
 */
export class FeishuConversationManager {
  private readonly known = new Set<string>();

  async getOrCreateSession(params: GetOrCreateSessionParams): Promise<ConversationInfo> {
    const sessionId = this.buildSessionId(params);
    const isNew = !this.known.has(sessionId);
    if (isNew) {
      this.known.add(sessionId);
    }
    return { sessionId, isNew };
  }

  private buildSessionId(params: GetOrCreateSessionParams): string {
    if (params.chatType === 'p2p') {
      return `feishu:${params.appId}:p2p:${params.senderOpenId}`;
    }
    return `feishu:${params.appId}:group:${params.chatId}`;
  }
}
