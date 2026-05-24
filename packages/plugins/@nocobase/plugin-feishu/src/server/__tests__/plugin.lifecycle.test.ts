/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockServer, MockServer } from '@nocobase/test';

interface FeishuPluginShape {
  sendMessageFromTool: (...args: unknown[]) => Promise<unknown>;
  getMessageFromTool: (...args: unknown[]) => Promise<unknown>;
}

describe('plugin-feishu lifecycle', () => {
  let app: MockServer;

  beforeEach(async () => {
    app = await createMockServer({
      plugins: ['error-handler', 'field-sort', 'data-source-manager', 'data-source-main', 'feishu'],
    });
  });

  afterEach(async () => {
    await app?.destroy();
  });

  it('loads without throwing', () => {
    expect(app.pm.get('feishu')).toBeTruthy();
  });

  it('exposes sendMessageFromTool / getMessageFromTool on the plugin instance', () => {
    const plugin = app.pm.get('feishu') as unknown as FeishuPluginShape;
    expect(typeof plugin.sendMessageFromTool).toBe('function');
    expect(typeof plugin.getMessageFromTool).toBe('function');
  });

  it('feishuApps:runtimeOverview returns an array (empty when no apps configured)', async () => {
    const response = await app.agent().resource('feishuApps').runtimeOverview();
    expect(response.status).toBeLessThan(500);
    const payload = (response.body as { data: unknown }).data;
    expect(Array.isArray(payload)).toBe(true);
  });

  it('feishuApps:testConnection on missing app returns ok:false without leaking secret', async () => {
    const response = await app
      .agent()
      .resource('feishuApps')
      .testConnection({
        values: { appId: 'cli_does_not_exist' },
      });
    expect(response.status).toBeLessThan(500);
    const payload = (response.body as { data: { ok: boolean } }).data;
    expect(payload.ok).toBe(false);
    expect(JSON.stringify(response.body)).not.toMatch(/app_secret/);
  });

  it('feishuApps:testConnection with bogus credentials in DB returns ok:false', async () => {
    await app.db.getRepository('feishu_apps').create({
      values: {
        app_id: 'cli_phase7_test',
        app_secret: 'totally_invalid_secret_for_test',
        status: 'active',
      },
    });
    const response = await app
      .agent()
      .resource('feishuApps')
      .testConnection({
        values: { appId: 'cli_phase7_test' },
      });
    expect(response.status).toBeLessThan(500);
    const payload = (response.body as { data: { ok: boolean } }).data;
    expect(payload.ok).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain('totally_invalid_secret_for_test');
  });
});
