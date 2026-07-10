import { eq } from 'drizzle-orm';
import type { NotifType } from '@zakupki/shared';
import { notifications, users, type Database } from '@zakupki/db';
import { sendMail } from './mail';

export interface NotifyInput {
  type: NotifType;
  title: string;
  body?: string;
  link?: string;
  email?: boolean;
}

/** Create an in-app notification for a user (optionally also email). */
export async function notifyUser(db: Database, userId: string, input: NotifyInput): Promise<void> {
  await db.insert(notifications).values({
    userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
  });
  if (input.email) {
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (user?.email) {
      await sendMail({
        to: user.email,
        subject: input.title,
        text: `${input.body ?? input.title}${input.link ? `\n\n${input.link}` : ''}`,
      }).catch(() => {});
    }
  }
}

/** Notify all users belonging to an organization. */
export async function notifyOrg(db: Database, orgId: string, input: NotifyInput): Promise<void> {
  const members = await db.query.users.findMany({ where: eq(users.organizationId, orgId) });
  await Promise.all(members.map((m) => notifyUser(db, m.id, input)));
}
