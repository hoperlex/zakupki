import { fileURLToPath } from 'node:url';
import { hash } from '@node-rs/argon2';
import { sql } from 'drizzle-orm';
import { createDb } from './client';
import { DATABASE_URL } from './loadEnv';
import {
  bidHistory,
  bidItems,
  bids,
  categories,
  organizations,
  tenderPositions,
  tenders,
  users,
} from './schema';

const DEMO_PASSWORD = 'password123';

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 3600 * 1000);
}
function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 3600 * 1000);
}

const CATEGORY_TREE: Record<'smr' | 'materials', Record<string, string[]>> = {
  smr: {
    'Общестроительные работы': ['Монолитные работы', 'Кладочные работы', 'Демонтаж'],
    'Отделочные работы': ['Штукатурные работы', 'Малярные работы', 'Устройство полов'],
    'Инженерные системы': ['Отопление и вентиляция', 'Водоснабжение и канализация', 'Слаботочные системы'],
    'Электромонтажные работы': [],
    'Фасадные работы': ['Вентилируемые фасады', 'Мокрый фасад'],
    'Благоустройство и озеленение': [],
  },
  materials: {
    'Бетон и ЖБИ': ['Товарный бетон', 'Плиты перекрытия', 'Сваи'],
    'Металлопрокат': ['Арматура', 'Балка, швеллер', 'Профлист'],
    'Инертные материалы': ['Песок', 'Щебень', 'ПГС'],
    'Сантехника': ['Трубы и фитинги', 'Инсталляции и приборы'],
    'Электрооборудование': ['Кабельная продукция', 'Щитовое оборудование'],
    'Отделочные материалы': ['Сухие смеси', 'Гипсокартон', 'Лакокрасочные материалы'],
  },
};

