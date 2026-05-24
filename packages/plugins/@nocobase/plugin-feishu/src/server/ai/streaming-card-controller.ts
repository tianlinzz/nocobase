/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import type { FeishuCardKitClient } from '../transport/feishu-cardkit-client';
import { ANSWER_ELEMENT_ID, buildCompleteCard, buildThinkingCard } from './feishu-card-templates';
import type { SSEFrame } from './sse-frame-parser';

export interface StreamingCardLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface StreamingCardControllerDeps {
  cardkit: FeishuCardKitClient;
  receiveId: string;
  receiveIdType: 'open_id' | 'chat_id';
  log: StreamingCardLogger;
}

type Phase = 'creating' | 'thinking' | 'streaming' | 'complete' | 'error';

/**
 * Placeholder text for the terminal card when no streaming content was
 * accumulated. Mirrors `EMPTY_REPLY_FALLBACK_TEXT` in
 * larksuite/openclaw-lark — keeps the card non-empty so the user gets a
 * visible end state even when the LLM produced only tool_use chunks or
 * the SSE pipe delivered nothing parseable.
 */
const EMPTY_REPLY_FALLBACK_TEXT = '_AI 没有输出内容_';

/**
 * Time-and-byte-bounded throttle on top of a single async sink. Coalesces
 * rapid enqueue() calls into a single flush that carries the latest
 * accumulated text -- CardKit treats the element content as a full replace,
 * so we can always send the most recent buffer.
 *
 * If a flush is in progress when a new chunk arrives, we mark
 * `pendingFlushAfter` so we issue exactly one more flush when the current
 * one resolves. That keeps requests serialized while still delivering the
 * most recent text after any in-flight call.
 */
export class FlushController {
  private buffer = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private pendingFlushAfter = false;

  constructor(
    private readonly intervalMs: number,
    private readonly maxBufferBytes: number,
    private readonly onFlush: (text: string) => Promise<void>,
  ) {}

  enqueue(_chunk: string, accumulated: string): void {
    this.buffer = accumulated;
    if (Buffer.byteLength(this.buffer, 'utf8') >= this.maxBufferBytes) {
      this.scheduleFlush();
      return;
    }
    if (this.flushing) {
      this.pendingFlushAfter = true;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => this.scheduleFlush(), this.intervalMs);
    }
  }

  /**
   * Wraps `flushNow()` so background-scheduled flushes (byte-threshold path
   * and the timer callback) honour AGENTS.md's "no `void someAsyncCall()`"
   * rule. The `onFlush` closure passed by `StreamingCardController` already
   * catches its own errors; this guard is a safety net against future
   * callers that might not.
   */
  private scheduleFlush(): void {
    this.flushNow().catch(() => {
      // FlushController must never crash the process; intentionally swallow.
    });
  }

  async flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.flushing) {
      this.pendingFlushAfter = true;
      return;
    }
    if (!this.buffer) return;
    const text = this.buffer;
    this.flushing = true;
    try {
      await this.onFlush(text);
    } finally {
      this.flushing = false;
      if (this.pendingFlushAfter) {
        this.pendingFlushAfter = false;
        await this.flushNow();
      }
    }
  }

  async drain(): Promise<void> {
    await this.flushNow();
  }
}

/**
 * Lifecycle for one Feishu chat round:
 *   creating -> thinking -> streaming -> complete | error
 *
 * `creating` failures stay in `creating` and surface via `needsFallback()`,
 * letting the bridge fall back to plain-text reply (response-renderer)
 * without losing the user's message. Failures *during* streaming are
 * absorbed: the FlushController preserves the buffer so the next flush
 * naturally carries the latest text (CardKit replaces full content).
 */
export class StreamingCardController {
  private cardId?: string;
  private phase: Phase = 'creating';
  private accumulatedText = '';
  private sequence = 0;
  private readonly startTime = Date.now();
  private readonly flusher: FlushController;
  /** Tally of non-content SSE frame types seen, for "empty card" diagnosis. */
  private readonly nonContentFrameTypes: Record<string, number> = {};
  /** Sample of unexpected non-string body typeof values, capped to first 5. */
  private readonly nonStringContentBodySamples: string[] = [];

  constructor(private readonly deps: StreamingCardControllerDeps) {
    this.flusher = new FlushController(200, 4096, async (text) => {
      if (!this.cardId) return;
      try {
        await this.deps.cardkit.streamCardContent({
          cardId: this.cardId,
          elementId: ANSWER_ELEMENT_ID,
          content: text,
          sequence: ++this.sequence,
        });
      } catch (err) {
        this.deps.log.warn('feishu cardkit streamCardContent failed; will retry on next flush', {
          error: err instanceof Error ? err.message : String(err),
          cardId: this.cardId,
        });
      }
    });
  }

