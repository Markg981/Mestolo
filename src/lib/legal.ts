/**
 * Dati legali del titolare del trattamento, configurabili in un solo punto
 * tramite variabili d'ambiente NEXT_PUBLIC_LEGAL_*. Nessun valore e' inventato:
 * se manca, le pagine /privacy e /terms mostrano un avviso ben visibile e
 * `npm run check:legal` segnala i campi mancanti.
 */
export type LegalConfig = {
  name: string | null;
  address: string | null;
  email: string | null;
  pec: string | null;
  vat: string | null;
  dpo: string | null;
  dataRegion: string | null;
  sentryRegion: string | null;
};

const clean = (v: string | undefined) => {
  const s = (v ?? '').trim();
  return s ? s : null;
};

export function legalConfig(): LegalConfig {
  // Accesso statico a process.env.NEXT_PUBLIC_* (necessario per l'inlining).
  return {
    name: clean(process.env.NEXT_PUBLIC_LEGAL_NAME),
    address: clean(process.env.NEXT_PUBLIC_LEGAL_ADDRESS),
    email: clean(process.env.NEXT_PUBLIC_LEGAL_EMAIL) ?? clean(process.env.NEXT_PUBLIC_SUPPORT_EMAIL),
    pec: clean(process.env.NEXT_PUBLIC_LEGAL_PEC),
    vat: clean(process.env.NEXT_PUBLIC_LEGAL_VAT),
    dpo: clean(process.env.NEXT_PUBLIC_LEGAL_DPO),
    dataRegion: clean(process.env.NEXT_PUBLIC_LEGAL_DATA_REGION),
    sentryRegion: clean(process.env.NEXT_PUBLIC_LEGAL_SENTRY_REGION),
  };
}

/** Campi obbligatori per un'informativa valida (PEC, P.IVA e DPO sono facoltativi). */
export const REQUIRED_LEGAL_FIELDS = ['name', 'address', 'email', 'dataRegion', 'sentryRegion'] as const;

export function missingLegalFields(cfg: LegalConfig = legalConfig()): string[] {
  return REQUIRED_LEGAL_FIELDS.filter((k) => !cfg[k]);
}

/** Sezioni renderizzate da /privacy e /terms (chiavi privacy.<s> e privacy.<s>Title). */
export const PRIVACY_SECTIONS = ['data', 'purposes', 'basis', 'visibility', 'recipients', 'push', 'ai', 'transfers', 'retention', 'security', 'rights', 'deletion', 'complaint', 'minors'] as const;
export const TERMS_SECTIONS = ['service', 'conduct', 'content', 'rights', 'safety', 'moderation', 'account', 'liability', 'law', 'changes'] as const;
