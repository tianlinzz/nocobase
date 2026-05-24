/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { Plugin } from '@nocobase/client';

/**
 * Legacy v1 client entry. The Feishu plugin UI lives entirely in `client-v2/`.
 * This stub exists so the v1 plugin loader can resolve `@nocobase/plugin-feishu/client`
 * without 404 — it intentionally does nothing.
 */
export class PluginFeishuClient extends Plugin {
  async load() {
    // no-op: feishu management UI is only available in client-v2.
  }
}

export default PluginFeishuClient;
