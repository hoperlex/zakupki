import { Typography } from 'antd';
import { TenderBrowser } from './TenderBrowser';

const { Title, Text } = Typography;

const container: React.CSSProperties = { maxWidth: 1200, margin: '0 auto', padding: '0 24px' };

export function CatalogPage() {
  return (
    <div>
      <div className="brand-hero">
        <div style={{ ...container, padding: '20px 24px' }}>
          <Text style={{ color: '#E4E5E9', letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 13 }}>
            Тендерная площадка · ООО «СУ-10»
          </Text>
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
