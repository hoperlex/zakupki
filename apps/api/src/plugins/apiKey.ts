// Аутентификация машинных клиентов (внешний API) по api-ключу.
// Ни сессий, ни CSRF: интеграция ходит с заголовком Authorization: Bearer.

import { createHash, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { apiKeys, users } from '@zakupki/db';
import { forbidden, rateLimited, unauthorized } from '../lib/errors';
import type { Viewer } from '../modules/tenders/service';

/** Права машинного ключа. */
export const API_SCOPES = ['tenders:create', 'tenders:read', 'tenders:cancel'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export interface ApiKeyContext {
  id: string;
  prefix: string;
  clientCode: string | null;
  scopes: string[];
}

declare module 'fastify' {
  interface FastifyInstance {
    requireApiKey: (...scopes: ApiScope[]) => preHandlerHookHandler;
  }
  interface FastifyRequest {
    apiKey?: ApiKeyContext;
    /** Actor ключа: реальный технический пользователь + организация-заказчик. */
    apiViewer?: Viewer;
  }
}

/** Ключ выглядит как `<prefix>.<secret>`: по префиксу ищем строку, секрет сверяем хэшем. */
export function parseApiKeyHeader(header: string | undefined): { prefix: string; token: string } | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!m) return null;
  const token = m[1]!;
  const dot = token.indexOf('.');
  // префикс и секрет обязаны быть непустыми
  if (dot <= 0 || dot === token.length - 1) return null;
  return { prefix: token.slice(0, dot), token };
}

/** Хранится SHA-256 полного ключа: по базе восстановить ключ нельзя. */
export const hashApiKey = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Ключ корзины rate-limit для внешнего API.
 *
 * Лимит нужен на клиента, а не на IP, но keyGenerator работает на onRequest —
 * до аутентификации, то есть по НЕПРОВЕРЕННОМУ префиксу из заголовка. Префикс не
 * секрет, поэтому лимит по одному лишь префиксу позволил бы чужому исчерпать
 * квоту легитимного клиента. Добавление ip разделяет корзины: подделать чужую
 * нельзя, а настоящий клиент ходит с постоянных адресов и получает свою.
 */
export const apiKeyRateLimitKey = (request: FastifyRequest): string => {
  const prefix = parseApiKeyHeader(request.headers.authorization)?.prefix;
  return prefix ? `${prefix}:${request.ip}` : `anon:${request.ip}`;
};

/** Конфиг rate-limit для маршрутов /api/v1/external/*. */
export const externalRateLimit = {
  rateLimit: {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: apiKeyRateLimitKey,
    // @fastify/rate-limit БРОСАЕТ то, что вернёт билдер. Простой объект без
    // statusCode ушёл бы в ветку 500 нашего errorHandler; AppError(429) он
    // сматчит как есть и отдаст в общем конверте { error:'rate_limited', ... }.
    errorResponseBuilder: (_request: FastifyRequest, context: { after: string; max: number }) =>
      rateLimited(`Слишком много запросов (лимит ${context.max}/мин). Повторите через ${context.after}.`),
  },
};

export function registerApiKey(app: FastifyInstance): void {
  app.decorateRequest('apiKey', undefined);
  app.decorateRequest('apiViewer', undefined);

  app.decorate('requireApiKey', (...scopes: ApiScope[]): preHandlerHookHandler => {
    return async (request) => {
      const parsed = parseApiKeyHeader(request.headers.authorization);
      if (!parsed) throw unauthorized('Требуется api-ключ');

      const row = await app.db.query.apiKeys.findFirst({
        where: eq(apiKeys.keyPrefix, parsed.prefix),
      });
      // Секрет ключа не логируем и не возвращаем ни при каком исходе.
      if (!row || row.revokedAt || !hashesEqual(row.keyHash, hashApiKey(parsed.token))) {
        throw unauthorized('Неверный api-ключ');
      }

      const granted = new Set(row.scopes ?? []);
      const missing = scopes.filter((s) => !granted.has(s));
      if (missing.length > 0) throw forbidden(`Ключу не выдан доступ: ${missing.join(', ')}`);

      if (!row.organizationId) throw forbidden('Ключ не привязан к организации');

      // Роль берём из БД: тендеры пишутся от имени реального пользователя.
      const actor = await app.db.query.users.findFirst({
        where: and(eq(users.id, row.userId), isNull(users.deletedAt)),
      });
      if (!actor || !actor.isActive) throw unauthorized('Технический пользователь ключа отключён');
      // Кабинетные маршруты гарантируют роль через requireRole; здесь её надо
      // проверить самим, иначе ключ с actor'ом-поставщиком создавал бы тендеры.
      if (actor.role !== 'manager' && actor.role !== 'admin') {
        throw forbidden('Технический пользователь ключа не может вести закупки');
      }
      // Actor мог быть переведён в другую организацию уже после выпуска ключа.
      if (actor.organizationId !== row.organizationId) {
        throw forbidden('Технический пользователь ключа не принадлежит организации ключа');
      }

      request.apiKey = {
        id: row.id,
        prefix: row.keyPrefix,
        clientCode: row.clientCode,
        scopes: [...granted],
      };
      request.apiViewer = { userId: actor.id, role: actor.role, orgId: row.organizationId };

      await app.db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
    };
  });
}
