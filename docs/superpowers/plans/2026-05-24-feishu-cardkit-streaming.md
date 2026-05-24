# 飞书 AI 桥接 · CardKit 流式卡片集成 · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `plugin-feishu` 的 AI 桥接从 `aiEmployee.invoke()` + 静默 text 回复，切换为 `aiEmployee.stream()` + 飞书 CardKit 流式卡片，让用户立刻看到 "AI 思考中..." 卡片并实时观察 markdown token 流入。

**Architecture:** 新增 4 个独立模块（CardKit SDK 包装、卡片模板、SSE 帧解析、StreamingCardController 状态机），改造 1 个 ctx 工厂、1 个客户端管理器、1 个 AI 桥接。任意环节失败均降级到现有 `response-renderer` text 路径以保证消息不丢。

**Tech Stack:** TypeScript / `@larksuiteoapi/node-sdk` / vitest / `@nocobase/plugin-ai` AIEmployee.stream

**Spec:** `docs/superpowers/specs/2026-05-24-feishu-cardkit-streaming-design.md`

**Commit grouping (per spec §12):**
- Tasks 1–2 → commit A: `feat(plugin-feishu): add CardKit SDK wrapper + card templates`
- Tasks 3–4 → commit B: `feat(plugin-feishu): add streaming card controller with flush throttling`
- Tasks 5–7 → commit C: `feat(plugin-feishu): switch AI bridge to CardKit streaming with text fallback`

---

## Task 1: CardKit SDK Wrapper

**Goal:** 把 lark SDK 的 `cardkit.card.*` / `cardkit.cardElement.*` 4 个调用 + `im.message.create(msg_type:'interactive')` 1 个调用，封装成 5 个静态方法的 `FeishuCardKitClient`，无业务逻辑，便于上层 mock 测试。

**Files:**
- Create: `packages/plugins/@nocobase/plugin-feishu/src/server/transport/feishu-cardkit-client.ts`
- Create: `packages/plugins/@nocobase/plugin-feishu/src/server/transport/__tests__/feishu-cardkit-client.test.ts`

### Steps

- [ ] **Step 1: Write failing tests** for the 5 wrapper methods.

```ts
// packages/plugins/@nocobase/plugin-feishu/src/server/transport/__tests__/feishu-cardkit-client.test.ts

/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it, vi } from 'vitest';
import { FeishuCardKitClient } from '../feishu-cardkit-client';

function makeFakeLarkClient() {
  const cardkitCardCreate = vi.fn().mockResolvedValue({ code: 0, data: { card_id: 'card_xyz' } });
  const cardkitCardSettings = vi.fn().mockResolvedValue({ code: 0, data: {} });
  const cardkitCardUpdate = vi.fn().mockResolvedValue({ code: 0, data: {} });
  const cardkitElementContent = vi.fn().mockResolvedValue({ code: 0, data: {} });
  const imMessageCreate = vi.fn().mockResolvedValue({ code: 0, data: { message_id: 'om_msg' } });
  const client = {
    cardkit: {
      card: { create: cardkitCardCreate, settings: cardkitCardSettings, update: cardkitCardUpdate },
      cardElement: { content: cardkitElementContent },
    },
    im: { message: { create: imMessageCreate } },
  };
  return { client, cardkitCardCreate, cardkitCardSettings, cardkitCardUpdate, cardkitElementContent, imMessageCreate };
}

describe('FeishuCardKitClient', () => {
  it('createCardEntity stringifies card JSON and returns card_id', async () => {
    const { client, cardkitCardCreate } = makeFakeLarkClient();
    const cardkit = new FeishuCardKitClient(client as never);
    const result = await cardkit.createCardEntity({ schema: '2.0', body: { elements: [] } });
    expect(cardkitCardCreate).toHaveBeenCalledWith({
      data: { type: 'card_json', data: JSON.stringify({ schema: '2.0', body: { elements: [] } }) },
    });
    expect(result).toEqual({ cardId: 'card_xyz' });
  });

  it('createCardEntity throws FeishuApiError on non-zero code', async () => {
    const { client, cardkitCardCreate } = makeFakeLarkClient();
    cardkitCardCreate.mockResolvedValue({ code: 23001, msg: 'invalid card' });
    const cardkit = new FeishuCardKitClient(client as never);
    await expect(cardkit.createCardEntity({})).rejects.toThrow(/cardkit\.create.*invalid card/i);
  });

  it('sendCardByCardId sends im.message.create with msg_type interactive', async () => {
    const { client, imMessageCreate } = makeFakeLarkClient();
    const cardkit = new FeishuCardKitClient(client as never);
    const result = await cardkit.sendCardByCardId({
      receiveId: 'ou_user',
      receiveIdType: 'open_id',
      cardId: 'card_xyz',
    });
    expect(imMessageCreate).toHaveBeenCalledWith({
      params: { receive_id_type: 'open_id' },
      data: {
        receive_id: 'ou_user',
        msg_type: 'interactive',
        content: JSON.stringify({ type: 'card', data: { card_id: 'card_xyz' } }),
      },
    });
    expect(result).toEqual({ messageId: 'om_msg' });
  });

  it('streamCardContent passes content + sequence to cardElement.content', async () => {
    const { client, cardkitElementContent } = makeFakeLarkClient();
    const cardkit = new FeishuCardKitClient(client as never);
    await cardkit.streamCardContent({ cardId: 'card_xyz', elementId: 'answer', content: 'hello', sequence: 5 });
    expect(cardkitElementContent).toHaveBeenCalledWith({
      data: { content: 'hello', sequence: 5 },
      path: { card_id: 'card_xyz', element_id: 'answer' },
    });
  });

  it('setCardStreamingMode stringifies settings with streaming_mode flag', async () => {
    const { client, cardkitCardSettings } = makeFakeLarkClient();
    const cardkit = new FeishuCardKitClient(client as never);
    await cardkit.setCardStreamingMode({ cardId: 'card_xyz', streamingMode: false, sequence: 7 });
    expect(cardkitCardSettings).toHaveBeenCalledWith({
      data: { settings: JSON.stringify({ config: { streaming_mode: false } }), sequence: 7 },
      path: { card_id: 'card_xyz' },
    });
  });

  it('updateCardKitCard wraps card in {type:card_json,data:string}', async () => {
    const { client, cardkitCardUpdate } = makeFakeLarkClient();
    const cardkit = new FeishuCardKitClient(client as never);
    const card = { schema: '2.0', body: { elements: [{ tag: 'markdown', content: 'final' }] } };
    await cardkit.updateCardKitCard({ cardId: 'card_xyz', cardJson: card, sequence: 9 });
    expect(cardkitCardUpdate).toHaveBeenCalledWith({
      data: { card: { type: 'card_json', data: JSON.stringify(card) }, sequence: 9 },
      path: { card_id: 'card_xyz' },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test packages/plugins/@nocobase/plugin-feishu/src/server/transport/__tests__/feishu-cardkit-client.test.ts --run
```

