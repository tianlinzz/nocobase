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
  name: COLLECTION.cardActionLogs,
  title: 'Feishu Card Action Logs',
  autoGenId: true,
  createdAt: true,
  updatedAt: false,
  fields: [
    { type: 'string', name: 'app_id', allowNull: false },
    { type: 'string', name: 'event_id', allowNull: false },
    { type: 'integer', name: 'card_record_id' },
    { type: 'string', name: 'message_id' },
    { type: 'string', name: 'action_key' },
    { type: 'json', name: 'action_values' },
    { type: 'string', name: 'executor_open_id' },
    { type: 'integer', name: 'executor_user_id' },
    { type: 'string', name: 'result' },
    { type: 'json', name: 'result_detail' },
  ],
  indexes: [{ unique: true, fields: ['app_id', 'event_id'] }, { fields: ['card_record_id', 'action_key'] }],
});
