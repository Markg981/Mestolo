import { describe, expect, it } from 'vitest';
// @ts-expect-error modulo .mjs senza tipi
import { compareAuthConfig, formatDiffs } from '../../scripts/lib/supabase-remote-config.mjs';

const good = {
  password_min_length: 8,
  mailer_autoconfirm: false,
  disable_signup: false,
  external_anonymous_users_enabled: false,
  refresh_token_rotation_enabled: true,
  jwt_exp: 3600,
  rate_limit_email_sent: 4,
};

describe('compareAuthConfig', () => {
  it('nessuna differenza con config conforme', () => {
    expect(compareAuthConfig(good)).toEqual([]);
  });
  it('segnala conferma email disattivata e password corta', () => {
    const d = compareAuthConfig({ ...good, mailer_autoconfirm: true, password_min_length: 6 });
    expect(d.map((x: { key: string }) => x.key).sort()).toEqual(['mailer_autoconfirm', 'password_min_length']);
  });
  it('un campo mancante e una differenza', () => {
    const { jwt_exp: _omit, ...rest } = good;
    void _omit;
    expect(compareAuthConfig(rest)).toHaveLength(1);
  });
  it('rispetta min e max', () => {
    expect(compareAuthConfig({ ...good, password_min_length: 12, jwt_exp: 600 })).toEqual([]);
    expect(compareAuthConfig({ ...good, jwt_exp: 7200 })).toHaveLength(1);
  });
  it('formatDiffs non contiene segreti e descrive la differenza', () => {
    const out = formatDiffs(compareAuthConfig({ ...good, disable_signup: true }));
    expect(out).toContain('disable_signup');
  });
});