Expected: FAIL — "Cannot find module '../feishu-cardkit-client'".

- [ ] **Step 3: Implement `FeishuCardKitClient`**

```ts
// packages/plugins/@nocobase/plugin-feishu/src/server/transport/feishu-cardkit-client.ts

/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import type * as Lark from '@larksuiteoapi/node-sdk';
import { extractRequestId, FeishuApiError } from './types';

export interface CreateCardEntityResult {
  cardId: string;
}

export interface SendCardByCardIdParams {
  receiveId: string;
  receiveIdType: 'open_id' | 'chat_id' | 'user_id' | 'union_id' | 'email';
  cardId: string;
}

export interface SendCardByCardIdResult {
  messageId: string;
}

export interface StreamCardContentParams {
  cardId: string;
  elementId: string;
  /** Full accumulated text — CardKit replaces the element content. */
  content: string;
  /** Monotonically increasing per card; CardKit uses this to order updates. */
  sequence: number;
}

export interface SetCardStreamingModeParams {
  cardId: string;
  streamingMode: boolean;
  sequence: number;
}

export interface UpdateCardKitCardParams {
  cardId: string;
  cardJson: Record<string, unknown>;
  sequence: number;
}

/**
 * Thin wrapper over the lark SDK's CardKit + interactive-message endpoints.
 *
 * Each method maps 1:1 to a single SDK call, stringifies any nested JSON the
 * SDK expects as a string field, and surfaces non-zero `code` as
 * {@link FeishuApiError} so callers can react uniformly with the rest of the
 * client manager surface.
 *
 * Has no business logic, no retry, no state — that lives in
 * `streaming-card-controller.ts`.
 */
export class FeishuCardKitClient {
  constructor(private readonly client: Lark.Client) {}

  async createCardEntity(cardJson: Record<string, unknown>): Promise<CreateCardEntityResult> {
    const resp = await this.client.cardkit.card.create({
      data: { type: 'card_json', data: JSON.stringify(cardJson) },
    });
    if (resp.code !== 0) {
      throw new FeishuApiError(
        `feishu cardkit.create failed: ${resp.msg ?? 'unknown'}`,
        resp.code ?? -1,
        extractRequestId(resp),
      );
    }
    const cardId = resp.data?.card_id;
    if (!cardId) {
      throw new FeishuApiError('feishu cardkit.create returned no card_id', -1, extractRequestId(resp));
    }
    return { cardId };
  }

  async sendCardByCardId(params: SendCardByCardIdParams): Promise<SendCardByCardIdResult> {
    const resp = await this.client.im.message.create({
      params: { receive_id_type: params.receiveIdType },
      data: {
        receive_id: params.receiveId,
        msg_type: 'interactive',
        content: JSON.stringify({ type: 'card', data: { card_id: params.cardId } }),
      },
    });
    if (resp.code !== 0) {
      throw new FeishuApiError(
        `feishu cardkit.sendCardByCardId failed: ${resp.msg ?? 'unknown'}`,
        resp.code ?? -1,
        extractRequestId(resp),
      );
    }
    return { messageId: resp.data?.message_id ?? '' };
  }

  async streamCardContent(params: StreamCardContentParams): Promise<void> {
    const resp = await this.client.cardkit.cardElement.content({
      data: { content: params.content, sequence: params.sequence },
      path: { card_id: params.cardId, element_id: params.elementId },
    });
    if (resp.code !== 0) {
      throw new FeishuApiError(
        `feishu cardkit.streamCardContent failed: ${resp.msg ?? 'unknown'}`,
        resp.code ?? -1,
        extractRequestId(resp),
      );
    }
  }

  async setCardStreamingMode(params: SetCardStreamingModeParams): Promise<void> {
    const resp = await this.client.cardkit.card.settings({
      data: {
        settings: JSON.stringify({ config: { streaming_mode: params.streamingMode } }),
        sequence: params.sequence,
      },
      path: { card_id: params.cardId },
    });
    if (resp.code !== 0) {
      throw new FeishuApiError(
        `feishu cardkit.setCardStreamingMode failed: ${resp.msg ?? 'unknown'}`,
        resp.code ?? -1,
        extractRequestId(resp),
      );
    }
  }

  async updateCardKitCard(params: UpdateCardKitCardParams): Promise<void> {
    const resp = await this.client.cardkit.card.update({
      data: {
        card: { type: 'card_json', data: JSON.stringify(params.cardJson) },
        sequence: params.sequence,
      },
      path: { card_id: params.cardId },
    });
    if (resp.code !== 0) {
      throw new FeishuApiError(
        `feishu cardkit.updateCardKitCard failed: ${resp.msg ?? 'unknown'}`,
        resp.code ?? -1,
        extractRequestId(resp),
      );
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
yarn test packages/plugins/@nocobase/plugin-feishu/src/server/transport/__tests__/feishu-cardkit-client.test.ts --run
```

Expected: PASS — 6 tests passed.

- [ ] **Step 5: Lint**

```bash
yarn eslint --fix packages/plugins/@nocobase/plugin-feishu/src/server/transport/feishu-cardkit-client.ts packages/plugins/@nocobase/plugin-feishu/src/server/transport/__tests__/feishu-cardkit-client.test.ts
```

Expected: clean.

(No commit at end of Task 1 — bundled with Task 2 per spec §12.)

---

## Task 2: Card Templates

