/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it, vi } from 'vitest';
import { registerMessageActions } from '../message-actions';
import { FeishuApiError } from '../../transport/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ActionHandler = (ctx: any, next: () => Promise<void>) => Promise<void>;

interface CapturedActions {
  send?: ActionHandler;
  reply?: ActionHandler;
}

function captureActions(): {
  app: { resourceManager: { define: (opts: { actions: CapturedActions }) => void } };
  actions: CapturedActions;
} {
  const actions: CapturedActions = {};
  return {
    actions,
    app: {
      resourceManager: {
        define: (opts: { actions: CapturedActions }) => {
          Object.assign(actions, opts.actions);
        },
      },
    },
  };
}

const buildCtx = (params: Record<string, unknown> = {}) => ({
  action: { params },
  status: 200,
  body: undefined as unknown,
});

describe('feishuMessages actions', () => {
  it('send: success path returns messageId', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_1', requestId: 'rid' });
    const replyMessage = vi.fn();
    const { app, actions } = captureActions();
    registerMessageActions(app as never, { clientManager: { sendMessage, replyMessage } });
    const ctx = buildCtx({
      values: { appId: 'a1', receiveId: 'ou_1', receiveIdType: 'open_id', content: { text: 'hi' } },
    });
    await actions.send?.(ctx, async () => undefined);
    expect(sendMessage).toHaveBeenCalledWith({
      appId: 'a1',
      receiveId: 'ou_1',
      receiveIdType: 'open_id',
      msgType: 'text',
      content: { text: 'hi' },
    });
    expect(ctx.body).toEqual({ ok: true, messageId: 'om_1', requestId: 'rid' });
  });

  it('send: rejects with 400 when required fields missing', async () => {
    const sendMessage = vi.fn();
    const replyMessage = vi.fn();
    const { app, actions } = captureActions();
    registerMessageActions(app as never, { clientManager: { sendMessage, replyMessage } });
    const ctx = buildCtx({ values: { appId: 'a1' } });
    await actions.send?.(ctx, async () => undefined);
    expect(ctx.status).toBe(400);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('send: maps FeishuApiError to ok:false with code', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new FeishuApiError('rejected', 1234, 'rid-x'));
    const { app, actions } = captureActions();
    registerMessageActions(app as never, { clientManager: { sendMessage, replyMessage: vi.fn() } });
    const ctx = buildCtx({
      values: { appId: 'a1', receiveId: 'ou_1', receiveIdType: 'open_id', content: 'hello' },
    });
    await actions.send?.(ctx, async () => undefined);
    expect(ctx.body).toMatchObject({ ok: false, code: 1234, message: 'rejected', requestId: 'rid-x' });
  });

  it('reply: success path', async () => {
    const replyMessage = vi.fn().mockResolvedValue({ messageId: 'om_reply' });
    const { app, actions } = captureActions();
    registerMessageActions(app as never, { clientManager: { sendMessage: vi.fn(), replyMessage } });
    const ctx = buildCtx({ values: { appId: 'a1', messageId: 'om_orig', content: 'reply text' } });
    await actions.reply?.(ctx, async () => undefined);
    expect(replyMessage).toHaveBeenCalledWith({
      appId: 'a1',
      messageId: 'om_orig',
      msgType: 'text',
      content: { text: 'reply text' },
    });
    expect(ctx.body).toMatchObject({ ok: true, messageId: 'om_reply' });
  });

  it('reply: rejects with 400 when required fields missing', async () => {
    const { app, actions } = captureActions();
    registerMessageActions(app as never, {
      clientManager: { sendMessage: vi.fn(), replyMessage: vi.fn() },
    });
    const ctx = buildCtx({ values: { appId: 'a1' } });
    await actions.reply?.(ctx, async () => undefined);
    expect(ctx.status).toBe(400);
  });
});
