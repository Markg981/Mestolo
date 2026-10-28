# Hardening di Supabase Auth (GoTrue)

URL del progetto e anon key sono pubblici: chiunque puo chiamare direttamente
`/auth/v1/signup` e `/auth/v1/token`, saltando i controlli dell app (rate limit
applicativo, username, termini, ecc.). I limiti in `src/` sono quindi solo
difesa applicativa; la barriera reale sta nelle impostazioni GoTrue qui sotto.

## Impostazioni da replicare in produzione (Dashboard Supabase > Authentication)

| Impostazione | Valore | Note |
| --- | --- | --- |
| Minimum password length | 8 | Coerente con `passwordSchema` in `src/lib/password.ts` (min 8). Locale: `minimum_password_length = 8`. |
| Password requirements | nessuno | L app non impone complessita; non inasprire solo lato GoTrue per non rompere i flussi. |
| Confirm email (`enable_confirmations`) | attivo | In locale resta `false` perche e2e e seed creano utenti senza passare dalla mail. In produzione deve essere `true`. |
| Secure password change | attivo se i flussi lo permettono | Richiede login recente per cambiare password: verificare `changePassword` e il recovery prima di attivarlo. In locale resta `false`. |
| Rate limits (sign_in_sign_ups, token_verifications, email_sent) | valori restrittivi | Locale: `[auth.rate_limit]` in `supabase/config.toml`. In produzione: Authentication > Rate Limits. |
| CAPTCHA (Turnstile o hCaptcha) | attivo | Vedi sotto. |

## CAPTCHA

Non implementato nelle form: attivarlo lato GoTrue senza che le form di
login/signup/reset inviino `options.captchaToken` bloccherebbe l accesso.
Per abilitarlo servono: widget nelle tre form, token passato a
`signUp`/`signInWithPassword`/`resetPasswordForEmail` come `options.captchaToken`,
chiave pubblica in una variabile `NEXT_PUBLIC_*` e secret nel Dashboard.
Va fatto in un intervento dedicato, attivando GoTrue solo dopo il deploy delle form.

## Locale

`supabase/config.toml` e allineato alla policy password dell app. Il redirect
LAN (`additional_redirect_urls`) e fuori scope di questo documento.

## Verifica della config remota (drift)

Le impostazioni auth del progetto remoto non sono versionate: possono divergere da
`supabase/config.toml` e dalla tabella sopra. Lo script
`scripts/check-supabase-remote-config.mjs` legge la config via Management API
(`GET /v1/projects/{ref}/config/auth`) e segnala le differenze sulle chiavi
chiave (password minima, conferma email, signup, anonymous, rotazione refresh
token, `jwt_exp`, rate limit email).

```
SUPABASE_ACCESS_TOKEN=<personal access token> SUPABASE_PROJECT_REF=<ref> npm run check:supabase-remote
```

Il token (secret opzionale) non viene mai stampato. Senza token lo script salta con
exit 0; con `REMOTE_CONFIG_STRICT=1` fallisce. Le regole attese stanno in
`scripts/lib/supabase-remote-config.mjs` (`EXPECTED_AUTH`).
