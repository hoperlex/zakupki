import { PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Segmented, Space, Table, Typography } from 'antd';
import { useState } from 'react';
import { TENDER_TYPE_LABELS, type TenderStatus, type TenderSummary } from '@zakupki/shared';
import { useNavigate } from 'react-router-dom';
import { TenderStatusTag } from '../../components/StatusTag';
import { formatDateTime } from '../../lib/format';
import { fetchTenders } from '../catalog/api';

const { Title } = Typography;

export function AdminTendersList() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<TenderStatus | 'all'>('all');
  const { data, isLoading } = useQuery({
    queryKey: ['admin-tenders', status],
    queryFn: () => fetchTenders({ mine: true, limit: 100, status: status === 'all' ? undefined : status }),
  });

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          Тендеры
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/admin/tenders/new')}>
          Новый тендер
        </Button>
      </Space>
      <Card
        extra={
          <Segmented
            value={status}
            onChange={(v) => setStatus(v as TenderStatus | 'all')}
            options={[
              { label: 'Все', value: 'all' },
              { label: 'Черновики', value: 'draft' },
              { label: 'Приём', value: 'collecting' },
              { label: 'Рассмотрение', value: 'under_review' },
              { label: 'Завершены', value: 'awarded' },
            ]}
          />
        }
      >
        <Table<TenderSummary>
          rowKey="id"
          loading={isLoading}
          dataSource={data?.items ?? []}
          onRow={(r) => ({ onClick: () => navigate(`/admin/tenders/${r.id}`), style: { cursor: 'pointer' } })}
          columns={[
            { title: '№', dataIndex: 'number', width: 130 },
            { title: 'Название', dataIndex: 'title', ellipsis: true },
            {
              title: 'Тип',
              dataIndex: 'type',
              width: 130,
              render: (t) => TENDER_TYPE_LABELS[t as keyof typeof TENDER_TYPE_LABELS],
            },
            { title: 'Статус', dataIndex: 'status', width: 180, render: (s) => <TenderStatusTag status={s} /> },
            { title: 'Участн.', dataIndex: 'participantsCount', width: 90, align: 'center' },
            { title: 'Дедлайн', dataIndex: 'deadlineAt', width: 160, render: (v) => formatDateTime(v) },
          ]}
        />
      </Card>
    </div>
  );
}
