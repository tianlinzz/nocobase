/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it, vi } from 'vitest';
import { FeishuCardKitClient } from '../feishu-cardkit-client';

function makeFakeLarkClient() {
  const cardkitCardCreate = vi.fn().mockResolvedValue({ code: 0, data: { card_id: 'card_xyz' } });
  const cardkitCardSettings = vi.fn().mockResolvedValue({ code: 0, data: {} });
  const cardkitCardUpdate = vi.fn().mockResolvedValue({ code: 0, data: {} });
  const cardkitElementContent = vi.fn().mockResolvedValue({ code: 0, data: {} });
  const imMessageCreate = vi.fn().mockResolvedValue({ code: 0, data: { message_id: 'om_msg' } });
  const client = {
    cardkit: {
      card: { create: cardkitCardCreate, settings: cardkitCardSettings, update: cardkitCardUpdate },
      cardElement: { content: cardkitElementContent },
    },
    im: { message: { create: imMessageCreate } },
  };
  return { client, cardkitCardCreate, cardkitCardSettings, cardkitCardUpdate, cardkitElementContent, imMessageCreate };
}

describe('FeishuCardKitClient', () => {
  it('createCardEntity stringifies card JSON and returns card_id', async () => {
    const { client, cardkitCardCreate } = makeFakeLarkClient();
    const cardkit = new FeishuCardKitClient(client as never);
    const result = await cardkit.createCardEntity({ schema: '2.0', body: { elements: [] } });
    expect(cardkitCardCreate).toHaveBeenCalledWith({
      data: { type: 'card_json', data: JSON.stringify({ schema: '2.0', body: { elements: [] } }) },
    });
    expect(result).toEqual({ cardId: 'card_xyz' });
  });

  it('createCardEntity throws FeishuApiError on non-zero code', async () => {
    const { client, cardkitCardCreate } = makeFakeLarkClient();
    cardkitCardCreate.mockResolvedValue({ code: 23001, msg: 'invalid card' });
    const cardkit = new FeishuCardKitClient(client as never);
    await expect(cardkit.createCardEntity({})).rejects.toThrow(/cardkit\.create.*invalid card/i);
  });

  it('sendCardByCardId sends im.message.create with msg_type interactive', async () => {
    const { client, imMessageCreate } = makeFakeLarkClient();
    const cardkit = new FeishuCardKitClient(client as never);
    const result = await cardkit.sendCardByCardId({
      receiveId: 'ou_user',
      receiveIdType: 'open_id',
      cardId: 'card_xyz',
    });
    expect(imMessageCreate).toHaveBeenCalledWith({
      params: { receive_id_type: 'open_id' },
      data: {
        receive_id: 'ou_user',
        msg_type: 'interactive',
        content: JSON.stringify({ type: 'card', data: { card_id: 'card_xyz' } }),
      },
    });
    expect(result).toEqual({ messageId: 'om_msg' });
  });

  it('streamCardContent passes content + sequence to cardElement.content', async () => {
    const { client, cardkitElementContent } = makeFakeLarkClient();
    const cardkit = new FeishuCardKitClient(client as never);
    await cardkit.streamCardContent({ cardId: 'card_xyz', elementId: 'answer', content: 'hello', sequence: 5 });
    expect(cardkitElementContent).toHaveBeenCalledWith({
      data: { content: 'hello', sequence: 5 },
      path: { card_id: 'card_xyz', element_id: 'answer' },
    });
  });

  it('streamCardContent throws FeishuApiError on non-zero code', async () => {
    const { client, cardkitElementContent } = makeFakeLarkClient();
    cardkitElementContent.mockResolvedValue({ code: 230102, msg: 'sequence too small' });
    const cardkit = new FeishuCardKitClient(client as never);
    await expect(
      cardkit.streamCardContent({ cardId: 'card_xyz', elementId: 'answer', content: 'x', sequence: 1 }),
    ).rejects.toThrow(/cardkit\.streamCardContent.*sequence too small/i);
  });

  it('setCardStreamingMode stringifies settings with streaming_mode flag', async () => {
    const { client, cardkitCardSettings } = makeFakeLarkClient();
    const cardkit = new FeishuCardKitClient(client as never);
    await cardkit.setCardStreamingMode({ cardId: 'card_xyz', streamingMode: false, sequence: 7 });
    expect(cardkitCardSettings).toHaveBeenCalledWith({
      data: { settings: JSON.stringify({ config: { streaming_mode: false } }), sequence: 7 },
      path: { card_id: 'card_xyz' },
    });
  });

  it('updateCardKitCard wraps card in {type:card_json,data:string}', async () => {
    const { client, cardkitCardUpdate } = makeFakeLarkClient();
    const cardkit = new FeishuCardKitClient(client as never);
    const card = { schema: '2.0', body: { elements: [{ tag: 'markdown', content: 'final' }] } };
    await cardkit.updateCardKitCard({ cardId: 'card_xyz', cardJson: card, sequence: 9 });
    expect(cardkitCardUpdate).toHaveBeenCalledWith({
      data: { card: { type: 'card_json', data: JSON.stringify(card) }, sequence: 9 },
      path: { card_id: 'card_xyz' },
    });
  });
});
