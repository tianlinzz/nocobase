/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { Plugin } from '@nocobase/server';
import { AIEmployee } from '@nocobase/plugin-ai';
import { CACHE_NAMESPACE, COLLECTION } from './constants';

/**
 * Field names on `feishu_apps` whose values are AES-encrypted at rest.
 * Centralised so the encryption hook, the decryption helper and the list
 * sanitiser stay in lock-step.
 */
const SECRET_FIELDS = ['app_secret', 'encrypt_key', 'verification_token'] as const;
type SecretField = (typeof SECRET_FIELDS)[number];
import { FeishuClientManager } from './transport/feishu-client-manager';
import { FeishuWebSocketManager } from './transport/ws-connection-manager';
import { ReceiveIdType } from './transport/types';
import { AppRegistry } from './app-runtime/app-registry';
import { FeishuAppRuntimeManager } from './app-runtime/app-runtime-manager';
import { SecretService } from './app-runtime/secret-service';
import { MessageDedup } from './message/message-dedup';
import { CardActionDedup } from './card/card-action-dedup';
import { CardRecordService } from './card/card-record-service';
import { CardActionRouter } from './card/card-action-router';
import { CardActionHandler } from './card/card-action-handler';
import { FeishuConversationManager } from './ai/conversation-manager';
import { FeishuResponseRenderer } from './ai/response-renderer';
import { AIBridgeContextFactory, AIEmployeeConstructor, FeishuAIBridge, MessageLogRecordParams } from './ai/ai-bridge';
import { FeishuMessageQueue } from './message/message-queue';
import { parseMessageEvent } from './message/message-parser';
import { buildFeishuMessageContext } from './message/message-context';
import { routeMessage } from './message/message-router';
import { buildAIInvokeContext } from './ai/ai-context-factory';
import { registerAppActions } from './actions/app-actions';
import { registerMessageActions } from './actions/message-actions';
import { registerDiagnosticsActions } from './actions/diagnostics-actions';

interface FeishuServices {
  clientManager: FeishuClientManager;
  wsManager: FeishuWebSocketManager;
  appRegistry: AppRegistry;
  runtimeManager: FeishuAppRuntimeManager;
  secretService: SecretService;
  messageDedup: MessageDedup;
  cardActionDedup: CardActionDedup;
  cardRecordService: CardRecordService;
  cardActionRouter: CardActionRouter;
  cardActionHandler: CardActionHandler;
  conversationManager: FeishuConversationManager;
  responseRenderer: FeishuResponseRenderer;
  aiBridge: FeishuAIBridge;
  messageQueue: FeishuMessageQueue;
}

interface ToolFeishuContext {
  appId: string;
}

interface SendMessageToolArgs {
  receiveId: string;
  receiveIdType: ReceiveIdType;
  content: string;
}

interface GetMessageToolArgs {
  messageId: string;
}

interface ToolResult {
  status: 'success' | 'failure';
  content: string;
}

// Card-trigger event payloads from the Lark SDK are heterogeneous; the
// concrete shape is documented at
// https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/card-event-callback
// We touch only a few fields, so a single narrow `any` cast is preferable to
// duplicating the SDK types here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CardTriggerEvent = any;

// Same rationale for incoming `im.message.receive_v1` events.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawMessageEvent = any;

export class PluginFeishuServer extends Plugin {
  private services!: FeishuServices;

  /** Service handle for the AI tool adapter — exposed via `ctx.app.pm.get('feishu')`. */
  async sendMessageFromTool(feishuContext: ToolFeishuContext, args: SendMessageToolArgs): Promise<ToolResult> {
    try {
      const result = await this.services.clientManager.sendMessage({
        appId: feishuContext.appId,
        receiveId: args.receiveId,
        receiveIdType: args.receiveIdType,
        msgType: 'text',
        content: { text: args.content },
      });
      return { status: 'success', content: result.messageId };
    } catch (err) {
      return { status: 'failure', content: err instanceof Error ? err.message : String(err) };
    }
  }

  async getMessageFromTool(_feishuContext: ToolFeishuContext, _args: GetMessageToolArgs): Promise<ToolResult> {
    // Phase 7 stub: real implementation will call the SDK message.get endpoint.
    return { status: 'failure', content: 'getMessageFromTool not implemented yet' };
  }