**Goal:** 提供 3 个纯函数 builder 用于 thinking / streaming / complete 三个卡片状态，返回 `Record<string, unknown>` 即可被 `FeishuCardKitClient` 序列化。

**Files:**
- Create: `packages/plugins/@nocobase/plugin-feishu/src/server/ai/feishu-card-templates.ts`
- Create: `packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/feishu-card-templates.test.ts`

### Steps

- [ ] **Step 1: Write failing tests**

```ts
// packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/feishu-card-templates.test.ts

/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it } from 'vitest';
import {
  ANSWER_ELEMENT_ID,
  buildCompleteCard,
  buildStreamingCard,
  buildThinkingCard,
} from '../feishu-card-templates';

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

  it('buildCompleteCard uses green header on success and includes elapsed note', () => {
    const card = buildCompleteCard('final answer', { elapsedMs: 2345 });
    expect(card.header).toMatchObject({ template: 'green' });
    const elements = (card.body as { elements: Array<Record<string, unknown>> }).elements;
    expect(elements[0]).toEqual({ tag: 'markdown', element_id: ANSWER_ELEMENT_ID, content: 'final answer' });
    expect(elements[1]).toMatchObject({
      tag: 'note',
      elements: [{ tag: 'plain_text', content: '用时 2.3s' }],
    });
  });

  it('buildCompleteCard with errorMessage uses red header and shows the error', () => {
    const card = buildCompleteCard('', { errorMessage: 'LLM down' });
    expect(card.header).toMatchObject({ template: 'red' });
    const elements = (card.body as { elements: Array<Record<string, unknown>> }).elements;
    expect((elements[0].content as string)).toMatch(/LLM down/);
  });

  it('buildCompleteCard without elapsedMs / errorMessage omits the note element', () => {
    const card = buildCompleteCard('done');
    const elements = (card.body as { elements: Array<Record<string, unknown>> }).elements;
    expect(elements).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/feishu-card-templates.test.ts --run
```

Expected: FAIL — "Cannot find module '../feishu-card-templates'".

- [ ] **Step 3: Implement the templates**

```ts
// packages/plugins/@nocobase/plugin-feishu/src/server/ai/feishu-card-templates.ts

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
      elements: [
        { tag: 'markdown', element_id: ANSWER_ELEMENT_ID, content: '_思考中..._' },
      ],
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
      elements: [
        { tag: 'markdown', element_id: ANSWER_ELEMENT_ID, content: text },
      ],
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
 * on error; `note` footer with elapsed time when provided.
 */
export function buildCompleteCard(text: string, opts: BuildCompleteCardOptions = {}): Record<string, unknown> {
  const isError = !!opts.errorMessage;
  const elements: Array<Record<string, unknown>> = [
    {
      tag: 'markdown',
      element_id: ANSWER_ELEMENT_ID,
      content: isError ? `**出错了**：${opts.errorMessage}\n\n${text}`.trim() : text,
    },
  ];
  if (opts.elapsedMs !== undefined) {
    const seconds = (opts.elapsedMs / 1000).toFixed(1);
    elements.push({
      tag: 'note',
      elements: [{ tag: 'plain_text', content: `用时 ${seconds}s` }],
    });
  }
  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: HEADER_TITLE },
      template: isError ? 'red' : 'green',
    },
    body: { elements },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
yarn test packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/feishu-card-templates.test.ts --run
```

Expected: PASS — 5 tests passed.

- [ ] **Step 5: Lint**

```bash
yarn eslint --fix packages/plugins/@nocobase/plugin-feishu/src/server/ai/feishu-card-templates.ts packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/feishu-card-templates.test.ts
```

Expected: clean.

- [ ] **Step 6: Commit (commit A — bundles Tasks 1+2)**

```bash
git add packages/plugins/@nocobase/plugin-feishu/src/server/transport/feishu-cardkit-client.ts \
        packages/plugins/@nocobase/plugin-feishu/src/server/transport/__tests__/feishu-cardkit-client.test.ts \
        packages/plugins/@nocobase/plugin-feishu/src/server/ai/feishu-card-templates.ts \
        packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/feishu-card-templates.test.ts
git commit -m "feat(plugin-feishu): add CardKit SDK wrapper + card templates

$(cat <<'EOF'
- FeishuCardKitClient: 5 thin wrappers over lark SDK
  (cardkit.card.{create,settings,update}, cardkit.cardElement.content,
  im.message.create with msg_type=interactive). Surfaces non-zero codes
  as FeishuApiError.
- feishu-card-templates: 3 pure builders (thinking/streaming/complete)
  with shared ANSWER_ELEMENT_ID constant. Green / red / blue templates
  for success / error / streaming states.
- Both modules ship with unit tests; no integration with bridge yet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: SSE Frame Parser

**Goal:** 把 `AIEmployee.stream()` 写入 `ctx.res.write` 的 SSE 字符串解析成 `{ type, body }` 对象数组。容忍粘包、不完整尾帧、非 JSON。纯函数，无状态。

**Files:**
- Create: `packages/plugins/@nocobase/plugin-feishu/src/server/ai/sse-frame-parser.ts`
- Create: `packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/sse-frame-parser.test.ts`

### Steps

- [ ] **Step 1: Write failing tests**

```ts
// packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/sse-frame-parser.test.ts

/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it } from 'vitest';
import { parseSSEFrames } from '../sse-frame-parser';

