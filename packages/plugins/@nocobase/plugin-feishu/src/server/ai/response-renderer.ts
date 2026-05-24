/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

export interface AIInvokeOutput {
  text?: string;
}

export interface ResponseRendererLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

interface ReplyMessageInput {
  appId: string;
  messageId: string;
  msgType: 'text';
  content: { text: string };
}

interface SendMessageInput {
  appId: string;
  receiveId: string;
  receiveIdType: 'chat_id' | 'open_id' | 'union_id' | 'user_id';
  msgType: 'text';
  content: { text: string };
}

export interface ResponseRendererClientManager {
  sendMessage: (params: SendMessageInput) => Promise<unknown>;
  replyMessage: (params: ReplyMessageInput) => Promise<unknown>;
}

export interface ResponseRendererDeps {
  clientManager: ResponseRendererClientManager;
  log: ResponseRendererLogger;
}

export interface RenderInput {
  parsed: { messageId: string; chatId: string };
  context: { appId: string; chat: { chatType: 'p2p' | 'group' } };
  aiOutput: AIInvokeOutput;
}

/**
 * Render an AI invoke output back into a Feishu reply.
 *
 * Phase 4 keeps the rendering text-only — markdown / post / interactive card
 * rendering is deferred to a later iteration per the design spec.
 */
export class FeishuResponseRenderer {
  constructor(private readonly deps: ResponseRendererDeps) {}

  async render(input: RenderInput): Promise<void> {
    const text = input.aiOutput.text?.trim();
    if (!text) {
      this.deps.log.warn('feishu response renderer: empty AI text output, skipping reply', {
        appId: input.context.appId,
        messageId: input.parsed.messageId,
      });
      return;
    }
    await this.deps.clientManager.replyMessage({
      appId: input.context.appId,
      messageId: input.parsed.messageId,
      msgType: 'text',
      content: { text },
    });
  }
}
