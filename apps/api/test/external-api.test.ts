// Интеграционные тесты внешнего машинного API против реальной БД.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSchedulerTick } from '../src/lib/scheduler';
import { awardTender, submitBid, withdrawBid } from '../src/modules/bids/service';
import { closeTenderWithoutAward } from '../src/modules/tenders/service';
import {
  bearer,
  closeApp,
  createBody,
  expireDeadline,
  getApp,
  makeBuyerWithKey,
  makeOrg,
  makeUser,
  mintKey,
  resetData,
  tenderRow,
  type App,
} from './fixtures';

let app: App;

beforeEach(async () => {
  app = await getApp();
  await resetData(app);
});

afterAll(async () => {
  await closeApp();
});

afterEach(() => {
  vi.useRealTimers();
});

const post = (path: string, body: unknown, token?: string) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/external${path}`,
    payload: body as object,
    headers: token ? bearer(token) : {},
  });

const get = (path: string, token?: string) =>
  app.inject({ method: 'GET', url: `/api/v1/external${path}`, headers: token ? bearer(token) : {} });

/** Подаёт предложение от нового аккредитованного поставщика. */
async function bid(
  tenderId: string,
  amount: string,
): Promise<{ orgId: string; userId: string; bidId: string }> {
  const orgId = await makeOrg(app, { accredited: true });
  const userId = await makeUser(app, { orgId, role: 'supplier' });
  const positions = await app.db.query.tenderPositions.findMany({
    where: (p, { eq }) => eq(p.tenderId, tenderId),
  });
  const result = await submitBid(
    app.db,
    tenderId,
    { userId, role: 'supplier', orgId },
    {
      items: positions.map((p) => ({
        positionId: p.id,
        unitPriceWithoutVat: amount,
        vatRate: 'vat20' as const,
      })),
    },
  );
  return { orgId, userId, bidId: result.id };
}

/** Доводит тендер до under_review: дедлайн прошёл, планировщик отработал. */
async function toUnderReview(tenderId: string): Promise<void> {
  await expireDeadline(app, tenderId);
  await runSchedulerTick(app);
}

describe('health', () => {
  it('отвечает без ключа — это liveness для ping клиента', async () => {
    const res = await get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('аутентификация по ключу', () => {
  it('без ключа → 401', async () => {
    const res = await post('/tenders', createBody());
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('unauthorized');
  });

  it('неверный секрет при верном префиксе → 401', async () => {
    const { key } = await makeBuyerWithKey(app);
    const res = await post('/tenders', createBody(), `${key.prefix}.wrong-secret`);
    expect(res.statusCode).toBe(401);
  });

  it('отозванный ключ → 401', async () => {
    const orgId = await makeOrg(app, { kind: 'internal' });
    const userId = await makeUser(app, { orgId, role: 'manager' });
    const key = await mintKey(app, { orgId, userId, revoked: true });
    expect((await post('/tenders', createBody(), key.token)).statusCode).toBe(401);
  });

  it('ключ без нужного scope → 403', async () => {
    const orgId = await makeOrg(app, { kind: 'internal' });
    const userId = await makeUser(app, { orgId, role: 'manager' });
    const key = await mintKey(app, { orgId, userId, scopes: ['tenders:read'] });
    const res = await post('/tenders', createBody(), key.token);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('forbidden');
  });

  it('actor-поставщик → 403: ключ не даёт роли, которой нет у пользователя', async () => {
    const orgId = await makeOrg(app, { kind: 'internal' });
    const userId = await makeUser(app, { orgId, role: 'supplier' });
    const key = await mintKey(app, { orgId, userId });
    expect((await post('/tenders', createBody(), key.token)).statusCode).toBe(403);
  });

  it('отключённый actor → 401', async () => {
    const orgId = await makeOrg(app, { kind: 'internal' });
    const userId = await makeUser(app, { orgId, role: 'manager', active: false });
    const key = await mintKey(app, { orgId, userId });
    expect((await post('/tenders', createBody(), key.token)).statusCode).toBe(401);
  });

  it('actor переведён в другую организацию после выпуска ключа → 403', async () => {
    const orgId = await makeOrg(app, { kind: 'internal' });
    const otherOrg = await makeOrg(app, { kind: 'internal' });
    const userId = await makeUser(app, { orgId: otherOrg, role: 'manager' });
    const key = await mintKey(app, { orgId, userId });
    expect((await post('/tenders', createBody(), key.token)).statusCode).toBe(403);
  });

  it('обновляет last_used_at после успешной проверки', async () => {
    const { key } = await makeBuyerWithKey(app);
    await post('/tenders', createBody(), key.token);
    const row = await app.db.query.apiKeys.findFirst({ where: (k, { eq }) => eq(k.id, key.id) });
    expect(row?.lastUsedAt).toBeInstanceOf(Date);
  });
});

describe('создание тендера', () => {
  it('создаёт и СРАЗУ публикует одной операцией', async () => {
    const { key, orgId, userId } = await makeBuyerWithKey(app);
    const body = createBody();
    const res = await post('/tenders', body, key.token);

    expect(res.statusCode).toBe(201);
    const out = res.json();
    expect(out.replayed).toBe(false);
    expect(out.status).toBe('published');
    expect(out.external_ref).toBe(body.external_ref);
    expect(out.number).toMatch(/^T-\d{4}-\d{5}$/);
    expect(out.url).toBe(`https://zak.test.local/admin/tenders/${out.id}`);
    expect(out.public_url).toBe(`https://zak.test.local/tenders/${out.id}`);

    const row = await tenderRow(app, out.id);
    expect(row?.status).toBe('collecting');
    expect(row?.publishedAt).toBeInstanceOf(Date);
    expect(row?.type).toBe('materials');
    expect(row?.visibility).toBe('open');
    expect(row?.currency).toBe('RUB');
    expect(row?.organizationId).toBe(orgId);
    expect(row?.createdBy).toBe(userId);
    expect(row?.sourceSystem).toBe('estimat');
    expect(row?.sourceRevision).toBe(3);
    expect(row?.sourceApiKeyId).toBe(key.id);
    // publish обязан двинуть ревизию
    expect(row?.revision).toBe(2);
    expect(out.revision).toBe(2);
  });

  it('раскладывает позиции и условия в домен, НМЦ не принимает', async () => {
    const { key } = await makeBuyerWithKey(app);
    const out = (await post('/tenders', createBody(), key.token)).json();
    const positions = await app.db.query.tenderPositions.findMany({
      where: (p, { eq }) => eq(p.tenderId, out.id),
    });
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      positionNo: 1,
      name: 'Цемент М500',
      unit: 'kg',
      quantity: '120.000',
      isRequired: true,
      targetPrice: null,
      sourceUnit: 'kg',
    });
    const row = await tenderRow(app, out.id);
    expect(row?.terms).toEqual({
      payment: 'Отсрочка 30 дней',
      delivery: 'Самовывоз',
      deliveryPlace: 'г. Москва, объект 1',
      deliveryDeadline: 'до 30 июля',
    });
  });

  it('сохраняет исходное написание единицы, spec поставщика не портит', async () => {
    const { key } = await makeBuyerWithKey(app);
    const body = createBody({
      items: [{ material: 'Плита', quantity: '2', unit: 'м²', spec: 'ГОСТ 6266' }],
    });
    const out = (await post('/tenders', body, key.token)).json();
    const [position] = await app.db.query.tenderPositions.findMany({
      where: (p, { eq }) => eq(p.tenderId, out.id),
    });
    expect(position?.unit).toBe('m2');
    expect(position?.sourceUnit).toBe('м²');
    expect(position?.spec).toBe('ГОСТ 6266');
  });

  it('publication_mode=draft оставляет черновик', async () => {
    const { key } = await makeBuyerWithKey(app);
    const out = (await post('/tenders', createBody({ publication_mode: 'draft' }), key.token)).json();
    expect(out.status).toBe('draft');
    expect((await tenderRow(app, out.id))?.status).toBe('draft');
  });
});

