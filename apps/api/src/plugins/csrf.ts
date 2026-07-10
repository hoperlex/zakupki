import type { FastifyInstance } from 'fastify';
import { forbidden } from '../lib/errors';

// Endpoints that legitimately have no CSRF cookie yet (pre-session or api-key auth).
const EXEMPT_EXACT = [
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/refresh',
  '/api/v1/auth/forgot-password',
  '/api/v1/auth/reset-password',
];

function isExempt(path: string): boolean {
  if (EXEMPT_EXACT.includes(path)) return true;
  if (path.startsWith('/api/v1/invitations/') && path.endsWith('/accept')) return true;
  if (path.startsWith('/api/v1/external/')) return true; // api-key auth
  return false;
}

/** Double-submit CSRF check for mutating requests (cookie-based auth needs it). */
export function registerCsrf(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    const method = request.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
    const path = request.url.split('?')[0] ?? '';
    if (isExempt(path)) return;
    const header = request.headers['x-csrf-token'];
    const cookie = request.cookies?.csrf;
    if (!header || !cookie || header !== cookie) {
      throw forbidden('Неверный или отсутствующий CSRF-токен');
    }
  });
}
