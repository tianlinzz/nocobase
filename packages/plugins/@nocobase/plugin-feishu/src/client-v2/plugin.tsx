/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { Plugin, Application } from '@nocobase/client-v2';
import { tExpr } from './locale';

export class PluginFeishuClientV2 extends Plugin<Record<string, never>, Application> {
  async load() {
    this.pluginSettingsManager.addMenuItem({
      key: 'feishu',
      title: tExpr('Feishu') as unknown as string,
      icon: 'MessageOutlined',
      aclSnippet: 'pm.feishu.settings',
    });
    this.pluginSettingsManager.addPageTabItem({
      menuKey: 'feishu',
      key: 'index',
      title: tExpr('Apps') as unknown as string,
      componentLoader: () => import('./pages/FeishuAppsPage'),
      sort: -1,
    });
    this.pluginSettingsManager.addPageTabItem({
      menuKey: 'feishu',
      key: 'card-records',
      title: tExpr('Card records') as unknown as string,
      componentLoader: () => import('./pages/FeishuCardRecordsPage'),
    });
    this.pluginSettingsManager.addPageTabItem({
      menuKey: 'feishu',
      key: 'diagnostics',
      title: tExpr('Diagnostics') as unknown as string,
      componentLoader: () => import('./pages/FeishuDiagnosticsPage'),
    });
  }
}

export default PluginFeishuClientV2;