describe('валидация входа', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['дедлайн в прошлом', { deadline_at: new Date(Date.now() - 60_000).toISOString() }],
    ['дедлайн не ISO', { deadline_at: '20 июля 2026' }],
    ['дедлайн без зоны', { deadline_at: '2030-01-01T00:00:00' }],
    ['дедлайн отсутствует', { deadline_at: undefined }],
    ['неизвестная единица', { items: [{ material: 'Ц', quantity: '1', unit: 'вагон' }] }],
    ['quantity с 4 знаками', { items: [{ material: 'Ц', quantity: '1.0001', unit: 'kg' }] }],
    ['quantity не число', { items: [{ material: 'Ц', quantity: '1,5', unit: 'kg' }] }],
    ['quantity ноль', { items: [{ material: 'Ц', quantity: '0', unit: 'kg' }] }],
  ];

  it.each(cases)('%s → 400 bad_request', async (_name, over) => {
    const { key } = await makeBuyerWithKey(app);
    const body = createBody(over);
    if (over.deadline_at === undefined && 'deadline_at' in over) delete body.deadline_at;
    const res = await post('/tenders', body, key.token);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('bad_request');
  });

  it('неизвестное поле → 422 validation, а не тихое игнорирование', async () => {
    const { key } = await makeBuyerWithKey(app);
    const res = await post('/tenders', createBody({ conditons: { delivery: 'опечатка' } }), key.token);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('validation');
  });

  it('ничего не создаёт при отказе валидации', async () => {
    const { key } = await makeBuyerWithKey(app);
    await post('/tenders', createBody({ items: [{ material: 'Ц', quantity: '1', unit: 'вагон' }] }), key.token);
    const [{ n }] = await app.sql.unsafe<{ n: string }[]>('SELECT count(*) n FROM tenders');
    expect(Number(n)).toBe(0);
  });
});

