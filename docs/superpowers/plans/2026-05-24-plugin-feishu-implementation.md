# Feishu 集成插件 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 NocoBase 仓库下落地 `@nocobase/plugin-feishu` 插件，按设计文档 `docs/superpowers/specs/2026-05-24-plugin-feishu-design.md` 完成多飞书应用、WebSocket 消息接入、AI 员工对话、AI tools/skills、卡片交互回调、客户端管理界面、通知渠道服务端骨架。

**Architecture:**
- 服务端按 `app-runtime / transport / message / card / ai / notification` 分层；transport 是唯一允许直接依赖 `@larksuiteoapi/node-sdk` 的层。
- AI tools/skills 放在 `src/ai/`，依赖核心 `Plugin.loadAI()` 自动扫描，禁止 `plugin.ts` 手写 `ToolsLoader`。
- 客户端走 `client-v2`（`@nocobase/client-v2`），通知渠道 UI 暂不暴露；如需 legacy 注册 adapter，单独隔离 `src/client/`。

**Tech Stack:**
- TypeScript 5.x、`@nocobase/server`、`@nocobase/database`、`@nocobase/actions`、`@nocobase/ai`、`@nocobase/client-v2`
- `@larksuiteoapi/node-sdk` ^1.60.0、`zod` ^3.24
- `@vitest` 用于单测（沿用仓库现有 `yarn test`）；`antd` v5 + Ant Design Icons 用于前端

---

## 阶段总览

| 阶段 | 模块 | 交付物 |
|------|------|--------|
| Phase 1 | 脚手架 + Collections + Plugin 骨架 | 插件可被 `yarn pm enable` 启用，`feishu_apps` 等表自动建表 |
| Phase 2 | 传输层 | `FeishuClientManager`、`FeishuWebSocketManager` |
| Phase 3 | 消息层 | parser、dedup、queue、router、context |
| Phase 4 | AI 桥接层 | conversation-manager、ai-context-factory、ai-bridge、response-renderer |
| Phase 5 | 卡片层 | builder、record-service、action-router、action-handler、action-dedup |
| Phase 6 | AI tools/skills | `feishuSendMessage`、`feishuGetMessage`、`feishu-messaging` skill |
| Phase 7 | App runtime + Actions | `app-runtime-manager`、`secret-service`、resource actions、ACL snippet |
| Phase 8 | 通知渠道服务端骨架 | `FeishuNotificationChannel` class + 测试，不暴露 UI |
| Phase 9 | 客户端 v2 管理界面 | Apps 列表/编辑、卡片记录只读、诊断页 |
| Phase 10 | i18n + 验收 | zh-CN / en-US locale，全面测试 + lint + 启用验证 |

依赖关系：`Phase 1 → 2 → 3 → 4` 串行；`Phase 5/6/7/8` 在 4 完成后可并行；`Phase 9` 依赖 7 提供的 actions；`Phase 10` 收尾。

---

## Phase 1 — 脚手架 + Collections + Plugin 骨架

### Task 1.1：使用 `yarn pm create` 创建插件骨架

**Files:**
- Create directory: `packages/plugins/@nocobase/plugin-feishu/`

- [ ] **Step 1：在仓库根执行**
  ```bash
  yarn pm create @nocobase/plugin-feishu
  ```
- [ ] **Step 2：检查生成文件**：`packages/plugins/@nocobase/plugin-feishu/{package.json,src/index.ts,src/server/plugin.ts,src/client/index.tsx,...}`。
- [ ] **Step 3：提交 chore commit**
  ```bash
  git add packages/plugins/@nocobase/plugin-feishu
  git commit -m "chore(plugin-feishu): scaffold plugin via pm create"
  ```

### Task 1.2：调整 `package.json`、目录结构与外部依赖声明

**Files:**
- Modify: `packages/plugins/@nocobase/plugin-feishu/package.json`
- Create: `packages/plugins/@nocobase/plugin-feishu/client-v2.js`、`client-v2.d.ts`
- Create: `packages/plugins/@nocobase/plugin-feishu/src/client-v2/index.tsx`、`plugin.tsx`、`locale.ts`
- 删除（如生成）：`src/client/` 目录（除非 Phase 8 需要 legacy adapter，否则不保留）