describe('parseSSEFrames', () => {
  it('parses a single content frame', () => {
    const chunk = 'data: {"type":"content","body":"hello"}\n\n';
    expect(parseSSEFrames(chunk)).toEqual([{ type: 'content', body: 'hello' }]);
  });

  it('parses multiple frames packed in one chunk', () => {
    const chunk =
      'data: {"type":"content","body":"hi "}\n\n' +
      'data: {"type":"content","body":"there"}\n\n' +
      'data: {"type":"stream_end"}\n\n';
    expect(parseSSEFrames(chunk)).toEqual([
      { type: 'content', body: 'hi ' },
      { type: 'content', body: 'there' },
      { type: 'stream_end', body: undefined },
    ]);
  });

  it('ignores incomplete trailing frame (no double newline)', () => {
    const chunk = 'data: {"type":"content","body":"complete"}\n\ndata: {"type":"content","body":"partial"';
    expect(parseSSEFrames(chunk)).toEqual([{ type: 'content', body: 'complete' }]);
  });

  it('skips frames that fail JSON parse', () => {
    const chunk =
      'data: {"type":"content","body":"good"}\n\n' +
      'data: not-json\n\n' +
      'data: {"type":"content","body":"good2"}\n\n';
    expect(parseSSEFrames(chunk)).toEqual([
      { type: 'content', body: 'good' },
      { type: 'content', body: 'good2' },
    ]);
  });

  it('skips frames whose payload is not an object with a string `type`', () => {
    const chunk =
      'data: {"type":"content","body":"good"}\n\n' +
      'data: 123\n\n' +
      'data: null\n\n' +
      'data: {"body":"no type field"}\n\n';
    expect(parseSSEFrames(chunk)).toEqual([{ type: 'content', body: 'good' }]);
  });

  it('returns empty array on empty / whitespace-only input', () => {
    expect(parseSSEFrames('')).toEqual([]);
    expect(parseSSEFrames('\n\n\n')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/sse-frame-parser.test.ts --run
```

Expected: FAIL — "Cannot find module '../sse-frame-parser'".

- [ ] **Step 3: Implement the parser**

```ts
// packages/plugins/@nocobase/plugin-feishu/src/server/ai/sse-frame-parser.ts

/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

export interface SSEFrame {
  type: string;
  body?: unknown;
}

/**
 * Stateless SSE-frame parser tailored to plugin-ai's `ChatStreamProtocol`,
 * which always emits frames in the shape:
 *
 *     data: {"type":"<event>","body":<json>}\n\n
 *
 * Returns the frames found in `chunk`. Unrecognised lines, incomplete
 * trailing frames (no terminating `\n\n`), non-JSON payloads, and payloads
 * without a string `type` field are silently dropped — the caller would
 * otherwise have to repeat the same defensive filtering everywhere.
 *
 * Stateless on purpose: each `ctx.res.write` from AIEmployee already
 * delivers complete `data: ...\n\n` blocks; we don't need a buffer-across-
 * chunks parser.
 */
export function parseSSEFrames(chunk: string): SSEFrame[] {
  if (!chunk) return [];
  const frames: SSEFrame[] = [];
  // SSE frames are separated by a blank line (\n\n). Anything after the last
  // \n\n is a partial frame we discard for now.
  for (const block of chunk.split('\n\n')) {
    if (!block.trim()) continue;
    const dataLine = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('data:'));
    if (!dataLine) continue;
    const rawPayload = dataLine.slice('data:'.length).trim();
    if (!rawPayload) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawPayload);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.type !== 'string') continue;
    frames.push({ type: obj.type, body: obj.body });
  }
  return frames;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
yarn test packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/sse-frame-parser.test.ts --run
```

Expected: PASS — 6 tests passed.

- [ ] **Step 5: Lint**

```bash
yarn eslint --fix packages/plugins/@nocobase/plugin-feishu/src/server/ai/sse-frame-parser.ts packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/sse-frame-parser.test.ts
```

Expected: clean.

(No commit — bundled with Task 4.)

---

## Task 4: StreamingCardController + FlushController

**Goal:** 状态机 (creating/thinking/streaming/complete/error) + 节流推送器 (FlushController, 200ms 间隔, 4KB 上限)。消费 SSE 帧的 `type=content`，drain on `complete()`，红头错误卡片 on `error()`，CardKit 创建失败时返回 `needsFallback()=true` 让 bridge 走老路径。

**Files:**
- Create: `packages/plugins/@nocobase/plugin-feishu/src/server/ai/streaming-card-controller.ts`
- Create: `packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/streaming-card-controller.test.ts`

### Steps

- [ ] **Step 1: Write failing tests** covering FlushController throttling + StreamingCardController state machine.

```ts
// packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/streaming-card-controller.test.ts

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
    flusher.enqueue('xxxxxxxxx', 'xxxxxxxxx'); // 9 bytes ≥ 8
    // 让 microtask 跑完
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
      () => new Promise<void>((r) => { resolveFlush = r; }),
    );
    const flusher = new FlushController(200, 4096, onFlush);
    flusher.enqueue('a', 'a');
    await vi.advanceTimersByTimeAsync(200);
    expect(onFlush).toHaveBeenCalledTimes(1);
    flusher.enqueue('b', 'ab');
    resolveFlush();
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
    expect(cardkit.streamCardContent).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'final answer' }),
    );
    expect(cardkit.setCardStreamingMode).toHaveBeenCalledWith(
      expect.objectContaining({ cardId: 'card_xyz', streamingMode: false }),
    );
    expect(cardkit.updateCardKitCard).toHaveBeenCalledWith(
      expect.objectContaining({ cardId: 'card_xyz' }),
    );
    // 序号严格单调
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

  it('streamCardContent failure does not throw — buffer survives for next flush', async () => {
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
    // 第一次 flush 失败，但下一次仍会成功
    controller.onSSEFrame({ type: 'content', body: 'b' });
    await vi.advanceTimersByTimeAsync(200);
    expect(cardkit.streamCardContent).toHaveBeenCalledTimes(2);
    expect(cardkit.streamCardContent).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: 'ab' }),
    );
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringMatching(/streamCardContent.*fail/i),
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/streaming-card-controller.test.ts --run
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the controllers**

