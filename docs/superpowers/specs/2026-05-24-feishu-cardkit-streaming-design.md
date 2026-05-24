# 飞书 AI 桥接 · CardKit 流式卡片集成设计

**Status**: Approved (pending implementation plan)
**Date**: 2026-05-24
**Author**: zhangtianlin (with 浮浮酱)
**Scope**: `packages/plugins/@nocobase/plugin-feishu/`
**Supersedes (partial)**: 2026-05-24-plugin-feishu-design.md §"response-renderer" — 该文档原计划"首期 Markdown 降级为 text；富文本 post 后续迭代"。本设计推进到一步到位的 CardKit 流式卡片方案。

## 1. 背景与目标

### 1.1 现状

`plugin-feishu` 的 AI 桥接层（`ai/ai-bridge.ts`）在前序若干轮调试后已经能跑通：飞书消息 → 找到 AIEmployee → 持久化会话 → `aiEmployee.invoke()` → 提取文本 → `replyMessage` 文本回复。

### 1.2 暴露的两个问题

1. **Markdown 在飞书侧渲染为纯文本**：AI 输出天然包含 `**加粗**` / 列表 / 代码块等 markdown 标记，作为 text 类型回复时飞书直接显示原始符号，可读性差。
2. **接收消息没有反馈**：用户发完消息到 AI 回话之间是静默的，没有"机器人已收到、正在处理"的视觉反馈，体验不佳。

### 1.3 目标

提供与飞书官方 AI 助手（如 `larksuite/openclaw-lark`）一致的体验：

- 用户消息发出后**立刻**看到一张"AI 思考中..."的卡片（即时反馈，替代 reaction emoji）；
- AI 输出的 markdown token 实时**流式**填入卡片，用户看到打字效果；
- 完成后卡片切到终态（绿头部 + 用时 footer），错误时切到红头部 + 错误信息；
- 任意环节失败均有降级路径，**不丢消息**。

### 1.4 非目标（YAGNI 边界）

- 不做用户主动中止 AI 回复（飞书 UI 暂无对应入口）；
- 不做工具调用步骤的单独可视化（`tool_call_chunks` SSE 帧暂时忽略，留扩展点）；
- 不做思考链（reasoning）单独展示；
- 不做卡片图片解析（image-resolver）；
- 不做按用户/按 app 配置卡片样式（硬编码模板，未来按需要再外置）；
- **暂不接入飞书 reaction emoji API**：openclaw-lark 验证了"流式卡片自身即反馈"的设计，重复贴 reaction 是冗余。reactions.ts 工具集留作未来扩展。

## 2. 设计参考：openclaw-lark

`larksuite/openclaw-lark`（飞书开放平台官方 AI 集成插件）的关键架构点：

| 文件 | 关键行为 |
|---|---|
| `src/card/cardkit.ts` | 5 个 CardKit SDK 调用：`createCardEntity` / `sendCardByCardId` / `streamCardContent` / `setCardStreamingMode` / `updateCardKitCard` |
| `src/card/streaming-card-controller.ts` | 完整状态机 `idle → creating → streaming → completed/aborted/terminated/creation_failed`，FlushController 节流，CardKit 失败降级到普通 IM 卡片 |
| `src/card/markdown-style.ts` | markdown → 飞书卡片 element 风格映射 |
| `src/messaging/outbound/reactions.ts` | 三个工具函数：add / remove / list，但**没有自动贴 reaction 的逻辑**——他们的 UX 设计中"卡片即反馈" |

我们的设计采用相同范式但裁剪到 MVP（见 §1.4 非目标）。

## 3. 范式切换：invoke → stream

### 3.1 当前路径

```
aiEmployee.invoke() ── 一次性返回 ──▶ result.messages ──▶ getResultText ──▶ replyMessage(text)
```

### 3.2 新路径

```
aiEmployee.stream() ── SSE chunks ──▶ ctx.res.write
                                          │
                                          ▼
                              parseSSEFrames(chunk)
                                          │
                                          ▼
                          controller.onSSEFrame({type, body})
                                          │
                            ┌─────────────┴─────────────┐
                            ▼                           ▼
                    type === 'content'         其他类型（reasoning,
                            │                  tool_call_chunks 等）
                            ▼                           │
                    flusher.enqueue                 ── 暂时忽略 ──
                            │
                       (200ms / 4KB)
                            ▼
                  cardkit.streamCardContent(cardId, 'answer', accumulated, sequence++)
```

`AIEmployee.stream()` 内部已经把 SSE 协议都写好了（`ChatStreamProtocol.fromContext(ctx, onWrite)`），桥接层只需在 `ctx.res.write` 拦截层把 SSE 帧解析后喂给 controller。

## 4. 模块分解

### 4.1 新增文件

