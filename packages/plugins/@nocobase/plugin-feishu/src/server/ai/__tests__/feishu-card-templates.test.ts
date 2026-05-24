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

  it('buildCompleteCard uses green header and inlines elapsed time as italic markdown footer (no `note` tag — schema V2 dropped it)', () => {
    const card = buildCompleteCard('final answer', { elapsedMs: 2345 });
    expect(card.header).toMatchObject({ template: 'green' });
    const elements = (card.body as { elements: Array<Record<string, unknown>> }).elements;
    expect(elements).toHaveLength(1);
    expect(elements[0]).toEqual({
      tag: 'markdown',
      element_id: ANSWER_ELEMENT_ID,
      content: 'final answer\n\n_用时 2.3s_',
    });
  });

  it('buildCompleteCard with errorMessage uses red header and shows the error', () => {
    const card = buildCompleteCard('', { errorMessage: 'LLM down' });
    expect(card.header).toMatchObject({ template: 'red' });
    const elements = (card.body as { elements: Array<Record<string, unknown>> }).elements;
    expect(elements[0].content as string).toMatch(/LLM down/);
  });

  it('buildCompleteCard without elapsedMs / errorMessage stays a single markdown element with no footer suffix', () => {
    const card = buildCompleteCard('done');
    const elements = (card.body as { elements: Array<Record<string, unknown>> }).elements;
    expect(elements).toHaveLength(1);
    expect(elements[0]).toEqual({ tag: 'markdown', element_id: ANSWER_ELEMENT_ID, content: 'done' });
  });
});
