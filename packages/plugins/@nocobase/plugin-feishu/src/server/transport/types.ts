/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

export interface FeishuAppConfig {
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
}

export type ReceiveIdType = 'open_id' | 'user_id' | 'union_id' | 'chat_id';

export interface SendMessageParams {
  appId: string;
  receiveId: string;
  receiveIdType: ReceiveIdType;
  msgType: 'text' | 'post' | 'interactive' | 'image';
  content: unknown;
}

export interface ReplyMessageParams {
  appId: string;
  messageId: string;
  msgType: 'text' | 'post' | 'interactive' | 'image';
  content: unknown;
  replyInThread?: boolean;
}

export interface UpdateMessageParams {
  appId: string;
  messageId: string;
  content: unknown;
}

export interface UploadImageParams {
  appId: string;
  imageType: 'message' | 'avatar';
  data: Buffer | NodeJS.ReadableStream;
}

export interface SendMessageResult {
  messageId: string;
  requestId?: string;
}

export interface FeishuBotInfo {
  appId: string;
  botName?: string;
  botOpenId?: string;
}

export class FeishuApiError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'FeishuApiError';
  }
}

/**
 * Lark SDK responses don't expose `requestId` on a public type.
 * Use this helper instead of an inline cast at every call site.
 */
export const extractRequestId = (resp: unknown): string | undefined => {
  if (resp && typeof resp === 'object' && 'requestId' in resp) {
    const id = (resp as { requestId?: unknown }).requestId;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
};
