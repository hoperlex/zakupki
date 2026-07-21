import { and, eq, isNull } from 'drizzle-orm';
import type {
  CompanyCardInput,
  CounterpartySummary,
  CounterpartyType,
  OrganizationOutput,
  OrgSummary,
} from '@zakupki/shared';
import {
  categorySubscriptions,
  organizations,
  users,
  type Database,
} from '@zakupki/db';
import { badRequest, conflict, notFound } from '../../lib/errors';

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

function mapOrg(org: typeof organizations.$inferSelect, categoryIds: string[]): OrganizationOutput {
  return {
    id: org.id,
    kind: org.kind,
    fullName: org.fullName,
    shortName: org.shortName,
    inn: org.inn,
    kpp: org.kpp,
    ogrn: org.ogrn,
    okpo: org.okpo,
    okved: org.okved,
    taxSystem: (org.taxSystem as 'osn' | 'usn' | null) ?? null,
    isVatPayer: org.isVatPayer,
    legalAddress: org.legalAddress ?? '',
    postalAddress: org.postalAddress,
    bankName: org.bankName,
    bankBik: org.bankBik,
    bankCorrAccount: org.bankCorrAccount,
    settlementAccount: org.settlementAccount,
    directorName: org.directorName,
    directorBasis: org.directorBasis,
    contactPhone: org.contactPhone,
    contactEmail: org.contactEmail,
    questionnaire: org.questionnaire ?? {},
    categoryIds,
    accreditationStatus: org.accreditationStatus,
    createdAt: org.createdAt.toISOString(),
  };
}

async function orgCategoryIds(db: Database, orgId: string): Promise<string[]> {
  const rows = await db.query.categorySubscriptions.findMany({
    where: eq(categorySubscriptions.organizationId, orgId),
  });
  return rows.map((r) => r.categoryId);
}

export async function getMyOrg(db: Database, userId: string): Promise<OrganizationOutput | null> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user?.organizationId) return null;
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, user.organizationId),
  });
  if (!org) return null;
  return mapOrg(org, await orgCategoryIds(db, org.id));
}

export async function upsertCompanyCard(
  db: Database,
  userId: string,
  input: CompanyCardInput,
): Promise<OrganizationOutput> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw notFound('Пользователь не найден');

  const fields = {
    fullName: input.fullName,
    shortName: input.shortName ?? null,
    inn: input.inn,
    kpp: input.kpp ?? null,
    ogrn: input.ogrn,
    okpo: input.okpo ?? null,
    okved: input.okved ?? null,
    taxSystem: input.taxSystem ?? null,
    isVatPayer: input.isVatPayer,
    legalAddress: input.legalAddress,
    postalAddress: input.postalAddress ?? null,
    bankName: input.bankName ?? null,
    bankBik: input.bankBik ?? null,
    bankCorrAccount: input.bankCorrAccount ?? null,
    settlementAccount: input.settlementAccount ?? null,
    directorName: input.directorName ?? null,
    directorBasis: input.directorBasis ?? null,
    contactPhone: input.contactPhone ?? null,
    contactEmail: input.contactEmail ?? null,
    questionnaire: input.questionnaire ?? {},
    updatedAt: new Date(),
  };

  let orgId: string;
  try {
    if (user.organizationId) {
      await db.update(organizations).set(fields).where(eq(organizations.id, user.organizationId));
      orgId = user.organizationId;
    } else {
      const [org] = await db
        .insert(organizations)
        .values({ ...fields, kind: 'supplier', createdBy: userId, accreditationStatus: 'none' })
        .returning({ id: organizations.id });
      orgId = org!.id;
      await db.update(users).set({ organizationId: orgId }).where(eq(users.id, userId));
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict('Организация с таким ИНН/КПП уже зарегистрирована на портале');
    }
    throw err;
  }

  // replace category subscriptions
  if (input.categoryIds) {
    await db.transaction(async (tx) => {
      await tx.delete(categorySubscriptions).where(eq(categorySubscriptions.organizationId, orgId));
      if (input.categoryIds!.length) {
        await tx
          .insert(categorySubscriptions)
          .values(input.categoryIds!.map((categoryId) => ({ organizationId: orgId, categoryId })));
      }
    });
  }

  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
  return mapOrg(org!, await orgCategoryIds(db, orgId));
}

