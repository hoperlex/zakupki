import { BellOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Empty, List, Typography } from 'antd';
import type { NotificationOutput } from '@zakupki/shared';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { formatDateTime } from '../../lib/format';

const { Title, Text, Paragraph } = Typography;

interface NotifList {
  unread: number;
  items: NotificationOutput[];
}

export function fetchNotifications(): Promise<NotifList> {
  return api<NotifList>('/notifications');
}

export function NotificationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: fetchNotifications });

  const markRead = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <div>
      <Title level={3}>Уведомления</Title>
      <Card
        extra={
          data?.unread ? (
            <Button size="small" onClick={() => markAll.mutate()}>
              Прочитать все
            </Button>
          ) : null
        }
      >
        {!data || data.items.length === 0 ? (
          <Empty image={<BellOutlined style={{ fontSize: 40, color: '#8B8996' }} />} description="Уведомлений нет" />
        ) : (
          <List
            dataSource={data.items}
            renderItem={(n) => (
              <List.Item
                style={{ cursor: n.link ? 'pointer' : 'default', background: n.readAt ? undefined : '#F9F9FA' }}
                onClick={() => {
                  if (!n.readAt) markRead.mutate(n.id);
                  if (n.link) {
                    const path = n.link.replace(/^https?:\/\/[^/]+/, '');
                    navigate(path);
                  }
                }}
              >
                <List.Item.Meta
                  avatar={<Badge dot={!n.readAt}><BellOutlined style={{ fontSize: 18 }} /></Badge>}
                  title={<Text strong={!n.readAt}>{n.title}</Text>}
                  description={
                    <div>
                      {n.body && <Paragraph style={{ marginBottom: 4 }}>{n.body}</Paragraph>}
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {formatDateTime(n.createdAt)}
                      </Text>
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>
    </div>
  );
}
