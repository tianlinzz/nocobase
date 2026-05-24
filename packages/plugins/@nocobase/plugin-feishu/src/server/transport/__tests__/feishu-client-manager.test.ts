/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { FeishuClientManager } from '../feishu-client-manager';

vi.mock('@larksuiteoapi/node-sdk', () => {
  return {
    Client: vi.fn().mockImplementation((opts) => ({
      _opts: opts,
      im: {
        message: {
          create: vi.fn(),
          reply: vi.fn(),
          patch: vi.fn(),
        },
        image: {
          create: vi.fn(),
        },
      },
      contact: {
        user: { get: vi.fn() },
      },
      auth: {
        appAccessToken: { internal: vi.fn().mockResolvedValue({ code: 0, app_access_token: 'tok' }) },
      },
    })),
    Domain: { Feishu: 'feishu' },
    AppType: { SelfBuild: 'SelfBuild' },
    LoggerLevel: { warn: 'warn' },
  };
});

describe('FeishuClientManager', () => {
  let manager: FeishuClientManager;

  beforeEach(() => {
    manager = new FeishuClientManager();
  });

  it('addApp creates a Lark client retrievable by getClient', () => {
    manager.addApp({ appId: 'a1', appSecret: 's1' });
    expect(manager.getClient('a1')).toBeTruthy();
  });

  it('removeApp drops the client', () => {
    manager.addApp({ appId: 'a1', appSecret: 's1' });
    manager.removeApp('a1');
    expect(manager.getClient('a1')).toBeUndefined();
  });

  it('sendMessage passes receive_id_type explicitly without inferring from prefix', async () => {
    manager.addApp({ appId: 'a1', appSecret: 's1' });
    const client = manager.getClient('a1') as any;
    client.im.message.create.mockResolvedValue({ code: 0, data: { message_id: 'om_x' } });

    const result = await manager.sendMessage({
      appId: 'a1',
      receiveId: 'oc_xyz',
      receiveIdType: 'chat_id',
      msgType: 'text',
      content: { text: 'hi' },
    });

    expect(client.im.message.create).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'oc_xyz',
        msg_type: 'text',
        content: JSON.stringify({ text: 'hi' }),
      },
    });
    expect(result.messageId).toBe('om_x');
  });

  it('sendMessage throws FeishuApiError preserving code/msg/requestId on non-zero response', async () => {
    manager.addApp({ appId: 'a1', appSecret: 's1' });
    const client = manager.getClient('a1') as any;
    client.im.message.create.mockResolvedValue({ code: 230001, msg: 'invalid token', requestId: 'req-9' });

    await expect(
      manager.sendMessage({
        appId: 'a1',
        receiveId: 'ou_x',
        receiveIdType: 'open_id',
        msgType: 'text',
        content: { text: 'hi' },
      }),
    ).rejects.toMatchObject({
      name: 'FeishuApiError',
      code: 230001,
      requestId: 'req-9',
    });
  });

  it('sendMessage throws when app not initialized', async () => {
    await expect(
      manager.sendMessage({
        appId: 'unknown',
        receiveId: 'ou_x',
        receiveIdType: 'open_id',
        msgType: 'text',
        content: { text: 'hi' },
      }),
    ).rejects.toThrow(/feishu app not initialized/);
  });

  it('replyMessage uses messageId path and forwards reply_in_thread flag', async () => {
    manager.addApp({ appId: 'a1', appSecret: 's1' });
    const client = manager.getClient('a1') as any;
    client.im.message.reply.mockResolvedValue({ code: 0, data: { message_id: 'om_reply' } });

    const result = await manager.replyMessage({
      appId: 'a1',
      messageId: 'om_origin',
      msgType: 'text',
      content: { text: 'reply' },
      replyInThread: true,
    });

    expect(client.im.message.reply).toHaveBeenCalledWith({
      path: { message_id: 'om_origin' },
      data: {
        msg_type: 'text',
        content: JSON.stringify({ text: 'reply' }),
        reply_in_thread: true,
      },
    });
    expect(result.messageId).toBe('om_reply');
  });

  it('updateMessage calls patch with content', async () => {
    manager.addApp({ appId: 'a1', appSecret: 's1' });
    const client = manager.getClient('a1') as any;
    client.im.message.patch.mockResolvedValue({ code: 0 });

    await manager.updateMessage({ appId: 'a1', messageId: 'om_origin', content: { foo: 'bar' } });

    expect(client.im.message.patch).toHaveBeenCalledWith({
      path: { message_id: 'om_origin' },
      data: { content: JSON.stringify({ foo: 'bar' }) },
    });
  });
});
