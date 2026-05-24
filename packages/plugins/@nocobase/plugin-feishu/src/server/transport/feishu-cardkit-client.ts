/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import type * as Lark from '@larksuiteoapi/node-sdk';
import { extractRequestId, FeishuApiError } from './types';

export interface CreateCardEntityResult {
  cardId: string;
}

export interface SendCardByCardIdParams {
  receiveId: string;
  receiveIdType: 'open_id' | 'chat_id' | 'user_id' | 'union_id' | 'email';
  cardId: string;
}

export interface SendCardByCardIdResult {
  messageId: string;
}

export interface StreamCardContentParams {
  cardId: string;
  elementId: string;
  /** Full accumulated text — CardKit replaces the element content. */
  content: string;
  /** Monotonically increasing per card; CardKit uses this to order updates. */
  sequence: number;
}

export interface SetCardStreamingModeParams {
  cardId: string;
  streamingMode: boolean;
  sequence: number;
}

export interface UpdateCardKitCardParams {
  cardId: string;
  cardJson: Record<string, unknown>;
  sequence: number;
}

/**
 * Thin wrapper over the lark SDK's CardKit + interactive-message endpoints.
 *
 * Each method maps 1:1 to a single SDK call, stringifies any nested JSON the
 * SDK expects as a string field, and surfaces non-zero `code` as
 * {@link FeishuApiError} so callers can react uniformly with the rest of the
 * client manager surface.
 *
 * Has no business logic, no retry, no state — that lives in
 * `streaming-card-controller.ts`.
 */
export class FeishuCardKitClient {
  constructor(private readonly client: Lark.Client) {}

  async createCardEntity(cardJson: Record<string, unknown>): Promise<CreateCardEntityResult> {
    const resp = await this.client.cardkit.card.create({
      data: { type: 'card_json', data: JSON.stringify(cardJson) },
    });
    if (resp.code !== 0) {
      throw new FeishuApiError(
        `feishu cardkit.create failed: ${resp.msg ?? 'unknown'}`,
        resp.code ?? -1,
        extractRequestId(resp),
      );
    }
    const cardId = resp.data?.card_id;
    if (!cardId) {
      throw new FeishuApiError('feishu cardkit.create returned no card_id', -1, extractRequestId(resp));
    }
    return { cardId };
  }

  async sendCardByCardId(params: SendCardByCardIdParams): Promise<SendCardByCardIdResult> {
    const resp = await this.client.im.message.create({
      params: { receive_id_type: params.receiveIdType },
      data: {
        receive_id: params.receiveId,
        msg_type: 'interactive',
        content: JSON.stringify({ type: 'card', data: { card_id: params.cardId } }),
      },
    });
    if (resp.code !== 0) {
      throw new FeishuApiError(
        `feishu cardkit.sendCardByCardId failed: ${resp.msg ?? 'unknown'}`,
        resp.code ?? -1,
        extractRequestId(resp),
      );
    }
    const messageId = resp.data?.message_id;
    if (!messageId) {
      throw new FeishuApiError('feishu cardkit.sendCardByCardId returned no message_id', -1, extractRequestId(resp));
    }
    return { messageId };
  }

  async streamCardContent(params: StreamCardContentParams): Promise<void> {
    const resp = await this.client.cardkit.cardElement.content({
      data: { content: params.content, sequence: params.sequence },
      path: { card_id: params.cardId, element_id: params.elementId },
    });
    if (resp.code !== 0) {
      throw new FeishuApiError(
        `feishu cardkit.streamCardContent failed: ${resp.msg ?? 'unknown'}`,
        resp.code ?? -1,
        extractRequestId(resp),
      );
    }
  }

  async setCardStreamingMode(params: SetCardStreamingModeParams): Promise<void> {
    const resp = await this.client.cardkit.card.settings({
      data: {
        settings: JSON.stringify({ config: { streaming_mode: params.streamingMode } }),
        sequence: params.sequence,
      },
      path: { card_id: params.cardId },
    });
    if (resp.code !== 0) {
      throw new FeishuApiError(
        `feishu cardkit.setCardStreamingMode failed: ${resp.msg ?? 'unknown'}`,
        resp.code ?? -1,
        extractRequestId(resp),
      );
    }
  }

  async updateCardKitCard(params: UpdateCardKitCardParams): Promise<void> {
    const resp = await this.client.cardkit.card.update({
      data: {
        card: { type: 'card_json', data: JSON.stringify(params.cardJson) },
        sequence: params.sequence,
      },
      path: { card_id: params.cardId },
    });
    if (resp.code !== 0) {
      throw new FeishuApiError(
        `feishu cardkit.updateCardKitCard failed: ${resp.msg ?? 'unknown'}`,
        resp.code ?? -1,
        extractRequestId(resp),
      );
    }
  }
}
