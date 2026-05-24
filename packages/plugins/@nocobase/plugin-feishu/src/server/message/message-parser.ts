/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import type { Mention, ParsedContent, ParsedMessage } from './types';

const SUPPORTED_TYPES = new Set<ParsedContent['type']>([
  'text',
  'post',
  'image',
  'file',
  'interactive',
  'share_chat',
  'share_user',
]);

/**
 * Two real-world shapes feed parseMessageEvent:
 *
 *  1. Webhook envelope (open.feishu.cn HTTP push):
 *     `{ schema, header: { event_id, ... }, event: { message, sender } }`
 *  2. WebSocket dispatcher inner event (Lark SDK `EventDispatcher`):
 *     `{ message, sender, schema, ... }` — no outer `header` / `event` wrapper.
 *
 * We accept both. The unwrapped result is always `{ event, header? }` so the
 * downstream parser can stay shape-agnostic.
 */
type RawEvent = Record<string, unknown>;

function unwrapEvent(raw: RawEvent): { event: Record<string, unknown>; header?: Record<string, unknown> } | null {
  const enveloped = raw.event;
  if (isObject(enveloped) && isObject(enveloped.message)) {
    return {
      event: enveloped,
      header: isObject(raw.header) ? raw.header : undefined,
    };
  }
  if (isObject(raw.message)) {
    return { event: raw, header: isObject(raw.header) ? raw.header : undefined };
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function safeParseJson(input: unknown): Record<string, unknown> | undefined {
  if (typeof input !== 'string') return undefined;
  try {
    const parsed = JSON.parse(input);
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizeChatType(value: unknown, chatId: string | undefined): 'p2p' | 'group' {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'group' || raw === 'p2p') return raw;
  if (raw === 'private' || raw === 'single') return 'p2p';
  return chatId?.startsWith('oc_') ? 'group' : 'p2p';
}

function parseMentions(raw: unknown): Mention[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObject).map((m) => {
    const idObj = isObject(m.id) ? m.id : {};
    const mention: Mention = {
      key: typeof m.key === 'string' ? m.key : '',
      id: {
        open_id: asString(idObj.open_id),
        user_id: asString(idObj.user_id),
        union_id: asString(idObj.union_id),
      },
      name: asString(m.name),
    };
    return mention;
  });
}

function buildContent(messageType: string, contentObj: Record<string, unknown>): ParsedContent | null {
  switch (messageType) {
    case 'text': {
      return { type: 'text', text: typeof contentObj.text === 'string' ? contentObj.text : '' };
    }
    case 'post': {
      const titleSrc =
        (isObject(contentObj.zh_cn) && asString(contentObj.zh_cn.title)) ||
        (isObject(contentObj.en_us) && asString(contentObj.en_us.title)) ||
        asString(contentObj.title);
      return { type: 'post', title: titleSrc, content: contentObj };
    }
    case 'image': {
      const imageKey = asString(contentObj.image_key);
      if (!imageKey) return null;
      return { type: 'image', imageKey };
    }
    case 'file': {
      const fileKey = asString(contentObj.file_key);
      if (!fileKey) return null;
      return { type: 'file', fileKey, fileName: asString(contentObj.file_name) };
    }
    case 'interactive': {
      return { type: 'interactive', card: contentObj };
    }
    case 'share_chat': {
      const chatId = asString(contentObj.chat_id) || asString(contentObj.share_chat_id);
      if (!chatId) return null;
      return { type: 'share_chat', chatId };
    }
    case 'share_user': {
      const userId = asString(contentObj.user_id) || asString(contentObj.open_id);
      if (!userId) return null;
      return { type: 'share_user', userId };
    }
    default:
      return null;
  }
}

function parseCreateTime(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function parseMessageEvent(rawEvent: unknown, opts: { botOpenId: string | undefined }): ParsedMessage | null {
  if (!isObject(rawEvent)) return null;
  const unwrapped = unwrapEvent(rawEvent as RawEvent);
  if (!unwrapped) return null;
  const event = unwrapped.event;
  const messageRaw = event.message;
  if (!isObject(messageRaw)) return null;

  const message = messageRaw;
  const sender = isObject(event.sender) ? event.sender : {};
  const header = unwrapped.header ?? {};

  const messageType = typeof message.message_type === 'string' ? message.message_type : '';
  if (!SUPPORTED_TYPES.has(messageType as ParsedContent['type'])) return null;

  const contentObj = safeParseJson(message.content);
  if (!contentObj) return null;

  const content = buildContent(messageType, contentObj);
  if (!content) return null;

  const chatId = asString(message.chat_id) || '';
  const chatType = normalizeChatType(message.chat_type, chatId);
  const mentions = parseMentions(message.mentions);
  const senderIdObj = isObject(sender.sender_id) ? sender.sender_id : {};
  const senderOpenId = asString(senderIdObj.open_id) || asString((sender as Record<string, unknown>).open_id) || '';

  const mentionsBot = !!opts.botOpenId && mentions.some((m) => m.id.open_id === opts.botOpenId);
  const isMentionBot = chatType === 'p2p' || mentionsBot;

  // Inner-event payloads (WS dispatcher) lose the envelope's `event_id`.
  // Fall back to `message_id` so downstream dedup/log keys remain stable.
  const eventId = asString(header.event_id) || asString(message.message_id) || '';

  return {
    eventId,
    messageId: asString(message.message_id) || '',
    chatId,
    chatType,
    senderOpenId,
    senderName: asString((sender as Record<string, unknown>).sender_name),
    createTime: parseCreateTime(message.create_time),
    contentType: content.type,
    content,
    rootMessageId: asString(message.root_id),
    mentions,
    isMentionBot,
  };
}
