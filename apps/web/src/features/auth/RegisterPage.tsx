import { App, Button, Form, Input } from 'antd';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { RegisterInput } from '@zakupki/shared';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { AuthCard } from './AuthCard';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

  const onFinish = async (values: RegisterInput & { confirm?: string }) => {
    setLoading(true);
    try {
      const { confirm: _c, ...input } = values;
      await register(input);
      message.success('Аккаунт создан. Заполните карточку компании.');
      navigate('/app/company', { replace: true });
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : 'Ошибка регистрации');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard
      title="Регистрация поставщика"
      subtitle="После регистрации заполните карточку компании для аккредитации"
      footer={
        <span>
          Уже есть аккаунт? <Link to="/login">Войти</Link>
        </span>
      }
    >
      <Form layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
        <Form.Item name="fullName" label="ФИО" rules={[{ required: true, message: 'Укажите ФИО' }]}>
          <Input placeholder="Иванов Иван Иванович" autoComplete="name" />
        </Form.Item>
        <Form.Item
          name="email"
          label="Email"
          rules={[{ required: true, type: 'email', message: 'Введите корректный email' }]}
        >
          <Input placeholder="you@company.ru" autoComplete="email" />
        </Form.Item>
        <Form.Item name="phone" label="Телефон">
          <Input placeholder="+7 999 000-00-00" autoComplete="tel" />
        </Form.Item>
        <Form.Item
          name="password"
          label="Пароль"
          rules={[{ required: true, min: 8, message: 'Минимум 8 символов' }]}
        >
          <Input.Password placeholder="Минимум 8 символов" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="Повторите пароль"
          dependencies={['password']}
          rules={[
            { required: true, message: 'Повторите пароль' },
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                !value || getFieldValue('password') === value
                  ? Promise.resolve()
                  : Promise.reject(new Error('Пароли не совпадают')),
            }),
          ]}
        >
          <Input.Password placeholder="••••••••" autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading}>
          Зарегистрироваться
        </Button>
      </Form>
    </AuthCard>
  );
}
