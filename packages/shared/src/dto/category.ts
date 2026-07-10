import { z } from 'zod';
import { TENDER_TYPES } from '../enums';

export const categoryNode: z.ZodType<CategoryNode> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    kind: z.enum(TENDER_TYPES),
    code: z.string().nullable(),
    name: z.string(),
    path: z.string(),
    sortOrder: z.number().int(),
    children: z.array(categoryNode),
  }),
);
export interface CategoryNode {
  id: string;
  parentId: string | null;
  kind: (typeof TENDER_TYPES)[number];
  code: string | null;
  name: string;
  path: string;
  sortOrder: number;
  children: CategoryNode[];
}

export const createCategoryInput = z.object({
  parentId: z.string().uuid().nullable().optional(),
  kind: z.enum(TENDER_TYPES),
  code: z.string().max(50).optional().nullable(),
  name: z.string().trim().min(2).max(200),
  sortOrder: z.number().int().default(0),
});
export type CreateCategoryInput = z.infer<typeof createCategoryInput>;
