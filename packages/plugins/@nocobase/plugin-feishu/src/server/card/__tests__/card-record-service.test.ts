/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, it, expect, vi } from 'vitest';
import { CardRecordService } from '../card-record-service';
import { COLLECTION } from '../../constants';

function makeDeps(repo: { create?: any; findOne?: any }) {
  const getRepository = vi.fn((name: string) => {
    expect(name).toBe(COLLECTION.cardRecords);
    return repo;
  });
  return { db: { getRepository } };
}

describe('CardRecordService.recordSentCard', () => {
  it('writes a snake_case row with all fields including snapshots', async () => {
    const create = vi.fn().mockResolvedValue({ id: 1 });
    const service = new CardRecordService(makeDeps({ create }));
    const cardSchema = { config: { wide_screen_mode: true }, elements: [] };
    const callback = { actions: [{ action_key: 'k', handler: { kind: 'callback', name: 'do' } }] };
    const ctx = { userId: 1 };
    await service.recordSentCard({
      appId: 'app1',
      messageId: 'om_msg',
      openMessageId: 'om_open',
      cardTemplateKey: 'tpl1',
      cardSchemaSnapshot: cardSchema,
      callbackConfigSnapshot: callback,
      context: ctx,
      createdById: 7,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      values: {
        app_id: 'app1',
        message_id: 'om_msg',
        open_message_id: 'om_open',
        card_template_key: 'tpl1',
        card_schema_snapshot: cardSchema,
        callback_config_snapshot: callback,
        context: ctx,
        created_by_id: 7,
      },
    });
  });

  it('passes snapshot fields as-is (objects, not stringified)', async () => {
    const create = vi.fn().mockResolvedValue({ id: 2 });
    const service = new CardRecordService(makeDeps({ create }));
    const snapshot = { foo: { bar: 'baz' } };
    await service.recordSentCard({
      appId: 'app',
      messageId: 'm',
      cardSchemaSnapshot: snapshot,
      callbackConfigSnapshot: snapshot,
      context: {},
    });
    const args = create.mock.calls[0][0];
    expect(args.values.card_schema_snapshot).toBe(snapshot);
    expect(args.values.callback_config_snapshot).toBe(snapshot);
  });
});

describe('CardRecordService.findByMessageId', () => {
  it('queries with { app_id, message_id }', async () => {
    const findOne = vi
      .fn()
      .mockResolvedValue({ id: 1, card_schema_snapshot: {}, callback_config_snapshot: {}, context: {} });
    const service = new CardRecordService(makeDeps({ findOne }));
    const result = await service.findByMessageId('appA', 'msg1');
    expect(findOne).toHaveBeenCalledWith({ filter: { app_id: 'appA', message_id: 'msg1' } });
    expect(result).toEqual({ id: 1, card_schema_snapshot: {}, callback_config_snapshot: {}, context: {} });
  });

  it('returns null when not found', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const service = new CardRecordService(makeDeps({ findOne }));
    expect(await service.findByMessageId('appA', 'missing')).toBeNull();
  });

  it('returns null when repo returns undefined', async () => {
    const findOne = vi.fn().mockResolvedValue(undefined);
    const service = new CardRecordService(makeDeps({ findOne }));
    expect(await service.findByMessageId('appA', 'missing')).toBeNull();
  });
});

describe('CardRecordService.findByOpenMessageId', () => {
  it('queries with { app_id, open_message_id }', async () => {
    const findOne = vi
      .fn()
      .mockResolvedValue({ id: 2, card_schema_snapshot: {}, callback_config_snapshot: {}, context: {} });
    const service = new CardRecordService(makeDeps({ findOne }));
    const result = await service.findByOpenMessageId('appB', 'open1');
    expect(findOne).toHaveBeenCalledWith({ filter: { app_id: 'appB', open_message_id: 'open1' } });
    expect(result?.id).toBe(2);
  });

  it('returns null when not found', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const service = new CardRecordService(makeDeps({ findOne }));
    expect(await service.findByOpenMessageId('appB', 'gone')).toBeNull();
  });
});
