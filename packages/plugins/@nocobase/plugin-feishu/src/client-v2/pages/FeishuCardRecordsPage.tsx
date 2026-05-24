/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { ReloadOutlined } from '@ant-design/icons';
import { useFlowContext } from '@nocobase/flow-engine';
import { useRequest } from 'ahooks';
import { Button, Card, Drawer, Flex, Select, Space, Table, theme } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import React, { useMemo, useState } from 'react';
import { useT } from '../locale';

interface CardRecord {
  id: number;
  app_id: string;
  message_id?: string;
  open_message_id?: string;
  card_template_key?: string;
  created_by_id?: number;
  createdAt?: string;
  card_schema_snapshot?: unknown;
  callback_config_snapshot?: unknown;
}

interface CardRecordListResponse {
  data: CardRecord[];
  meta?: { count?: number; pageSize?: number; page?: number };
}

interface AppOption {
  id: number;
  app_id: string;
  name?: string;
}

interface AppListResponse {
  data: AppOption[];
}

const formatJson = (value: unknown): string => {
  if (value == null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const FeishuCardRecordsPage: React.FC = () => {
  const t = useT();
  const ctx = useFlowContext();
  const { token } = theme.useToken();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [appFilter, setAppFilter] = useState<string | undefined>(undefined);
  const [drawerRecord, setDrawerRecord] = useState<CardRecord | null>(null);

  const appsRequest = useRequest(async (): Promise<AppListResponse> => {
    const response = await ctx.api.request<AppListResponse>({
      url: 'feishu_apps:list',
      method: 'get',
      params: { pageSize: 50 },
      skipNotify: true,
    });
    return response?.data ?? { data: [] };
  });

  const appOptions = useMemo(
    () =>
      (appsRequest.data?.data ?? []).map((row) => ({
        value: row.app_id,
        label: row.name ? `${row.name} (${row.app_id})` : row.app_id,
      })),
    [appsRequest.data],
  );

  const listRequest = useRequest(
    async (): Promise<CardRecordListResponse> => {
      const params: Record<string, unknown> = {
        page,
        pageSize,
        sort: ['-createdAt'],
      };
      if (appFilter) {
        params.filter = { app_id: appFilter };
      }
      const response = await ctx.api.request<CardRecordListResponse>({
        url: 'feishu_card_records:list',
        method: 'get',
        params,
        skipNotify: true,
      });
      return response?.data ?? { data: [] };
    },
    {
      refreshDeps: [page, pageSize, appFilter],
    },
  );

  const records = listRequest.data?.data ?? [];
  const meta = listRequest.data?.meta;

  const columns = useMemo<ColumnsType<CardRecord>>(
    () => [
      { title: 'ID', dataIndex: 'id', width: 80 },
      { title: t('App ID'), dataIndex: 'app_id', ellipsis: true },
      { title: 'message_id', dataIndex: 'message_id', ellipsis: true },
      { title: 'open_message_id', dataIndex: 'open_message_id', ellipsis: true },
      { title: 'card_template_key', dataIndex: 'card_template_key', ellipsis: true },
      { title: t('Created by'), dataIndex: 'created_by_id', width: 110 },
      {
        title: t('Created at'),
        dataIndex: 'createdAt',
        render: (value: string | undefined) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-'),
      },
    ],
    [t],
  );

  return (
    <Card>
      <Flex justify="space-between" align="center" style={{ marginBottom: token.marginMD }}>
        <Space>
          <Select<string>
            allowClear
            placeholder={t('App ID')}
            value={appFilter}
            onChange={(value) => {
              setAppFilter(value);
              setPage(1);
            }}
            options={appOptions}
            style={{ minWidth: 240 }}
            aria-label={t('App ID')}
          />
        </Space>
        <Button icon={<ReloadOutlined />} onClick={() => listRequest.refresh()} aria-label={t('Reload')}>
          {t('Reload')}
        </Button>
      </Flex>
      <Table<CardRecord>
        rowKey="id"
        loading={listRequest.loading}
        dataSource={records}
        columns={columns}
        onRow={(record) => ({
          onClick: () => setDrawerRecord(record),
          style: { cursor: 'pointer' },
        })}
        pagination={{
          total: meta?.count ?? records.length,
          current: meta?.page ?? page,
          pageSize: meta?.pageSize ?? pageSize,
          onChange: (next, nextSize) => {
            setPage(next);
            setPageSize(nextSize);
          },
        }}
      />
      <Drawer
        open={drawerRecord !== null}
        onClose={() => setDrawerRecord(null)}
        title={drawerRecord ? `#${drawerRecord.id} ${drawerRecord.app_id}` : ''}
        width={640}
      >
        {drawerRecord && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <section aria-label={t('Card schema snapshot')}>
              <h4>{t('Card schema snapshot')}</h4>
              <pre
                aria-label={t('Card schema snapshot')}
                style={{
                  background: token.colorFillTertiary,
                  padding: token.paddingSM,
                  borderRadius: token.borderRadius,
                  maxHeight: 320,
                  overflow: 'auto',
                }}
              >
                {formatJson(drawerRecord.card_schema_snapshot)}
              </pre>
            </section>
            <section aria-label={t('Callback config snapshot')}>
              <h4>{t('Callback config snapshot')}</h4>
              <pre
                aria-label={t('Callback config snapshot')}
                style={{
                  background: token.colorFillTertiary,
                  padding: token.paddingSM,
                  borderRadius: token.borderRadius,
                  maxHeight: 320,
                  overflow: 'auto',
                }}
              >
                {formatJson(drawerRecord.callback_config_snapshot)}
              </pre>
            </section>
          </Space>
        )}
      </Drawer>
    </Card>
  );
};

export default FeishuCardRecordsPage;
