import { and, asc, eq } from 'drizzle-orm';
import type { CategoryNode, CreateCategoryInput, TenderType } from '@zakupki/shared';
import { categories, type Database } from '@zakupki/db';

export async function listCategoryTree(db: Database, kind?: TenderType): Promise<CategoryNode[]> {
  const rows = await db.query.categories.findMany({
    where: kind ? and(eq(categories.kind, kind), eq(categories.isActive, true)) : eq(categories.isActive, true),
    orderBy: [asc(categories.sortOrder), asc(categories.name)],
  });
  const byId = new Map<string, CategoryNode>();
  const roots: CategoryNode[] = [];
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      parentId: row.parentId,
      kind: row.kind,
      code: row.code,
      name: row.name,
      path: row.path,
      sortOrder: row.sortOrder,
      children: [],
    });
  }
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export async function createCategory(db: Database, input: CreateCategoryInput): Promise<string> {
  let path = '/';
  if (input.parentId) {
    const parent = await db.query.categories.findFirst({ where: eq(categories.id, input.parentId) });
    if (parent) path = `${parent.path}${parent.id}/`;
  }
  const [row] = await db
    .insert(categories)
    .values({
      parentId: input.parentId ?? null,
      kind: input.kind,
      code: input.code ?? null,
      name: input.name,
      path,
      sortOrder: input.sortOrder,
    })
    .returning({ id: categories.id });
  return row!.id;
}
