/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { COLLECTION } from '../constants';

export interface RecordSentCardParams {
  appId: string;
  messageId: string;
  openMessageId?: string;
  cardTemplateKey?: string;
  cardSchemaSnapshot: unknown;
  callbackConfigSnapshot: unknown;
  context: Record<string, unknown>;
  createdById?: number;
}

export interface CardRecordRow {
  id: number;
  card_schema_snapshot: unknown;
  callback_config_snapshot: unknown;
  context: Record<string, unknown>;
}

interface CardRecordRepository {
  create(options: { values: Record<string, unknown> }): Promise<unknown>;
  findOne(options: { filter: Record<string, unknown> }): Promise<CardRecordRow | null | undefined>;
}

interface CardRecordServiceDeps {
  db: { getRepository: (name: string) => CardRecordRepository };
}

export class CardRecordService {
  constructor(private readonly deps: CardRecordServiceDeps) {}

  private getRepo(): CardRecordRepository {
    return this.deps.db.getRepository(COLLECTION.cardRecords);
  }

  async recordSentCard(params: RecordSentCardParams): Promise<void> {
    const values: Record<string, unknown> = {
      app_id: params.appId,
      message_id: params.messageId,
      card_schema_snapshot: params.cardSchemaSnapshot,
      callback_config_snapshot: params.callbackConfigSnapshot,
      context: params.context,
    };
    if (params.openMessageId !== undefined) values.open_message_id = params.openMessageId;
    if (params.cardTemplateKey !== undefined) values.card_template_key = params.cardTemplateKey;
    if (params.createdById !== undefined) values.created_by_id = params.createdById;
    await this.getRepo().create({ values });
  }

  async findByMessageId(appId: string, messageId: string): Promise<CardRecordRow | null> {
    const row = await this.getRepo().findOne({ filter: { app_id: appId, message_id: messageId } });
    return row ?? null;
  }

  async findByOpenMessageId(appId: string, openMessageId: string): Promise<CardRecordRow | null> {
    const row = await this.getRepo().findOne({ filter: { app_id: appId, open_message_id: openMessageId } });
    return row ?? null;
  }
}
