/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildFeishuMessageContext } from '../message-context';
import type { ParsedMessage } from '../types';

const baseParsed: ParsedMessage = {
  eventId: 'ev_1',
  messageId: 'om_1',
  chatId: 'oc_1',
  chatType: 'p2p',
  senderOpenId: 'ou_user',
  senderName: 'Alice',
  createTime: 1700000000000,
  contentType: 'text',
  content: { type: 'text', text: 'hi' },
  mentions: [],
  isMentionBot: true,
};

function makeDeps(row: Record<string, unknown> | null) {
  const findOne = vi.fn().mockResolvedValue(row);
  const getRepository = vi.fn().mockReturnValue({ findOne });
  return {
    deps: { db: { getRepository } as { getRepository: (name: string) => { findOne: typeof findOne } } },
    getRepository,
    findOne,
  };
}

describe('buildFeishuMessageContext', () => {
  it('returns null when app not found', async () => {
    const { deps } = makeDeps(null);
    const result = await buildFeishuMessageContext(deps, { appId: 'app1', parsed: baseParsed });
    expect(result).toBeNull();
  });

  it('returns null when app status is disabled', async () => {
    const { deps } = makeDeps({
      app_id: 'app1',
      name: 'App',
      status: 'disabled',
      ai_employee_username: 'bot',
    });
    const result = await buildFeishuMessageContext(deps, { appId: 'app1', parsed: baseParsed });
    expect(result).toBeNull();
  });

  it('returns context with aiConfig=null when binding missing', async () => {
    const { deps } = makeDeps({
      app_id: 'app1',
      name: 'App One',
      status: 'active',
      ai_employee_username: null,
      ai_act_as_user_id: null,
    });
    const result = await buildFeishuMessageContext(deps, { appId: 'app1', parsed: baseParsed });
    expect(result).not.toBeNull();
    expect(result!.appId).toBe('app1');
    expect(result!.appName).toBe('App One');
    expect(result!.aiConfig).toBeNull();
  });

  it('returns context with aiConfig populated when binding present', async () => {
    const { deps } = makeDeps({
      app_id: 'app1',
      name: 'App One',
      status: 'active',
      ai_employee_username: 'bot-emp',
      ai_act_as_user_id: 42,
    });
    const result = await buildFeishuMessageContext(deps, { appId: 'app1', parsed: baseParsed });
    expect(result).not.toBeNull();
    expect(result!.aiConfig).toEqual({ employeeUsername: 'bot-emp', actAsUserId: 42 });
  });

  it('carries chatType from parsed message', async () => {
    const { deps } = makeDeps({
      app_id: 'app1',
      name: 'App One',
      status: 'active',
      ai_employee_username: 'bot',
      ai_act_as_user_id: 1,
    });
    const groupParsed: ParsedMessage = { ...baseParsed, chatType: 'group', chatId: 'oc_group' };
    const result = await buildFeishuMessageContext(deps, { appId: 'app1', parsed: groupParsed });
    expect(result!.chat).toMatchObject({ chatId: 'oc_group', chatType: 'group' });
  });
});
