# 飞书集成插件架构设计

## 概述

为 NocoBase 构建飞书集成插件 (`@nocobase/plugin-feishu`)，支持多飞书应用管理、WebSocket 消息接入、AI 员工对话、飞书 API tools/skills、卡片交互回调，以及后续可接入的通知渠道。

这份设计以当前仓库的真实扩展点为准：

- 插件放在 `packages/plugins/@nocobase/plugin-feishu/`。
- 服务端 collections 由 `src/server/collections/` 自动导入。
- AI tools/skills 必须放在 `src/ai/`，构建后复制到 `dist/ai/`，由 `Plugin.loadAI()` 自动扫描，不在业务 `plugin.ts` 里手写 `ToolsLoader` / `SkillsLoader`。
- 管理界面首选 `client-v2`，只有当通知管理器客户端能力仍只存在于 legacy client 时，才隔离一个最小 `src/client/` 兼容入口，且 v2 代码不能 import v1。

### 需求范围

| 需求 | 优先级 | 说明 |
|------|--------|------|
| 多飞书应用管理 | P0 | 支持多个飞书机器人配置并行存在，运行时按应用隔离 |
| WebSocket 消息接入 | P0 | 长连接接收事件，消息处理进入受控队列 |
| AI 员工集成 | P0 | 飞书消息接入 NocoBase AI Employee 对话链路 |
| 飞书 API tools/skills | P0 | 通过 NocoBase 原生 `src/ai` loader 自动注册 |
| 卡片交互回调 | P0 | 快照配置 + 幂等事件 + 操作日志，保证一致性和可追踪 |
| 客户端管理界面 | P0 | 应用管理、运行时诊断、卡片记录、交互日志 |
| 通知渠道 | P2 | 先保留服务端 class 和测试边界，完整可用后再暴露给通知管理器 UI |
| OAuth 用户绑定 | P2 | 架构预留，首期不实现 |

### 首期不做

- 不做飞书 OAuth 用户授权和自动用户绑定。
- 不做完整通知模板设计器。
- 不做跨飞书租户的复杂授权策略，只以 `app_id` 隔离配置和运行时。
- 不引入新的 feature flag；不可用能力不暴露到 UI。

### 关键 CR 调整

| 问题 | 调整 |
|------|------|
| tools/skills 原设计放在 `src/server/` 下，框架不会按预期自动加载 | 改为 `src/ai/tools`、`src/ai/skills`，依赖核心 `Plugin.loadAI()` |
| 原设计把新管理界面写成 v1 client | 改为 `src/client-v2` 设置页；如需 legacy 通知管理器注册，单独隔离 v1 adapter |
| `onMessage` 设计成 fire-and-forget，容易丢错误和违反本仓库异步调用约束 | 改为显式 enqueue，await 队列接收结果，再由队列处理 AI |
| 多实例运行时没有边界 | 增加跨实例去重、运行时租约、连接生命周期、按 app 清理 |
| AI 调用身份不明确 | `ai_act_as_user_id` 明确决定 NocoBase 权限上下文；未配置时只允许飞书上下文内的低风险工具 |
| 卡片回调只读快照但缺少幂等 | 增加 `event_id` / `action_key` / `message_id` 幂等记录 |
| 通知渠道骨架直接注册会暴露不可用能力 | 首期不在 UI 暴露，完整实现后再进行 server + client 双端注册 |

### 旧项目参考策略

旧项目 `D:/workspace-xiaomi/f1-web/packages/plugins/@nocobase/plugin-feishu` 有参考价值，但定位是“行为样本和迁移清单”，不是“新架构模板”。新插件应保留已经被验证过的业务能力、飞书协议细节和测试场景，同时重画模块边界，避免把旧项目里的职责耦合继续带进来。

优先参考：

| 旧项目内容 | 新项目使用方式 |
|------------|----------------|
| `src/ai/` 目录下的 skills/tools 布局 | 作为 loader 落点和 tool/skill 文案的直接参考 |
| `message-parser.*.test.ts`、`message-queue.test.ts`、`feishu-websocket.test.ts` | 迁移为新模块的行为回归测试 |
| `feishu-card-records`、callback snapshot、卡片交互日志相关实现 | 提炼为 `card-record-service`、`card-action-router`、`card-action-dedup` |
| `notification/FeishuNotificationChannelForms.tsx` 与通知 adapter 测试 | 后续完整通知渠道的表单和消息结构参考 |
| `ai-employee-handler`、`run-ai-employee-external-stream`、`internal-ai-context.test.ts` | 验证 AI 调用参数、上下文和回复渲染边界 |
| `feishu-ai-debug`、WS health/message stats 相关代码 | 提炼为 diagnostics 页面和日志事件 |

不直接照搬：

