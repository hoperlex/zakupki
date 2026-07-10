import { AppstoreOutlined, LockOutlined, TeamOutlined, ToolOutlined } from '@ant-design/icons';
import { Card, Space, Tag, Typography } from 'antd';
import { TENDER_TYPE_LABELS, type TenderSummary } from '@zakupki/shared';
import { useNavigate } from 'react-router-dom';
import { DeadlineCountdown } from './DeadlineCountdown';
import { TenderStatusTag } from './StatusTag';

const { Text, Paragraph } = Typography;

export function TenderCard({ tender }: { tender: TenderSummary }) {
  const navigate = useNavigate();
  return (
    <Card
      hoverable
      className="tender-card"
      styles={{ body: { padding: 20 } }}
      onClick={() => navigate(`/tenders/${tender.id}`)}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space size={8} wrap>
          <Text type="secondary" className="mono-num" style={{ fontSize: 13 }}>
            {tender.number}
          </Text>
          <TenderStatusTag status={tender.status} />
          {tender.visibility === 'closed' && (
            <Tag icon={<LockOutlined />} color="default">
              Закрытый
            </Tag>
          )}
        </Space>

        <Paragraph
          strong
          ellipsis={{ rows: 2 }}
          style={{ margin: 0, minHeight: 46, fontSize: 16, lineHeight: 1.4 }}
        >
          {tender.title}
        </Paragraph>

        <Space size={16} wrap>
          <Text type="secondary">
            {tender.type === 'smr' ? <ToolOutlined /> : <AppstoreOutlined />}{' '}
            {TENDER_TYPE_LABELS[tender.type]}
          </Text>
          {tender.categoryName && <Text type="secondary">{tender.categoryName}</Text>}
        </Space>

        <Space size={20} style={{ justifyContent: 'space-between', width: '100%' }} wrap>
          <Text type="secondary">
            <TeamOutlined /> {tender.participantsCount} участн. · {tender.positionsCount} поз.
          </Text>
          <DeadlineCountdown deadline={tender.deadlineAt} />
        </Space>
      </Space>
    </Card>
  );
}
