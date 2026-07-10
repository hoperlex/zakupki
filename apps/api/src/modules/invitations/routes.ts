import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createInvitationsInput, type AuthResponse } from '@zakupki/shared';
import { badRequest } from '../../lib/errors';
import { issueRefreshToken, loadAuthUser, newCsrf, registerUser } from '../auth/service';
import { viewerOf } from '../tenders/routes';
import {
  acceptInvitation,
  createInvitations,
  getInvitationPreview,
  listInvitations,
  revokeInvitation,
} from './service';

const acceptBody = z.object({
  fullName: z.string().trim().max(200).optional(),
  password: z.string().min(8).max(200).optional(),
  phone: z.string().max(30).optional(),
});

export async function invitationRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ─── manager: manage invitations for a tender ───
  r.post(
    '/tenders/:id/invitations',
    {
      preHandler: app.requireRole('manager', 'admin'),
      schema: { params: z.object({ id: z.string().uuid() }), body: createInvitationsInput },
    },
    async (request, reply) => {
      const out = await createInvitations(app.db, request.params.id, viewerOf(request)!, request.body);
      return reply.status(201).send(out);
    },
  );

  r.get(
    '/tenders/:id/invitations',
    { preHandler: app.requireRole('manager', 'admin'), schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request) => listInvitations(app.db, request.params.id, viewerOf(request)!),
  );

  r.post(
    '/invitations/:invId/revoke',
    { preHandler: app.requireRole('manager', 'admin'), schema: { params: z.object({ invId: z.string().uuid() }) } },
    async (request) => {
      await revokeInvitation(app.db, request.params.invId, viewerOf(request)!);
      return { ok: true };
    },
  );

  // ─── public: preview + accept (no prior auth needed) ───
  r.get(
    '/invitations/:token',
    { schema: { params: z.object({ token: z.string().min(10) }) } },
    async (request) => getInvitationPreview(app.db, request.params.token),
  );

  r.post(
    '/invitations/:token/accept',
    {
      preHandler: app.optionalAuth,
      schema: { params: z.object({ token: z.string().min(10) }), body: acceptBody },
    },
    async (request, reply) => {
      const viewer = viewerOf(request);
      const createUser = (email: string, fullName: string, password: string, phone?: string) =>
        registerUser(app.db, { email, fullName, password, phone });

      if (viewer) {
        // already logged in — just link access
        const { tenderId } = await acceptInvitation(
          app.db,
          request.params.token,
          { fullName: '', password: '' },
          createUser,
          viewer.userId,
        );
        const user = await loadAuthUser(app.db, viewer.userId);
        return { tenderId, user };
      }

      // unauthenticated: must supply registration data
      if (!request.body.fullName || !request.body.password) {
        throw badRequest('Укажите ФИО и пароль для регистрации');
      }
      const { userId, tenderId } = await acceptInvitation(
        app.db,
        request.params.token,
        { fullName: request.body.fullName, password: request.body.password, phone: request.body.phone },
        createUser,
      );
      const authUser = await loadAuthUser(app.db, userId);
      const access = app.signAccess({ sub: userId, role: authUser!.role, orgId: authUser!.organizationId });
      const refresh = await issueRefreshToken(app.db, userId, {
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      });
      const csrf = newCsrf();
      app.setAuthCookies(reply, { access, refresh, csrf });
      const body: AuthResponse & { tenderId: string } = { user: authUser!, csrfToken: csrf, tenderId };
      return reply.status(201).send(body);
    },
  );
}
