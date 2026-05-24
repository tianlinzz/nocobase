/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import type { Context } from '@nocobase/actions';
import type { FeishuMessageContext } from '../message/types';

export interface AIInvokeLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

interface UserRecordLike {
  id?: number;
  roles?: Array<{ name?: string }> | null;
  [key: string]: unknown;
}

interface UsersRepositoryLike {
  findOne: (args: { filterByTk: number }) => Promise<UserRecordLike | null>;
}

interface DbLike {
  getRepository: (name: string) => UsersRepositoryLike;
}

export interface BuildAIInvokeContextAppLike {
  db: DbLike;
}

export interface BuildAIInvokeContextOptions {
  app: BuildAIInvokeContextAppLike;
  log: AIInvokeLogger;
  feishuContext: FeishuMessageContext;
  actAsUserId?: number;
  streamWriter?: (chunk: string) => void;
}

/**
 * Build a koa-like {@link Context} suitable for `new AIEmployee({ ctx, ... })`.
 *
 * The returned object only fills the fields the AI employee + tool adapter
 * touch in practice: `app`, `db`, `log`, `auth`, `state`, `action.params.values`.
 * The cast to `Context` is concentrated here so the rest of the bridge can rely
 * on the typed surface.
 */
export async function buildAIInvokeContext(opts: BuildAIInvokeContextOptions): Promise<Context> {
  const { app, log, feishuContext, actAsUserId, streamWriter } = opts;

  let user: UserRecordLike | null = null;
  if (typeof actAsUserId === 'number' && actAsUserId > 0) {
    try {
      const repo = app.db.getRepository('users');
      const found = await repo.findOne({ filterByTk: actAsUserId });
      if (found) {
        user = found;
      } else {
        log.warn(`feishu ai context: actAsUserId ${actAsUserId} not found`);
      }
    } catch (err) {
      log.warn(`feishu ai context: failed to load actAsUserId ${actAsUserId}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const userRoles = user?.roles;
  const roles = Array.isArray(userRoles) ? userRoles.map((r) => r?.name).filter((x): x is string => !!x) : [];
  const role = roles[0] ?? null;

  const ctxLike = {
    app,
    db: app.db,
    log,
    auth: { user, role, roles },
    state: {
      feishuContext,
      currentUser: user,
    },
    action: {
      params: {
        values: {
          feishuContext,
        },
      },
    },
    res: {
      write: (chunk: string) => {
        streamWriter?.(chunk);
      },
    },
  };

  return ctxLike as unknown as Context;
}
