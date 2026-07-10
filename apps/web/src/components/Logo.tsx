import { Link } from 'react-router-dom';

export function Logo({ inverse = false, to = '/' }: { inverse?: boolean; to?: string }) {
  const ink = inverse ? '#FFFFFF' : '#1E1D1D';
  return (
    <Link to={to} style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <span
        className="su-display"
        style={{
          fontWeight: 800,
          fontSize: 26,
          color: ink,
          lineHeight: 1,
          letterSpacing: '-0.02em',
        }}
      >
        СУ<span style={{ color: '#A05850' }}>·</span>10
      </span>
      <span
        className="su-uppercase"
        style={{ fontSize: 11, fontWeight: 600, color: inverse ? '#8B8996' : '#8B8996', lineHeight: 1.15 }}
      >
        Тендерный
        <br />
        портал
      </span>
    </Link>
  );
}
