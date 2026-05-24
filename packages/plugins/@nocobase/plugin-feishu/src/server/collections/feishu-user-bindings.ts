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
  name: COLLECTION.userBindings,
  title: 'Feishu User Bindings',
  autoGenId: true,
  createdAt: true,
  updatedAt: true,
  fields: [
    { type: 'string', name: 'app_id', allowNull: false },
    { type: 'string', name: 'open_id', allowNull: false },
    { type: 'string', name: 'union_id' },
    { type: 'integer', name: 'user_id' },
    { type: 'date', name: 'bound_at' },
  ],
  indexes: [{ unique: true, fields: ['app_id', 'open_id'] }, { fields: ['app_id', 'user_id'] }],
});