- 过大的 `plugin.ts` 生命周期编排。
- WebSocket、队列、AI、卡片、通知混在同一层的调用关系。
- legacy client 管理页面结构；新管理界面默认走 `client-v2`。
- 出站发送、通知、AI chat 之间不清晰的权限边界。
- 为兼容历史入口保留的 wrapper 或别名；除非当前仓库真实需要，否则不保留。

迁移顺序：

1. 先列旧项目功能清单和测试清单。
2. 按新模块边界迁移可复用逻辑。
3. 每迁移一个模块，先迁移对应测试，再改实现。
4. 对旧项目中的运行时风险点只迁移修正后的行为，不迁移原始耦合结构。

---

## 架构总览

### 目录结构

```text
plugin-feishu/
├── package.json
├── client-v2.js
├── client-v2.d.ts
├── client.js                         # 可选：legacy 通知管理器 adapter
├── client.d.ts                       # 可选
├── server.js
├── server.d.ts
└── src/
    ├── index.ts
    ├── constants.ts
    │
    ├── server/
    │   ├── index.ts
    │   ├── plugin.ts                 # 插件生命周期编排
    │   │
    │   ├── app-runtime/
    │   │   ├── app-runtime-manager.ts # 应用配置加载、启动、停止、重载
    │   │   ├── app-registry.ts        # app_id -> runtime 状态
    │   │   └── secret-service.ts      # 凭证脱敏、校验、日志保护
    │   │
    │   ├── transport/
    │   │   ├── feishu-client-manager.ts
    │   │   └── ws-connection-manager.ts
    │   │
    │   ├── message/
    │   │   ├── message-parser.ts
    │   │   ├── message-context.ts
    │   │   ├── message-router.ts
    │   │   ├── message-dedup.ts
    │   │   ├── message-queue.ts
    │   │   └── types.ts
    │   │
    │   ├── card/
    │   │   ├── card-builder.ts
    │   │   ├── card-record-service.ts
    │   │   ├── card-action-router.ts
    │   │   ├── card-action-handler.ts
    │   │   └── card-action-dedup.ts
    │   │
    │   ├── ai/
    │   │   ├── ai-bridge.ts
    │   │   ├── ai-context-factory.ts
    │   │   ├── conversation-manager.ts
    │   │   └── response-renderer.ts
    │   │
    │   ├── notification/
    │   │   └── feishu-notification-channel.ts
    │   │
    │   ├── collections/
    │   │   ├── index.ts
    │   │   ├── feishu-apps.ts
    │   │   ├── feishu-message-logs.ts
    │   │   ├── feishu-card-records.ts
    │   │   ├── feishu-card-action-logs.ts
    │   │   └── feishu-user-bindings.ts
    │   │
    │   ├── actions/
    │   │   ├── index.ts
    │   │   ├── app-actions.ts
    │   │   ├── message-actions.ts
    │   │   └── diagnostics-actions.ts
    │   │
    │   └── __tests__/
    │
    ├── ai/
    │   ├── tools/
    │   │   ├── feishuSendMessage/
    │   │   │   ├── index.ts
    │   │   │   └── description.md
    │   │   └── feishuGetMessage/
    │   │       ├── index.ts
    │   │       └── description.md
    │   └── skills/
    │       └── feishu-messaging/
    │           └── SKILLS.md
    │
    ├── client-v2/
    │   ├── index.tsx
    │   ├── plugin.tsx
    │   ├── locale.ts
    │   ├── pages/
    │   │   ├── FeishuAppsPage.tsx
    │   │   ├── FeishuCardRecordsPage.tsx
    │   │   └── FeishuDiagnosticsPage.tsx
    │   └── components/
    │       ├── FeishuAppForm.tsx
    │       ├── FeishuAppStatusTag.tsx
    │       └── CardActionLogTable.tsx
    │
    └── client/                       # 可选，仅 legacy 通知管理器需要时存在
        ├── index.tsx
        └── notification-channel.tsx
```

### 依赖方向

```text
plugin.ts
  -> app-runtime
      -> transport
      -> message
      -> card
      -> ai
      -> notification

transport
  -> @larksuiteoapi/node-sdk

message
  -> transport 接口、Cache、eventQueue

card
  -> Database、transport 接口、ai bridge

ai bridge
  -> @nocobase/plugin-ai 的 AIEmployee、conversation manager、response renderer

src/ai tools
  -> ctx.app.pm.get('feishu') 暴露的服务接口
  -> 不直接 new 飞书 SDK client

client-v2
  -> @nocobase/client-v2、antd、ctx.api
  -> 不 import @nocobase/client
```

服务端只有 `transport` 层可以直接依赖飞书 SDK。业务模块通过接口调用 `FeishuClientManager`，避免卡片、AI tools、通知渠道各自散落 SDK 细节。

