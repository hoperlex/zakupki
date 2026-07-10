import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notifications } from '@zakupki/db';
import { notFound } from '../../lib/errors';

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/', { preHandler: app.authenticate }, async (request) => {
    const rows = await app.db.query.notifications.findMany({
      where: eq(notifications.userId, request.user.sub),
      orderBy: [desc(notifications.createdAt)],
      limit: 50,
    });
    const unread = rows.filter((n) => !n.readAt).length;
    return {
      unread,
      items: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link,
        readAt: n.readAt ? n.readAt.toISOString() : null,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  });

  r.post(
    '/:id/read',
    { preHandler: app.authenticate, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request) => {
      const row = await app.db.query.notifications.findFirst({
        where: and(eq(notifications.id, request.params.id), eq(notifications.userId, request.user.sub)),
      });
      if (!row) throw notFound('Уведомление не найдено');
      await app.db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(eq(notifications.id, row.id));
      return { ok: true };
    },
  );

  r.post('/read-all', { preHandler: app.authenticate }, async (request) => {
    await app.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, request.user.sub), isNull(notifications.readAt)));
    return { ok: true };
  });
}
