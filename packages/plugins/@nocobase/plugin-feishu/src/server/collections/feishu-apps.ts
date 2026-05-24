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
  name: COLLECTION.apps,
  title: 'Feishu Apps',
  autoGenId: true,
  createdBy: true,
  updatedBy: true,
  createdAt: true,
  updatedAt: true,
  fields: [
    { type: 'string', name: 'app_id', unique: true, allowNull: false },
    // Secrets are stored as AES-encrypted strings (see plugin.ts beforeSave
    // hook). Do NOT use the `password` field type — that one is scrypt-hashed
    // and the original value cannot be recovered, which is incompatible with
    // an outbound credential we need to hand back to the Lark SDK.
    { type: 'text', name: 'app_secret', allowNull: false },
    { type: 'string', name: 'name' },
    { type: 'string', name: 'status', defaultValue: 'active' },
    { type: 'text', name: 'encrypt_key' },
    { type: 'text', name: 'verification_token' },
    { type: 'string', name: 'bot_open_id' },
    { type: 'string', name: 'bot_name' },
    { type: 'string', name: 'ai_employee_username' },
    { type: 'integer', name: 'ai_act_as_user_id' },
    { type: 'integer', name: 'config_version', defaultValue: 0 },
    { type: 'date', name: 'last_connected_at' },
    { type: 'text', name: 'last_error' },
  ],
});