describe('идемпотентность', () => {
  it('повтор того же тела → 200 replayed, тот же тендер', async () => {
    const { key } = await makeBuyerWithKey(app);
    const body = createBody();
    const first = await post('/tenders', body, key.token);
    const second = await post('/tenders', body, key.token);

    expect(first.statusCode).toBe(201);
    expect(first.json().replayed).toBe(false);
    expect(second.statusCode).toBe(200);
    expect(second.json().replayed).toBe(true);
    expect(second.json().id).toBe(first.json().id);

    const [{ n }] = await app.sql.unsafe<{ n: string }[]>('SELECT count(*) n FROM tenders');
    expect(Number(n)).toBe(1);
  });

  it('порядок ключей в JSON не влияет на реплей', async () => {
    const { key } = await makeBuyerWithKey(app);
    const body = createBody();
    const first = await post('/tenders', body, key.token);
    const reordered = Object.fromEntries(Object.entries(body).reverse());
    const second = await post('/tenders', reordered, key.token);
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
  });

  it('тот же external_ref с другим телом → 409 idempotency_conflict', async () => {
    const { key } = await makeBuyerWithKey(app);
    const body = createBody();
    await post('/tenders', body, key.token);
    const res = await post('/tenders', { ...body, title: 'Совсем другой лот' }, key.token);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('idempotency_conflict');
  });

  it('РЕПЛЕЙ ПОСЛЕ ДЕДЛАЙНА → 200, а не 400: лот существует и живёт', async () => {
    const { key } = await makeBuyerWithKey(app);
    const body = createBody();
    const first = await post('/tenders', body, key.token);
    expect(first.statusCode).toBe(201);

    // Двигаем СИСТЕМНОЕ время вперёд: deadline_at из ТЕЛА теперь в прошлом. Именно
    // тот случай, когда наивный порядок (parseDeadline раньше поиска записи) вернул
    // бы 400 и заставил EstiMat счесть живой лот несозданным. Сдвиг только строки в
    // БД (как было раньше) этот баг не воспроизводит — тело осталось бы будущим.
    vi.setSystemTime(new Date(Date.now() + 2 * 86_400_000));

    const second = await post('/tenders', body, key.token);
    expect(second.statusCode).toBe(200);
    expect(second.json().replayed).toBe(true);
    expect(second.json().id).toBe(first.json().id);
  });

  it('конфликт хэша после дедлайна остаётся 409, а не превращается в 400', async () => {
    const { key } = await makeBuyerWithKey(app);
    const body = createBody();
    const first = await post('/tenders', body, key.token);
    await expireDeadline(app, first.json().id);
    const res = await post('/tenders', { ...body, title: 'Другой лот' }, key.token);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('idempotency_conflict');
  });

  it('идемпотентность переживает ротацию ключа', async () => {
    const { orgId, userId, key } = await makeBuyerWithKey(app);
    const body = createBody();
    const first = await post('/tenders', body, key.token);

    const rotated = await mintKey(app, { orgId, userId });
    const second = await post('/tenders', body, rotated.token);
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    // ключ-первоисточник не перезаписывается
    expect((await tenderRow(app, first.json().id))?.sourceApiKeyId).toBe(key.id);
  });

  it('одинаковый external_ref в разных организациях — разные тендеры', async () => {
    const a = await makeBuyerWithKey(app);
    const b = await makeBuyerWithKey(app);
    const body = createBody();
    const first = await post('/tenders', body, a.key.token);
    const second = await post('/tenders', body, b.key.token);
    expect(second.statusCode).toBe(201);
    expect(second.json().id).not.toBe(first.json().id);
  });
});