const CARD_COMPLETE = (o: typeof organizations.$inferSelect) =>
  Boolean(o.fullName && o.inn && o.ogrn && o.legalAddress && o.settlementAccount && o.bankBik);

export async function submitAccreditation(db: Database, userId: string): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user?.organizationId) throw badRequest('Сначала заполните карточку компании');
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, user.organizationId),
  });
  if (!org) throw notFound('Организация не найдена');
  if (!CARD_COMPLETE(org)) {
    throw badRequest('Заполните обязательные реквизиты (ИНН, ОГРН, адрес, банковские реквизиты)');
  }
  if (org.accreditationStatus === 'accredited') return;
  await db
    .update(organizations)
    .set({ accreditationStatus: 'pending', accreditationSubmittedAt: new Date(), updatedAt: new Date() })
    .where(eq(organizations.id, org.id));
}

export async function getOrgById(
  db: Database,
  orgId: string,
): Promise<OrganizationOutput> {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
  if (!org) throw notFound('Организация не найдена');
  return mapOrg(org, await orgCategoryIds(db, orgId));
}

export async function listSupplierOrgs(
  db: Database,
  status?: string,
): Promise<OrgSummary[]> {
  const rows = await db.query.organizations.findMany({
    where: status
      ? and(eq(organizations.kind, 'supplier'), eq(organizations.accreditationStatus, status as never), isNull(organizations.deletedAt))
      : and(eq(organizations.kind, 'supplier'), isNull(organizations.deletedAt)),
    orderBy: (o, { desc }) => [desc(o.createdAt)],
  });
  return rows.map((o) => ({
    id: o.id,
    fullName: o.fullName,
    shortName: o.shortName,
    inn: o.inn,
    kpp: o.kpp,
    accreditationStatus: o.accreditationStatus,
    createdAt: o.createdAt.toISOString(),
  }));
}

// ─── Справочник контрагентов ───

/** Все контрагенты (организации internal + supplier), кроме удалённых. */
export async function listCounterparties(db: Database): Promise<CounterpartySummary[]> {
  const rows = await db.query.organizations.findMany({
    where: isNull(organizations.deletedAt),
    orderBy: (o, { desc }) => [desc(o.isGeneralContractor), desc(o.createdAt)],
  });
  return rows.map((o) => ({
    id: o.id,
    fullName: o.fullName,
    shortName: o.shortName,
    inn: o.inn,
    kpp: o.kpp,
    kind: o.kind,
    counterpartyType: o.counterpartyType,
    isGeneralContractor: o.isGeneralContractor,
    accreditationStatus: o.accreditationStatus,
    createdAt: o.createdAt.toISOString(),
  }));
}

export async function setCounterpartyType(
  db: Database,
  id: string,
  counterpartyType: CounterpartyType,
): Promise<void> {
  const r = await db
    .update(organizations)
    .set({ counterpartyType, updatedAt: new Date() })
    .where(and(eq(organizations.id, id), isNull(organizations.deletedAt)))
    .returning({ id: organizations.id });
  if (!r.length) throw notFound('Организация не найдена');
}

/** Назначить генподрядчика: снимаем флаг со старого, ставим новому (в транзакции). */
export async function setGeneralContractor(db: Database, orgId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(organizations)
      .set({ isGeneralContractor: false, updatedAt: new Date() })
      .where(eq(organizations.isGeneralContractor, true));
    const r = await tx
      .update(organizations)
      .set({ isGeneralContractor: true, updatedAt: new Date() })
      .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
      .returning({ id: organizations.id });
    if (!r.length) throw notFound('Организация не найдена');
  });
}
