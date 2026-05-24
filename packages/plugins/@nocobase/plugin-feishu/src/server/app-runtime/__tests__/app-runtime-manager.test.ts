/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRegistry } from '../app-registry';
import { AppConfigRow, AppRuntimeManagerDeps, FeishuAppRuntimeManager } from '../app-runtime-manager';

interface Mocks {
  clientManager: { addApp: ReturnType<typeof vi.fn>; removeApp: ReturnType<typeof vi.fn> };
  wsManager: {
    addConnection: ReturnType<typeof vi.fn>;
    removeConnection: ReturnType<typeof vi.fn>;
    startConnection: ReturnType<typeof vi.fn>;
    stopConnection: ReturnType<typeof vi.fn>;
  };
  log: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  loadActiveAppRows: ReturnType<typeof vi.fn>;
  loadAppRow: ReturnType<typeof vi.fn>;
}

function build(rowsByAppId: Record<string, AppConfigRow | null>): {
  manager: FeishuAppRuntimeManager;
  registry: AppRegistry;
  mocks: Mocks;
} {
  const registry = new AppRegistry();
  const mocks: Mocks = {
    clientManager: { addApp: vi.fn(), removeApp: vi.fn() },
    wsManager: {
      addConnection: vi.fn(),
      removeConnection: vi.fn(),
      startConnection: vi.fn().mockResolvedValue(undefined),
      stopConnection: vi.fn().mockResolvedValue(undefined),
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    loadActiveAppRows: vi
      .fn()
      .mockResolvedValue(Object.values(rowsByAppId).filter((r): r is AppConfigRow => !!r && r.status === 'active')),
    loadAppRow: vi.fn().mockImplementation(async (appId: string) => rowsByAppId[appId] ?? null),
  };
  const deps: AppRuntimeManagerDeps = {
    clientManager: mocks.clientManager,
    wsManager: mocks.wsManager,
    registry,
    loadActiveAppRows: mocks.loadActiveAppRows,
    loadAppRow: mocks.loadAppRow,
    log: mocks.log,
  };
  return { manager: new FeishuAppRuntimeManager(deps), registry, mocks };
}

const activeRow = (appId: string): AppConfigRow => ({
  app_id: appId,
  app_secret: `secret_${appId}`,
  encrypt_key: 'enc',
  verification_token: 'vt',
  status: 'active',
});

describe('FeishuAppRuntimeManager.start', () => {
  it('happy path: addApp, addConnection, startConnection; registry → running', async () => {
    const { manager, registry, mocks } = build({ a1: activeRow('a1') });
    await manager.start('a1');
    expect(mocks.clientManager.addApp).toHaveBeenCalledWith({ appId: 'a1', appSecret: 'secret_a1' });
    expect(mocks.wsManager.addConnection).toHaveBeenCalledWith({
      appId: 'a1',
      appSecret: 'secret_a1',
      encryptKey: 'enc',
      verificationToken: 'vt',
    });
    expect(mocks.wsManager.startConnection).toHaveBeenCalledWith('a1');
    expect(registry.get('a1')?.state).toBe('running');
    expect(typeof registry.get('a1')?.startedAt).toBe('number');
    expect(mocks.log.info).toHaveBeenCalledWith('feishu.app.start a1');
  });

  it('early-returns when row not found', async () => {
    const { manager, registry, mocks } = build({});
    await manager.start('missing');
    expect(mocks.clientManager.addApp).not.toHaveBeenCalled();
    expect(mocks.wsManager.startConnection).not.toHaveBeenCalled();
    expect(registry.get('missing')).toBeUndefined();
  });

  it('early-returns when row.status !== "active"', async () => {
    const { manager, mocks } = build({ a1: { ...activeRow('a1'), status: 'inactive' } });
    await manager.start('a1');
    expect(mocks.wsManager.startConnection).not.toHaveBeenCalled();
    expect(mocks.clientManager.addApp).not.toHaveBeenCalled();
  });

  it('rolls back on startConnection failure: registry → failed and removes', async () => {
    const { manager, registry, mocks } = build({ a1: activeRow('a1') });
    mocks.wsManager.startConnection.mockRejectedValueOnce(new Error('ws boom'));
    await expect(manager.start('a1')).rejects.toThrow('ws boom');
    expect(registry.get('a1')?.state).toBe('failed');
    expect(registry.get('a1')?.lastError).toBe('ws boom');
    expect(mocks.clientManager.removeApp).toHaveBeenCalledWith('a1');
    expect(mocks.wsManager.removeConnection).toHaveBeenCalledWith('a1');
  });
});

describe('FeishuAppRuntimeManager.stop / reload / stopAll', () => {
  it('stop: stopConnection + remove + registry → stopped', async () => {
    const { manager, registry, mocks } = build({ a1: activeRow('a1') });
    await manager.start('a1');
    await manager.stop('a1');
    expect(mocks.wsManager.stopConnection).toHaveBeenCalledWith('a1');
    expect(mocks.clientManager.removeApp).toHaveBeenCalledWith('a1');
    expect(mocks.wsManager.removeConnection).toHaveBeenCalledWith('a1');
    expect(registry.get('a1')?.state).toBe('stopped');
    expect(mocks.log.info).toHaveBeenCalledWith('feishu.app.stop a1');
  });

  it('stop still cleans up if stopConnection rejects', async () => {
    const { manager, registry, mocks } = build({ a1: activeRow('a1') });
    await manager.start('a1');
    mocks.wsManager.stopConnection.mockRejectedValueOnce(new Error('stop err'));
    await expect(manager.stop('a1')).rejects.toThrow('stop err');
    expect(mocks.clientManager.removeApp).toHaveBeenCalledWith('a1');
    expect(registry.get('a1')?.state).toBe('stopped');
  });

  it('reload calls stop then start', async () => {
    const { manager, mocks } = build({ a1: activeRow('a1') });
    await manager.start('a1');
    mocks.wsManager.startConnection.mockClear();
    mocks.wsManager.stopConnection.mockClear();
    await manager.reload('a1');
    expect(mocks.wsManager.stopConnection).toHaveBeenCalledTimes(1);
    expect(mocks.wsManager.startConnection).toHaveBeenCalledTimes(1);
    // ensure stop happened before start
    expect(mocks.wsManager.stopConnection.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.wsManager.startConnection.mock.invocationCallOrder[0],
    );
  });

  it('stopAll iterates current registry entries; one failure does not block others', async () => {
    const { manager, registry, mocks } = build({ a1: activeRow('a1'), a2: activeRow('a2') });
    await manager.start('a1');
    await manager.start('a2');
    mocks.wsManager.stopConnection.mockImplementationOnce(async () => {
      throw new Error('first stop err');
    });
    await manager.stopAll();
    expect(registry.get('a1')?.state).toBe('stopped');
    expect(registry.get('a2')?.state).toBe('stopped');
    expect(mocks.log.warn).toHaveBeenCalled();
  });
});

describe('FeishuAppRuntimeManager locking', () => {
  it('serializes concurrent start calls for the same appId', async () => {
    const { manager, mocks } = build({ a1: activeRow('a1') });
    let resolveFirst: () => void = () => {};
    const order: string[] = [];
    mocks.wsManager.startConnection.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          order.push('first-begin');
          resolveFirst = () => {
            order.push('first-end');
            resolve();
          };
        }),
    );
    mocks.wsManager.startConnection.mockImplementationOnce(async () => {
      order.push('second-begin');
      order.push('second-end');
    });

    const p1 = manager.start('a1');
    const p2 = manager.start('a1');
    // give the event loop a tick to attempt to interleave
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(order).toEqual(['first-begin']);
    resolveFirst();
    await Promise.all([p1, p2]);
    expect(order).toEqual(['first-begin', 'first-end', 'second-begin', 'second-end']);
  });

  it('does not serialize across different appIds', async () => {
    const { manager, mocks } = build({ a1: activeRow('a1'), a2: activeRow('a2') });
    let resolveA1: () => void = () => {};
    const order: string[] = [];
    mocks.wsManager.startConnection.mockImplementation(async (appId: string) => {
      if (appId === 'a1') {
        order.push('a1-begin');
        await new Promise<void>((resolve) => {
          resolveA1 = () => {
            order.push('a1-end');
            resolve();
          };
        });
        return;
      }
      order.push('a2-begin');
      order.push('a2-end');
    });

    const p1 = manager.start('a1');
    const p2 = manager.start('a2');
    await new Promise((resolve) => setTimeout(resolve, 5));
    // a2 should run while a1 is still pending
    expect(order).toContain('a2-end');
    resolveA1();
    await Promise.all([p1, p2]);
  });
});

describe('FeishuAppRuntimeManager.startActiveApps', () => {
  let manager: FeishuAppRuntimeManager;
  let registry: AppRegistry;
  let mocks: Mocks;

  beforeEach(() => {
    ({ manager, registry, mocks } = build({
      a1: activeRow('a1'),
      a2: activeRow('a2'),
    }));
  });

  it('starts every active app', async () => {
    await manager.startActiveApps();
    expect(mocks.wsManager.startConnection).toHaveBeenCalledTimes(2);
    expect(
      registry
        .list()
        .map((s) => s.state)
        .sort(),
    ).toEqual(['running', 'running']);
  });

  it('failure of one app does not block others', async () => {
    mocks.wsManager.startConnection.mockImplementationOnce(async () => {
      throw new Error('a1 boom');
    });
    await manager.startActiveApps();
    const states = Object.fromEntries(registry.list().map((s) => [s.appId, s.state]));
    expect(states.a1).toBe('failed');
    expect(states.a2).toBe('running');
    expect(mocks.log.error).toHaveBeenCalled();
  });
});
