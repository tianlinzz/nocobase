/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import type { Context } from '@nocobase/actions';
import type { FeishuMessageContext, ParsedMessage } from '../message/types';
import type { ConversationInfo, FeishuConversationManager } from './conversation-manager';
import type { AIInvokeLogger, BuildAIInvokeContextAppLike } from './ai-context-factory';
import type { FeishuResponseRenderer } from './response-renderer';

interface AIEmployeeLike {
  invoke: (args: {
    userMessages: { role: 'user'; content: string }[];
  }) => Promise<{ text?: string } | undefined | null>;
}

export interface AIEmployeeConstructor {
  new (args: { ctx: Context; employee: unknown; sessionId: string }): AIEmployeeLike;
}

interface AIPluginShape {
  aiEmployeesManager?: { getEmployee: (username: string) => Promise<unknown> };
  aiEmployees?: { findOne?: (args: { filter: { username: string } }) => Promise<unknown> };
}

export interface MessageLogRecordParams {
  appId: string;
  eventId: string;
  messageId: string;
  chatId: string;
  senderOpenId: string;
  messageType: string;
  routeAction: 'ai' | 'ignore';
  status: 'success' | 'failure' | 'ignored';
  aiSessionId?: string;
  error?: string;
}

export interface MessageLogService {
  record(params: MessageLogRecordParams): Promise<void>;
}

export interface AIBridgeAppLike extends BuildAIInvokeContextAppLike {
  pm: { get: (name: string) => unknown };
}

export interface AIBridgeContextFactory {
  (opts: {
    app: BuildAIInvokeContextAppLike;
    log: AIInvokeLogger;
    feishuContext: FeishuMessageContext;
    actAsUserId?: number;
  }): Promise<Context>;
}

export interface AIBridgeDeps {
  app: AIBridgeAppLike;
  log: AIInvokeLogger;
  conversationManager: FeishuConversationManager;
  contextFactory: AIBridgeContextFactory;
  responseRenderer: FeishuResponseRenderer;
  messageLogService: MessageLogService;
  AIEmployee: AIEmployeeConstructor;
}

/**
 * Bridge that turns a parsed Feishu message + its context into an AIEmployee
 * invocation and renders the resulting text back to Feishu.
 *
 * Failures from the AI side are logged via the messageLogService and rethrown
 * so the queue handler can apply its retry policy.
 */
export class FeishuAIBridge {
  constructor(private readonly deps: AIBridgeDeps) {}

  async handleMessage(appId: string, parsed: ParsedMessage, context: FeishuMessageContext): Promise<void> {
    if (context.aiConfig === null) {
      this.deps.log.info('feishu ai bridge: skipping message — no aiConfig bound', {
        appId,
        eventId: parsed.eventId,
      });
      await this.deps.messageLogService.record({
        appId,
        eventId: parsed.eventId,
        messageId: parsed.messageId,
        chatId: parsed.chatId,
        senderOpenId: parsed.senderOpenId,
        messageType: parsed.contentType,
        routeAction: 'ignore',
        status: 'ignored',
      });
      return;
    }

    let session: ConversationInfo | undefined;
    try {
      const employee = await this.findEmployee(context.aiConfig.employeeUsername);
      if (!employee) {
        const reason = `feishu ai bridge: employee not found (username=${context.aiConfig.employeeUsername})`;
        this.deps.log.warn(reason, { appId, eventId: parsed.eventId });
        await this.deps.messageLogService.record({
          appId,
          eventId: parsed.eventId,
          messageId: parsed.messageId,
          chatId: parsed.chatId,
          senderOpenId: parsed.senderOpenId,
          messageType: parsed.contentType,
          routeAction: 'ai',
          status: 'failure',
          error: reason,
        });
        return;
      }

      session = await this.deps.conversationManager.getOrCreateSession({
        appId,
        chatId: parsed.chatId,
        chatType: parsed.chatType,
        senderOpenId: parsed.senderOpenId,
      });

      const ctx = await this.deps.contextFactory({
        app: this.deps.app,
        log: this.deps.log,
        feishuContext: context,
        actAsUserId: context.aiConfig.actAsUserId,
      });

      const aiEmployee = new this.deps.AIEmployee({ ctx, employee, sessionId: session.sessionId });
      const userText = parsed.content.type === 'text' ? parsed.content.text : '';
      const result = await aiEmployee.invoke({ userMessages: [{ role: 'user', content: userText }] });

      await this.deps.responseRenderer.render({
        parsed: { messageId: parsed.messageId, chatId: parsed.chatId },
        context: { appId, chat: { chatType: parsed.chatType } },
        aiOutput: { text: result?.text },
      });

      await this.deps.messageLogService.record({
        appId,
        eventId: parsed.eventId,
        messageId: parsed.messageId,
        chatId: parsed.chatId,
        senderOpenId: parsed.senderOpenId,
        messageType: parsed.contentType,
        routeAction: 'ai',
        status: 'success',
        aiSessionId: session.sessionId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.log.error('feishu ai bridge: handleMessage failed', {
        appId,
        eventId: parsed.eventId,
        error: message,
      });
      await this.deps.messageLogService.record({
        appId,
        eventId: parsed.eventId,
        messageId: parsed.messageId,
        chatId: parsed.chatId,
        senderOpenId: parsed.senderOpenId,
        messageType: parsed.contentType,
        routeAction: 'ai',
        status: 'failure',
        aiSessionId: session?.sessionId,
        error: message,
      });
      throw err;
    }
  }

  private async findEmployee(username: string): Promise<unknown> {
    const aiPlugin = this.deps.app.pm.get('ai') as AIPluginShape | null | undefined;
    if (!aiPlugin) return null;
    if (aiPlugin.aiEmployeesManager?.getEmployee) {
      return aiPlugin.aiEmployeesManager.getEmployee(username);
    }
    if (aiPlugin.aiEmployees?.findOne) {
      return aiPlugin.aiEmployees.findOne({ filter: { username } });
    }
    return null;
  }
}
