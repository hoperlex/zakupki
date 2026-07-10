import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { FILE_OWNERS } from '@zakupki/shared';
import { files } from '@zakupki/db';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { buildStorageKey } from '../../lib/storage/LocalDiskStorage';
import { viewerOf } from '../tenders/routes';

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Upload: multipart file + owner via query. Tender docs are public; others private.
  r.post(
    '/',
    {
      preHandler: app.authenticate,
      schema: {
        querystring: z.object({
          ownerType: z.enum(FILE_OWNERS),
          ownerId: z.string().uuid(),
          isPublic: z.coerce.boolean().optional(),
        }),
      },
    },
    async (request, reply) => {
      const data = await request.file();
      if (!data) throw badRequest('Файл не передан');
      const buffer = await data.toBuffer();
      const { ownerType, ownerId } = request.query;
      const isPublic = request.query.isPublic ?? ownerType === 'tender';
      const storageKey = buildStorageKey(ownerType, ownerId, data.filename);
      await app.storage.put(storageKey, buffer, data.mimetype);
      const checksum = createHash('sha256').update(buffer).digest('hex');
      const [row] = await app.db
        .insert(files)
        .values({
          ownerType,
          ownerId,
          storageKey,
          originalName: data.filename,
          contentType: data.mimetype,
          sizeBytes: buffer.length,
          checksumSha256: checksum,
          uploadedBy: request.user.sub,
          isPublic,
        })
        .returning();
      return reply.status(201).send({
        id: row!.id,
        originalName: row!.originalName,
        contentType: row!.contentType,
        sizeBytes: row!.sizeBytes,
        createdAt: row!.createdAt.toISOString(),
      });
    },
  );

  // List files for an owner (metadata only).
  r.get(
    '/',
    {
      preHandler: app.optionalAuth,
      schema: {
        querystring: z.object({ ownerType: z.enum(FILE_OWNERS), ownerId: z.string().uuid() }),
      },
    },
    async (request) => {
      const rows = await app.db.query.files.findMany({
        where: and(
          eq(files.ownerType, request.query.ownerType),
          eq(files.ownerId, request.query.ownerId),
          isNull(files.deletedAt),
        ),
      });
      return rows.map((f) => ({
        id: f.id,
        originalName: f.originalName,
        contentType: f.contentType,
        sizeBytes: f.sizeBytes,
        createdAt: f.createdAt.toISOString(),
      }));
    },
  );

  // Download: streamed through an authorized route (never static).
  r.get(
    '/:id',
    { preHandler: app.optionalAuth, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request, reply) => {
      const file = await app.db.query.files.findFirst({
        where: and(eq(files.id, request.params.id), isNull(files.deletedAt)),
      });
      if (!file) throw notFound('Файл не найден');

      if (!file.isPublic) {
        const viewer = viewerOf(request);
        if (!viewer) throw forbidden();
        const isStaff = ['admin', 'manager', 'security'].includes(viewer.role);
        const isUploader = file.uploadedBy === viewer.userId;
        const isOwnerOrg = file.ownerType === 'organization' && file.ownerId === viewer.orgId;
        if (!isStaff && !isUploader && !isOwnerOrg) throw forbidden();
      }

      const stream = await app.storage.getStream(file.storageKey);
      reply.header('content-type', file.contentType);
      reply.header(
        'content-disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      );
      return reply.send(stream);
    },
  );

  r.delete(
    '/:id',
    { preHandler: app.authenticate, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request) => {
      const file = await app.db.query.files.findFirst({
        where: and(eq(files.id, request.params.id), isNull(files.deletedAt)),
      });
      if (!file) throw notFound('Файл не найден');
      const viewer = viewerOf(request)!;
      const isStaff = ['admin', 'manager', 'security'].includes(viewer.role);
      if (!isStaff && file.uploadedBy !== viewer.userId) throw forbidden();
      await app.db.update(files).set({ deletedAt: new Date() }).where(eq(files.id, file.id));
      return { ok: true };
    },
  );
}