---

## 生命周期

### 插件启动

1. `beforeLoad()` 注册 resource actions、ACL snippet、日志目录。
2. `load()` 初始化运行时 manager、注册 notification server channel class（仅完整实现后暴露）、订阅内部队列。
3. NocoBase 核心 `Plugin.loadAI()` 自动扫描构建后的 `dist/ai`，注册 `src/ai` 下的 tools/skills。
4. `afterStart` 之后读取 `feishu_apps` 中 `active` 配置，逐个启动 WebSocket。
5. 每个 app 启动前执行凭证测试、bot 信息刷新、运行时租约获取。

### 配置变更

```text
保存 app 配置
  -> app-actions 校验凭证
  -> 更新 feishu_apps.config_version
  -> app-runtime-manager.reload(appId)
  -> stop old connection
  -> rebuild client
  -> start new connection
```

配置更新必须按 `app_id` 串行，避免保存、禁用、重启同时发生导致旧连接复活。运行时清理只影响目标 app，不能清空其他 app 的队列和连接。

### 插件停用/卸载

- `afterDisable()` 停止全部 WS 连接，释放运行时租约，取消 eventQueue 订阅。
- `remove()` 重复执行清理，保证幂等。
- 不删除业务数据，除非后续卸载流程明确需要。

---

## 数据流

### 消息处理流程

```text
飞书用户发消息
  -> ws-connection-manager 接收 im.message.receive_v1
  -> message-dedup.tryRecord(appId, eventId/messageId)
  -> message-queue.enqueue(appId, rawEvent)
  -> message-parser 解析消息
  -> message-context 构建 app / chat / sender / AI 配置
  -> message-router 决策
      -> ignore: 写 message log
      -> ai: ai-bridge 调用 AIEmployee
  -> response-renderer 回复飞书
  -> feishu_message_logs 记录最终状态
```

`enqueue()` 必须被 await，确认事件已进入队列后再返回。队列处理失败时写入 `feishu_message_logs`，并按错误类型决定是否重试。

### 卡片交互流程

```text
发送阶段
  card-builder 构建 card schema
  -> feishu-client-manager 发送
  -> card-record-service 写 feishu_card_records 快照

交互阶段
  card.action.trigger
  -> card-action-dedup.tryRecord(appId, eventId)
  -> card-action-router 根据 message_id/open_message_id 读取快照
  -> card-action-handler 执行动作
  -> 写 feishu_card_action_logs
  -> 返回 toast / card update
```

回调只读 `feishu_card_records` 中的 `card_schema_snapshot` 和 `callback_config_snapshot`，不读取当前模板。模板修改不会改变已发送卡片的回调行为。

### AI tool 调用流程

```text
AIEmployee
  -> tool: feishuSendMessage
  -> ctx.state.feishuContext / ctx.action.params.values.feishuContext
  -> ctx.app.pm.get('feishu').sendMessage(...)
  -> FeishuClientManager
```

tool 不直接读取全局默认 app。当前飞书上下文必须由 `ai-context-factory` 写入 AI 调用使用的 `ctx`；没有 appId 时直接返回可解释错误。

---

## 模块详细设计

### 1. 应用运行时

#### `app-runtime/app-runtime-manager.ts`

负责把数据库配置转成运行时连接。

```typescript
class FeishuAppRuntimeManager {
  startActiveApps(): Promise<void>;
  start(appId: string): Promise<void>;
  stop(appId: string): Promise<void>;
  reload(appId: string): Promise<void>;
  stopAll(): Promise<void>;
  getOverview(): FeishuRuntimeOverview[];
}
```

设计要求：

- 每个 `app_id` 对应独立 client、WS 连接、队列 key、diagnostics。
- `start/reload/stop` 按 app 加互斥锁，避免并发重启。
- 多实例部署优先使用 NocoBase cache/lock 能力做跨实例租约；没有分布式后端时允许本地运行，但 diagnostics 明确提示可能出现重复连接。
- 禁用 app 时只停止该 app 的连接和队列消费，不影响其他 app。
- 日志不输出 `app_secret`、`encrypt_key`、`verification_token`。

#### `app-runtime/secret-service.ts`

- 统一处理密钥字段脱敏。
- `testConnection` 和 `start` 共用凭证校验逻辑。
- 返回错误时只暴露错误类型和飞书 request id，不返回密钥原文。

### 2. 传输层

#### `transport/feishu-client-manager.ts`

