/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

export class RetryableQueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableQueueError';
  }
}

export interface QueueLogger {
  error: (message: string, meta?: Record<string, unknown>) => void;
}

export interface QueueRunner<T> {
  enqueue(appId: string, payload: T): Promise<{ enqueued: true }>;
  consume(handler: (appId: string, payload: T) => Promise<void>): void;
  drain(): Promise<void>;
}

export interface FeishuMessageQueueOptions {
  logger: QueueLogger;
  delay?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  baseBackoffMs?: number;
}

const defaultDelay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class FeishuMessageQueue<T = unknown> implements QueueRunner<T> {
  private readonly logger: QueueLogger;
  private readonly delay: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly chains = new Map<string, Promise<void>>();
  private handler: ((appId: string, payload: T) => Promise<void>) | null = null;

  constructor(options: FeishuMessageQueueOptions) {
    this.logger = options.logger;
    this.delay = options.delay ?? defaultDelay;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseBackoffMs = options.baseBackoffMs ?? 100;
  }

  consume(handler: (appId: string, payload: T) => Promise<void>): void {
    this.handler = handler;
  }

  async enqueue(appId: string, payload: T): Promise<{ enqueued: true }> {
    const previous = this.chains.get(appId) ?? Promise.resolve();
    const next = previous.then(() => this.process(appId, payload));
    // ensure chain doesn't accumulate rejections
    this.chains.set(
      appId,
      next.catch(() => undefined),
    );
    return { enqueued: true };
  }

  async drain(): Promise<void> {
    while (this.chains.size > 0) {
      const snapshot = Array.from(this.chains.entries());
      await Promise.all(snapshot.map(([, p]) => p.catch(() => undefined)));
      // remove chains whose promise reference matches the snapshot (idle ones)
      for (const [appId, promise] of snapshot) {
        if (this.chains.get(appId) === promise) {
          this.chains.delete(appId);
        }
      }
    }
  }

  private async process(appId: string, payload: T): Promise<void> {
    if (!this.handler) return;
    let attempt = 0;
    while (attempt < this.maxAttempts) {
      attempt += 1;
      try {
        await this.handler(appId, payload);
        return;
      } catch (err) {
        if (err instanceof RetryableQueueError && attempt < this.maxAttempts) {
          await this.delay(this.baseBackoffMs * attempt);
          continue;
        }
        this.logger.error('feishu message queue handler failed', {
          appId,
          attempt,
          retryable: err instanceof RetryableQueueError,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
    }
  }
}
