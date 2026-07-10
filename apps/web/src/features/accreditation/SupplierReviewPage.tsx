import { ArrowLeftOutlined, FileTextOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  List,
  Radio,
  Row,
  Space,
  Spin,
  Timeline,
  Typography,
} from 'antd';
import { ACCRED_VERDICTS, VAT_RATE_LABELS, type AccredVerdict } from '@zakupki/shared';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { AccreditationTag } from '../../components/StatusTag';
import { formatDateTime } from '../../lib/format';
import { fetchReview, postVerdict } from './api';

const { Title, Text, Paragraph } = Typography;

const VERDICT_LABELS: Record<AccredVerdict, string> = {
  approved: 'Аккредитовать',
  needs_docs: 'Запросить документы',
  rejected: 'Отклонить',
  suspended: 'Приостановить',
};

export function SupplierReviewPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<{ verdict: AccredVerdict; note: string }>();

  const { data, isLoading } = useQuery({ queryKey: ['review', id], queryFn: () => fetchReview(id) });

  const verdict = useMutation({
    mutationFn: (body: { verdict: AccredVerdict; note: string }) => postVerdict(id, body),
    onSuccess: () => {
      message.success('Решение сохранено, поставщик уведомлён');
      qc.invalidateQueries({ queryKey: ['review', id] });
      qc.invalidateQueries({ queryKey: ['accreditation-queue'] });
      navigate('/sb/queue');
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : 'Ошибка'),
  });

  if (isLoading || !data) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
        <Spin size="large" />
      </div>
    );
  }
  const { org, documents, reviews } = data;
  const q = org.questionnaire ?? {};

  return (
    <div>
      <Button type="link" icon={<ArrowLeftOutlined />} style={{ paddingLeft: 0 }} onClick={() => navigate('/sb/queue')}>
        К очереди
      </Button>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={3} style={{ margin: 0 }}>
            {org.fullName}
          </Title>
          <Text type="secondary">ИНН {org.inn}{org.kpp ? ` · КПП ${org.kpp}` : ''}</Text>
        </Col>
        <Col>
          <AccreditationTag status={org.accreditationStatus} />
        </Col>
      </Row>

      <Row gutter={24}>
        <Col xs={24} lg={14}>
          <Card title="Реквизиты" size="small" style={{ marginBottom: 20 }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="ОГРН">{org.ogrn}</Descriptions.Item>
              <Descriptions.Item label="Юр. адрес">{org.legalAddress || '—'}</Descriptions.Item>
              <Descriptions.Item label="Банк">{org.bankName || '—'}</Descriptions.Item>
              <Descriptions.Item label="БИК">{org.bankBik || '—'}</Descriptions.Item>
              <Descriptions.Item label="Расчётный счёт">{org.settlementAccount || '—'}</Descriptions.Item>
              <Descriptions.Item label="Руководитель">{org.directorName || '—'}</Descriptions.Item>
              <Descriptions.Item label="НДС">{org.isVatPayer ? VAT_RATE_LABELS.vat20 : 'Без НДС'}</Descriptions.Item>
            </Descriptions>
          </Card>

          <Card title="Анкета контрагента" size="small" style={{ marginBottom: 20 }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="СРО">{q.hasSro ? `Да ${q.sroNumber ?? ''}` : 'Нет'}</Descriptions.Item>
              <Descriptions.Item label="Сотрудников">{q.employeesCount ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Лет на рынке">{q.yearsOnMarket ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Сайт">{q.website ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Бенефициары">{q.beneficiaries ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Примечания">{q.notes ?? '—'}</Descriptions.Item>
            </Descriptions>
          </Card>

          <Card title={`Документы (${documents.length})`} size="small">
            {documents.length === 0 ? (
              <Empty description="Документы не приложены" />
            ) : (
              <List
                size="small"
                dataSource={documents}
                renderItem={(d) => (
                  <List.Item>
                    <a href={`/api/v1/files/${d.id}`} target="_blank" rel="noreferrer">
                      <FileTextOutlined /> {d.originalName}
                    </a>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title="Решение службы безопасности" size="small" style={{ marginBottom: 20 }}>
            <Form form={form} layout="vertical" onFinish={(v) => verdict.mutate(v)}>
              <Form.Item name="verdict" rules={[{ required: true, message: 'Выберите решение' }]}>
                <Radio.Group>
                  <Space direction="vertical">
                    {ACCRED_VERDICTS.map((v) => (
                      <Radio key={v} value={v}>
                        {VERDICT_LABELS[v]}
                      </Radio>
                    ))}
                  </Space>
                </Radio.Group>
              </Form.Item>
              <Form.Item
                name="note"
                label="Обоснование (обязательно)"
                rules={[{ required: true, min: 3, message: 'Укажите обоснование' }]}
              >
                <Input.TextArea rows={4} placeholder="Комментарий будет виден поставщику" />
              </Form.Item>
              <Button type="primary" htmlType="submit" block loading={verdict.isPending}>
                Сохранить решение
              </Button>
            </Form>
          </Card>

          <Card title="История проверок" size="small">
            {reviews.length === 0 ? (
              <Empty description="Ещё не рассматривалось" />
            ) : (
              <Timeline
                items={reviews.map((r) => ({
                  children: (
                    <div>
                      <Text strong>{VERDICT_LABELS[r.verdict]}</Text>
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {r.reviewerName ?? 'СБ'} · {formatDateTime(r.createdAt)}
                        </Text>
                      </div>
                      <Paragraph style={{ marginBottom: 0 }}>{r.note}</Paragraph>
                    </div>
                  ),
                }))}
              />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
