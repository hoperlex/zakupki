import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq, isNull } from 'drizzle-orm';
import {
  forgotPasswordInput,
  loginInput,
  registerInput,
  resetPasswordInput,
  type AuthResponse,
} from '@zakupki/shared';
import { passwordResetTokens, users } from '@zakupki/db';
import { unauthorized } from '../../lib/errors';
import { hashPassword } from '../../lib/passwords';
import { randomToken, sha256 } from '../../lib/tokens';
import { sendMail } from '../../lib/mail';
import { env } from '../../config/env';
import {
  issueRefreshToken,
  loadAuthUser,
  newCsrf,
  registerUser,
  revokeToken,
  rotateRefreshToken,
  verifyCredentials,
} from './service';

function meta(request: FastifyRequest) {
  return { userAgent: request.headers['user-agent'], ip: request.ip };
}

async function establishSession(
  app: FastifyInstance,
  reply: FastifyReply,
  request: FastifyRequest,
  userId: string,
): Promise<AuthResponse> {
  const user = await loadAuthUser(app.db, userId);
  if (!user) throw unauthorized();
  const access = app.signAccess({ sub: userId, role: user.role, orgId: user.organizationId });
  const refresh = await issueRefreshToken(app.db, userId, meta(request));
  const csrf = newCsrf();
  app.setAuthCookies(reply, { access, refresh, csrf });
  return { user, csrfToken: csrf };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/register', { schema: { body: registerInput } }, async (request, reply) => {
    const userId = await registerUser(app.db, request.body);
    return establishSession(app, reply, request, userId);
  });

  r.post('/login', { schema: { body: loginInput } }, async (request, reply) => {
    const userId = await verifyCredentials(app.db, request.body.email, request.body.password);
    return establishSession(app, reply, request, userId);
  });

  r.post('/refresh', async (request, reply) => {
    const raw = request.cookies?.refresh;
    if (!raw) throw unauthorized('Сессия недействительна');
    const { userId, refresh } = await rotateRefreshToken(app.db, raw, meta(request));
    const user = await loadAuthUser(app.db, userId);
    if (!user) throw unauthorized();
    const access = app.signAccess({ sub: userId, role: user.role, orgId: user.organizationId });
    const csrf = newCsrf();
    app.setAuthCookies(reply, { access, refresh, csrf });
    return { user, csrfToken: csrf } satisfies AuthResponse;
  });

  r.post('/logout', async (request, reply) => {
    const raw = request.cookies?.refresh;
    if (raw) await revokeToken(app.db, raw);
    app.clearAuthCookies(reply);
    return { ok: true };
  });

  r.get('/me', { preHandler: app.authenticate }, async (request) => {
    const user = await loadAuthUser(app.db, request.user.sub);
    if (!user) throw unauthorized();
    return user;
  });

  r.post('/forgot-password', { schema: { body: forgotPasswordInput } }, async (request) => {
    const user = await app.db.query.users.findFirst({
      where: and(eq(users.email, request.body.email), isNull(users.deletedAt)),
    });
    if (user) {
      const raw = randomToken();
      await app.db.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + 3600 * 1000),
      });
      const link = `${env.PUBLIC_WEB_URL}/reset-password?token=${raw}`;
      await sendMail({
        to: user.email,
        subject: 'Восстановление пароля — тендерный портал СУ-10',
        text: `Для сброса пароля перейдите по ссылке (действует 1 час):\n${link}`,
      });
    }
    // do not leak whether the email exists
    return { ok: true };
  });

  r.post('/reset-password', { schema: { body: resetPasswordInput } }, async (request) => {
    const row = await app.db.query.passwordResetTokens.findFirst({
      where: eq(passwordResetTokens.tokenHash, sha256(request.body.token)),
    });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw unauthorized('Ссылка недействительна или истекла');
    }
    const passwordHash = await hashPassword(request.body.password);
    await app.db.update(users).set({ passwordHash }).where(eq(users.id, row.userId));
    await app.db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, row.id));
    return { ok: true };
  });
}