| 文件 | 职责 |
|---|---|
| `transport/feishu-cardkit-client.ts` | 5 个 CardKit SDK 调用的薄包装。无业务逻辑。由 `FeishuClientManager.getCardKitClient(appId)` 暴露，复用现有 lark client 实例 |
| `ai/feishu-card-templates.ts` | 三个卡片 builder：`buildThinkingCard()` / `buildStreamingCard(text)` / `buildCompleteCard(text, opts)`，返回 `Record<string, unknown>` |
| `ai/streaming-card-controller.ts` | 核心状态机 + 内嵌 FlushController + `onSSEFrame` 入口 + 降级判定 `needsFallback()` |
| `ai/sse-frame-parser.ts` | 把 SSE 字符串帧（`data: {...}\n\n`）解析成 `{ type, body }` 对象。容忍粘包、不完整尾帧、非 JSON |

### 4.2 修改文件

| 文件 | 改动 |
|---|---|
| `ai/ai-bridge.ts` | invoke → stream；新增 controller 编排；保留 fallback 到 invoke + response-renderer 的老路径 |
| `ai/ai-context-factory.ts` | `ctx.res.end` 占位（stream finally 会调）；streamWriter 的语义不变（仍是把 SSE 字符串透传给桥接） |
| `transport/feishu-client-manager.ts` | 暴露 `getCardKitClient(appId): FeishuCardKitClient` |

### 4.3 保留不动

- `ai/response-renderer.ts`：**降级路径仍然用它** 渲染 text。删除会破坏 fallback；改造它对降级路径无收益。
- `ai/conversation-manager.ts`、`aiConversations.topicId` 持久化、`ctx.state.currentRoles` 等前几轮的修复全部保留。

## 5. CardKit 客户端接口

```ts
// transport/feishu-cardkit-client.ts
export interface FeishuCardKitClient {
  createCardEntity(appId: string, cardJson: Record<string, unknown>): Promise<{ cardId: string }>;

  sendCardByCardId(args: {
    appId: string;
    receiveId: string;
    receiveIdType: 'open_id' | 'chat_id';
    cardId: string;
    /** 让飞书显示为"回复 xxx" 而不是裸消息 */
    replyToMessageId?: string;
  }): Promise<{ messageId: string }>;

  streamCardContent(args: {
    appId: string;
    cardId: string;
    elementId: string;
    /** CardKit 是全量替换语义：每次推送完整累积文本，sequence 控制顺序 */
    content: string;
    sequence: number;
  }): Promise<void>;

  setCardStreamingMode(args: {
    appId: string;
    cardId: string;
    streamingMode: boolean;
    sequence: number;
  }): Promise<void>;

  updateCardKitCard(args: {
    appId: string;
    cardId: string;
    cardJson: Record<string, unknown>;
    sequence: number;
  }): Promise<void>;
}
```

**关键点**：`sequence` 单调递增由 controller 维护。CardKit 用它来防止并发更新乱序。

## 6. 卡片模板

### 6.1 `buildThinkingCard()`

```jsonc
{
  "schema": "2.0",
  "config": {
    "streaming_mode": true,
    "summary": { "content": "AI 正在思考..." }
  },
  "header": {
    "title": { "tag": "plain_text", "content": "AI 助手" },
    "template": "blue"
  },
  "body": {
    "elements": [
      { "tag": "markdown", "element_id": "answer", "content": "_思考中..._" }
    ]
  }
}
```

### 6.2 `buildStreamingCard(text)`

正常 happy path 不会调用——流式中由 `streamCardContent` 替换 `element_id: 'answer'` 的内容。仅作为 `updateCardKitCard` 的备用全量替换路径预留。

### 6.3 `buildCompleteCard(text, { elapsedMs?, errorMessage? })`

```jsonc
{
  "schema": "2.0",
  "header": {
    "title": { "tag": "plain_text", "content": "AI 助手" },
    "template": "<green | red>"
  },
  "body": {
    "elements": [
      { "tag": "markdown", "element_id": "answer", "content": "<text 或 错误说明>" },
      { "tag": "note", "elements": [{ "tag": "plain_text", "content": "用时 X.Xs" }] }
    ]
  }
}
```

`template`：成功 `green`，错误 `red`。`note` element 仅在 `elapsedMs` 提供时输出。

约定：`element_id: 'answer'` 是 controller 与模板之间的契约——`streamCardContent` 用此 id 定位元素。

## 7. StreamingCardController

### 7.1 状态机

```
            ┌─────────┐
            │creating │   createCardEntity / sendCardByCardId 调用中
            └────┬────┘
                 │ ok
                 ▼
            ┌─────────┐
        ┌───│thinking │   卡片已发，等首个 content SSE 帧
        │   └────┬────┘
        │        │ 收到 type=content
   error│        ▼
        │   ┌─────────┐
        │   │streaming│   节流推送 streamCardContent
        │   └────┬────┘
        │        │ stream 结束
        │        ▼
        │   ┌─────────┐   ┌─────────┐
        └──▶│  error  │   │complete │
            └─────────┘   └─────────┘
```

