import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createTenderInput,
  positionInput,
  tenderListQuery,
  updateTenderInput,
} from '@zakupki/shared';
import type { AuthPayload } from '../../plugins/auth';
import {
  cancelTender,
  createTender,
  getTenderDetail,
  listTenders,
  publishTender,
  replacePositions,
  updateTender,
  type Viewer,
} from './service';

export function viewerOf(request: FastifyRequest): Viewer | null {
  const u = request.user as AuthPayload | undefined;
  return u && u.sub ? { userId: u.sub, role: u.role, orgId: u.orgId ?? null } : null;
}

const idParam = z.object({ id: z.string().uuid() });

export async function tenderRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/',
    {
      preHandler: app.optionalAuth,
      schema: { querystring: tenderListQuery.extend({ mine: z.coerce.boolean().optional() }) },
    },
    async (request) => listTenders(app.db, request.query, viewerOf(request)),
  );

  r.get(
    '/:id',
    { preHandler: app.optionalAuth, schema: { params: idParam } },
    async (request) => getTenderDetail(app.db, request.params.id, viewerOf(request)),
  );

  // ─── manager / admin ───
  r.post(
    '/',
    { preHandler: app.requireRole('manager', 'admin'), schema: { body: createTenderInput } },
    async (request, reply) => {
      const id = await createTender(app.db, request.body, viewerOf(request)!);
      return reply.status(201).send({ id });
    },
  );

  r.put(
    '/:id',
    {
      preHandler: app.requireRole('manager', 'admin'),
      schema: { params: idParam, body: updateTenderInput },
    },
    async (request) => {
      await updateTender(app.db, request.params.id, request.body, viewerOf(request)!);
      return { ok: true };
    },
  );

  r.put(
    '/:id/positions',
    {
      preHandler: app.requireRole('manager', 'admin'),
      schema: { params: idParam, body: z.object({ positions: z.array(positionInput).min(1) }) },
    },
    async (request) => {
      await replacePositions(app.db, request.params.id, request.body.positions, viewerOf(request)!);
      return { ok: true };
    },
  );

  r.post(
    '/:id/publish',
    { preHandler: app.requireRole('manager', 'admin'), schema: { params: idParam } },
    async (request) => {
      await publishTender(app.db, request.params.id, viewerOf(request)!);
      return { ok: true };
    },
  );

  r.post(
    '/:id/cancel',
    {
      preHandler: app.requireRole('manager', 'admin'),
      schema: { params: idParam, body: z.object({ reason: z.string().max(500).optional() }) },
    },
    async (request) => {
      await cancelTender(app.db, request.params.id, viewerOf(request)!, request.body.reason);
      return { ok: true };
    },
  );
}
