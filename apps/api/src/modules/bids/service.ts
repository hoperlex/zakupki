import { and, eq, ne, sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import type {
  BidComparisonRow,
  MyBidOutput,
  RankSnapshot,
  SubmitBidInput,
} from '@zakupki/shared';
import {
  bidHistory,
  bidItems,
  bids,
  organizations,
  tenderPositions,
  tenders,
  users,
  type Database,
  type DbClient,
} from '@zakupki/db';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { lineAmountWithVat, lt, meetsMinStep } from '../../lib/money';
import { bus } from '../../lib/events';
import { notifyOrg } from '../../lib/notify';
import { env } from '../../config/env';
import { hasInvitationAccess } from '../invitations/service';
import { bumpRevision, type Viewer } from '../tenders/service';

/** The user's CURRENT organization (JWT orgId can be stale right after the org is created). */
async function currentOrgId(db: Database, userId: string): Promise<string | null> {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  return u?.organizationId ?? null;
}

async function loadMyBid(db: DbClient, tenderId: string, orgId: string) {
  return db.query.bids.findFirst({
    where: and(eq(bids.tenderId, tenderId), eq(bids.supplierOrgId, orgId), ne(bids.status, 'withdrawn')),
    with: { items: true },
  });
}

function toMyBidOutput(
  bid: NonNullable<Awaited<ReturnType<typeof loadMyBid>>>,
  participantsCount: number,
): MyBidOutput {
  return {
    id: bid.id,
    status: bid.status,
    items: bid.items.map((it) => ({
      positionId: it.positionId,
      unitPriceWithoutVat: it.unitPriceWithoutVat,
      vatRate: it.vatRate,
      amountWithVat: it.amountWithVat,
    })),
    totalWithoutVat: bid.totalWithoutVat,
    vatAmount: bid.vatAmount,
    totalWithVat: bid.totalWithVat,
    rank: bid.rank,
    isBest: bid.isBest,
    participantsCount,
    comment: bid.comment,
    submittedAt: bid.submittedAt ? bid.submittedAt.toISOString() : null,
  };
}

async function participants(db: Database, tenderId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(bids)
    .where(and(eq(bids.tenderId, tenderId), ne(bids.status, 'withdrawn')));
  return row?.n ?? 0;
}

export interface MyBidListItem {
  tenderId: string;
  number: string;
  title: string;
  type: string;
  status: string;
  deadlineAt: string;
  rank: number | null;
  isBest: boolean;
  totalWithVat: string;
  participants: number;
}

export async function getMyBidsList(db: Database, userId: string): Promise<MyBidListItem[]> {
  const orgId = await currentOrgId(db, userId);
  if (!orgId) return [];
  const rows = await db.query.bids.findMany({
    where: and(eq(bids.supplierOrgId, orgId), ne(bids.status, 'withdrawn')),
    with: { tender: true },
  });
  const out: MyBidListItem[] = [];
  for (const b of rows) {
    out.push({
      tenderId: b.tenderId,
      number: b.tender.number,
      title: b.tender.title,
      type: b.tender.type,
      status: b.tender.status,
      deadlineAt: b.tender.deadlineAt.toISOString(),
      rank: b.rank,
      isBest: b.isBest,
      totalWithVat: b.totalWithVat,
      participants: await participants(db, b.tenderId),
    });
  }
  return out.sort((a, b) => +new Date(a.deadlineAt) - +new Date(b.deadlineAt));
}

export async function getMyBid(
  db: Database,
  tenderId: string,
  viewer: Viewer,
): Promise<MyBidOutput | null> {
  const orgId = await currentOrgId(db, viewer.userId);
  if (!orgId) return null;
  const bid = await loadMyBid(db, tenderId, orgId);
  if (!bid) return null;
  return toMyBidOutput(bid, await participants(db, tenderId));
}

export async function getRankSnapshot(
  db: Database,
  tenderId: string,
  userId: string | null,
): Promise<RankSnapshot> {
  const orgId = userId ? await currentOrgId(db, userId) : null;
  const tender = await db.query.tenders.findFirst({ where: eq(tenders.id, tenderId) });
  if (!tender) throw notFound('Тендер не найден');
  const myBid = orgId ? await loadMyBid(db, tenderId, orgId) : null;
  return {
    tenderId,
    yourRank: myBid?.rank ?? null,
    participants: await participants(db, tenderId),
    isBest: myBid?.isBest ?? false,
    yourTotalWithVat: myBid?.totalWithVat ?? null,
    deadlineAt: tender.deadlineAt.toISOString(),
    status: tender.status,
  };
}

/** Core reverse-auction submit: validate, price, upsert, recompute ranks, auto-extend. */
export async function submitBid(
  db: Database,
  tenderId: string,
  viewer: Viewer,
  input: SubmitBidInput,
): Promise<MyBidOutput> {
  if (viewer.role !== 'supplier') throw forbidden('Только поставщики подают предложения');
  const orgId = await currentOrgId(db, viewer.userId);
  if (!orgId) throw badRequest('Заполните карточку компании');

  const result = await db.transaction(async (tx) => {
    // serialize submits + extension per tender
    const [tender] = await tx.select().from(tenders).where(eq(tenders.id, tenderId)).for('update');
    if (!tender) throw notFound('Тендер не найден');
    const now = new Date();
    if (tender.status !== 'collecting' || tender.deadlineAt < now) {
      throw conflict('Приём предложений завершён');
    }

    // accreditation / access gate: open tenders require accreditation; closed => invited only
    const org = await tx.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
    if (!org) throw badRequest('Организация не найдена');
    if (tender.visibility === 'open' && org.accreditationStatus !== 'accredited') {
      throw forbidden('Требуется аккредитация службой безопасности');
    }
    if (tender.visibility === 'closed' && !(await hasInvitationAccess(tx, tenderId, viewer.userId))) {
      throw forbidden('Тендер доступен только приглашённым участникам');
    }

    const positions = await tx.query.tenderPositions.findMany({
      where: eq(tenderPositions.tenderId, tenderId),
    });
    const posById = new Map(positions.map((p) => [p.id, p]));
    const itemByPos = new Map(input.items.map((i) => [i.positionId, i]));

    // all required positions must be priced; every item must belong to the tender
    for (const p of positions) {
      if (p.isRequired && !itemByPos.has(p.id)) {
        throw unprocessable(`Заполните цену по позиции «${p.name}»`);
      }
    }
    for (const item of input.items) {
      if (!posById.has(item.positionId)) throw unprocessable('Позиция не принадлежит тендеру');
    }

    // compute totals (decimal-safe)
    let totalWithout = new Decimal(0);
    let totalWith = new Decimal(0);
    const itemsToInsert = input.items.map((item) => {
      const pos = posById.get(item.positionId)!;
      const amt = lineAmountWithVat(item.unitPriceWithoutVat, pos.quantity, item.vatRate);
      totalWithout = totalWithout.plus(amt.withoutVat);
      totalWith = totalWith.plus(amt.withVat);
      return {
        positionId: item.positionId,
        unitPriceWithoutVat: new Decimal(item.unitPriceWithoutVat).toFixed(2),
        vatRate: item.vatRate,
        amountWithVat: amt.withVat,
      };
    });
    const totalWithoutStr = totalWithout.toFixed(2);
    const totalWithStr = totalWith.toFixed(2);
    const vatAmountStr = totalWith.minus(totalWithout).toFixed(2);

    // capture the current leader (for outbid notification)
    const prevLeader = await tx.query.bids.findFirst({
      where: and(eq(bids.tenderId, tenderId), eq(bids.isBest, true), ne(bids.status, 'withdrawn')),
    });
    const prevLeaderOrgId = prevLeader?.supplierOrgId ?? null;

    // existing active bid → re-offer must be strictly lower (+ step vs own bid)
    const existing = await loadMyBid(tx, tenderId, orgId);
    if (existing) {
      if (!lt(totalWithStr, existing.totalWithVat)) {
        throw unprocessable('Новое предложение должно быть ниже вашего текущего');
      }
      if (!meetsMinStep(totalWithStr, existing.totalWithVat, {
        absStep: tender.minStepAbs,
        pctStep: tender.minStepPct,
      })) {
        throw unprocessable(
          tender.minStepAbs
            ? `Снижение должно быть не менее ${tender.minStepAbs} ₽`
            : `Снижение должно быть не менее ${tender.minStepPct}%`,
        );
      }
    }

    // upsert bid
    let bidId: string;
    if (existing) {
      await tx
        .update(bids)
        .set({
          totalWithoutVat: totalWithoutStr,
          vatAmount: vatAmountStr,
          totalWithVat: totalWithStr,
          status: 'submitted',
          comment: input.comment ?? null,
          submittedAt: now,
          updatedAt: now,
        })
        .where(eq(bids.id, existing.id));
      await tx.delete(bidItems).where(eq(bidItems.bidId, existing.id));
      bidId = existing.id;
    } else {
      const [inserted] = await tx
        .insert(bids)
        .values({
          tenderId,
          supplierOrgId: orgId,
          createdBy: viewer.userId,
          status: 'submitted',
          totalWithoutVat: totalWithoutStr,
          vatAmount: vatAmountStr,
          totalWithVat: totalWithStr,
          comment: input.comment ?? null,
          submittedAt: now,
        })
        .returning({ id: bids.id });
      bidId = inserted!.id;
    }
    await tx.insert(bidItems).values(itemsToInsert.map((it) => ({ ...it, bidId })));

    // recompute ranks (decimal-safe SQL window)
    await tx.execute(sql`
      UPDATE bids b SET rank = r.rn, is_best = (r.rn = 1)
      FROM (
        SELECT id, row_number() OVER (ORDER BY total_with_vat ASC, submitted_at ASC) rn
        FROM bids WHERE tender_id = ${tenderId} AND status <> 'withdrawn'
      ) r WHERE b.id = r.id
    `);

    const [ranked] = await tx
      .select({ rank: bids.rank, isBest: bids.isBest })
      .from(bids)
      .where(eq(bids.id, bidId));

    // auto-extension (anti-sniping): this bid became the new best inside the window
    let triggeredExtension = false;
    if (
      tender.autoExtendEnabled &&
      ranked?.isBest &&
      tender.extendCount < tender.autoExtendMaxCount
    ) {
      const remainingSec = (tender.deadlineAt.getTime() - now.getTime()) / 1000;
      if (remainingSec >= 0 && remainingSec <= tender.autoExtendWindowSec) {
        const newDeadline = new Date(tender.deadlineAt.getTime() + tender.autoExtendStepSec * 1000);
        await tx
          .update(tenders)
          .set({
            deadlineAt: newDeadline,
            extendCount: tender.extendCount + 1,
            updatedAt: now,
            revision: bumpRevision(),
          })
          .where(eq(tenders.id, tenderId));
        triggeredExtension = true;
      }
    }

    await tx.insert(bidHistory).values({
      bidId,
      tenderId,
      supplierOrgId: orgId,
      totalWithVat: totalWithStr,
      rankAfter: ranked?.rank ?? null,
      triggeredExtension,
    });

    const outbidOrgId =
      ranked?.isBest && prevLeaderOrgId && prevLeaderOrgId !== orgId ? prevLeaderOrgId : null;
    return { bidId, outbidOrgId, tenderNumber: tender.number, tenderTitle: tender.title };
  });

  bus.emitTenderChanged(tenderId, 'bid');

  // notify the supplier who just lost the lead
  if (result.outbidOrgId) {
    await notifyOrg(db, result.outbidOrgId, {
      type: 'outbid',
      title: `Ваше предложение перебили — ${result.tenderNumber}`,
      body: `По тендеру «${result.tenderTitle}» появилось более выгодное предложение. Снизьте цену, чтобы вернуть лидерство.`,
      link: `${env.PUBLIC_WEB_URL}/app/tenders/${tenderId}`,
    });
  }

  const bid = await loadMyBid(db, tenderId, orgId);
  return toMyBidOutput(bid!, await participants(db, tenderId));
}

export async function withdrawBid(db: Database, tenderId: string, viewer: Viewer): Promise<void> {
  const orgId = await currentOrgId(db, viewer.userId);
  if (!orgId) throw badRequest('Нет организации');
  await db.transaction(async (tx) => {
    // Блокируем тендер и проверяем стадию под локом — как в submitBid. Без этого
    // ставку можно отозвать уже ПОСЛЕ выбора победителя: awarded_bid_id остался бы
    // указывать на отозванную ставку, и внешние /results отдали бы победителя,
    // которого нет ни в participants[], ни в bids[]. Отзыв допустим только в приём.
    const [tender] = await tx.select().from(tenders).where(eq(tenders.id, tenderId)).for('update');
    if (!tender) throw notFound('Тендер не найден');
    if (tender.status !== 'collecting' || tender.deadlineAt < new Date()) {
      throw conflict('Отозвать предложение можно только до окончания приёма');
    }
    const bid = await loadMyBid(tx, tenderId, orgId);
    if (!bid) throw notFound('Предложение не найдено');

    await tx.update(bids).set({ status: 'withdrawn', rank: null, isBest: false }).where(eq(bids.id, bid.id));
    await tx.execute(sql`
      UPDATE bids b SET rank = r.rn, is_best = (r.rn = 1)
      FROM (
        SELECT id, row_number() OVER (ORDER BY total_with_vat ASC, submitted_at ASC) rn
        FROM bids WHERE tender_id = ${tenderId} AND status <> 'withdrawn'
      ) r WHERE b.id = r.id
    `);
  });
  bus.emitTenderChanged(tenderId, 'bid');
}

// ─── manager comparison + award ───

export async function getComparison(
  db: Database,
  tenderId: string,
  viewer: Viewer,
): Promise<BidComparisonRow[]> {
  const tender = await db.query.tenders.findFirst({ where: eq(tenders.id, tenderId) });
  if (!tender) throw notFound('Тендер не найден');
  if (viewer.role !== 'admin' && tender.organizationId !== viewer.orgId) {
    throw forbidden('Нет доступа к предложениям этого тендера');
  }
  const rows = await db.query.bids.findMany({
    where: and(eq(bids.tenderId, tenderId), ne(bids.status, 'withdrawn')),
    with: { items: true, supplierOrg: true },
    orderBy: [sql`rank asc nulls last`],
  });
  return rows.map((b) => ({
    bidId: b.id,
    rank: b.rank,
    isBest: b.isBest,
    supplierOrgId: b.supplierOrgId,
    supplierName: b.supplierOrg?.shortName ?? b.supplierOrg?.fullName ?? '—',
    supplierInn: b.supplierOrg?.inn ?? '',
    accreditationStatus: b.supplierOrg?.accreditationStatus ?? 'none',
    totalWithoutVat: b.totalWithoutVat,
    vatAmount: b.vatAmount,
    totalWithVat: b.totalWithVat,
    comment: b.comment,
    submittedAt: b.submittedAt ? b.submittedAt.toISOString() : null,
    items: b.items.map((it) => ({
      positionId: it.positionId,
      unitPriceWithoutVat: it.unitPriceWithoutVat,
      vatRate: it.vatRate,
      amountWithVat: it.amountWithVat,
    })),
  }));
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
}

export async function getProtocolHtml(
  db: Database,
  tenderId: string,
  viewer: Viewer,
): Promise<string> {
  const tender = await db.query.tenders.findFirst({
    where: eq(tenders.id, tenderId),
    with: { organization: true },
  });
  if (!tender) throw notFound('Тендер не найден');
  if (viewer.role !== 'admin' && tender.organizationId !== viewer.orgId) throw forbidden('Нет доступа');
  const rows = await getComparison(db, tenderId, viewer);
  // Победитель — только явно выбранный. Прежний fallback на rows[0] печатал
  // самого дешёвого участника победителем даже там, где его не выбирали
  // (тендер завершён без победителя) — это ложный протокол.
  const winner = tender.awardedBidId ? rows.find((r) => r.bidId === tender.awardedBidId) : undefined;

  const rowsHtml = rows
    .map(
      (r) => `<tr${r.bidId === tender.awardedBidId ? ' style="background:#F3E9E7;font-weight:600"' : ''}>
        <td>${r.rank ?? '—'}</td><td>${esc(r.supplierName)}</td><td>${esc(r.supplierInn)}</td>
        <td style="text-align:right">${r.totalWithoutVat}</td><td style="text-align:right">${r.vatAmount}</td>
        <td style="text-align:right">${r.totalWithVat}</td></tr>`,
    )
    .join('');

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Протокол ${esc(tender.number)}</title>
  <style>body{font-family:Arial,sans-serif;color:#1E1D1D;max-width:900px;margin:32px auto;padding:0 24px}
  h1{color:#A05850;border-bottom:3px solid #A05850;padding-bottom:8px}
  table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #E4E5E9;padding:8px}
  th{background:#F9F9FA;text-align:left}.win{background:#A05850;color:#fff;padding:12px 16px;border-radius:8px;margin:16px 0}
  .no-win{background:#F9F9FA;border:1px solid #E4E5E9;padding:12px 16px;border-radius:8px;margin:16px 0}</style></head>
  <body>
  <h1>Протокол подведения итогов</h1>
  <p><b>Тендер:</b> ${esc(tender.number)} — ${esc(tender.title)}</p>
  <p><b>Заказчик:</b> ${esc(tender.organization?.fullName ?? '')}</p>
  <p><b>Статус:</b> ${tender.status}</p>
  ${
    winner
      ? `<div class="win">Победитель: ${esc(winner.supplierName)} (ИНН ${esc(winner.supplierInn)}) — ${winner.totalWithVat} ₽ с НДС</div>`
      : tender.status === 'closed'
        ? `<div class="no-win">Победитель не определён. Причина: ${esc(tender.closeReason ?? 'не указана')}</div>`
        : ''
  }
  <h3>Сводная таблица предложений</h3>
  <table><thead><tr><th>Место</th><th>Поставщик</th><th>ИНН</th><th>Без НДС</th><th>НДС</th><th>С НДС</th></tr></thead>
  <tbody>${rowsHtml}</tbody></table>
  <p style="margin-top:32px;color:#8B8996">Сформировано автоматически тендерным порталом ООО «СУ-10».</p>
  </body></html>`;
}

export async function awardTender(
  db: Database,
  tenderId: string,
  viewer: Viewer,
  bidId: string,
): Promise<void> {
  const tender = await db.transaction(async (tx) => {
    const [t] = await tx.select().from(tenders).where(eq(tenders.id, tenderId)).for('update');
    if (!t) throw notFound('Тендер не найден');
    if (viewer.role !== 'admin' && t.organizationId !== viewer.orgId) {
      throw forbidden('Нет доступа к тендеру');
    }
    // Только under_review: award на 'collecting' объявил бы победителя до конца
    // приёма — внешний клиент увидел бы итог, пока ставки ещё принимаются.
    if (t.status !== 'under_review') {
      throw conflict('Определить победителя можно только по завершении приёма');
    }
    // Отозванную ставку выбрать победителем нельзя: наружу ушёл бы фиктивный winner.
    const bid = await tx.query.bids.findFirst({
      where: and(eq(bids.id, bidId), eq(bids.tenderId, tenderId), ne(bids.status, 'withdrawn')),
    });
    if (!bid) throw notFound('Предложение не найдено');

    const now = new Date();
    await tx
      .update(tenders)
      .set({
        status: 'awarded',
        awardedBidId: bidId,
        finishedAt: now,
        updatedAt: now,
        revision: bumpRevision(),
      })
      .where(eq(tenders.id, tenderId));
    return { ...t, supplierOrgId: bid.supplierOrgId };
  });

  bus.emitTenderChanged(tenderId, 'status');

  await notifyOrg(db, tender.supplierOrgId, {
    type: 'award',
    title: `Вы победили в тендере ${tender.number}`,
    body: `Ваше предложение по тендеру «${tender.title}» выбрано победителем. С вами свяжется менеджер закупок.`,
    link: `${env.PUBLIC_WEB_URL}/app/tenders/${tenderId}`,
    email: true,
  });
}
