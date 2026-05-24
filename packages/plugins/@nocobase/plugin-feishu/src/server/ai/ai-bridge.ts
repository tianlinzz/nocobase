/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import type { Context } from '@nocobase/actions';
import type { Model } from '@nocobase/database';
import type { FeishuMessageContext, ParsedMessage } from '../message/types';
import type { ConversationInfo, FeishuConversationManager } from './conversation-manager';
import type { AIInvokeLogger, BuildAIInvokeContextAppLike } from './ai-context-factory';
import type { FeishuResponseRenderer } from './response-renderer';

interface AIEmployeeLike {
  invoke: (args: { userMessages: { role: 'user'; content: string }[] }) => Promise<unknown>;
}

export interface ModelRef {
  llmService: string;
  model: string;
}

export interface AIEmployeeConstructor {
  new (args: {
    ctx: Context;
    employee: Model;
    sessionId: string;
    /**
     * The LLM binding for this conversation. AIEmployee.buildChatContext reads
     * `this.model` and forwards it to AIManager.getLLMService — passing
     * undefined makes the AI plugin throw "LLM service not configured", so
     * we always resolve a model from the employee row before constructing.
     */
    model?: ModelRef;
  }): AIEmployeeLike;
}

interface AIPluginShape {
  aiEmployeesManager?: {
    getEmployee?: (username: string) => Promise<Model | null>;
    resolveModel?: (employee: Model, model?: ModelRef | null) => Promise<ModelRef>;
  };
  aiEmployees?: { findOne?: (args: { filter: { username: string } }) => Promise<Model | null> };
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

      // Resolve the LLM binding for this employee. Mirrors what
      // plugin-ai/.../resource/aiConversations.ts:368 does for the regular
      // chat surface — without this, AIEmployee.buildChatContext sees
      // `this.model = undefined` and throws "LLM service not configured".
      const resolvedModel = await this.resolveModel(employee);

      const textChunks: string[] = [];
      const ctx = await this.deps.contextFactory({
        app: this.deps.app,
        log: this.deps.log,
        feishuContext: context,
        actAsUserId: context.aiConfig.actAsUserId,
        streamWriter: (chunk) => collectContentChunks(chunk, textChunks),
      });

      const aiEmployee = new this.deps.AIEmployee({
        ctx,
        employee,
        sessionId: session.sessionId,
        model: resolvedModel,
      });
      const userText = parsed.content.type === 'text' ? parsed.content.text : '';
      const result = await aiEmployee.invoke({ userMessages: [{ role: 'user', content: userText }] });

      await this.deps.responseRenderer.render({
        parsed: { messageId: parsed.messageId, chatId: parsed.chatId },
        context: { appId, chat: { chatType: parsed.chatType } },
        aiOutput: { text: getResultText(result) ?? textChunks.join('') },
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

  private async findEmployee(username: string): Promise<Model | null> {
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

  /**
   * Resolve the LLM binding for an AI employee, with safe fallbacks:
   *   1. Prefer plugin-ai's own resolver — picks the first configured model
   *      under the employee's modelSettings, or the workspace default.
   *   2. If the resolver isn't exposed (older plugin-ai or alternative shape),
   *      read employee.modelSettings directly.
   *   3. If still no binding, throw a clear error so the operator sees
   *      "AI employee model not configured" instead of a generic SDK error.
   */
  private async resolveModel(employee: Model): Promise<ModelRef> {
    const aiPlugin = this.deps.app.pm.get('ai') as AIPluginShape | null | undefined;
    if (aiPlugin?.aiEmployeesManager?.resolveModel) {
      return aiPlugin.aiEmployeesManager.resolveModel(employee, null);
    }
    const settings = (employee.get?.('modelSettings') ??
      (employee as unknown as { modelSettings?: unknown }).modelSettings) as
      | {
          enabled?: boolean;
          llmService?: string;
          model?: string;
          models?: Array<{ llmService?: string; model?: string }>;
        }
      | undefined;
    if (settings?.enabled) {
      const fromList = (settings.models ?? []).find((m) => m?.llmService && m?.model);
      if (fromList?.llmService && fromList.model) {
        return { llmService: fromList.llmService, model: fromList.model };
      }
      if (settings.llmService && settings.model) {
        return { llmService: settings.llmService, model: settings.model };
      }
    }
    throw new Error('AI employee model not configured (set llmService + model in the AI Employees settings page)');
  }
}

function getResultText(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  return typeof result.text === 'string' ? result.text : undefined;
}

function collectContentChunks(chunk: string, chunks: string[]): void {
  for (const block of chunk.split('\n\n')) {
    const dataLine = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('data:'));
    if (!dataLine) continue;

    const rawPayload = dataLine.slice('data:'.length).trim();
    if (!rawPayload) continue;

    try {
      const payload = JSON.parse(rawPayload) as unknown;
      if (isRecord(payload) && payload.type === 'content' && typeof payload.body === 'string') {
        chunks.push(payload.body);
      }
    } catch {
      // Ignore malformed stream frames; the final render step will handle empty text.
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