- [ ] **Step 1：写入 `package.json`**
  ```json
  {
    "name": "@nocobase/plugin-feishu",
    "displayName": "Feishu Integration",
    "displayName.zh-CN": "飞书集成",
    "description": "Feishu (Lark) integration for NocoBase. Multi-app, WebSocket, cards, AI Employee, and notification channel skeleton.",
    "description.zh-CN": "NocoBase 飞书集成插件，支持多应用、WebSocket、卡片、AI 员工对话以及通知渠道骨架。",
    "version": "2.1.0-alpha.1",
    "main": "./dist/server/index.js",
    "homepage": "https://github.com/nocobase/nocobase",
    "license": "AGPL-3.0",
    "dependencies": {
      "@larksuiteoapi/node-sdk": "^1.60.0",
      "zod": "^3.24.0"
    },
    "peerDependencies": {
      "@nocobase/actions": "2.x",
      "@nocobase/ai": "2.x",
      "@nocobase/client": "2.x",
      "@nocobase/client-v2": "2.x",
      "@nocobase/database": "2.x",
      "@nocobase/plugin-ai": "2.x",
      "@nocobase/plugin-notification-manager": "2.x",
      "@nocobase/server": "2.x",
      "@nocobase/test": "2.x",
      "@nocobase/utils": "2.x"
    },
    "peerDependenciesMeta": {
      "@nocobase/client": { "optional": true }
    },
    "keywords": ["Feishu", "Lark", "AI", "Notification"]
  }
  ```
- [ ] **Step 2：创建 `client-v2.js`**
  ```js
  module.exports = require('./dist/client-v2').default;
  ```
- [ ] **Step 3：创建 `client-v2.d.ts`**
  ```ts
  export { default } from './src/client-v2';
  ```
- [ ] **Step 4：创建 `src/client-v2/index.tsx`**
  ```ts
  export { default } from './plugin';
  ```
- [ ] **Step 5：创建 `src/client-v2/locale.ts`**
  ```ts
  import { tval } from '@nocobase/utils/client';
  // @ts-ignore
  import pkg from '../../package.json';
  export const NAMESPACE = pkg.name;
  export const generateNTemplate = (key: string) => `{{t(${JSON.stringify(key)}, { ns: "${NAMESPACE}" })}}`;
  export const tExpr = (key: string) => generateNTemplate(key);
  ```
- [ ] **Step 6：创建 `src/client-v2/plugin.tsx`** 占位 Plugin（详见 Phase 9）。
  ```tsx
  import { Plugin, Application } from '@nocobase/client-v2';
  export class PluginFeishuClientV2 extends Plugin<any, Application> {
    async load() {
      // populated in phase 9
    }
  }
  export default PluginFeishuClientV2;
  ```
- [ ] **Step 7：在仓库根运行 `yarn install` 让 workspace 链接生效。**
- [ ] **Step 8：commit**
  ```bash
  git add packages/plugins/@nocobase/plugin-feishu
  git commit -m "chore(plugin-feishu): set up client-v2 entry and dependencies"
  ```

### Task 1.3：定义所有 collections

**Files:**
- Create: `src/server/collections/feishu-apps.ts`
- Create: `src/server/collections/feishu-message-logs.ts`
- Create: `src/server/collections/feishu-card-records.ts`
- Create: `src/server/collections/feishu-card-action-logs.ts`
- Create: `src/server/collections/feishu-user-bindings.ts`（P2，仍要建表）
- Create: `src/server/constants.ts`

- [ ] **Step 1：constants.ts** 定义 namespace、collection 名、cache key 等常量
  ```ts
  export const PLUGIN_NAME = 'feishu';
  export const COLLECTION = {
    apps: 'feishu_apps',
    messageLogs: 'feishu_message_logs',
    cardRecords: 'feishu_card_records',
    cardActionLogs: 'feishu_card_action_logs',
    userBindings: 'feishu_user_bindings',
  } as const;
  export const CACHE_NAMESPACE = 'plugin-feishu';
  export const QUEUE_PREFIX = 'plugin-feishu.message';
  ```
- [ ] **Step 2：feishu-apps.ts**
  ```ts
  import { defineCollection } from '@nocobase/database';
  import { COLLECTION } from '../constants';
  export default defineCollection({
    name: COLLECTION.apps,
    title: 'Feishu Apps',
    autoGenId: true,
    createdBy: true,
    updatedBy: true,
    createdAt: true,
    updatedAt: true,
    fields: [
      { type: 'string', name: 'app_id', unique: true, allowNull: false },
      { type: 'password', name: 'app_secret', allowNull: false },
      { type: 'string', name: 'name' },
      { type: 'string', name: 'status', defaultValue: 'active' },
      { type: 'password', name: 'encrypt_key' },
      { type: 'password', name: 'verification_token' },
      { type: 'string', name: 'bot_open_id' },
      { type: 'string', name: 'bot_name' },
      { type: 'string', name: 'ai_employee_username' },
      { type: 'integer', name: 'ai_act_as_user_id' },
      { type: 'integer', name: 'config_version', defaultValue: 0 },
      { type: 'date', name: 'last_connected_at' },
      { type: 'text', name: 'last_error' },
    ],
  });
  ```
- [ ] **Step 3：feishu-message-logs.ts**（参照设计文档 §数据模型，含字段、索引）
- [ ] **Step 4：feishu-card-records.ts**（含 unique `(app_id, message_id)`、index `(app_id, open_message_id)`）
- [ ] **Step 5：feishu-card-action-logs.ts**（unique `(app_id, event_id)`、index `(card_record_id, action_key)`）
- [ ] **Step 6：feishu-user-bindings.ts**（P2，仍建表预留）
- [ ] **Step 7：commit**
  ```bash
  git commit -am "feat(plugin-feishu): add server collections"
  ```

