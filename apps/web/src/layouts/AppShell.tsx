import {
  AppstoreOutlined,
  AuditOutlined,
  BellOutlined,
  BookOutlined,
  DashboardOutlined,
  FileAddOutlined,
  FileSearchOutlined,
  LogoutOutlined,
  ProfileOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Avatar, Badge, Button, Dropdown, Layout, Menu, Space, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Logo } from '../components/Logo';
import { roleLabel } from '../lib/nav';
import { fetchNotifications } from '../features/notifications/NotificationsPage';

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

type Item = { key: string; icon: React.ReactNode; label: string; adminOnly?: boolean };

const SUPPLIER_MENU: Item[] = [
  { key: '/app', icon: <DashboardOutlined />, label: 'Дашборд' },
  { key: '/app/tenders', icon: <FileSearchOutlined />, label: 'Тендеры' },
  { key: '/app/my-bids', icon: <AppstoreOutlined />, label: 'Мои предложения' },
  { key: '/app/company', icon: <ProfileOutlined />, label: 'Карточка компании' },
  { key: '/app/notifications', icon: <BellOutlined />, label: 'Уведомления' },
];

const ADMIN_MENU: Item[] = [
  { key: '/admin', icon: <DashboardOutlined />, label: 'Дашборд' },
  { key: '/admin/tenders', icon: <FileSearchOutlined />, label: 'Тендеры' },
  { key: '/admin/tenders/new', icon: <FileAddOutlined />, label: 'Новый тендер' },
  { key: '/admin/suppliers', icon: <TeamOutlined />, label: 'Поставщики' },
  { key: '/admin/categories', icon: <AppstoreOutlined />, label: 'Категории' },
  { key: '/admin/reference', icon: <BookOutlined />, label: 'Справочники' },
  { key: '/admin/administration', icon: <SettingOutlined />, label: 'Администрирование', adminOnly: true },
];

const SECURITY_MENU: Item[] = [
  { key: '/sb/queue', icon: <SafetyCertificateOutlined />, label: 'Очередь аккредитации' },
];

export function AppShell({ area }: { area: 'supplier' | 'admin' | 'security' }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const items =
    area === 'supplier'
      ? SUPPLIER_MENU
      : area === 'admin'
        ? ADMIN_MENU.filter((i) => !i.adminOnly || user?.role === 'admin')
        : SECURITY_MENU;
  const notifPath = area === 'supplier' ? '/app/notifications' : area === 'admin' ? '/admin/notifications' : '/sb/notifications';
  const { data: notif } = useQuery({
    queryKey: ['notifications'],
    queryFn: fetchNotifications,
    refetchInterval: 30_000,
  });

  const selected = useMemo(() => {
    // pick the longest matching key
    const match = items
      .map((i) => i.key)
      .filter((k) => location.pathname === k || location.pathname.startsWith(k + '/'))
      .sort((a, b) => b.length - a.length)[0];
    return match ?? items[0]?.key;
  }, [items, location.pathname]);

  if (!user) return null;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="light" width={248} style={{ borderRight: '1px solid #E4E5E9' }} breakpoint="lg" collapsedWidth={0}>
        <div style={{ padding: '18px 20px', borderBottom: '1px solid #E4E5E9' }}>
          <Logo to={items[0]!.key} />
        </div>
        <Menu
          mode="inline"
          selectedKeys={selected ? [selected] : []}
          style={{ borderInlineEnd: 'none', marginTop: 8 }}
          items={items.map((i) => ({ key: i.key, icon: i.icon, label: i.label }))}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            borderBottom: '1px solid #E4E5E9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            padding: '0 24px',
            gap: 16,
          }}
        >
          <Badge count={notif?.unread ?? 0} size="small">
            <Button type="text" icon={<BellOutlined />} onClick={() => navigate(notifPath)} />
          </Badge>
          <Dropdown
            menu={{
              items: [
                { key: 'site', icon: <AuditOutlined />, label: 'На витрину тендеров', onClick: () => navigate('/') },
                { type: 'divider' },
                {
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: 'Выйти',
                  onClick: async () => {
                    await logout();
                    navigate('/');
                  },
                },
              ],
            }}
          >
            <Space style={{ cursor: 'pointer' }}>
              <Avatar size="small" style={{ background: '#A05850' }} icon={<UserOutlined />} />
              <span style={{ lineHeight: 1.1 }}>
                <Text strong style={{ display: 'block' }}>
                  {user.fullName}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {roleLabel(user.role)}
                </Text>
              </span>
            </Space>
          </Dropdown>
        </Header>
        <Content style={{ padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