```typescript
class FeishuClientManager {
  addApp(config: FeishuAppConfig): void;
  removeApp(appId: string): void;
  getClient(appId: string): Lark.Client | undefined;

  sendMessage(params: SendMessageParams): Promise<SendMessageResult>;
  replyMessage(params: ReplyMessageParams): Promise<SendMessageResult>;
  updateMessage(params: UpdateMessageParams): Promise<void>;
  uploadImage(params: UploadImageParams): Promise<string>;
  getBotInfo(appId: string): Promise<FeishuBotInfo>;
}
```

要求：

- 内部封装 `@larksuiteoapi/node-sdk`。
- `receive_id_type` 由调用方显式传入，不能靠前缀猜测，避免 open_id、union_id、chat_id 混淆。
- 统一处理飞书 API 错误，保留 `code/msg/requestId`。
- 不包含 AI、卡片回调、通知业务逻辑。

#### `transport/ws-connection-manager.ts`

```typescript
class FeishuWebSocketManager {
  addConnection(config: WSConfig): void;
  startConnection(appId: string): Promise<void>;
  stopConnection(appId: string): Promise<void>;
  stopAll(): Promise<void>;
  isRunning(appId: string): boolean;
  getConnectedAppIds(): string[];
}
```

要求：

- 注册 `im.message.receive_v1` 和 `card.action.trigger`。
- 消息事件只做去重和入队，不在 WS 回调里直接跑 AI。
- 卡片事件需要 await handler 并返回飞书要求的响应。
- 心跳/断线重连记录到 diagnostics，避免 idle 心跳误判导致频繁重连。

### 3. 消息层

#### `message/message-parser.ts`

```typescript
interface ParsedMessage {
  eventId: string;
  messageId: string;
  chatId: string;
  chatType: 'p2p' | 'group';
  senderOpenId: string;
  senderName?: string;
  createTime: number;
  contentType: 'text' | 'post' | 'image' | 'file' | 'interactive' | 'share_chat' | 'share_user';
  content: ParsedContent;
  rootMessageId?: string;
  mentions: Mention[];
  isMentionBot: boolean;
}
```

规则：

- 飞书消息 content 是嵌套 JSON 字符串，按 `msg_type` 分支解析。
- 群聊必须通过 `bot_open_id` 判断是否 @ 机器人。
- 不支持的消息类型返回 `null`，并写入 message log 的 `ignored` 状态。

#### `message/message-context.ts`

```typescript
interface FeishuMessageContext {
  appId: string;
  appName: string;
  sender: {
    openId: string;
    name?: string;
    userId?: number;
  };
  chat: {
    chatId: string;
    chatType: 'p2p' | 'group';
    chatName?: string;
  };
  aiConfig: {
    employeeUsername: string;
    actAsUserId?: number;
  } | null;
}
```

要求：

- 从 `feishu_apps` 读取 AI 员工绑定。
- `actAsUserId` 为空时，不伪造 NocoBase 当前用户。
- 飞书用户名、群名只做轻量缓存，不作为权限来源。

#### `message/message-router.ts`

```typescript
type RouteDecision =
  | { action: 'ai'; context: FeishuMessageContext }
  | { action: 'ignore'; reason: 'no-ai-binding' | 'group-without-mention' | 'unsupported-message' };
```

路由规则：

| 条件 | 动作 |
|------|------|
| 未绑定 AI 员工 | ignore |
| 群聊未 @ 机器人 | ignore |
| 私聊或群聊 @ 机器人 | ai |

#### `message/message-dedup.ts`

- key: `feishu:message-dedup:${appId}:${eventId || messageId}`。
- TTL 默认 10 分钟。
- Redis/cache 后端存在时跨实例生效。
- 仅靠 cache 去重不承担审计职责，审计看 `feishu_message_logs`。

#### `message/message-queue.ts`

- 使用 NocoBase eventQueue 或插件内受控队列。
- key 按 app 隔离：`plugin-feishu.message.${appId}`。
- 每个 app 初始并发为 1，避免同一会话上下文乱序。
- 失败可重试的错误：网络错误、飞书 5xx、限流。
- 不重试的错误：消息解析失败、未授权、配置不存在、AI 员工不存在。

### 4. 卡片层

#### `card/card-builder.ts`

负责构建飞书 interactive card，不写数据库。

```typescript
class FeishuCardBuilder {
  static textCard(title: string, content: string): FeishuCardSchema;
  static actionCard(title: string, content: string, actions: CardAction[]): FeishuCardSchema;
  static fromTemplate(template: CardTemplate, vars: Record<string, unknown>): FeishuCardSchema;
}
```

#### `card/card-record-service.ts`

负责发送后快照落库。

```typescript
class CardRecordService {
  recordSentCard(params: {
    appId: string;
    messageId: string;
    openMessageId?: string;
    cardSchemaSnapshot: unknown;
    callbackConfigSnapshot: unknown;
    context: Record<string, unknown>;
    createdById?: number;
  }): Promise<void>;
}
```