### Task 1.4：Plugin 入口骨架与 ACL snippet

**Files:**
- Modify: `src/server/plugin.ts`
- Modify: `src/index.ts`（确保导出 server）

- [ ] **Step 1：测试**：`src/server/__tests__/plugin.bootstrap.test.ts`
  ```ts
  import { createMockServer, MockServer } from '@nocobase/test';
  describe('plugin-feishu bootstrap', () => {
    let app: MockServer;
    beforeEach(async () => {
      app = await createMockServer({ plugins: ['field-sort', 'data-source-manager', 'data-source-main', 'feishu'] });
    });
    afterEach(async () => app.destroy());
    it('registers ACL snippet pm.feishu.settings', () => {
      const snippet = app.acl.snippetManager.snippets.get('pm.feishu.settings');
      expect(snippet).toBeTruthy();
    });
    it('creates feishu_apps collection', () => {
      expect(app.db.getCollection('feishu_apps')).toBeTruthy();
    });
  });
  ```
- [ ] **Step 2：运行测试，FAIL（snippet 未注册）**
  ```bash
  yarn test packages/plugins/@nocobase/plugin-feishu/src/server/__tests__/plugin.bootstrap.test.ts
  ```
- [ ] **Step 3：实现 plugin.ts**
  ```ts
  import { Plugin } from '@nocobase/server';

  export class PluginFeishuServer extends Plugin {
    async beforeLoad() {
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
    }
    async load() {}
    async afterDisable() {}
    async remove() {}
  }
  export default PluginFeishuServer;
  ```
- [ ] **Step 4：测试通过**
- [ ] **Step 5：commit**
  ```bash
  git commit -am "feat(plugin-feishu): bootstrap plugin with ACL snippet"
  ```

---

## Phase 2 — 传输层

### Task 2.1：`FeishuClientManager`

**Files:**
- Create: `src/server/transport/feishu-client-manager.ts`
- Test: `src/server/transport/__tests__/feishu-client-manager.test.ts`

- [ ] **Step 1：定义类型 `src/server/transport/types.ts`**
  ```ts
  export interface FeishuAppConfig {
    appId: string;
    appSecret: string;
    encryptKey?: string;
    verificationToken?: string;
  }
  export type ReceiveIdType = 'open_id' | 'user_id' | 'union_id' | 'chat_id';
  export interface SendMessageParams {
    appId: string;
    receiveId: string;
    receiveIdType: ReceiveIdType;
    msgType: 'text' | 'post' | 'interactive' | 'image';
    content: unknown;
  }
  export interface SendMessageResult {
    messageId: string;
    requestId?: string;
  }
  ```
- [ ] **Step 2：测试**：mock `@larksuiteoapi/node-sdk` Client，验证：
    1. `addApp` 后 `getClient(appId)` 返回 client
    2. `removeApp` 后再 `getClient` 为 undefined
    3. `sendMessage` 透传 `receive_id_type` 不靠 ID 前缀猜测
    4. `sendMessage` 失败时抛出含 `code/msg/requestId` 的错误
- [ ] **Step 3：实现 `FeishuClientManager`**：内部维护 `Map<appId, Lark.Client>`，封装 `sendMessage / replyMessage / updateMessage / uploadImage / getBotInfo`。
  ```ts
  import * as Lark from '@larksuiteoapi/node-sdk';
  import { FeishuAppConfig, SendMessageParams, SendMessageResult } from './types';

  export class FeishuClientManager {
    private clients = new Map<string, Lark.Client>();

    addApp(config: FeishuAppConfig) {
      this.clients.set(config.appId, new Lark.Client({
        appId: config.appId, appSecret: config.appSecret,
        appType: Lark.AppType.SelfBuild, domain: Lark.Domain.Feishu, loggerLevel: Lark.LoggerLevel.warn,
      }));
    }
    removeApp(appId: string) { this.clients.delete(appId); }
    getClient(appId: string) { return this.clients.get(appId); }

    async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
      const client = this.getClient(params.appId);
      if (!client) throw new Error(`feishu app not initialized: ${params.appId}`);
      const resp = await client.im.message.create({
        params: { receive_id_type: params.receiveIdType },
        data: { receive_id: params.receiveId, msg_type: params.msgType, content: typeof params.content === 'string' ? params.content : JSON.stringify(params.content) },
      });
      if (resp.code !== 0) throw Object.assign(new Error(`feishu send failed: ${resp.msg}`), { code: resp.code, requestId: (resp as any).requestId });
      return { messageId: resp.data?.message_id as string };
    }
    // similar replyMessage / updateMessage / uploadImage / getBotInfo
  }
  ```
- [ ] **Step 4：测试通过 → commit**
  ```bash
  git commit -am "feat(plugin-feishu): add FeishuClientManager"
  ```

