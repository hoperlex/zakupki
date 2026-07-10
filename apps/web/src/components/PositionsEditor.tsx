import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Col, Form, Input, InputNumber, Row, Select, Typography } from 'antd';
import { UNIT_LABELS, UNITS } from '@zakupki/shared';

const { Text } = Typography;

const unitOptions = UNITS.map((u) => ({ label: UNIT_LABELS[u], value: u }));

/** Form.List editor for tender positions. Field name defaults to "positions". */
export function PositionsEditor({ name = 'positions' }: { name?: string }) {
  return (
    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <div>
          <Row gutter={8} style={{ marginBottom: 8, fontWeight: 500, color: '#8B8996' }}>
            <Col flex="40px">№</Col>
            <Col flex="auto">Наименование</Col>
            <Col flex="110px">Ед.</Col>
            <Col flex="130px">Кол-во</Col>
            <Col flex="150px">Ориент. цена</Col>
            <Col flex="40px" />
          </Row>
          {fields.map((field, idx) => (
            <Row gutter={8} key={field.key} align="top" style={{ marginBottom: 4 }}>
              <Col flex="40px" style={{ paddingTop: 8 }}>
                <Text type="secondary">{idx + 1}</Text>
              </Col>
              <Col flex="auto">
                <Form.Item
                  name={[field.name, 'name']}
                  rules={[{ required: true, message: 'Укажите наименование' }]}
                  style={{ marginBottom: 4 }}
                >
                  <Input placeholder="Наименование позиции" />
                </Form.Item>
                <Form.Item name={[field.name, 'spec']} style={{ marginBottom: 8 }}>
                  <Input placeholder="ГОСТ / марка / характеристики (опционально)" size="small" />
                </Form.Item>
              </Col>
              <Col flex="110px">
                <Form.Item
                  name={[field.name, 'unit']}
                  rules={[{ required: true, message: '!' }]}
                  style={{ marginBottom: 4 }}
                >
                  <Select options={unitOptions} placeholder="ед." />
                </Form.Item>
              </Col>
              <Col flex="130px">
                <Form.Item
                  name={[field.name, 'quantity']}
                  rules={[{ required: true, message: '!' }]}
                  style={{ marginBottom: 4 }}
                >
                  <InputNumber<string>
                    stringMode
                    min="0"
                    style={{ width: '100%' }}
                    placeholder="0"
                  />
                </Form.Item>
              </Col>
              <Col flex="150px">
                <Form.Item name={[field.name, 'targetPrice']} style={{ marginBottom: 4 }}>
                  <InputNumber<string> stringMode min="0" style={{ width: '100%' }} placeholder="₽/ед." />
                </Form.Item>
              </Col>
              <Col flex="40px" style={{ paddingTop: 4 }}>
                <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
              </Col>
            </Row>
          ))}
          <Button
            type="dashed"
            block
            icon={<PlusOutlined />}
            onClick={() => add({ unit: 'pcs', isRequired: true })}
            style={{ marginTop: 8 }}
          >
            Добавить позицию
          </Button>
        </div>
      )}
    </Form.List>
  );
}
