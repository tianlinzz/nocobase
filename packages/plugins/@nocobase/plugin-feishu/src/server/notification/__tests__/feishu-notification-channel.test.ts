/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it, vi } from 'vitest';
import { FeishuNotificationChannel } from '../feishu-notification-channel';
import { FeishuApiError } from '../../transport/types';

describe('FeishuNotificationChannel', () => {
  const buildChannel = (overrides: Partial<{ hasApp: boolean; sendMessage: ReturnType<typeof vi.fn> }> = {}) => {
    const sendMessage = overrides.sendMessage ?? vi.fn().mockResolvedValue({ messageId: 'om_x' });
    const clientManager = {
      hasApp: vi.fn().mockReturnValue(overrides.hasApp !== false),
      sendMessage,
    } as any;
    return {
      channel: new FeishuNotificationChannel({ clientManager }),
      clientManager,
      sendMessage,
    };
  };

  it('returns success when sendMessage resolves', async () => {
    const { channel, sendMessage } = buildChannel();
    const result = await channel.send({
      channel: { options: { appId: 'a1' } },
      message: { appId: 'a1', receiveId: 'ou_x', receiveIdType: 'open_id', content: 'hi' },
    });
    expect(result.status).toBe('success');
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'a1',
        receiveId: 'ou_x',
        receiveIdType: 'open_id',
        msgType: 'text',
        content: { text: 'hi' },
      }),
    );
  });

  it('falls back to message.appId when channel.options is missing', async () => {
    const { channel } = buildChannel();
    const result = await channel.send({
      channel: {},
      message: { appId: 'a1', receiveId: 'ou_x', receiveIdType: 'open_id', content: 'hi' },
    });
    expect(result.status).toBe('success');
  });

  it('returns failure when no app id is available', async () => {
    const { channel } = buildChannel();
    const result = await channel.send({
      channel: {},
      message: { appId: '', receiveId: 'ou_x', receiveIdType: 'open_id', content: 'hi' } as any,
    });
    expect(result.status).toBe('failure');
    expect(result.reason).toMatch(/missing/);
  });

  it('returns failure when app is not running', async () => {
    const { channel } = buildChannel({ hasApp: false });
    const result = await channel.send({
      channel: { options: { appId: 'a1' } },
      message: { appId: 'a1', receiveId: 'ou_x', receiveIdType: 'open_id', content: 'hi' },
    });
    expect(result.status).toBe('failure');
    expect(result.reason).toMatch(/not running/);
  });

  it('returns failure when there are no receivers', async () => {
    const { channel } = buildChannel();
    const result = await channel.send({
      channel: { options: { appId: 'a1' } },
      message: { appId: 'a1', content: 'hi' } as any,
    });
    expect(result.status).toBe('failure');
    expect(result.reason).toMatch(/no receivers/);
  });

  it('uses the receivers list when provided, sending one message per target', async () => {
    const { channel, sendMessage } = buildChannel();
    const result = await channel.send({
      channel: { options: { appId: 'a1' } },
      message: { appId: 'a1', receiveId: '', receiveIdType: 'open_id', content: 'hi' } as any,
      receivers: [
        { receiveId: 'ou_a', receiveIdType: 'open_id' },
        { receiveId: 'ou_b', receiveIdType: 'open_id' },
      ],
    });
    expect(result.status).toBe('success');
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('returns failure with code when FeishuApiError is thrown', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new FeishuApiError('feishu boom', 99001, 'req-9'));
    const { channel } = buildChannel({ sendMessage });
    const result = await channel.send({
      channel: { options: { appId: 'a1' } },
      message: { appId: 'a1', receiveId: 'ou_x', receiveIdType: 'open_id', content: 'hi' },
    });
    expect(result.status).toBe('failure');
    expect(result.reason).toContain('99001');
  });

  it('uses object content as-is when caller passes a structured payload', async () => {
    const { channel, sendMessage } = buildChannel();
    await channel.send({
      channel: { options: { appId: 'a1' } },
      message: {
        appId: 'a1',
        receiveId: 'ou_x',
        receiveIdType: 'open_id',
        content: { post: { zh_cn: { content: [] } } },
        msgType: 'post',
      },
    });
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        msgType: 'post',
        content: { post: { zh_cn: { content: [] } } },
      }),
    );
  });
});