export async function seed(db: ReturnType<typeof createDb>['db']): Promise<void> {
  const existing = await db.execute(sql`SELECT count(*)::int AS c FROM users`);
  const count = Number((existing as unknown as { c: number }[])[0]?.c ?? 0);
  if (count > 0) {
    console.log('  DB already has users — skipping seed. Use `pnpm db:reset` for a clean reseed.');
    return;
  }

  const passwordHash = await hash(DEMO_PASSWORD);

  // ── internal buyer org (СУ-10) ──
  const [su10] = await db
    .insert(organizations)
    .values({
      kind: 'internal',
      fullName: 'Общество с ограниченной ответственностью «СУ-10»',
      shortName: 'ООО «СУ-10»',
      inn: '7710000010',
      kpp: '771001001',
      ogrn: '1027710000010',
      isVatPayer: true,
      legalAddress: 'г. Москва, Пресненская наб., д. 10',
      accreditationStatus: 'accredited',
    })
    .returning();

  // ── internal staff users ──
  const [admin] = await db
    .insert(users)
    .values({
      organizationId: su10!.id,
      email: 'admin@su10.ru',
      fullName: 'Администратор Портала',
      passwordHash,
      role: 'admin',
      emailVerifiedAt: new Date(),
    })
    .returning();

  const [manager] = await db
    .insert(users)
    .values({
      organizationId: su10!.id,
      email: 'manager@su10.ru',
      fullName: 'Иванов Иван (закупки)',
      passwordHash,
      role: 'manager',
      emailVerifiedAt: new Date(),
    })
    .returning();

  await db.insert(users).values({
    organizationId: su10!.id,
    email: 'sb@su10.ru',
    fullName: 'Петров Пётр (служба безопасности)',
    passwordHash,
    role: 'security',
    emailVerifiedAt: new Date(),
  });

  // ── category tree ──
  const materialsLeafByName: Record<string, string> = {};
  for (const kind of ['smr', 'materials'] as const) {
    const branch = CATEGORY_TREE[kind];
    let parentSort = 0;
    for (const [parentName, children] of Object.entries(branch)) {
      const [parent] = await db
        .insert(categories)
        .values({ kind, name: parentName, path: '/', sortOrder: parentSort++ })
        .returning();
      await db
        .update(categories)
        .set({ path: `/${parent!.id}/` })
        .where(sql`id = ${parent!.id}`);
      let childSort = 0;
      for (const childName of children) {
        const [child] = await db
          .insert(categories)
          .values({
            kind,
            parentId: parent!.id,
            name: childName,
            path: `/${parent!.id}/`,
            sortOrder: childSort++,
          })
          .returning();
        if (kind === 'materials') materialsLeafByName[childName] = child!.id;
      }
    }
  }

  // ── demo supplier orgs + users ──
  async function makeSupplier(opts: {
    fullName: string;
    shortName: string;
    inn: string;
    kpp?: string;
    ogrn: string;
    email: string;
    contactName: string;
    status: 'accredited' | 'pending' | 'under_review';
  }) {
    const [org] = await db
      .insert(organizations)
      .values({
        kind: 'supplier',
        fullName: opts.fullName,
        shortName: opts.shortName,
        inn: opts.inn,
        kpp: opts.kpp ?? null,
        ogrn: opts.ogrn,
        isVatPayer: true,
        legalAddress: 'г. Москва',
        bankName: 'ПАО Сбербанк',
        bankBik: '044525225',
        bankCorrAccount: '30101810400000000225',
        settlementAccount: '40702810000000000001',
        accreditationStatus: opts.status,
        accreditationSubmittedAt: opts.status === 'accredited' ? daysFromNow(-10) : daysFromNow(-2),
      })
      .returning();
    const [user] = await db
      .insert(users)
      .values({
        organizationId: org!.id,
        email: opts.email,
        fullName: opts.contactName,
        passwordHash,
        role: 'supplier',
        emailVerifiedAt: new Date(),
      })
      .returning();
    return { org: org!, user: user! };
  }

  const betonPlus = await makeSupplier({
    fullName: 'ООО «БетонПлюс»',
    shortName: 'ООО «БетонПлюс»',
    inn: '7720000020',
    kpp: '772001001',
    ogrn: '1027720000020',
    email: 'supplier@beton.ru',
    contactName: 'Сидоров Сергей',
    status: 'accredited',
  });
  const stroyResurs = await makeSupplier({
    fullName: 'ООО «СтройРесурс»',
    shortName: 'ООО «СтройРесурс»',
    inn: '7730000030',
    kpp: '773001001',
    ogrn: '1027730000030',
    email: 'supplier@stroyresurs.ru',
    contactName: 'Кузнецов Кирилл',
    status: 'accredited',
  });
  await makeSupplier({
    fullName: 'ИП Николаев Н.Н.',
    shortName: 'ИП Николаев',
    inn: '770400000040',
    ogrn: '304770400000040',
    email: 'supplier@pending.ru',
    contactName: 'Николаев Николай',
    status: 'pending',
  });

  // ── demo tenders ──
  // 1) Materials tender in `collecting` with 2 positions and 2 bids (for the live-rank demo).
  const [tenderConcrete] = await db
    .insert(tenders)
    .values({
      number: 'T-2026-00001',
      title: 'Поставка товарного бетона на объект ЖК «Пресня-Сити», корп. 3',
      type: 'materials',
      visibility: 'open',
      status: 'collecting',
      categoryId: null,
      organizationId: su10!.id,
      createdBy: manager!.id,
      description:
        'Поставка товарного бетона марок B25 и B30 с доставкой автобетоносмесителями на строительную площадку. Приёмка по объёму, паспорта качества обязательны.',
      terms: {
        payment: 'Оплата 100% в течение 15 рабочих дней после поставки партии.',
        delivery: 'Доставка силами поставщика, автобетоносмесители 7–9 м³.',
        deliveryPlace: 'г. Москва, ЖК «Пресня-Сити», корп. 3',
        deliveryDeadline: 'В течение 30 дней с даты заключения договора',
        warranty: 'Соответствие ГОСТ 7473-2010.',
      },
      expectedVatRate: 'vat20',
      minStepAbs: '5000.00',
      startsAt: daysFromNow(-1),
      deadlineAt: hoursFromNow(30),
      originalDeadlineAt: hoursFromNow(30),
      publishedAt: daysFromNow(-1),
    })
    .returning();

  const concretePositions = await db
    .insert(tenderPositions)
    .values([
      {
        tenderId: tenderConcrete!.id,
        positionNo: 1,
        name: 'Бетон товарный B25 (М350) П4 F150 W6',
        categoryId: materialsLeafByName['Товарный бетон'] ?? null,
        unit: 'm3',
        quantity: '320.000',
        spec: 'ГОСТ 7473-2010, класс B25, подвижность П4',
        isRequired: true,
        targetPrice: '9500.00',
      },
      {
        tenderId: tenderConcrete!.id,
        positionNo: 2,
        name: 'Бетон товарный B30 (М400) П4 F200 W8',
        categoryId: materialsLeafByName['Товарный бетон'] ?? null,
        unit: 'm3',
        quantity: '150.000',
        spec: 'ГОСТ 7473-2010, класс B30, подвижность П4',
        isRequired: true,
        targetPrice: '10800.00',
      },
    ])
    .returning();

  // helper to insert a full bid with items + history and given rank
  async function makeBid(opts: {
    supplierOrgId: string;
    createdBy: string;
    prices: { positionId: string; qty: number; unitPrice: number }[];
    submittedAt: Date;
    rank: number;
    isBest: boolean;
  }) {
    let totalWithout = 0;
    let totalWith = 0;
    const itemsData = opts.prices.map((p) => {
      const lineWithout = round2(p.qty * p.unitPrice);
      const lineWith = round2(lineWithout * 1.2);
      totalWithout = round2(totalWithout + lineWithout);
      totalWith = round2(totalWith + lineWith);
      return {
        positionId: p.positionId,
        unitPriceWithoutVat: p.unitPrice.toFixed(2),
        vatRate: 'vat20' as const,
        amountWithVat: lineWith.toFixed(2),
      };
    });
    const vatAmount = round2(totalWith - totalWithout);
    const [bid] = await db
      .insert(bids)
      .values({
        tenderId: tenderConcrete!.id,
        supplierOrgId: opts.supplierOrgId,
        createdBy: opts.createdBy,
        status: 'submitted',
        totalWithoutVat: totalWithout.toFixed(2),
        vatAmount: vatAmount.toFixed(2),
        totalWithVat: totalWith.toFixed(2),
        rank: opts.rank,
        isBest: opts.isBest,
        submittedAt: opts.submittedAt,
      })
      .returning();
    await db.insert(bidItems).values(itemsData.map((it) => ({ ...it, bidId: bid!.id })));
    await db.insert(bidHistory).values({
      bidId: bid!.id,
      tenderId: tenderConcrete!.id,
      supplierOrgId: opts.supplierOrgId,
      totalWithVat: totalWith.toFixed(2),
      rankAfter: opts.rank,
      triggeredExtension: false,
    });
  }

  const p1 = concretePositions[0]!.id;
  const p2 = concretePositions[1]!.id;
  // BetonPlus is currently leading
  await makeBid({
    supplierOrgId: betonPlus.org.id,
    createdBy: betonPlus.user.id,
    prices: [
      { positionId: p1, qty: 320, unitPrice: 9200 },
      { positionId: p2, qty: 150, unitPrice: 10500 },
    ],
    submittedAt: hoursFromNow(-3),
    rank: 1,
    isBest: true,
  });
  await makeBid({
    supplierOrgId: stroyResurs.org.id,
    createdBy: stroyResurs.user.id,
    prices: [
      { positionId: p1, qty: 320, unitPrice: 9400 },
      { positionId: p2, qty: 150, unitPrice: 10600 },
    ],
    submittedAt: hoursFromNow(-2),
    rank: 2,
    isBest: false,
  });

  // 2) SMR tender in `collecting`, no bids yet
  const [tenderSmr] = await db
    .insert(tenders)
    .values({
      number: 'T-2026-00002',
      title: 'Устройство монолитных конструкций подземной части, ЖК «Пресня-Сити», корп. 4',
      type: 'smr',
      visibility: 'open',
      status: 'collecting',
      organizationId: su10!.id,
      createdBy: manager!.id,
      description:
        'Комплекс работ по устройству монолитных железобетонных конструкций подземной части здания (стены, колонны, перекрытия). Материалы заказчика частично.',
      terms: {
        payment: 'Аванс 20%, ежемесячные КС-2/КС-3, оплата в течение 20 рабочих дней.',
        delivery: 'Срок выполнения — 4 месяца.',
        warranty: 'Гарантия на работы 5 лет.',
      },
      expectedVatRate: 'vat20',
      minStepPct: '0.50',
      startsAt: daysFromNow(-1),
      deadlineAt: daysFromNow(5),
      originalDeadlineAt: daysFromNow(5),
      publishedAt: daysFromNow(-1),
    })
    .returning();
  await db.insert(tenderPositions).values([
    {
      tenderId: tenderSmr!.id,
      positionNo: 1,
      name: 'Устройство монолитных стен и колонн (бетон, опалубка, армирование)',
      unit: 'm3',
      quantity: '1850.000',
      spec: 'Бетон B30, арматура А500С',
      isRequired: true,
    },
    {
      tenderId: tenderSmr!.id,
      positionNo: 2,
      name: 'Устройство монолитных перекрытий',
      unit: 'm2',
      quantity: '6200.000',
      spec: 'Толщина 250 мм, бетон B30',
      isRequired: true,
    },
  ]);

  // 3) Draft tender (manager still preparing)
  await db.insert(tenders).values({
    number: 'T-2026-00003',
    title: 'Поставка арматуры А500С (черновик)',
    type: 'materials',
    visibility: 'open',
    status: 'draft',
    organizationId: su10!.id,
    createdBy: manager!.id,
    description: 'Черновик тендера на поставку арматурного проката.',
    expectedVatRate: 'vat20',
    deadlineAt: daysFromNow(7),
    originalDeadlineAt: daysFromNow(7),
  });

  console.log('  ✓ seeded: 1 internal org, 3 staff users, category tree, 3 suppliers, 3 tenders, 2 demo bids');
  console.log(`  Demo accounts (password: ${DEMO_PASSWORD}):`);
  console.log('    admin@su10.ru · manager@su10.ru · sb@su10.ru');
  console.log('    supplier@beton.ru · supplier@stroyresurs.ru · supplier@pending.ru');
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function main() {
  const handle = createDb(DATABASE_URL, 1);
  try {
    console.log('Seeding…');
    await seed(handle.db);
    console.log('Done.');
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
