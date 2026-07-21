import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Col, Form, Input, Row, Select, Tree, Typography } from 'antd';
import type { DataNode } from 'antd/es/tree';
import type { CategoryNode, CreateCategoryInput, TenderType } from '@zakupki/shared';
import { api } from '../../api/client';
import { fetchCategories } from '../catalog/api';

const { Text } = Typography;

function toTree(nodes: CategoryNode[]): DataNode[] {
  return nodes.map((n) => ({
    key: n.id,
    title: n.name,
    children: n.children.length ? toTree(n.children) : undefined,
  }));
}

function CategoryColumn({ kind }: { kind: TenderType }) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<{ name: string; parentId?: string }>();
  const { data } = useQuery({ queryKey: ['categories', kind], queryFn: () => fetchCategories(kind) });

  const flatOptions = (() => {
    const opts: { label: string; value: string }[] = [];
    const walk = (nodes: CategoryNode[], depth = 0) => {
      for (const n of nodes) {
        opts.push({ label: `${'　'.repeat(depth)}${n.name}`, value: n.id });
        walk(n.children, depth + 1);
      }
    };
    walk(data ?? []);
    return opts;
  })();

  const add = useMutation({
    mutationFn: (body: CreateCategoryInput) => api('/categories', { method: 'POST', body }),
    onSuccess: () => {
      message.success('Категория добавлена');
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['categories', kind] });
    },
    onError: () => message.error('Ошибка добавления'),
  });

  return (
    <Card title={kind === 'smr' ? 'СМР (виды работ)' : 'Материалы (категории)'}>
      <Tree treeData={toTree(data ?? [])} defaultExpandAll selectable={false} />
      <Form
        form={form}
        layout="inline"
        style={{ marginTop: 16 }}
        onFinish={(v) => add.mutate({ kind, name: v.name, parentId: v.parentId ?? null, sortOrder: 0 })}
      >
        <Form.Item name="name" rules={[{ required: true, message: 'Название' }]}>
          <Input placeholder="Новая категория" style={{ width: 200 }} />
        </Form.Item>
        <Form.Item name="parentId">
          <Select allowClear placeholder="Родитель (опц.)" style={{ width: 200 }} options={flatOptions} />
        </Form.Item>
        <Form.Item>
          <Button type="primary" icon={<PlusOutlined />} htmlType="submit" loading={add.isPending}>
            Добавить
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}

export function CategoriesAdmin() {
  return (
    <div>
      <Text type="secondary">Виды работ (СМР) и категории материалов для тендеров и подписок поставщиков.</Text>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <CategoryColumn kind="smr" />
        </Col>
        <Col xs={24} lg={12}>
          <CategoryColumn kind="materials" />
        </Col>
      </Row>
    </div>
  );
}
