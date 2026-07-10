import { Col, Layout, Row, Space, Typography } from 'antd';
import { Logo } from './Logo';

const { Footer } = Layout;
const { Text, Link } = Typography;

export function BrandFooter() {
  return (
    <Footer style={{ background: '#000', color: '#fff', padding: '40px 32px' }}>
      <Row gutter={[32, 24]} style={{ maxWidth: 1200, margin: '0 auto' }}>
        <Col xs={24} md={10}>
          <Logo inverse />
          <p style={{ color: '#8B8996', marginTop: 16, maxWidth: 360 }}>
            ООО «СУ-10» — генеральный подрядчик в строительстве многофункциональных жилых комплексов
            в г. Москве. Партнёрство, ответственность и профессионализм.
          </p>
        </Col>
        <Col xs={12} md={7}>
          <Text strong style={{ color: '#fff', display: 'block', marginBottom: 12 }}>
            Разделы
          </Text>
          <Space direction="vertical">
            <Link href="/tenders" style={{ color: '#8B8996' }}>
              Тендеры
            </Link>
            <Link href="/register" style={{ color: '#8B8996' }}>
              Регистрация поставщика
            </Link>
          </Space>
        </Col>
        <Col xs={12} md={7}>
          <Text strong style={{ color: '#fff', display: 'block', marginBottom: 12 }}>
            Контакты
          </Text>
          <Space direction="vertical">
            <Text style={{ color: '#8B8996' }}>г. Москва</Text>
            <Link href="https://su10.ru" target="_blank" style={{ color: '#8B8996' }}>
              su10.ru
            </Link>
          </Space>
        </Col>
      </Row>
      <div
        style={{
          maxWidth: 1200,
          margin: '24px auto 0',
          paddingTop: 16,
          borderTop: '1px solid #1E1D1D',
          color: '#8B8996',
          fontSize: 13,
        }}
      >
        © {new Date().getFullYear()} ООО «СУ-10». Тендерная площадка.
      </div>
    </Footer>
  );
}
