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
import type { FeishuAppRuntimeManager } from '../app-runtime/app-runtime-manager';
import type { FeishuWebSocketManager } from '../transport/ws-connection-manager';
import type { FeishuMessageQueue } from '../message/message-queue';

export interface DiagnosticsActionsDeps {
  runtimeManager: Pick<FeishuAppRuntimeManager, 'getOverview'>;
  wsManager: Pick<FeishuWebSocketManager, 'getConnectedAppIds'>;
  messageQueue: Pick<FeishuMessageQueue, 'getStats'>;
}

export function registerDiagnosticsActions(app: Application, deps: DiagnosticsActionsDeps): void {
  app.resourceManager.define({
    name: 'feishuDiagnostics',
    actions: {
      queue: async (ctx: Context, next: Next) => {
        const stats = deps.messageQueue.getStats();
        const apps = Object.entries(stats.apps).map(([appId, info]) => ({
          appId,
          queueLength: info.queueLength,
          lastErrors: info.lastErrors,
        }));
        ctx.body = { apps };
        await next();
      },
      connections: async (ctx: Context, next: Next) => {
        ctx.body = {
          connectedAppIds: deps.wsManager.getConnectedAppIds(),
          overview: deps.runtimeManager.getOverview(),
        };
        await next();
      },
    },
  });
}
