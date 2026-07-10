import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Alert, Button, Form, Input, InputNumber, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import {
  VAT_PERCENT,
  VAT_RATES,
  VAT_RATE_LABELS,
  type PositionOutput,
  type SubmitBidInput,
  type TenderDetail,
  type VatRate,
} from '@zakupki/shared';
import { ApiError } from '../../api/client';
import { formatMoney, formatQty } from '../../lib/format';
import { fetchMyBid, submitBid } from './api';

const { Text } = Typography;

interface Row {
  price?: string;
  vatRate: VatRate;
}
interface BidFormShape {
  items: Row[];
  comment?: string;
}

function lineWithVat(price: string | undefined, qty: string, vat: VatRate): number {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return 0;
  return p * Number(qty) * (1 + VAT_PERCENT[vat] / 100);
}

export function BidPanel({ tender, onSubmitted }: { tender: TenderDetail; onSubmitted: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<BidFormShape>();

  const { data: myBid, isLoading } = useQuery({
    queryKey: ['my-bid', tender.id],
    queryFn: () => fetchMyBid(tender.id),
  });

  const itemsWatch = Form.useWatch('items', form);
  const liveTotal = (tender.positions ?? []).reduce((sum, p, i) => {
    const row = itemsWatch?.[i];
    return sum + lineWithVat(row?.price, p.quantity, row?.vatRate ?? tender.expectedVatRate);
  }, 0);

  const submit = useMutation({
    mutationFn: (body: SubmitBidInput) => submitBid(tender.id, body),
    onSuccess: (res) => {
      message.success(res.isBest ? 'Предложение подано — вы лидируете!' : `Предложение подано. Ваше место: ${res.rank}`);
      qc.invalidateQueries({ queryKey: ['my-bid', tender.id] });
      onSubmitted();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : 'Ошибка подачи'),
  });

  if (isLoading) return null;

  const initialValues: BidFormShape = {
    items: tender.positions.map((p) => {
      const existing = myBid?.items.find((i) => i.positionId === p.id);
      return {
        price: existing?.unitPriceWithoutVat,
        vatRate: existing?.vatRate ?? tender.expectedVatRate,
      };
    }),
    comment: myBid?.comment ?? undefined,
  };

  const onFinish = (values: BidFormShape) => {
    const body: SubmitBidInput = {
      items: tender.positions.map((p, i) => ({
        positionId: p.id,
        unitPriceWithoutVat: String(values.items[i]?.price ?? '0'),
        vatRate: values.items[i]?.vatRate ?? tender.expectedVatRate,
      })),
      comment: values.comment ?? null,
    };
    submit.mutate(body);
  };

  const columns = [
    { title: '№', dataIndex: 'positionNo', width: 48 },
    {
      title: 'Наименование',
      render: (_: unknown, p: PositionOutput) => (
        <div>
          <Text>{p.name}</Text>
          {p.spec && (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {p.spec}
              </Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Кол-во',
      width: 110,
      align: 'right' as const,
      render: (_: unknown, p: PositionOutput) => formatQty(p.quantity, p.unit),
    },
    {
      title: 'Цена за ед., без НДС',
      width: 170,
      render: (_: unknown, _p: PositionOutput, i: number) => (
        <Form.Item
          name={['items', i, 'price']}
          style={{ margin: 0 }}
          rules={tender.positions[i]?.isRequired ? [{ required: true, message: '!' }] : []}
        >
          <InputNumber<string> stringMode min="0" style={{ width: '100%' }} placeholder="0.00" />
        </Form.Item>
      ),
    },
    {
      title: 'НДС',
      width: 120,
      render: (_: unknown, _p: PositionOutput, i: number) => (
        <Form.Item name={['items', i, 'vatRate']} style={{ margin: 0 }}>
          <Select options={VAT_RATES.map((v) => ({ label: VAT_RATE_LABELS[v], value: v }))} />
        </Form.Item>
      ),
    },
    {
      title: 'Сумма с НДС',
      width: 150,
      align: 'right' as const,
      render: (_: unknown, p: PositionOutput, i: number) => {
        const row = itemsWatch?.[i];
        return (
          <Text strong className="mono-num">
            {formatMoney(lineWithVat(row?.price, p.quantity, row?.vatRate ?? tender.expectedVatRate))}
          </Text>
        );
      },
    },
  ];

  return (
    <div>
      {myBid && (
        <Alert
          type={myBid.isBest ? 'success' : 'info'}
          showIcon
          style={{ marginBottom: 16 }}
          message={
            <Space size="large">
              <span>
                Ваше текущее предложение:{' '}
                <Text strong>{formatMoney(myBid.totalWithVat)}</Text>
              </span>
              <span>
                Место: <Text strong>{myBid.rank} из {myBid.participantsCount}</Text>
              </span>
              {myBid.isBest && <Tag color="green">Лидер</Tag>}
            </Space>
          }
          description="Вы можете подать более низкую цену — место обновится сразу."
        />
      )}

      <Form form={form} layout="vertical" initialValues={initialValues} onFinish={onFinish}>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={tender.positions}
          columns={columns}
          scroll={{ x: 760 }}
          summary={() => (
            <Table.Summary fixed>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={5} align="right">
                  <Text strong>Итого с НДС:</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <Statistic value={liveTotal} precision={2} suffix="₽" valueStyle={{ fontSize: 18 }} />
                </Table.Summary.Cell>
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />

        <Form.Item name="comment" label="Комментарий (опционально)" style={{ marginTop: 16 }}>
          <Input.TextArea rows={2} placeholder="Дополнительные условия, сроки…" />
        </Form.Item>

        <Space>
          <Button type="primary" size="large" htmlType="submit" loading={submit.isPending}>
            {myBid ? 'Снизить цену' : 'Подать предложение'}
          </Button>
          <Text type="secondary">
            Вы {myBid ? 'можете снижать цену' : 'подаёте цену'} до окончания приёма. Конкурентов вы не видите.
          </Text>
        </Space>
      </Form>
    </div>
  );
}