#### `card/card-action-router.ts`

```typescript
type CardRouteResult =
  | { action: 'ai_continue'; conversation: ConversationInfo; input: string }
  | { action: 'workflow'; workflowId: string; params: Record<string, unknown> }
  | { action: 'callback'; config: ActionCallbackConfig; values: Record<string, unknown> }
  | { action: 'unknown'; reason: string };
```

流程：

1. 提取 `event_id`、`message_id` / `open_message_id`、`action_key`。
2. 幂等检查，重复事件直接返回上一次结果或安全 toast。
3. 读取 `feishu_card_records` 快照。
4. 使用 `callback_config_snapshot` 匹配 `action_key`。
5. 路由到 handler。

#### `card/card-action-handler.ts`

- 每次操作写入 `feishu_card_action_logs`。
- handler 返回 `{ toast?, cardUpdate? }`。
- 业务执行失败也要写日志，并返回用户可理解的 toast。
- workflow/manual 节点集成作为后续迭代，不阻塞首期 AI continue 和 callback。

### 5. AI 桥接层

#### `ai/conversation-manager.ts`

```typescript
class FeishuConversationManager {
  getOrCreateSession(params: {
    appId: string;
    chatId: string;
    chatType: 'p2p' | 'group';
    senderOpenId: string;
  }): Promise<ConversationInfo>;
}
```

首期 session 规则：

| 场景 | sessionId |
|------|-----------|
| 私聊 | `feishu:${appId}:p2p:${senderOpenId}` |
| 群聊 + @机器人 | `feishu:${appId}:group:${chatId}` |

### `ai/ai-context-factory.ts`

构建 AIEmployee 所需的 NocoBase `Context`。

要求：

- `ctx.app`、`ctx.db`、`ctx.log` 必须是真实对象。
- `actAsUserId` 配置存在时加载对应用户，写入 `ctx.auth.user` 和 `ctx.state.currentUser`。
- `actAsUserId` 不存在时，不能让 AI 调用依赖 NocoBase 用户权限的数据工具。
- `feishuContext` 写入 `ctx.state.feishuContext` 和 `ctx.action.params.values.feishuContext`。当前 AI tool adapter 只把 `config.context.ctx` 传给 tool 的 `invoke(ctx, args, runtime)`，所以不能依赖 runtime 上的自定义上下文。

#### `ai/ai-bridge.ts`

```typescript
class FeishuAIBridge {
  handleMessage(appId: string, parsed: ParsedMessage, context: FeishuMessageContext): Promise<void>;
}
```

内部流程：

1. 查询 AI Employee，使用 `employeeUsername` 而不是显示名。
2. 获取 session。
3. 用 `ai-context-factory` 构造本次调用使用的 NocoBase `ctx`，其中包含 `ctx.app`、`ctx.db`、`ctx.log`、可选 `ctx.auth.user` / `ctx.state.currentUser`，以及 `ctx.state.feishuContext`。
4. 构造 `AIEmployee({ ctx, employee, sessionId, ... })`。
5. 调用 `aiEmployee.invoke({ userMessages, writer })`；飞书上下文已经挂在该次调用使用的 `ctx` 上。
6. 从 writer 收集的 AI 输出或 invoke 返回的 `messageId` 对应的 `aiMessages` 记录中解析最终回复。
7. 根据解析出的回复类型通过 `response-renderer` 回复飞书。
8. 所有异常写入 `feishu_message_logs`。

#### `ai/response-renderer.ts`

| AI 回复类型 | 飞书渲染 |
|-------------|----------|
| 纯文本 | `replyMessage` 或 `sendMessage` text |
| Markdown | 首期降级为 text；富文本 post 后续迭代 |
| 结构化数据 | 基础 interactive card |
| 流式输出 | 后续迭代；首期不承诺 |

首期不要在文档中承诺完整流式卡片，避免实现范围失控。

#### 回复提取策略

NocoBase 内部 AI Employee 的主要输出面向 Chat/SSE 协议，不是飞书消息协议。飞书桥接层需要做一层协议适配：

```text
AIEmployee.invoke()
  -> writer 收集 content/tool 状态/消息事件
  -> 或根据 invokeResult.messageId 回读 aiMessages
  -> normalize 为 FeishuAIReply
  -> response-renderer 发送到飞书
```

首期采用非流式回复：

- `writer` 只累计最终可见文本内容，忽略 reasoning、tool status 等 UI 事件。
- 如果 `invoke()` 返回 `messageId`，优先回读 `aiMessages` 里的最终 AI 文本，作为 writer 为空时的兜底。
- 没有可见文本时，记录 `empty_success`，不向飞书发送空消息。
- tool 调用结果只进入 AI 上下文，不直接透传给飞书用户，除非模型最终回复中引用。

