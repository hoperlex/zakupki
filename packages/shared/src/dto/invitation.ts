import { z } from 'zod';
import { email } from '../common';
import { INVITE_STATUSES } from '../enums';

export const createInvitationsInput = z.object({
  invitations: z
    .array(
      z.object({
        email: email(),
        companyName: z.string().max(300).optional(),
        suggestedInn: z.string().max(12).optional(),
      }),
    )
    .min(1, 'Добавьте хотя бы одного участника'),
});
export type CreateInvitationsInput = z.infer<typeof createInvitationsInput>;

export const invitationOutput = z.object({
  id: z.string().uuid(),
  email: z.string(),
  companyName: z.string().nullable(),
  suggestedInn: z.string().nullable(),
  status: z.enum(INVITE_STATUSES),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable(),
  createdAt: z.string(),
  // returned to manager once so they can copy the link
  link: z.string().optional(),
});
export type InvitationOutput = z.infer<typeof invitationOutput>;

// Public preview shown at /invite/:token before registration.
export const invitationPreview = z.object({
  valid: z.boolean(),
  reason: z.string().nullable(),
  tender: z
    .object({
      id: z.string().uuid(),
      number: z.string(),
      title: z.string(),
      type: z.string(),
      organizationName: z.string(),
      deadlineAt: z.string(),
    })
    .nullable(),
  email: z.string().nullable(),
  suggestedInn: z.string().nullable(),
});
export type InvitationPreview = z.infer<typeof invitationPreview>;

export const acceptInvitationInput = z.object({
  token: z.string().min(10),
  fullName: z.string().trim().min(2).max(200),
  password: z.string().min(8).max(200),
  phone: z.string().max(30).optional(),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationInput>;
