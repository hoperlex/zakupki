import { useEffect, useState } from 'react';

export interface Countdown {
  ended: boolean;
  ms: number;
  label: string;
  urgent: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function useCountdown(deadline: string | Date | null | undefined): Countdown {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!deadline) return { ended: true, ms: 0, label: '—', urgent: false };
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return { ended: true, ms: 0, label: 'Завершён', urgent: false };

  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const clock = `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  const label = days > 0 ? `${days} дн. ${clock}` : clock;
  return { ended: false, ms, label, urgent: ms < 15 * 60 * 1000 };
}
