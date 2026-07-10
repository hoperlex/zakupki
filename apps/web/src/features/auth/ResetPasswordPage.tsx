import { App, Button, Form, Input, Result } from 'antd';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { AuthCard } from './AuthCard';

export function ResetPasswordPage() {
  const { message } = App.useApp();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const onFinish = async (values: { password: string }) => {
    setLoading(true);
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password: values.password } });
      setDone(true);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : 'Ошибка сброса пароля');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthCard title="Сброс пароля">
        <Result status="error" subTitle="Ссылка недействительна." extra={<Link to="/login">Ко входу</Link>} />
      </AuthCard>
    );
  }
  if (done) {
    return (
      <AuthCard title="Пароль обновлён">
        <Result status="success" subTitle="Теперь войдите с новым паролем." extra={<Link to="/login">Войти</Link>} />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Новый пароль">
      <Form layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
        <Form.Item name="password" label="Новый пароль" rules={[{ required: true, min: 8 }]}>
          <Input.Password placeholder="Минимум 8 символов" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading}>
          Сохранить
        </Button>
      </Form>
    </AuthCard>
  );
}
