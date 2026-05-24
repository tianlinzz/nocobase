/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import type { ConversationInfo } from '../ai/conversation-manager';
import type { CardRecordRow } from './card-record-service';
import type { CardRouteResult } from './card-action-router';

export interface CardDispatchResult {
  toast?: unknown;
  cardUpdate?: unknown;
}

export interface AIBridgeForCard {
  handleCardContinue(params: {
    appId: string;
    conversation: ConversationInfo;
    input: string;
    cardRecord: CardRecordRow;
  }): Promise<CardDispatchResult>;
}

export interface WorkflowExecutorForCard {
  execute(params: {
    workflowId: string;
    params: Record<string, unknown>;
    cardRecord: CardRecordRow;
  }): Promise<CardDispatchResult>;
}

export interface CallbackHandlerForCard {
  handle(params: {
    name: string;
    params: Record<string, unknown>;
    values: Record<string, unknown>;
    cardRecord: CardRecordRow;
  }): Promise<CardDispatchResult>;
}

export type ActionLogResult = 'success' | 'failure' | 'duplicate';

export interface ActionLogPayload {
  appId: string;
  eventId: string;
  cardRecordId: number;
  messageId: string;
  actionKey: string;
  actionValues: Record<string, unknown>;
  executorOpenId: string;
  executorUserId?: number;
  result: ActionLogResult;
  resultDetail?: unknown;
}

export interface ActionLogService {
  record(payload: ActionLogPayload): Promise<void>;
}

export interface CardActionHandlerLogger {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  warn: (...args: any[]) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: (...args: any[]) => void;
}

export interface CardActionHandlerDeps {
  aiBridge?: AIBridgeForCard;
  workflowExecutor?: WorkflowExecutorForCard;
  callbackHandler?: CallbackHandlerForCard;
  actionLogService: ActionLogService;
  log: CardActionHandlerLogger;
}

export interface CardActionDispatchCtx {
  appId: string;
  eventId: string;
  messageId: string;
  actionKey: string;
  actionValues: Record<string, unknown>;
  executorOpenId: string;
  executorUserId?: number;
}

const IGNORED_TOAST: CardDispatchResult = { toast: { type: 'info', content: 'Card action ignored' } };

export class CardActionHandler {
  constructor(private readonly deps: CardActionHandlerDeps) {}

  async dispatch(route: CardRouteResult, ctx: CardActionDispatchCtx): Promise<CardDispatchResult> {
    if (route.action === 'unknown') {
      const result: ActionLogResult = route.reason === 'duplicate' ? 'duplicate' : 'failure';
      await this.recordSafe({
        ...this.basePayload(ctx, 0),
        result,
        resultDetail: { reason: route.reason },
      });
      return IGNORED_TOAST;
    }

    const cardRecordId = route.cardRecord.id;

    try {
      const branchResult = await this.runBranch(route, ctx);
      await this.recordSafe({
        ...this.basePayload(ctx, cardRecordId),
        result: 'success',
        resultDetail: branchResult,
      });
      return branchResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.log.error('[feishu] card action dispatch failed', err);
      await this.recordSafe({
        ...this.basePayload(ctx, cardRecordId),
        result: 'failure',
        resultDetail: { error: message },
      });
      return { toast: { type: 'error', content: `Card action failed: ${message}` } };
    }
  }

  private async runBranch(route: CardRouteResult, ctx: CardActionDispatchCtx): Promise<CardDispatchResult> {
    if (route.action === 'ai_continue') {
      if (!this.deps.aiBridge) {
        this.deps.log.warn('[feishu] aiBridge dep missing; cannot continue ai conversation', {
          appId: ctx.appId,
          actionKey: ctx.actionKey,
        });
        return { toast: { type: 'info', content: 'AI follow-up not yet wired' } };
      }
      return this.deps.aiBridge.handleCardContinue({
        appId: ctx.appId,
        conversation: route.conversation,
        input: route.input,
        cardRecord: route.cardRecord,
      });
    }
    if (route.action === 'workflow') {
      if (!this.deps.workflowExecutor) {
        this.deps.log.warn('[feishu] workflowExecutor dep missing; cannot run workflow', {
          appId: ctx.appId,
          actionKey: ctx.actionKey,
        });
        return { toast: { type: 'info', content: 'Workflow follow-up not yet wired' } };
      }
      return this.deps.workflowExecutor.execute({
        workflowId: route.workflowId,
        params: route.params,
        cardRecord: route.cardRecord,
      });
    }
    // callback branch
    if (!this.deps.callbackHandler) {
      this.deps.log.warn('[feishu] callbackHandler dep missing; cannot run callback', {
        appId: ctx.appId,
        actionKey: ctx.actionKey,
      });
      return { toast: { type: 'info', content: 'Callback handler not yet wired' } };
    }
    return this.deps.callbackHandler.handle({
      name: route.config.name,
      params: route.config.params,
      values: route.values,
      cardRecord: route.cardRecord,
    });
  }

  private basePayload(ctx: CardActionDispatchCtx, cardRecordId: number): Omit<ActionLogPayload, 'result'> {
    return {
      appId: ctx.appId,
      eventId: ctx.eventId,
      cardRecordId,
      messageId: ctx.messageId,
      actionKey: ctx.actionKey,
      actionValues: ctx.actionValues,
      executorOpenId: ctx.executorOpenId,
      executorUserId: ctx.executorUserId,
    };
  }

  private async recordSafe(payload: ActionLogPayload): Promise<void> {
    try {
      await this.deps.actionLogService.record(payload);
    } catch (err) {
      this.deps.log.error('[feishu] failed to write card action log', err);
    }
  }
}
