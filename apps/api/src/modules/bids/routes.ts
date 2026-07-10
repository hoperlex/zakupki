import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { submitBidInput } from '@zakupki/shared';
import { bus } from '../../lib/events';
import { unauthorized } from '../../lib/errors';
import { viewerOf } from '../tenders/routes';
import {
  awardTender,
  getComparison,
  getMyBid,
  getMyBidsList,
  getProtocolHtml,
  getRankSnapshot,
  submitBid,
  withdrawBid,
} from './service';

const idParam = z.object({ id: z.string().uuid() });

export async function bidRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // static path — Fastify prioritizes it over '/:id'
  r.get('/my-bids', { preHandler: app.requireRole('supplier') }, async (request) =>
    getMyBidsList(app.db, viewerOf(request)!.orgId),
  );

  r.get(
    '/:id/my-bid',
    { preHandler: app.requireRole('supplier'), schema: { params: idParam } },
    async (request) => getMyBid(app.db, request.params.id, viewerOf(request)!),
  );

  r.post(
    '/:id/bid',
    { preHandler: app.requireRole('supplier'), schema: { params: idParam, body: submitBidInput } },
    async (request) => submitBid(app.db, request.params.id, viewerOf(request)!, request.body),
  );

  r.post(
    '/:id/bid/withdraw',
    { preHandler: app.requireRole('supplier'), schema: { params: idParam } },
    async (request) => {
      await withdrawBid(app.db, request.params.id, viewerOf(request)!);
      return { ok: true };
    },
  );

  r.get(
    '/:id/my-rank',
    { preHandler: app.authenticate, schema: { params: idParam } },
    async (request) => getRankSnapshot(app.db, request.params.id, viewerOf(request)!.orgId),
  );

  // SSE live-rank stream (auth via access cookie; EventSource sends it automatically)
  r.get('/:id/rank-stream', { preHandler: app.authenticate, schema: { params: idParam } }, async (request, reply) => {
    const viewer = viewerOf(request);
    if (!viewer) throw unauthorized();
    const tenderId = request.params.id;

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = async () => {
      try {
        const snap = await getRankSnapshot(app.db, tenderId, viewer.orgId);
        reply.raw.write(`data: ${JSON.stringify(snap)}\n\n`);
      } catch {
        /* ignore transient errors */
      }
    };

    await send();
    const unsub = bus.onTender(tenderId, () => {
      void send();
    });
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 20_000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsub();
    });
  });

  // ─── manager / admin ───
  r.get(
    '/:id/bids',
    { preHandler: app.requireRole('manager', 'admin'), schema: { params: idParam } },
    async (request) => getComparison(app.db, request.params.id, viewerOf(request)!),
  );

  r.post(
    '/:id/award',
    {
      preHandler: app.requireRole('manager', 'admin'),
      schema: { params: idParam, body: z.object({ bidId: z.string().uuid() }) },
    },
    async (request) => {
      await awardTender(app.db, request.params.id, viewerOf(request)!, request.body.bidId);
      return { ok: true };
    },
  );

  r.get(
    '/:id/protocol',
    { preHandler: app.requireRole('manager', 'admin'), schema: { params: idParam } },
    async (request, reply) => {
      const html = await getProtocolHtml(app.db, request.params.id, viewerOf(request)!);
      reply.type('text/html; charset=utf-8').send(html);
    },
  );
}