```ts
// packages/plugins/@nocobase/plugin-feishu/src/server/ai/streaming-card-controller.ts

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
 * Time-and-byte-bounded throttle on top of a single async sink. Coalesces
 * rapid enqueue() calls into a single flush that carries the latest
 * accumulated text — CardKit treats the element content as a full replace,
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
      void this.flushNow();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => void this.flushNow(), this.intervalMs);
    }
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
        // 触发再来一次，把可能在 flush 期间累积的更新送出
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
 *   creating → thinking → streaming → complete | error
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
      // phase stays 'creating' so needsFallback() returns true
      this.deps.log.warn('feishu cardkit create/send failed, falling back to text reply', {
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false };
    }
  }

  /** Bridge feeds parsed SSE frames here as they arrive. */
  onSSEFrame(frame: SSEFrame): void {
    if (frame.type !== 'content' || typeof frame.body !== 'string') return;
    if (this.phase === 'thinking') this.phase = 'streaming';
    this.accumulatedText += frame.body;
    this.flusher.enqueue(frame.body, this.accumulatedText);
  }

  /** Drain pending buffer, close streaming mode, post the terminal card. */
  async complete(): Promise<void> {
    await this.flusher.drain();
    if (!this.cardId) return;
    try {
      await this.deps.cardkit.setCardStreamingMode({
        cardId: this.cardId,
        streamingMode: false,
        sequence: ++this.sequence,
      });
      await this.deps.cardkit.updateCardKitCard({
        cardId: this.cardId,
        cardJson: buildCompleteCard(this.accumulatedText, { elapsedMs: Date.now() - this.startTime }),
        sequence: ++this.sequence,
      });
      this.phase = 'complete';
    } catch (err) {
      this.deps.log.warn('feishu cardkit complete finalize failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Drain, close streaming mode, post a red error card. */
  async error(message: string): Promise<void> {
    try {
      await this.flusher.drain();
    } catch {
      // swallow — we are already on the error path
    }
    if (!this.cardId) return;
    try {
      await this.deps.cardkit.setCardStreamingMode({
        cardId: this.cardId,
        streamingMode: false,
        sequence: ++this.sequence,
      });
      await this.deps.cardkit.updateCardKitCard({
        cardId: this.cardId,
        cardJson: buildCompleteCard(this.accumulatedText, { errorMessage: message }),
        sequence: ++this.sequence,
      });
      this.phase = 'error';
    } catch (err) {
      this.deps.log.warn('feishu cardkit error finalize failed', {
        error: err instanceof Error ? err.message : String(err),
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
yarn test packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/streaming-card-controller.test.ts --run
```

Expected: PASS — 11 tests passed.

- [ ] **Step 5: Lint**

```bash
yarn eslint --fix packages/plugins/@nocobase/plugin-feishu/src/server/ai/streaming-card-controller.ts packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/streaming-card-controller.test.ts packages/plugins/@nocobase/plugin-feishu/src/server/ai/sse-frame-parser.ts packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/sse-frame-parser.test.ts
```

Expected: clean.

- [ ] **Step 6: Commit (commit B — bundles Tasks 3+4)**

```bash
git add packages/plugins/@nocobase/plugin-feishu/src/server/ai/sse-frame-parser.ts \
        packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/sse-frame-parser.test.ts \
        packages/plugins/@nocobase/plugin-feishu/src/server/ai/streaming-card-controller.ts \
        packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/streaming-card-controller.test.ts
git commit -m "feat(plugin-feishu): add streaming card controller with flush throttling

$(cat <<'EOF'
- parseSSEFrames: stateless parser for plugin-ai's ChatStreamProtocol
  frames (data: {...}\\n\\n). Tolerates packed/incomplete/non-JSON.
- FlushController: 200ms / 4KB throttle that coalesces enqueue() calls
  into one onFlush call carrying the latest accumulated text. Serializes
  in-flight flushes via a pendingFlushAfter latch.
- StreamingCardController: state machine over CardKit lifecycle
  (creating/thinking/streaming/complete/error). Surfaces fall-back via
  needsFallback() on start() failure; error() posts a red card.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Expose `getCardKitClient` from `FeishuClientManager`

**Goal:** 让 bridge 能通过现有的 `clientManager` 拿到一个 `FeishuCardKitClient` 实例（复用 lark client），不重复构造 SDK 客户端。

**Files:**
- Modify: `packages/plugins/@nocobase/plugin-feishu/src/server/transport/feishu-client-manager.ts`

### Steps

- [ ] **Step 1: Add the getter method**

Open `packages/plugins/@nocobase/plugin-feishu/src/server/transport/feishu-client-manager.ts` and add at the top:

```ts
import { FeishuCardKitClient } from './feishu-cardkit-client';
```

Then inside the `FeishuClientManager` class, add a new method right below `getClient`:

```ts
  /**
   * Lazy-construct a {@link FeishuCardKitClient} bound to the given app's
   * lark client. Returned instance is stateless w.r.t. CardKit, so it's
   * safe to construct on every call — but throws if the app hasn't been
   * registered via `addApp` yet.
   */
  getCardKitClient(appId: string): FeishuCardKitClient {
    return new FeishuCardKitClient(this.requireClient(appId));
  }
```

(Insert before the existing `private requireClient` method.)

- [ ] **Step 2: Lint**

```bash
yarn eslint --fix packages/plugins/@nocobase/plugin-feishu/src/server/transport/feishu-client-manager.ts
```

Expected: clean.

- [ ] **Step 3: Run any related tests** to make sure no regression in client manager.

```bash
yarn test packages/plugins/@nocobase/plugin-feishu/src/server/transport/__tests__ --run
```

Expected: all tests pass (no behavioral change to existing methods).

(No commit — bundled with Tasks 6+7.)

---

## Task 6: Add `ctx.res.end` placeholder in `ai-context-factory`

**Goal:** `AIEmployee.processChatStream` 在 `finally` 调 `ctx.res.end()`（line 709）。当前 fake ctx 只有 `write`，stream 会报 "ctx.res.end is not a function"。加一个 no-op。

**Files:**
- Modify: `packages/plugins/@nocobase/plugin-feishu/src/server/ai/ai-context-factory.ts`

### Steps

- [ ] **Step 1: Edit the `res` object in `buildAIInvokeContext`**

Find this block in `ai-context-factory.ts`:

```ts
    res: {
      write: (chunk: string) => {
        streamWriter?.(chunk);
      },
    },
```

Replace with:

```ts
    res: {
      write: (chunk: string) => {
        streamWriter?.(chunk);
      },
      // AIEmployee.processChatStream calls ctx.res.end() in its finally block
      // when from === 'main-agent'. Provide a no-op so the SSE-style stream
      // path does not blow up on a missing method.
      end: () => undefined,
    },
