import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Select, Space, Table, Tag, Typography } from 'antd';
import type { CounterpartySummary, CounterpartyType } from '@zakupki/shared';
import {
  COUNTERPARTY_TYPES,
  COUNTERPARTY_TYPE_LABELS,
  GENERAL_CONTRACTOR_LABEL,
} from '@zakupki/shared';
import { ApiError } from '../../../api/client';
import { listCounterparties, setCounterpartyType, setGeneralContractor } from './api';

const { Text } = Typography;

const typeOptions = COUNTERPARTY_TYPES.map((t) => ({
  label: COUNTERPARTY_TYPE_LABELS[t as CounterpartyType],
  value: t,
}));

function errText(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Что-то пошло не так';
}

export function CounterpartiesTab() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { data, isLoading } = useQuery({
    queryKey: ['counterparties'],
    queryFn: listCounterparties,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['counterparties'] });

  const gcMut = useMutation({
    mutationFn: (organizationId: string) => setGeneralContractor(organizationId),
    onSuccess: () => {
      message.success('Генподрядчик назначен');
      invalidate();
    },
    onError: (err) => message.error(errText(err)),
  });

  const typeMut = useMutation({
    mutationFn: ({ id, type }: { id: string; type: CounterpartyType }) =>
      setCounterpartyType(id, type),
    onSuccess: () => {
      message.success('Тип контрагента изменён');
      invalidate();
    },
    onError: (err) => message.error(errText(err)),
  });

  const rows = data ?? [];
  const gc = rows.find((o) => o.isGeneralContractor) ?? null;
  const gcOptions = rows.map((o) => ({ label: o.shortName ?? o.fullName, value: o.id }));

  return (
    <div>
      <Space align="center" style={{ marginBottom: 20 }}>
        <Text strong>Генподрядчик:</Text>
        <Select
          style={{ minWidth: 320 }}
          placeholder="Выберите организацию"
          value={gc?.id}
          options={gcOptions}
          showSearch
          optionFilterProp="label"
          loading={gcMut.isPending}
          onChange={(id) => gcMut.mutate(id)}
        />
      </Space>

      <Table<CounterpartySummary>
        rowKey="id"
        loading={isLoading}
        dataSource={rows}
        columns={[
          { title: 'Наименование', dataIndex: 'fullName' },
          { title: 'ИНН', dataIndex: 'inn', width: 150 },
          { title: 'КПП', dataIndex: 'kpp', width: 130, render: (v) => v ?? '—' },
          {
            title: 'Тип',
            dataIndex: 'counterpartyType',
            width: 220,
            render: (type: CounterpartyType, row) =>
              row.isGeneralContractor ? (
                <Tag color="gold">{GENERAL_CONTRACTOR_LABEL}</Tag>
              ) : (
                <Select
                  size="small"
                  style={{ width: 160 }}
                  value={type}
                  options={typeOptions}
                  onChange={(t) => typeMut.mutate({ id: row.id, type: t })}
                />
              ),
          },
        ]}
      />
    </div>
  );
}
