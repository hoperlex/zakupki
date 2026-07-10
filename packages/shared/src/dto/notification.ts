import { z } from 'zod';
import { NOTIF_TYPES } from '../enums';

export const notificationOutput = z.object({
  id: z.string().uuid(),
  type: z.enum(NOTIF_TYPES),
  title: z.string(),
  body: z.string().nullable(),
  link: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationOutput = z.infer<typeof notificationOutput>;

export const fileMeta = z.object({
  id: z.string().uuid(),
  originalName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  createdAt: z.string(),
});
export type FileMeta = z.infer<typeof fileMeta>;
