/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it, vi } from 'vitest';
import { SecretService } from '../secret-service';
import { FeishuApiError } from '../../transport/types';
import { FeishuClientManager } from '../../transport/feishu-client-manager';

describe('SecretService.mask', () => {
  it('returns *** for short secrets (length <= 8)', () => {
    expect(SecretService.mask('shortie')).toBe('***');
    expect(SecretService.mask('shortsec')).toBe('***'); // exactly 8 chars
  });

  it('returns "" for null / undefined / empty', () => {
    expect(SecretService.mask(null)).toBe('');
    expect(SecretService.mask(undefined)).toBe('');
    expect(SecretService.mask('')).toBe('');
  });

  it('keeps first 3 and last 4 chars for longer values', () => {
    expect(SecretService.mask('abcdef1234567890')).toBe('abc***7890');
  });
});

describe('SecretService.validate', () => {
  function fakeManager(behavior: 'ok' | 'apiError' | 'throw') {
    const addApp = vi.fn();
    const removeApp = vi.fn();
    const validateCredentials = vi.fn().mockImplementation(async (_appId: string) => {
      if (behavior === 'ok') return { requestId: undefined };
      if (behavior === 'apiError') throw new FeishuApiError('upstream rejected', 99991663, 'rid-xyz');
      throw new Error('boom');
    });
    return { addApp, removeApp, validateCredentials } as unknown as FeishuClientManager & {
      addApp: ReturnType<typeof vi.fn>;
      removeApp: ReturnType<typeof vi.fn>;
      validateCredentials: ReturnType<typeof vi.fn>;
    };
  }

  it('calls validateCredentials once and returns success', async () => {
    const longLived = fakeManager('ok');
    const temp = fakeManager('ok');
    const service = new SecretService(longLived);
    const result = await service.validate({ appId: 'cli_app1', appSecret: 'sec' }, { managerFactory: () => temp });
    expect(result).toEqual({ requestId: undefined });
    expect(temp.addApp).toHaveBeenCalledTimes(1);
    expect(temp.validateCredentials).toHaveBeenCalledTimes(1);
    expect(temp.removeApp).toHaveBeenCalledTimes(1);
    // long-lived manager must not be touched
    expect(longLived.addApp as unknown as { mock: { calls: unknown[] } }).toBeDefined();
  });

  it('uses a temp app id derived from appId (never the secret)', async () => {
    const temp = fakeManager('ok');
    const service = new SecretService(fakeManager('ok'));
    await service.validate({ appId: 'cli_appX', appSecret: 'super-secret' }, { managerFactory: () => temp });
    const addArgs = temp.addApp.mock.calls[0][0];
    expect(addArgs.appId).toMatch(/^__validate__cli_appX__\d+$/);
    expect(addArgs.appSecret).toBe('super-secret');
    // the synthetic id passed to validateCredentials + removeApp should match
    expect(temp.validateCredentials.mock.calls[0][0]).toBe(addArgs.appId);
    expect(temp.removeApp.mock.calls[0][0]).toBe(addArgs.appId);
  });

  it('rethrows FeishuApiError preserving code without leaking secret', async () => {
    const temp = fakeManager('apiError');
    const service = new SecretService(fakeManager('ok'));
    await expect(
      service.validate({ appId: 'cli_app2', appSecret: 'super-secret-value' }, { managerFactory: () => temp }),
    ).rejects.toMatchObject({
      name: 'FeishuApiError',
      code: 99991663,
    });
    // assert error message does not contain the secret
    try {
      await service.validate({ appId: 'cli_app2', appSecret: 'super-secret-value' }, { managerFactory: () => temp });
    } catch (err) {
      expect((err as Error).message).not.toContain('super-secret-value');
    }
    expect(temp.removeApp).toHaveBeenCalled();
  });

  it('cleans up the temp manager even when validateCredentials throws non-FeishuApiError', async () => {
    const temp = fakeManager('throw');
    const service = new SecretService(fakeManager('ok'));
    await expect(
      service.validate({ appId: 'cli_app3', appSecret: 'sec' }, { managerFactory: () => temp }),
    ).rejects.toThrow('boom');
    expect(temp.removeApp).toHaveBeenCalled();
  });
});
