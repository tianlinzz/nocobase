/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it, vi } from 'vitest';
import { registerAppActions } from '../app-actions';
import { FeishuApiError } from '../../transport/types';

// Heterogeneous handler signature; `as any` kept narrow to the test glue
// because building a full koa Context here adds noise without coverage.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ActionHandler = (ctx: any, next: () => Promise<void>) => Promise<void>;

interface CapturedActions {
  testConnection?: ActionHandler;
  start?: ActionHandler;
  stop?: ActionHandler;
  reload?: ActionHandler;
  runtimeOverview?: ActionHandler;
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

const buildCtx = (params: Record<string, unknown> = {}, repo?: { findOne: ReturnType<typeof vi.fn> }) => {
  const ctx: Record<string, unknown> = {
    action: { params },
    db: repo ? { getRepository: vi.fn().mockReturnValue(repo) } : undefined,
    body: undefined,
    status: 200,
  };
  return ctx;
};

describe('feishuApps actions', () => {
  it('testConnection: ok path returns { ok: true }', async () => {
    const repo = {
      findOne: vi.fn().mockResolvedValue({ toJSON: () => ({ app_id: 'a1', app_secret: 'sec', status: 'active' }) }),
    };
    const { app, actions } = captureActions();
    const validate = vi.fn().mockResolvedValue({ requestId: 'rid-1' });
    registerAppActions(app as never, {
      runtimeManager: {
        start: vi.fn(),
        stop: vi.fn(),
        reload: vi.fn(),
        getOverview: vi.fn().mockReturnValue([]),
      },
      secretService: { validate },
      log: { warn: vi.fn() },
    });
    const ctx = buildCtx({ values: { appId: 'a1' } }, repo);
    await actions.testConnection?.(ctx, async () => undefined);
    expect(validate).toHaveBeenCalledWith({ appId: 'a1', appSecret: 'sec' });
    expect(ctx.body).toEqual({ ok: true, requestId: 'rid-1' });
  });

  it('testConnection: row missing returns 404 + ok:false and never includes secret', async () => {
    const repo = { findOne: vi.fn().mockResolvedValue(null) };
    const { app, actions } = captureActions();
    const validate = vi.fn();
    registerAppActions(app as never, {
      runtimeManager: { start: vi.fn(), stop: vi.fn(), reload: vi.fn(), getOverview: vi.fn().mockReturnValue([]) },
      secretService: { validate },
      log: { warn: vi.fn() },
    });
    const ctx = buildCtx({ values: { appId: 'missing' } }, repo);
    await actions.testConnection?.(ctx, async () => undefined);
    expect(ctx.status).toBe(404);
    expect((ctx.body as { ok: boolean }).ok).toBe(false);
    expect(validate).not.toHaveBeenCalled();
  });

  it('testConnection: FeishuApiError mapped to ok:false with code, no secret leak', async () => {
    const secret = 'super-secret-value';
    const repo = {
      findOne: vi.fn().mockResolvedValue({ toJSON: () => ({ app_id: 'a1', app_secret: secret, status: 'active' }) }),
    };
    const { app, actions } = captureActions();
    const validate = vi.fn().mockRejectedValue(new FeishuApiError('upstream rejected', 99991663, 'rid-x'));
    registerAppActions(app as never, {
      runtimeManager: { start: vi.fn(), stop: vi.fn(), reload: vi.fn(), getOverview: vi.fn().mockReturnValue([]) },
      secretService: { validate },
      log: { warn: vi.fn() },
    });
    const ctx = buildCtx({ values: { appId: 'a1' } }, repo);
    await actions.testConnection?.(ctx, async () => undefined);
    expect((ctx.body as { ok: boolean; code: number }).ok).toBe(false);
    expect((ctx.body as { code: number }).code).toBe(99991663);
    expect(JSON.stringify(ctx.body)).not.toContain(secret);
  });

  it('testConnection: rejects without appId', async () => {
    const { app, actions } = captureActions();
    registerAppActions(app as never, {
      runtimeManager: { start: vi.fn(), stop: vi.fn(), reload: vi.fn(), getOverview: vi.fn().mockReturnValue([]) },
      secretService: { validate: vi.fn() },
      log: { warn: vi.fn() },
    });
    const ctx = buildCtx({});
    await actions.testConnection?.(ctx, async () => undefined);
    expect(ctx.status).toBe(400);
  });

  it('start / stop / reload route to runtimeManager', async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const stop = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn().mockResolvedValue(undefined);
    const { app, actions } = captureActions();
    registerAppActions(app as never, {
      runtimeManager: { start, stop, reload, getOverview: vi.fn().mockReturnValue([]) },
      secretService: { validate: vi.fn() },
      log: { warn: vi.fn() },
    });
    await actions.start?.(buildCtx({ values: { appId: 'a1' } }), async () => undefined);
    await actions.stop?.(buildCtx({ values: { appId: 'a1' } }), async () => undefined);
    await actions.reload?.(buildCtx({ values: { appId: 'a1' } }), async () => undefined);
    expect(start).toHaveBeenCalledWith('a1');
    expect(stop).toHaveBeenCalledWith('a1');
    expect(reload).toHaveBeenCalledWith('a1');
  });

  it('runtimeOverview returns the current overview list', async () => {
    const overview = [{ appId: 'a1', state: 'running' as const, reconnectCount: 0 }];
    const { app, actions } = captureActions();
    registerAppActions(app as never, {
      runtimeManager: {
        start: vi.fn(),
        stop: vi.fn(),
        reload: vi.fn(),
        getOverview: vi.fn().mockReturnValue(overview),
      },
      secretService: { validate: vi.fn() },
      log: { warn: vi.fn() },
    });
    const ctx = buildCtx();
    await actions.runtimeOverview?.(ctx, async () => undefined);
    expect(ctx.body).toBe(overview);
  });
});