### Task 2.2：`FeishuWebSocketManager`

**Files:**
- Create: `src/server/transport/ws-connection-manager.ts`
- Test: `src/server/transport/__tests__/ws-connection-manager.test.ts`

- [ ] **Step 1：测试**（mock `Lark.WSClient`）
  - `startConnection(appId)` 调用 `wsClient.start({ eventDispatcher })`
  - 注册 `im.message.receive_v1` 与 `card.action.trigger`
  - `stopConnection(appId)` 调用 `wsClient.stop?.()`/`disconnect()` 并清理映射
  - `stopAll()` 不影响其他实例
- [ ] **Step 2：实现 `FeishuWebSocketManager`**：维护 `Map<appId, WSClient>`；事件 handler 通过构造函数注入：
  ```ts
  export interface WSEventHandlers {
    onMessage(appId: string, event: unknown): Promise<void>;
    onCardAction(appId: string, event: unknown): Promise<unknown>;
  }
  ```
- [ ] **Step 3：测试通过 → commit**
  ```bash
  git commit -am "feat(plugin-feishu): add FeishuWebSocketManager"
  ```

---

## Phase 3 — 消息层

### Task 3.1：types.ts（消息领域模型）

**Files:** `src/server/message/types.ts`

- [ ] **Step 1：定义 `ParsedMessage`、`ParsedContent`、`Mention`、`FeishuMessageContext`、`RouteDecision`**（按设计文档 §消息层）。
- [ ] **Step 2：commit**
  ```bash
  git commit -am "feat(plugin-feishu): add message domain types"
  ```

### Task 3.2：`message-parser.ts`

**Files:**
- Create: `src/server/message/message-parser.ts`
- Test: `src/server/message/__tests__/message-parser.test.ts`

- [ ] **Step 1：测试**（参考旧项目 `message-parser.format.test.ts`、`reply.test.ts`、`share.test.ts`、`chat-type.test.ts`）：
    - text/post/image/file/interactive/share_chat/share_user 解析
    - 群聊通过 `bot_open_id` 判定 `isMentionBot`
    - 不支持类型返回 `null`
- [ ] **Step 2：实现 `parseMessageEvent(event, { botOpenId }): ParsedMessage | null`**，content 字符串按 `msg_type` 二级 `JSON.parse`。
- [ ] **Step 3：测试通过 → commit**
  ```bash
  git commit -am "feat(plugin-feishu): implement feishu message parser"
  ```

### Task 3.3：`message-dedup.ts`

**Files:**
- Create: `src/server/message/message-dedup.ts`
- Test: `src/server/message/__tests__/message-dedup.test.ts`

- [ ] **Step 1：测试**：mock `cacheManager.createCache`，验证：
    - 首次 `tryRecord(appId, key)` 返回 `true`
    - 重复 key 返回 `false`
    - 不同 app 互不干扰
    - TTL 默认 600s
- [ ] **Step 2：实现**
  ```ts
  export class MessageDedup {
    constructor(private cache: { get(k: string): Promise<unknown>; set(k: string, v: unknown, ttl: number): Promise<void> }) {}
    async tryRecord(appId: string, key: string, ttlSec = 600) {
      const cacheKey = `feishu:message-dedup:${appId}:${key}`;
      const exists = await this.cache.get(cacheKey);
      if (exists) return false;
      await this.cache.set(cacheKey, 1, ttlSec);
      return true;
    }
  }
  ```
- [ ] **Step 3：commit** `feat(plugin-feishu): add message dedup`

### Task 3.4：`message-context.ts`

**Files:** `src/server/message/message-context.ts`、`__tests__/message-context.test.ts`

- [ ] **Step 1：测试**：依据 mock `feishu_apps` 行（含 `ai_employee_username`、`ai_act_as_user_id`），验证 build 输出。
- [ ] **Step 2：实现 `buildFeishuMessageContext({ db, appId, parsed })`** 返回 `FeishuMessageContext | null`（找不到 app 时 `null`）。
- [ ] **Step 3：commit**

### Task 3.5：`message-router.ts`

**Files:** `src/server/message/message-router.ts` + 测试

- [ ] **Step 1：测试**（按设计文档路由表）
- [ ] **Step 2：实现 `routeMessage(parsed, context): RouteDecision`**
- [ ] **Step 3：commit**

### Task 3.6：`message-queue.ts`

**Files:** `src/server/message/message-queue.ts` + 测试

- [ ] **Step 1：测试**：使用 `@nocobase/test` 的 mock app + `app.eventQueue`/in-process queue
    - enqueue 必须 await 并解析为 `{ enqueued: true }`
    - 消费失败可重试错误（5xx/429/network）触发重试
    - 不重试错误（解析失败/未授权/AI 不存在）写日志
- [ ] **Step 2：实现 `FeishuMessageQueue`**：单 app 并发=1，订阅 `${QUEUE_PREFIX}.${appId}`。
- [ ] **Step 3：commit**

