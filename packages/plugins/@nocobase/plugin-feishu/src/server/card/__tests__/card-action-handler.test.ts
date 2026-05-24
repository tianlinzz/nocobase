/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, it, expect, vi } from 'vitest';
import { CardActionHandler } from '../card-action-handler';
import type { CardRouteResult } from '../card-action-router';

function makeBaseDeps() {
  const record = vi.fn().mockResolvedValue(undefined);
  const log = { warn: vi.fn(), error: vi.fn() };
  return { record, log };
}

const baseCtx = {
  appId: 'app1',
  eventId: 'ev1',
  messageId: 'm1',
  actionKey: 'do',
  actionValues: { v: 1 },
  executorOpenId: 'ou_x',
  executorUserId: 7,
};

const fakeCardRecord = { id: 99, card_schema_snapshot: {}, callback_config_snapshot: {}, context: {} };

describe('CardActionHandler.dispatch', () => {
  it('records duplicate when route is duplicate', async () => {
    const { record, log } = makeBaseDeps();
    const handler = new CardActionHandler({ actionLogService: { record }, log });
    const result = await handler.dispatch({ action: 'unknown', reason: 'duplicate' }, baseCtx);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'duplicate', appId: 'app1', eventId: 'ev1' }),
    );
    expect(result).toEqual({ toast: { type: 'info', content: 'Card action ignored' } });
  });

  it('records failure for other unknown reasons and returns toast', async () => {
    const { record, log } = makeBaseDeps();
    const handler = new CardActionHandler({ actionLogService: { record }, log });
    const result = await handler.dispatch({ action: 'unknown', reason: 'no-card-record' }, baseCtx);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ result: 'failure' }));
    expect(result).toEqual({ toast: { type: 'info', content: 'Card action ignored' } });
  });

  it('returns friendly toast and warns when ai_continue routed but aiBridge missing', async () => {
    const { record, log } = makeBaseDeps();
    const handler = new CardActionHandler({ actionLogService: { record }, log });
    const route: CardRouteResult = {
      action: 'ai_continue',
      conversation: { sessionId: 's', isNew: false },
      input: 'hi',
      cardRecord: fakeCardRecord,
    };
    const result = await handler.dispatch(route, baseCtx);
    expect(log.warn).toHaveBeenCalled();
    expect(result).toEqual({ toast: { type: 'info', content: 'AI follow-up not yet wired' } });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ result: 'success' }));
  });

  it('calls aiBridge for ai_continue and records success', async () => {
    const { record, log } = makeBaseDeps();
    const aiBridge = {
      handleCardContinue: vi.fn().mockResolvedValue({ toast: { type: 'success', content: 'ok' } }),
    };
    const handler = new CardActionHandler({ aiBridge, actionLogService: { record }, log });
    const route: CardRouteResult = {
      action: 'ai_continue',
      conversation: { sessionId: 's', isNew: true },
      input: 'continue',
      cardRecord: fakeCardRecord,
    };
    const result = await handler.dispatch(route, baseCtx);
    expect(aiBridge.handleCardContinue).toHaveBeenCalledWith({
      appId: 'app1',
      conversation: { sessionId: 's', isNew: true },
      input: 'continue',
      cardRecord: fakeCardRecord,
    });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ result: 'success' }));
    expect(result).toEqual({ toast: { type: 'success', content: 'ok' } });
  });

  it('records failure and returns error toast when workflow executor throws (no rethrow)', async () => {
    const { record, log } = makeBaseDeps();
    const workflowExecutor = {
      execute: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const handler = new CardActionHandler({ workflowExecutor, actionLogService: { record }, log });
    const route: CardRouteResult = {
      action: 'workflow',
      workflowId: 'wf-1',
      params: {},
      cardRecord: fakeCardRecord,
    };
    const result = await handler.dispatch(route, baseCtx);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ result: 'failure' }));
    expect(result).toEqual({ toast: { type: 'error', content: 'Card action failed: boom' } });
    expect(log.error).toHaveBeenCalled();
  });

  it('passes callback handler result through and records success', async () => {
    const { record, log } = makeBaseDeps();
    const callbackHandler = {
      handle: vi.fn().mockResolvedValue({ toast: { type: 'success', content: 'done' } }),
    };
    const handler = new CardActionHandler({ callbackHandler, actionLogService: { record }, log });
    const route: CardRouteResult = {
      action: 'callback',
      config: { name: 'doIt', params: { a: 1 } },
      values: { v: 2 },
      cardRecord: fakeCardRecord,
    };
    const result = await handler.dispatch(route, baseCtx);
    expect(callbackHandler.handle).toHaveBeenCalledWith({
      name: 'doIt',
      params: { a: 1 },
      values: { v: 2 },
      cardRecord: fakeCardRecord,
    });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ result: 'success' }));
    expect(result).toEqual({ toast: { type: 'success', content: 'done' } });
  });
});
