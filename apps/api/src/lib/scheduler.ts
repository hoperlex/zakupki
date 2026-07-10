import { and, eq, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { tenders } from '@zakupki/db';
import { bus } from './events';

/**
 * Lightweight in-process scheduler: transitions tenders past their deadline
 * from `collecting` → `under_review`, and `published` → `collecting` when startsAt passes.
 */
export function startScheduler(app: FastifyInstance): void {
  const tick = async () => {
    const now = new Date();
    try {
      // published -> collecting when start time reached
      const started = await app.db
        .update(tenders)
        .set({ status: 'collecting', updatedAt: now })
        .where(
          and(eq(tenders.status, 'published'), lte(tenders.startsAt, now)),
        )
        .returning({ id: tenders.id });
      for (const t of started) bus.emitTenderChanged(t.id, 'status');

      // collecting -> under_review when deadline passed
      const closed = await app.db
        .update(tenders)
        .set({ status: 'under_review', updatedAt: now })
        .where(and(eq(tenders.status, 'collecting'), lte(tenders.deadlineAt, now)))
        .returning({ id: tenders.id });
      for (const t of closed) bus.emitTenderChanged(t.id, 'deadline');
    } catch (err) {
      app.log.error({ err }, 'scheduler tick failed');
    }
  };

  const interval = setInterval(tick, 30_000);
  app.addHook('onClose', async () => clearInterval(interval));
  // run once shortly after boot
  setTimeout(tick, 3_000);
}
