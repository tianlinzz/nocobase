/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import type { FeishuMessageContext, ParsedMessage, RouteDecision } from './types';

export function routeMessage(parsed: ParsedMessage, context: FeishuMessageContext | null): RouteDecision {
  if (!context) {
    return { action: 'ignore', reason: 'unsupported-message' };
  }
  if (!context.aiConfig) {
    return { action: 'ignore', reason: 'no-ai-binding' };
  }
  if (parsed.chatType === 'group' && !parsed.isMentionBot) {
    return { action: 'ignore', reason: 'group-without-mention' };
  }
  return { action: 'ai', context };
}
