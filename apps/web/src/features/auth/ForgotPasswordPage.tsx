import { App, Button, Form, Input, Result } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { AuthCard } from './AuthCard';

export function ForgotPasswordPage() {
  const { message } = App.useApp();
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const onFinish = async (values: { email: string }) => {
    setLoading(true);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: values });
      setSent(true);
    } catch {
      message.error('Не удалось отправить письмо');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <AuthCard title="Проверьте почту">
        <Result
          status="success"
          subTitle="Если аккаунт с таким email существует, мы отправили ссылку для сброса пароля."
          extra={<Link to="/login">Вернуться ко входу</Link>}
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Восстановление пароля"
      subtitle="Укажите email — вышлем ссылку для сброса"
      footer={<Link to="/login">Вернуться ко входу</Link>}
    >
      <Form layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
        <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
          <Input placeholder="you@company.ru" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading}>
          Отправить ссылку
        </Button>
      </Form>
    </AuthCard>
  );
}
