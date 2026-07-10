import { Layout } from 'antd';
import { Outlet } from 'react-router-dom';
import { BrandFooter } from '../components/BrandFooter';
import { BrandHeader } from '../components/BrandHeader';

const { Content } = Layout;

export function PublicLayout() {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <BrandHeader />
      <Content>
        <Outlet />
      </Content>
      <BrandFooter />
    </Layout>
  );
}
