/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it } from 'vitest';
import { FeishuConversationManager } from '../conversation-manager';

describe('FeishuConversationManager', () => {
  it('builds p2p sessionId using appId and senderOpenId', async () => {
    const mgr = new FeishuConversationManager();
    const info = await mgr.getOrCreateSession({
      appId: 'app1',
      chatId: 'oc_chat',
      chatType: 'p2p',
      senderOpenId: 'ou_user',
    });
    expect(info.sessionId).toBe('feishu:app1:p2p:ou_user');
    expect(info.isNew).toBe(true);
  });

  it('builds group sessionId using appId and chatId', async () => {
    const mgr = new FeishuConversationManager();
    const info = await mgr.getOrCreateSession({
      appId: 'app1',
      chatId: 'oc_group',
      chatType: 'group',
      senderOpenId: 'ou_user',
    });
    expect(info.sessionId).toBe('feishu:app1:group:oc_group');
    expect(info.isNew).toBe(true);
  });

  it('returns isNew=false on the second call with the same params', async () => {
    const mgr = new FeishuConversationManager();
    const params = {
      appId: 'app1',
      chatId: 'oc_chat',
      chatType: 'p2p' as const,
      senderOpenId: 'ou_user',
    };
    const first = await mgr.getOrCreateSession(params);
    const second = await mgr.getOrCreateSession(params);
    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(first.sessionId).toBe(second.sessionId);
  });

  it('treats different appIds as distinct sessions', async () => {
    const mgr = new FeishuConversationManager();
    const a = await mgr.getOrCreateSession({
      appId: 'app1',
      chatId: 'oc_chat',
      chatType: 'p2p',
      senderOpenId: 'ou_user',
    });
    const b = await mgr.getOrCreateSession({
      appId: 'app2',
      chatId: 'oc_chat',
      chatType: 'p2p',
      senderOpenId: 'ou_user',
    });
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.isNew).toBe(true);
    expect(b.isNew).toBe(true);
  });
});
