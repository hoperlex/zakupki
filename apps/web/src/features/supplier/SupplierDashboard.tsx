import { ArrowRightOutlined, ProfileOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Row, Statistic, Typography } from 'antd';
import { ACCREDITATION_STATUS_LABELS } from '@zakupki/shared';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { TenderCard } from '../../components/TenderCard';
import { AccreditationTag } from '../../components/StatusTag';
import { fetchTenders } from '../catalog/api';

const { Title, Text } = Typography;

export function SupplierDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ['tenders', 'dash'], queryFn: () => fetchTenders({ limit: 3, sort: 'deadline_asc' }) });

  const status = user?.accreditationStatus ?? 'none';

  return (
    <div>
      <Title level={3}>Здравствуйте, {user?.fullName}</Title>

      {!user?.companyCardComplete && (
        <Alert
          type="warning"
          showIcon
          icon={<ProfileOutlined />}
          style={{ marginBottom: 16 }}
          message="Заполните карточку компании"
          description="Чтобы участвовать в тендерах, заполните реквизиты и пройдите аккредитацию."
          action={
            <Button type="primary" onClick={() => navigate('/app/company')}>
              Заполнить
            </Button>
          }
        />
      )}

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} md={8}>
          <Card>
            <Statistic
              title="Аккредитация"
              valueRender={() => <AccreditationTag status={status} />}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {status === 'accredited'
                ? 'Вы можете участвовать в открытых тендерах'
                : ACCREDITATION_STATUS_LABELS[status]}
            </Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="Открытых тендеров" value={data?.total ?? 0} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card
            hoverable
            onClick={() => navigate('/app/company')}
            style={{ height: '100%' }}
          >
            <Statistic
              title="Карточка компании"
              valueRender={() => (
                <Text style={{ fontSize: 16 }}>
                  {user?.companyCardComplete ? 'Заполнена' : 'Не заполнена'} <ArrowRightOutlined />
                </Text>
              )}
              prefix={<SafetyCertificateOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={4} style={{ margin: 0 }}>
            Ближайшие тендеры
          </Title>
        </Col>
        <Col>
          <Button type="link" onClick={() => navigate('/app/tenders')}>
            Все тендеры <ArrowRightOutlined />
          </Button>
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        {(data?.items ?? []).map((t) => (
          <Col xs={24} md={8} key={t.id}>
            <TenderCard tender={t} />
          </Col>
        ))}
      </Row>
    </div>
  );
}
