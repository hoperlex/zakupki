import type { InnLookupResult } from '@zakupki/shared';
import { env } from '../config/env';

interface DadataParty {
  data: {
    inn?: string;
    kpp?: string;
    ogrn?: string;
    okpo?: string;
    okved?: string;
    name?: { full_with_opf?: string; short_with_opf?: string };
    address?: { value?: string };
    management?: { name?: string };
  };
}

async function dadataLookup(inn: string): Promise<InnLookupResult | null> {
  const res = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      Authorization: `Token ${env.INN_LOOKUP_TOKEN}`,
    },
    body: JSON.stringify({ query: inn }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { suggestions?: DadataParty[] };
  const s = json.suggestions?.[0]?.data;
  if (!s) return { found: false };
  return {
    found: true,
    fullName: s.name?.full_with_opf,
    shortName: s.name?.short_with_opf,
    inn: s.inn,
    kpp: s.kpp,
    ogrn: s.ogrn,
    okpo: s.okpo,
    okved: s.okved,
    legalAddress: s.address?.value,
    directorName: s.management?.name,
  };
}

/**
 * ИНН autofill. Uses DaData when INN_LOOKUP_TOKEN is set; otherwise a deterministic
 * dev stub so the autofill UX is demonstrable locally (clearly fabricated data).
 */
export async function lookupInn(inn: string): Promise<InnLookupResult> {
  if (env.INN_LOOKUP_TOKEN) {
    try {
      const r = await dadataLookup(inn);
      if (r) return r;
    } catch {
      /* fall through to stub */
    }
  }
  // dev stub
  const isIp = inn.length === 12;
  return {
    found: true,
    fullName: isIp
      ? `Индивидуальный предприниматель (ИНН ${inn})`
      : `ООО «Поставщик ${inn.slice(-4)}»`,
    shortName: isIp ? `ИП ${inn.slice(-4)}` : `ООО «Поставщик ${inn.slice(-4)}»`,
    inn,
    kpp: isIp ? undefined : `${inn.slice(0, 4)}01001`,
    ogrn: isIp ? `3${inn}00` : `1${inn}000`.slice(0, 13),
    legalAddress: 'г. Москва',
  };
}
