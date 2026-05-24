/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

export interface CardActionDedupCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttlSec: number): Promise<void>;
}

export class CardActionDedup {
  constructor(
    private readonly cache: CardActionDedupCache,
    private readonly ttlSec = 600,
  ) {}

  async tryRecord(appId: string, eventId: string): Promise<boolean> {
    const cacheKey = `feishu:card-action-dedup:${appId}:${eventId}`;
    const exists = await this.cache.get(cacheKey);
    if (exists) return false;
    await this.cache.set(cacheKey, 1, this.ttlSec);
    return true;
  }
}
