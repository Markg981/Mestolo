#!/usr/bin/env bash
# Cifratura ASIMMETRICA dei backup (gpg --encrypt). Domini di fiducia (vedi docs/backup.md):
#  - BACKUP_GPG_PUBLIC_KEY: chiave/i PUBBLICHE del titolare; la privata resta fuori da GitHub.
#  - BACKUP_GPG_VERIFY_PUBLIC_KEY (opzionale): pubblica della coppia usa-e-getta di sola verifica. Il backup e'
#    cifrato anche verso di lei, quindi la sua PRIVATA (BACKUP_GPG_VERIFY_PRIVATE_KEY, secret di GitHub usato
#    SOLO da restore-verify.yml) DECIFRA TUTTI i backup. Non e' una chiave "a permessi ridotti": chi controlla
#    i secret di GitHub piu' le credenziali S3 legge i backup. Su GitHub sta quindi la privata di verifica,
#    mai quella del titolare.
# Funzioni da includere con "source":
#   backup_encrypt <in> <out>   richiede BACKUP_GPG_PUBLIC_KEY e/o BACKUP_GPG_VERIFY_PUBLIC_KEY
#   backup_decrypt <in> <out>   usa BACKUP_GPG_VERIFY_PRIVATE_KEY (armored, senza passphrase); in alternativa
#                               BACKUP_GPG_PRIVATE_KEY (DEPRECATO, stesso significato); in alternativa una
#                               chiave privata gia' presente nel portachiavi di gpg (restore a mano)
# Usano un GNUPGHOME temporaneo, quindi non toccano il portachiavi dell'utente.

backup_encrypt() {
  if [ -z "${BACKUP_GPG_PUBLIC_KEY:-}${BACKUP_GPG_VERIFY_PUBLIC_KEY:-}" ]; then
    echo "::error::BACKUP_GPG_PUBLIC_KEY richiesto (chiave pubblica gpg armored)" >&2; return 1
  fi
  local home rc=0 fpr; local -a rcpt=()
  home="$(mktemp -d)"; chmod 700 "$home"
  printf '%s\n%s\n' "${BACKUP_GPG_PUBLIC_KEY:-}" "${BACKUP_GPG_VERIFY_PUBLIC_KEY:-}" | GNUPGHOME="$home" gpg --batch --quiet --import 2>/dev/null || rc=$?
  if [ "$rc" -eq 0 ]; then
    # una riga fpr per chiave primaria (le sottochiavi hanno fpr dopo "sub"): il backup e' cifrato verso TUTTE
    # le chiavi pubbliche importate (es. chiave del titolare + chiave dedicata alla verifica di restore)
    while IFS= read -r fpr; do rcpt+=(--recipient "$fpr"); done < <(
      GNUPGHOME="$home" gpg --batch --with-colons --list-keys 2>/dev/null | awk -F: '/^pub:/ {p=1; next} /^fpr:/ && p {print $10; p=0}')
    [ "${#rcpt[@]}" -gt 0 ] || rc=1
  fi
  if [ "$rc" -eq 0 ]; then
    GNUPGHOME="$home" gpg --batch --yes --quiet --trust-model always "${rcpt[@]}" \
      --cipher-algo AES256 --output "$2" --encrypt "$1" || rc=$?
  else
    echo "::error::BACKUP_GPG_PUBLIC_KEY non valida" >&2
  fi
  rm -rf "$home"
  return "$rc"
}

backup_decrypt() {
  local home="" rc=0 priv="${BACKUP_GPG_VERIFY_PRIVATE_KEY:-}"
  if [ -z "$priv" ] && [ -n "${BACKUP_GPG_PRIVATE_KEY:-}" ]; then
    echo "::warning::BACKUP_GPG_PRIVATE_KEY e' deprecato: usare BACKUP_GPG_VERIFY_PRIVATE_KEY (vedi docs/backup.md)" >&2
    priv="$BACKUP_GPG_PRIVATE_KEY"
  fi
  if [ -n "$priv" ]; then
    home="$(mktemp -d)"; chmod 700 "$home"
    printf '%s\n' "$priv" | GNUPGHOME="$home" gpg --batch --quiet --import 2>/dev/null || rc=$?
  fi
  if [ "$rc" -eq 0 ]; then
    GNUPGHOME="${home:-${GNUPGHOME:-$HOME/.gnupg}}" gpg --batch --yes --quiet --pinentry-mode loopback \
      --output "$2" --decrypt "$1" || rc=$?
  fi
  if [ -n "$home" ]; then rm -rf "$home"; fi
  return "$rc"
}
