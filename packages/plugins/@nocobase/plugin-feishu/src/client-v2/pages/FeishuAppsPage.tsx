/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import {
  DeleteOutlined,
  EditOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
  SyncOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useFlowContext } from '@nocobase/flow-engine';
import { useRequest } from 'ahooks';
import {
  App as AntdApp,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  theme,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import React, { useCallback, useMemo, useState } from 'react';
import { useT } from '../locale';

interface FeishuAppRecord {
  id: number;
  app_id: string;
  name?: string;
  status: 'active' | 'disabled';
  bot_name?: string;
  bot_open_id?: string;
  ai_employee_username?: string;
  ai_act_as_user_id?: number;
  last_connected_at?: string;
  last_error?: string;
}

interface FeishuAppFormState {
  app_id: string;
  app_secret?: string;
  name?: string;
  status: 'active' | 'disabled';
  encrypt_key?: string;
  verification_token?: string;
  ai_employee_username?: string;
  ai_act_as_user_id?: number;
}

interface ListResponseBody {
  data: FeishuAppRecord[];
  meta?: { count?: number; pageSize?: number; page?: number };
}

const formatDate = (value: string | undefined) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-');

const FeishuAppsPage: React.FC = () => {
  const t = useT();
  const ctx = useFlowContext();
  const { token } = theme.useToken();
  const { notification } = AntdApp.useApp();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FeishuAppRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyAppId, setBusyAppId] = useState<string | null>(null);
  const [form] = Form.useForm<FeishuAppFormState>();

  const listRequest = useRequest(async (): Promise<ListResponseBody> => {
    const response = await ctx.api.request<ListResponseBody>({
      url: 'feishu_apps:list',
      method: 'get',
      params: { pageSize: 50, sort: ['-createdAt'] },
      skipNotify: true,
    });
    return response?.data ?? { data: [] };
  });

  // Lazy-load AI Employee + User options the first time the modal opens, so
  // we don't pay the request cost when the operator just browses the table.
  const aiEmployeeRequest = useRequest(
    async (): Promise<{ data: Array<{ username: string; nickname?: string; position?: string }> }> => {
      const response = await ctx.api.request<{
        data: Array<{ username: string; nickname?: string; position?: string }>;
      }>({
        url: 'aiEmployees:list',
        method: 'get',
        params: { pageSize: 200, fields: ['username', 'nickname', 'position'] },
        skipNotify: true,
      });
      return response?.data ?? { data: [] };
    },
    { manual: true },
  );

  const userRequest = useRequest(
    async (): Promise<{ data: Array<{ id: number; nickname?: string; username?: string; email?: string }> }> => {
      const response = await ctx.api.request<{
        data: Array<{ id: number; nickname?: string; username?: string; email?: string }>;
      }>({
        url: 'users:list',
        method: 'get',
        params: { pageSize: 200, fields: ['id', 'nickname', 'username', 'email'] },
        skipNotify: true,
      });
      return response?.data ?? { data: [] };
    },
    { manual: true },
  );

  const ensureModalDataLoaded = useCallback(() => {
    if (!aiEmployeeRequest.data && !aiEmployeeRequest.loading) {
      aiEmployeeRequest.run();
    }
    if (!userRequest.data && !userRequest.loading) {
      userRequest.run();
    }
  }, [aiEmployeeRequest, userRequest]);

  const aiEmployeeOptions = useMemo(
    () =>
      (aiEmployeeRequest.data?.data ?? []).map((emp) => ({
        value: emp.username,
        label: emp.nickname ? `${emp.nickname} (${emp.username})` : emp.username,
      })),
    [aiEmployeeRequest.data],
  );

  const userOptions = useMemo(
    () =>
      (userRequest.data?.data ?? []).map((u) => ({
        value: u.id,
        label: u.nickname || u.username || u.email || `#${u.id}`,
      })),
    [userRequest.data],
  );

  const records = useMemo<FeishuAppRecord[]>(() => {
    const list = listRequest.data?.data;
    return Array.isArray(list) ? list : [];
  }, [listRequest.data]);

  const openCreateModal = useCallback(() => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: 'active' });
    setModalOpen(true);
    ensureModalDataLoaded();
  }, [form, ensureModalDataLoaded]);

  const openEditModal = useCallback(
    (record: FeishuAppRecord) => {
      setEditing(record);
      form.resetFields();
      form.setFieldsValue({
        app_id: record.app_id,
        name: record.name,
        status: record.status,
        ai_employee_username: record.ai_employee_username,
        ai_act_as_user_id: record.ai_act_as_user_id,
      });
      setModalOpen(true);
      ensureModalDataLoaded();
    },
    [form, ensureModalDataLoaded],
  );

  const handleCancel = useCallback(() => {
    setModalOpen(false);
    setEditing(null);
    form.resetFields();
  }, [form]);

  const handleSubmit = useCallback(async () => {
    let values: FeishuAppFormState;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        const payload: Partial<FeishuAppFormState> = { ...values };
        // For edit, only include secret-like fields when user actually entered something.
        if (!payload.app_secret) delete payload.app_secret;
        if (!payload.encrypt_key) delete payload.encrypt_key;
        if (!payload.verification_token) delete payload.verification_token;
        await ctx.api.request({
          url: `feishu_apps:update`,
          method: 'post',
          params: { filterByTk: editing.id },
          data: payload,
          skipNotify: true,
        });
      } else {
        await ctx.api.request({
          url: 'feishu_apps:create',
          method: 'post',
          data: values,
          skipNotify: true,
        });
      }
      notification.success({ message: t('Save succeeded') });
      setModalOpen(false);
      setEditing(null);
      form.resetFields();
      listRequest.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notification.error({ message: t('Save failed'), description: message });
    } finally {
      setSubmitting(false);
    }
  }, [ctx.api, editing, form, listRequest, notification, t]);

  const handleDelete = useCallback(
    async (record: FeishuAppRecord) => {
      try {
        await ctx.api.request({
          url: 'feishu_apps:destroy',
          method: 'post',
          params: { filterByTk: record.id },
          skipNotify: true,
        });
        notification.success({ message: t('Save succeeded') });
        listRequest.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        notification.error({ message: t('Operation failed'), description: message });
      }
    },
    [ctx.api, listRequest, notification, t],
  );

  const runRuntimeAction = useCallback(
    async (
      record: FeishuAppRecord,
      action: 'testConnection' | 'start' | 'stop' | 'reload',
      successKey: string,
      failKey: string,
    ) => {
      setBusyAppId(record.app_id);
      try {
        const response = await ctx.api.request<{ ok?: boolean; message?: string; code?: string }>({
          url: `feishuApps:${action}`,
          method: 'post',
          data: { appId: record.app_id },
          skipNotify: true,
        });
        const body = response?.data;
        if (body && body.ok === false) {
          notification.error({ message: t(failKey), description: body.message });
          return;
        }
        notification.success({ message: t(successKey) });
        listRequest.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        notification.error({ message: t(failKey), description: message });
      } finally {
        setBusyAppId(null);
      }
    },
    [ctx.api, listRequest, notification, t],
  );

  const columns = useMemo<ColumnsType<FeishuAppRecord>>(
    () => [
      { title: t('App ID'), dataIndex: 'app_id', ellipsis: true },
      { title: t('App name'), dataIndex: 'name', ellipsis: true },
      {
        title: t('Status'),
        dataIndex: 'status',
        width: 100,
        render: (value: string) =>
          value === 'active' ? <Tag color="green">{t('Active')}</Tag> : <Tag color="default">{t('Disabled')}</Tag>,
      },
      { title: t('Bot name'), dataIndex: 'bot_name', ellipsis: true },
      {
        title: t('Last connected at'),
        dataIndex: 'last_connected_at',
        render: (value: string | undefined) => formatDate(value),
      },
      {
        title: '',
        key: 'actions',
        width: 280,
        render: (_: unknown, record) => {
          const busy = busyAppId === record.app_id;
          return (
            <Space size="small">
              <Tooltip title={t('Edit')}>
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  aria-label={t('Edit')}
                  onClick={() => openEditModal(record)}
                />
              </Tooltip>
              <Tooltip title={t('Test connection')}>
                <Button
                  size="small"
                  icon={<ThunderboltOutlined />}
                  aria-label={t('Test connection')}
                  loading={busy}
                  onClick={() => runRuntimeAction(record, 'testConnection', 'Test passed', 'Test failed')}
                />
              </Tooltip>
              <Tooltip title={t('Start')}>
                <Button
                  size="small"
                  icon={<PlayCircleOutlined />}
                  aria-label={t('Start')}
                  loading={busy}
                  onClick={() => runRuntimeAction(record, 'start', 'Started', 'Operation failed')}
                />
              </Tooltip>
              <Tooltip title={t('Stop')}>
                <Button
                  size="small"
                  icon={<StopOutlined />}
                  aria-label={t('Stop')}
                  loading={busy}
                  onClick={() => runRuntimeAction(record, 'stop', 'Stopped', 'Operation failed')}
                />
              </Tooltip>
              <Tooltip title={t('Reload')}>
                <Button
                  size="small"
                  icon={<SyncOutlined />}
                  aria-label={t('Reload')}
                  loading={busy}
                  onClick={() => runRuntimeAction(record, 'reload', 'Reloaded', 'Operation failed')}
                />
              </Tooltip>
              <Popconfirm
                title={t('Confirm delete this app configuration?')}
                onConfirm={() => handleDelete(record)}
                okText={t('Delete')}
                cancelText={t('Cancel')}
              >
                <Tooltip title={t('Delete')}>
                  <Button size="small" danger icon={<DeleteOutlined />} aria-label={t('Delete')} />
                </Tooltip>
              </Popconfirm>
            </Space>
          );
        },
      },
    ],
    [busyAppId, handleDelete, openEditModal, runRuntimeAction, t],
  );

  return (
    <Card>
      <Flex justify="flex-end" style={{ marginBottom: token.marginMD }}>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => listRequest.refresh()} aria-label={t('Reload')}>
            {t('Reload')}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
            {t('Create')}
          </Button>
        </Space>
      </Flex>
      <Table<FeishuAppRecord>
        rowKey="id"
        loading={listRequest.loading}
        dataSource={records}
        columns={columns}
        pagination={false}
      />
      <Modal
        open={modalOpen}
        title={editing ? t('Edit') : t('Create')}
        onCancel={handleCancel}
        onOk={handleSubmit}
        confirmLoading={submitting}
        okText={t('Save')}
        cancelText={t('Cancel')}
        destroyOnClose
        maskClosable={false}
        width={560}
      >
        <Form<FeishuAppFormState> form={form} layout="vertical" initialValues={{ status: 'active' }} preserve={false}>
          <Form.Item name="app_id" label={t('App ID')} rules={[{ required: true, message: t('App ID') }]}>
            <Input disabled={!!editing} autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="app_secret"
            label={t('App Secret')}
            rules={editing ? [] : [{ required: true, message: t('App Secret') }]}
          >
            <Input.Password autoComplete="new-password" placeholder={editing ? t('Leave blank to keep current') : ''} />
          </Form.Item>
          <Form.Item name="name" label={t('App name')}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name="status" label={t('Status')} rules={[{ required: true, message: t('Status') }]}>
            <Select
              options={[
                { value: 'active', label: t('Active') },
                { value: 'disabled', label: t('Disabled') },
              ]}
            />
          </Form.Item>
          <Form.Item name="encrypt_key" label={t('Encrypt key')}>
            <Input.Password autoComplete="new-password" placeholder={editing ? t('Leave blank to keep current') : ''} />
          </Form.Item>
          <Form.Item name="verification_token" label={t('Verification token')}>
            <Input.Password autoComplete="new-password" placeholder={editing ? t('Leave blank to keep current') : ''} />
          </Form.Item>
          <Form.Item name="ai_employee_username" label={t('AI Employee username')}>
            <Select
              allowClear
              showSearch
              placeholder={t('Select AI Employee')}
              loading={aiEmployeeRequest.loading}
              options={aiEmployeeOptions}
              optionFilterProp="label"
              filterOption={(input, option) =>
                String(option?.label ?? '')
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
              notFoundContent={aiEmployeeRequest.loading ? t('Loading') : t('No AI Employees configured')}
            />
          </Form.Item>
          <Form.Item name="ai_act_as_user_id" label={t('Act as user (NocoBase ID)')}>
            <Select
              allowClear
              showSearch
              placeholder={t('Select user (NocoBase identity for AI tool calls)')}
              loading={userRequest.loading}
              options={userOptions}
              optionFilterProp="label"
              filterOption={(input, option) =>
                String(option?.label ?? '')
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
              notFoundContent={userRequest.loading ? t('Loading') : t('No matching users')}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default FeishuAppsPage;
