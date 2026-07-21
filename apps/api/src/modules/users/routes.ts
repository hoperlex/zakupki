import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { changePasswordInput, createUserInput, updateUserInput } from '@zakupki/shared';
import { changePassword, createUser, listUsers, softDeleteUser, updateUser } from './service';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/', { preHandler: app.requireRole('admin') }, async () => listUsers(app.db));

  r.post(
    '/',
    { preHandler: app.requireRole('admin'), schema: { body: createUserInput } },
    async (request, reply) => {
      const user = await createUser(app.db, request.body);
      return reply.status(201).send(user);
    },
  );

  r.patch(
    '/:id',
    {
      preHandler: app.requireRole('admin'),
      schema: { params: z.object({ id: z.string().uuid() }), body: updateUserInput },
    },
    async (request) => updateUser(app.db, request.user.sub, request.params.id, request.body),
  );

  r.post(
    '/:id/password',
    {
      preHandler: app.requireRole('admin'),
      schema: { params: z.object({ id: z.string().uuid() }), body: changePasswordInput },
    },
    async (request) => {
      await changePassword(app.db, request.params.id, request.body);
      return { ok: true };
    },
  );

  r.delete(
    '/:id',
    {
      preHandler: app.requireRole('admin'),
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (request) => {
      await softDeleteUser(app.db, request.user.sub, request.params.id);
      return { ok: true };
    },
  );
}
