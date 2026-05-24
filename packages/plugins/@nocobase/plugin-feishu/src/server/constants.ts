/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

export const PLUGIN_NAME = 'feishu';

export const COLLECTION = {
  apps: 'feishu_apps',
  messageLogs: 'feishu_message_logs',
  cardRecords: 'feishu_card_records',
  cardActionLogs: 'feishu_card_action_logs',
  userBindings: 'feishu_user_bindings',
} as const;

export const CACHE_NAMESPACE = 'plugin-feishu';

export const QUEUE_PREFIX = 'plugin-feishu.message';
