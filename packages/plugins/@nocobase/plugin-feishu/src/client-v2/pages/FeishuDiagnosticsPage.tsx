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
import { Button, Card, Empty, Flex, Space, Switch, Table, Tag, theme, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '../locale';

interface RuntimeAppInfo {
  appId: string;
  state?: string;
  reconnectCount?: number;
  lastError?: string;
  lastConnectedAt?: string;
}

interface RuntimeOverviewResponse {
  apps?: RuntimeAppInfo[];
}

interface QueueAppStat {
  appId: string;
  queueLength: number;
  lastErrors?: string[];
}

interface QueueResponse {
  apps?: QueueAppStat[];
}

interface ConnectionsResponse {
  connectedAppIds?: string[];
  overview?: RuntimeOverviewResponse;
}

const stateColor = (state: string | undefined): string => {
  switch (state) {
    case 'running':
    case 'connected':
      return 'green';
    case 'connecting':
    case 'reconnecting':
      return 'blue';
    case 'failed':
    case 'error':
      return 'red';
    case 'stopped':
      return 'default';
    default:
      return 'gold';
  }
};

const FeishuDiagnosticsPage: React.FC = () => {
  const t = useT();
  const ctx = useFlowContext();
  const { token } = theme.useToken();
  const [autoRefresh, setAutoRefresh] = useState(false);

  const overviewRequest = useRequest(async (): Promise<RuntimeOverviewResponse> => {
    const response = await ctx.api.request<RuntimeOverviewResponse>({
      url: 'feishuApps:runtimeOverview',
      method: 'post',
      skipNotify: true,
    });
    return response?.data ?? {};
  });

  const queueRequest = useRequest(async (): Promise<QueueResponse> => {
    const response = await ctx.api.request<QueueResponse>({
      url: 'feishuDiagnostics:queue',
      method: 'post',
      skipNotify: true,
    });
    return response?.data ?? {};
  });

  const connectionsRequest = useRequest(async (): Promise<ConnectionsResponse> => {
    const response = await ctx.api.request<ConnectionsResponse>({
      url: 'feishuDiagnostics:connections',
      method: 'post',
      skipNotify: true,
    });
    return response?.data ?? {};
  });

  const refreshAll = useCallback(() => {
    overviewRequest.refresh();
    queueRequest.refresh();
    connectionsRequest.refresh();
  }, [connectionsRequest, overviewRequest, queueRequest]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      refreshAll();
    }, 10000);
    return () => clearInterval(id);
  }, [autoRefresh, refreshAll]);

  const overviewApps = overviewRequest.data?.apps ?? [];
  const queueApps = queueRequest.data?.apps ?? [];
  const connectedAppIds = connectionsRequest.data?.connectedAppIds ?? [];
  const connectionsOverviewApps = connectionsRequest.data?.overview?.apps ?? [];

  const queueColumns = useMemo<ColumnsType<QueueAppStat>>(
    () => [
      { title: t('App ID'), dataIndex: 'appId' },
      { title: t('Queue length'), dataIndex: 'queueLength', width: 140 },
      {
        title: t('Recent errors'),
        dataIndex: 'lastErrors',
        render: (value: string[] | undefined) => {
          if (!value || value.length === 0) return '-';
          return (
            <Space direction="vertical" size={0} style={{ width: '100%' }}>
              {value.map((msg, idx) => (
                <Typography.Text key={idx} type="danger" ellipsis={{ tooltip: msg }}>
                  {msg}
                </Typography.Text>
              ))}
            </Space>
          );
        },
      },
    ],
    [t],
  );

  const connectionsColumns = useMemo<ColumnsType<RuntimeAppInfo>>(
    () => [
      { title: t('App ID'), dataIndex: 'appId' },
      {
        title: t('Connection state'),
        dataIndex: 'state',
        width: 160,
        render: (value: string | undefined) => (value ? <Tag color={stateColor(value)}>{value}</Tag> : '-'),
      },
      { title: t('Reconnect count'), dataIndex: 'reconnectCount', width: 140 },
    ],
    [t],
  );

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Card
        title={t('Connection state')}
        extra={
          <Space>
            <span>
              <Switch checked={autoRefresh} onChange={setAutoRefresh} aria-label={t('Auto refresh')} />{' '}
              {t('Auto refresh')}
            </span>
            <Button size="small" icon={<ReloadOutlined />} onClick={refreshAll} aria-label={t('Reload')}>
              {t('Reload')}
            </Button>
          </Space>
        }
      >
        {overviewApps.length === 0 ? (
          <Empty />
        ) : (
          <Flex gap={token.marginXS} wrap>
            {overviewApps.map((app) => (
              <Tag key={app.appId} color={stateColor(app.state)}>
                {app.appId}: {app.state ?? '-'}
              </Tag>
            ))}
          </Flex>
        )}
      </Card>
      <Card title={t('Queue length')}>
        <Table<QueueAppStat>
          rowKey="appId"
          dataSource={queueApps}
          columns={queueColumns}
          loading={queueRequest.loading}
          pagination={false}
          size="small"
        />
      </Card>
      <Card title={t('Connection state')}>
        <Flex vertical gap={token.marginSM}>
          <Flex gap={token.marginXS} wrap>
            {connectedAppIds.length === 0 ? (
              <Empty />
            ) : (
              connectedAppIds.map((id) => (
                <Tag key={id} color="blue">
                  {id}
                </Tag>
              ))
            )}
          </Flex>
          <Table<RuntimeAppInfo>
            rowKey="appId"
            dataSource={connectionsOverviewApps}
            columns={connectionsColumns}
            loading={connectionsRequest.loading}
            pagination={false}
            size="small"
          />
        </Flex>
      </Card>
    </Space>
  );
};

export default FeishuDiagnosticsPage;
