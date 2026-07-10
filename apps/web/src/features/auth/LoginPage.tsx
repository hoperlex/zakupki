import { App, Button, Form, Input } from 'antd';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { LoginInput } from '@zakupki/shared';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { cabinetPath } from '../../lib/nav';
import { AuthCard } from './AuthCard';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

  const onFinish = async (values: LoginInput) => {
    setLoading(true);
    try {
      const user = await login(values);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? cabinetPath(user.role), { replace: true });
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard
      title="Вход в кабинет"
      subtitle="Тендерный портал ООО «СУ-10»"
      footer={
        <span>
          Нет аккаунта? <Link to="/register">Зарегистрироваться</Link>
        </span>
      }
    >
      <Form layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
        <Form.Item
          name="email"
          label="Email"
          rules={[{ required: true, type: 'email', message: 'Введите корректный email' }]}
        >
          <Input placeholder="you@company.ru" autoComplete="email" />
        </Form.Item>
        <Form.Item name="password" label="Пароль" rules={[{ required: true, message: 'Введите пароль' }]}>
          <Input.Password placeholder="••••••••" autoComplete="current-password" />
        </Form.Item>
        <div style={{ textAlign: 'right', marginBottom: 12 }}>
          <Link to="/forgot-password">Забыли пароль?</Link>
        </div>
        <Button type="primary" htmlType="submit" block loading={loading}>
          Войти
        </Button>
      </Form>
    </AuthCard>
  );
}
