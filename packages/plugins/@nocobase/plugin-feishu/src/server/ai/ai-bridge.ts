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
import type { FeishuCardKitClient } from '../transport/feishu-cardkit-client';
import { StreamingCardController } from './streaming-card-controller';
import { parseSSEFrames } from './sse-frame-parser';

/**
 * AIEmployee.invoke expects each user message's `content` to be the wrapped
 * `AIMessageContent` object `{ type, content }` — not a raw string. (See
 * `plugin-ai/.../types/ai-message.type.ts:30` and the canonical workflow node
 * usage at `plugin-ai/.../workflow/nodes/employee/index.ts:160`.) Passing a
 * raw string makes `formatMessages` destructure `let { content } = msg.content`
 * to `undefined`, so the user input silently drops on the floor.
 */
interface AIMessageContentLike {
  type: 'text';
  content: string;
}

interface AIEmployeeLike {
  invoke: (args: { userMessages: { role: 'user'; content: AIMessageContentLike }[] }) => Promise<unknown>;
  /**
   * Streaming path used when the CardKit card has been created. The plugin-ai
   * implementation writes SSE frames to `ctx.res.write` (see
   * `ChatStreamProtocol.fromContext`); the bridge intercepts them via
   * `streamWriter` in the context factory.
   */
  stream: (args: { userMessages: { role: 'user'; content: AIMessageContentLike }[] }) => Promise<boolean>;
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
    /**
     * Captures every `ctx.res.write(chunk)` call AIEmployee makes during
     * `stream()`. The streaming-card-controller uses this to feed parsed
     * SSE frames into its state machine. The fallback path uses it to
     * accumulate content chunks for response-renderer. MUST be wired
     * through to {@link buildAIInvokeContext} or the streaming sink is a
     * silent no-op (we found this the hard way: 0 frames despite the
     * LLM completing).
     */
    streamWriter?: (chunk: string) => void;
  }): Promise<Context>;
}

export interface CardKitClientFactory {
  (appId: string): FeishuCardKitClient;
}

/**
 * Add/remove emoji reactions on the user's incoming Feishu message. Used by
 * the bridge to give the user a 👀 ack the moment we route their message
 * to AI, before the streaming card has time to render.
 */
export interface ReactionService {
  add(appId: string, messageId: string, emojiType: string): Promise<{ reactionId: string }>;
  remove(appId: string, messageId: string, reactionId: string): Promise<void>;
}

/**
 * Feishu reaction `emoji_type` for the "received, processing" ack we add
 * to the user's incoming message. `THINKING` (🤔) — the brainstorming
 * picked `EYES` (👀) but Feishu rejected that with code 231001 "reaction
 * type is invalid"; `EYES` is not in the predefined emoji_type set
 * (`GLANCE` / `EYESCLOSED` / `LOOKDOWN` exist but don't match the
 * intent). `THINKING` was the next-best option from the same session and
 * is verified valid against the docs at
 * https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message-reaction/emojis-introduce
 */
const RECEIVE_REACTION_EMOJI = 'THINKING';

export interface AIBridgeDeps {
  app: AIBridgeAppLike;
  log: AIInvokeLogger;
  conversationManager: FeishuConversationManager;
  contextFactory: AIBridgeContextFactory;
  responseRenderer: FeishuResponseRenderer;
  messageLogService: MessageLogService;
  AIEmployee: AIEmployeeConstructor;
  /** Returns a CardKit client bound to the given Feishu app. */
  cardKitClientFor: CardKitClientFactory;
  /** Bot-level reaction add/remove on the incoming user message. */
  reactionService: ReactionService;
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
    let reactionId: string | undefined;
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

      // 👀 ack on the user's message — gives an immediate "received,
      // processing" signal even before the CardKit thinking card lands.
      // Failure here is non-blocking: log and proceed without the reaction
      // rather than letting a Feishu reactions-API hiccup drop the user's
      // actual message processing.
      try {
        const reactionResult = await this.deps.reactionService.add(appId, parsed.messageId, RECEIVE_REACTION_EMOJI);
        reactionId = reactionResult.reactionId;
      } catch (reactionErr) {
        this.deps.log.warn('feishu reaction add failed (non-blocking)', {
          appId,
          messageId: parsed.messageId,
          emojiType: RECEIVE_REACTION_EMOJI,
          error: reactionErr instanceof Error ? reactionErr.message : String(reactionErr),
        });
      }

      // Resolves (and persists, on first message) the aiConversations row for
      // this Feishu chat. The row's UUID sessionId — not the synthesized
      // `feishu:...` key — is what AIEmployee.getCurrentThread expects to
      // find via `findByTargetKey`.
      const employeeUsername =
        (employee.get?.('username') as string | undefined) ?? (employee as { username?: string }).username;
      if (!employeeUsername) {
        throw new Error(`feishu ai bridge: AI employee has no username (lookup=${context.aiConfig.employeeUsername})`);
      }
      session = await this.deps.conversationManager.getOrCreateSession({
        appId,
        chatId: parsed.chatId,
        chatType: parsed.chatType,
        senderOpenId: parsed.senderOpenId,
        employee: { username: employeeUsername },
        userId: context.aiConfig.actAsUserId ?? null,
      });

