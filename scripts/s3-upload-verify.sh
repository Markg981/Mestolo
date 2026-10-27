#!/usr/bin/env bash
# Carica un file su S3 e verifica che l'oggetto esista con la stessa dimensione.
# Uso: s3-upload-verify.sh <file locale> <chiave S3>
# Env: BACKUP_S3_BUCKET, BACKUP_S3_ENDPOINT (opzionale), AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
set -euo pipefail
file="${1:?file locale}"
key="${2:?chiave S3}"
for v in BACKUP_S3_BUCKET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
  if [ -z "${!v:-}" ]; then
    echo "::error::${v} non impostato: upload S3 impossibile, il backup NON e stato messo al sicuro." >&2
    exit 1
  fi
done
endpoint=()
if [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then endpoint=(--endpoint-url "${BACKUP_S3_ENDPOINT}"); fi
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"
aws s3 cp "${endpoint[@]}" "$file" "s3://${BACKUP_S3_BUCKET}/${key}"
local_size="$(wc -c < "$file" | tr -d ' ')"
remote_size="$(aws s3api head-object "${endpoint[@]}" --bucket "${BACKUP_S3_BUCKET}" --key "$key" --query ContentLength --output text)"
if [ "$local_size" != "$remote_size" ]; then
  echo "::error::Verifica S3 fallita per ${key}: locale ${local_size} byte, remoto ${remote_size} byte." >&2
  exit 1
fi
echo "S3 ok: ${key} (${remote_size} byte)"
