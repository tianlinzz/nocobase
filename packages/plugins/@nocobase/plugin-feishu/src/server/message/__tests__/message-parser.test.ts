/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, it, expect } from 'vitest';
import { parseMessageEvent } from '../message-parser';

const BOT_OPEN_ID = 'ou_bot_xyz';

function buildEvent(overrides: {
  message?: Record<string, unknown>;
  sender?: Record<string, unknown>;
  header?: Record<string, unknown>;
}) {
  const message = {
    message_id: 'om_msg_1',
    create_time: '1700000000000',
    chat_id: 'oc_chat_1',
    chat_type: 'p2p',
    message_type: 'text',
    content: JSON.stringify({ text: 'hello' }),
    mentions: [],
    ...(overrides.message || {}),
  };
  const sender = {
    sender_id: { open_id: 'ou_user', union_id: 'on_x', user_id: 'u_x' },
    sender_type: 'user',
    tenant_key: 't1',
    ...(overrides.sender || {}),
  };
  const header = {
    event_id: 'ev_001',
    create_time: '1700000000000',
    event_type: 'im.message.receive_v1',
    ...(overrides.header || {}),
  };
  return { event: { message, sender }, header };
}

describe('parseMessageEvent', () => {
  it('parses text message in p2p chat', () => {
    const raw = buildEvent({});
    const result = parseMessageEvent(raw, { botOpenId: BOT_OPEN_ID });
    expect(result).not.toBeNull();
    expect(result!.contentType).toBe('text');
    expect(result!.content).toEqual({ type: 'text', text: 'hello' });
    expect(result!.chatType).toBe('p2p');
    expect(result!.isMentionBot).toBe(true);
    expect(result!.eventId).toBe('ev_001');
    expect(result!.messageId).toBe('om_msg_1');
    expect(result!.chatId).toBe('oc_chat_1');
    expect(result!.senderOpenId).toBe('ou_user');
    expect(result!.createTime).toBe(1700000000000);
    expect(result!.mentions).toEqual([]);
  });

  it('parses text message in group with @bot mention', () => {
    const raw = buildEvent({
      message: {
        chat_type: 'group',
        content: JSON.stringify({ text: '@_user_1 hello' }),
        mentions: [
          {
            key: '@_user_1',
            id: { open_id: BOT_OPEN_ID, user_id: 'bot_u', union_id: 'bot_on' },
            name: 'Bot',
          },
        ],
      },
    });
    const result = parseMessageEvent(raw, { botOpenId: BOT_OPEN_ID });
    expect(result).not.toBeNull();
    expect(result!.chatType).toBe('group');
    expect(result!.isMentionBot).toBe(true);
    expect(result!.mentions).toHaveLength(1);
    expect(result!.mentions[0].id.open_id).toBe(BOT_OPEN_ID);
  });

  it('parses text message in group without @bot mention', () => {
    const raw = buildEvent({
      message: {
        chat_type: 'group',
        content: JSON.stringify({ text: 'hello' }),
        mentions: [
          {
            key: '@_user_1',
            id: { open_id: 'ou_someone_else' },
            name: 'Alice',
          },
        ],
      },
    });
    const result = parseMessageEvent(raw, { botOpenId: BOT_OPEN_ID });
    expect(result).not.toBeNull();
    expect(result!.chatType).toBe('group');
    expect(result!.isMentionBot).toBe(false);
  });

  it('returns null for unsupported msg_type (audio)', () => {
    const raw = buildEvent({
      message: {
        message_type: 'audio',
        content: JSON.stringify({ file_key: 'fk' }),
      },
    });
    const result = parseMessageEvent(raw, { botOpenId: BOT_OPEN_ID });
    expect(result).toBeNull();
  });

  it('parses post message and retains title', () => {
    const postContent = {
      zh_cn: {
        title: '标题',
        content: [[{ tag: 'text', text: 'body' }]],
      },
    };
    const raw = buildEvent({
      message: {
        message_type: 'post',
        content: JSON.stringify(postContent),
      },
    });
    const result = parseMessageEvent(raw, { botOpenId: BOT_OPEN_ID });
    expect(result).not.toBeNull();
    expect(result!.contentType).toBe('post');
    if (result!.content.type !== 'post') throw new Error('expected post');
    expect(result!.content.title).toBe('标题');
    expect(result!.content.content).toEqual(postContent);
  });

  it('parses image message', () => {
    const raw = buildEvent({
      message: {
        message_type: 'image',
        content: JSON.stringify({ image_key: 'img_key_123' }),
      },
    });
    const result = parseMessageEvent(raw, { botOpenId: BOT_OPEN_ID });
    expect(result).not.toBeNull();
    expect(result!.contentType).toBe('image');
    if (result!.content.type !== 'image') throw new Error('expected image');
    expect(result!.content.imageKey).toBe('img_key_123');
  });

  it('parses interactive (card) message with parsed object', () => {
    const card = { schema: '2.0', body: { elements: [] } };
    const raw = buildEvent({
      message: {
        message_type: 'interactive',
        content: JSON.stringify(card),
      },
    });
    const result = parseMessageEvent(raw, { botOpenId: BOT_OPEN_ID });
    expect(result).not.toBeNull();
    expect(result!.contentType).toBe('interactive');
    if (result!.content.type !== 'interactive') throw new Error('expected interactive');
    expect(result!.content.card).toEqual(card);
    expect(typeof result!.content.card).toBe('object');
  });

  it('parses share_chat message', () => {
    const raw = buildEvent({
      message: {
        message_type: 'share_chat',
        content: JSON.stringify({ chat_id: 'oc_shared' }),
      },
    });
    const result = parseMessageEvent(raw, { botOpenId: BOT_OPEN_ID });
    expect(result).not.toBeNull();
    if (result!.content.type !== 'share_chat') throw new Error('expected share_chat');
    expect(result!.content.chatId).toBe('oc_shared');
  });

  it('parses share_user message', () => {
    const raw = buildEvent({
      message: {
        message_type: 'share_user',
        content: JSON.stringify({ user_id: 'ou_shared_user' }),
      },
    });
    const result = parseMessageEvent(raw, { botOpenId: BOT_OPEN_ID });
    expect(result).not.toBeNull();
    if (result!.content.type !== 'share_user') throw new Error('expected share_user');
    expect(result!.content.userId).toBe('ou_shared_user');
  });

  it('returns null for malformed JSON in event.message.content', () => {
    const raw = buildEvent({
      message: {
        message_type: 'text',
        content: '{not json',
      },
    });
    const result = parseMessageEvent(raw, { botOpenId: BOT_OPEN_ID });
    expect(result).toBeNull();
  });

  it('returns null when event envelope is missing', () => {
    expect(parseMessageEvent({}, { botOpenId: BOT_OPEN_ID })).toBeNull();
    expect(parseMessageEvent(null, { botOpenId: BOT_OPEN_ID })).toBeNull();
    expect(parseMessageEvent(undefined, { botOpenId: BOT_OPEN_ID })).toBeNull();
  });

  it('captures rootMessageId when present', () => {
    const raw = buildEvent({
      message: { root_id: 'om_root_1' },
    });
    const result = parseMessageEvent(raw, { botOpenId: BOT_OPEN_ID });
    expect(result!.rootMessageId).toBe('om_root_1');
  });
});
