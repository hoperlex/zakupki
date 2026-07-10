import { CrownOutlined, TeamOutlined, TrophyOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Card, Col, Empty, Row, Statistic, Tag, Typography } from 'antd';
import type { RankSnapshot, TenderDetail } from '@zakupki/shared';
import { api } from '../../api/client';
import { DeadlineCountdown } from '../../components/DeadlineCountdown';
import { useTenderRankStream } from '../../hooks/useTenderRankStream';
import { formatMoney } from '../../lib/format';

const { Text } = Typography;

export function MyRankPanel({ tender }: { tender: TenderDetail }) {
  const streamEnabled = tender.status === 'collecting';
  const { data: initial } = useQuery({
    queryKey: ['my-rank', tender.id],
    queryFn: () => api<RankSnapshot>(`/tenders/${tender.id}/my-rank`),
  });
  const live = useTenderRankStream(tender.id, streamEnabled);
  const snap = live ?? initial;

  if (!snap) return null;

  const hasBid = snap.yourRank != null;

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} md={8}>
        <Card>
          <div style={{ textAlign: 'center' }}>
            <Text type="secondary">Ваше место</Text>
            <div className="su-display" style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.1, color: snap.isBest ? '#389e0d' : '#A05850' }}>
              {hasBid ? snap.yourRank : '—'}
            </div>
            <Text type="secondary">из {snap.participants} участников</Text>
            <div style={{ marginTop: 12 }}>
              {snap.isBest ? (
                <Tag icon={<CrownOutlined />} color="green">
                  Вы лидируете
                </Tag>
              ) : hasBid ? (
                <Tag icon={<TrophyOutlined />} color="gold">
                  Можно снизить цену
                </Tag>
              ) : (
                <Tag>Предложение не подано</Tag>
              )}
            </div>
          </div>
        </Card>
      </Col>
      <Col xs={12} md={8}>
        <Card>
          <Statistic
            title="Ваше предложение (с НДС)"
            value={hasBid ? formatMoney(snap.yourTotalWithVat, false) : '—'}
            suffix={hasBid ? '₽' : ''}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            <TeamOutlined /> Цены конкурентов скрыты
          </Text>
        </Card>
      </Col>
      <Col xs={12} md={8}>
        <Card>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            До окончания приёма
          </Text>
          <DeadlineCountdown deadline={snap.deadlineAt} size="large" />
          {tender.autoExtendEnabled && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Антиснайпинг: ставка в последние 5 мин продлевает торги
              </Text>
            </div>
          )}
        </Card>
      </Col>

      {!hasBid && (
        <Col span={24}>
          <Empty description="Перейдите на вкладку «Предложение», чтобы подать цену" />
        </Col>
      )}
    </Row>
  );
}