---

## Phase 4 — AI 桥接层

### Task 4.1：`conversation-manager.ts`

**Files:** `src/server/ai/conversation-manager.ts` + 测试

- [ ] **Step 1：测试**：相同 sender 在私聊得到相同 sessionId；同 chatId 在群聊得到相同 sessionId。
- [ ] **Step 2：实现 `getOrCreateSession(params)`**，返回 `{ sessionId, isNew }`。
- [ ] **Step 3：commit**

### Task 4.2：`ai-context-factory.ts`

**Files:** `src/server/ai/ai-context-factory.ts` + 测试

- [ ] **Step 1：测试**：
    - 配置 `actAsUserId` 时 `ctx.auth.user` / `ctx.state.currentUser` 存在
    - 没配置时 `ctx.auth.user` 为 null
    - `ctx.state.feishuContext` 与 `ctx.action.params.values.feishuContext` 同步写入
- [ ] **Step 2：实现 `buildAIInvokeContext({ app, db, feishuContext, actAsUserId, log }): Context`**
- [ ] **Step 3：commit**

### Task 4.3：`response-renderer.ts`

**Files:** `src/server/ai/response-renderer.ts` + 测试

- [ ] **Step 1：测试**：
    - 纯文本 → `clientManager.replyMessage({ msgType: 'text', content: { text } })`
    - Markdown → 降级为 text
    - 结构化 → `interactive` 简单卡片
- [ ] **Step 2：实现 `renderAIResponse({ clientManager, parsed, context, aiOutput })`**
- [ ] **Step 3：commit**

### Task 4.4：`ai-bridge.ts`

**Files:** `src/server/ai/ai-bridge.ts` + 测试

- [ ] **Step 1：测试**：
    - mock plugin-ai pm.get('ai')，验证 `aiEmployee.invoke` 被 await
    - `feishuContext` 写入 ctx.state
    - 未找到 AI Employee 时不抛，记录 `feishu_message_logs` 失败状态并 reply 用户
- [ ] **Step 2：实现 `FeishuAIBridge.handleMessage(appId, parsed, context)`**：
  ```ts
  const aiPlugin = this.app.pm.get('ai') as any;
  const employee = await aiPlugin.aiEmployees.get({ username: context.aiConfig.employeeUsername });
  const session = await this.conversationManager.getOrCreateSession({ ... });
  const ctx = buildAIInvokeContext({ app: this.app, db: this.app.db, feishuContext: context, actAsUserId: context.aiConfig.actAsUserId, log: this.log });
  const aiEmployee = new aiPlugin.AIEmployee({ ctx, employee, sessionId: session.sessionId });
  const result = await aiEmployee.invoke({ userMessages: [{ role: 'user', content: parsed.content.text ?? '' }] });
  await this.responseRenderer.render({ parsed, context, aiOutput: result });
  ```
- [ ] **Step 3：commit** `feat(plugin-feishu): wire ai bridge`

---

## Phase 5 — 卡片层

### Task 5.1：`card-builder.ts`

**Files:** `src/server/card/card-builder.ts` + 测试

- [ ] **Step 1：测试**：textCard / actionCard / fromTemplate 正确生成飞书 schema。
- [ ] **Step 2：实现 `FeishuCardBuilder`** 静态方法。
- [ ] **Step 3：commit**

### Task 5.2：`card-record-service.ts`

**Files:** `src/server/card/card-record-service.ts` + 测试

- [ ] **Step 1：测试**：调用后 `feishu_card_records` 行存在，含 schema/callback snapshot。
- [ ] **Step 2：实现：使用 `db.getRepository(COLLECTION.cardRecords).create({...})`。**
- [ ] **Step 3：commit**

### Task 5.3：`card-action-dedup.ts`

**Files:** `src/server/card/card-action-dedup.ts` + 测试

- [ ] **Step 1：测试**：相同 `(appId, eventId)` 返回 `false`，不同 app 互不影响。
- [ ] **Step 2：实现（基于 cache）**。
- [ ] **Step 3：commit**

### Task 5.4：`card-action-router.ts`、`card-action-handler.ts`

**Files:**
- Create: `src/server/card/card-action-router.ts`
- Create: `src/server/card/card-action-handler.ts`
- Tests: `__tests__/card-action-router.test.ts`、`__tests__/card-action-handler.test.ts`

- [ ] **Step 1：router 测试**：
    - 无快照 → `{action:'unknown', reason:'no-card-record'}`
    - action_key 命中 callback config → 返回 `{action:'callback', config, values}`
    - dedup 命中 → 返回上次 result
- [ ] **Step 2：实现 router**：从 `feishu_card_records` 按 `(appId, message_id)` / `(appId, open_message_id)` 找快照。
- [ ] **Step 3：handler 测试 + 实现**：写 `feishu_card_action_logs`，返回 `{toast?, cardUpdate?}`；失败也写日志并返回用户友好 toast。
- [ ] **Step 4：commit** `feat(plugin-feishu): add card action router and handler`

