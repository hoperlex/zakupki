import { ArrowLeftOutlined, FileTextOutlined, LockOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Row,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { TENDER_TYPE_LABELS, type PositionOutput } from '@zakupki/shared';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { DeadlineCountdown } from '../../components/DeadlineCountdown';
import { TenderStatusTag } from '../../components/StatusTag';
import { formatMoney, formatQty } from '../../lib/format';
import { BidPanel } from '../bidding/BidPanel';
import { MyRankPanel } from '../bidding/MyRankPanel';
import { fetchTender } from './api';

const { Title, Text, Paragraph } = Typography;
const container: React.CSSProperties = { maxWidth: 1080, margin: '0 auto', padding: '28px 24px 64px' };

export function TenderDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: tender, isLoading, refetch } = useQuery({
    queryKey: ['tender', id],
    queryFn: () => fetchTender(id),
  });

  if (isLoading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!tender) return <div style={container}>Тендер не найден</div>;

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
      dataIndex: 'quantity',
      width: 140,
      align: 'right' as const,
      render: (_: string, p: PositionOutput) => formatQty(p.quantity, p.unit),
    },
    {
      title: 'Ориент. цена, ₽/ед.',
      dataIndex: 'targetPrice',
      width: 160,
      align: 'right' as const,
      render: (v: string | null) => (v ? formatMoney(v, false) : '—'),
    },
  ];

  const requestTab = (
    <Row gutter={[24, 24]}>
      <Col xs={24} lg={16}>
        <Card title="Описание" size="small" style={{ marginBottom: 20 }}>
          <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
            {tender.description || 'Описание не заполнено.'}
          </Paragraph>
        </Card>
        <Card title={`Позиции (${tender.positions.length})`} size="small">
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={tender.positions}
            columns={positionColumns}
            scroll={{ x: 640 }}
          />
        </Card>
      </Col>
      <Col xs={24} lg={8}>
        <Card title="Условия" size="small" style={{ marginBottom: 20 }}>
          <Descriptions column={1} size="small" colon={false}>
            <Descriptions.Item label={<Text type="secondary">Тип</Text>}>
              {TENDER_TYPE_LABELS[tender.type]}
            </Descriptions.Item>
            <Descriptions.Item label={<Text type="secondary">Оплата</Text>}>
              {tender.terms?.payment || '—'}
            </Descriptions.Item>
            <Descriptions.Item label={<Text type="secondary">Поставка</Text>}>
              {tender.terms?.delivery || '—'}
            </Descriptions.Item>
            <Descriptions.Item label={<Text type="secondary">Место поставки</Text>}>
              {tender.terms?.deliveryPlace || '—'}
            </Descriptions.Item>
            <Descriptions.Item label={<Text type="secondary">Срок поставки</Text>}>
              {tender.terms?.deliveryDeadline || '—'}
            </Descriptions.Item>
            <Descriptions.Item label={<Text type="secondary">Гарантия</Text>}>
              {tender.terms?.warranty || '—'}
            </Descriptions.Item>
          </Descriptions>
        </Card>
        <Card title="Документация" size="small">
          {tender.documents.length === 0 ? (
            <Text type="secondary">Документы не приложены</Text>
          ) : (
            <Space direction="vertical" style={{ width: '100%' }}>
              {tender.documents.map((d) => (
                <a key={d.id} href={`/api/v1/files/${d.id}`} target="_blank" rel="noreferrer">
                  <FileTextOutlined /> {d.originalName}
                </a>
              ))}
            </Space>
          )}
        </Card>
      </Col>
    </Row>
  );

  const bidGate = !user ? (
    <Alert
      type="info"
      showIcon
      message="Войдите, чтобы подать предложение"
      description={
        <Space>
          <Button type="primary" onClick={() => navigate('/login')}>
            Войти
          </Button>
          <Button onClick={() => navigate('/register')}>Зарегистрироваться</Button>
        </Space>
      }
    />
  ) : !tender.canBid ? (
    <Alert type="warning" showIcon message={tender.bidBlockReason ?? 'Подача предложения недоступна'} />
  ) : (
    <BidPanel tender={tender} onSubmitted={() => refetch()} />
  );

  return (
    <div style={container}>
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          { title: <Link to="/tenders">Тендеры</Link> },
          { title: tender.number },
        ]}
      />
      <Button
        type="link"
        icon={<ArrowLeftOutlined />}
        style={{ paddingLeft: 0, marginBottom: 8 }}
        onClick={() => navigate('/tenders')}
      >
        Назад к каталогу
      </Button>

      <Row justify="space-between" align="top" gutter={[16, 16]} style={{ marginBottom: 8 }}>
        <Col xs={24} md={16}>
          <Space size={8} wrap style={{ marginBottom: 8 }}>
            <Text type="secondary" className="mono-num">
              {tender.number}
            </Text>
            <TenderStatusTag status={tender.status} />
            {tender.visibility === 'closed' && (
              <Tag icon={<LockOutlined />}>Закрытый</Tag>
            )}
          </Space>
          <Title level={2} style={{ margin: 0 }}>
            {tender.title}
          </Title>
          <Text type="secondary">{tender.organizationName}</Text>
        </Col>
        <Col xs={24} md={8} style={{ textAlign: 'right' }}>
          <Card size="small" styles={{ body: { padding: 16 } }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              До окончания приёма
            </Text>
            <DeadlineCountdown deadline={tender.deadlineAt} size="large" />
            <Divider style={{ margin: '12px 0' }} />
            <Text type="secondary">Участников: {tender.participantsCount}</Text>
          </Card>
        </Col>
      </Row>

      <Tabs
        defaultActiveKey="request"
        size="large"
        items={[
          { key: 'request', label: '1. Запрос', children: requestTab },
          { key: 'offer', label: '2. Предложение', children: bidGate },
          {
            key: 'rank',
            label: 'Моё место',
            children: user ? (
              <MyRankPanel tender={tender} />
            ) : (
              <Alert type="info" showIcon message="Войдите, чтобы видеть своё место в тендере" />
            ),
          },
        ]}
      />
    </div>
  );
}
