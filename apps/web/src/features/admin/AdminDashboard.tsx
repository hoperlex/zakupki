import { PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Col, List, Row, Statistic, Typography } from 'antd';
import type { TenderStatus } from '@zakupki/shared';
import { useNavigate } from 'react-router-dom';
import { DeadlineCountdown } from '../../components/DeadlineCountdown';
import { TenderStatusTag } from '../../components/StatusTag';
import { fetchTenders } from '../catalog/api';

const { Title, Text } = Typography;

export function AdminDashboard() {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['admin-tenders', 'dashboard'],
    queryFn: () => fetchTenders({ mine: true, limit: 100 }),
  });

  const items = data?.items ?? [];
  const counts = items.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});
  const collecting = items
    .filter((t) => t.status === 'collecting')
    .sort((a, b) => +new Date(a.deadlineAt) - +new Date(b.deadlineAt))
    .slice(0, 6);
  const review = items.filter((t) => t.status === 'under_review');

  const stat = (s: TenderStatus) => counts[s] ?? 0;

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={3} style={{ margin: 0 }}>
            Дашборд
          </Title>
        </Col>
        <Col>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/admin/tenders/new')}>
            Новый тендер
          </Button>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="Черновики" value={stat('draft')} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card onClick={() => navigate('/admin/tenders')} hoverable>
            <Statistic title="Приём предложений" value={stat('collecting')} valueStyle={{ color: '#389e0d' }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="На рассмотрении" value={stat('under_review')} valueStyle={{ color: '#d48806' }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="Завершено" value={stat('awarded') + stat('closed')} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title="Активные торги (по срочности)">
            <List
              locale={{ emptyText: 'Нет активных торгов' }}
              dataSource={collecting}
              renderItem={(t) => (
                <List.Item
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/admin/tenders/${t.id}`)}
                  actions={[<DeadlineCountdown key="c" deadline={t.deadlineAt} />]}
                >
                  <List.Item.Meta
                    title={t.title}
                    description={
                      <Text type="secondary">
                        {t.number} · участников: {t.participantsCount}
                      </Text>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Ожидают подведения итогов">
            <List
              locale={{ emptyText: 'Нет тендеров на рассмотрении' }}
              dataSource={review}
              renderItem={(t) => (
                <List.Item style={{ cursor: 'pointer' }} onClick={() => navigate(`/admin/tenders/${t.id}/bids`)}>
                  <List.Item.Meta title={t.title} description={<TenderStatusTag status={t.status} />} />
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