`creating` 失败时，phase 留在 `creating`，`needsFallback()` 返回 `true`，bridge 切到老 text 路径。

### 7.2 接口

```ts
class StreamingCardController {
  /** 触发 createCardEntity + sendCardByCardId */
  start(): Promise<{ ok: boolean }>;

  /** SSE 帧消费入口；type=content 触发 flusher.enqueue */
  onSSEFrame(frame: { type: string; body?: unknown }): void;

  /** 流结束：drain flusher → 关 streaming mode → 终态卡片 */
  complete(): Promise<void>;

  /** 流出错：drain → 关 streaming mode → 红头错误卡片 */
  error(message: string): Promise<void>;

  /** bridge 用来判断是否走 fallback */
  needsFallback(): boolean;
}
```

### 7.3 FlushController（内嵌）

固定参数节流：**200ms 间隔 / 4KB 上限**。

| 输入 | 行为 |
|---|---|
| 正常 chunk 到达 | 更新 `buffer = accumulated`（CardKit 全量替换语义），如未起定时器则起 200ms |
| buffer 字节数 ≥ 4KB | 立即 flush，绕过 200ms |
| flush 进行中又来新 chunk | 设 `pendingFlushAfter = true`，当前 flush 完成后再补一次 |
| `drain()` | flush 残留 buffer，等待结算 |

参数选择依据：LLM 输出 ~50 tok/s，200ms ≈ 10 token，体感流畅；4KB 是飞书单次 streamCardContent 的舒适负载。openclaw-lark 用更复杂自适应节流，本设计裁剪到固定值——三个相似行为不抽象。

### 7.4 sequence 单调递增

每次 `streamCardContent` / `setCardStreamingMode` / `updateCardKitCard` 调用前 `++this.sequence`。

## 8. ai-bridge 集成

```ts
// ai-bridge.ts 关键骨架
const cardkit = clientManager.getCardKitClient(appId);
const controller = new StreamingCardController({
  cardkit,
  appId,
  receiveId: parsed.chatType === 'p2p' ? parsed.senderOpenId : parsed.chatId,
  receiveIdType: parsed.chatType === 'p2p' ? 'open_id' : 'chat_id',
  replyToMessageId: parsed.messageId,
  log: this.deps.log,
});

const startResult = await controller.start();

if (!startResult.ok) {
  // 降级：CardKit 不可用，老路径
  this.deps.log.warn('feishu.cardkit.fallback.text', { appId, eventId: parsed.eventId });
  const result = await aiEmployee.invoke({ userMessages: [{ role: 'user', content: { type: 'text', content: userText } }] });
  await this.deps.responseRenderer.render({
    parsed: { messageId: parsed.messageId, chatId: parsed.chatId },
    context: { appId, chat: { chatType: parsed.chatType } },
    aiOutput: { text: getResultText(result) ?? '' },
  });
  // ...success 日志
  return;
}

// happy path：流式
const ctx = await this.deps.contextFactory({
  app: this.deps.app,
  log: this.deps.log,
  feishuContext: context,
  actAsUserId: context.aiConfig.actAsUserId,
  streamWriter: (chunk) => {
    for (const frame of parseSSEFrames(chunk)) controller.onSSEFrame(frame);
  },
});

const aiEmployee = new this.deps.AIEmployee({ ctx, employee, sessionId: session.sessionId, model: resolvedModel });

try {
  await aiEmployee.stream({ userMessages: [{ role: 'user', content: { type: 'text', content: userText } }] });
  await controller.complete();
} catch (err) {
  await controller.error(err instanceof Error ? err.message : String(err));
  throw err;  // 让队列层走失败重试逻辑
}
// success 日志
```

`ctx.res.end` 被 `AIEmployee.processChatStream` 在 finally 调用——`ai-context-factory.ts` 加无操作占位 `end: () => {}` 即可。

## 9. 错误处理矩阵

| 失败点 | 用户可见 | 处置 |
|---|---|---|
| `createCardEntity` / `sendCardByCardId` 失败 | 用户没看到任何卡片 | controller 留在 `creating`；bridge 检测 `needsFallback()`，走 `aiEmployee.invoke` + text 渲染老路径；warn 日志 `feishu.cardkit.fallback.text` |
| `streamCardContent` 中途失败 | 卡片"卡住"在某帧 | controller 内 catch，记 warn；下次 flush 仍然带上累积全文（全量替换天然兜底）；连续 3 次失败切到 `error` 终态 |
| `aiEmployee.stream` 抛错 | 流式中断 | bridge 捕获后 `controller.error(msg)`，红头部 + 错误说明；rethrow 让队列层走失败重试 |
| `complete` / `setCardStreamingMode` / `updateCardKitCard` 失败 | 卡片留在 streaming 态 | catch 记 warn 不抛错；用户看到内容但没收尾，下条新消息独立处理 |
| SSE 帧 JSON 解析失败 | 单帧丢失 | parser 内部 try/catch，丢弃该帧继续解析后续 |

