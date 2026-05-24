/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, it, expect, vi } from 'vitest';
import { FeishuMessageQueue, RetryableQueueError } from '../message-queue';

function createLogger() {
  return { error: vi.fn() };
}

const noopDelay = async (_ms: number) => {
  // immediate resolution for tests
};

describe('FeishuMessageQueue', () => {
  it('processes items in FIFO order for a single appId', async () => {
    const queue = new FeishuMessageQueue<number>({ logger: createLogger(), delay: noopDelay });
    const seen: number[] = [];
    queue.consume(async (_appId, payload) => {
      seen.push(payload);
    });
    await queue.enqueue('app1', 1);
    await queue.enqueue('app1', 2);
    await queue.enqueue('app1', 3);
    await queue.drain();
    expect(seen).toEqual([1, 2, 3]);
  });

  it('preserves order per appId across two different appIds', async () => {
    const queue = new FeishuMessageQueue<{ app: string; n: number }>({
      logger: createLogger(),
      delay: noopDelay,
    });
    const seenA: number[] = [];
    const seenB: number[] = [];
    queue.consume(async (appId, payload) => {
      if (appId === 'A') seenA.push(payload.n);
      else seenB.push(payload.n);
    });
    await queue.enqueue('A', { app: 'A', n: 1 });
    await queue.enqueue('B', { app: 'B', n: 10 });
    await queue.enqueue('A', { app: 'A', n: 2 });
    await queue.enqueue('B', { app: 'B', n: 20 });
    await queue.drain();
    expect(seenA).toEqual([1, 2]);
    expect(seenB).toEqual([10, 20]);
  });

  it('retries on RetryableQueueError up to 3 times then logs error', async () => {
    const logger = createLogger();
    const queue = new FeishuMessageQueue<number>({ logger, delay: noopDelay });
    const handler = vi.fn().mockImplementation(async () => {
      throw new RetryableQueueError('transient');
    });
    queue.consume(handler);
    await queue.enqueue('app1', 1);
    await queue.drain();
    expect(handler).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('does not retry on non-retryable error and logs once', async () => {
    const logger = createLogger();
    const queue = new FeishuMessageQueue<number>({ logger, delay: noopDelay });
    const handler = vi.fn().mockImplementation(async () => {
      throw new Error('boom');
    });
    queue.consume(handler);
    await queue.enqueue('app1', 1);
    await queue.drain();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('enqueue returns before consume handler finishes', async () => {
    const queue = new FeishuMessageQueue<number>({ logger: createLogger(), delay: noopDelay });
    let unblock: (() => void) | null = null;
    const blocker = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    let started: (() => void) | null = null;
    const handlerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    queue.consume(async () => {
      started?.();
      await blocker;
    });
    const enqueueResult = await queue.enqueue('app1', 1);
    expect(enqueueResult).toEqual({ enqueued: true });
    await handlerStarted;
    // handler is currently blocked; drain should be pending
    expect(unblock).not.toBeNull();
    unblock?.();
    await queue.drain();
  });
});
