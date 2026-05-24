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
import type { FeishuClientManager } from '../transport/feishu-client-manager';
import { FeishuApiError } from '../transport/types';

export interface AppActionsDeps {
  runtimeManager: Pick<FeishuAppRuntimeManager, 'start' | 'stop' | 'reload' | 'getOverview'>;
  secretService: Pick<SecretService, 'validate'>;
  // Optional dep so existing tests that don't need bot lookup keep working.
  clientManager?: Pick<FeishuClientManager, 'addApp' | 'removeApp' | 'getBotInfo'>;
  // Decryptor for stored secrets (AES). When omitted, falls back to the raw
  // string — keeps legacy tests passing without needing the encryptor wired.
  decryptSecret?: (value: unknown) => Promise<string | undefined>;
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
        const repo = ctx.db.getRepository(COLLECTION.apps);
        const row = await repo.findOne({ filter: { app_id: appId } });
        const json = row?.toJSON?.() as AppRowLike | undefined;
        if (!json) {
          ctx.status = 404;
          ctx.body = { ok: false, code: 'app_not_found', message: 'feishu app not found' };
          await next();
          return;
        }
        // Decrypt stored secret before handing to the SDK.
        const plainSecret = deps.decryptSecret ? await deps.decryptSecret(json.app_secret) : json.app_secret;
        if (!plainSecret) {
          ctx.body = {
            ok: false,
            code: 'invalid_secret',
            message: 'app_secret is empty or could not be decrypted — please re-enter the App Secret in the form',
          };
          await next();
          return;
        }
        try {
          await deps.secretService.validate({ appId: json.app_id, appSecret: plainSecret });
          // Validate succeeded — pull real bot identity (open_id, app_name) so
          // the UI can show the bound bot, and persist `last_connected_at` /
          // `last_error = null`. If the clientManager dep is not wired we skip
          // bot info gracefully (test environments).
          let botOpenId: string | undefined;
          let botName: string | undefined;
          if (deps.clientManager) {
            const probeAppId = `__probe__${json.app_id}__${Date.now()}`;
            try {
              deps.clientManager.addApp({ appId: probeAppId, appSecret: plainSecret });
              const info = await deps.clientManager.getBotInfo(probeAppId);
              botOpenId = info.botOpenId;
              botName = info.botName;
            } finally {
              deps.clientManager.removeApp(probeAppId);
            }
          }
          await repo.update({
            filter: { app_id: appId },
            values: {
              bot_open_id: botOpenId ?? json.app_id,
              bot_name: botName ?? null,
              last_connected_at: new Date(),
              last_error: null,
            },
          });
          ctx.body = { ok: true, botOpenId, botName };
        } catch (err) {
          if (err instanceof FeishuApiError) {
            // Persist the error so the operator can see it on the apps page.
            await repo
              .update({
                filter: { app_id: appId },
                values: { last_error: `[${err.code}] ${err.message}` },
              })
              .catch(() => undefined);
            ctx.body = { ok: false, code: err.code, message: err.message, requestId: err.requestId };
          } else {
            const message = err instanceof Error ? err.message : String(err);
            deps.log.warn(`feishu.app.testConnection.error ${appId} ${message}`);
            await repo.update({ filter: { app_id: appId }, values: { last_error: message } }).catch(() => undefined);
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
