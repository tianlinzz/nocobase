/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it, vi } from 'vitest';
import { PluginFeishuClientV2 } from '../plugin';

describe('PluginFeishuClientV2', () => {
  it('registers feishu settings menu and three tabs on load', async () => {
    const addMenuItem = vi.fn();
    const addPageTabItem = vi.fn();
    const fakeApp = { pluginSettingsManager: { addMenuItem, addPageTabItem } } as any;
    const plugin = new PluginFeishuClientV2({} as any, fakeApp);

    await plugin.load();

    expect(addMenuItem).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'feishu',
        icon: 'MessageOutlined',
        aclSnippet: 'pm.feishu.settings',
      }),
    );
    expect(addPageTabItem).toHaveBeenCalledTimes(3);
    const keys = addPageTabItem.mock.calls.map((c) => c[0].key);
    expect(keys).toEqual(['index', 'card-records', 'diagnostics']);
  });
});
