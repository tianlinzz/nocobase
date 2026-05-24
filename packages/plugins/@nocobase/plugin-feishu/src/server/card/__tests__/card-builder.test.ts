/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, it, expect } from 'vitest';
import { FeishuCardBuilder, CardActionElement, CardTemplate } from '../card-builder';

describe('FeishuCardBuilder.textCard', () => {
  it('produces a wide-screen text card with plain title and lark_md body', () => {
    const schema = FeishuCardBuilder.textCard('hello', 'body');
    expect(schema).toEqual({
      config: { wide_screen_mode: true },
      header: { title: { tag: 'plain_text', content: 'hello' } },
      elements: [{ tag: 'div', text: { tag: 'lark_md', content: 'body' } }],
    });
  });
});

describe('FeishuCardBuilder.actionCard', () => {
  it('appends an action element after the body', () => {
    const actions: CardActionElement[] = [
      {
        tag: 'button',
        text: { tag: 'plain_text', content: 'Approve' },
        type: 'primary',
        value: { action_key: 'approve' },
      },
    ];
    const schema = FeishuCardBuilder.actionCard('Title', 'Body', actions);
    expect(schema.elements).toHaveLength(2);
    expect(schema.elements[0]).toEqual({ tag: 'div', text: { tag: 'lark_md', content: 'Body' } });
    expect(schema.elements[1]).toEqual({ tag: 'action', actions });
  });
});

describe('FeishuCardBuilder.fromTemplate', () => {
  const template: CardTemplate = {
    schema: {
      config: { wide_screen_mode: true },
      header: { title: { tag: 'plain_text', content: 'Hello {{name}}' } },
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content: 'Welcome {{name}}, your role is {{role}}' } },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: 'Confirm' },
              value: { action_key: 'confirm', userId: '{{userId}}' },
            },
          ],
        },
      ],
    },
  };

  it('substitutes {{var}} in nested string fields', () => {
    const result = FeishuCardBuilder.fromTemplate(template, { name: 'Alice', role: 'admin', userId: 42 });
    expect(result.header?.title.content).toBe('Hello Alice');
    const div = result.elements[0] as { tag: string; text: { content: string } };
    expect(div.text.content).toBe('Welcome Alice, your role is admin');
    const action = result.elements[1] as { actions: Array<{ value: Record<string, unknown> }> };
    expect(action.actions[0].value.userId).toBe('42');
  });

  it('leaves placeholder when var is missing', () => {
    const result = FeishuCardBuilder.fromTemplate(template, { name: 'Bob' });
    const div = result.elements[0] as { tag: string; text: { content: string } };
    expect(div.text.content).toBe('Welcome Bob, your role is {{role}}');
  });

  it('does not mutate the input template', () => {
    const before = JSON.stringify(template);
    FeishuCardBuilder.fromTemplate(template, { name: 'X', role: 'Y', userId: 1 });
    expect(JSON.stringify(template)).toBe(before);
  });
});