后续流式回复再把 `ChatStreamProtocol` 的 `content` 事件映射为飞书卡片 patch。首期不做，是为了避免在 WS 消息处理链路里同时引入飞书卡片流式更新、AI SSE 协议和消息幂等三套状态机。

### 6. AI tools & skills

NocoBase 核心会在插件生命周期里调用 `Plugin.loadAI()`：

```text
dist/ai
  -> **/tools/**/*.ts|js
  -> **/tools/**/*/description.md
  -> **/skills/**/SKILLS.md
  -> **/ai-employees/*
```

因此源码必须放在 `src/ai/`，构建时会复制 markdown 文件。

#### Tool 规范

```typescript
import { defineTools } from '@nocobase/ai';
import type { Context } from '@nocobase/actions';

export default defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  definition: {
    name: 'feishuSendMessage',
    description: 'Send a Feishu message from the current Feishu app context.',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['receiveIdType', 'receiveId', 'content'],
      properties: {
        receiveIdType: { type: 'string', enum: ['open_id', 'user_id', 'union_id', 'chat_id'] },
        receiveId: { type: 'string' },
        content: { type: 'string' },
      },
    },
  },
  invoke: async (ctx: Context, args, runtime) => {
    const plugin = ctx.app.pm.get('feishu') as PluginFeishuServer;
    const feishuContext = ctx.state?.feishuContext ?? ctx.action?.params?.values?.feishuContext;
    return plugin.sendMessageFromTool(feishuContext, args);
  },
});
```

要求：

- 使用 `defineTools`。
- tool 名称用 camelCase，和当前仓库内置 tools 风格一致。
- `defaultPermission` 首期使用 `ASK`，出站发送类工具不默认 `ALLOW`。
- tool 只调用插件暴露的 service 方法，不直接 new SDK。
- 参数必须显式包含 `receiveIdType`，不能自动猜测。

#### Skill 规范

```markdown
---
scope: SPECIFIED
name: feishu-messaging
description: Send and inspect Feishu messages within the current Feishu app context
tools:
  - feishuSendMessage
  - feishuGetMessage
introduction:
  title: '{{t("ai.skills.feishuMessaging.title", { ns: "@nocobase/plugin-feishu" })}}'
  about: '{{t("ai.skills.feishuMessaging.about", { ns: "@nocobase/plugin-feishu" })}}'
---

You help users work with Feishu messages through the Feishu app bound to the current conversation.
```

### 7. 通知渠道

服务端 class 保持在 `src/server/notification/feishu-notification-channel.ts`：

```typescript
class FeishuNotificationChannel extends BaseNotificationChannel<FeishuNotificationMessage> {
  async send(params: {
    channel: ChannelOptions;
    message: FeishuNotificationMessage;
    receivers?: ReceiversOptions;
    transaction?: Transaction;
  }): Promise<{ message: FeishuNotificationMessage; status: 'success' | 'failure'; reason?: string }> {
    // 完整实现后：
    // 1. 从 channel.options.appId 获取 app
    // 2. 解析 receivers
    // 3. 调用 FeishuClientManager 发送
  }
}
```

首期只保留 class 和单元测试，不在通知管理器 UI 暴露不可用通道。完整实现时必须同时注册：

- server: `notificationServer.registerChannelType({ type: 'feishu', Channel: FeishuNotificationChannel })`
- client: `notificationClient.registerChannelType({ type: 'feishu', components: ... })`

如果 notification-manager 的客户端注册 API 仍只在 legacy client 下可用，则单独创建最小 `src/client/notification-channel.tsx` adapter。该 adapter 不被 `client-v2` import。

### 8. 客户端管理界面

使用 `src/client-v2`：

```typescript
class PluginFeishuClientV2 extends Plugin {
  async load() {
    this.pluginSettingsManager.addMenuItem({
      key: 'feishu',
      title: this.t('Feishu') as string,
      icon: 'MessageOutlined',
      aclSnippet: 'pm.feishu.settings',
    });

    this.pluginSettingsManager.addPageTabItem({
      menuKey: 'feishu',
      key: 'index',
      title: this.t('Apps') as string,
      componentLoader: () => import('./pages/FeishuAppsPage'),
    });
  }
}
```

页面：

| 页面 | 功能 |
|------|------|
| `FeishuAppsPage` | 应用列表、连接状态、启停、测试连接、编辑配置 |
| `FeishuCardRecordsPage` | 卡片发送记录只读列表 |
| `FeishuDiagnosticsPage` | WS 状态、队列长度、最近错误、去重命中 |

UI 要求：

