// Verifica che i dati del titolare del trattamento siano configurati.
// Uso: npm run check:legal  (con LEGAL_STRICT=1 esce con errore se mancano).
const req = {
  NEXT_PUBLIC_LEGAL_NAME: process.env.NEXT_PUBLIC_LEGAL_NAME,
  NEXT_PUBLIC_LEGAL_ADDRESS: process.env.NEXT_PUBLIC_LEGAL_ADDRESS,
  NEXT_PUBLIC_LEGAL_EMAIL: process.env.NEXT_PUBLIC_LEGAL_EMAIL || process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
  NEXT_PUBLIC_LEGAL_DATA_REGION: process.env.NEXT_PUBLIC_LEGAL_DATA_REGION,
  NEXT_PUBLIC_LEGAL_SENTRY_REGION: process.env.NEXT_PUBLIC_LEGAL_SENTRY_REGION,
};
const missing = Object.entries(req)
  .filter(([, v]) => !(v ?? '').trim())
  .map(([k]) => k);
if (missing.length) {
  const msg = `[legal] Dati del titolare mancanti: ${missing.join(', ')}. /privacy e /terms mostreranno un avviso.`;
  if (process.env.LEGAL_STRICT === '1') {
    console.error(msg);
    process.exit(1);
  }
  console.warn(msg);
}
