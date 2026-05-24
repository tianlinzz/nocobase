/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { Plugin, Application } from '@nocobase/client-v2';
import { NAMESPACE } from './locale';

export class PluginFeishuClientV2 extends Plugin<Record<string, never>, Application> {
  async load() {
    const t = (key: string) => this.app.i18n.t(key, { ns: NAMESPACE }) as unknown as string;

    this.pluginSettingsManager.addMenuItem({
      key: 'feishu',
      title: t('Feishu'),
      icon: 'MessageOutlined',
      aclSnippet: 'pm.feishu.settings',
    });
    this.pluginSettingsManager.addPageTabItem({
      menuKey: 'feishu',
      key: 'index',
      title: t('Apps'),
      componentLoader: () => import('./pages/FeishuAppsPage'),
      sort: -1,
    });
    this.pluginSettingsManager.addPageTabItem({
      menuKey: 'feishu',
      key: 'card-records',
      title: t('Card records'),
      componentLoader: () => import('./pages/FeishuCardRecordsPage'),
    });
    this.pluginSettingsManager.addPageTabItem({
      menuKey: 'feishu',
      key: 'diagnostics',
      title: t('Diagnostics'),
      componentLoader: () => import('./pages/FeishuDiagnosticsPage'),
    });
  }
}

export default PluginFeishuClientV2;
