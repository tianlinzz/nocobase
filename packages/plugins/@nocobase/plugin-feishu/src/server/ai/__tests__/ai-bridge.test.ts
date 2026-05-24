/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it, vi } from 'vitest';
import { FeishuAIBridge } from '../ai-bridge';
import { FeishuConversationManager } from '../conversation-manager';
import { buildAIInvokeContext } from '../ai-context-factory';
import { FeishuResponseRenderer } from '../response-renderer';
import type { ParsedMessage } from '../../message/types';
import type { FeishuMessageContext } from '../../message/types';
import type { Model } from '@nocobase/database';

const baseParsed: ParsedMessage = {
  eventId: 'ev_1',
  messageId: 'om_1',
  chatId: 'oc_1',
  chatType: 'p2p',
  senderOpenId: 'ou_user',
  senderName: 'Alice',
  createTime: 1700000000000,
  contentType: 'text',
  content: { type: 'text', text: 'hello bot' },
  mentions: [],
  isMentionBot: true,
};

const baseContext: FeishuMessageContext = {
  appId: 'app1',
  appName: 'App One',
  sender: { openId: 'ou_user', name: 'Alice' },
  chat: { chatId: 'oc_1', chatType: 'p2p' },
  aiConfig: { employeeUsername: 'bot' },
};

interface AIEmployeeArgs {
  ctx: unknown;
  employee: unknown;
  sessionId: string;
}

/**
 * Build a tiny in-process `db` good enough for bridge tests:
 *   - `users.findOne` returns null (no actAsUserId binding by default).
 *   - `aiConversations.findOne` looks up the in-memory store by topicId.
 *   - `aiConversations.create` assigns a deterministic fake UUID.
 * The same store is exposed so tests can assert on what was persisted.
 */
function makeFakeDb() {
  const aiConversationsStore: Array<Record<string, unknown>> = [];
  let counter = 0;
  const aiConversationsRepo = {
    findOne: vi.fn(async ({ filter }: { filter: Record<string, unknown> }) => {
      const topicId = filter.topicId as string | undefined;
      const found = aiConversationsStore.find((r) => r.topicId === topicId);
      if (!found) return null;
      return { get: (k: string) => found[k] };
    }),
    create: vi.fn(async ({ values }: { values: Record<string, unknown> }) => {
      counter += 1;
      const row = { ...values, sessionId: `uuid-${counter}` };
      aiConversationsStore.push(row);
      return { get: (k: string) => row[k] };
    }),
  };
  const usersRepo = { findOne: vi.fn().mockResolvedValue(null) };
  const getRepository = vi.fn((name: string) => {
    if (name === 'aiConversations') return aiConversationsRepo;
    if (name === 'users') return usersRepo;
    return { findOne: vi.fn().mockResolvedValue(null) };
  });
  return { db: { getRepository }, aiConversationsRepo, aiConversationsStore };
}

function setup(overrides?: {
  invokeResult?: unknown;
  invokeError?: Error;
  streamError?: Error;
  streamChunks?: string[];
  employee?: unknown;
}) {
  const captured: { args?: AIEmployeeArgs; userMessages?: unknown } = {};
  const invoke = vi.fn().mockImplementation(async ({ userMessages }: { userMessages: unknown }) => {
    captured.userMessages = userMessages;
    if (overrides?.invokeError) throw overrides.invokeError;
    return overrides?.invokeResult ?? { text: 'reply text' };
  });
  const stream = vi.fn().mockImplementation(async ({ userMessages }: { userMessages: unknown }) => {
    captured.userMessages = userMessages;
    if (overrides?.streamError) throw overrides.streamError;
    if (overrides?.streamChunks) {
      const ctx = (captured.args?.ctx ?? {}) as { res?: { write: (s: string) => void } };
      for (const chunk of overrides.streamChunks) {
        ctx.res?.write?.(`data: ${JSON.stringify({ type: 'content', body: chunk })}\n\n`);
      }
    }
    return true;
  });
  const MockAIEmployee = vi.fn().mockImplementation((args: AIEmployeeArgs) => {
    captured.args = args;
    return { invoke, stream };
  });

  const employee = overrides?.employee === undefined ? { username: 'bot' } : overrides.employee;
  const getEmployee = vi.fn().mockResolvedValue(employee);
  // The bridge now resolves the LLM binding before constructing AIEmployee
  // (mirrors plugin-ai/.../resource/aiConversations.ts:368). Provide a stub
  // that returns a valid {llmService, model} so tests don't need to mock
  // employee.modelSettings.
  const resolveModel = vi.fn().mockResolvedValue({ llmService: 'openai-default', model: 'gpt-4o' });
  const aiPlugin = { aiEmployeesManager: { getEmployee, resolveModel } };
  const pmGet = vi.fn().mockReturnValue(aiPlugin);

  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const messageLogService = { record: vi.fn().mockResolvedValue(undefined) };
  const replyMessage = vi.fn().mockResolvedValue({ messageId: 'om_reply' });
  const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_sent' });

  const responseRenderer = new FeishuResponseRenderer({
    clientManager: { sendMessage, replyMessage },
    log,
  });

  const { db, aiConversationsRepo, aiConversationsStore } = makeFakeDb();

  const cardKitClient = {
    createCardEntity: vi.fn().mockResolvedValue({ cardId: 'card_xyz' }),
    sendCardByCardId: vi.fn().mockResolvedValue({ messageId: 'om_card' }),
    streamCardContent: vi.fn().mockResolvedValue(undefined),
    setCardStreamingMode: vi.fn().mockResolvedValue(undefined),
    updateCardKitCard: vi.fn().mockResolvedValue(undefined),
  };
  const cardKitClientFor = vi.fn().mockReturnValue(cardKitClient);
  const reactionService = {
    add: vi.fn().mockResolvedValue({ reactionId: 'reac_xyz' }),
    remove: vi.fn().mockResolvedValue(undefined),
  };

  const bridge = new FeishuAIBridge({
    app: { db, pm: { get: pmGet } },
    log,
    conversationManager: new FeishuConversationManager({ db }),
    contextFactory: buildAIInvokeContext,
    responseRenderer,
    messageLogService,
    AIEmployee: MockAIEmployee as unknown as new (args: { ctx: unknown; employee: Model; sessionId: string }) => {
      invoke: typeof invoke;
      stream: typeof stream;
    },
    cardKitClientFor,
    reactionService,
  });

  return {
    bridge,
    captured,
    invoke,
    stream,
    MockAIEmployee,
    pmGet,
    getEmployee,
    log,
    messageLogService,
    replyMessage,
    aiConversationsRepo,
    aiConversationsStore,
    cardKitClient,
    cardKitClientFor,
    reactionService,
  };
}

