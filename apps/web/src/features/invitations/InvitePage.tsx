import { CalendarOutlined, SafetyOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Descriptions, Form, Input, Result, Space, Spin, Typography } from 'antd';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { Logo } from '../../components/Logo';
import { TENDER_TYPE_LABELS, type TenderType } from '@zakupki/shared';
import { formatDateTime } from '../../lib/format';
import { acceptInvite, fetchInvitePreview } from './api';

const { Title, Text } = Typography;

export function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

  const { data: preview, isLoading } = useQuery({
    queryKey: ['invite', token],
    queryFn: () => fetchInvitePreview(token),
  });

  if (isLoading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '70vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!preview?.valid || !preview.tender) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '70vh' }}>
        <Card style={{ width: 460 }}>
          <Result status="warning" title="Приглашение недействительно" subTitle={preview?.reason ?? 'Ссылка неверна'} extra={<Link to="/">На главную</Link>} />
        </Card>
      </div>
    );
  }

  const tender = preview.tender;

  const goAfterAccept = (tenderId: string, cardComplete: boolean) => {
    if (!cardComplete) {
      message.info('Заполните карточку компании, чтобы участвовать');
      navigate('/app/company', { replace: true });
    } else {
      navigate(`/app/tenders/${tenderId}`, { replace: true });
    }
  };

  const acceptLoggedIn = async () => {
    setLoading(true);
    try {
      const res = await acceptInvite(token, {});
      goAfterAccept(res.tenderId, user?.companyCardComplete ?? false);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  const acceptNew = async (values: { fullName: string; password: string; phone?: string }) => {
    setLoading(true);
    try {
      const res = await acceptInvite(token, values);
      qc.setQueryData(['me'], res.user);
      goAfterAccept(res.tenderId, res.user.companyCardComplete);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : 'Ошибка регистрации');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: '40px 16px' }}>
      <Card style={{ width: 560, maxWidth: '100%' }} styles={{ body: { padding: 32 } }}>
        <Logo />
        <Title level={3} style={{ marginTop: 20 }}>
          Приглашение к участию в тендере
        </Title>
        <Card size="small" style={{ background: '#F9F9FA', marginBottom: 20 }}>
          <Text type="secondary" className="mono-num">
            {tender.number}
          </Text>
          <div style={{ fontSize: 17, fontWeight: 600, margin: '4px 0' }}>{tender.title}</div>
          <Descriptions column={1} size="small" style={{ marginTop: 8 }}>
            <Descriptions.Item label="Заказчик">{tender.organizationName}</Descriptions.Item>
            <Descriptions.Item label="Тип">
              {TENDER_TYPE_LABELS[tender.type as TenderType] ?? tender.type}
            </Descriptions.Item>
            <Descriptions.Item label={<CalendarOutlined />}>
              до {formatDateTime(tender.deadlineAt)}
            </Descriptions.Item>
          </Descriptions>
        </Card>

        {user ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text>
              Вы вошли как <b>{user.fullName}</b>. Примите приглашение, чтобы участвовать.
            </Text>
            <Button type="primary" size="large" block loading={loading} onClick={acceptLoggedIn}>
              Принять приглашение
            </Button>
          </Space>
        ) : (
          <div>
            <Text type="secondary">
              <SafetyOutlined /> Зарегистрируйтесь, чтобы участвовать. После — заполните карточку компании.
            </Text>
            <Form layout="vertical" onFinish={acceptNew} requiredMark={false} style={{ marginTop: 16 }}>
              <Form.Item label="Email">
                <Input value={preview.email ?? ''} disabled />
              </Form.Item>
              <Form.Item name="fullName" label="ФИО" rules={[{ required: true, message: 'Укажите ФИО' }]}>
                <Input placeholder="Иванов Иван Иванович" />
              </Form.Item>
              <Form.Item name="phone" label="Телефон">
                <Input />
              </Form.Item>
              <Form.Item name="password" label="Пароль" rules={[{ required: true, min: 8, message: 'Минимум 8 символов' }]}>
                <Input.Password placeholder="Минимум 8 символов" />
              </Form.Item>
              <Button type="primary" size="large" block htmlType="submit" loading={loading}>
                Зарегистрироваться и участвовать
              </Button>
            </Form>
          </div>
        )}
      </Card>
    </div>
  );
}
