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
import type { FeishuClientManager } from '../transport/feishu-client-manager';
import type { ReceiveIdType } from '../transport/types';
import { FeishuApiError } from '../transport/types';

export interface MessageActionsDeps {
  clientManager: Pick<FeishuClientManager, 'sendMessage' | 'replyMessage'>;
}

interface SendValues {
  appId?: string;
  receiveId?: string;
  receiveIdType?: ReceiveIdType;
  content?: unknown;
}

interface ReplyValues {
  appId?: string;
  messageId?: string;
  content?: unknown;
}

const readValues = <T>(ctx: Context): T | undefined => {
  const params = ctx.action?.params as { values?: T } | undefined;
  return params?.values;
};

const fail = (ctx: Context, status: number, code: string, message: string): void => {
  ctx.status = status;
  ctx.body = { ok: false, code, message };
};

const buildContent = (raw: unknown): unknown => {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') return { text: raw };
  return raw;
};

export function registerMessageActions(app: Application, deps: MessageActionsDeps): void {
  app.resourceManager.define({
    name: 'feishuMessages',
    actions: {
      send: async (ctx: Context, next: Next) => {
        const values = readValues<SendValues>(ctx);
        if (!values?.appId || !values.receiveId || !values.receiveIdType || values.content === undefined) {
          fail(ctx, 400, 'invalid_request', 'appId, receiveId, receiveIdType, content are required');
          await next();
          return;
        }
        try {
          const result = await deps.clientManager.sendMessage({
            appId: values.appId,
            receiveId: values.receiveId,
            receiveIdType: values.receiveIdType,
            msgType: 'text',
            content: buildContent(values.content),
          });
          ctx.body = { ok: true, messageId: result.messageId, requestId: result.requestId };
        } catch (err) {
          if (err instanceof FeishuApiError) {
            ctx.body = { ok: false, code: err.code, message: err.message, requestId: err.requestId };
          } else {
            const message = err instanceof Error ? err.message : String(err);
            ctx.body = { ok: false, code: 'unknown', message };
          }
        }
        await next();
      },
      reply: async (ctx: Context, next: Next) => {
        const values = readValues<ReplyValues>(ctx);
        if (!values?.appId || !values.messageId || values.content === undefined) {
          fail(ctx, 400, 'invalid_request', 'appId, messageId, content are required');
          await next();
          return;
        }
        try {
          const result = await deps.clientManager.replyMessage({
            appId: values.appId,
            messageId: values.messageId,
            msgType: 'text',
            content: buildContent(values.content),
          });
          ctx.body = { ok: true, messageId: result.messageId, requestId: result.requestId };
        } catch (err) {
          if (err instanceof FeishuApiError) {
            ctx.body = { ok: false, code: err.code, message: err.message, requestId: err.requestId };
          } else {
            const message = err instanceof Error ? err.message : String(err);
            ctx.body = { ok: false, code: 'unknown', message };
          }
        }
        await next();
      },
    },
  });
}
