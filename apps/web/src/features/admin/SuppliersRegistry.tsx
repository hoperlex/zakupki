import { useQuery } from '@tanstack/react-query';
import { Card, Segmented, Table, Typography } from 'antd';
import { useState } from 'react';
import type { OrgSummary } from '@zakupki/shared';
import { api } from '../../api/client';
import { AccreditationTag } from '../../components/StatusTag';
import { formatDate } from '../../lib/format';

const { Title } = Typography;

export function SuppliersRegistry() {
  const [status, setStatus] = useState<string>('all');
  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', status],
    queryFn: () =>
      api<OrgSummary[]>('/orgs', { query: status === 'all' ? undefined : { status } }),
  });

  return (
    <div>
      <Title level={3}>Реестр поставщиков</Title>
      <Card
        extra={
          <Segmented
            value={status}
            onChange={(v) => setStatus(v as string)}
            options={[
              { label: 'Все', value: 'all' },
              { label: 'Аккредитованы', value: 'accredited' },
              { label: 'На проверке', value: 'pending' },
              { label: 'Отклонены', value: 'rejected' },
            ]}
          />
        }
      >
        <Table<OrgSummary>
          rowKey="id"
          loading={isLoading}
          dataSource={data ?? []}
          columns={[
            { title: 'Организация', dataIndex: 'fullName' },
            { title: 'ИНН', dataIndex: 'inn', width: 140 },
            { title: 'КПП', dataIndex: 'kpp', width: 120, render: (v) => v ?? '—' },
            {
              title: 'Аккредитация',
              dataIndex: 'accreditationStatus',
              width: 180,
              render: (s) => <AccreditationTag status={s} />,
            },
            { title: 'Зарегистрирован', dataIndex: 'createdAt', width: 160, render: (v) => formatDate(v) },
          ]}
        />
      </Card>
    </div>
  );
}
