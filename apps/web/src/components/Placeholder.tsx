import { ToolOutlined } from '@ant-design/icons';
import { Card, Empty, Typography } from 'antd';

const { Title } = Typography;

export function Placeholder({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <Title level={3}>{title}</Title>
      <Card>
        <Empty
          image={<ToolOutlined style={{ fontSize: 48, color: '#8B8996' }} />}
          description={hint ?? 'Раздел в разработке'}
        />
      </Card>
    </div>
  );
}