  /** Create the card entity and send the thinking card to the chat. */
  async start(): Promise<{ ok: boolean }> {
    try {
      const { cardId } = await this.deps.cardkit.createCardEntity(buildThinkingCard());
      this.cardId = cardId;
      await this.deps.cardkit.sendCardByCardId({
        receiveId: this.deps.receiveId,
        receiveIdType: this.deps.receiveIdType,
        cardId,
      });
      this.phase = 'thinking';
      return { ok: true };
    } catch (err) {
      this.deps.log.warn('feishu cardkit create/send failed, falling back to text reply', {
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false };
    }
  }

  /** Bridge feeds parsed SSE frames here as they arrive. */
  onSSEFrame(frame: SSEFrame): void {
    if (frame.type !== 'content') {
      // count non-content frame types so a "card finalized empty" report
      // can be diagnosed by reading the trailing breakdown in complete().
      this.nonContentFrameTypes[frame.type] = (this.nonContentFrameTypes[frame.type] ?? 0) + 1;
      return;
    }
    if (typeof frame.body !== 'string') {
      // Capturing a sample of unexpected body types helps when a provider
      // (e.g. anthropic with thinking blocks) emits non-string content
      // through plugin-ai's parseResponseChunk.
      this.nonStringContentBodySamples.push(typeof frame.body);
      return;
    }
    if (this.phase === 'thinking') this.phase = 'streaming';
    this.accumulatedText += frame.body;
    this.flusher.enqueue(frame.body, this.accumulatedText);
  }

  /** Drain pending buffer, close streaming mode, post the terminal card. */
  async complete(): Promise<void> {
    await this.flusher.drain();
    if (!this.cardId) return;
    const elapsedMs = Date.now() - this.startTime;
    // Mirrors larksuite/openclaw-lark's onIdle: if no visible text accumulated
    // (provider only emitted tool_use chunks, or `parseResponseChunk`
    // returned non-string bodies our SSE parser filtered out, or the LLM
    // genuinely produced empty output), surface a fallback so the terminal
    // card is not blank.
    const text = this.accumulatedText || EMPTY_REPLY_FALLBACK_TEXT;
    if (!this.accumulatedText) {
      this.deps.log.warn('feishu cardkit complete: no streamed text accumulated, using fallback', {
        cardId: this.cardId,
        elapsedMs,
        nonContentFrameTypes: this.nonContentFrameTypes,
        nonStringContentBodySamples: this.nonStringContentBodySamples.slice(0, 5),
      });
    } else {
      this.deps.log.info('feishu cardkit complete: finalizing card', {
        cardId: this.cardId,
        textLength: this.accumulatedText.length,
        elapsedMs,
        nonContentFrameTypes: this.nonContentFrameTypes,
      });
    }
    try {
      await this.deps.cardkit.setCardStreamingMode({
        cardId: this.cardId,
        streamingMode: false,
        sequence: ++this.sequence,
      });
      await this.deps.cardkit.updateCardKitCard({
        cardId: this.cardId,
        cardJson: buildCompleteCard(text, { elapsedMs }),
        sequence: ++this.sequence,
      });
      this.phase = 'complete';
      this.deps.log.info('feishu cardkit complete: card finalized', { cardId: this.cardId });
    } catch (err) {
      this.deps.log.warn('feishu cardkit complete finalize failed', {
        error: err instanceof Error ? err.message : String(err),
        cardId: this.cardId,
        textLength: text.length,
        textPreview: text.slice(0, 200),
      });
    }
  }

  /** Drain, close streaming mode, post a red error card. */
  async error(message: string): Promise<void> {
    try {
      await this.flusher.drain();
    } catch (drainErr) {
      this.deps.log.warn('feishu cardkit error-path drain failed', {
        error: drainErr instanceof Error ? drainErr.message : String(drainErr),
      });
    }
    if (!this.cardId) return;
    // Same empty-text fallback as complete(): the user still gets to see
    // the error message even if no streaming text arrived.
    const text = this.accumulatedText || EMPTY_REPLY_FALLBACK_TEXT;
    try {
      await this.deps.cardkit.setCardStreamingMode({
        cardId: this.cardId,
        streamingMode: false,
        sequence: ++this.sequence,
      });
      await this.deps.cardkit.updateCardKitCard({
        cardId: this.cardId,
        cardJson: buildCompleteCard(text, { errorMessage: message }),
        sequence: ++this.sequence,
      });
      this.phase = 'error';
    } catch (err) {
      this.deps.log.warn('feishu cardkit error finalize failed', {
        error: err instanceof Error ? err.message : String(err),
        cardId: this.cardId,
      });
    }
  }

  /**
   * Bridge inspects this after `start()` returns ok=false to decide
   * whether to switch to the plain-text fallback path.
   */
  needsFallback(): boolean {
    return this.phase === 'creating';
  }
}