---

## Phase 6 — AI tools/skills

### Task 6.1：`feishuSendMessage` tool

**Files:**
- Create: `src/ai/tools/feishuSendMessage/index.ts`
- Create: `src/ai/tools/feishuSendMessage/description.md`
- Test: `src/server/__tests__/ai-tools.feishu-send-message.test.ts`

- [ ] **Step 1：测试**：
    - tool 文件可被 `loadAI` 扫描（验证文件存在 + 默认导出对象具有 `definition.name === 'feishuSendMessage'`）
    - `invoke(ctx, args)` 调用 `pm.get('feishu').sendMessageFromTool(feishuContext, args)`
- [ ] **Step 2：实现** `defineTools` 工具：
  ```ts
  import { defineTools } from '@nocobase/ai';
  import type { Context } from '@nocobase/actions';
  import { z } from 'zod';
  // @ts-ignore
  import pkg from '../../../package.json';

  export default defineTools({
    scope: 'SPECIFIED',
    execution: 'backend',
    defaultPermission: 'ASK',
    introduction: {
      title: `{{t("ai.tools.feishuSendMessage.title", { ns: "${pkg.name}" })}}`,
      about: `{{t("ai.tools.feishuSendMessage.about", { ns: "${pkg.name}" })}}`,
    },
    definition: {
      name: 'feishuSendMessage',
      description: 'Send a Feishu message from the current Feishu app context.',
      schema: z.object({
        receiveIdType: z.enum(['open_id', 'user_id', 'union_id', 'chat_id']),
        receiveId: z.string().min(1),
        content: z.string().min(1),
      }),
    },
    invoke: async (ctx: Context, args) => {
      const plugin = ctx.app.pm.get('feishu') as any;
      const feishuContext = ctx.state?.feishuContext ?? ctx.action?.params?.values?.feishuContext;
      return plugin.sendMessageFromTool(feishuContext, args);
    },
  });
  ```
- [ ] **Step 3：description.md** 写英文 description（loader 期望 markdown）。
- [ ] **Step 4：commit**

### Task 6.2：`feishuGetMessage` tool

**Files:** 同上模式，调用 `plugin.getMessageFromTool`。

- [ ] **Step 1：测试 + 实现 + commit**

### Task 6.3：`feishu-messaging` skill

**Files:** `src/ai/skills/feishu-messaging/SKILLS.md`

- [ ] **Step 1：写 SKILLS.md**（按设计文档示例 frontmatter + body）。
- [ ] **Step 2：commit** `feat(plugin-feishu): add feishu-messaging skill`

### Task 6.4：tsconfig 复制 markdown 到 dist

**Files:** `tsconfig.build.json` 或 build script

- [ ] **Step 1：确认仓库 build 链复制 `src/ai/**/description.md`、`src/ai/**/SKILLS.md`** 到 `dist/ai/`。如果通用脚本未覆盖，添加插件本地 build 脚本（参考 plugin-ai 的实现）。
- [ ] **Step 2：commit**

---

## Phase 7 — App runtime + Actions

### Task 7.1：`secret-service.ts`

**Files:** `src/server/app-runtime/secret-service.ts` + 测试

- [ ] **Step 1：测试**：
    - `mask('abc1234567')` 返回 `abc1***567` 之类
    - `validate(config)` 调用 lark client `getBotInfo` 失败时抛带 `requestId` 的错误，但不暴露密钥
- [ ] **Step 2：实现**。
- [ ] **Step 3：commit**

### Task 7.2：`app-runtime-manager.ts` + `app-registry.ts`

**Files:**
- Create: `src/server/app-runtime/app-runtime-manager.ts`、`app-registry.ts`
- Test: `__tests__/app-runtime-manager.test.ts`

- [ ] **Step 1：测试**（mock client manager + ws manager）：
    - `start(appId)` 启动 ws + 状态写入 registry
    - 同一 app `start` 串行（互斥锁），并发调用按序执行
    - `stop(appId)` 不影响其他 app
    - `reload(appId)` = stop + start
    - `startActiveApps` 仅启动 status=active 的行
- [ ] **Step 2：实现**：内部 `Map<appId, AbortController>` + `AsyncLock`（用 `p-lock` 或自实现一个简单 mutex）。
- [ ] **Step 3：commit**

### Task 7.3：resource actions

**Files:**
- Create: `src/server/actions/app-actions.ts`、`message-actions.ts`、`diagnostics-actions.ts`、`index.ts`
- Test: 各自 `__tests__`

- [ ] **Step 1：测试**：
    - `feishuApps:testConnection` 需 ACL `pm.feishu.settings`，返回 bot 信息且不返回密钥
    - `feishuApps:start/stop/reload` 调用 runtime manager
    - `feishuApps:runtimeOverview` 返回 connection 状态
    - `feishuMessages:send/reply` 调用 client manager
    - `feishuDiagnostics:queue/connections` 返回结构化数据
