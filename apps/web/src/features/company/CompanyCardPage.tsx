import { SafetyCertificateOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Tabs,
  TreeSelect,
  Typography,
} from 'antd';
import { useState } from 'react';
import type { CategoryNode, CompanyCardInput } from '@zakupki/shared';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { DocumentUpload } from '../../components/DocumentUpload';
import { AccreditationTag } from '../../components/StatusTag';
import { fetchCategories } from '../catalog/api';
import { fetchMyOrg, lookupInn, saveCompanyCard, submitAccreditation } from './api';

const { Title, Text } = Typography;

function treeData(nodes: CategoryNode[]): { title: string; value: string; children?: unknown[] }[] {
  return nodes.map((n) => ({
    title: n.name,
    value: n.id,
    children: n.children.length ? treeData(n.children) : undefined,
  }));
}

export function CompanyCardPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const [form] = Form.useForm<CompanyCardInput>();
  const [innLoading, setInnLoading] = useState(false);

  const { data: org, isLoading } = useQuery({ queryKey: ['myOrg'], queryFn: fetchMyOrg });
  const { data: catsSmr } = useQuery({ queryKey: ['categories', 'smr'], queryFn: () => fetchCategories('smr') });
  const { data: catsMat } = useQuery({
    queryKey: ['categories', 'materials'],
    queryFn: () => fetchCategories('materials'),
  });

  const save = useMutation({
    mutationFn: (values: CompanyCardInput) => saveCompanyCard(values),
    onSuccess: () => {
      message.success('Карточка компании сохранена');
      qc.invalidateQueries({ queryKey: ['myOrg'] });
      refresh();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : 'Ошибка сохранения'),
  });

  const submit = useMutation({
    mutationFn: submitAccreditation,
    onSuccess: () => {
      message.success('Заявка на аккредитацию отправлена в службу безопасности');
      qc.invalidateQueries({ queryKey: ['myOrg'] });
      refresh();
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : 'Ошибка отправки'),
  });

  const onLookup = async () => {
    const inn = form.getFieldValue('inn');
    if (!inn) {
      message.warning('Введите ИНН');
      return;
    }
    setInnLoading(true);
    try {
      const r = await lookupInn(inn);
      if (!r.found) {
        message.info('Организация не найдена, заполните вручную');
        return;
      }
      form.setFieldsValue({
        fullName: r.fullName ?? form.getFieldValue('fullName'),
        shortName: r.shortName ?? form.getFieldValue('shortName'),
        kpp: r.kpp ?? form.getFieldValue('kpp'),
        ogrn: r.ogrn ?? form.getFieldValue('ogrn'),
        okpo: r.okpo,
        okved: r.okved,
        legalAddress: r.legalAddress ?? form.getFieldValue('legalAddress'),
        directorName: r.directorName ?? form.getFieldValue('directorName'),
      });
      message.success('Реквизиты заполнены по ИНН');
    } finally {
      setInnLoading(false);
    }
  };

  if (isLoading) return null;

  const status = org?.accreditationStatus ?? 'none';
  const canSubmit = org && ['none', 'needs_docs', 'rejected'].includes(status);

  const requisitesTab = (
    <Row gutter={24}>
      <Col xs={24} lg={16}>
        <Title level={5}>Реквизиты</Title>
        <Form.Item label="ИНН" required>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="inn" noStyle rules={[{ required: true, message: 'Укажите ИНН' }]}>
              <Input placeholder="10 или 12 цифр" />
            </Form.Item>
            <Button icon={<ThunderboltOutlined />} loading={innLoading} onClick={onLookup}>
              По ИНН
            </Button>
          </Space.Compact>
        </Form.Item>
        <Form.Item name="fullName" label="Полное наименование" rules={[{ required: true }]}>
          <Input placeholder="Общество с ограниченной ответственностью «…»" />
        </Form.Item>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="shortName" label="Краткое наименование">
              <Input placeholder="ООО «…»" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="kpp" label="КПП (для юрлиц)">
              <Input placeholder="9 цифр" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="ogrn" label="ОГРН / ОГРНИП" rules={[{ required: true }]}>
              <Input placeholder="13 или 15 цифр" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="okpo" label="ОКПО">
              <Input />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="okved" label="ОКВЭД">
              <Input />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="taxSystem" label="Система налогообложения">
              <Select
                allowClear
                options={[
                  { label: 'ОСН', value: 'osn' },
                  { label: 'УСН', value: 'usn' },
                ]}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="isVatPayer" label="Плательщик НДС" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="legalAddress" label="Юридический адрес" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="postalAddress" label="Почтовый адрес">
          <Input />
        </Form.Item>

        <Divider />
        <Title level={5}>Банковские реквизиты</Title>
        <Row gutter={16}>
          <Col span={16}>
            <Form.Item name="bankName" label="Банк">
              <Input placeholder="ПАО …" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="bankBik" label="БИК">
              <Input placeholder="9 цифр" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="settlementAccount" label="Расчётный счёт">
              <Input placeholder="20 цифр" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="bankCorrAccount" label="Корр. счёт">
              <Input placeholder="20 цифр" />
            </Form.Item>
          </Col>
        </Row>

        <Divider />
        <Title level={5}>Руководитель и контакты</Title>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="directorName" label="Руководитель (ФИО)">
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="directorBasis" label="Действует на основании">
              <Input placeholder="Устава / доверенности" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="contactPhone" label="Телефон">
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="contactEmail" label="Email">
              <Input />
            </Form.Item>
          </Col>
        </Row>
      </Col>

      <Col xs={24} lg={8}>
        <Title level={5}>Интересующие категории</Title>
        <Form.Item name="categoryIds" label="Виды работ / материалы">
          <TreeSelect
            multiple
            allowClear
            treeCheckable
            showCheckedStrategy={TreeSelect.SHOW_CHILD}
            placeholder="Выберите категории"
            treeData={[
              { title: 'СМР (работы)', value: 'g:smr', selectable: false, children: treeData(catsSmr ?? []) },
              { title: 'Материалы', value: 'g:mat', selectable: false, children: treeData(catsMat ?? []) },
            ]}
            style={{ width: '100%' }}
          />
        </Form.Item>
      </Col>
    </Row>
  );

  const questionnaireTab = (
    <div style={{ maxWidth: 640 }}>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item name={['questionnaire', 'hasSro']} label="Есть СРО" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name={['questionnaire', 'sroNumber']} label="Номер СРО">
            <Input />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item name={['questionnaire', 'employeesCount']} label="Численность сотрудников">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name={['questionnaire', 'yearsOnMarket']} label="Лет на рынке">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name={['questionnaire', 'website']} label="Сайт">
        <Input placeholder="https://" />
      </Form.Item>
      <Form.Item name={['questionnaire', 'beneficiaries']} label="Бенефициары / учредители">
        <Input.TextArea rows={2} />
      </Form.Item>
      <Form.Item name={['questionnaire', 'notes']} label="Дополнительно">
        <Input.TextArea rows={3} />
      </Form.Item>
    </div>
  );

  const documentsTab = (
    <div style={{ maxWidth: 640 }}>
      <Text type="secondary">
        Приложите устав, лист записи ЕГРЮЛ, документы полномочий руководителя, СРО/лицензии.
      </Text>
      <div style={{ marginTop: 16 }}>
        <DocumentUpload ownerType="organization" ownerId={org?.id} />
      </div>
    </div>
  );

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={3} style={{ margin: 0 }}>
            Карточка компании
          </Title>
        </Col>
        <Col>
          <Space>
            <Text type="secondary">Статус аккредитации:</Text>
            <AccreditationTag status={status} />
          </Space>
        </Col>
      </Row>

      {status === 'accredited' && (
        <Alert
          style={{ marginBottom: 16 }}
          type="success"
          showIcon
          icon={<SafetyCertificateOutlined />}
          message="Компания аккредитована — вы можете участвовать в открытых тендерах."
        />
      )}
      {status === 'needs_docs' && (
        <Alert style={{ marginBottom: 16 }} type="warning" showIcon message="Служба безопасности запросила дополнительные документы." />
      )}
      {(status === 'pending' || status === 'under_review') && (
        <Alert style={{ marginBottom: 16 }} type="info" showIcon message="Карточка на проверке в службе безопасности." />
      )}
      {status === 'rejected' && (
        <Alert style={{ marginBottom: 16 }} type="error" showIcon message="Аккредитация отклонена. Уточните причину и подайте повторно." />
      )}

      <Card>
        <Form
          form={form}
          layout="vertical"
          initialValues={
            org ?? { isVatPayer: true, questionnaire: {}, categoryIds: [] }
          }
          onFinish={(v) => save.mutate(v)}
        >
          <Tabs
            items={[
              { key: 'req', label: 'Реквизиты', children: requisitesTab },
              { key: 'quest', label: 'Анкета контрагента', children: questionnaireTab },
              { key: 'docs', label: 'Документы', children: documentsTab },
            ]}
          />
          <Divider />
          <Space>
            <Button type="primary" htmlType="submit" loading={save.isPending}>
              Сохранить карточку
            </Button>
            <Button
              icon={<SafetyCertificateOutlined />}
              disabled={!canSubmit}
              loading={submit.isPending}
              onClick={() => submit.mutate()}
            >
              Отправить на аккредитацию
            </Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
