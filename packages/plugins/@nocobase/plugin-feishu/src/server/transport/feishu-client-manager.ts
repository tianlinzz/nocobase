/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import {
  extractRequestId,
  FeishuApiError,
  FeishuAppConfig,
  FeishuBotInfo,
  ReplyMessageParams,
  SendMessageParams,
  SendMessageResult,
  UpdateMessageParams,
  UploadImageParams,
} from './types';

const stringifyContent = (content: unknown): string =>
  typeof content === 'string' ? content : JSON.stringify(content);

export class FeishuClientManager {
  private clients = new Map<string, Lark.Client>();

  addApp(config: FeishuAppConfig): void {
    if (!config.appId || !config.appSecret) {
      throw new Error('feishu app config requires appId and appSecret');
    }
    const client = new Lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      appType: Lark.AppType.SelfBuild,
      domain: Lark.Domain.Feishu,
      loggerLevel: Lark.LoggerLevel.warn,
    });
    this.clients.set(config.appId, client);
  }

  removeApp(appId: string): void {
    this.clients.delete(appId);
  }

  getClient(appId: string): Lark.Client | undefined {
    return this.clients.get(appId);
  }

  hasApp(appId: string): boolean {
    return this.clients.has(appId);
  }

  private requireClient(appId: string): Lark.Client {
    const client = this.clients.get(appId);
    if (!client) {
      throw new Error(`feishu app not initialized: ${appId}`);
    }
    return client;
  }

  async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
    const client = this.requireClient(params.appId);
    const resp = await client.im.message.create({
      params: { receive_id_type: params.receiveIdType },
      data: {
        receive_id: params.receiveId,
        msg_type: params.msgType,
        content: stringifyContent(params.content),
      },
    });
    if (resp.code !== 0) {
      throw new FeishuApiError(
        `feishu sendMessage failed: ${resp.msg ?? 'unknown'}`,
        resp.code ?? -1,
        extractRequestId(resp),
      );
    }
    return {
      messageId: resp.data?.message_id ?? '',
      requestId: extractRequestId(resp),
    };
  }

  async replyMessage(params: ReplyMessageParams): Promise<SendMessageResult> {
    const client = this.requireClient(params.appId);
    const resp = await client.im.message.reply({
      path: { message_id: params.messageId },
      data: {
        msg_type: params.msgType,
        content: stringifyContent(params.content),
        ...(params.replyInThread !== undefined ? { reply_in_thread: params.replyInThread } : {}),
      },
    });
    if (resp.code !== 0) {
      throw new FeishuApiError(
        `feishu replyMessage failed: ${resp.msg ?? 'unknown'}`,
        resp.code ?? -1,
        extractRequestId(resp),
      );
    }
    return {
      messageId: resp.data?.message_id ?? '',
      requestId: extractRequestId(resp),
    };
  }

  async updateMessage(params: UpdateMessageParams): Promise<void> {
    const client = this.requireClient(params.appId);
    const resp = await client.im.message.patch({
      path: { message_id: params.messageId },
      data: { content: stringifyContent(params.content) },
    });
    if (resp.code !== 0) {
      throw new FeishuApiError(
        `feishu updateMessage failed: ${resp.msg ?? 'unknown'}`,
        resp.code ?? -1,
        extractRequestId(resp),
      );
    }
  }

  async uploadImage(params: UploadImageParams): Promise<string> {
    const client = this.requireClient(params.appId);
    const resp = await client.im.image.create({
      data: { image_type: params.imageType, image: params.data },
    });
    if (resp.code !== 0) {
      throw new FeishuApiError(
        `feishu uploadImage failed: ${resp.msg ?? 'unknown'}`,
        resp.code ?? -1,
        extractRequestId(resp),
      );
    }
    return resp.data?.image_key ?? '';
  }

  /**
   * Validate the configured credentials for an app.
   *
   * Phase 2 only verifies that the app credentials can mint an access token; the
   * `botName` / `botOpenId` fields on `FeishuBotInfo` are intentionally left
   * unpopulated until a follow-up task wires `application.application.get`.
   */
  async getBotInfo(appId: string): Promise<FeishuBotInfo> {
    const client = this.requireClient(appId);
    const tokenResp = await client.auth.appAccessToken.internal({
      data: {},
    });
    if (tokenResp.code !== 0) {
      throw new FeishuApiError(
        `feishu getBotInfo failed: ${tokenResp.msg ?? 'unknown'}`,
        tokenResp.code ?? -1,
        (tokenResp as { requestId?: string }).requestId,
      );
    }
    return { appId };
  }
}
