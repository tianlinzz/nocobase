/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, it, expect } from 'vitest';
import { routeMessage } from '../message-router';
import type { FeishuMessageContext, ParsedMessage } from '../types';

const baseParsed: ParsedMessage = {
  eventId: 'ev_1',
  messageId: 'om_1',
  chatId: 'oc_1',
  chatType: 'p2p',
  senderOpenId: 'ou_user',
  createTime: 0,
  contentType: 'text',
  content: { type: 'text', text: 'hi' },
  mentions: [],
  isMentionBot: true,
};

const baseContext: FeishuMessageContext = {
  appId: 'app1',
  appName: 'App',
  sender: { openId: 'ou_user' },
  chat: { chatId: 'oc_1', chatType: 'p2p' },
  aiConfig: { employeeUsername: 'bot', actAsUserId: 1 },
};

describe('routeMessage', () => {
  it('returns ignore unsupported-message when context is null', () => {
    const result = routeMessage(baseParsed, null);
    expect(result).toEqual({ action: 'ignore', reason: 'unsupported-message' });
  });

  it('returns ignore no-ai-binding when aiConfig is null', () => {
    const result = routeMessage(baseParsed, { ...baseContext, aiConfig: null });
    expect(result).toEqual({ action: 'ignore', reason: 'no-ai-binding' });
  });

  it('returns ignore group-without-mention for group chat without bot mention', () => {
    const parsed: ParsedMessage = { ...baseParsed, chatType: 'group', isMentionBot: false };
    const ctx: FeishuMessageContext = { ...baseContext, chat: { chatId: 'oc_g', chatType: 'group' } };
    const result = routeMessage(parsed, ctx);
    expect(result).toEqual({ action: 'ignore', reason: 'group-without-mention' });
  });

  it('returns ai action for p2p with aiConfig', () => {
    const result = routeMessage(baseParsed, baseContext);
    expect(result.action).toBe('ai');
    if (result.action !== 'ai') throw new Error('expected ai');
    expect(result.context).toBe(baseContext);
  });

  it('returns ai action for group with bot mention', () => {
    const parsed: ParsedMessage = { ...baseParsed, chatType: 'group', isMentionBot: true };
    const ctx: FeishuMessageContext = { ...baseContext, chat: { chatId: 'oc_g', chatType: 'group' } };
    const result = routeMessage(parsed, ctx);
    expect(result.action).toBe('ai');
  });
});
