import { useQuery } from '@tanstack/react-query';
import { Card, Segmented, Table, Typography } from 'antd';
import { useState } from 'react';
import type { AccreditationQueueItem } from '@zakupki/shared';
import { useNavigate } from 'react-router-dom';
import { AccreditationTag } from '../../components/StatusTag';
import { formatDateTime } from '../../lib/format';
import { fetchQueue } from './api';

const { Title } = Typography;

export function SecurityQueuePage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<string>('active');
  const status = filter === 'active' ? undefined : filter;
  const { data, isLoading } = useQuery({
    queryKey: ['accreditation-queue', filter],
    queryFn: () => fetchQueue(status),
  });

  return (
    <div>
      <Title level={3}>Очередь аккредитации</Title>
      <Card
        title="Контрагенты на проверке"
        extra={
          <Segmented
            value={filter}
            onChange={(v) => setFilter(v as string)}
            options={[
              { label: 'В работе', value: 'active' },
              { label: 'Ожидают', value: 'pending' },
              { label: 'Нужны документы', value: 'needs_docs' },
              { label: 'Аккредитованы', value: 'accredited' },
              { label: 'Отклонены', value: 'rejected' },
            ]}
          />
        }
      >
        <Table<AccreditationQueueItem>
          rowKey="organizationId"
          loading={isLoading}
          dataSource={data ?? []}
          onRow={(r) => ({ onClick: () => navigate(`/sb/suppliers/${r.organizationId}`), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Организация', dataIndex: 'fullName' },
            { title: 'ИНН', dataIndex: 'inn', width: 140 },
            {
              title: 'Статус',
              dataIndex: 'accreditationStatus',
              width: 180,
              render: (s) => <AccreditationTag status={s} />,
            },
            { title: 'Документов', dataIndex: 'documentsCount', width: 120, align: 'center' },
            {
              title: 'Подано',
              dataIndex: 'submittedAt',
              width: 170,
              render: (v) => formatDateTime(v),
            },
          ]}
        />
      </Card>
    </div>
  );
}
