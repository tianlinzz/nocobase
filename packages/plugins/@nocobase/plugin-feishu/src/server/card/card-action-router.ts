/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import type { ConversationInfo, GetOrCreateSessionParams } from '../ai/conversation-manager';
import type { CardRecordRow, CardRecordService } from './card-record-service';
import type { CardActionDedup } from './card-action-dedup';

export type CardActionHandlerSpec =
  | { kind: 'ai_continue'; prompt?: string }
  | { kind: 'workflow'; workflow_id: string; params?: Record<string, unknown> }
  | { kind: 'callback'; name: string; params?: Record<string, unknown> };

export interface CardCallbackConfigAction {
  action_key: string;
  handler: CardActionHandlerSpec;
}

export interface CardCallbackConfig {
  actions: CardCallbackConfigAction[];
}

export interface RouteCallParams {
  appId: string;
  eventId: string;
  messageId?: string;
  openMessageId?: string;
  actionKey: string;
  values?: Record<string, unknown>;
  senderOpenId: string;
  chatId: string;
  chatType: 'p2p' | 'group';
}

export type CardRouteResult =
  | { action: 'ai_continue'; conversation: ConversationInfo; input: string; cardRecord: CardRecordRow }
  | {
      action: 'workflow';
      workflowId: string;
      params: Record<string, unknown>;
      cardRecord: CardRecordRow;
    }
  | {
      action: 'callback';
      config: { name: string; params: Record<string, unknown> };
      values: Record<string, unknown>;
      cardRecord: CardRecordRow;
    }
  | {
      action: 'unknown';
      reason: 'no-card-record' | 'no-action-key' | 'unknown-action-key' | 'duplicate';
    };

export interface CardActionRouterDeps {
  cardRecordService: CardRecordService;
  cardActionDedup: CardActionDedup;
  conversationManager: {
    getOrCreateSession(params: GetOrCreateSessionParams): Promise<ConversationInfo>;
  };
}

function isCallbackConfig(value: unknown): value is CardCallbackConfig {
  if (!value || typeof value !== 'object') return false;
  const actions = (value as { actions?: unknown }).actions;
  return Array.isArray(actions);
}

export class CardActionRouter {
  constructor(private readonly deps: CardActionRouterDeps) {}

  async route(params: RouteCallParams): Promise<CardRouteResult> {
    const recorded = await this.deps.cardActionDedup.tryRecord(params.appId, params.eventId);
    if (!recorded) {
      return { action: 'unknown', reason: 'duplicate' };
    }

    let cardRecord: CardRecordRow | null = null;
    if (params.messageId) {
      cardRecord = await this.deps.cardRecordService.findByMessageId(params.appId, params.messageId);
    }
    if (!cardRecord && params.openMessageId) {
      cardRecord = await this.deps.cardRecordService.findByOpenMessageId(params.appId, params.openMessageId);
    }
    if (!cardRecord) {
      return { action: 'unknown', reason: 'no-card-record' };
    }

    if (!params.actionKey) {
      return { action: 'unknown', reason: 'no-action-key' };
    }

    const config = cardRecord.callback_config_snapshot;
    if (!isCallbackConfig(config)) {
      return { action: 'unknown', reason: 'unknown-action-key' };
    }
    const matched = config.actions.find((a) => a.action_key === params.actionKey);
    if (!matched) {
      return { action: 'unknown', reason: 'unknown-action-key' };
    }

    const handler = matched.handler;
    if (handler.kind === 'ai_continue') {
      const conversation = await this.deps.conversationManager.getOrCreateSession({
        appId: params.appId,
        chatId: params.chatId,
        chatType: params.chatType,
        senderOpenId: params.senderOpenId,
      });
      return {
        action: 'ai_continue',
        conversation,
        input: handler.prompt ?? '',
        cardRecord,
      };
    }
    if (handler.kind === 'workflow') {
      return {
        action: 'workflow',
        workflowId: handler.workflow_id,
        params: handler.params ?? {},
        cardRecord,
      };
    }
    return {
      action: 'callback',
      config: { name: handler.name, params: handler.params ?? {} },
      values: params.values ?? {},
      cardRecord,
    };
  }
}