  /** Documented escape hatch so integration tests can swap in lightweight fakes. */
  _setServicesForTest(overrides: Partial<FeishuServices>): void {
    Object.assign(this.services, overrides);
  }

  async beforeLoad() {
    this.app.acl.registerSnippet({
      name: 'pm.feishu.settings',
      actions: [
        'feishu_apps:*',
        'feishuApps:*',
        'feishuMessages:send',
        'feishuMessages:reply',
        'feishu_message_logs:list',
        'feishu_card_records:list',
        'feishu_card_action_logs:list',
        'feishuDiagnostics:*',
      ],
    });
  }

  /**
   * Decrypt a single AES-encrypted secret field. Returns `undefined` if
   * the value is missing OR if decryption fails (treats stale legacy data —
   * e.g. previously scrypt-hashed values from `type: password` — as absent
   * so the caller can surface a clean credential error rather than passing
   * garbage to the Lark SDK).
   */
  private async decryptSecret(value: unknown): Promise<string | undefined> {
    if (typeof value !== 'string' || value.length === 0) return undefined;
    try {
      return await this.app.aesEncryptor.decrypt(value);
    } catch (err) {
      this.app.log.warn('feishu.secret.decrypt.failed — re-enter the secret in the UI', {
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }

  async load() {
    const cache = await this.app.cacheManager.createCache({
      name: CACHE_NAMESPACE,
      prefix: CACHE_NAMESPACE,
    });
    const cacheAdapter = {
      get: (k: string) => cache.get(k),
      set: (k: string, v: unknown, ttlSec: number) => cache.set(k, v, ttlSec * 1000),
    };
    const log = {
      info: (msg: string): void => this.app.log.info(msg),
      warn: (msg: string): void => this.app.log.warn(msg),
      error: (msg: string): void => this.app.log.error(msg),
    };

    const clientManager = new FeishuClientManager();
    const messageDedup = new MessageDedup(cacheAdapter);
    const cardActionDedup = new CardActionDedup(cacheAdapter);
    const cardRecordService = new CardRecordService({ db: this.app.db });
    const conversationManager = new FeishuConversationManager();
    const richLog = {
      info: (msg: string, meta?: Record<string, unknown>): void =>
        meta ? this.app.log.info(msg, meta) : this.app.log.info(msg),
      warn: (msg: string, meta?: Record<string, unknown>): void =>
        meta ? this.app.log.warn(msg, meta) : this.app.log.warn(msg),
      error: (msg: string, meta?: Record<string, unknown>): void =>
        meta ? this.app.log.error(msg, meta) : this.app.log.error(msg),
    };
    const responseRenderer = new FeishuResponseRenderer({ clientManager, log: richLog });

    // Sibling plugins (plugin-ai-gigachat, plugin-data-visualization,
    // plugin-localization) all import from '@nocobase/plugin-ai' directly.
    // tsconfig.paths.json maps it to the src tree so dev mode resolves the
    // export without a built dist; production builds resolve through the
    // package's main field. We declare plugin-ai as a peerDependency so
    // mis-installs surface at load time, not at first message.
    const aiEmployeeClass: AIEmployeeConstructor = AIEmployee as unknown as AIEmployeeConstructor;

    const messageLogService = {
      record: async (params: MessageLogRecordParams): Promise<void> => {
        try {
          await this.app.db.getRepository(COLLECTION.messageLogs).create({
            values: {
              app_id: params.appId,
              event_id: params.eventId,
              message_id: params.messageId,
              chat_id: params.chatId,
              sender_open_id: params.senderOpenId,
              message_type: params.messageType,
              route_action: params.routeAction,
              status: params.status,
              ai_session_id: params.aiSessionId,
              error: params.error,
            },
          });
        } catch (err) {
          log.warn(`feishu.message.log.failed ${(err as Error).message}`);
        }
      },
    };

    const contextFactory: AIBridgeContextFactory = (opts) =>
      buildAIInvokeContext({
        app: opts.app,
        log: opts.log,
        feishuContext: opts.feishuContext,
        actAsUserId: opts.actAsUserId,
      });

    const aiBridge = new FeishuAIBridge({
      app: { db: this.app.db, pm: this.app.pm },
      log: richLog,
      conversationManager,
      contextFactory,
      responseRenderer,
      messageLogService,
      AIEmployee: aiEmployeeClass,
    });

    const cardActionRouter = new CardActionRouter({ cardRecordService, cardActionDedup, conversationManager });
    const cardActionLogService = {
      record: async (p: {
        appId: string;
        eventId: string;
        cardRecordId: number;
        messageId: string;
        actionKey: string;
        actionValues: Record<string, unknown>;
        executorOpenId: string;
        executorUserId?: number;
        result: 'success' | 'failure' | 'duplicate';
        resultDetail?: unknown;
      }): Promise<void> => {
        try {
          await this.app.db.getRepository(COLLECTION.cardActionLogs).create({
            values: {
              app_id: p.appId,
              event_id: p.eventId,
              card_record_id: p.cardRecordId,
              message_id: p.messageId,
              action_key: p.actionKey,
              action_values: p.actionValues,
              executor_open_id: p.executorOpenId,
              executor_user_id: p.executorUserId,
              result: p.result,
              result_detail: p.resultDetail,
            },
          });
        } catch (err) {
          log.warn(`feishu.card.action.log.failed ${(err as Error).message}`);
        }
      },
    };
    const cardActionHandler = new CardActionHandler({
      actionLogService: cardActionLogService,
      log: richLog,
    });

    const messageQueue = new FeishuMessageQueue({
      logger: { error: (msg, meta) => log.error(`${msg} ${meta ? JSON.stringify(meta) : ''}`) },
    });

    const wsManager = new FeishuWebSocketManager(
      {
        onMessage: async (appId, event) => {
          try {
            const ev = event as RawMessageEvent;
            // The Lark SDK EventDispatcher hands handlers the inner event
            // (`{ message, sender, ... }`); the HTTP webhook adds an outer
            // envelope (`{ header, event: { message, sender } }`). Support both.
            const inner = ev?.event ?? ev;
            const messageId = inner?.message?.message_id;
            const eventId = ev?.header?.event_id ?? ev?.event_id ?? messageId ?? '';
            this.app.log.info(
              `feishu.ws.message.received app=${appId} message_id=${messageId ?? ''} event_id=${eventId}`,
            );
            if (eventId) {
              const fresh = await messageDedup.tryRecord(appId, String(eventId));
              if (!fresh) {
                this.app.log.info(`feishu.ws.message.deduped app=${appId} event_id=${eventId}`);
                return;
              }
            }
            await messageQueue.enqueue(appId, event);
          } catch (err) {
            log.warn(`feishu.ws.onMessage.error ${(err as Error).message}`);
          }
        },
        onCardAction: async (appId, event) => {
          const ev = event as CardTriggerEvent;
          const inner = ev?.event ?? ev;
          try {
            this.app.log.info(`feishu.ws.card.received app=${appId}`);
            const messageId = inner?.context?.open_message_id ?? inner?.message_id;
            const route = await cardActionRouter.route({
              appId,
              eventId: ev?.header?.event_id ?? ev?.event_id ?? messageId ?? '',
              messageId,
              openMessageId: inner?.context?.open_message_id,
              actionKey: inner?.action?.value?.action_key ?? '',
              values: inner?.action?.value ?? {},
              senderOpenId: inner?.operator?.open_id ?? '',
              chatId: inner?.context?.open_chat_id ?? '',
              chatType: 'p2p',
            });
            return await cardActionHandler.dispatch(route, {
              appId,
              eventId: ev?.header?.event_id ?? messageId ?? '',
              messageId: messageId ?? '',
              actionKey: inner?.action?.value?.action_key ?? '',
              actionValues: inner?.action?.value ?? {},
              executorOpenId: inner?.operator?.open_id ?? '',
            });
          } catch (err) {
            log.error(`feishu.card.action.error ${(err as Error).message}`);
            return { toast: { type: 'error', content: 'Card action failed' } };
          }
        },
      },
      log,
    );

    messageQueue.consume(async (appId, rawEvent) => {
      this.app.log.info(`feishu.queue.consume.start app=${appId}`);
      const repo = this.app.db.getRepository(COLLECTION.apps);
      const appRow = await repo.findOne({ filter: { app_id: appId } });
      const botOpenId = appRow?.get?.('bot_open_id') as string | undefined;
      const parsed = parseMessageEvent(rawEvent, { botOpenId });
      if (!parsed) {
        this.app.log.warn(
          `feishu.queue.parse.failed app=${appId} (raw event shape was not recognised — see message-parser logs)`,
        );
        await messageLogService.record({
          appId,
          eventId: '',
          messageId: '',
          chatId: '',
          senderOpenId: '',
          messageType: 'text',
          routeAction: 'ignore',
          status: 'ignored',
        });
        return;
      }
      const context = await buildFeishuMessageContext({ db: this.app.db }, { appId, parsed });
      const decision = routeMessage(parsed, context);
      this.app.log.info(
        `feishu.queue.routed app=${appId} message_id=${parsed.messageId} chat_type=${parsed.chatType} decision=${
          decision.action
        }${decision.action === 'ignore' ? ` reason=${decision.reason}` : ''}`,
      );
      if (decision.action === 'ai' && context) {
        await aiBridge.handleMessage(appId, parsed, context);
      } else {
        await messageLogService.record({
          appId,
          eventId: parsed.eventId,
          messageId: parsed.messageId,
          chatId: parsed.chatId,
          senderOpenId: parsed.senderOpenId,
          messageType: parsed.contentType,
          routeAction: 'ignore',
          status: 'ignored',
        });
      }
    });

    const appRegistry = new AppRegistry();

    // Build an AppConfigRow from a raw db row, decrypting every secret field.
    // Decryption that fails (stale legacy hash, missing value) becomes empty
    // string so the SDK throws a clean credential error rather than handing a
    // hash back to feishu.
    const toAppRow = async (
      raw: Record<string, unknown>,
    ): Promise<import('./app-runtime/app-runtime-manager').AppConfigRow> => ({
      app_id: String(raw.app_id ?? ''),
      app_secret: (await this.decryptSecret(raw.app_secret)) ?? '',
      encrypt_key: await this.decryptSecret(raw.encrypt_key),
      verification_token: await this.decryptSecret(raw.verification_token),
      status: typeof raw.status === 'string' ? raw.status : 'active',
      bot_open_id: typeof raw.bot_open_id === 'string' ? raw.bot_open_id : undefined,
    });
    const runtimeManager = new FeishuAppRuntimeManager({
      clientManager,
      wsManager,
      registry: appRegistry,
      loadActiveAppRows: async () => {
        const rows = await this.app.db.getRepository(COLLECTION.apps).find({ filter: { status: 'active' } });
        const jsons = rows.map((r: { toJSON: () => Record<string, unknown> }) => r.toJSON());
        return Promise.all(jsons.map(toAppRow));
      },
      loadAppRow: async (appId: string) => {
        const row = await this.app.db.getRepository(COLLECTION.apps).findOne({ filter: { app_id: appId } });
        if (!row) return null;
        const json = (row as { toJSON: () => Record<string, unknown> }).toJSON();
        return toAppRow(json);
      },
      log,
    });
    const secretService = new SecretService(clientManager);

    this.services = {
      clientManager,
      wsManager,
      appRegistry,
      runtimeManager,
      secretService,
      messageDedup,
      cardActionDedup,
      cardRecordService,
      cardActionRouter,
      cardActionHandler,
      conversationManager,
      responseRenderer,
      aiBridge,
      messageQueue,
    };

    registerAppActions(this.app, {
      runtimeManager,
      secretService,
      clientManager,
      decryptSecret: (value) => this.decryptSecret(value),
      log,
    });
    registerMessageActions(this.app, { clientManager });
    registerDiagnosticsActions(this.app, { runtimeManager, wsManager, messageQueue });

    // Encrypt secret fields on save. We hook the db event (not the model
    // hook) so user-typed plaintext goes through aesEncryptor.encrypt before
    // it ever hits the column. Empty values mean "keep current" — matches
    // the UI's password-input convention. Mirrors plugin-environment-variables
    // (packages/plugins/@nocobase/plugin-environment-variables/src/server/plugin.ts:153).
    this.app.db.on(
      `${COLLECTION.apps}.beforeSave`,
      async (instance: {
        changed: (n: string) => boolean;
        get: (n: string) => unknown;
        set: (n: string, v: unknown) => void;
        previous: (n: string) => unknown;
      }) => {
        for (const field of SECRET_FIELDS) {
          if (!instance.changed(field)) continue;
          const value = instance.get(field);
          if (typeof value !== 'string' || value.length === 0) {
            // empty input = keep previous encrypted value (no change). Falls back
            // to clearing for nullable fields without a previous value.
            instance.set(field, instance.previous(field) ?? null);
            continue;
          }
          // Heuristic: if the value is already a hex-only blob with the AES
          // length the encryptor produces (64+ chars hex), assume it's already
          // encrypted (e.g. a model.set chain re-saving a row). Otherwise treat
          // as plaintext and encrypt.
          const looksEncrypted = /^[0-9a-fA-F]{64,}$/.test(value);
          if (looksEncrypted) continue;
          try {
            const encrypted = await this.app.aesEncryptor.encrypt(value);
            instance.set(field, encrypted);
          } catch (err) {
            this.app.log.error(`feishu.secret.encrypt.failed field=${field}`, {
              error: err instanceof Error ? err.message : String(err),
            });
            throw err;
          }
        }
      },
    );

    // Strip secret fields from list responses before they hit the wire.
    // Detail / get responses also redact: the management UI never needs to
    // see the encrypted blob, only whether a value is present.
    const sanitizeListAction = async (
      ctx: import('@nocobase/actions').Context,
      next: import('@nocobase/actions').Next,
    ) => {
      await next();
      const data = (ctx.body as { data?: unknown })?.data;
      const rows = Array.isArray(data) ? data : data ? [data] : [];
      for (const row of rows as Array<Record<string, unknown>>) {
        for (const field of SECRET_FIELDS) {
          if (row[field] != null && row[field] !== '') {
            row[field] = '__encrypted__';
          }
        }
      }
    };
    this.app.resourceManager.use(sanitizeListAction, {
      tag: 'feishu-apps-secret-redact',
      resourceNames: [COLLECTION.apps],
      actionNames: ['list', 'get'],
    } as never);

    // Mirror feishu_apps row changes into the runtime: status=active -> reload
    // (creates a new SDK client + WS connection with the latest credentials);
    // status=disabled -> stop. Without this hook, saving a fresh app_secret in
    // the UI does not propagate to the running WebSocket — exactly what the
    // design doc § 配置变更 requires.
    const FeishuAppModel = this.app.db.getModel(COLLECTION.apps);
    FeishuAppModel.afterSave(async (instance: { get: (k: string) => unknown }) => {
      const appId = instance.get('app_id') as string;
      const status = instance.get('status') as string;
      if (!appId) return;
      try {
        if (status === 'active') {
          this.app.log.info(`feishu.app.afterSave.reload app=${appId}`);
          await runtimeManager.reload(appId);
        } else {
          this.app.log.info(`feishu.app.afterSave.stop app=${appId} status=${status}`);
          await runtimeManager.stop(appId);
        }
      } catch (err) {
        log.warn(`feishu.app.afterSave.error ${appId} ${(err as Error).message}`);
      }
    });
    FeishuAppModel.afterDestroy(async (instance: { get: (k: string) => unknown }) => {
      const appId = instance.get('app_id') as string;
      if (!appId) return;
      try {
        this.app.log.info(`feishu.app.afterDestroy.stop app=${appId}`);
        await runtimeManager.stop(appId);
      } catch (err) {
        log.warn(`feishu.app.afterDestroy.error ${appId} ${(err as Error).message}`);
      }
    });

    this.app.on('afterStart', async () => {
      try {
        await this.services.runtimeManager.startActiveApps();
      } catch (err) {
        log.warn(`feishu.afterStart.error ${(err as Error).message}`);
      }
    });
  }

  async afterDisable() {
    await this.services?.runtimeManager.stopAll();
  }

  async remove() {
    await this.services?.runtimeManager.stopAll();
  }
}

export default PluginFeishuServer;
