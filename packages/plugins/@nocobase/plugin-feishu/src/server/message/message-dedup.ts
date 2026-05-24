/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

export interface MessageDedupCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttlSec: number): Promise<void>;
}

export class MessageDedup {
  constructor(
    private readonly cache: MessageDedupCache,
    private readonly defaultTtlSec = 600,
  ) {}

  async tryRecord(appId: string, key: string, ttlSec?: number): Promise<boolean> {
    const cacheKey = `feishu:message-dedup:${appId}:${key}`;
    const exists = await this.cache.get(cacheKey);
    if (exists) return false;
    await this.cache.set(cacheKey, 1, ttlSec ?? this.defaultTtlSec);
    return true;
  }
}
