// Verifica che i dati del titolare del trattamento siano configurati.
// Uso: npm run check:legal  (con LEGAL_STRICT=1 esce con errore se mancano).
// In produzione Vercel (VERCEL_ENV=production) la modalita' strict e' automatica:
// la build fallisce invece di pubblicare /privacy e /terms incompleti.
// LEGAL_STRICT=0 la disattiva esplicitamente.
const strict = process.env.LEGAL_STRICT === '1' || (process.env.VERCEL_ENV === 'production' && process.env.LEGAL_STRICT !== '0');
// La regione Sentry serve solo se Sentry e' attivo (stesso rilevamento di src/instrumentation.ts).
const sentryOn = Boolean((process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || '').trim());
const req = {
  NEXT_PUBLIC_LEGAL_NAME: [process.env.NEXT_PUBLIC_LEGAL_NAME, 'ragione sociale / nome del titolare'],
  NEXT_PUBLIC_LEGAL_ADDRESS: [process.env.NEXT_PUBLIC_LEGAL_ADDRESS, 'indirizzo della sede'],
  NEXT_PUBLIC_LEGAL_EMAIL: [
    process.env.NEXT_PUBLIC_LEGAL_EMAIL || process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
    'email di contatto privacy (in alternativa NEXT_PUBLIC_SUPPORT_EMAIL)',
  ],
  NEXT_PUBLIC_LEGAL_DATA_REGION: [process.env.NEXT_PUBLIC_LEGAL_DATA_REGION, 'regione Supabase, es. UE - Francoforte'],
};
if (sentryOn) {
  req.NEXT_PUBLIC_LEGAL_SENTRY_REGION = [process.env.NEXT_PUBLIC_LEGAL_SENTRY_REGION, 'regione Sentry, es. UE - Germania'];
}
const missing = Object.entries(req).filter(([, [v]]) => !(v ?? '').trim());
if (missing.length) {
  const lines = missing.map(([k, [, d]]) => `  - ${k}: ${d}`);
  const msg =
    `[legal] Dati del titolare mancanti (${missing.length}):\n${lines.join('\n')}\n` +
    `Impostarli come variabili d'ambiente (Vercel > Settings > Environment Variables; ` +
    `in locale .env.local, vedi .env.example). /privacy e /terms mostreranno un avviso.`;
  if (strict) {
    console.error(msg);
    process.exit(1);
  }
  console.warn(msg);
}
