import type { FastifyInstance } from 'fastify';
import { accreditationRoutes } from './modules/accreditation/routes';
import { authRoutes } from './modules/auth/routes';
import { bidRoutes } from './modules/bids/routes';
import { categoryRoutes } from './modules/categories/routes';
import { fileRoutes } from './modules/files/routes';
import { invitationRoutes } from './modules/invitations/routes';
import { notificationRoutes } from './modules/notifications/routes';
import { organizationRoutes } from './modules/organizations/routes';
import { tenderRoutes } from './modules/tenders/routes';

export async function routes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(categoryRoutes, { prefix: '/categories' });
  await app.register(organizationRoutes, { prefix: '/orgs' });
  await app.register(accreditationRoutes, { prefix: '/accreditation' });
  await app.register(fileRoutes, { prefix: '/files' });
  await app.register(notificationRoutes, { prefix: '/notifications' });
  await app.register(tenderRoutes, { prefix: '/tenders' });
  await app.register(bidRoutes, { prefix: '/tenders' });
  await app.register(invitationRoutes);
}
