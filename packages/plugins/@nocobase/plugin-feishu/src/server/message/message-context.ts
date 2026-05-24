/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { COLLECTION } from '../constants';
import type { FeishuMessageContext, ParsedMessage } from './types';

interface FeishuAppRow {
  app_id: string;
  name?: string;
  status?: string;
  ai_employee_username?: string | null;
  ai_act_as_user_id?: number | null;
}

interface RepositoryLike {
  findOne: (args: { filter: Record<string, unknown> }) => Promise<FeishuAppRow | null>;
}

export interface BuildContextDeps {
  db: { getRepository: (name: string) => RepositoryLike };
}

export async function buildFeishuMessageContext(
  deps: BuildContextDeps,
  args: { appId: string; parsed: ParsedMessage },
): Promise<FeishuMessageContext | null> {
  const repo = deps.db.getRepository(COLLECTION.apps);
  const row = await repo.findOne({ filter: { app_id: args.appId } });
  if (!row) return null;
  if (row.status && row.status !== 'active') return null;

  const employeeUsername = row.ai_employee_username?.trim();
  const actAsUserId =
    typeof row.ai_act_as_user_id === 'number' && row.ai_act_as_user_id > 0 ? row.ai_act_as_user_id : undefined;

  const aiConfig = employeeUsername ? { employeeUsername, actAsUserId } : null;

  return {
    appId: row.app_id,
    appName: row.name || row.app_id,
    sender: {
      openId: args.parsed.senderOpenId,
      name: args.parsed.senderName,
    },
    chat: {
      chatId: args.parsed.chatId,
      chatType: args.parsed.chatType,
    },
    aiConfig,
  };
}