describe('конкурентность', () => {
  it('параллельные запросы с одним external_ref создают ровно один тендер', async () => {
    const { key } = await makeBuyerWithKey(app);
    const body = createBody();
    const results = await Promise.all(Array.from({ length: 6 }, () => post('/tenders', body, key.token)));

    const ids = new Set(results.map((r) => r.json().id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(5);

    const [{ n }] = await app.sql.unsafe<{ n: string }[]>('SELECT count(*) n FROM tenders');
    expect(Number(n)).toBe(1);
  });

  it('параллельные создания получают уникальные номера', async () => {
    const { key } = await makeBuyerWithKey(app);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => post('/tenders', createBody(), key.token)),
    );
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    const numbers = results.map((r) => r.json().number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe('атомарность создания+публикации', () => {
  it('сбой на публикации откатывает всё — черновик не остаётся', async () => {
    const { key } = await makeBuyerWithKey(app);
    // Инъекция сбоя настоящим ограничением БД: публикация внешнего тендера
    // (переход в collecting) станет невозможной уже внутри транзакции.
    await app.sql.unsafe(`ALTER TABLE tenders ADD CONSTRAINT tmp_block_external_publish
      CHECK (NOT (status = 'collecting' AND external_ref IS NOT NULL))`);
    try {
      const body = createBody();
      const res = await post('/tenders', body, key.token);
      expect(res.statusCode).toBe(500);

      const [{ n }] = await app.sql.unsafe<{ n: string }[]>('SELECT count(*) n FROM tenders');
      expect(Number(n)).toBe(0);
      const [{ p }] = await app.sql.unsafe<{ p: string }[]>('SELECT count(*) p FROM tender_positions');
      expect(Number(p)).toBe(0);
    } finally {
      await app.sql.unsafe('ALTER TABLE tenders DROP CONSTRAINT tmp_block_external_publish');
    }
  });
});

describe('изоляция арендатора', () => {
  it('чужой тендер → 404 (не 403: существование не подтверждаем)', async () => {
    const owner = await makeBuyerWithKey(app);
    const stranger = await makeBuyerWithKey(app);
    const out = (await post('/tenders', createBody(), owner.key.token)).json();

    expect((await get(`/tenders/${out.id}`, stranger.key.token)).statusCode).toBe(404);
    expect((await get(`/tenders/${out.id}/results`, stranger.key.token)).statusCode).toBe(404);
    expect((await post(`/tenders/${out.id}/cancel`, {}, stranger.key.token)).statusCode).toBe(404);
  });

  it('actor-админ чужой организации тоже получает 404', async () => {
    const owner = await makeBuyerWithKey(app);
    const out = (await post('/tenders', createBody(), owner.key.token)).json();

    const otherOrg = await makeOrg(app, { kind: 'internal' });
    const adminId = await makeUser(app, { orgId: otherOrg, role: 'admin' });
    const adminKey = await mintKey(app, { orgId: otherOrg, userId: adminId });

    expect((await get(`/tenders/${out.id}`, adminKey.token)).statusCode).toBe(404);
  });
});

describe('чтение состояния', () => {
  it('отдаёт состояние и ревизию', async () => {
    const { key } = await makeBuyerWithKey(app);
    const body = createBody();
    const created = (await post('/tenders', body, key.token)).json();
    const res = await get(`/tenders/${created.id}`, key.token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: created.id,
      external_ref: body.external_ref,
      status: 'published',
      url: `https://zak.test.local/admin/tenders/${created.id}`,
      revision: 2,
    });
  });

  it('переход планировщика по дедлайну двигает статус и ревизию', async () => {
    const { key } = await makeBuyerWithKey(app);
    const created = (await post('/tenders', createBody(), key.token)).json();
    await toUnderReview(created.id);

    const res = await get(`/tenders/${created.id}`, key.token);
    expect(res.json().status).toBe('awaiting_results');
    expect(res.json().revision).toBeGreaterThan(created.revision);
  });
});

describe('итоги', () => {
  it('до окончания приёма → 409 results_not_ready (клиент опрашивает дальше)', async () => {
    const { key } = await makeBuyerWithKey(app);
    const created = (await post('/tenders', createBody(), key.token)).json();
    const res = await get(`/tenders/${created.id}/results`, key.token);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('results_not_ready');
  });

  it('после дедлайна без выбора → pending со ставками и участниками', async () => {
    const { key } = await makeBuyerWithKey(app);
    const created = (await post('/tenders', createBody(), key.token)).json();
    const cheap = await bid(created.id, '100');
    const pricey = await bid(created.id, '200');
    await toUnderReview(created.id);

    const res = await get(`/tenders/${created.id}/results`, key.token);
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out.outcome).toBe('pending');
    expect(out.status).toBe('awaiting_results');
    expect(out.winner).toBeNull();
    expect(out.finished_at).toBeNull();
    expect(out.participants.map((p: { id: string }) => p.id).sort()).toEqual(
      [cheap.orgId, pricey.orgId].sort(),
    );
    expect(out.bids).toHaveLength(2);
    // суммы — строки, не числа
    expect(typeof out.bids[0].amount).toBe('string');
    expect(out.bids[0].currency).toBe('RUB');
    expect(out.bids[0].submitted_at).not.toBeNull();
  });

  it('победитель — ВЫБРАННЫЙ bid, а не автоминимум', async () => {
    const { key, orgId, userId } = await makeBuyerWithKey(app);
    const created = (await post('/tenders', createBody(), key.token)).json();
    const cheap = await bid(created.id, '100');
    const pricey = await bid(created.id, '200');
    await toUnderReview(created.id);

    // намеренно выбираем дорогое предложение
    await awardTender(app.db, created.id, { userId, role: 'manager', orgId }, pricey.bidId);

    const out = (await get(`/tenders/${created.id}/results`, key.token)).json();
    expect(out.outcome).toBe('awarded');
    expect(out.status).toBe('finished');
    expect(out.winner).toEqual({ participant_id: pricey.orgId, bid_id: pricey.bidId });
    expect(out.winner.bid_id).not.toBe(cheap.bidId);
    expect(out.finished_at).not.toBeNull();
  });

  it('закрытие без победителя → no_award', async () => {
    const { key, orgId, userId } = await makeBuyerWithKey(app);
    const created = (await post('/tenders', createBody(), key.token)).json();
    await toUnderReview(created.id);

    await closeTenderWithoutAward(
      app.db,
      created.id,
      { userId, role: 'manager', orgId },
      'Все предложения выше бюджета',
    );

    const out = (await get(`/tenders/${created.id}/results`, key.token)).json();
    expect(out.outcome).toBe('no_award');
    expect(out.status).toBe('finished');
    expect(out.winner).toBeNull();
    expect(out.finished_at).not.toBeNull();
  });

  it('отозванная ставка не попадает ни в участников, ни в ставки', async () => {
    const { key } = await makeBuyerWithKey(app);
    const created = (await post('/tenders', createBody(), key.token)).json();
    const active = await bid(created.id, '100');
    const gone = await bid(created.id, '150');
    await app.sql.unsafe(`UPDATE bids SET status = 'withdrawn' WHERE id = $1`, [gone.bidId]);
    await toUnderReview(created.id);

    const out = (await get(`/tenders/${created.id}/results`, key.token)).json();
    expect(out.bids).toHaveLength(1);
    expect(out.bids[0].bid_id).toBe(active.bidId);
  });
});

describe('жизненный цикл', () => {
  it('award до окончания приёма запрещён', async () => {
    const { key, orgId, userId } = await makeBuyerWithKey(app);
    const created = (await post('/tenders', createBody(), key.token)).json();
    const offer = await bid(created.id, '100');

    await expect(
      awardTender(app.db, created.id, { userId, role: 'manager', orgId }, offer.bidId),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('отозванную ставку победителем не выбрать', async () => {
    const { key, orgId, userId } = await makeBuyerWithKey(app);
    const created = (await post('/tenders', createBody(), key.token)).json();
    const offer = await bid(created.id, '100');
    await app.sql.unsafe(`UPDATE bids SET status = 'withdrawn' WHERE id = $1`, [offer.bidId]);
    await toUnderReview(created.id);

    await expect(
      awardTender(app.db, created.id, { userId, role: 'manager', orgId }, offer.bidId),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('закрыть без победителя можно только из under_review', async () => {
    const { key, orgId, userId } = await makeBuyerWithKey(app);
    const created = (await post('/tenders', createBody(), key.token)).json();
    await expect(
      closeTenderWithoutAward(app.db, created.id, { userId, role: 'manager', orgId }, 'причина'),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('отзыв ставки после окончания приёма запрещён — иначе winner в /results станет фантомным', async () => {
    const { key, orgId, userId } = await makeBuyerWithKey(app);
    const created = (await post('/tenders', createBody(), key.token)).json();
    const offer = await bid(created.id, '100');
    await toUnderReview(created.id);
    await awardTender(app.db, created.id, { userId, role: 'manager', orgId }, offer.bidId);

    // поставщик пытается отозвать уже выбранную ставку
    await expect(
      withdrawBid(app.db, created.id, {
        userId: offer.userId,
        role: 'supplier',
        orgId: offer.orgId,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    // результаты остаются согласованными: победитель присутствует и в списках
    const out = (await get(`/tenders/${created.id}/results`, key.token)).json();
    expect(out.outcome).toBe('awarded');
    expect(out.participants.map((p: { id: string }) => p.id)).toContain(out.winner.participant_id);
    expect(out.bids.map((b: { bid_id: string }) => b.bid_id)).toContain(out.winner.bid_id);
  });
});

describe('отмена', () => {
  it('отменяет до дедлайна и двигает ревизию', async () => {
    const { key } = await makeBuyerWithKey(app);
    const created = (await post('/tenders', createBody(), key.token)).json();
    const res = await post(`/tenders/${created.id}/cancel`, { reason: 'Лот отозван' }, key.token);

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled');
    expect(res.json().revision).toBeGreaterThan(created.revision);
    expect((await tenderRow(app, created.id))?.closeReason).toBe('Лот отозван');
  });

  it('работает без тела запроса — reason необязателен', async () => {
    const { key } = await makeBuyerWithKey(app);
    const created = (await post('/tenders', createBody(), key.token)).json();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/external/tenders/${created.id}/cancel`,
      headers: bearer(key.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled');
  });

  it('повторная отмена идемпотентна и ревизию не двигает', async () => {
    const { key } = await makeBuyerWithKey(app);
    const created = (await post('/tenders', createBody(), key.token)).json();
    const first = await post(`/tenders/${created.id}/cancel`, {}, key.token);
    const second = await post(`/tenders/${created.id}/cancel`, {}, key.token);

    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe('cancelled');
    expect(second.json().revision).toBe(first.json().revision);
  });

  it('после дедлайна → 409 cannot_cancel_after_deadline', async () => {
    const { key } = await makeBuyerWithKey(app);
    const created = (await post('/tenders', createBody(), key.token)).json();
    await expireDeadline(app, created.id);

    const res = await post(`/tenders/${created.id}/cancel`, {}, key.token);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('cannot_cancel_after_deadline');
  });

  it('повтор отмены после дедлайна остаётся успехом', async () => {
    const { key } = await makeBuyerWithKey(app);
    const created = (await post('/tenders', createBody(), key.token)).json();
    await post(`/tenders/${created.id}/cancel`, {}, key.token);
    await expireDeadline(app, created.id);

    const res = await post(`/tenders/${created.id}/cancel`, {}, key.token);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled');
  });
});
