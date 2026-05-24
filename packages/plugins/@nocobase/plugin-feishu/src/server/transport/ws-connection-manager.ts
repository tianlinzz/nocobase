/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import { FeishuAppConfig } from './types';

/**
 * @deprecated Prefer {@link FeishuAppConfig}. Re-exported as a type alias to
 * keep external callers stable without duplicating the shape.
 */
export type WSConfig = FeishuAppConfig;

export interface WSEventHandlers {
  onMessage(appId: string, event: unknown): Promise<void>;
  onCardAction(appId: string, event: unknown): Promise<unknown>;
}

interface Entry {
  config: FeishuAppConfig;
  client?: Lark.WSClient;
  running: boolean;
}

export class FeishuWebSocketManager {
  private entries = new Map<string, Entry>();

  constructor(private handlers: WSEventHandlers) {}

  addConnection(config: FeishuAppConfig): void {
    this.entries.set(config.appId, { config, running: false });
  }

  removeConnection(appId: string): void {
    this.entries.delete(appId);
  }

  isRunning(appId: string): boolean {
    return this.entries.get(appId)?.running ?? false;
  }

  getConnectedAppIds(): string[] {
    return [...this.entries.entries()].filter(([, e]) => e.running).map(([id]) => id);
  }

  async startConnection(appId: string): Promise<void> {
    const entry = this.entries.get(appId);
    if (!entry) {
      throw new Error(`ws connection not registered: ${appId}`);
    }
    if (entry.running) {
      return;
    }
    const client = new Lark.WSClient({
      appId: entry.config.appId,
      appSecret: entry.config.appSecret,
      domain: Lark.Domain.Feishu,
      loggerLevel: Lark.LoggerLevel.warn,
    });
    const eventDispatcher = new Lark.EventDispatcher({
      encryptKey: entry.config.encryptKey,
      verificationToken: entry.config.verificationToken,
      loggerLevel: Lark.LoggerLevel.warn,
    }).register({
      'im.message.receive_v1': async (event: unknown) => {
        await this.handlers.onMessage(appId, event);
      },
      'card.action.trigger': async (event: unknown) => {
        return this.handlers.onCardAction(appId, event);
      },
    });
    client.start({ eventDispatcher });
    entry.client = client;
    entry.running = true;
  }

  async stopConnection(appId: string): Promise<void> {
    const entry = this.entries.get(appId);
    if (!entry || !entry.running) {
      return;
    }
    const client = entry.client as { stop?: () => void; disconnect?: () => void } | undefined;
    if (client?.stop) {
      client.stop();
    } else if (client?.disconnect) {
      client.disconnect();
    }
    entry.client = undefined;
    entry.running = false;
  }

  async stopAll(): Promise<void> {
    const ids = [...this.entries.keys()];
    for (const id of ids) {
      await this.stopConnection(id);
    }
  }
}
