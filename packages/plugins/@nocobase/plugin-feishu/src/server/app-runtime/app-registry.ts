/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

export type AppRuntimeState = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed';

export interface AppRuntimeStatus {
  appId: string;
  state: AppRuntimeState;
  startedAt?: number;
  lastError?: string;
  reconnectCount: number;
}

/**
 * In-memory registry of per-app runtime status. Keyed by `appId`.
 *
 * The registry is intentionally a thin map wrapper — persistence is handled by
 * the `feishu_apps.last_connected_at` / `last_error` columns.
 */
export class AppRegistry {
  private readonly map = new Map<string, AppRuntimeStatus>();

  set(status: AppRuntimeStatus): void {
    this.map.set(status.appId, status);
  }

  get(appId: string): AppRuntimeStatus | undefined {
    return this.map.get(appId);
  }

  delete(appId: string): void {
    this.map.delete(appId);
  }

  list(): AppRuntimeStatus[] {
    return [...this.map.values()];
  }
}
