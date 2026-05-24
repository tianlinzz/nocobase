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
import { FeishuCardKitClient } from './feishu-cardkit-client';

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

  /**
   * Lazy-construct a {@link FeishuCardKitClient} bound to the given app's
   * lark client. Returned instance is stateless w.r.t. CardKit, so it's
   * safe to construct on every call — but throws if the app hasn't been
   * registered via `addApp` yet.
   */
  getCardKitClient(appId: string): FeishuCardKitClient {
    return new FeishuCardKitClient(this.requireClient(appId));
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

  /**
   * Add an emoji reaction to a Feishu message. Used by the AI bridge to
   * give the user immediate "received, processing" feedback on their own
   * message before the AI's streaming card has time to render.
   *
   * `emojiType` must be one of Feishu's predefined reaction emoji_type
   * constants (e.g. `'EYES'`, `'OK'`, `'DONE'`); arbitrary unicode emoji
   * are rejected by the Feishu API with code 231001.
   */
  async addReaction(params: { appId: string; messageId: string; emojiType: string }): Promise<{ reactionId: string }> {
    const client = this.requireClient(params.appId);
    const resp = await client.im.messageReaction.create({
      data: { reaction_type: { emoji_type: params.emojiType } },
      path: { message_id: params.messageId },
    });
    if (resp.code !== 0) {
      throw new FeishuApiError(
        `feishu addReaction failed: ${resp.msg ?? 'unknown'}`,
        resp.code ?? -1,
        extractRequestId(resp),
      );
    }
    const reactionId = resp.data?.reaction_id;
    if (!reactionId) {
      throw new FeishuApiError('feishu addReaction returned no reaction_id', -1, extractRequestId(resp));
    }
    return { reactionId };
  }

  /** Remove a previously added reaction. Pair with {@link addReaction}. */
  async removeReaction(params: { appId: string; messageId: string; reactionId: string }): Promise<void> {
    const client = this.requireClient(params.appId);
    const resp = await client.im.messageReaction.delete({
      path: { message_id: params.messageId, reaction_id: params.reactionId },
    });
    if (resp.code !== 0) {
      throw new FeishuApiError(
        `feishu removeReaction failed: ${resp.msg ?? 'unknown'}`,
        resp.code ?? -1,
        extractRequestId(resp),
      );
    }
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
   * Lightweight credential check: ask the SDK to mint an `app_access_token`.
   * Distinct from {@link getBotInfo} so callers that only want to verify the
   * app_id/app_secret pair (e.g. {@link SecretService.validate}) are not
   * affected by `bot/v3/info` failing for unrelated reasons (e.g. the app
   * has not been published yet, or a local HTTP proxy returns 400 for that
   * specific endpoint).
   */
  async validateCredentials(appId: string): Promise<{ requestId?: string }> {
    const client = this.requireClient(appId);
    const tokenResp = await client.auth.appAccessToken.internal({
      data: {},
    });
    if (tokenResp.code !== 0) {
      throw new FeishuApiError(
        `feishu validateCredentials failed: ${tokenResp.msg ?? 'unknown'}`,
        tokenResp.code ?? -1,
        extractRequestId(tokenResp),
      );
    }
    return { requestId: extractRequestId(tokenResp) };
  }

  /**
   * Fetch real bot identity (`bot.open_id`, `bot.app_name`) so the UI can
   * render which robot we are bound to. The Lark Node SDK does not expose a
   * stable wrapper for the `/open-apis/bot/v3/info` endpoint, so we call
   * `client.request` directly.
   *
   * Note: the SDK's default response interceptor returns `resp.data`, meaning
   * the body we receive is already the Feishu envelope `{ code, msg, data }`
   * — do not unwrap it again.
   */
  async getBotInfo(appId: string): Promise<FeishuBotInfo> {
    const client = this.requireClient(appId);
    const body = (await client.request({
      method: 'GET',
      url: '/open-apis/bot/v3/info',
    })) as { code?: number; msg?: string; data?: Record<string, unknown>; bot?: Record<string, unknown> };
    const code = body?.code ?? -1;
    if (code !== 0) {
      throw new FeishuApiError(`feishu getBotInfo failed: ${body?.msg ?? 'unknown'}`, code, extractRequestId(body));
    }
    // Feishu has shipped two payload shapes over time: `{ data: { bot: {...} } }`
    // and a flatter `{ bot: {...} }`. Tolerate both.
    const data = body.data && typeof body.data === 'object' ? body.data : body;
    const botRaw = (data as Record<string, unknown>).bot ?? data;
    const bot = botRaw && typeof botRaw === 'object' ? (botRaw as Record<string, unknown>) : {};
    const botOpenId = typeof bot.open_id === 'string' ? bot.open_id : undefined;
    const botName = typeof bot.app_name === 'string' ? bot.app_name : undefined;
    return { appId, botOpenId, botName };
  }
}
