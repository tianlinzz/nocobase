/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { FeishuWebSocketManager, WSEventHandlers } from '../ws-connection-manager';

const startMock = vi.fn();
const setHandlersMock = vi.fn();
let lastEventDispatcher: any;

vi.mock('@larksuiteoapi/node-sdk', () => {
  class FakeWSClient {
    public _opts: unknown;
    constructor(opts: unknown) {
      this._opts = opts;
    }
    start(arg: { eventDispatcher: unknown }) {
      lastEventDispatcher = arg.eventDispatcher;
      startMock(arg);
    }
  }
  class FakeEventDispatcher {
    handlers: Record<string, (event: unknown) => unknown> = {};
    constructor(_opts?: unknown) {}
    register(handlers: Record<string, (event: unknown) => unknown>) {
      this.handlers = { ...this.handlers, ...handlers };
      setHandlersMock(handlers);
      return this;
    }
  }
  return {
    WSClient: FakeWSClient,
    EventDispatcher: FakeEventDispatcher,
    Domain: { Feishu: 'feishu' },
    LoggerLevel: { warn: 'warn' },
  };
});

const buildHandlers = (): WSEventHandlers => ({
  onMessage: vi.fn(async () => undefined),
  onCardAction: vi.fn(async () => ({ toast: { type: 'info', content: 'ok' } })),
});

describe('FeishuWebSocketManager', () => {
  beforeEach(() => {
    startMock.mockReset();
    setHandlersMock.mockReset();
    lastEventDispatcher = undefined;
  });

  it('startConnection invokes WSClient.start with both event handlers registered', async () => {
    const handlers = buildHandlers();
    const mgr = new FeishuWebSocketManager(handlers);
    mgr.addConnection({ appId: 'a1', appSecret: 's1' });
    await mgr.startConnection('a1');
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(setHandlersMock.mock.calls[0][0])).toEqual(
      expect.arrayContaining(['im.message.receive_v1', 'card.action.trigger']),
    );
  });

  it('dispatches message events to onMessage with appId', async () => {
    const handlers = buildHandlers();
    const mgr = new FeishuWebSocketManager(handlers);
    mgr.addConnection({ appId: 'a1', appSecret: 's1' });
    await mgr.startConnection('a1');
    await lastEventDispatcher.handlers['im.message.receive_v1']({ event: { foo: 1 } });
    expect(handlers.onMessage).toHaveBeenCalledWith('a1', { event: { foo: 1 } });
  });

  it('returns the result of onCardAction back to feishu', async () => {
    const handlers = buildHandlers();
    const mgr = new FeishuWebSocketManager(handlers);
    mgr.addConnection({ appId: 'a1', appSecret: 's1' });
    await mgr.startConnection('a1');
    const result = await lastEventDispatcher.handlers['card.action.trigger']({ event: { card: 1 } });
    expect(handlers.onCardAction).toHaveBeenCalledWith('a1', { event: { card: 1 } });
    expect(result).toEqual({ toast: { type: 'info', content: 'ok' } });
  });

  it('isRunning toggles with start/stop, getConnectedAppIds reflects active set', async () => {
    const handlers = buildHandlers();
    const mgr = new FeishuWebSocketManager(handlers);
    mgr.addConnection({ appId: 'a1', appSecret: 's1' });
    mgr.addConnection({ appId: 'a2', appSecret: 's2' });
    expect(mgr.isRunning('a1')).toBe(false);
    await mgr.startConnection('a1');
    expect(mgr.isRunning('a1')).toBe(true);
    expect(mgr.getConnectedAppIds()).toEqual(['a1']);
    await mgr.stopConnection('a1');
    expect(mgr.isRunning('a1')).toBe(false);
  });

  it('stopAll does not throw if connections were never started', async () => {
    const mgr = new FeishuWebSocketManager(buildHandlers());
    await expect(mgr.stopAll()).resolves.toBeUndefined();
  });
});
