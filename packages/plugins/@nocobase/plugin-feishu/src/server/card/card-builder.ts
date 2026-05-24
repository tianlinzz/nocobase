/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

export interface FeishuCardSchema {
  config?: { wide_screen_mode?: boolean };
  header?: { title: { tag: 'plain_text'; content: string }; template?: string };
  elements: unknown[];
}

export interface CardActionElement {
  tag: 'button';
  text: { tag: 'plain_text'; content: string };
  type?: 'default' | 'primary' | 'danger';
  value: Record<string, unknown>;
}

export interface CardTemplate {
  schema: FeishuCardSchema;
  bindings?: string[];
}

const PLACEHOLDER_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

function substituteString(input: string, vars: Record<string, unknown>): string {
  return input.replace(PLACEHOLDER_RE, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      const value = vars[key];
      if (value === null || value === undefined) return match;
      return String(value);
    }
    return match;
  });
}

function substituteDeep(value: unknown, vars: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    return substituteString(value, vars);
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteDeep(item, vars));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substituteDeep(v, vars);
    }
    return out;
  }
  return value;
}

export class FeishuCardBuilder {
  static textCard(title: string, content: string): FeishuCardSchema {
    return {
      config: { wide_screen_mode: true },
      header: { title: { tag: 'plain_text', content: title } },
      elements: [{ tag: 'div', text: { tag: 'lark_md', content } }],
    };
  }

  static actionCard(title: string, content: string, actions: CardActionElement[]): FeishuCardSchema {
    const base = this.textCard(title, content);
    base.elements = [...base.elements, { tag: 'action', actions }];
    return base;
  }

  static fromTemplate(template: CardTemplate, vars: Record<string, unknown>): FeishuCardSchema {
    const cloned = JSON.parse(JSON.stringify(template.schema)) as FeishuCardSchema;
    return substituteDeep(cloned, vars) as FeishuCardSchema;
  }
}
