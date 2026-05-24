/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, it, expect, vi } from 'vitest';
import { CardActionRouter } from '../card-action-router';

interface RouteCallParams {
  appId: string;
  eventId: string;
  messageId?: string;
  openMessageId?: string;
  actionKey: string;
  values?: Record<string, unknown>;
  senderOpenId: string;
  chatId: string;
  chatType: 'p2p' | 'group';
}

function makeRouter(
  opts: {
    tryRecord?: ReturnType<typeof vi.fn>;
    findByMessageId?: ReturnType<typeof vi.fn>;
    findByOpenMessageId?: ReturnType<typeof vi.fn>;
    getOrCreateSession?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const tryRecord = opts.tryRecord ?? vi.fn().mockResolvedValue(true);
  const findByMessageId = opts.findByMessageId ?? vi.fn().mockResolvedValue(null);
  const findByOpenMessageId = opts.findByOpenMessageId ?? vi.fn().mockResolvedValue(null);
  const getOrCreateSession = opts.getOrCreateSession ?? vi.fn().mockResolvedValue({ sessionId: 'sess', isNew: false });
  const router = new CardActionRouter({
    cardRecordService: {
      findByMessageId,
      findByOpenMessageId,
    } as any,
    cardActionDedup: { tryRecord } as any,
    conversationManager: { getOrCreateSession } as any,
  });
  return { router, tryRecord, findByMessageId, findByOpenMessageId, getOrCreateSession };
}

const baseParams: RouteCallParams = {
  appId: 'app1',
  eventId: 'ev1',
  messageId: 'm1',
  actionKey: 'do',
  senderOpenId: 'ou_x',
  chatId: 'oc_x',
  chatType: 'p2p',
};

describe('CardActionRouter.route', () => {
  it('returns duplicate when dedup tryRecord returns false', async () => {
    const { router } = makeRouter({ tryRecord: vi.fn().mockResolvedValue(false) });
    const result = await router.route(baseParams);
    expect(result).toEqual({ action: 'unknown', reason: 'duplicate' });
  });

  it('returns no-card-record when no record found', async () => {
    const { router } = makeRouter();
    const result = await router.route(baseParams);
    expect(result).toEqual({ action: 'unknown', reason: 'no-card-record' });
  });

  it('falls back to open_message_id lookup if message_id misses', async () => {
    const findByMessageId = vi.fn().mockResolvedValue(null);
    const findByOpenMessageId = vi.fn().mockResolvedValue({
      id: 1,
      card_schema_snapshot: {},
      callback_config_snapshot: { actions: [] },
      context: {},
    });
    const { router } = makeRouter({ findByMessageId, findByOpenMessageId });
    const result = await router.route({ ...baseParams, messageId: undefined, openMessageId: 'open1' });
    expect(findByOpenMessageId).toHaveBeenCalledWith('app1', 'open1');
    expect(result.action).toBe('unknown');
  });

  it('returns no-action-key when actionKey is empty', async () => {
    const findByMessageId = vi.fn().mockResolvedValue({
      id: 1,
      card_schema_snapshot: {},
      callback_config_snapshot: { actions: [{ action_key: 'a', handler: { kind: 'callback', name: 'n' } }] },
      context: {},
    });
    const { router } = makeRouter({ findByMessageId });
    const result = await router.route({ ...baseParams, actionKey: '' });
    expect(result).toEqual({ action: 'unknown', reason: 'no-action-key' });
  });

  it('returns unknown-action-key when actionKey not in config', async () => {
    const findByMessageId = vi.fn().mockResolvedValue({
      id: 1,
      card_schema_snapshot: {},
      callback_config_snapshot: { actions: [{ action_key: 'other', handler: { kind: 'callback', name: 'n' } }] },
      context: {},
    });
    const { router } = makeRouter({ findByMessageId });
    const result = await router.route({ ...baseParams, actionKey: 'do' });
    expect(result).toEqual({ action: 'unknown', reason: 'unknown-action-key' });
  });

  it('routes ai_continue: requests session and returns ai_continue', async () => {
    const cardRecord = {
      id: 9,
      card_schema_snapshot: {},
      callback_config_snapshot: {
        actions: [{ action_key: 'do', handler: { kind: 'ai_continue', prompt: 'continue' } }],
      },
      context: {},
    };
    const getOrCreateSession = vi.fn().mockResolvedValue({ sessionId: 'sess-1', isNew: true });
    const { router } = makeRouter({
      findByMessageId: vi.fn().mockResolvedValue(cardRecord),
      getOrCreateSession,
    });
    const result = await router.route(baseParams);
    expect(getOrCreateSession).toHaveBeenCalledWith({
      appId: 'app1',
      chatId: 'oc_x',
      chatType: 'p2p',
      senderOpenId: 'ou_x',
    });
    expect(result).toEqual({
      action: 'ai_continue',
      conversation: { sessionId: 'sess-1', isNew: true },
      input: 'continue',
      cardRecord,
    });
  });

  it('routes workflow', async () => {
    const cardRecord = {
      id: 9,
      card_schema_snapshot: {},
      callback_config_snapshot: {
        actions: [
          {
            action_key: 'do',
            handler: { kind: 'workflow', workflow_id: 'wf-1', params: { foo: 'bar' } },
          },
        ],
      },
      context: {},
    };
    const { router } = makeRouter({ findByMessageId: vi.fn().mockResolvedValue(cardRecord) });
    const result = await router.route(baseParams);
    expect(result).toEqual({
      action: 'workflow',
      workflowId: 'wf-1',
      params: { foo: 'bar' },
      cardRecord,
    });
  });

  it('routes callback', async () => {
    const cardRecord = {
      id: 9,
      card_schema_snapshot: {},
      callback_config_snapshot: {
        actions: [
          {
            action_key: 'do',
            handler: { kind: 'callback', name: 'doIt', params: { a: 1 } },
          },
        ],
      },
      context: {},
    };
    const { router } = makeRouter({ findByMessageId: vi.fn().mockResolvedValue(cardRecord) });
    const result = await router.route({ ...baseParams, values: { v: 2 } });
    expect(result).toEqual({
      action: 'callback',
      config: { name: 'doIt', params: { a: 1 } },
      values: { v: 2 },
      cardRecord,
    });
  });
});
