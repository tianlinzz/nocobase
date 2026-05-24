/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { defineCollection } from '@nocobase/database';
import { COLLECTION } from '../constants';

export default defineCollection({
  name: COLLECTION.cardRecords,
  title: 'Feishu Card Records',
  autoGenId: true,
  createdAt: true,
  updatedAt: true,
  fields: [
    { type: 'string', name: 'app_id', allowNull: false },
    { type: 'string', name: 'message_id', allowNull: false },
    { type: 'string', name: 'open_message_id' },
    { type: 'string', name: 'card_template_key' },
    { type: 'json', name: 'card_schema_snapshot' },
    { type: 'json', name: 'callback_config_snapshot' },
    { type: 'json', name: 'context' },
    { type: 'integer', name: 'created_by_id' },
  ],
  indexes: [{ unique: true, fields: ['app_id', 'message_id'] }, { fields: ['app_id', 'open_message_id'] }],
});
