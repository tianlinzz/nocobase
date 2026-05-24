/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it, vi } from 'vitest';
import { buildAIInvokeContext } from '../ai-context-factory';
import type { FeishuMessageContext } from '../../message/types';

const sampleFeishuContext: FeishuMessageContext = {
  appId: 'app1',
  appName: 'App One',
  sender: { openId: 'ou_user', name: 'Alice' },
  chat: { chatId: 'oc_chat', chatType: 'p2p' },
  aiConfig: { employeeUsername: 'bot', actAsUserId: 7 },
};

function makeLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeApp(findOne: (...args: unknown[]) => Promise<unknown>) {
  const getRepository = vi.fn().mockReturnValue({ findOne });
  return {
    app: { db: { getRepository } } as unknown as { db: { getRepository: typeof getRepository } },
    getRepository,
  };
}

describe('buildAIInvokeContext', () => {
  it('without actAsUserId leaves auth.user null and exposes feishuContext', async () => {
    const { app } = makeApp(vi.fn());
    const log = makeLog();
    const ctx = await buildAIInvokeContext({
      app,
      log,
      feishuContext: sampleFeishuContext,
    });
    expect(ctx.app).toBe(app);
    expect(ctx.db).toBe(app.db);
    expect(ctx.log).toBe(log);
    expect(ctx.auth?.user).toBeNull();
    expect(ctx.state.currentUser).toBeNull();
    expect(ctx.state.feishuContext).toBe(sampleFeishuContext);
    expect(ctx.action.params.values.feishuContext).toBe(sampleFeishuContext);
  });

  it('with actAsUserId loads the user via repository and populates auth', async () => {
    const userRow = { id: 7, nickname: 'Alice', roles: [{ name: 'member' }, { name: 'admin' }] };
    const findOne = vi.fn().mockResolvedValue(userRow);
    const { app, getRepository } = makeApp(findOne);
    const log = makeLog();

    const ctx = await buildAIInvokeContext({
      app,
      log,
      feishuContext: sampleFeishuContext,
      actAsUserId: 7,
    });

    expect(getRepository).toHaveBeenCalledWith('users');
    expect(findOne).toHaveBeenCalledWith({ filterByTk: 7 });
    expect(ctx.auth?.user).toBe(userRow);
    expect(ctx.auth?.role).toBe('member');
    expect(ctx.auth?.roles).toEqual(['member', 'admin']);
    expect(ctx.state.currentUser).toBe(userRow);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('with actAsUserId but user not found leaves auth.user null and warns', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const { app } = makeApp(findOne);
    const log = makeLog();

    const ctx = await buildAIInvokeContext({
      app,
      log,
      feishuContext: sampleFeishuContext,
      actAsUserId: 99,
    });

    expect(ctx.auth?.user).toBeNull();
    expect(ctx.state.currentUser).toBeNull();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toMatch(/feishu ai context: actAsUserId 99 not found/);
  });
});
