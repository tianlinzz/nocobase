/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Application } from '@nocobase/client-v2';
import { NAMESPACE } from '../locale';
import { PluginFeishuClientV2 } from '../plugin';

describe('PluginFeishuClientV2', () => {
  it('registers translated feishu settings menu and three tabs on load', async () => {
    const addMenuItem = vi.fn();
    const addPageTabItem = vi.fn();
    const t = vi.fn((key: string) => `${key} translated`);
    const fakeApp = { pluginSettingsManager: { addMenuItem, addPageTabItem }, i18n: { t } } as unknown as Application;
    const plugin = new PluginFeishuClientV2({}, fakeApp);

    await plugin.load();

    expect(addMenuItem).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'feishu',
        title: 'Feishu translated',
        icon: 'MessageOutlined',
        aclSnippet: 'pm.feishu.settings',
      }),
    );
    expect(addPageTabItem).toHaveBeenCalledTimes(3);
    const keys = addPageTabItem.mock.calls.map((c) => c[0].key);
    expect(keys).toEqual(['index', 'card-records', 'diagnostics']);
    const titles = addPageTabItem.mock.calls.map((c) => c[0].title);
    expect(titles).toEqual(['Apps translated', 'Card records translated', 'Diagnostics translated']);
    expect(t).toHaveBeenCalledWith('Feishu', { ns: NAMESPACE });
  });
});
