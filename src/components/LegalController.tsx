import { getTranslations } from 'next-intl/server';
import { legalConfig, missingLegalFields, type LegalConfig } from '@/lib/legal';

const ROWS: (keyof LegalConfig)[] = ['name', 'address', 'email', 'pec', 'vat', 'dpo'];
const REGION_ROWS: (keyof LegalConfig)[] = ['dataRegion', 'sentryRegion'];

/** Scheda del titolare del trattamento: dati da NEXT_PUBLIC_LEGAL_*, con avviso visibile se mancano. */
export async function LegalController({ regions = false }: { regions?: boolean }) {
  const t = await getTranslations('legal');
  const cfg = legalConfig();
  const missing = missingLegalFields(cfg).filter((k) => regions || !REGION_ROWS.includes(k as keyof LegalConfig));
  const rows = [...ROWS, ...(regions ? REGION_ROWS : [])].filter((k) => cfg[k]);
  return (
    <section className="flex flex-col gap-3" data-testid="legal-controller">
      <h2 className="text-xl font-bold">{t('controllerTitle')}</h2>
      {missing.length > 0 && (
        <div role="alert" className="rounded-lg border-2 border-red-600 bg-red-50 p-3 text-red-900">
          <p className="font-bold">{t('missingTitle')}</p>
          <p>{t('missingBody', { fields: missing.map((k) => t(k)).join(', ') })}</p>
        </div>
      )}
      {rows.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
          {rows.map((k) => (
            <div key={k} className="contents">
              <dt className="font-semibold">{t(k)}</dt>
              <dd className="break-words">
                {k === 'email' ? <a className="underline" href={`mailto:${cfg.email}`}>{cfg.email}</a> : cfg[k]}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