describe('FeishuAIBridge', () => {
  it('skips invocation and records ignore when aiConfig is null', async () => {
    const { bridge, pmGet, messageLogService, MockAIEmployee } = setup();
    const context: FeishuMessageContext = { ...baseContext, aiConfig: null };
    await bridge.handleMessage('app1', baseParsed, context);
    expect(pmGet).not.toHaveBeenCalled();
    expect(MockAIEmployee).not.toHaveBeenCalled();
    expect(messageLogService.record).toHaveBeenCalledTimes(1);
    expect(messageLogService.record.mock.calls[0][0]).toMatchObject({
      appId: 'app1',
      eventId: 'ev_1',
      routeAction: 'ignore',
      status: 'ignored',
    });
  });

  it('records failure and skips invoke when employee is missing', async () => {
    const { bridge, MockAIEmployee, messageLogService, replyMessage } = setup({ employee: null });
    await bridge.handleMessage('app1', baseParsed, baseContext);
    expect(MockAIEmployee).not.toHaveBeenCalled();
    expect(replyMessage).not.toHaveBeenCalled();
    expect(messageLogService.record).toHaveBeenCalledTimes(1);
    expect(messageLogService.record.mock.calls[0][0]).toMatchObject({
      appId: 'app1',
      routeAction: 'ai',
      status: 'failure',
    });
    expect(messageLogService.record.mock.calls[0][0].error).toMatch(/employee not found/i);
  });

  it('happy path: streams CardKit card and records success', async () => {
    const { bridge, captured, MockAIEmployee, stream, messageLogService, aiConversationsStore, cardKitClient } = setup({
      streamChunks: ['hello ', 'world'],
    });
    await bridge.handleMessage('app1', baseParsed, baseContext);
    expect(MockAIEmployee).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(captured.userMessages).toEqual([{ role: 'user', content: { type: 'text', content: 'hello bot' } }]);
    expect(cardKitClient.createCardEntity).toHaveBeenCalledTimes(1);
    expect(cardKitClient.sendCardByCardId).toHaveBeenCalledWith(
      expect.objectContaining({ receiveId: 'ou_user', receiveIdType: 'open_id', cardId: 'card_xyz' }),
    );
    expect(cardKitClient.streamCardContent).toHaveBeenCalled();
    expect(cardKitClient.setCardStreamingMode).toHaveBeenCalledWith(expect.objectContaining({ streamingMode: false }));
    expect(cardKitClient.updateCardKitCard).toHaveBeenCalled();
    expect(messageLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', aiSessionId: aiConversationsStore[0].sessionId }),
    );
  });

  it('fallback: when CardKit createCardEntity fails, falls back to text reply via response-renderer', async () => {
    const setupResult = setup({ invokeResult: { text: 'fallback text' } });
    setupResult.cardKitClient.createCardEntity.mockRejectedValue(new Error('cardkit boom'));
    const { bridge, replyMessage, log } = setupResult;
    await bridge.handleMessage('app1', baseParsed, baseContext);
    expect(replyMessage).toHaveBeenCalledWith(
      expect.objectContaining({ msgType: 'text', content: { text: 'fallback text' } }),
    );
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/cardkit unavailable/i), expect.anything());
  });

  it('stream error: invokes controller.error and rethrows so the queue retries', async () => {
    const err = new Error('llm midstream');
    const { bridge, cardKitClient, messageLogService } = setup({ streamError: err });
    await expect(bridge.handleMessage('app1', baseParsed, baseContext)).rejects.toThrow('llm midstream');
    expect(cardKitClient.updateCardKitCard).toHaveBeenCalledWith(
      expect.objectContaining({
        cardJson: expect.objectContaining({ header: expect.objectContaining({ template: 'red' }) }),
      }),
    );
    expect(messageLogService.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'failure' }));
  });

  it('rethrows when invoke fails on the fallback path and records failure', async () => {
    const err = new Error('llm down');
    const setupResult = setup({ invokeError: err });
    setupResult.cardKitClient.createCardEntity.mockRejectedValue(new Error('cardkit boom'));
    const { bridge, messageLogService } = setupResult;
    await expect(bridge.handleMessage('app1', baseParsed, baseContext)).rejects.toThrow('llm down');
    expect(messageLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ routeAction: 'ai', status: 'failure', error: 'llm down' }),
    );
  });

  it('places feishuContext on the AIEmployee constructor ctx.state', async () => {
    const { bridge, captured } = setup();
    await bridge.handleMessage('app1', baseParsed, baseContext);
    const ctx = captured.args?.ctx as { state: { feishuContext: FeishuMessageContext } };
    expect(ctx.state.feishuContext).toBe(baseContext);
  });

  it('fallback: extracts the assistant reply from invoke result.messages when there is no result.text', async () => {
    // Mirrors the real LangGraph compiled-agent return shape: `{ messages: [...] }`
    // with the final assistant reply living on the last `type: 'ai'` entry.
    const setupResult = setup({
      invokeResult: {
        messages: [
          { type: 'human', content: 'hello bot' },
          { type: 'ai', content: '', tool_calls: [{ id: 't1', name: 'noop' }] },
          { type: 'tool', content: 'tool ran ok' },
          { type: 'ai', content: 'final answer from messages' },
        ],
      },
    });
    setupResult.cardKitClient.createCardEntity.mockRejectedValue(new Error('cardkit boom'));
    const { bridge, replyMessage } = setupResult;
    await bridge.handleMessage('app1', baseParsed, baseContext);
    expect(replyMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: { text: 'final answer from messages' } }),
    );
  });

  it('fallback: handles array-form AI message content (multi-modal text blocks)', async () => {
    const setupResult = setup({
      invokeResult: {
        messages: [
          { type: 'human', content: 'hello' },
          {
            type: 'ai',
            content: [
              { type: 'text', text: 'block one ' },
              { type: 'text', text: 'block two' },
            ],
          },
        ],
      },
    });
    setupResult.cardKitClient.createCardEntity.mockRejectedValue(new Error('cardkit boom'));
    const { bridge, replyMessage } = setupResult;
    await bridge.handleMessage('app1', baseParsed, baseContext);
    expect(replyMessage).toHaveBeenCalledWith(expect.objectContaining({ content: { text: 'block one block two' } }));
  });

  it('reaction: adds 👀 EYES on the incoming message and removes it after success', async () => {
    const { bridge, reactionService } = setup({ streamChunks: ['hi'] });
    await bridge.handleMessage('app1', baseParsed, baseContext);
    expect(reactionService.add).toHaveBeenCalledWith('app1', 'om_1', 'EYES');
    expect(reactionService.remove).toHaveBeenCalledWith('app1', 'om_1', 'reac_xyz');
  });

  it('reaction: still removes the reaction in the failure path', async () => {
    const { bridge, reactionService } = setup({ streamError: new Error('llm down') });
    await expect(bridge.handleMessage('app1', baseParsed, baseContext)).rejects.toThrow('llm down');
    expect(reactionService.add).toHaveBeenCalledWith('app1', 'om_1', 'EYES');
    expect(reactionService.remove).toHaveBeenCalledWith('app1', 'om_1', 'reac_xyz');
  });

  it('reaction: add failure is non-blocking and skips remove (no reactionId captured)', async () => {
    const setupResult = setup({ streamChunks: ['ok'] });
    setupResult.reactionService.add.mockRejectedValue(new Error('reaction api down'));
    const { bridge, reactionService, log, messageLogService } = setupResult;
    await bridge.handleMessage('app1', baseParsed, baseContext);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringMatching(/reaction add failed/i),
      expect.objectContaining({ emojiType: 'EYES' }),
    );
    expect(reactionService.remove).not.toHaveBeenCalled();
    // AI flow still completes
    expect(messageLogService.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
  });
});
