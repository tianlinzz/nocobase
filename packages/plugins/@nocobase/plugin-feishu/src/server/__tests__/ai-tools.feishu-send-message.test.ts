/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it, vi } from 'vitest';
import tool from '../../ai/tools/feishuSendMessage/index';

type InvokeArgs = Parameters<typeof tool.invoke>;

describe('feishuSendMessage tool', () => {
  it('exposes the expected definition', () => {
    expect(tool.definition.name).toBe('feishuSendMessage');
    expect(tool.scope).toBe('SPECIFIED');
    expect(tool.execution).toBe('backend');
    expect(tool.defaultPermission).toBe('ASK');
  });

  it('rejects when plugin-feishu service is unavailable', async () => {
    const ctx = {
      app: { pm: { get: () => undefined } },
      state: { feishuContext: { appId: 'a1' } },
      action: { params: { values: {} } },
    } as unknown as InvokeArgs[0];
    const result = await tool.invoke(
      ctx,
      { receiveIdType: 'open_id', receiveId: 'ou_x', content: 'hi' } as unknown as InvokeArgs[1],
      {} as InvokeArgs[2],
    );
    expect(result).toMatchObject({ status: 'failure' });
  });

  it('rejects when feishuContext is missing', async () => {
    const sendMessageFromTool = vi.fn();
    const ctx = {
      app: { pm: { get: () => ({ sendMessageFromTool }) } },
      state: {},
      action: { params: { values: {} } },
    } as unknown as InvokeArgs[0];
    const result = await tool.invoke(
      ctx,
      { receiveIdType: 'open_id', receiveId: 'ou_x', content: 'hi' } as unknown as InvokeArgs[1],
      {} as InvokeArgs[2],
    );
    expect(sendMessageFromTool).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'failure' });
  });

  it('forwards feishuContext + args to plugin.sendMessageFromTool when present in ctx.state', async () => {
    const sendMessageFromTool = vi.fn().mockResolvedValue({ status: 'success', content: 'om_x' });
    const ctx = {
      app: { pm: { get: () => ({ sendMessageFromTool }) } },
      state: { feishuContext: { appId: 'a1' } },
      action: { params: { values: {} } },
    } as unknown as InvokeArgs[0];
    await tool.invoke(
      ctx,
      { receiveIdType: 'chat_id', receiveId: 'oc_x', content: 'hi' } as unknown as InvokeArgs[1],
      {} as InvokeArgs[2],
    );
    expect(sendMessageFromTool).toHaveBeenCalledWith(
      { appId: 'a1' },
      { receiveIdType: 'chat_id', receiveId: 'oc_x', content: 'hi' },
    );
  });

  it('falls back to ctx.action.params.values.feishuContext if ctx.state has none', async () => {
    const sendMessageFromTool = vi.fn().mockResolvedValue({ status: 'success', content: 'om_x' });
    const ctx = {
      app: { pm: { get: () => ({ sendMessageFromTool }) } },
      state: {},
      action: { params: { values: { feishuContext: { appId: 'a2' } } } },
    } as unknown as InvokeArgs[0];
    await tool.invoke(
      ctx,
      { receiveIdType: 'open_id', receiveId: 'ou_x', content: 'hi' } as unknown as InvokeArgs[1],
      {} as InvokeArgs[2],
    );
    expect(sendMessageFromTool).toHaveBeenCalled();
  });
});
