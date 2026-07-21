import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  companyCardInput,
  inn,
  setCounterpartyTypeInput,
  setGeneralContractorInput,
} from '@zakupki/shared';
import { lookupInn } from '../../lib/inn-lookup';
import {
  getMyOrg,
  getOrgById,
  listCounterparties,
  listSupplierOrgs,
  setCounterpartyType,
  setGeneralContractor,
  submitAccreditation,
  upsertCompanyCard,
} from './service';

export async function organizationRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/me', { preHandler: app.authenticate }, async (request) => {
    return getMyOrg(app.db, request.user.sub);
  });

  r.put(
    '/me',
    { preHandler: app.requireRole('supplier'), schema: { body: companyCardInput } },
    async (request) => upsertCompanyCard(app.db, request.user.sub, request.body),
  );

  r.post(
    '/me/submit-accreditation',
    { preHandler: app.requireRole('supplier') },
    async (request) => {
      await submitAccreditation(app.db, request.user.sub);
      return { ok: true };
    },
  );

  r.get(
    '/lookup',
    { preHandler: app.authenticate, schema: { querystring: z.object({ inn: inn() }) } },
    async (request) => lookupInn(request.query.inn),
  );

  // ─── Справочник контрагентов (менеджер + админ) ───
  r.get(
    '/counterparties',
    { preHandler: app.requireRole('admin', 'manager') },
    async () => listCounterparties(app.db),
  );

  r.post(
    '/general-contractor',
    { preHandler: app.requireRole('admin', 'manager'), schema: { body: setGeneralContractorInput } },
    async (request) => {
      await setGeneralContractor(app.db, request.body.organizationId);
      return { ok: true };
    },
  );

  r.patch(
    '/:id/counterparty-type',
    {
      preHandler: app.requireRole('admin', 'manager'),
      schema: { params: z.object({ id: z.string().uuid() }), body: setCounterpartyTypeInput },
    },
    async (request) => {
      await setCounterpartyType(app.db, request.params.id, request.body.counterpartyType);
      return { ok: true };
    },
  );

  r.get(
    '/',
    {
      preHandler: app.requireRole('admin', 'manager', 'security'),
      schema: { querystring: z.object({ status: z.string().optional() }) },
    },
    async (request) => listSupplierOrgs(app.db, request.query.status),
  );

  r.get(
    '/:id',
    {
      preHandler: app.requireRole('admin', 'manager', 'security'),
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (request) => getOrgById(app.db, request.params.id),
  );
}
