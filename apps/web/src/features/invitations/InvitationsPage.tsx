import { ArrowLeftOutlined, CopyOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Col, Form, Input, Modal, Row, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import type { InvitationOutput, InviteStatus } from '@zakupki/shared';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { formatDateTime } from '../../lib/format';
import { fetchTenderDetail } from '../admin/api';
import { createInvitations, fetchTenderInvitations, revokeInvitation } from './api';

const { Title, Text, Paragraph } = Typography;

const STATUS: Record<InviteStatus, { label: string; color: string }> = {
  pending: { label: 'Отправлено', color: 'blue' },
  opened: { label: 'Открыто', color: 'gold' },
  accepted: { label: 'Принято', color: 'green' },
  expired: { label: 'Истекло', color: 'default' },
  revoked: { label: 'Отозвано', color: 'red' },
};

export function InvitationsPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [createdLink, setCreatedLink] = useState<string | null>(null);

  const { data: tender } = useQuery({ queryKey: ['tender', id], queryFn: () => fetchTenderDetail(id) });
  const { data: invites, isLoading } = useQuery({
    queryKey: ['invitations', id],
    queryFn: () => fetchTenderInvitations(id),
  });

  const create = useMutation({
    mutationFn: (v: { email: string; companyName?: string; suggestedInn?: string }) =>
      createInvitations(id, { invitations: [v] }),
    onSuccess: (res) => {
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['invitations', id] });
      setCreatedLink(res[0]?.link ?? null);
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : 'Ошибка'),
  });

  const revoke = useMutation({
    mutationFn: (invId: string) => revokeInvitation(invId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations', id] }),
  });

  const copy = (link: string) => {
    navigator.clipboard?.writeText(link).then(() => message.success('Ссылка скопирована'));
  };

  return (
    <div>
      <Button type="link" icon={<ArrowLeftOutlined />} style={{ paddingLeft: 0 }} onClick={() => navigate(`/admin/tenders/${id}`)}>
        К тендеру
      </Button>
      <Title level={3} style={{ marginBottom: 4 }}>
        Приглашения
      </Title>
      {tender && (
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          {tender.number} — {tender.title} {tender.visibility === 'closed' ? '(закрытый)' : '(открытый)'}
        </Text>
      )}

      <Row gutter={24}>
        <Col xs={24} lg={9}>
          <Card title="Пригласить участника" size="small">
            <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
              <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
                <Input placeholder="supplier@company.ru" />
              </Form.Item>
              <Form.Item name="companyName" label="Наименование (опц.)">
                <Input placeholder="ООО «…»" />
              </Form.Item>
              <Form.Item name="suggestedInn" label="ИНН (опц.)">
                <Input placeholder="10 или 12 цифр" />
              </Form.Item>
              <Button type="primary" icon={<PlusOutlined />} htmlType="submit" loading={create.isPending} block>
                Создать приглашение
              </Button>
            </Form>
            <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
              Приглашённый получит письмо со ссылкой и сможет участвовать без предварительной аккредитации,
              заполнив карточку компании.
            </Paragraph>
          </Card>
        </Col>
        <Col xs={24} lg={15}>
          <Card title={`Список приглашений (${invites?.length ?? 0})`} size="small">
            <Table<InvitationOutput>
              rowKey="id"
              size="small"
              loading={isLoading}
              dataSource={invites ?? []}
              pagination={false}
              locale={{ emptyText: 'Приглашений пока нет' }}
              columns={[
                { title: 'Email', dataIndex: 'email' },
                { title: 'Компания', dataIndex: 'companyName', render: (v) => v ?? '—' },
                {
                  title: 'Статус',
                  dataIndex: 'status',
                  width: 130,
                  render: (s: InviteStatus) => <Tag color={STATUS[s].color}>{STATUS[s].label}</Tag>,
                },
                { title: 'Действует до', dataIndex: 'expiresAt', width: 120, render: (v) => formatDateTime(v) },
                {
                  title: '',
                  width: 100,
                  render: (_, r) =>
                    ['pending', 'opened'].includes(r.status) ? (
                      <Button size="small" danger type="text" onClick={() => revoke.mutate(r.id)}>
                        Отозвать
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Modal
        open={!!createdLink}
        title="Приглашение создано"
        onCancel={() => setCreatedLink(null)}
        footer={<Button onClick={() => setCreatedLink(null)}>Закрыть</Button>}
      >
        <Paragraph>Письмо отправлено. Ссылку можно также передать напрямую:</Paragraph>
        <Space.Compact style={{ width: '100%' }}>
          <Input readOnly value={createdLink ?? ''} />
          <Button icon={<CopyOutlined />} onClick={() => createdLink && copy(createdLink)}>
            Копировать
          </Button>
        </Space.Compact>
      </Modal>
    </div>
  );
}
