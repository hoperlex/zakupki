import { Col, Row, Typography } from 'antd';
import { TenderBrowser } from './TenderBrowser';

const { Title, Text } = Typography;

const KPIS = [
  { value: '5 000 000 м²', label: 'построено недвижимости' },
  { value: '60 000+', label: 'квартир передано' },
  { value: '100+', label: 'реализованных проектов' },
  { value: '30+ лет', label: 'на рынке с 1991 г.' },
];

const container: React.CSSProperties = { maxWidth: 1200, margin: '0 auto', padding: '0 24px' };

export function CatalogPage() {
  return (
    <div>
      <div className="brand-hero">
        <div style={{ ...container, padding: '56px 24px 48px' }}>
          <Text style={{ color: '#E4E5E9', letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 13 }}>
            Тендерная площадка · ООО «СУ-10»
          </Text>
          <Title
            className="su-display"
            style={{ color: '#fff', margin: '12px 0 8px', fontSize: 40, fontWeight: 800, maxWidth: 820 }}
          >
            Строим Москву: от проекта до сдачи «под ключ». В десятку!
          </Title>
          <Text style={{ color: '#E4E5E9', fontSize: 16, maxWidth: 680, display: 'block' }}>
            Открытые и закрытые тендеры на строительно-монтажные работы и поставку материалов.
            Подавайте предложения, следите за своим местом в реальном времени.
          </Text>
          <Row gutter={[24, 16]} style={{ marginTop: 36 }}>
            {KPIS.map((k) => (
              <Col xs={12} md={6} key={k.label}>
                <div className="su-display" style={{ color: '#fff', fontSize: 26, fontWeight: 700 }}>
                  {k.value}
                </div>
                <Text style={{ color: '#8B8996', fontSize: 13 }}>{k.label}</Text>
              </Col>
            ))}
          </Row>
        </div>
      </div>

      <div style={{ ...container, padding: '32px 24px 56px' }}>
        <Title level={3} style={{ marginBottom: 20 }}>
          Открытые тендеры
        </Title>
        <TenderBrowser />
      </div>
    </div>
  );
}
