/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, it, expect } from 'vitest';
import { CardActionDedup, CardActionDedupCache } from '../card-action-dedup';

class MemoryCache implements CardActionDedupCache {
  store = new Map<string, { value: unknown; ttlSec: number }>();
  setCalls: Array<{ key: string; value: unknown; ttlSec: number }> = [];

  async get(key: string): Promise<unknown> {
    return this.store.get(key)?.value;
  }

  async set(key: string, value: unknown, ttlSec: number): Promise<void> {
    this.setCalls.push({ key, value, ttlSec });
    this.store.set(key, { value, ttlSec });
  }
}

describe('CardActionDedup', () => {
  it('first tryRecord returns true', async () => {
    const cache = new MemoryCache();
    const dedup = new CardActionDedup(cache);
    expect(await dedup.tryRecord('app1', 'ev_1')).toBe(true);
  });

  it('second tryRecord with same (appId, eventId) returns false', async () => {
    const cache = new MemoryCache();
    const dedup = new CardActionDedup(cache);
    expect(await dedup.tryRecord('app1', 'ev_1')).toBe(true);
    expect(await dedup.tryRecord('app1', 'ev_1')).toBe(false);
  });

  it('different appIds with same eventId both return true', async () => {
    const cache = new MemoryCache();
    const dedup = new CardActionDedup(cache);
    expect(await dedup.tryRecord('app1', 'ev_x')).toBe(true);
    expect(await dedup.tryRecord('app2', 'ev_x')).toBe(true);
  });

  it('uses namespaced cache key and forwards ttlSec', async () => {
    const cache = new MemoryCache();
    const dedup = new CardActionDedup(cache, 60);
    await dedup.tryRecord('app1', 'ev_1');
    expect(cache.setCalls[0].key).toBe('feishu:card-action-dedup:app1:ev_1');
    expect(cache.setCalls[0].ttlSec).toBe(60);
  });
});
