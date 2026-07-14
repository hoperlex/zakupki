// Контракт внешнего API без БД: маппинги, нормализация, хэш идемпотентности,
// разбор ключа. Эти правила — граница с чужой системой, ломать их молча нельзя.

import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_STATUS_BY_TENDER_STATUS,
  TENDER_STATUSES,
  externalCreateTenderInput,
  mapUnit,
  normalizeQuantity,
  normalizeTitle,
  toExternalStatus,
} from '@zakupki/shared';
import { AppError } from '../src/lib/errors';
import { payloadHash } from '../src/modules/external/service';
import {
  apiKeyRateLimitKey,
  externalRateLimit,
  hashApiKey,
  parseApiKeyHeader,
} from '../src/plugins/apiKey';

describe('маппинг статусов домен → ось источника', () => {
  it('покрывает все статусы портала', () => {
    for (const status of TENDER_STATUSES) {
      expect(EXTERNAL_STATUS_BY_TENDER_STATUS[status]).toBeDefined();
    }
  });

  it('огрубляет статусы ровно по контракту', () => {
    expect(toExternalStatus('draft')).toBe('draft');
    expect(toExternalStatus('published')).toBe('published');
    expect(toExternalStatus('collecting')).toBe('published');
    expect(toExternalStatus('under_review')).toBe('awaiting_results');
    expect(toExternalStatus('awarded')).toBe('finished');
    expect(toExternalStatus('closed')).toBe('finished');
    expect(toExternalStatus('cancelled')).toBe('cancelled');
  });
});

describe('mapUnit', () => {
  it('принимает коды enum как есть', () => {
    expect(mapUnit('kg')).toBe('kg');
    expect(mapUnit('m2')).toBe('m2');
    expect(mapUnit('set')).toBe('set');
  });

  it('понимает русские написания', () => {
    expect(mapUnit('шт')).toBe('pcs');
    expect(mapUnit('шт.')).toBe('pcs');
    expect(mapUnit('м')).toBe('m');
    expect(mapUnit('м2')).toBe('m2');
    expect(mapUnit('м²')).toBe('m2');
    expect(mapUnit('м³')).toBe('m3');
    expect(mapUnit('кг')).toBe('kg');
    expect(mapUnit('т')).toBe('t');
    expect(mapUnit('л')).toBe('l');
    expect(mapUnit('компл')).toBe('set');
    expect(mapUnit('ч')).toBe('h');
  });

  it('не зависит от регистра и лишних пробелов', () => {
    expect(mapUnit('  КГ  ')).toBe('kg');
    expect(mapUnit('Кв.М')).toBe('m2');
  });

  it('различает кириллицу и латиницу', () => {
    // «т» (RU) → t, «m» (EN) → m: похожие глифы, разные единицы
    expect(mapUnit('т')).toBe('t');
    expect(mapUnit('m')).toBe('m');
  });

  it('возвращает null для неизвестной единицы, а не подставляет pcs', () => {
    expect(mapUnit('погонных попугаев')).toBeNull();
    expect(mapUnit('')).toBeNull();
  });
});

describe('normalizeQuantity', () => {
  it('принимает decimal-строку масштаба ≤3', () => {
    expect(normalizeQuantity('120.000')).toBe('120.000');
    expect(normalizeQuantity('1')).toBe('1');
    expect(normalizeQuantity(' 0.5 ')).toBe('0.5');
  });

  it('отвергает больше 3 знаков — округление молча потеряло бы данные', () => {
    expect(normalizeQuantity('1.0001')).toBeNull();
  });

  it('отвергает не-числа и неположительные значения', () => {
    expect(normalizeQuantity('1,5')).toBeNull();
    expect(normalizeQuantity('1e3')).toBeNull();
    expect(normalizeQuantity('-1')).toBeNull();
    expect(normalizeQuantity('0')).toBeNull();
    expect(normalizeQuantity('')).toBeNull();
  });
});

describe('normalizeTitle', () => {
  it('оставляет нормальное название нетронутым', () => {
    expect(normalizeTitle('Закупочный лот № Л-003')).toBe('Закупочный лот № Л-003');
  });

  it('дотягивает короткое название до доменного минимума в 5 символов', () => {
    expect(normalizeTitle('Ц').length).toBeGreaterThanOrEqual(5);
    expect(normalizeTitle('Ц')).toContain('Ц');
  });
});

describe('payloadHash', () => {
  const body = { b: 1, a: [3, 2], c: { y: 'x', z: null } };

  it('не зависит от порядка ключей', () => {
    expect(payloadHash(body)).toBe(payloadHash({ c: { z: null, y: 'x' }, a: [3, 2], b: 1 }));
  });

  it('зависит от порядка элементов массива — это разное содержимое лота', () => {
    expect(payloadHash(body)).not.toBe(payloadHash({ ...body, a: [2, 3] }));
  });

  it('различает пропущенное поле и явное значение', () => {
    expect(payloadHash({ x: 1 })).not.toBe(payloadHash({ x: 1, vat_rate: 'vat20' }));
  });

  it('различает пробелы внутри строк', () => {
    expect(payloadHash({ t: 'Цемент' })).not.toBe(payloadHash({ t: 'Цемент ' }));
  });
});

