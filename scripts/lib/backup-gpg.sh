#!/usr/bin/env bash
# Cifratura ASIMMETRICA dei backup (gpg --encrypt): in CI c'e' solo la chiave PUBBLICA, la chiave
# privata resta fuori da GitHub (password manager / KMS) e serve solo per il restore.
# Funzioni da includere con "source":
#   backup_encrypt <in> <out>   richiede BACKUP_GPG_PUBLIC_KEY (una o piu' chiavi pubbliche armored)
#   backup_decrypt <in> <out>   richiede BACKUP_GPG_PRIVATE_KEY (armored, senza passphrase) oppure una
#                               chiave privata gia' presente nel portachiavi di gpg (restore a mano)
# Usano un GNUPGHOME temporaneo, quindi non toccano il portachiavi dell'utente.

backup_encrypt() {
  : "${BACKUP_GPG_PUBLIC_KEY:?BACKUP_GPG_PUBLIC_KEY richiesto (chiave pubblica gpg armored)}"
  local home rc=0 fpr; local -a rcpt=()
  home="$(mktemp -d)"; chmod 700 "$home"
  printf '%s\n' "$BACKUP_GPG_PUBLIC_KEY" | GNUPGHOME="$home" gpg --batch --quiet --import 2>/dev/null || rc=$?
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
  local home="" rc=0
  if [ -n "${BACKUP_GPG_PRIVATE_KEY:-}" ]; then
    home="$(mktemp -d)"; chmod 700 "$home"
    printf '%s\n' "$BACKUP_GPG_PRIVATE_KEY" | GNUPGHOME="$home" gpg --batch --quiet --import 2>/dev/null || rc=$?
  fi
  if [ "$rc" -eq 0 ]; then
    GNUPGHOME="${home:-${GNUPGHOME:-$HOME/.gnupg}}" gpg --batch --yes --quiet --pinentry-mode loopback \
      --output "$2" --decrypt "$1" || rc=$?
  fi
  if [ -n "$home" ]; then rm -rf "$home"; fi
  return "$rc"
}