      // Resolve the LLM binding for this employee. Mirrors what
      // plugin-ai/.../resource/aiConversations.ts:368 does for the regular
      // chat surface — without this, AIEmployee.buildChatContext sees
      // `this.model = undefined` and throws "LLM service not configured".
      const resolvedModel = await this.resolveModel(employee);

      // 1. Try to start the streaming card. CardKit creation is the only
      //    point where we can detect the AI surface is unreachable before
      //    bothering the LLM. On failure, controller.needsFallback()
      //    returns true and we drop down to the legacy invoke path.
      const cardkit = this.deps.cardKitClientFor(appId);
      const controller = new StreamingCardController({
        cardkit,
        receiveId: parsed.chatType === 'p2p' ? parsed.senderOpenId : parsed.chatId,
        receiveIdType: parsed.chatType === 'p2p' ? 'open_id' : 'chat_id',
        log: this.deps.log,
      });
      const startResult = await controller.start();

      const userText = parsed.content.type === 'text' ? parsed.content.text : '';
      const userMessages = [{ role: 'user' as const, content: { type: 'text' as const, content: userText } }];

      if (!startResult.ok) {
        // Fallback path: CardKit unavailable, send a plain text reply via the
        // legacy renderer so the user still gets an answer.
        this.deps.log.warn('feishu cardkit unavailable, falling back to text reply', {
          appId,
          eventId: parsed.eventId,
        });
        const textChunks: string[] = [];
        const fallbackCtx = await this.deps.contextFactory({
          app: this.deps.app,
          log: this.deps.log,
          feishuContext: context,
          actAsUserId: context.aiConfig.actAsUserId,
          streamWriter: (chunk) => collectContentChunks(chunk, textChunks),
        });
        const fallbackEmployee = new this.deps.AIEmployee({
          ctx: fallbackCtx,
          employee,
          sessionId: session.sessionId,
          model: resolvedModel,
        });
        const result = await fallbackEmployee.invoke({ userMessages });
        await this.deps.responseRenderer.render({
          parsed: { messageId: parsed.messageId, chatId: parsed.chatId },
          context: { appId, chat: { chatType: parsed.chatType } },
          aiOutput: { text: getResultText(result) ?? textChunks.join('') },
        });
      } else {
        // Streaming path: feed parsed SSE frames into the controller.
        const ctx = await this.deps.contextFactory({
          app: this.deps.app,
          log: this.deps.log,
          feishuContext: context,
          actAsUserId: context.aiConfig.actAsUserId,
          streamWriter: (chunk) => {
            for (const frame of parseSSEFrames(chunk)) controller.onSSEFrame(frame);
          },
        });
        const aiEmployee = new this.deps.AIEmployee({
          ctx,
          employee,
          sessionId: session.sessionId,
          model: resolvedModel,
        });
        try {
          await aiEmployee.stream({ userMessages });
          await controller.complete();
        } catch (err) {
          await controller.error(err instanceof Error ? err.message : String(err));
          throw err;
        }
      }

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
    } finally {
      // Per the brainstorming "加·回复后移除" lifecycle: drop the 👀 reaction
      // once the AI side is done (success OR failure), so the user's message
      // doesn't keep wearing a stale "processing" indicator.
      if (reactionId) {
        try {
          await this.deps.reactionService.remove(appId, parsed.messageId, reactionId);
        } catch (removeErr) {
          this.deps.log.warn('feishu reaction remove failed (non-blocking)', {
            appId,
            messageId: parsed.messageId,
            reactionId,
            error: removeErr instanceof Error ? removeErr.message : String(removeErr),
          });
        }
      }
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

/**
 * Extract the assistant's final text from an AIEmployee.invoke return value.
 *
 * `aiEmployee.invoke` resolves to the LangGraph compiled-agent state
 * (`{ messages: BaseMessage[] }`), not a `{ text }` envelope. The conversation
 * trace contains the user message, any tool-call hops, and finally the
 * assistant's response — so we walk `messages` from the end and pick the
 * last `type === 'ai'` message that has non-empty text content.
 *
 * `BaseMessage.content` may be a plain string OR an array of content blocks
 * (Anthropic-style multi-modal); we handle both. The `result.text` shortcut
 * stays as a fallback for callers that wrap the invoke in a friendlier shape.
 */
function getResultText(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  if (typeof result.text === 'string' && result.text.length > 0) return result.text;

  const messages = result.messages;
  if (!Array.isArray(messages)) return undefined;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!isRecord(msg)) continue;
    if (msg.type !== 'ai') continue;

    const text = stringifyMessageContent(msg.content);
    if (text) return text;
  }
  return undefined;
}

function stringifyMessageContent(content: unknown): string | undefined {
  if (typeof content === 'string') {
    return content.length > 0 ? content : undefined;
  }
  if (Array.isArray(content)) {
    const text = content
      .filter((block): block is { type: string; text?: unknown } => isRecord(block) && block.type === 'text')
      .map((block) => (typeof block.text === 'string' ? block.text : ''))
      .join('');
    return text.length > 0 ? text : undefined;
  }
  return undefined;
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
