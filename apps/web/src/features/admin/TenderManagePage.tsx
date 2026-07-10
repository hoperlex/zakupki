import {
  ArrowLeftOutlined,
  BarChartOutlined,
  CloseCircleOutlined,
  EditOutlined,
  SendOutlined,
  UsergroupAddOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Modal,
  Popconfirm,
  Row,
  Space,
  Spin,
  Table,
  Tabs,
  Typography,
} from 'antd';
import { useState } from 'react';
import {
  TENDER_TYPE_LABELS,
  VAT_RATE_LABELS,
  type PositionInput,
  type PositionOutput,
} from '@zakupki/shared';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { DeadlineCountdown } from '../../components/DeadlineCountdown';
import { DocumentUpload } from '../../components/DocumentUpload';
import { PositionsEditor } from '../../components/PositionsEditor';
import { TenderStatusTag } from '../../components/StatusTag';
import { formatMoney, formatQty } from '../../lib/format';
import { cancelTender, fetchTenderDetail, publishTender, setPositions } from './api';

const { Title, Text, Paragraph } = Typography;

export function TenderManagePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [editing, setEditing] = useState(false);
  const [posForm] = Form.useForm<{ positions: PositionInput[] }>();

  const { data: tender, isLoading } = useQuery({
    queryKey: ['tender', id],
    queryFn: () => fetchTenderDetail(id),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tender', id] });
    qc.invalidateQueries({ queryKey: ['admin-tenders'] });
  };

  const publish = useMutation({
    mutationFn: () => publishTender(id),
    onSuccess: () => {
      message.success('Тендер опубликован');
      invalidate();
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Ошибка'),
  });
  const cancel = useMutation({
    mutationFn: () => cancelTender(id),
    onSuccess: () => {
      message.success('Тендер отменён');
      invalidate();
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Ошибка'),
  });
  const savePositions = useMutation({
    mutationFn: (positions: PositionInput[]) => setPositions(id, positions),
    onSuccess: () => {
      message.success('Позиции обновлены');
      setEditing(false);
      invalidate();
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Ошибка'),
  });

  if (isLoading || !tender) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  const editable = ['draft', 'published'].includes(tender.status);

  const openEditPositions = () => {
    posForm.setFieldsValue({
      positions: tender.positions.map((p) => ({
        name: p.name,
        unit: p.unit,
        quantity: p.quantity,
        spec: p.spec ?? undefined,
        targetPrice: p.targetPrice ?? undefined,
        isRequired: true,
        positionNo: p.positionNo,
      })) as PositionInput[],
    });
    setEditing(true);
  };

  const positionColumns = [
    { title: '№', dataIndex: 'positionNo', width: 56 },
    {
      title: 'Наименование',
      dataIndex: 'name',
      render: (_: string, p: PositionOutput) => (
        <div>
          <Text strong>{p.name}</Text>
          {p.spec && (
            <div>
              <Text type="secondary" style={{ fontSize: 13 }}>
                {p.spec}
              </Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Кол-во',
      width: 140,
      align: 'right' as const,
      render: (_: unknown, p: PositionOutput) => formatQty(p.quantity, p.unit),
    },
    {
      title: 'Ориент. цена',
      dataIndex: 'targetPrice',
      width: 150,
      align: 'right' as const,
      render: (v: string | null) => (v ? formatMoney(v, false) : '—'),
    },
  ];

  const overviewTab = (
    <Row gutter={24}>
      <Col xs={24} lg={15}>
        <Card
          size="small"
          title={`Позиции (${tender.positions.length})`}
          extra={
            editable && (
              <Button size="small" icon={<EditOutlined />} onClick={openEditPositions}>
                Изменить
              </Button>
            )
          }
        >
          <Table rowKey="id" size="small" pagination={false} dataSource={tender.positions} columns={positionColumns} scroll={{ x: 560 }} />
        </Card>
        {tender.description && (
          <Card size="small" title="Описание" style={{ marginTop: 16 }}>
            <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{tender.description}</Paragraph>
          </Card>
        )}
      </Col>
      <Col xs={24} lg={9}>
        <Card size="small" title="Параметры">
          <Descriptions column={1} size="small">
            <Descriptions.Item label="Тип">{TENDER_TYPE_LABELS[tender.type]}</Descriptions.Item>
            <Descriptions.Item label="Видимость">
              {tender.visibility === 'open' ? 'Открытый' : 'Закрытый'}
            </Descriptions.Item>
            <Descriptions.Item label="НДС">{VAT_RATE_LABELS[tender.expectedVatRate]}</Descriptions.Item>
            <Descriptions.Item label="Шаг снижения">
              {tender.minStepAbs ? formatMoney(tender.minStepAbs) : 'любое ниже'}
            </Descriptions.Item>
            <Descriptions.Item label="Авто-продление">
              {tender.autoExtendEnabled ? `+${tender.autoExtendStepSec / 60} мин × ${tender.autoExtendMaxCount}` : 'нет'}
            </Descriptions.Item>
            <Descriptions.Item label="Оплата">{tender.terms?.payment || '—'}</Descriptions.Item>
            <Descriptions.Item label="Поставка">{tender.terms?.delivery || '—'}</Descriptions.Item>
          </Descriptions>
        </Card>
      </Col>
    </Row>
  );

  return (
    <div>
      <Button type="link" icon={<ArrowLeftOutlined />} style={{ paddingLeft: 0 }} onClick={() => navigate('/admin/tenders')}>
        К списку тендеров
      </Button>

      <Row justify="space-between" align="top" gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={15}>
          <Space size={8} style={{ marginBottom: 6 }}>
            <Text type="secondary" className="mono-num">
              {tender.number}
            </Text>
            <TenderStatusTag status={tender.status} />
          </Space>
          <Title level={3} style={{ margin: 0 }}>
            {tender.title}
          </Title>
          {tender.status === 'collecting' && (
            <div style={{ marginTop: 6 }}>
              <DeadlineCountdown deadline={tender.deadlineAt} /> · Участников: {tender.participantsCount}
            </div>
          )}
        </Col>
        <Col xs={24} md={9} style={{ textAlign: 'right' }}>
          <Space wrap>
            {['collecting', 'under_review', 'awarded', 'closed'].includes(tender.status) && (
              <Button icon={<BarChartOutlined />} onClick={() => navigate(`/admin/tenders/${id}/bids`)}>
                Сравнение предложений
              </Button>
            )}
            {tender.visibility === 'closed' && ['draft', 'published', 'collecting'].includes(tender.status) && (
              <Button icon={<UsergroupAddOutlined />} onClick={() => navigate(`/admin/tenders/${id}/invitations`)}>
                Приглашения
              </Button>
            )}
            {['draft', 'published'].includes(tender.status) && (
              <Popconfirm title="Опубликовать тендер?" onConfirm={() => publish.mutate()} okText="Опубликовать">
                <Button type="primary" icon={<SendOutlined />} loading={publish.isPending}>
                  Опубликовать
                </Button>
              </Popconfirm>
            )}
            {['draft', 'published', 'collecting'].includes(tender.status) && (
              <Popconfirm title="Отменить тендер?" onConfirm={() => cancel.mutate()} okText="Отменить" okButtonProps={{ danger: true }}>
                <Button danger icon={<CloseCircleOutlined />}>
                  Отменить
                </Button>
              </Popconfirm>
            )}
          </Space>
        </Col>
      </Row>

      <Tabs
        items={[
          { key: 'overview', label: 'Обзор', children: overviewTab },
          {
            key: 'docs',
            label: 'Документация',
            children: (
              <Card size="small">
                <DocumentUpload ownerType="tender" ownerId={tender.id} isPublic canEdit={editable} />
              </Card>
            ),
          },
        ]}
      />

      <Modal
        title="Редактирование позиций"
        open={editing}
        onCancel={() => setEditing(false)}
        width={900}
        okText="Сохранить"
        confirmLoading={savePositions.isPending}
        onOk={async () => {
          const v = await posForm.validateFields();
          savePositions.mutate(
            v.positions.map((p, i) => ({
              positionNo: i + 1,
              name: p.name,
              unit: p.unit,
              quantity: String(p.quantity),
              spec: p.spec ?? null,
              isRequired: true,
              targetPrice: p.targetPrice ? String(p.targetPrice) : null,
              categoryId: null,
            })),
          );
        }}
      >
        <Form form={posForm} layout="vertical">
          <PositionsEditor />
        </Form>
      </Modal>
    </div>
  );
}
