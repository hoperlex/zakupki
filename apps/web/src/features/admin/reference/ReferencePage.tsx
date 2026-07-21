import { Tabs, Typography } from 'antd';
import { CounterpartiesTab } from './CounterpartiesTab';

const { Title } = Typography;

export function ReferencePage() {
  return (
    <div>
      <Title level={3}>Справочники</Title>
      <Tabs
        items={[{ key: 'counterparties', label: 'Контрагенты', children: <CounterpartiesTab /> }]}
      />
    </div>
  );
}
