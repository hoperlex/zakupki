import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from 'fastify';
import type { Role } from '@zakupki/shared';
import { env, isProd } from '../config/env';
import { forbidden, unauthorized } from '../lib/errors';

export interface AuthPayload {
  sub: string;
  role: Role;
  orgId: string | null;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthPayload;
    user: AuthPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: preHandlerHookHandler;
    optionalAuth: preHandlerHookHandler;
    requireRole: (...roles: Role[]) => preHandlerHookHandler;
    signAccess: (p: AuthPayload) => string;
    setAuthCookies: (
      reply: FastifyReply,
      tokens: { access: string; refresh: string; csrf: string },
    ) => void;
    clearAuthCookies: (reply: FastifyReply) => void;
  }
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(fastifyJwt, {
    secret: env.JWT_ACCESS_SECRET,
    cookie: { cookieName: 'access', signed: false },
    sign: { expiresIn: env.ACCESS_TOKEN_TTL },
  });

  const authenticate: preHandlerHookHandler = async (request) => {
    try {
      await request.jwtVerify();
    } catch {
      throw unauthorized();
    }
  };
  app.decorate('authenticate', authenticate);

  const optionalAuth: preHandlerHookHandler = async (request) => {
    try {
      await request.jwtVerify();
    } catch {
      /* anonymous is fine */
    }
  };
  app.decorate('optionalAuth', optionalAuth);

  app.decorate('requireRole', (...roles: Role[]): preHandlerHookHandler => {
    return async (request) => {
      try {
        await request.jwtVerify();
      } catch {
        throw unauthorized();
      }
      if (!roles.includes(request.user.role)) throw forbidden();
    };
  });

  app.decorate('signAccess', (p: AuthPayload) => app.jwt.sign(p));

  app.decorate(
    'setAuthCookies',
    (reply: FastifyReply, tokens: { access: string; refresh: string; csrf: string }) => {
      reply.setCookie('access', tokens.access, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        path: '/api',
        maxAge: env.ACCESS_TOKEN_TTL,
      });
      reply.setCookie('refresh', tokens.refresh, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        path: '/api/v1/auth',
        maxAge: env.REFRESH_TOKEN_TTL,
      });
      reply.setCookie('csrf', tokens.csrf, {
        httpOnly: false,
        sameSite: 'lax',
        secure: isProd,
        path: '/',
        maxAge: env.REFRESH_TOKEN_TTL,
      });
    },
  );

  app.decorate('clearAuthCookies', (reply: FastifyReply) => {
    reply.clearCookie('access', { path: '/api' });
    reply.clearCookie('refresh', { path: '/api/v1/auth' });
    reply.clearCookie('csrf', { path: '/' });
  });
}
