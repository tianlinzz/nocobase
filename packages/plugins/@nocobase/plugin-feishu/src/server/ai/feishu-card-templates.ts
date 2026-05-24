/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

/**
 * Element id of the markdown element that streams the AI text. Both the
 * controller (`streamCardContent` calls) and the templates must agree on
 * this constant — keep it in one place.
 */
export const ANSWER_ELEMENT_ID = 'answer';

const HEADER_TITLE = 'AI 助手';

/**
 * Initial card sent the moment a Feishu message is routed to AI. The
 * `streaming_mode` flag tells CardKit to expect partial element updates;
 * the body contains a single placeholder markdown element with the
 * canonical answer id so subsequent `streamCardContent` calls can target it.
 */
export function buildThinkingCard(): Record<string, unknown> {
  return {
    schema: '2.0',
    config: { streaming_mode: true },
    header: {
      title: { tag: 'plain_text', content: HEADER_TITLE },
      template: 'blue',
    },
    body: {
      elements: [{ tag: 'markdown', element_id: ANSWER_ELEMENT_ID, content: '_思考中..._' }],
    },
  };
}

/**
 * Used only as a fallback path for `updateCardKitCard` when a full replace
 * is needed (e.g. the streaming endpoint failed and we want to overwrite
 * the whole card). Normal happy path streams via `cardElement.content`.
 */
export function buildStreamingCard(text: string): Record<string, unknown> {
  return {
    schema: '2.0',
    config: { streaming_mode: true },
    header: {
      title: { tag: 'plain_text', content: HEADER_TITLE },
      template: 'blue',
    },
    body: {
      elements: [{ tag: 'markdown', element_id: ANSWER_ELEMENT_ID, content: text }],
    },
  };
}

export interface BuildCompleteCardOptions {
  /** Round-trip time from card creation to completion, in ms. */
  elapsedMs?: number;
  /** When set, the card switches to the red error template. */
  errorMessage?: string;
}

/**
 * Terminal card after streaming is closed. Green template on success, red
 * on error; the elapsed time is appended as a small italic footer line
 * inside the answer markdown — schema 2.0 dropped the `note` tag (CardKit
 * rejects it with "cards of schema V2 no longer support this capability"),
 * so we cannot use the dedicated footer element openclaw-lark uses on
 * schema 1.x. Inlining as `_用时 X.Xs_` keeps the info with no extra tags.
 */
export function buildCompleteCard(text: string, opts: BuildCompleteCardOptions = {}): Record<string, unknown> {
  const isError = !!opts.errorMessage;
  const body = isError ? `**出错了**：${opts.errorMessage}\n\n${text}`.trim() : text;
  const elapsedSuffix = opts.elapsedMs !== undefined ? `\n\n_用时 ${(opts.elapsedMs / 1000).toFixed(1)}s_` : '';
  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: HEADER_TITLE },
      template: isError ? 'red' : 'green',
    },
    body: {
      elements: [{ tag: 'markdown', element_id: ANSWER_ELEMENT_ID, content: `${body}${elapsedSuffix}` }],
    },
  };
}