```

- [ ] **Step 2: Run existing context-factory tests** to confirm no regression.

```bash
yarn test packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/ai-context-factory.test.ts --run
```

Expected: PASS — 3 tests still passing.

- [ ] **Step 3: Lint**

```bash
yarn eslint --fix packages/plugins/@nocobase/plugin-feishu/src/server/ai/ai-context-factory.ts
```

Expected: clean.

(No commit — bundled with Task 7.)

---

## Task 7: AI Bridge — invoke→stream + Fallback

**Goal:** 把 `ai-bridge.ts` 的核心调用从 `aiEmployee.invoke()` 切换到 `aiEmployee.stream()` + `StreamingCardController` 编排；保留 `invoke + response-renderer` 老路径作为 CardKit 创建失败时的降级。改造对应 bridge 测试，新增 happy-path / fallback-path / stream-error 三个 case。

**Files:**
- Modify: `packages/plugins/@nocobase/plugin-feishu/src/server/ai/ai-bridge.ts`
- Modify: `packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/ai-bridge.test.ts`

### Steps

- [ ] **Step 1: Add type updates to `AIEmployeeLike` in ai-bridge.ts**

Find the existing `AIEmployeeLike` interface (lines 17–32 of `ai-bridge.ts` after recent edits):

```ts
interface AIEmployeeLike {
  invoke: (args: {
    userMessages: { role: 'user'; content: AIMessageContentLike }[];
  }) => Promise<unknown>;
}
```

Replace with:

```ts
interface AIEmployeeLike {
  invoke: (args: {
    userMessages: { role: 'user'; content: AIMessageContentLike }[];
  }) => Promise<unknown>;
  /**
   * Streaming path used when the CardKit card has been created. The plugin-ai
   * implementation writes SSE frames to `ctx.res.write` (see
   * `ChatStreamProtocol.fromContext`); the bridge intercepts them via
   * `streamWriter` in the context factory.
   */
  stream: (args: {
    userMessages: { role: 'user'; content: AIMessageContentLike }[];
  }) => Promise<boolean>;
}
```

Also extend the `AIEmployeeConstructor` interface so its `new` returns the
`AIEmployeeLike` extended version (TypeScript will already accept this since
the `new` signature returns `AIEmployeeLike` already).

- [ ] **Step 2: Add CardKit deps to `AIBridgeDeps`**

Find:

```ts
export interface AIBridgeDeps {
  app: AIBridgeAppLike;
  log: AIInvokeLogger;
  conversationManager: FeishuConversationManager;
  contextFactory: AIBridgeContextFactory;
  responseRenderer: FeishuResponseRenderer;
  messageLogService: MessageLogService;
  AIEmployee: AIEmployeeConstructor;
}
```

Replace with:

```ts
import type { FeishuCardKitClient } from '../transport/feishu-cardkit-client';

export interface CardKitClientFactory {
  (appId: string): FeishuCardKitClient;
}

export interface AIBridgeDeps {
  app: AIBridgeAppLike;
  log: AIInvokeLogger;
  conversationManager: FeishuConversationManager;
  contextFactory: AIBridgeContextFactory;
  responseRenderer: FeishuResponseRenderer;
  messageLogService: MessageLogService;
  AIEmployee: AIEmployeeConstructor;
  /** Returns a CardKit client bound to the given Feishu app. */
  cardKitClientFor: CardKitClientFactory;
}
```

- [ ] **Step 3: Replace the invoke + render block inside `handleMessage`**

Find the section starting with `const resolvedModel = await this.resolveModel(employee);` and ending with `aiSessionId: session.sessionId,` of the success record (the block that constructs ctx, AIEmployee, calls invoke, and renders). Replace with:

```ts
      const resolvedModel = await this.resolveModel(employee);

      // 1. Try to start the streaming card. CardKit creation is the only
      //    point where we can detect the AI surface is unreachable before
      //    bothering the LLM. On failure, controller.needsFallback()
      //    returns true and we drop down to the legacy invoke path.
      const cardkit = this.deps.cardKitClientFor(appId);
      const controller = new StreamingCardController({
        cardkit,
        receiveId: parsed.chatType === 'p2p' ? parsed.senderOpenId : parsed.chatId,
        receiveIdType: parsed.chatType === 'p2p' ? 'open_id' : 'chat_id',
        log: this.deps.log,
      });
      const startResult = await controller.start();

      const userText = parsed.content.type === 'text' ? parsed.content.text : '';
      const userMessages = [
        { role: 'user' as const, content: { type: 'text' as const, content: userText } },
      ];

      if (!startResult.ok) {
        // Fallback path: CardKit unavailable, send a plain text reply via the
        // legacy renderer so the user still gets an answer.
        this.deps.log.warn('feishu cardkit unavailable, falling back to text reply', {
          appId,
          eventId: parsed.eventId,
        });
        const textChunks: string[] = [];
        const fallbackCtx = await this.deps.contextFactory({
          app: this.deps.app,
          log: this.deps.log,
          feishuContext: context,
          actAsUserId: context.aiConfig.actAsUserId,
          streamWriter: (chunk) => collectContentChunks(chunk, textChunks),
        });
        const fallbackEmployee = new this.deps.AIEmployee({
          ctx: fallbackCtx,
          employee,
          sessionId: session.sessionId,
          model: resolvedModel,
        });
        const result = await fallbackEmployee.invoke({ userMessages });
        await this.deps.responseRenderer.render({
          parsed: { messageId: parsed.messageId, chatId: parsed.chatId },
          context: { appId, chat: { chatType: parsed.chatType } },
          aiOutput: { text: getResultText(result) ?? textChunks.join('') },
        });
      } else {
        // Streaming path: feed parsed SSE frames into the controller.
        const ctx = await this.deps.contextFactory({
          app: this.deps.app,
          log: this.deps.log,
          feishuContext: context,
          actAsUserId: context.aiConfig.actAsUserId,
          streamWriter: (chunk) => {
            for (const frame of parseSSEFrames(chunk)) controller.onSSEFrame(frame);
          },
        });
        const aiEmployee = new this.deps.AIEmployee({
          ctx,
          employee,
          sessionId: session.sessionId,
          model: resolvedModel,
        });
        try {
          await aiEmployee.stream({ userMessages });
          await controller.complete();
        } catch (err) {
          await controller.error(err instanceof Error ? err.message : String(err));
          throw err;
        }
      }

      await this.deps.messageLogService.record({
        appId,
        eventId: parsed.eventId,
        messageId: parsed.messageId,
        chatId: parsed.chatId,
        senderOpenId: parsed.senderOpenId,
        messageType: parsed.contentType,
        routeAction: 'ai',
        status: 'success',
        aiSessionId: session.sessionId,
      });
