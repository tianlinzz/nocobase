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
  getMessageFromTool?: (
    feishuContext: unknown,
    args: { messageId: string },
  ) => Promise<{ status: 'success' | 'failure'; content: string }>;
};

export default defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  introduction: {
    title: `{{t("ai.tools.feishuGetMessage.title", { ns: "${pkg.name}" })}}`,
    about: `{{t("ai.tools.feishuGetMessage.about", { ns: "${pkg.name}" })}}`,
  },
  definition: {
    name: 'feishuGetMessage',
    description: 'Fetch the content of a Feishu message by ID using the current Feishu app context.',
    schema: z.object({
      messageId: z.string().min(1),
    }),
  },
  invoke: async (ctx: Context, args: { messageId: string }) => {
    const plugin = ctx.app.pm.get('feishu') as FeishuPluginShape | undefined;
    if (!plugin?.getMessageFromTool) {
      return { status: 'failure', content: 'plugin-feishu service not available' };
    }
    const stateContext = (ctx.state as { feishuContext?: unknown } | undefined)?.feishuContext;
    const valuesContext = (ctx.action?.params?.values as { feishuContext?: unknown } | undefined)?.feishuContext;
    const feishuContext = stateContext ?? valuesContext;
    if (!feishuContext) {
      return { status: 'failure', content: 'feishu context not available in this conversation' };
    }
    return plugin.getMessageFromTool(feishuContext, args);
  },
});
