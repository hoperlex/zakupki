import { Tabs, Typography } from 'antd';
import { UsersTab } from './UsersTab';

const { Title } = Typography;

export function AdministrationPage() {
  return (
    <div>
      <Title level={3}>Администрирование</Title>
      <Tabs
        items={[{ key: 'users', label: 'Пользователи', children: <UsersTab /> }]}
      />
    </div>
  );
}
