/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { Plugin } from '@nocobase/server';
import { CACHE_NAMESPACE, COLLECTION } from './constants';
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

    // Resolve `AIEmployee` lazily so plugin-feishu still loads when plugin-ai
    // is missing or disabled. The fallback class is a no-op shape that lets
    // the bridge bail out before invoking it.
    const aiEmployeeClass = ((): AIEmployeeConstructor => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('@nocobase/plugin-ai/server') as { AIEmployee?: AIEmployeeConstructor };
        if (mod.AIEmployee) return mod.AIEmployee;
      } catch {
        // plugin-ai not installed in this environment
      }
      class FallbackAIEmployee {
        async invoke(): Promise<{ text?: string }> {
          return { text: '' };
        }
      }
      return FallbackAIEmployee as unknown as AIEmployeeConstructor;
    })();

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

    const wsManager = new FeishuWebSocketManager({
      onMessage: async (appId, event) => {
        try {
          const ev = event as RawMessageEvent;
          const eventId = ev?.header?.event_id ?? ev?.event_id;
          if (eventId) {
            const fresh = await messageDedup.tryRecord(appId, String(eventId));
            if (!fresh) return;
          }
          await messageQueue.enqueue(appId, event);
        } catch (err) {
          log.warn(`feishu.ws.onMessage.error ${(err as Error).message}`);
        }
      },
      onCardAction: async (appId, event) => {
        const ev = event as CardTriggerEvent;
        try {
          const route = await cardActionRouter.route({
            appId,
            eventId: ev?.header?.event_id ?? ev?.event_id ?? '',
            messageId: ev?.event?.context?.open_message_id ?? ev?.event?.message_id,
            openMessageId: ev?.event?.context?.open_message_id,
            actionKey: ev?.event?.action?.value?.action_key ?? '',
            values: ev?.event?.action?.value ?? {},
            senderOpenId: ev?.event?.operator?.open_id ?? '',
            chatId: ev?.event?.context?.open_chat_id ?? '',
            chatType: 'p2p',
          });
          return await cardActionHandler.dispatch(route, {
            appId,
            eventId: ev?.header?.event_id ?? '',
            messageId: ev?.event?.context?.open_message_id ?? '',
            actionKey: ev?.event?.action?.value?.action_key ?? '',
            actionValues: ev?.event?.action?.value ?? {},
            executorOpenId: ev?.event?.operator?.open_id ?? '',
          });
        } catch (err) {
          log.error(`feishu.card.action.error ${(err as Error).message}`);
          return { toast: { type: 'error', content: 'Card action failed' } };
        }
      },
    });

    messageQueue.consume(async (appId, rawEvent) => {
      const repo = this.app.db.getRepository(COLLECTION.apps);
      const appRow = await repo.findOne({ filter: { app_id: appId } });
      const botOpenId = appRow?.get?.('bot_open_id') as string | undefined;
      const parsed = parseMessageEvent(rawEvent, { botOpenId });
      if (!parsed) {
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
    const toAppRow = (raw: Record<string, unknown>): import('./app-runtime/app-runtime-manager').AppConfigRow => ({
      app_id: String(raw.app_id ?? ''),
      app_secret: String(raw.app_secret ?? ''),
      encrypt_key: typeof raw.encrypt_key === 'string' ? raw.encrypt_key : undefined,
      verification_token: typeof raw.verification_token === 'string' ? raw.verification_token : undefined,
      status: typeof raw.status === 'string' ? raw.status : 'active',
      bot_open_id: typeof raw.bot_open_id === 'string' ? raw.bot_open_id : undefined,
    });
    const runtimeManager = new FeishuAppRuntimeManager({
      clientManager,
      wsManager,
      registry: appRegistry,
      loadActiveAppRows: async () => {
        const rows = await this.app.db.getRepository(COLLECTION.apps).find({ filter: { status: 'active' } });
        return rows.map((r: { toJSON: () => Record<string, unknown> }) => r.toJSON()).map(toAppRow);
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

    registerAppActions(this.app, { runtimeManager, secretService, log });
    registerMessageActions(this.app, { clientManager });
    registerDiagnosticsActions(this.app, { runtimeManager, wsManager, messageQueue });

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