- 使用 Ant Design v5。
- 表单 label、提示、按钮文案全部走 i18n。
- 密钥字段使用 Password 输入，列表中只显示脱敏值。
- 启停、测试连接、保存失败都显示明确错误原因。
- 按钮提供可访问的 aria-label。

---

## 数据模型

### `feishu_apps`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | integer | 主键 |
| `app_id` | string unique required | 飞书 App ID |
| `app_secret` | password required | 飞书 App Secret |
| `name` | string | 应用显示名称 |
| `status` | select (`active` / `disabled`) | 配置状态 |
| `encrypt_key` | password | 事件加密密钥 |
| `verification_token` | password | 事件验证令牌 |
| `bot_open_id` | string | 连接测试自动回填 |
| `bot_name` | string | 连接测试自动回填 |
| `ai_employee_username` | string | 绑定 AI 员工 username |
| `ai_act_as_user_id` | integer | AI 调用 NocoBase 能力时的身份 |
| `config_version` | integer | 配置变更版本，用于运行时 reload |
| `last_connected_at` | date | 最近连接成功时间 |
| `last_error` | text | 最近运行时错误摘要 |

### `feishu_message_logs`

| 字段 | 类型 | 说明 |
|------|------|------|
| `app_id` | string | 飞书应用 |
| `event_id` | string | 飞书事件 ID |
| `message_id` | string | 飞书消息 ID |
| `chat_id` | string | 会话 ID |
| `sender_open_id` | string | 发送人 |
| `message_type` | string | 飞书消息类型 |
| `route_action` | select (`ai` / `ignore`) | 路由结果 |
| `status` | select (`queued` / `processing` / `success` / `failure` / `ignored`) | 处理状态 |
| `ai_session_id` | string | AI 会话 ID |
| `error` | text | 错误摘要 |
| `created_at` | date | 创建时间 |

索引：

- `(app_id, event_id)` unique nullable
- `(app_id, message_id)`
- `(app_id, status, created_at)`

### `feishu_card_records`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | integer | 主键 |
| `app_id` | string | 飞书应用 |
| `message_id` | string | 飞书消息 ID |
| `open_message_id` | string | 飞书 open message ID |
| `card_template_key` | string | 模板溯源 |
| `card_schema_snapshot` | json | 发送时完整卡片 |
| `callback_config_snapshot` | json | 回调配置快照 |
| `context` | json | 业务上下文 |
| `created_by_id` | integer | 发送者用户 ID |

索引：

- `(app_id, message_id)` unique
- `(app_id, open_message_id)`

### `feishu_card_action_logs`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | integer | 主键 |
| `app_id` | string | 飞书应用 |
| `event_id` | string | 飞书回调事件 ID |
| `card_record_id` | integer | 关联卡片记录 |
| `message_id` | string | 飞书消息 ID |
| `action_key` | string | 操作元素 |
| `action_values` | json | 表单值 |
| `executor_open_id` | string | 操作者 open_id |
| `executor_user_id` | integer | 绑定后的 NocoBase 用户 ID，可空 |
| `result` | select (`success` / `failure` / `duplicate`) | 执行结果 |
| `result_detail` | json | 返回 toast、card update、错误摘要 |

索引：

- `(app_id, event_id)` unique
- `(card_record_id, action_key)`

### `feishu_user_bindings` P2

| 字段 | 类型 | 说明 |
|------|------|------|
| `app_id` | string | 飞书应用 |
| `open_id` | string | 飞书用户 open_id |
| `union_id` | string | 飞书 union_id |
| `user_id` | integer | NocoBase 用户 ID |
| `bound_at` | date | 绑定时间 |

### 迁移策略

新增 collections、字段、索引由 `yarn nocobase upgrade` 同步。后续对已发布字段做重命名、数据搬迁、兼容转换时，才增加 `src/server/migrations/`。

---

## API Actions

### `app-actions.ts`

| Action | 方法 | 说明 |
|--------|------|------|
| `feishuApps:testConnection` | POST | 校验凭证，回填 bot 信息 |
| `feishuApps:start` | POST | 启动指定 app WS |
| `feishuApps:stop` | POST | 停止指定 app WS |
| `feishuApps:reload` | POST | 重载指定 app |
| `feishuApps:runtimeOverview` | GET | 返回所有 app 运行时状态 |

### `message-actions.ts`

| Action | 方法 | 说明 |
|--------|------|------|
| `feishuMessages:send` | POST | 管理员调试发送 |
| `feishuMessages:reply` | POST | 管理员调试回复 |

### `diagnostics-actions.ts`

| Action | 方法 | 说明 |
|--------|------|------|
| `feishuDiagnostics:queue` | GET | 队列长度、失败数、最近错误 |
| `feishuDiagnostics:connections` | GET | WS 连接状态、重连次数 |

### ACL

