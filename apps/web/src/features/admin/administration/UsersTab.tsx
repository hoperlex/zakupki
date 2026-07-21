import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from 'antd';
import { useState } from 'react';
import type {
  CounterpartySummary,
  CreateUserInput,
  Role,
  UpdateUserInput,
  UserSummary,
} from '@zakupki/shared';
import { ROLES } from '@zakupki/shared';
import { api, ApiError } from '../../../api/client';
import { roleLabel } from '../../../lib/nav';
import { formatDateTime } from '../../../lib/format';
import { changeUserPassword, createUser, deleteUser, listUsers, updateUser } from './api';

const roleOptions = ROLES.map((r) => ({ label: roleLabel(r as Role), value: r }));

type FormState = { mode: 'create' } | { mode: 'edit'; user: UserSummary } | null;

function errText(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Что-то пошло не так';
}

export function UsersTab() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [formState, setFormState] = useState<FormState>(null);
  const [pwUser, setPwUser] = useState<UserSummary | null>(null);

  const { data: users, isLoading } = useQuery({ queryKey: ['admin-users'], queryFn: listUsers });
  const { data: orgs } = useQuery({
    queryKey: ['counterparties'],
    queryFn: () => api<CounterpartySummary[]>('/orgs/counterparties'),
  });
  const orgOptions = (orgs ?? []).map((o) => ({ label: o.shortName ?? o.fullName, value: o.id }));

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-users'] });

  const createMut = useMutation({
    mutationFn: (body: CreateUserInput) => createUser(body),
    onSuccess: () => {
      message.success('Пользователь создан');
      setFormState(null);
      invalidate();
    },
    onError: (err) => message.error(errText(err)),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUserInput }) => updateUser(id, body),
    onSuccess: () => {
      message.success('Изменения сохранены');
      setFormState(null);
      invalidate();
    },
    onError: (err) => message.error(errText(err)),
  });

  const pwMut = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      changeUserPassword(id, { password }),
    onSuccess: () => {
      message.success('Пароль изменён');
      setPwUser(null);
    },
    onError: (err) => message.error(errText(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: () => {
      message.success('Пользователь удалён');
      invalidate();
    },
    onError: (err) => message.error(errText(err)),
  });

  const toggleActive = (u: UserSummary) =>
    updateMut.mutate({ id: u.id, body: { isActive: !u.isActive } });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button type="primary" onClick={() => setFormState({ mode: 'create' })}>
          Добавить пользователя
        </Button>
      </div>

      <Table<UserSummary>
        rowKey="id"
        loading={isLoading}
        dataSource={users ?? []}
        columns={[
          { title: 'ФИО', dataIndex: 'fullName' },
          { title: 'Email', dataIndex: 'email' },
          { title: 'Телефон', dataIndex: 'phone', width: 150, render: (v) => v ?? '—' },
          { title: 'Роль', dataIndex: 'role', width: 180, render: (r: Role) => roleLabel(r) },
          {
            title: 'Организация',
            dataIndex: 'organizationName',
            render: (v) => v ?? '—',
          },
          {
            title: 'Статус',
            dataIndex: 'isActive',
            width: 120,
            render: (a: boolean) =>
              a ? <Tag color="green">Активен</Tag> : <Tag>Неактивен</Tag>,
          },
          {
            title: 'Вход',
            dataIndex: 'lastLoginAt',
            width: 160,
            render: (v) => (v ? formatDateTime(v) : '—'),
          },
          {
            title: '',
            key: 'actions',
            width: 320,
            render: (_, u) => (
              <Space size="small">
                <Button size="small" onClick={() => setFormState({ mode: 'edit', user: u })}>
                  Изменить
                </Button>
                <Button size="small" onClick={() => setPwUser(u)}>
                  Пароль
                </Button>
                <Button
                  size="small"
                  onClick={() => toggleActive(u)}
                  loading={updateMut.isPending}
                >
                  {u.isActive ? 'Деактивировать' : 'Активировать'}
                </Button>
                <Popconfirm
                  title="Удалить пользователя?"
                  okText="Удалить"
                  okButtonProps={{ danger: true }}
                  cancelText="Отмена"
                  onConfirm={() => deleteMut.mutate(u.id)}
                >
                  <Button size="small" danger>
                    Удалить
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <UserFormModal
        state={formState}
        roleOptions={roleOptions}
        orgOptions={orgOptions}
        submitting={createMut.isPending || updateMut.isPending}
        onCancel={() => setFormState(null)}
        onCreate={(body) => createMut.mutate(body)}
        onUpdate={(id, body) => updateMut.mutate({ id, body })}
      />

      <PasswordModal
        user={pwUser}
        submitting={pwMut.isPending}
        onCancel={() => setPwUser(null)}
        onSubmit={(password) => pwUser && pwMut.mutate({ id: pwUser.id, password })}
      />
    </div>
  );
}

type Option = { label: string; value: string };

function UserFormModal({
  state,
  roleOptions,
  orgOptions,
  submitting,
  onCancel,
  onCreate,
  onUpdate,
}: {
  state: FormState;
  roleOptions: Option[];
  orgOptions: Option[];
  submitting: boolean;
  onCancel: () => void;
  onCreate: (body: CreateUserInput) => void;
  onUpdate: (id: string, body: UpdateUserInput) => void;
}) {
  const [form] = Form.useForm();
  const open = state !== null;
  const isEdit = state?.mode === 'edit';
  const editing = state?.mode === 'edit' ? state.user : null;

  const initialValues = editing
    ? {
        fullName: editing.fullName,
        email: editing.email,
        phone: editing.phone ?? undefined,
        role: editing.role,
        organizationId: editing.organizationId ?? undefined,
        isActive: editing.isActive,
      }
    : { role: 'supplier', isActive: true };

  const onOk = async () => {
    const values = await form.validateFields();
    const common = {
      fullName: values.fullName,
      email: values.email,
      phone: values.phone ? values.phone : null,
      role: values.role as Role,
      organizationId: values.organizationId ?? null,
      isActive: values.isActive,
    };
    if (isEdit && editing) onUpdate(editing.id, common);
    else onCreate({ ...common, password: values.password });
  };

  return (
    <Modal
      title={isEdit ? 'Редактирование пользователя' : 'Новый пользователь'}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      okText={isEdit ? 'Сохранить' : 'Создать'}
      cancelText="Отмена"
      confirmLoading={submitting}
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={initialValues} preserve={false}>
        <Form.Item name="fullName" label="ФИО" rules={[{ required: true, message: 'Укажите ФИО' }]}>
          <Input placeholder="Иванов Иван Иванович" />
        </Form.Item>
        <Form.Item
          name="email"
          label="Email"
          rules={[{ required: true, type: 'email', message: 'Введите корректный email' }]}
        >
          <Input placeholder="user@company.ru" />
        </Form.Item>
        <Form.Item name="phone" label="Телефон">
          <Input placeholder="+7 999 000-00-00" />
        </Form.Item>
        {!isEdit && (
          <Form.Item
            name="password"
            label="Пароль"
            rules={[{ required: true, min: 8, message: 'Минимум 8 символов' }]}
          >
            <Input.Password placeholder="Минимум 8 символов" autoComplete="new-password" />
          </Form.Item>
        )}
        <Form.Item name="role" label="Роль" rules={[{ required: true, message: 'Выберите роль' }]}>
          <Select options={roleOptions} />
        </Form.Item>
        <Form.Item name="organizationId" label="Организация">
          <Select allowClear showSearch optionFilterProp="label" options={orgOptions} placeholder="—" />
        </Form.Item>
        <Form.Item name="isActive" label="Активен" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function PasswordModal({
  user,
  submitting,
  onCancel,
  onSubmit,
}: {
  user: UserSummary | null;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}) {
  const [form] = Form.useForm();
  const onOk = async () => {
    const { password } = await form.validateFields();
    onSubmit(password);
  };
  return (
    <Modal
      title={user ? `Смена пароля — ${user.fullName}` : 'Смена пароля'}
      open={user !== null}
      onOk={onOk}
      onCancel={onCancel}
      okText="Сменить"
      cancelText="Отмена"
      confirmLoading={submitting}
      destroyOnClose
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="password"
          label="Новый пароль"
          rules={[{ required: true, min: 8, message: 'Минимум 8 символов' }]}
        >
          <Input.Password placeholder="Минимум 8 символов" autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
