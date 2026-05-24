/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it, vi } from 'vitest';
import { FeishuResponseRenderer } from '../response-renderer';

function makeDeps() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ messageId: 'om_sent' }),
    replyMessage: vi.fn().mockResolvedValue({ messageId: 'om_reply' }),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

const baseInput = {
  parsed: { messageId: 'om_user_msg', chatId: 'oc_chat' },
  context: { appId: 'app1', chat: { chatType: 'p2p' as const } },
};

describe('FeishuResponseRenderer', () => {
  it('replies with text msgType when aiOutput.text is present', async () => {
    const deps = makeDeps();
    const renderer = new FeishuResponseRenderer({
      clientManager: { sendMessage: deps.sendMessage, replyMessage: deps.replyMessage },
      log: deps.log,
    });
    await renderer.render({ ...baseInput, aiOutput: { text: 'hello world' } });
    expect(deps.replyMessage).toHaveBeenCalledTimes(1);
    expect(deps.replyMessage).toHaveBeenCalledWith({
      appId: 'app1',
      messageId: 'om_user_msg',
      msgType: 'text',
      content: { text: 'hello world' },
    });
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it('skips reply and warns when aiOutput.text is empty', async () => {
    const deps = makeDeps();
    const renderer = new FeishuResponseRenderer({
      clientManager: { sendMessage: deps.sendMessage, replyMessage: deps.replyMessage },
      log: deps.log,
    });
    await renderer.render({ ...baseInput, aiOutput: { text: '' } });
    expect(deps.replyMessage).not.toHaveBeenCalled();
    expect(deps.log.warn).toHaveBeenCalledTimes(1);
  });

  it('skips reply and warns when aiOutput.text is undefined', async () => {
    const deps = makeDeps();
    const renderer = new FeishuResponseRenderer({
      clientManager: { sendMessage: deps.sendMessage, replyMessage: deps.replyMessage },
      log: deps.log,
    });
    await renderer.render({ ...baseInput, aiOutput: {} });
    expect(deps.replyMessage).not.toHaveBeenCalled();
    expect(deps.log.warn).toHaveBeenCalledTimes(1);
  });

  it('propagates errors from replyMessage', async () => {
    const deps = makeDeps();
    deps.replyMessage = vi.fn().mockRejectedValue(new Error('feishu down'));
    const renderer = new FeishuResponseRenderer({
      clientManager: { sendMessage: deps.sendMessage, replyMessage: deps.replyMessage },
      log: deps.log,
    });
    await expect(renderer.render({ ...baseInput, aiOutput: { text: 'hi' } })).rejects.toThrow('feishu down');
  });
});
