/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it, vi } from 'vitest';
import tool from '../../ai/tools/feishuGetMessage/index';

type InvokeArgs = Parameters<typeof tool.invoke>;

describe('feishuGetMessage tool', () => {
  it('exposes the expected definition', () => {
    expect(tool.definition.name).toBe('feishuGetMessage');
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
    const result = await tool.invoke(ctx, { messageId: 'om_x' } as unknown as InvokeArgs[1], {} as InvokeArgs[2]);
    expect(result).toMatchObject({ status: 'failure' });
  });

  it('rejects when feishuContext is missing', async () => {
    const getMessageFromTool = vi.fn();
    const ctx = {
      app: { pm: { get: () => ({ getMessageFromTool }) } },
      state: {},
      action: { params: { values: {} } },
    } as unknown as InvokeArgs[0];
    const result = await tool.invoke(ctx, { messageId: 'om_x' } as unknown as InvokeArgs[1], {} as InvokeArgs[2]);
    expect(getMessageFromTool).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'failure' });
  });

  it('forwards feishuContext + args to plugin.getMessageFromTool when present in ctx.state', async () => {
    const getMessageFromTool = vi.fn().mockResolvedValue({ status: 'success', content: 'hello' });
    const ctx = {
      app: { pm: { get: () => ({ getMessageFromTool }) } },
      state: { feishuContext: { appId: 'a1' } },
      action: { params: { values: {} } },
    } as unknown as InvokeArgs[0];
    await tool.invoke(ctx, { messageId: 'om_x' } as unknown as InvokeArgs[1], {} as InvokeArgs[2]);
    expect(getMessageFromTool).toHaveBeenCalledWith({ appId: 'a1' }, { messageId: 'om_x' });
  });

  it('falls back to ctx.action.params.values.feishuContext if ctx.state has none', async () => {
    const getMessageFromTool = vi.fn().mockResolvedValue({ status: 'success', content: 'hello' });
    const ctx = {
      app: { pm: { get: () => ({ getMessageFromTool }) } },
      state: {},
      action: { params: { values: { feishuContext: { appId: 'a2' } } } },
    } as unknown as InvokeArgs[0];
    await tool.invoke(ctx, { messageId: 'om_x' } as unknown as InvokeArgs[1], {} as InvokeArgs[2]);
    expect(getMessageFromTool).toHaveBeenCalled();
  });
});
