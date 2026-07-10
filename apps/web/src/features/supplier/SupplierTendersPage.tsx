import { Typography } from 'antd';
import { TenderBrowser } from '../catalog/TenderBrowser';

const { Title } = Typography;

export function SupplierTendersPage() {
  return (
    <div>
      <Title level={3}>Тендеры</Title>
      <TenderBrowser />
    </div>
  );
}
