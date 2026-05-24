/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import type { Context, Next } from '@nocobase/actions';
import type { Application } from '@nocobase/server';
import { COLLECTION } from '../constants';
import type { FeishuAppRuntimeManager } from '../app-runtime/app-runtime-manager';
import type { SecretService } from '../app-runtime/secret-service';
import { FeishuApiError } from '../transport/types';

export interface AppActionsDeps {
  runtimeManager: Pick<FeishuAppRuntimeManager, 'start' | 'stop' | 'reload' | 'getOverview'>;
  secretService: Pick<SecretService, 'validate'>;
  log: { warn: (msg: string) => void };
}

interface AppRowLike {
  app_id: string;
  app_secret: string;
  status?: string;
}

const readAppId = (ctx: Context): string | undefined => {
  const params = ctx.action?.params as { values?: Record<string, unknown>; filterByTk?: unknown } | undefined;
  const fromValues = params?.values?.appId;
  if (typeof fromValues === 'string' && fromValues.length > 0) return fromValues;
  if (typeof params?.filterByTk === 'string' && params.filterByTk.length > 0) return params.filterByTk;
  return undefined;
};

const failBadRequest = (ctx: Context, message: string): void => {
  ctx.status = 400;
  ctx.body = { ok: false, code: 'invalid_request', message };
};

export function registerAppActions(app: Application, deps: AppActionsDeps): void {
  app.resourceManager.define({
    name: 'feishuApps',
    actions: {
      testConnection: async (ctx: Context, next: Next) => {
        const appId = readAppId(ctx);
        if (!appId) {
          failBadRequest(ctx, 'appId is required');
          await next();
          return;
        }
        const row = await ctx.db.getRepository(COLLECTION.apps).findOne({ filter: { app_id: appId } });
        const json = row?.toJSON?.() as AppRowLike | undefined;
        if (!json) {
          ctx.status = 404;
          ctx.body = { ok: false, code: 'app_not_found', message: 'feishu app not found' };
          await next();
          return;
        }
        try {
          const result = await deps.secretService.validate({ appId: json.app_id, appSecret: json.app_secret });
          ctx.body = { ok: true, requestId: result.requestId };
        } catch (err) {
          if (err instanceof FeishuApiError) {
            ctx.body = { ok: false, code: err.code, message: err.message, requestId: err.requestId };
          } else {
            const message = err instanceof Error ? err.message : String(err);
            deps.log.warn(`feishu.app.testConnection.error ${appId} ${message}`);
            ctx.body = { ok: false, code: 'unknown', message };
          }
        }
        await next();
      },
      start: async (ctx: Context, next: Next) => {
        const appId = readAppId(ctx);
        if (!appId) {
          failBadRequest(ctx, 'appId is required');
          await next();
          return;
        }
        await deps.runtimeManager.start(appId);
        ctx.body = { ok: true };
        await next();
      },
      stop: async (ctx: Context, next: Next) => {
        const appId = readAppId(ctx);
        if (!appId) {
          failBadRequest(ctx, 'appId is required');
          await next();
          return;
        }
        await deps.runtimeManager.stop(appId);
        ctx.body = { ok: true };
        await next();
      },
      reload: async (ctx: Context, next: Next) => {
        const appId = readAppId(ctx);
        if (!appId) {
          failBadRequest(ctx, 'appId is required');
          await next();
          return;
        }
        await deps.runtimeManager.reload(appId);
        ctx.body = { ok: true };
        await next();
      },
      runtimeOverview: async (ctx: Context, next: Next) => {
        ctx.body = deps.runtimeManager.getOverview();
        await next();
      },
    },
  });
}