**不变量**：reaction、卡片、流式都是 UX 增强，**任何环节失败都不能阻止消息处理本身完成 + 日志记录**。

## 10. 不变量与约束

- `aiConversations.topicId` 映射机制保留（来自前序设计）；
- `ctx.state.currentRoles` / `ctx.app.aiManager` 等已修复字段保留；
- `userMessages: [{ role: 'user', content: { type: 'text', content: userText } }]` 嵌套形式保留（plugin-ai 的 AIMessageInput 契约）；
- `messageLogService.record` 在 happy / fallback / error 三条路径上一致触发；
- 所有非 AI 路径（`decision === 'ignore'`）走的还是老逻辑；
- 不引入新的可配置项、新抽象层（AGENTS.md "三行相似优于过早抽象"）。

## 11. 测试策略

| 层 | 文件 | 关键 case |
|---|---|---|
| **CardKit 客户端** | `transport/__tests__/feishu-cardkit-client.test.ts` 🆕 | mock lark SDK，验证 5 个方法把参数正确转给 SDK；sequence 透传；错误透传 |
| **卡片模板** | `ai/__tests__/feishu-card-templates.test.ts` 🆕 | 三个 builder 输出快照；`buildCompleteCard` 在 errorMessage / elapsedMs 不同组合下的形态 |
| **FlushController** | `ai/__tests__/streaming-card-controller.test.ts` 🆕 一个 describe | 节流间隔；4KB 立即 flush；并发 flush 锁；drain() 推完残留 |
| **StreamingCardController** | 同上另一个 describe | start 成功 → thinking；首个 content 帧 → streaming；create 失败 → needsFallback() = true；streamCardContent 失败 → 不抛、buffer 不丢、连 3 次切 error；error/complete 终态正确调 setCardStreamingMode + updateCardKitCard |
| **SSE 解析** | `ai/__tests__/sse-frame-parser.test.ts` 🆕 | 单帧 / 多帧粘包 / 不完整尾帧丢弃 / 非 JSON 容错 |
| **bridge 集成** | `ai/__tests__/ai-bridge.test.ts` ✏️ | happy path：mock controller，验证 invoke 替换为 stream + complete 顺序；fallback path：start ok=false 时走老 text 渲染 + warn 日志；stream 抛错 → controller.error 被调；userMessages 仍为嵌套形式 |
| **手工冒烟** | — | bridge 在真飞书环境跑：发普通消息 → 看到"思考中" → 流式出文 → 终态绿头部；停 LLM key → 看到红 header 错误 |

预计**新增 3 个测试文件，改 1 个**，总 case ~25-30 个。

## 12. 提交边界

按 AGENTS.md "Conventional Commits"，本次工作分至少 3 个 commit，每个独立可编译可测：

1. `feat(plugin-feishu): add CardKit SDK wrapper + card templates` — 纯增（transport + templates + 单元测试）
2. `feat(plugin-feishu): add streaming card controller with flush throttling` — 状态机 + flush + SSE parser + 单元测试
3. `feat(plugin-feishu): switch AI bridge to CardKit streaming with text fallback` — 改 bridge + ctx-factory；改 bridge 测试；保底降级

## 13. 开放问题（实施时再决定）

- **CardKit `streaming_mode` 的 schema/字段名**：飞书 SDK 文档使用 `config.streaming_mode`，但卡片 schema 2.0 的精确字段命名需在实施时与 SDK 类型定义对齐。如果 SDK 用别名或子结构，模板调整为 SDK 接受的形态——不影响整体设计。
- **错误降级阈值**：连续 N 次 `streamCardContent` 失败后切 error 的 N 取值，初始定 3，看实测体验调整。
- **`receiveIdType` 在群聊场景下的细节**：群聊用 `chat_id`，但 `replyToMessageId` 与 `receiveId` 的搭配在飞书 API 上有约束，实施时按 SDK 文档校验。

## 14. 后续迭代方向（不属于本期）

- 工具调用步骤可视化（消费 `tool_call_chunks` 帧，在卡片中加 `column_set` 元素显示工具状态）；
- 思考链单独显示（消费 `reasoning` 帧，加可折叠 markdown 段）；
- 用户主动停止按钮（卡片加 button element，飞书 card action 路由到 abort 流程）；
- 卡片样式按 app 配置化（feishu_apps 表加 `ai_card_template` jsonb 字段）；
- reaction 工具集利用：例如错误时贴 ❌，成功时不贴（与卡片状态互补）。