describe('разбор api-ключа', () => {
  it('вытаскивает префикс до точки', () => {
    expect(parseApiKeyHeader('Bearer zk_abc123.secretpart')).toEqual({
      prefix: 'zk_abc123',
      token: 'zk_abc123.secretpart',
    });
  });

  it('не зависит от регистра схемы', () => {
    expect(parseApiKeyHeader('bearer zk_a.b')?.prefix).toBe('zk_a');
  });

  it('отвергает мусор и ключ без секрета', () => {
    expect(parseApiKeyHeader(undefined)).toBeNull();
    expect(parseApiKeyHeader('zk_a.b')).toBeNull();
    expect(parseApiKeyHeader('Bearer nodot')).toBeNull();
    expect(parseApiKeyHeader('Bearer .secret')).toBeNull();
    expect(parseApiKeyHeader('Bearer prefix.')).toBeNull();
  });

  it('хэширует ключ целиком', () => {
    expect(hashApiKey('zk_a.b')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey('zk_a.b')).not.toBe(hashApiKey('zk_a.c'));
  });
});

describe('rate-limit', () => {
  const req = (headers: Record<string, string>, ip: string) =>
    ({ headers, ip }) as never;

  it('разделяет корзины по ключу клиента', () => {
    expect(apiKeyRateLimitKey(req({ authorization: 'Bearer zk_aaa.s1' }, '1.1.1.1'))).not.toBe(
      apiKeyRateLimitKey(req({ authorization: 'Bearer zk_bbb.s2' }, '1.1.1.1')),
    );
  });

  it('чужой не исчерпает квоту клиента, подставив его префикс: корзина учитывает ip', () => {
    // Префикс — не секрет и виден в заголовке. Лимит только по нему позволил бы
    // с любого адреса «съесть» квоту легитимной интеграции.
    const victim = apiKeyRateLimitKey(req({ authorization: 'Bearer zk_aaa.real' }, '10.0.0.1'));
    const attacker = apiKeyRateLimitKey(req({ authorization: 'Bearer zk_aaa.fake' }, '203.0.113.9'));
    expect(victim).not.toBe(attacker);
  });

  it('запрос без ключа падает в анонимную корзину своего адреса', () => {
    expect(apiKeyRateLimitKey(req({}, '1.1.1.1'))).toBe('anon:1.1.1.1');
  });

  it('429 бросается как AppError — errorHandler отдаст его в общем конверте, а не 500', () => {
    // @fastify/rate-limit БРОСАЕТ возврат билдера. Простой объект без statusCode
    // ушёл бы в ветку 500; AppError несёт statusCode=429 и code='rate_limited'.
    const err = externalRateLimit.rateLimit.errorResponseBuilder(req({}, '1.1.1.1'), {
      after: '30 seconds',
      max: 300,
    });
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe('rate_limited');
    expect(err.message).toContain('300');
    expect(err.message).toContain('30 seconds');
  });
});

describe('strict-схема входа', () => {
  const valid = {
    title: 'Закупочный лот № Л-003',
    external_ref: 'estimat:lot:1',
    deadline_at: '2030-01-01T00:00:00.000Z',
    items: [{ material: 'Цемент', quantity: '1.000', unit: 'kg' }],
  };

  it('принимает валидное тело и подставляет publication_mode', () => {
    expect(externalCreateTenderInput.parse(valid).publication_mode).toBe('publish');
  });

  it('отвергает неизвестное поле — опечатка не должна теряться молча', () => {
    expect(() => externalCreateTenderInput.parse({ ...valid, conditons: {} })).toThrow();
    expect(() =>
      externalCreateTenderInput.parse({
        ...valid,
        items: [{ ...valid.items[0], colour: 'red' }],
      }),
    ).toThrow();
  });

  it('требует quantity строкой: JSON-число не представит 120.000 точно', () => {
    expect(() =>
      externalCreateTenderInput.parse({ ...valid, items: [{ material: 'Ц', quantity: 120, unit: 'kg' }] }),
    ).toThrow();
  });

  it('не пропускает source_revision за границу int4', () => {
    expect(() => externalCreateTenderInput.parse({ ...valid, source_revision: 2_147_483_648 })).toThrow();
    expect(externalCreateTenderInput.parse({ ...valid, source_revision: 3 }).source_revision).toBe(3);
  });

  it('пропускает отсутствующий deadline_at — за него отвечает сервис кодом 400', () => {
    const { deadline_at: _omitted, ...noDeadline } = valid;
    expect(externalCreateTenderInput.parse(noDeadline).deadline_at).toBeUndefined();
  });
});
