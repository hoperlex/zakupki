import { ArrowLeftOutlined, CrownOutlined, FilePdfOutlined, TrophyOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import type { BidComparisonRow } from '@zakupki/shared';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { AccreditationTag } from '../../components/StatusTag';
import { TenderStatusTag } from '../../components/StatusTag';
import { formatDateTime, formatMoney } from '../../lib/format';
import { fetchTenderDetail } from '../admin/api';
import { awardBid, fetchComparison } from './api';

const { Title, Text } = Typography;

export function BidComparisonPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();

  const { data: tender } = useQuery({ queryKey: ['tender', id], queryFn: () => fetchTenderDetail(id) });
  const { data: rows, isLoading } = useQuery({ queryKey: ['comparison', id], queryFn: () => fetchComparison(id) });

  const award = useMutation({
    mutationFn: (bidId: string) => awardBid(id, bidId),
    onSuccess: () => {
      message.success('Победитель определён, поставщик уведомлён');
      qc.invalidateQueries({ queryKey: ['tender', id] });
      qc.invalidateQueries({ queryKey: ['comparison', id] });
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : 'Ошибка'),
  });

  const canAward = tender && ['collecting', 'under_review'].includes(tender.status);
  const awardedId = tender?.awardedBidId;

  const columns = [
    {
      title: 'Место',
      dataIndex: 'rank',
      width: 90,
      render: (rank: number | null, r: BidComparisonRow) =>
        r.isBest ? (
          <Tag icon={<CrownOutlined />} color="green">
            {rank}
          </Tag>
        ) : (
          <Text strong>{rank ?? '—'}</Text>
        ),
    },
    {
      title: 'Поставщик',
      render: (_: unknown, r: BidComparisonRow) => (
        <div>
          <Text strong>{r.supplierName}</Text>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              ИНН {r.supplierInn}
            </Text>
          </div>
        </div>
      ),
    },
    {
      title: 'Аккредитация',
      dataIndex: 'accreditationStatus',
      width: 150,
      render: (s: string) => <AccreditationTag status={s as never} />,
    },
    {
      title: 'Без НДС',
      dataIndex: 'totalWithoutVat',
      width: 140,
      align: 'right' as const,
      render: (v: string) => formatMoney(v, false),
    },
    { title: 'НДС', dataIndex: 'vatAmount', width: 130, align: 'right' as const, render: (v: string) => formatMoney(v, false) },
    {
      title: 'С НДС',
      dataIndex: 'totalWithVat',
      width: 150,
      align: 'right' as const,
      render: (v: string) => (
        <Text strong className="mono-num">
          {formatMoney(v)}
        </Text>
      ),
    },
    {
      title: 'Подано',
      dataIndex: 'submittedAt',
      width: 150,
      render: (v: string | null) => formatDateTime(v),
    },
    {
      title: '',
      width: 180,
      render: (_: unknown, r: BidComparisonRow) =>
        r.bidId === awardedId ? (
          <Tag color="purple" icon={<TrophyOutlined />}>
            Победитель
          </Tag>
        ) : canAward ? (
          <Popconfirm
            title="Выбрать этого поставщика победителем?"
            onConfirm={() => award.mutate(r.bidId)}
            okText="Выбрать"
          >
            <Button size="small" type="primary" ghost>
              Выбрать победителем
            </Button>
          </Popconfirm>
        ) : null,
    },
  ];

  return (
    <div>
      <Button type="link" icon={<ArrowLeftOutlined />} style={{ paddingLeft: 0 }} onClick={() => navigate(`/admin/tenders/${id}`)}>
        К тендеру
      </Button>
      <Space style={{ marginBottom: 12 }} wrap>
        <Title level={3} style={{ margin: 0 }}>
          Сравнение предложений
        </Title>
        {tender && <TenderStatusTag status={tender.status} />}
      </Space>
      {tender && (
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          {tender.number} — {tender.title}
        </Text>
      )}

      {tender?.status === 'awarded' && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
          message="Победитель определён"
          action={
            <Button icon={<FilePdfOutlined />} onClick={() => window.open(`/api/v1/tenders/${id}/protocol`, '_blank')}>
              Протокол
            </Button>
          }
        />
      )}

      <Card>
        <Table<BidComparisonRow>
          rowKey="bidId"
          loading={isLoading}
          dataSource={rows ?? []}
          columns={columns}
          pagination={false}
          scroll={{ x: 980 }}
          locale={{ emptyText: 'Предложений пока нет' }}
        />
      </Card>
    </div>
  );
}
