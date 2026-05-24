/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it, vi } from 'vitest';
import { FeishuConversationManager } from '../conversation-manager';

interface FakeRow {
  sessionId: string;
  topicId: string;
  userId: number | null;
  aiEmployeeUsername?: string;
}

/**
 * Tiny in-memory aiConversations repo good enough for the manager unit tests:
 * findOne supports `{ filter: { topicId } }`, create assigns a fake UUID and
 * stores the row.
 */
function makeRepo() {
  const rows: FakeRow[] = [];
  let counter = 0;
  const repo = {
    findOne: vi.fn(async ({ filter }: { filter: Record<string, unknown> }) => {
      const topicId = filter.topicId as string | undefined;
      const found = rows.find((r) => r.topicId === topicId);
      if (!found) return null;
      return {
        get: (key: string) => (found as Record<string, unknown>)[key],
      };
    }),
    create: vi.fn(async ({ values }: { values: Record<string, unknown> }) => {
      counter += 1;
      const sessionId = `uuid-${counter}`;
      const employee = values.aiEmployee as { username?: string } | undefined;
      const row: FakeRow = {
        sessionId,
        topicId: String(values.topicId ?? ''),
        userId: (values.userId as number | null) ?? null,
        aiEmployeeUsername: employee?.username,
      };
      rows.push(row);
      return {
        get: (key: string) => (row as Record<string, unknown>)[key],
      };
    }),
  };
  const db = { getRepository: vi.fn().mockReturnValue(repo) };
  return { db, repo, rows };
}

describe('FeishuConversationManager', () => {
  it('creates a new aiConversations row on first call and persists topicId for p2p', async () => {
    const { db, repo, rows } = makeRepo();
    const mgr = new FeishuConversationManager({ db });

    const info = await mgr.getOrCreateSession({
      appId: 'app1',
      chatId: 'oc_chat',
      chatType: 'p2p',
      senderOpenId: 'ou_user',
      employee: { username: 'bot' },
      userId: 42,
    });

    expect(info.isNew).toBe(true);
    expect(info.sessionId).toBe('uuid-1');
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(rows[0].topicId).toBe('feishu:app1:p2p:ou_user:bot');
    expect(rows[0].userId).toBe(42);
    expect(rows[0].aiEmployeeUsername).toBe('bot');
  });

  it('uses chatId (not senderOpenId) in the topicId for group chats', async () => {
    const { db, rows } = makeRepo();
    const mgr = new FeishuConversationManager({ db });

    await mgr.getOrCreateSession({
      appId: 'app1',
      chatId: 'oc_group',
      chatType: 'group',
      senderOpenId: 'ou_user',
      employee: { username: 'bot' },
    });

    expect(rows[0].topicId).toBe('feishu:app1:group:oc_group:bot');
  });

  it('returns the existing row on the second call with the same key (isNew=false, no second create)', async () => {
    const { db, repo } = makeRepo();
    const mgr = new FeishuConversationManager({ db });

    const params = {
      appId: 'app1',
      chatId: 'oc_chat',
      chatType: 'p2p' as const,
      senderOpenId: 'ou_user',
      employee: { username: 'bot' },
    };

    const first = await mgr.getOrCreateSession(params);
    const second = await mgr.getOrCreateSession(params);

    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(first.sessionId).toBe(second.sessionId);
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it('treats different employees in the same chat as distinct sessions', async () => {
    const { db, repo } = makeRepo();
    const mgr = new FeishuConversationManager({ db });

    const a = await mgr.getOrCreateSession({
      appId: 'app1',
      chatId: 'oc_chat',
      chatType: 'p2p',
      senderOpenId: 'ou_user',
      employee: { username: 'bot-a' },
    });
    const b = await mgr.getOrCreateSession({
      appId: 'app1',
      chatId: 'oc_chat',
      chatType: 'p2p',
      senderOpenId: 'ou_user',
      employee: { username: 'bot-b' },
    });

    expect(a.sessionId).not.toBe(b.sessionId);
    expect(repo.create).toHaveBeenCalledTimes(2);
  });

  it('treats different appIds as distinct sessions', async () => {
    const { db } = makeRepo();
    const mgr = new FeishuConversationManager({ db });

    const a = await mgr.getOrCreateSession({
      appId: 'app1',
      chatId: 'oc_chat',
      chatType: 'p2p',
      senderOpenId: 'ou_user',
      employee: { username: 'bot' },
    });
    const b = await mgr.getOrCreateSession({
      appId: 'app2',
      chatId: 'oc_chat',
      chatType: 'p2p',
      senderOpenId: 'ou_user',
      employee: { username: 'bot' },
    });

    expect(a.sessionId).not.toBe(b.sessionId);
  });
});
