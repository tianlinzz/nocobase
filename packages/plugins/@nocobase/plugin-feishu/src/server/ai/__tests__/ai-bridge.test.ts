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

function setup(overrides?: { invokeResult?: { text?: string }; invokeError?: Error; employee?: unknown }) {
  const captured: { args?: AIEmployeeArgs; userMessages?: unknown } = {};
  const invoke = vi.fn().mockImplementation(async ({ userMessages }: { userMessages: unknown }) => {
    captured.userMessages = userMessages;
    if (overrides?.invokeError) throw overrides.invokeError;
    return overrides?.invokeResult ?? { text: 'reply text' };
  });
  const MockAIEmployee = vi.fn().mockImplementation((args: AIEmployeeArgs) => {
    captured.args = args;
    return { invoke };
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

  const bridge = new FeishuAIBridge({
    app: {
      db: { getRepository: vi.fn().mockReturnValue({ findOne: vi.fn().mockResolvedValue(null) }) },
      pm: { get: pmGet },
    },
    log,
    conversationManager: new FeishuConversationManager(),
    contextFactory: buildAIInvokeContext,
    responseRenderer,
    messageLogService,
    AIEmployee: MockAIEmployee as unknown as new (args: { ctx: unknown; employee: Model; sessionId: string }) => {
      invoke: typeof invoke;
    },
  });

  return { bridge, captured, invoke, MockAIEmployee, pmGet, getEmployee, log, messageLogService, replyMessage };
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

  it('happy path: constructs AIEmployee, invokes, renders reply, records success', async () => {
    const { bridge, captured, invoke, MockAIEmployee, replyMessage, messageLogService } = setup();
    await bridge.handleMessage('app1', baseParsed, baseContext);
    expect(MockAIEmployee).toHaveBeenCalledTimes(1);
    expect(captured.args?.sessionId).toBe('feishu:app1:p2p:ou_user');
    expect(captured.args?.employee).toEqual({ username: 'bot' });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(captured.userMessages).toEqual([{ role: 'user', content: 'hello bot' }]);
    expect(replyMessage).toHaveBeenCalledTimes(1);
    expect(replyMessage.mock.calls[0][0]).toMatchObject({
      appId: 'app1',
      messageId: 'om_1',
      msgType: 'text',
      content: { text: 'reply text' },
    });
    expect(messageLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'app1',
        routeAction: 'ai',
        status: 'success',
        aiSessionId: 'feishu:app1:p2p:ou_user',
      }),
    );
  });

  it('renders text collected from AIEmployee stream when invoke result has no text', async () => {
    const captured: { args?: AIEmployeeArgs } = {};
    const MockAIEmployee = vi.fn().mockImplementation((args: AIEmployeeArgs) => {
      captured.args = args;
      return {
        invoke: vi.fn().mockImplementation(async () => {
          const ctx = args.ctx as { res: { write: (chunk: string) => void } };
          ctx.res.write('data: {"type":"content","body":"hello "}\n\n');
          ctx.res.write('data: {"type":"content","body":"stream"}\n\n');
          return {};
        }),
      };
    });
    const replyMessage = vi.fn().mockResolvedValue({ messageId: 'om_reply' });
    const bridge = new FeishuAIBridge({
      app: {
        db: { getRepository: vi.fn().mockReturnValue({ findOne: vi.fn().mockResolvedValue(null) }) },
        pm: {
          get: vi.fn().mockReturnValue({
            aiEmployeesManager: {
              getEmployee: vi.fn().mockResolvedValue({}),
              resolveModel: vi.fn().mockResolvedValue({ llmService: 'openai-default', model: 'gpt-4o' }),
            },
          }),
        },
      },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      conversationManager: new FeishuConversationManager(),
      contextFactory: buildAIInvokeContext,
      responseRenderer: new FeishuResponseRenderer({
        clientManager: { sendMessage: vi.fn(), replyMessage },
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }),
      messageLogService: { record: vi.fn().mockResolvedValue(undefined) },
      AIEmployee: MockAIEmployee as unknown as new (args: { ctx: unknown; employee: Model; sessionId: string }) => {
        invoke: (args: { userMessages: unknown }) => Promise<unknown>;
      },
    });

    await bridge.handleMessage('app1', baseParsed, baseContext);

    expect(replyMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: { text: 'hello stream' },
      }),
    );
  });

  it('rethrows when invoke fails and records failure', async () => {
    const err = new Error('llm down');
    const { bridge, messageLogService } = setup({ invokeError: err });
    await expect(bridge.handleMessage('app1', baseParsed, baseContext)).rejects.toThrow('llm down');
    expect(messageLogService.record).toHaveBeenCalledTimes(1);
    expect(messageLogService.record.mock.calls[0][0]).toMatchObject({
      appId: 'app1',
      routeAction: 'ai',
      status: 'failure',
      error: 'llm down',
    });
  });

  it('places feishuContext on the AIEmployee constructor ctx.state', async () => {
    const { bridge, captured } = setup();
    await bridge.handleMessage('app1', baseParsed, baseContext);
    const ctx = captured.args?.ctx as { state: { feishuContext: FeishuMessageContext } };
    expect(ctx.state.feishuContext).toBe(baseContext);
  });
});