```typescript
this.app.acl.registerSnippet({
  name: 'pm.feishu.settings',
  actions: [
    'feishu_apps:*',
    'feishuMessages:send',
    'feishuMessages:reply',
    'feishu_message_logs:list',
    'feishu_card_records:list',
    'feishu_card_action_logs:list',
    'feishuDiagnostics:*',
  ],
});
```

调试发送类 action 只放进插件设置权限片段，不直接开放给所有登录用户。普通飞书回复路径走 AI 会话上下文和 tool 权限控制。

---

## 错误处理与可观测性

### 日志事件

| 事件 | 说明 |
|------|------|
| `feishu.app.start` | app 运行时启动 |
| `feishu.app.stop` | app 运行时停止 |
| `feishu.ws.connected` | WS 连接成功 |
| `feishu.ws.reconnect` | WS 重连 |
| `feishu.message.queued` | 消息入队 |
| `feishu.message.ignored` | 消息被路由忽略 |
| `feishu.ai.invoke.start` | AI 调用开始 |
| `feishu.ai.invoke.error` | AI 调用失败 |
| `feishu.card.action.received` | 卡片回调收到 |
| `feishu.card.action.duplicate` | 卡片回调重复 |

日志必须带 `appId`、`eventId`、`messageId`（如果有），不能带密钥。

### 重试策略

| 错误类型 | 策略 |
|----------|------|
| 飞书 429 | 指数退避，保留 request id |
| 飞书 5xx / 网络错误 | 重试 |
| 飞书 4xx 凭证/权限错误 | 不重试，标记 app last_error |
| AI 员工不存在 | 不重试 |
| 消息解析失败 | 不重试 |

---

## 测试计划

| 测试文件 | 覆盖 |
|----------|------|
| `message-parser.test.ts` | text/post/image、群聊 @、不支持类型 |
| `message-router.test.ts` | 未绑定 AI、群聊未 @、私聊、群聊 @ |
| `message-dedup.test.ts` | 同 app 去重、跨 app 不互相影响 |
| `message-queue.test.ts` | 入队、失败重试、不重试错误 |
| `app-runtime-manager.test.ts` | start/stop/reload 串行、按 app 清理 |
| `card-action-router.test.ts` | 快照读取、action_key 匹配、unknown |
| `card-action-dedup.test.ts` | 重复 event_id 幂等 |
| `ai-bridge.test.ts` | actAsUser、无用户权限边界、feishuContext 注入 |
| `ai-loader.test.ts` | `src/ai` tools/skills 被核心 loader 扫描 |
| `notification-channel.test.ts` | P2 class 参数解析，不暴露未实现 UI |
| `client-v2/plugin.test.tsx` | 设置页注册、i18n、权限 snippet |

执行规则：

- 修改服务端后运行相关 `yarn test <server-test-file>`。
- 修改客户端后运行相关 client/v2 测试。
- 服务端测试不要并行运行。
- 报告完成前对触达文件执行 `yarn eslint --fix <files>`。

---

## 交付范围

| 模块 | 首期交付 | 后续迭代 |
|------|----------|----------|
| app-runtime | start/stop/reload/overview | 分布式租约增强 |
| feishu-client-manager | 消息发送、回复、更新、bot info | 更多飞书 API |
| ws-connection-manager | 消息事件、卡片事件 | 更细的重连策略 |
| message-parser/router/dedup | 完整实现 | 更多消息类型 |
| message-queue | 单 app 顺序处理、错误记录 | 可配置并发 |
| card-builder/records/actions | 基础卡片、快照、回调日志 | workflow/manual 节点 |
| ai-bridge | 文本对话、context 注入 | 流式卡片 |
| response-renderer | 文本 + 基础卡片 | Markdown post、流式 patch |
| src/ai tools | `feishuSendMessage`、`feishuGetMessage` | calendar/docs/contact 等 |
| src/ai skills | `feishu-messaging` | 更多技能组合 |
| notification-channel | class + 测试边界，不暴露 UI | 完整通知渠道 |
| client-v2 | 应用管理、卡片记录、诊断 | 通知模板配置、用户绑定 |

---

## 落地前检查清单

- `src/ai` 在 build 后进入 `dist/ai`。
- `plugin.ts` 不手写 AI loader。
- `client-v2` 不 import `@nocobase/client`。
- 如果保留 `src/client`，仅用于 legacy adapter，并写清楚原因。
- 所有出站发送路径都有 appId、权限、日志、错误处理。
- WS stop/reload 不会影响其他 app。
- 卡片回调使用 snapshot，不读当前模板。
- 重复消息和重复卡片事件都有幂等。
- 密钥字段不进入普通日志、诊断接口和列表响应。
- 新增用户可见字符串进入 i18n。
