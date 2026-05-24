/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { createMockServer, MockServer } from '@nocobase/test';

describe('plugin-feishu bootstrap', () => {
  let app: MockServer;

  beforeEach(async () => {
    app = await createMockServer({
      plugins: ['error-handler', 'field-sort', 'data-source-manager', 'data-source-main', 'feishu'],
    });
  });

  afterEach(async () => {
    await app?.destroy();
  });

  it('registers ACL snippet pm.feishu.settings', () => {
    const snippet = app.acl.snippetManager.snippets.get('pm.feishu.settings');
    expect(snippet).toBeTruthy();
  });

  it('creates feishu_apps collection', () => {
    expect(app.db.getCollection('feishu_apps')).toBeTruthy();
  });

  it('creates feishu_message_logs / feishu_card_records / feishu_card_action_logs collections', () => {
    expect(app.db.getCollection('feishu_message_logs')).toBeTruthy();
    expect(app.db.getCollection('feishu_card_records')).toBeTruthy();
    expect(app.db.getCollection('feishu_card_action_logs')).toBeTruthy();
  });
});
