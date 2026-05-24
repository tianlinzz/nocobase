/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANSWER_ELEMENT_ID } from '../feishu-card-templates';
import { FlushController, StreamingCardController } from '../streaming-card-controller';

const makeFakeCardKit = () => ({
  createCardEntity: vi.fn().mockResolvedValue({ cardId: 'card_xyz' }),
  sendCardByCardId: vi.fn().mockResolvedValue({ messageId: 'om_msg' }),
  streamCardContent: vi.fn().mockResolvedValue(undefined),
  setCardStreamingMode: vi.fn().mockResolvedValue(undefined),
  updateCardKitCard: vi.fn().mockResolvedValue(undefined),
});

const makeLog = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('FlushController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces rapid enqueue calls into one flush after 200ms', async () => {
    const onFlush = vi.fn().mockResolvedValue(undefined);
    const flusher = new FlushController(200, 4096, onFlush);
    flusher.enqueue('a', 'a');
    flusher.enqueue('b', 'ab');
    flusher.enqueue('c', 'abc');
    expect(onFlush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenLastCalledWith('abc');
  });

  it('flushes immediately when buffer crosses the byte threshold', async () => {
    const onFlush = vi.fn().mockResolvedValue(undefined);
    const flusher = new FlushController(200, 8, onFlush);
    flusher.enqueue('xxxxxxxxx', 'xxxxxxxxx'); // 9 bytes >= 8
    await Promise.resolve();
    await Promise.resolve();
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenLastCalledWith('xxxxxxxxx');
  });

  it('drain awaits any pending flush', async () => {
    const onFlush = vi.fn().mockResolvedValue(undefined);
    const flusher = new FlushController(200, 4096, onFlush);
    flusher.enqueue('hi', 'hi');
    await flusher.drain();
    expect(onFlush).toHaveBeenCalledWith('hi');
  });

  it('queues a follow-up flush if a new chunk arrives while flushing', async () => {
    let resolveFlush: () => void = () => undefined;
    const onFlush = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveFlush = resolve;
        }),
    );
    const flusher = new FlushController(200, 4096, onFlush);
    flusher.enqueue('a', 'a');
    await vi.advanceTimersByTimeAsync(200);
    expect(onFlush).toHaveBeenCalledTimes(1);
    flusher.enqueue('b', 'ab');
    resolveFlush();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush).toHaveBeenLastCalledWith('ab');
  });
});

describe('StreamingCardController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function makeController(overrides: Partial<{ cardkit: ReturnType<typeof makeFakeCardKit> }> = {}) {
    const cardkit = overrides.cardkit ?? makeFakeCardKit();
    const log = makeLog();
    const controller = new StreamingCardController({
      cardkit: cardkit as never,
      receiveId: 'ou_user',
      receiveIdType: 'open_id',
      log,
    });
    return { controller, cardkit, log };
  }

  it('start: creates entity and sends card; phase becomes thinking; needsFallback() = false', async () => {
    const { controller, cardkit } = makeController();
    const result = await controller.start();
    expect(result.ok).toBe(true);
    expect(controller.needsFallback()).toBe(false);
    expect(cardkit.createCardEntity).toHaveBeenCalledTimes(1);
    expect(cardkit.sendCardByCardId).toHaveBeenCalledWith({
      receiveId: 'ou_user',
      receiveIdType: 'open_id',
      cardId: 'card_xyz',
    });
  });

  it('start: when createCardEntity fails, ok=false and needsFallback()=true', async () => {
    const cardkit = makeFakeCardKit();
    cardkit.createCardEntity.mockRejectedValue(new Error('cardkit boom'));
    const { controller, log } = makeController({ cardkit });
    const result = await controller.start();
    expect(result.ok).toBe(false);
    expect(controller.needsFallback()).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringMatching(/cardkit.*fall.*back/i),
      expect.objectContaining({ error: expect.stringMatching(/cardkit boom/) }),
    );
  });

  it('onSSEFrame: type=content schedules a streamCardContent call after the throttle interval', async () => {
    const { controller, cardkit } = makeController();
    await controller.start();
    controller.onSSEFrame({ type: 'content', body: 'hello' });
    controller.onSSEFrame({ type: 'content', body: ' world' });
    expect(cardkit.streamCardContent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(cardkit.streamCardContent).toHaveBeenCalledTimes(1);
    expect(cardkit.streamCardContent).toHaveBeenLastCalledWith({
      cardId: 'card_xyz',
      elementId: ANSWER_ELEMENT_ID,
      content: 'hello world',
      sequence: 1,
    });
  });

  it('onSSEFrame: ignores non-content frames (reasoning, tool_call_chunks, stream_start, stream_end)', async () => {
    const { controller, cardkit } = makeController();
    await controller.start();
    controller.onSSEFrame({ type: 'stream_start' });
    controller.onSSEFrame({ type: 'reasoning', body: { content: 'thinking...' } });
    controller.onSSEFrame({ type: 'tool_call_chunks', body: [{ name: 'foo' }] });
    controller.onSSEFrame({ type: 'stream_end' });
    await vi.advanceTimersByTimeAsync(500);
    expect(cardkit.streamCardContent).not.toHaveBeenCalled();
  });

  it('complete: drains pending buffer, closes streaming mode, then updates card to terminal', async () => {
    const { controller, cardkit } = makeController();
    await controller.start();
    controller.onSSEFrame({ type: 'content', body: 'final answer' });
    await controller.complete();
    expect(cardkit.streamCardContent).toHaveBeenCalledWith(expect.objectContaining({ content: 'final answer' }));
    expect(cardkit.setCardStreamingMode).toHaveBeenCalledWith(
      expect.objectContaining({ cardId: 'card_xyz', streamingMode: false }),
    );
    expect(cardkit.updateCardKitCard).toHaveBeenCalledWith(expect.objectContaining({ cardId: 'card_xyz' }));
    const seqs = [
      ...cardkit.streamCardContent.mock.calls.map((c) => c[0].sequence as number),
      ...cardkit.setCardStreamingMode.mock.calls.map((c) => c[0].sequence as number),
      ...cardkit.updateCardKitCard.mock.calls.map((c) => c[0].sequence as number),
    ];
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('error: closes streaming with red-template card carrying the error message', async () => {
    const { controller, cardkit } = makeController();
    await controller.start();
    controller.onSSEFrame({ type: 'content', body: 'partial' });
    await controller.error('LLM down');
    expect(cardkit.setCardStreamingMode).toHaveBeenCalled();
    const updateCall = cardkit.updateCardKitCard.mock.calls[0][0];
    expect(updateCall.cardJson).toMatchObject({ header: { template: 'red' } });
  });

  it('streamCardContent failure does not throw - buffer survives for next flush', async () => {
    const cardkit = makeFakeCardKit();
    let calls = 0;
    cardkit.streamCardContent.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error('flush fail');
    });
    const { controller, log } = makeController({ cardkit });
    await controller.start();
    controller.onSSEFrame({ type: 'content', body: 'a' });
    await vi.advanceTimersByTimeAsync(200);
    controller.onSSEFrame({ type: 'content', body: 'b' });
    await vi.advanceTimersByTimeAsync(200);
    expect(cardkit.streamCardContent).toHaveBeenCalledTimes(2);
    expect(cardkit.streamCardContent).toHaveBeenLastCalledWith(expect.objectContaining({ content: 'ab' }));
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/streamCardContent.*fail/i), expect.anything());
  });
});
