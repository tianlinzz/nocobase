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
  name: COLLECTION.messageLogs,
  title: 'Feishu Message Logs',
  autoGenId: true,
  createdAt: true,
  updatedAt: false,
  fields: [
    { type: 'string', name: 'app_id', allowNull: false },
    { type: 'string', name: 'event_id' },
    { type: 'string', name: 'message_id' },
    { type: 'string', name: 'chat_id' },
    { type: 'string', name: 'sender_open_id' },
    { type: 'string', name: 'message_type' },
    { type: 'string', name: 'route_action' },
    { type: 'string', name: 'status' },
    { type: 'string', name: 'ai_session_id' },
    { type: 'text', name: 'error' },
  ],
  indexes: [
    { unique: true, fields: ['app_id', 'event_id'] },
    { fields: ['app_id', 'message_id'] },
    { fields: ['app_id', 'status', 'createdAt'] },
  ],
});