```

Also add at the top of `ai-bridge.ts`:

```ts
import { StreamingCardController } from './streaming-card-controller';
import { parseSSEFrames } from './sse-frame-parser';
```

- [ ] **Step 4: Update `plugin.ts` to wire `cardKitClientFor` into the bridge**

Open `packages/plugins/@nocobase/plugin-feishu/src/server/plugin.ts`, find the `new FeishuAIBridge({...})` call and add:

```ts
    const aiBridge = new FeishuAIBridge({
      app: this.app,
      log: richLog,
      conversationManager,
      contextFactory,
      responseRenderer,
      messageLogService,
      AIEmployee: aiEmployeeClass,
      cardKitClientFor: (appId) => clientManager.getCardKitClient(appId),
    });
```

(Add `cardKitClientFor: (appId) => clientManager.getCardKitClient(appId),` as a new line in the deps object.)

- [ ] **Step 5: Update bridge tests — add `cardKitClientFor` mock to the setup helper**

Open `packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/ai-bridge.test.ts`. Find the `setup()` helper. Inside it, after the `makeFakeDb()` call, add:

```ts
  const cardKitClient = {
    createCardEntity: vi.fn().mockResolvedValue({ cardId: 'card_xyz' }),
    sendCardByCardId: vi.fn().mockResolvedValue({ messageId: 'om_card' }),
    streamCardContent: vi.fn().mockResolvedValue(undefined),
    setCardStreamingMode: vi.fn().mockResolvedValue(undefined),
    updateCardKitCard: vi.fn().mockResolvedValue(undefined),
  };
  const cardKitClientFor = vi.fn().mockReturnValue(cardKitClient);
```

Then change the `new FeishuAIBridge({...})` call inside setup() to include:

```ts
    cardKitClientFor,
```

And extend the return statement with `cardKitClient, cardKitClientFor` so tests can assert on them.

Do the same for the second `new FeishuAIBridge({...})` invocation inside the
"renders text collected from AIEmployee stream" test — give it its own
`cardKitClient` mock that fails create so the test continues to exercise the
text-chunk collection path.

- [ ] **Step 6: Update the `MockAIEmployee` to provide a `stream` method**

Inside the bridge test's `setup()` helper, find the `MockAIEmployee` mock implementation:

```ts
  const MockAIEmployee = vi.fn().mockImplementation((args: AIEmployeeArgs) => {
    captured.args = args;
    return { invoke };
  });
```

Replace with:

```ts
  const stream = vi.fn().mockImplementation(async ({ userMessages }: { userMessages: unknown }) => {
    captured.userMessages = userMessages;
    if (overrides?.streamError) throw overrides.streamError;
    if (overrides?.streamChunks) {
      const ctx = (captured.args?.ctx ?? {}) as { res?: { write: (s: string) => void } };
      for (const chunk of overrides.streamChunks) {
        ctx.res?.write?.(`data: ${JSON.stringify({ type: 'content', body: chunk })}\n\n`);
      }
    }
    return true;
  });
  const MockAIEmployee = vi.fn().mockImplementation((args: AIEmployeeArgs) => {
    captured.args = args;
    return { invoke, stream };
  });
```

Also extend `setup`'s parameter type:

```ts
function setup(
  overrides?: {
    invokeResult?: unknown;
    invokeError?: Error;
    streamError?: Error;
    streamChunks?: string[];
    employee?: unknown;
  },
) { ... }
```

And include `stream` in the return.

- [ ] **Step 7: Update existing tests so they exercise the streaming path**

The "happy path" test now needs to assert on streaming card lifecycle, not on `replyMessage`. Replace its body:

```ts
  it('happy path: streams CardKit card and records success', async () => {
    const {
      bridge, captured, MockAIEmployee, stream,
      messageLogService, aiConversationsStore, cardKitClient,
    } = setup({ streamChunks: ['hello ', 'world'] });
    await bridge.handleMessage('app1', baseParsed, baseContext);
    expect(MockAIEmployee).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(captured.userMessages).toEqual([
      { role: 'user', content: { type: 'text', content: 'hello bot' } },
    ]);
    expect(cardKitClient.createCardEntity).toHaveBeenCalledTimes(1);
    expect(cardKitClient.sendCardByCardId).toHaveBeenCalledWith(
      expect.objectContaining({ receiveId: 'ou_user', receiveIdType: 'open_id', cardId: 'card_xyz' }),
    );
    expect(cardKitClient.streamCardContent).toHaveBeenCalled();
    expect(cardKitClient.setCardStreamingMode).toHaveBeenCalledWith(
      expect.objectContaining({ streamingMode: false }),
    );
    expect(cardKitClient.updateCardKitCard).toHaveBeenCalled();
    expect(messageLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', aiSessionId: aiConversationsStore[0].sessionId }),
    );
  });
```

- [ ] **Step 8: Add a fallback test**

```ts
  it('fallback: when CardKit createCardEntity fails, falls back to text reply via response-renderer', async () => {
    const setupResult = setup({ invokeResult: { text: 'fallback text' } });
    setupResult.cardKitClient.createCardEntity.mockRejectedValue(new Error('cardkit boom'));
    const { bridge, replyMessage, log } = setupResult;
    await bridge.handleMessage('app1', baseParsed, baseContext);
    expect(replyMessage).toHaveBeenCalledWith(
      expect.objectContaining({ msgType: 'text', content: { text: 'fallback text' } }),
    );
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringMatching(/cardkit unavailable/i),
      expect.anything(),
    );
  });
```

- [ ] **Step 9: Add a stream-error test**

```ts
  it('stream error: invokes controller.error and rethrows so the queue retries', async () => {
    const err = new Error('llm midstream');
    const { bridge, cardKitClient, messageLogService } = setup({ streamError: err });
    await expect(bridge.handleMessage('app1', baseParsed, baseContext)).rejects.toThrow('llm midstream');
    expect(cardKitClient.updateCardKitCard).toHaveBeenCalledWith(
      expect.objectContaining({
        cardJson: expect.objectContaining({ header: expect.objectContaining({ template: 'red' }) }),
      }),
    );
    expect(messageLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failure' }),
    );
  });
