import { CrownOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Card, Table, Tag, Typography } from 'antd';
import { TENDER_STATUS_LABELS, type TenderStatus } from '@zakupki/shared';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { DeadlineCountdown } from '../../components/DeadlineCountdown';
import { formatMoney } from '../../lib/format';

const { Title, Text } = Typography;

interface MyBidRow {
  tenderId: string;
  number: string;
  title: string;
  status: TenderStatus;
  deadlineAt: string;
  rank: number | null;
  isBest: boolean;
  totalWithVat: string;
  participants: number;
}

export function SupplierMyBidsPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['my-bids-list'],
    queryFn: () => api<MyBidRow[]>('/tenders/my-bids'),
  });

  return (
    <div>
      <Title level={3}>Мои предложения</Title>
      <Card>
        <Table<MyBidRow>
          rowKey="tenderId"
          loading={isLoading}
          dataSource={data ?? []}
          onRow={(r) => ({ onClick: () => navigate(`/app/tenders/${r.tenderId}`), style: { cursor: 'pointer' } })}
          locale={{ emptyText: 'Вы ещё не подавали предложений' }}
          columns={[
            { title: '№', dataIndex: 'number', width: 130 },
            { title: 'Тендер', dataIndex: 'title', ellipsis: true },
            {
              title: 'Моё место',
              width: 130,
              render: (_, r) =>
                r.isBest ? (
                  <Tag icon={<CrownOutlined />} color="green">
                    {r.rank} из {r.participants}
                  </Tag>
                ) : (
                  <Text strong>
                    {r.rank} из {r.participants}
                  </Text>
                ),
            },
            {
              title: 'Моя цена (с НДС)',
              dataIndex: 'totalWithVat',
              width: 160,
              align: 'right',
              render: (v) => formatMoney(v),
            },
            {
              title: 'Статус',
              dataIndex: 'status',
              width: 150,
              render: (s: TenderStatus) => <Tag>{TENDER_STATUS_LABELS[s]}</Tag>,
            },
            {
              title: 'До конца',
              width: 170,
              render: (_, r) =>
                r.status === 'collecting' ? <DeadlineCountdown deadline={r.deadlineAt} /> : '—',
            },
          ]}
        />
      </Card>
    </div>
  );
}
