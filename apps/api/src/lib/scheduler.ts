import { and, eq, lte, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { bids, tenders } from '@zakupki/db';
import { env } from '../config/env';
import { bumpRevision } from '../modules/tenders/service';
import { bus } from './events';
import { notifyOrg, notifyUser } from './notify';

/**
 * Один проход планировщика. Вынесен из startScheduler и экспортирован, чтобы
 * переходы по дедлайну можно было проверить детерминированно, не дожидаясь таймера.
 */
export async function runSchedulerTick(app: FastifyInstance): Promise<void> {
  {
    const now = new Date();
    try {
      // published -> collecting when start time reached
      const started = await app.db
        .update(tenders)
        .set({ status: 'collecting', updatedAt: now, revision: bumpRevision() })
        .where(and(eq(tenders.status, 'published'), lte(tenders.startsAt, now)))
        .returning({ id: tenders.id });
      for (const t of started) bus.emitTenderChanged(t.id, 'status');

      // collecting -> under_review when deadline passed
      const closed = await app.db
        .update(tenders)
        .set({ status: 'under_review', updatedAt: now, revision: bumpRevision() })
        .where(and(eq(tenders.status, 'collecting'), lte(tenders.deadlineAt, now)))
        .returning({
          id: tenders.id,
          number: tenders.number,
          title: tenders.title,
          createdBy: tenders.createdBy,
        });

      for (const t of closed) {
        bus.emitTenderChanged(t.id, 'deadline');
        // notify the manager to review
        await notifyUser(app.db, t.createdBy, {
          type: 'deadline',
          title: `Тендер ${t.number}: приём завершён`,
          body: `По тендеру «${t.title}» завершён приём предложений — подведите итоги.`,
          link: `${env.PUBLIC_WEB_URL}/admin/tenders/${t.id}/bids`,
        });
        // notify participants
        const partRows = await app.db
          .selectDistinct({ orgId: bids.supplierOrgId })
          .from(bids)
          .where(and(eq(bids.tenderId, t.id), ne(bids.status, 'withdrawn')));
        for (const p of partRows) {
          await notifyOrg(app.db, p.orgId, {
            type: 'deadline',
            title: `Тендер ${t.number}: приём завершён`,
            body: `Приём предложений завершён. Ожидайте подведения итогов.`,
            link: `${env.PUBLIC_WEB_URL}/app/tenders/${t.id}`,
          });
        }
      }
    } catch (err) {
      app.log.error({ err }, 'scheduler tick failed');
    }
  }
}

/**
 * Lightweight in-process scheduler: transitions tenders past their deadline
 * from `collecting` → `under_review`, and `published` → `collecting` when startsAt passes.
 */
export function startScheduler(app: FastifyInstance): void {
  const tick = () => {
    void runSchedulerTick(app);
  };
  const interval = setInterval(tick, 30_000);
  app.addHook('onClose', async () => clearInterval(interval));
  setTimeout(tick, 3_000);
}
