# Governance del repository

Impostazioni GitHub da applicare a mano (servono permessi admin su `Markg981/mestolo`). Il repository non le versiona: questi comandi `gh api` sono la procedura di riferimento.

Contesto:
- PR #272: concurrency di CI su `main` (ogni commit ha il proprio gruppo, nessun run scartato).
- PR #305 (chiusa): proponeva il job `legal` bloccante. Resta **non bloccante** finche non sono impostate le variabili `NEXT_PUBLIC_LEGAL_*`; per questo il job `legal` NON va tra i check obbligatori.

## Dependabot alerts e security updates

```bash
gh api -X PUT repos/Markg981/mestolo/vulnerability-alerts
gh api -X PUT repos/Markg981/mestolo/automated-security-fixes
# verifica (204 = attivo)
gh api -i repos/Markg981/mestolo/vulnerability-alerts
```

Gli aggiornamenti di versione sono configurati in `.github/dependabot.yml` (github-actions, npm, gradle, swift; cadenza settimanale).

## Ruleset su main

Check obbligatori (nomi reali dei job di `.github/workflows/ci.yml`): `Lint, typecheck, test, build`, `Test DB (Postgres)`, `Backup round trip (Postgres)`.

```bash
cat > ruleset-main.json <<'JSON'
{
  "name": "protect-main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "Lint, typecheck, test, build" },
          { "context": "Test DB (Postgres)" },
          { "context": "Backup round trip (Postgres)" }
        ] } }
  ]
}
JSON
gh api -X POST repos/Markg981/mestolo/rulesets --input ruleset-main.json
# verifica
gh api repos/Markg981/mestolo/rulesets
```

Con un solo maintainer lasciare `required_approving_review_count` a 0 (PR obbligatoria, senza approvazione altrui); alzarlo quando ci saranno altri revisori. Se un check non compare nel ruleset, eseguirlo almeno una volta su una PR.

## Controllo dati titolare

`scripts/check-legal.mjs` richiede `NEXT_PUBLIC_LEGAL_SENTRY_REGION` solo se Sentry e attivo (`SENTRY_DSN` o `NEXT_PUBLIC_SENTRY_DSN` valorizzati). Per rendere bloccante il job `legal`, impostare prima le variabili in GitHub > Settings > Variables > Actions e poi seguire il commento nel job.
