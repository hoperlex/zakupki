import { useMutation, useQuery } from '@tanstack/react-query';
import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Radio,
  Row,
  Select,
  Space,
  Steps,
  Switch,
  Typography,
} from 'antd';
import { useState } from 'react';
import type { CreateTenderInput, TenderType } from '@zakupki/shared';
import { VAT_RATES, VAT_RATE_LABELS } from '@zakupki/shared';
import type { Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { PositionsEditor } from '../../components/PositionsEditor';
import { fetchCategories } from '../catalog/api';
import { createTender } from './api';

const { Title, Text } = Typography;

interface FormShape {
  title: string;
  type: TenderType;
  visibility: 'open' | 'closed';
  categoryId?: string;
  description?: string;
  terms?: {
    payment?: string;
    delivery?: string;
    deliveryPlace?: string;
    deliveryDeadline?: string;
    warranty?: string;
  };
  expectedVatRate: (typeof VAT_RATES)[number];
  minStepAbs?: string;
  deadlineAt: Dayjs;
  autoExtendEnabled: boolean;
  positions: { name: string; unit: string; quantity: string; spec?: string; targetPrice?: string }[];
}

export function TenderWizard() {
  const [form] = Form.useForm<FormShape>();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [step, setStep] = useState(0);
  const type = Form.useWatch('type', form) ?? 'materials';

  const { data: cats } = useQuery({
    queryKey: ['categories', type],
    queryFn: () => fetchCategories(type),
  });

  const create = useMutation({
    mutationFn: (body: CreateTenderInput) => createTender(body),
    onSuccess: (res) => {
      message.success('Тендер создан (черновик)');
      navigate(`/admin/tenders/${res.id}`);
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : 'Ошибка создания'),
  });

  const next = async () => {
    try {
      if (step === 0) await form.validateFields(['title', 'type', 'visibility', 'expectedVatRate', 'deadlineAt']);
      setStep((s) => s + 1);
    } catch {
      /* validation errors shown inline */
    }
  };

  const submit = async () => {
    let values: FormShape;
    try {
      values = await form.validateFields();
    } catch {
      message.error('Проверьте заполнение полей');
      return;
    }
    const payload: CreateTenderInput = {
      title: values.title,
      type: values.type,
      visibility: values.visibility,
      categoryId: values.categoryId ?? null,
      description: values.description ?? null,
      terms: values.terms ?? {},
      expectedVatRate: values.expectedVatRate,
      minStepAbs: values.minStepAbs ? String(values.minStepAbs) : null,
      minStepPct: null,
      startsAt: null,
      deadlineAt: values.deadlineAt.toISOString(),
      autoExtendEnabled: values.autoExtendEnabled,
      autoExtendWindowSec: 300,
      autoExtendStepSec: 300,
      autoExtendMaxCount: 3,
      positions: (values.positions ?? []).map((p, i) => ({
        positionNo: i + 1,
        name: p.name,
        unit: p.unit as CreateTenderInput['positions'][number]['unit'],
        quantity: String(p.quantity),
        spec: p.spec ?? null,
        isRequired: true,
        targetPrice: p.targetPrice ? String(p.targetPrice) : null,
        categoryId: null,
      })),
    };
    create.mutate(payload);
  };

  const catOptions = (() => {
    const opts: { label: string; value: string }[] = [];
    const walk = (nodes: typeof cats, depth = 0) => {
      for (const n of nodes ?? []) {
        opts.push({ label: `${'　'.repeat(depth)}${n.name}`, value: n.id });
        walk(n.children, depth + 1);
      }
    };
    walk(cats);
    return opts;
  })();

  return (
    <div style={{ maxWidth: 980 }}>
      <Title level={3}>Новый тендер</Title>
      <Steps
        current={step}
        onChange={setStep}
        style={{ marginBottom: 24 }}
        items={[{ title: 'Параметры' }, { title: 'Позиции' }, { title: 'Публикация' }]}
      />

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          type: 'materials',
          visibility: 'open',
          expectedVatRate: 'vat20',
          autoExtendEnabled: true,
          positions: [{ unit: 'pcs', isRequired: true }],
        }}
      >
        <Card style={{ display: step === 0 ? 'block' : 'none' }}>
          <Form.Item name="title" label="Название тендера" rules={[{ required: true, min: 5 }]}>
            <Input placeholder="Например: Поставка товарного бетона на ЖК …" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="type" label="Тип" rules={[{ required: true }]}>
                <Radio.Group>
                  <Radio.Button value="materials">Материалы</Radio.Button>
                  <Radio.Button value="smr">СМР</Radio.Button>
                </Radio.Group>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="visibility" label="Видимость" rules={[{ required: true }]}>
                <Radio.Group>
                  <Radio.Button value="open">Открытый</Radio.Button>
                  <Radio.Button value="closed">Закрытый</Radio.Button>
                </Radio.Group>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="categoryId" label="Категория">
                <Select allowClear showSearch optionFilterProp="label" options={catOptions} placeholder="Выберите" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="Описание">
            <Input.TextArea rows={3} placeholder="Предмет закупки, требования, приёмка…" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name={['terms', 'payment']} label="Условия оплаты">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name={['terms', 'delivery']} label="Условия поставки / выполнения">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name={['terms', 'deliveryPlace']} label="Место поставки">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name={['terms', 'deliveryDeadline']} label="Срок поставки">
                <Input placeholder="напр. 30 дней" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name={['terms', 'warranty']} label="Гарантия">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="expectedVatRate" label="Ставка НДС (ожидаемая)" rules={[{ required: true }]}>
                <Select options={VAT_RATES.map((v) => ({ label: VAT_RATE_LABELS[v], value: v }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="deadlineAt" label="Окончание приёма" rules={[{ required: true }]}>
                <DatePicker showTime format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="minStepAbs" label="Шаг снижения, ₽ (опц.)" tooltip="Минимальное снижение собственной ставки">
                <InputNumber<string> stringMode min="0" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="autoExtendEnabled" label="Авто-продление (антиснайпинг +5 мин)" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Card>

        <Card style={{ display: step === 1 ? 'block' : 'none' }}>
          <Text type="secondary">
            Список позиций, которые участники будут заполнять ценой. Итог считается автоматически.
          </Text>
          <div style={{ marginTop: 16 }}>
            <PositionsEditor />
          </div>
        </Card>

        <Card style={{ display: step === 2 ? 'block' : 'none' }}>
          <Text>
            Тендер будет создан как <b>черновик</b>. После создания вы сможете приложить документацию,
            добавить приглашения (для закрытого) и опубликовать его.
          </Text>
        </Card>
      </Form>

      <Space style={{ marginTop: 20 }}>
        {step > 0 && <Button onClick={() => setStep((s) => s - 1)}>Назад</Button>}
        {step < 2 && (
          <Button type="primary" onClick={next}>
            Далее
          </Button>
        )}
        {step === 2 && (
          <Button type="primary" loading={create.isPending} onClick={submit}>
            Создать тендер
          </Button>
        )}
      </Space>
    </div>
  );
}
