import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { RankSnapshot } from '@zakupki/shared';

/**
 * Subscribe to the server-sent live-rank stream for a tender.
 * EventSource sends the httpOnly access cookie automatically and auto-reconnects.
 */
export function useTenderRankStream(tenderId: string, enabled: boolean): RankSnapshot | null {
  const [snapshot, setSnapshot] = useState<RankSnapshot | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled || !tenderId) return;
    const es = new EventSource(`/api/v1/tenders/${tenderId}/rank-stream`, { withCredentials: true });
    es.onmessage = (event) => {
      try {
        const snap = JSON.parse(event.data) as RankSnapshot;
        setSnapshot(snap);
        qc.invalidateQueries({ queryKey: ['my-bid', tenderId] });
        qc.invalidateQueries({ queryKey: ['tender', tenderId] });
      } catch {
        /* ignore malformed frames */
      }
    };
    es.onerror = () => {
      /* browser EventSource reconnects automatically */
    };
    return () => es.close();
  }, [tenderId, enabled, qc]);

  return snapshot;
}