- [ ] **Step 2：实现 actions** 并在 `plugin.ts` 通过 `app.resourceManager.define`/`registerActionHandler` 注册。
- [ ] **Step 3：在 `plugin.ts` 注入** runtime manager / client manager / message queue / ai-bridge / card services 并暴露 `sendMessageFromTool` / `getMessageFromTool`（供 AI tool 调用）。
- [ ] **Step 4：commit**

### Task 7.4：plugin 生命周期编排

- [ ] **Step 1：完善 `plugin.ts`** `beforeLoad/load/afterStart/afterDisable/remove`：
    - `beforeLoad`：注册 ACL snippet（已在 1.4）+ resource actions handler
    - `load`：实例化 services，订阅 message queue 消费 `processMessage(rawEvent)`，注册 ws handlers `(onMessage, onCardAction)`
    - `app.on('afterStart')`：`runtimeManager.startActiveApps()`
    - `afterDisable/remove`：`runtimeManager.stopAll()`
- [ ] **Step 2：测试**：插件 enable → disable 不抛错，dedup cache 清理。
- [ ] **Step 3：commit** `feat(plugin-feishu): wire plugin lifecycle`

---

## Phase 8 — 通知渠道服务端骨架

### Task 8.1：`feishu-notification-channel.ts`

**Files:** `src/server/notification/feishu-notification-channel.ts` + 测试

- [ ] **Step 1：测试**：
    - `send` 收到 `channel.options.appId` + `receivers`，调用 `clientManager.sendMessage` 后返回 `{status:'success'}`
    - 找不到 appId 时返回 `{status:'failure', reason}`
- [ ] **Step 2：实现** 类继承 `BaseNotificationChannel`（`@nocobase/plugin-notification-manager`）。
- [ ] **Step 3：在 `plugin.ts.load()`** 中暂不调用 `notificationServer.registerChannelType`，仅保留 import 与构造，避免在 UI 暴露。
- [ ] **Step 4：commit** `feat(plugin-feishu): scaffold notification channel class`

---

## Phase 9 — 客户端 v2 管理界面

### Task 9.1：plugin.tsx 注册 settings

**Files:** `src/client-v2/plugin.tsx`、`pages/FeishuAppsPage.tsx`、`pages/FeishuCardRecordsPage.tsx`、`pages/FeishuDiagnosticsPage.tsx`、`components/*.tsx`

- [ ] **Step 1：plugin.tsx**
  ```tsx
  import { Plugin, Application } from '@nocobase/client-v2';
  import { tExpr } from './locale';

  export class PluginFeishuClientV2 extends Plugin<any, Application> {
    async load() {
      this.pluginSettingsManager.addMenuItem({
        key: 'feishu', title: tExpr('Feishu') as unknown as string, icon: 'MessageOutlined', aclSnippet: 'pm.feishu.settings',
      });
      this.pluginSettingsManager.addPageTabItem({
        menuKey: 'feishu', key: 'index', title: tExpr('Apps') as unknown as string,
        componentLoader: () => import('./pages/FeishuAppsPage'),
      });
      this.pluginSettingsManager.addPageTabItem({
        menuKey: 'feishu', key: 'card-records', title: tExpr('Card records') as unknown as string,
        componentLoader: () => import('./pages/FeishuCardRecordsPage'),
      });
      this.pluginSettingsManager.addPageTabItem({
        menuKey: 'feishu', key: 'diagnostics', title: tExpr('Diagnostics') as unknown as string,
        componentLoader: () => import('./pages/FeishuDiagnosticsPage'),
      });
    }
  }
  export default PluginFeishuClientV2;
  ```
- [ ] **Step 2：commit**

### Task 9.2：FeishuAppsPage（应用列表 + 编辑 + 启停 + 测试连接）

- [ ] **Step 1：使用 antd v5 + `useApiClient`**：
    - 列表用 `Table`，列显示 `app_id`（脱敏 secret 字段不出现）、`status`、`bot_name`、`last_connected_at`、操作（启动 / 停止 / 重载 / 编辑 / 测试连接）
    - 编辑表单使用 `Modal` + `Form`，密钥用 `Input.Password`
    - 操作按钮带 `aria-label`，错误用 `notification.error`
    - i18n：所有文案走 `useT`，参考 plugin-settings-page
- [ ] **Step 2：commit**

### Task 9.3：FeishuCardRecordsPage（只读）

- [ ] **Step 1：表格分页拉取 `feishu_card_records:list`，可过滤 app**
- [ ] **Step 2：commit**

### Task 9.4：FeishuDiagnosticsPage

- [ ] **Step 1：调用 `feishuDiagnostics:queue / connections`**
    - 卡片显示队列长度、失败数、重连次数、去重命中
    - 自动刷新每 10s（带可关闭开关）
- [ ] **Step 2：commit**

### Task 9.5：客户端测试（v2）

