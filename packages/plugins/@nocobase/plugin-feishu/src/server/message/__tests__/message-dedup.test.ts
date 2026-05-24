/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, it, expect } from 'vitest';
import { MessageDedup, MessageDedupCache } from '../message-dedup';

class MemoryCache implements MessageDedupCache {
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

describe('MessageDedup', () => {
  it('first tryRecord returns true', async () => {
    const cache = new MemoryCache();
    const dedup = new MessageDedup(cache);
    expect(await dedup.tryRecord('app1', 'ev_1')).toBe(true);
  });

  it('second tryRecord with same key returns false', async () => {
    const cache = new MemoryCache();
    const dedup = new MessageDedup(cache);
    expect(await dedup.tryRecord('app1', 'ev_1')).toBe(true);
    expect(await dedup.tryRecord('app1', 'ev_1')).toBe(false);
  });

  it('different appIds are isolated', async () => {
    const cache = new MemoryCache();
    const dedup = new MessageDedup(cache);
    expect(await dedup.tryRecord('app1', 'ev_1')).toBe(true);
    expect(await dedup.tryRecord('app2', 'ev_1')).toBe(true);
  });

  it('passes ttlSec to cache.set (default and custom)', async () => {
    const cache = new MemoryCache();
    const dedup = new MessageDedup(cache, 600);
    await dedup.tryRecord('app1', 'ev_1');
    expect(cache.setCalls[0].ttlSec).toBe(600);
    await dedup.tryRecord('app1', 'ev_2', 30);
    expect(cache.setCalls[1].ttlSec).toBe(30);
  });

  it('uses namespaced cache key', async () => {
    const cache = new MemoryCache();
    const dedup = new MessageDedup(cache);
    await dedup.tryRecord('app1', 'ev_1');
    expect(cache.setCalls[0].key).toBe('feishu:message-dedup:app1:ev_1');
  });
});
