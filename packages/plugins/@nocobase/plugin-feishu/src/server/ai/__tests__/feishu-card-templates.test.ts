/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it } from 'vitest';
import { ANSWER_ELEMENT_ID, buildCompleteCard, buildStreamingCard, buildThinkingCard } from '../feishu-card-templates';

describe('feishu-card-templates', () => {
  it('buildThinkingCard enables streaming_mode and uses blue header', () => {
    const card = buildThinkingCard();
    expect(card).toMatchObject({
      schema: '2.0',
      config: { streaming_mode: true },
      header: { template: 'blue', title: { tag: 'plain_text', content: 'AI 助手' } },
      body: {
        elements: [{ tag: 'markdown', element_id: ANSWER_ELEMENT_ID, content: '_思考中..._' }],
      },
    });
  });

  it('buildStreamingCard puts the running text into the answer element', () => {
    const card = buildStreamingCard('partial response');
    const elements = (card.body as { elements: Array<Record<string, unknown>> }).elements;
    expect(elements[0]).toEqual({ tag: 'markdown', element_id: ANSWER_ELEMENT_ID, content: 'partial response' });
  });

  it('buildCompleteCard uses green header + a notation-sized markdown footer with status and elapsed time', () => {
    const card = buildCompleteCard('final answer', { elapsedMs: 2345 });
    expect(card.header).toMatchObject({ template: 'green' });
    const elements = (card.body as { elements: Array<Record<string, unknown>> }).elements;
    expect(elements).toHaveLength(2);
    expect(elements[0]).toEqual({ tag: 'markdown', element_id: ANSWER_ELEMENT_ID, content: 'final answer' });
    expect(elements[1]).toEqual({
      tag: 'markdown',
      content: '已完成 · 耗时 2.3s',
      text_size: 'notation',
    });
  });

  it('buildCompleteCard with errorMessage uses red header, embeds error in answer body, and red status segment in footer', () => {
    const card = buildCompleteCard('', { errorMessage: 'LLM down' });
    expect(card.header).toMatchObject({ template: 'red' });
    const elements = (card.body as { elements: Array<Record<string, unknown>> }).elements;
    expect(elements[0].content as string).toMatch(/LLM down/);
    expect(elements[1]).toMatchObject({
      tag: 'markdown',
      text_size: 'notation',
      content: expect.stringMatching(/出错/),
    });
    expect((elements[1] as { content: string }).content).toMatch(/<font color='red'>/);
  });

  it('buildCompleteCard without elapsedMs / errorMessage produces footer with just status', () => {
    const card = buildCompleteCard('done');
    const elements = (card.body as { elements: Array<Record<string, unknown>> }).elements;
    expect(elements).toHaveLength(2);
    expect(elements[0]).toEqual({ tag: 'markdown', element_id: ANSWER_ELEMENT_ID, content: 'done' });
    expect(elements[1]).toEqual({ tag: 'markdown', content: '已完成', text_size: 'notation' });
  });

  it('buildCompleteCard formats elapsed >60s as `Xm Ys` matching openclaw-lark formatElapsed', () => {
    const card = buildCompleteCard('done', { elapsedMs: 75_500 });
    const elements = (card.body as { elements: Array<Record<string, unknown>> }).elements;
    expect((elements[1] as { content: string }).content).toContain('耗时 1m 16s');
  });
});
