import { Card, Typography } from 'antd';
import type { ReactNode } from 'react';
import { Logo } from '../../components/Logo';

const { Title, Text } = Typography;

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: '48px 16px', minHeight: '70vh' }}>
      <Card style={{ width: 440, maxWidth: '100%' }} styles={{ body: { padding: 32 } }}>
        <div style={{ marginBottom: 20 }}>
          <Logo />
        </div>
        <Title level={3} style={{ marginBottom: 4 }}>
          {title}
        </Title>
        {subtitle && <Text type="secondary">{subtitle}</Text>}
        <div style={{ marginTop: 24 }}>{children}</div>
        {footer && <div style={{ marginTop: 20, textAlign: 'center' }}>{footer}</div>}
      </Card>
    </div>
  );
}
