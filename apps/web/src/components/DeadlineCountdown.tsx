import { ClockCircleOutlined } from '@ant-design/icons';
import { Typography } from 'antd';
import { useCountdown } from '../hooks/useCountdown';

const { Text } = Typography;

export function DeadlineCountdown({
  deadline,
  size = 'default',
}: {
  deadline: string | Date | null | undefined;
  size?: 'default' | 'large';
}) {
  const { label, ended, urgent } = useCountdown(deadline);
  const color = ended ? '#8B8996' : urgent ? '#FF0000' : '#1E1D1D';
  return (
    <Text
      strong
      className="mono-num"
      style={{ color, fontSize: size === 'large' ? 22 : 14, whiteSpace: 'nowrap' }}
    >
      <ClockCircleOutlined style={{ marginRight: 6 }} />
      {label}
    </Text>
  );
}
