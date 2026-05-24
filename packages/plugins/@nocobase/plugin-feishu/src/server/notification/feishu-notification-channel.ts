/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import type { Transactionable } from '@nocobase/database';
import type { Application } from '@nocobase/server';
import { BaseNotificationChannel } from '@nocobase/plugin-notification-manager';
import { FeishuClientManager } from '../transport/feishu-client-manager';
import { FeishuApiError, ReceiveIdType } from '../transport/types';

export interface FeishuNotificationMessage {
  appId: string;
  receiveId?: string;
  receiveIdType?: ReceiveIdType;
  msgType?: 'text' | 'post' | 'interactive';
  content: string | Record<string, unknown>;
}

export interface FeishuChannelOptions {
  appId: string;
}

export interface FeishuReceiver {
  receiveId: string;
  receiveIdType: ReceiveIdType;
}

export interface FeishuChannelDeps {
  clientManager: FeishuClientManager;
}

export interface FeishuSendParams {
  channel: { options?: FeishuChannelOptions };
  message: FeishuNotificationMessage;
  receivers?: FeishuReceiver[];
  transaction?: Transactionable['transaction'];
}

export type FeishuSendResult = {
  message: FeishuNotificationMessage;
  status: 'success' | 'failure';
  reason?: string;
};

/**
 * Notification channel for Feishu (Lark).
 *
 * Phase 8 only ships the class and unit tests; it is intentionally NOT
 * registered with `@nocobase/plugin-notification-manager` yet, so it will
 * not appear in the notification settings UI. Wiring (server registration
 * and client form) lands in a later phase.
 *
 * Because no caller passes an `Application` in this phase, the constructor
 * signature accepts the runtime dependencies directly. When the channel is
 * later registered via `notificationServer.registerChannelType`, this
 * constructor will be reconciled with the manager's `(app) => instance`
 * factory by introducing a thin adapter at the registration site.
 */
export class FeishuNotificationChannel extends BaseNotificationChannel<FeishuNotificationMessage> {
  constructor(private deps: FeishuChannelDeps) {
    // The base class stores `app` for subclasses that need DB / logger access.
    // This channel only depends on `clientManager`, so we pass an unused
    // placeholder rather than threading `Application` through every test.
    super(null as unknown as Application);
  }

  async send(params: FeishuSendParams): Promise<FeishuSendResult> {
    const appId = params.channel.options?.appId ?? params.message.appId;
    if (!appId) {
      return { message: params.message, status: 'failure', reason: 'feishu app id missing' };
    }
    if (!this.deps.clientManager.hasApp(appId)) {
      return { message: params.message, status: 'failure', reason: `feishu app not running: ${appId}` };
    }

    const targets = this.resolveReceivers(params);
    if (targets.length === 0) {
      return { message: params.message, status: 'failure', reason: 'no receivers' };
    }

    const msgType = params.message.msgType ?? 'text';
    const content =
      typeof params.message.content === 'string' ? { text: params.message.content } : params.message.content;

    try {
      for (const target of targets) {
        await this.deps.clientManager.sendMessage({
          appId,
          receiveId: target.receiveId,
          receiveIdType: target.receiveIdType,
          msgType,
          content,
        });
      }
      return { message: params.message, status: 'success' };
    } catch (err) {
      const reason =
        err instanceof FeishuApiError
          ? `feishu api code=${err.code}`
          : err instanceof Error
            ? err.message
            : String(err);
      return { message: params.message, status: 'failure', reason };
    }
  }

  private resolveReceivers(params: FeishuSendParams): FeishuReceiver[] {
    if (params.receivers && params.receivers.length > 0) {
      return params.receivers;
    }
    if (params.message.receiveId && params.message.receiveIdType) {
      return [
        {
          receiveId: params.message.receiveId,
          receiveIdType: params.message.receiveIdType,
        },
      ];
    }
    return [];
  }
}
