// Confronto fra le impostazioni auth attese (policy di docs/auth-hardening.md)
// e quelle del progetto Supabase remoto (Management API, GET /v1/projects/{ref}/config/auth).
// Funzioni pure, testate in tests/unit/supabase-remote-config.test.ts.

// kind: 'eq' valore esatto; 'min' remoto >= atteso; 'max' remoto <= atteso.
export const EXPECTED_AUTH = [
  { key: 'password_min_length', kind: 'min', expected: 8, note: 'minimum_password_length' },
  { key: 'mailer_autoconfirm', kind: 'eq', expected: false, note: 'conferma email obbligatoria (enable_confirmations = true)' },
  { key: 'disable_signup', kind: 'eq', expected: false, note: 'enable_signup = true' },
  { key: 'external_anonymous_users_enabled', kind: 'eq', expected: false, note: 'enable_anonymous_sign_ins = false' },
  { key: 'refresh_token_rotation_enabled', kind: 'eq', expected: true, note: 'enable_refresh_token_rotation' },
  { key: 'jwt_exp', kind: 'max', expected: 3600, note: 'jwt_expiry' },
  { key: 'rate_limit_email_sent', kind: 'max', expected: 30, note: 'limite email/ora (produzione: restrittivo)' },
];

/** Restituisce l elenco delle differenze { key, expected, actual, note, kind }. Mai segreti. */
export function compareAuthConfig(remote, expected = EXPECTED_AUTH) {
  const diffs = [];
  for (const rule of expected) {
    const actual = remote ? remote[rule.key] : undefined;
    let ok;
    if (actual === undefined || actual === null) ok = false;
    else if (rule.kind === 'min') ok = typeof actual === 'number' && actual >= rule.expected;
    else if (rule.kind === 'max') ok = typeof actual === 'number' && actual <= rule.expected;
    else ok = actual === rule.expected;
    if (!ok) diffs.push({ key: rule.key, kind: rule.kind, expected: rule.expected, actual: actual ?? null, note: rule.note });
  }
  return diffs;
}

export function formatDiffs(diffs) {
  const sym = { eq: '=', min: '>=', max: '<=' };
  return diffs
    .map((d) => `  - ${d.key}: atteso ${sym[d.kind]} ${JSON.stringify(d.expected)}, remoto ${JSON.stringify(d.actual)} (${d.note})`)
    .join('\n');
}