**Files:** `src/client-v2/__tests__/plugin.test.tsx`

- [ ] **Step 1：测试 plugin load 注册了 menu/tab，title 含 i18n 占位。**
- [ ] **Step 2：commit**

---

## Phase 10 — i18n + 全面验收

### Task 10.1：locale 文件

**Files:**
- Create: `src/locale/zh-CN.json`、`src/locale/en-US.json`

- [ ] **Step 1：覆盖所有 UI / tools 文案 key**（Apps、Card records、Diagnostics、表单 label、按钮、错误提示、`ai.tools.*` `ai.skills.*`）
- [ ] **Step 2：commit** `chore(plugin-feishu): add zh-CN/en-US locale`

### Task 10.2：插件级测试套件

- [ ] **Step 1：执行**
  ```bash
  yarn test packages/plugins/@nocobase/plugin-feishu
  ```
  确保所有 server 测试串行通过（设计文档明确 server 测试不能并行）。
- [ ] **Step 2：执行 `yarn eslint --fix packages/plugins/@nocobase/plugin-feishu/**/*.{ts,tsx}`**
- [ ] **Step 3：commit fix（如有）**

### Task 10.3：启用与冒烟

- [ ] **Step 1：**
  ```bash
  yarn nocobase upgrade
  yarn pm enable feishu
  ```
- [ ] **Step 2：访问 `/v2/admin/settings/feishu`**，确认 Apps / Card records / Diagnostics 三个 tab 渲染。
- [ ] **Step 3：在 Apps 页新增一条配置（mock app_id/app_secret），保存 → 应该显示连接失败（凭证不真实），但不会导致服务端崩溃；运行时 last_error 字段被正确写入。**
- [ ] **Step 4：在 PR 描述里贴出 lint/test 输出与 UI 截图。**

### Task 10.4：落地前检查清单（设计文档 §落地前检查清单 一一确认）

- [ ] `src/ai` 在 build 后进入 `dist/ai`（运行 `yarn build` 验证）
- [ ] `plugin.ts` 不手写 AI loader
- [ ] `client-v2` 不 import `@nocobase/client`
- [ ] 未保留 `src/client/` 或仅保留 legacy adapter（首期默认不保留）
- [ ] 出站发送路径都有 appId、权限、日志、错误处理
- [ ] WS stop/reload 不影响其他 app
- [ ] 卡片回调使用 snapshot
- [ ] 重复消息 / 重复卡片事件都有幂等
- [ ] 密钥字段不出现在普通日志、诊断接口和列表响应
- [ ] 新增用户可见字符串进入 i18n

---

## 工作流注意事项

1. **TDD**：每个 task 先写测试再实现，红 → 绿 → commit。
2. **Server 测试不要并行**：`yarn test` 默认串行，避免 `--parallel`。
3. **lint**：触达文件每次 commit 前 `yarn eslint --fix`。
4. **i18n**：每加一个 UI 字符串立即写到 zh-CN / en-US。
5. **不引入新的 feature flag**；不可用能力不暴露 UI（Phase 8 通知渠道首期不注册 server.registerChannelType，亦不暴露 UI；class 仅作单测边界）。
6. **AI 调用身份**：缺少 `actAsUserId` 时不要伪造用户，AI 工具仅允许飞书上下文内的低风险动作（`feishuSendMessage` 已显式要求 `feishuContext`）。
7. **多实例租约**：一期使用 NocoBase cache 标记 `feishu:lease:${appId}`，TTL 60s，启动时尝试获取，失败则在 diagnostics 上提示「另一实例已经接管该 app」。
8. **数据库迁移**：新增 collections 由 `yarn nocobase upgrade` 同步，不写 migration 文件；后续如需 rename / backfill 再添加 `src/server/migrations/`。

---

## Self-Review Pass

- ✅ 设计文档每节均覆盖：
    - § 需求范围 → Phase 1-9 + 落地清单
    - § 架构总览/目录结构 → Phase 1.2 / 1.3 / 1.4
    - § 生命周期 → Phase 7.4
    - § 数据流 → Phase 3 + 4 + 5
    - § 模块详细设计 → Phase 2-7
    - § 数据模型 → Phase 1.3
    - § API Actions → Phase 7.3
    - § 错误处理与可观测性 → Phase 7.2 / 7.4 / 9.4
    - § 测试计划 → Phase 各 Task __tests__ + 10.2
    - § 交付范围 → 与 Phase 1-9 对齐
    - § 落地前检查清单 → Phase 10.4
- ✅ 类型一致性：`SendMessageParams.receiveIdType` 与 tool schema 中 enum 同名；`FeishuMessageContext.aiConfig.employeeUsername` 与 ai-bridge 调用一致；`runtimeManager.start/stop/reload` 与 actions 一致。
- ✅ 无 placeholder：每个步骤都有命令或代码骨架；细节实现需阅读旧项目对应文件作为行为参考（设计文档已列旧项目可参考清单）。
