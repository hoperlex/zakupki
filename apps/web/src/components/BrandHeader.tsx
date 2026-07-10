import { DownOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { Avatar, Button, Dropdown, Layout, Space, Typography } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { cabinetPath, roleLabel } from '../lib/nav';
import { Logo } from './Logo';

const { Header } = Layout;
const { Text } = Typography;

export function BrandHeader() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <Header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 32px',
        borderBottom: '1px solid #E4E5E9',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        background: '#fff',
      }}
    >
      <Space size={32} align="center">
        <Logo />
        <Space size={20} className="su-uppercase" style={{ fontSize: 14 }}>
          <Link to="/tenders" style={{ color: '#1E1D1D', fontWeight: 500 }}>
            Тендеры
          </Link>
        </Space>
      </Space>

      {user ? (
        <Dropdown
          menu={{
            items: [
              { key: 'cabinet', label: 'Личный кабинет', onClick: () => navigate(cabinetPath(user.role)) },
              { type: 'divider' },
              {
                key: 'logout',
                label: 'Выйти',
                icon: <LogoutOutlined />,
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
            <span>
              <Text strong style={{ display: 'block', lineHeight: 1.2 }}>
                {user.fullName}
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {roleLabel(user.role)}
              </Text>
            </span>
            <DownOutlined style={{ fontSize: 10, color: '#8B8996' }} />
          </Space>
        </Dropdown>
      ) : (
        <Space>
          <Button type="text" onClick={() => navigate('/login')}>
            Войти
          </Button>
          <Button type="primary" onClick={() => navigate('/register')}>
            Регистрация
          </Button>
        </Space>
      )}
    </Header>
  );
}