```

- [ ] **Step 10: Update the existing "renders text collected from AIEmployee stream when invoke result has no text" test**

That test was written for the legacy invoke path. It can now exercise the
fallback path explicitly: keep the SSE writes, but make `cardKitClient.createCardEntity` reject so the bridge enters fallback. Locate the test, change its `cardKitClient` setup so create rejects, and adjust the assertion to expect the chunks were collected via `replyMessage` content.

If the simpler path is to delete that test (it's now redundant with the new fallback test), feel free — but only after confirming the fallback test asserts on `replyMessage` carrying the streamed text.

Recommended action: remove the legacy test and rely on:
- The new fallback test (Step 8) for the fallback rendering path
- The new happy-path test (Step 7) for the streaming card path

- [ ] **Step 11: Run all bridge-related tests**

```bash
yarn test \
  packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/ai-bridge.test.ts \
  packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/ai-context-factory.test.ts \
  --run --reporter=verbose
```

Expected: all tests PASS — bridge ~7-8 cases, context-factory 3 cases.

- [ ] **Step 12: Lint**

```bash
yarn eslint --fix \
  packages/plugins/@nocobase/plugin-feishu/src/server/ai/ai-bridge.ts \
  packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/ai-bridge.test.ts \
  packages/plugins/@nocobase/plugin-feishu/src/server/ai/ai-context-factory.ts \
  packages/plugins/@nocobase/plugin-feishu/src/server/transport/feishu-client-manager.ts \
  packages/plugins/@nocobase/plugin-feishu/src/server/plugin.ts
```

Expected: clean.

- [ ] **Step 13: Full plugin test sweep**

```bash
yarn test packages/plugins/@nocobase/plugin-feishu --run
```

Expected: all tests PASS — no regression in any plugin-feishu test file.

- [ ] **Step 14: Commit (commit C — bundles Tasks 5+6+7)**

```bash
git add packages/plugins/@nocobase/plugin-feishu/src/server/transport/feishu-client-manager.ts \
        packages/plugins/@nocobase/plugin-feishu/src/server/ai/ai-context-factory.ts \
        packages/plugins/@nocobase/plugin-feishu/src/server/ai/ai-bridge.ts \
        packages/plugins/@nocobase/plugin-feishu/src/server/ai/__tests__/ai-bridge.test.ts \
        packages/plugins/@nocobase/plugin-feishu/src/server/plugin.ts
git commit -m "feat(plugin-feishu): switch AI bridge to CardKit streaming with text fallback

$(cat <<'EOF'
- ai-bridge: new streaming path orchestrates StreamingCardController
  (creating → thinking → streaming → complete | error) by feeding
  parsed SSE frames from AIEmployee.stream into controller.onSSEFrame.
- Fallback: if CardKit create/send fails, bridge constructs a fresh ctx
  and runs the legacy aiEmployee.invoke + response-renderer path so
  users still get an answer (text-only).
- ai-context-factory: ctx.res.end no-op so AIEmployee.processChatStream's
  finally block doesn't blow up on the synthetic context.
- FeishuClientManager.getCardKitClient(appId) lazily wraps the existing
  lark client, no second SDK instance.
- Bridge tests rewritten: happy-path asserts CardKit lifecycle calls,
  fallback path asserts text reply, stream-error asserts red card +
  failure log + rethrow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Spec Coverage Self-Check

| Spec section | Plan coverage |
|---|---|
| §1 Background / 目标 | Goal restated in Plan header |
| §2 openclaw-lark 参考 | Influenced module split (Tasks 1-4) |
| §3 invoke→stream 范式切换 | Task 7 |
| §4.1 新增文件 4 个 | Tasks 1, 2, 3, 4 cover all 4 |
| §4.2 修改文件 3 个 | Tasks 5, 6, 7 cover all 3 |
| §5 CardKit 客户端接口 | Task 1 |
| §6 卡片模板 | Task 2 |
| §7 StreamingCardController + FlushController | Task 4 |
| §8 ai-bridge 集成骨架 | Task 7 Steps 3-4 |
| §9 错误处理矩阵 4 行 | T1 (FeishuApiError surfacing) + T4 (streamCardContent fail tolerance, error()) + T7 (fallback path, stream error rethrow) |
| §10 不变量 | T7 preserves all (topicId, currentRoles, userMessages shape, log paths, no new abstractions) |
| §11 测试策略 25-30 case | T1 (6) + T2 (5) + T3 (6) + T4 (11) + T7 (3 new + 6 modified) ≈ 31 cases |
| §12 commit 边界 3 个 | Plan commits A/B/C exactly match |
| §13 开放问题 | Resolved during implementation: (a) `streaming_mode` placement confirmed via SDK types; (b) N=3 retry threshold is documented but not implemented as a counter — `streamCardContent` failures simply re-flush with full buffer (CardKit replace semantics tolerate this); (c) `receiveIdType` set to `open_id` for p2p, `chat_id` for group (T7 step 3) |
| §14 后续迭代 | Out of scope intentionally |

## Placeholder Scan

Searched plan for "TBD", "TODO", "fill in", "implement later", "add appropriate", "similar to", "etc." in step bodies — none found in any actionable step. All commit messages are full strings; all code blocks are complete.

## Type Consistency

- `FeishuCardKitClient` method signatures (Task 1) match the consumer in Task 4 (StreamingCardController flusher closure + start/complete/error)
- `ANSWER_ELEMENT_ID` const exported from `feishu-card-templates.ts` (Task 2) imported by both controller (Task 4) and tests
- `SSEFrame` type from Task 3 imported by controller (Task 4) and bridge (Task 7)
- `CardKitClientFactory` type added in T7 step 2 matches the wiring in T7 step 4 (`(appId) => clientManager.getCardKitClient(appId)`)
- `streamChunks?: string[]` in test setup (T7 step 6) matches usage (T7 step 7 happy path test)

All consistent.
