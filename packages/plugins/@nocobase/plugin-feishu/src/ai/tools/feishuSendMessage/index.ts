/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { defineTools } from '@nocobase/ai';
import type { Context } from '@nocobase/actions';
import { z } from 'zod';
// @ts-ignore
import pkg from '../../../../package.json';

type FeishuPluginShape = {
  sendMessageFromTool?: (
    feishuContext: unknown,
    args: { receiveIdType: string; receiveId: string; content: string },
  ) => Promise<{ status: 'success' | 'failure'; content: string }>;
};

export default defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  introduction: {
    title: `{{t("ai.tools.feishuSendMessage.title", { ns: "${pkg.name}" })}}`,
    about: `{{t("ai.tools.feishuSendMessage.about", { ns: "${pkg.name}" })}}`,
  },
  definition: {
    name: 'feishuSendMessage',
    description: 'Send a Feishu message from the current Feishu app context.',
    schema: z.object({
      receiveIdType: z.enum(['open_id', 'user_id', 'union_id', 'chat_id']),
      receiveId: z.string().min(1),
      content: z.string().min(1),
    }),
  },
  invoke: async (
    ctx: Context,
    args: { receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'chat_id'; receiveId: string; content: string },
  ) => {
    const plugin = ctx.app.pm.get('feishu') as FeishuPluginShape | undefined;
    if (!plugin?.sendMessageFromTool) {
      return { status: 'failure', content: 'plugin-feishu service not available' };
    }
    const stateContext = (ctx.state as { feishuContext?: unknown } | undefined)?.feishuContext;
    const valuesContext = (ctx.action?.params?.values as { feishuContext?: unknown } | undefined)?.feishuContext;
    const feishuContext = stateContext ?? valuesContext;
    if (!feishuContext) {
      return { status: 'failure', content: 'feishu context not available in this conversation' };
    }
    return plugin.sendMessageFromTool(feishuContext, args);
  },
});
