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

export interface AIEmployeeRef {
  username: string;
}

export interface GetOrCreateSessionParams {
  appId: string;
  chatId: string;
  chatType: 'p2p' | 'group';
  senderOpenId: string;
  employee: AIEmployeeRef;
  /** Bound NocoBase user id (from feishu_user_bindings.actAsUserId), if any. */
  userId?: number | null;
}

/**
 * Minimal repo surface we exercise on `aiConversations`. Keeps the manager
 * unit-testable without dragging the whole NocoBase Database type in.
 */
interface AIConversationsRow {
  get: (key: string) => unknown;
}

interface AIConversationsRepository {
  findOne: (args: { filter: Record<string, unknown> }) => Promise<AIConversationsRow | null>;
  create: (args: { values: Record<string, unknown> }) => Promise<AIConversationsRow>;
}

export interface ConversationManagerDeps {
  db: { getRepository: (name: string) => AIConversationsRepository };
}

/**
 * Resolves the `aiConversations` row that backs a Feishu chat session.
 *
 * `aiConversations.sessionId` is a UUID primary key (auto-filled by
 * `UuidField` if absent), so we cannot use the synthesized
 * `feishu:appId:chatType:...` string as the session id directly. Instead we
 * persist that synthesized key in the existing `topicId` column and look up
 * the row by it; the row's UUID `sessionId` is what AIEmployee actually
 * needs (its `getCurrentThread` does a `findByTargetKey(sessionId)` and
 * throws "Conversation not existed" if no row matches).
 *
 * Race note: there is no DB-level unique constraint on `topicId`, so two
 * truly-simultaneous first messages from the same Feishu chat could each
 * create a row. In practice Feishu p2p messages from one user are sequential
 * (user → send → wait), so we accept the rare duplicate over a transactional
 * SELECT-FOR-UPDATE for now.
 */
export class FeishuConversationManager {
  constructor(private readonly deps: ConversationManagerDeps) {}

  async getOrCreateSession(params: GetOrCreateSessionParams): Promise<ConversationInfo> {
    const topicId = this.buildTopicId(params);
    const repo = this.deps.db.getRepository('aiConversations');

    const existing = await repo.findOne({ filter: { topicId } });
    if (existing) {
      return { sessionId: String(existing.get('sessionId')), isNew: false };
    }

    const created = await repo.create({
      values: {
        userId: params.userId ?? null,
        aiEmployee: { username: params.employee.username },
        thread: 1,
        from: 'main-agent',
        category: 'chat',
        topicId,
        options: {},
      },
    });
    return { sessionId: String(created.get('sessionId')), isNew: true };
  }

  /**
   * External correlator persisted in `aiConversations.topicId`. Including
   * the employee username scopes the row to one bot per (appId, chat),
   * so the same Feishu user can talk to multiple bots in distinct sessions.
   */
  private buildTopicId(params: GetOrCreateSessionParams): string {
    const tail = params.chatType === 'p2p' ? params.senderOpenId : params.chatId;
    return `feishu:${params.appId}:${params.chatType}:${tail}:${params.employee.username}`;
  }
}
