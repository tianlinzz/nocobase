/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it, vi } from 'vitest';
import { registerDiagnosticsActions } from '../diagnostics-actions';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ActionHandler = (ctx: any, next: () => Promise<void>) => Promise<void>;

interface CapturedActions {
  queue?: ActionHandler;
  connections?: ActionHandler;
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

describe('feishuDiagnostics actions', () => {
  it('queue: returns an apps array derived from messageQueue.getStats()', async () => {
    const { app, actions } = captureActions();
    registerDiagnosticsActions(app as never, {
      runtimeManager: { getOverview: vi.fn().mockReturnValue([]) },
      wsManager: { getConnectedAppIds: vi.fn().mockReturnValue([]) },
      messageQueue: {
        getStats: vi.fn().mockReturnValue({
          apps: { a1: { queueLength: 0, lastErrors: [] }, a2: { queueLength: 2, lastErrors: ['x'] } },
        }),
      },
    });
    const ctx: { body: unknown } = { body: undefined };
    await actions.queue?.(ctx, async () => undefined);
    expect(ctx.body).toEqual({
      apps: [
        { appId: 'a1', queueLength: 0, lastErrors: [] },
        { appId: 'a2', queueLength: 2, lastErrors: ['x'] },
      ],
    });
  });

  it('connections: returns connectedAppIds + overview', async () => {
    const overview = [{ appId: 'a1', state: 'running' as const, reconnectCount: 0 }];
    const { app, actions } = captureActions();
    registerDiagnosticsActions(app as never, {
      runtimeManager: { getOverview: vi.fn().mockReturnValue(overview) },
      wsManager: { getConnectedAppIds: vi.fn().mockReturnValue(['a1']) },
      messageQueue: { getStats: vi.fn().mockReturnValue({ apps: {} }) },
    });
    const ctx: { body: unknown } = { body: undefined };
    await actions.connections?.(ctx, async () => undefined);
    expect(ctx.body).toEqual({ connectedAppIds: ['a1'], overview });
  });
});
