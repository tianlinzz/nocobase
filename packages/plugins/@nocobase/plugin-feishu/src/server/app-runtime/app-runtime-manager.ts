/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import type { FeishuClientManager } from '../transport/feishu-client-manager';
import type { FeishuWebSocketManager } from '../transport/ws-connection-manager';
import type { AppRegistry, AppRuntimeStatus } from './app-registry';

export interface AppConfigRow {
  app_id: string;
  app_secret: string;
  encrypt_key?: string;
  verification_token?: string;
  status: string;
  bot_open_id?: string;
}

export interface AppRuntimeLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export interface AppRuntimeManagerDeps {
  clientManager: Pick<FeishuClientManager, 'addApp' | 'removeApp'>;
  wsManager: Pick<FeishuWebSocketManager, 'addConnection' | 'removeConnection' | 'startConnection' | 'stopConnection'>;
  registry: AppRegistry;
  loadActiveAppRows: () => Promise<AppConfigRow[]>;
  loadAppRow: (appId: string) => Promise<AppConfigRow | null>;
  log: AppRuntimeLogger;
}

/**
 * Owns the start / stop / reload lifecycle of every Feishu app at the process
 * level. Concurrent calls for the same `appId` serialize through {@link withLock}
 * so we never half-start a connection while another caller stops it.
 */
export class FeishuAppRuntimeManager {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: AppRuntimeManagerDeps) {}

  /** Run an exclusive section per `appId`. */
  private async withLock<T>(appId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(appId) ?? Promise.resolve();
    let release: () => void = () => {};
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(
      appId,
      prev.then(() => next),
    );
    try {
      await prev;
      return await fn();
    } finally {
      release();
    }
  }

  async startActiveApps(): Promise<void> {
    const rows = await this.deps.loadActiveAppRows();
    this.deps.log.info(`feishu.runtime.startActiveApps count=${rows.length}`);
    if (rows.length === 0) {
      this.deps.log.warn(
        'feishu.runtime.no-active-apps — nothing to connect. Configure an app at /v2/admin/settings/feishu and ensure status="active".',
      );
      return;
    }
    for (const row of rows) {
      try {
        await this.start(row.app_id);
      } catch (err) {
        this.deps.log.error(`failed to start feishu app ${row.app_id}: ${(err as Error).message}`);
      }
    }
  }

  async start(appId: string): Promise<void> {
    return this.withLock(appId, async () => {
      const row = await this.deps.loadAppRow(appId);
      if (!row || row.status !== 'active') {
        return;
      }
      this.deps.registry.set({ appId, state: 'starting', reconnectCount: 0 });
      this.deps.clientManager.addApp({ appId: row.app_id, appSecret: row.app_secret });
      this.deps.wsManager.addConnection({
        appId: row.app_id,
        appSecret: row.app_secret,
        encryptKey: row.encrypt_key,
        verificationToken: row.verification_token,
      });
      try {
        await this.deps.wsManager.startConnection(appId);
        this.deps.registry.set({
          appId,
          state: 'running',
          startedAt: Date.now(),
          reconnectCount: 0,
        });
        this.deps.log.info(`feishu.app.start ${appId}`);
      } catch (err) {
        const message = (err as Error).message;
        this.deps.registry.set({ appId, state: 'failed', lastError: message, reconnectCount: 0 });
        this.deps.log.error(`feishu.app.start.failed ${appId} ${message}`);
        this.deps.clientManager.removeApp(appId);
        this.deps.wsManager.removeConnection(appId);
        throw err;
      }
    });
  }

  async stop(appId: string): Promise<void> {
    return this.withLock(appId, async () => {
      const current = this.deps.registry.get(appId);
      this.deps.registry.set({
        appId,
        reconnectCount: current?.reconnectCount ?? 0,
        startedAt: current?.startedAt,
        lastError: current?.lastError,
        state: 'stopping',
      });
      try {
        await this.deps.wsManager.stopConnection(appId);
      } finally {
        this.deps.clientManager.removeApp(appId);
        this.deps.wsManager.removeConnection(appId);
        this.deps.registry.set({ appId, state: 'stopped', reconnectCount: 0 });
        this.deps.log.info(`feishu.app.stop ${appId}`);
      }
    });
  }

  async reload(appId: string): Promise<void> {
    await this.stop(appId);
    await this.start(appId);
  }

  async stopAll(): Promise<void> {
    const ids = this.deps.registry.list().map((s) => s.appId);
    for (const id of ids) {
      try {
        await this.stop(id);
      } catch (err) {
        this.deps.log.warn(`feishu.app.stopAll.error ${id} ${(err as Error).message}`);
      }
    }
  }

  getOverview(): AppRuntimeStatus[] {
    return this.deps.registry.list();
  }
}
