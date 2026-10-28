#!/usr/bin/env bash
# Hardening del bucket dei backup: versioning, lifecycle e (opzionale) Object Lock.
# Idempotente. NON e' eseguito dal CI: lo lancia a mano il maintainer, con credenziali admin.
#
# Uso:
#   BACKUP_S3_BUCKET=<bucket> [BACKUP_S3_ENDPOINT=<url>] \
#   [OBJECT_LOCK_MODE=GOVERNANCE|COMPLIANCE] [OBJECT_LOCK_DAYS=30] \
#   scripts/s3-harden-bucket.sh
#
# Senza OBJECT_LOCK_MODE vengono applicati solo versioning e lifecycle.
# Trade-off Object Lock (vedi docs/backup.md):
#  - Object Lock si abilita in modo sicuro alla creazione del bucket; su bucket esistenti
#    AWS lo consente con versioning attivo, ma molti S3-compatibili no (verificare il provider).
#  - GOVERNANCE: chi ha s3:BypassGovernanceRetention puo' cancellare; protegge da errori e da
#    credenziali CI compromesse prive di quel permesso.
#  - COMPLIANCE: nessuno (nemmeno root) cancella o accorcia la retention: protezione massima
#    ma irreversibile, anche i costi di storage restano fino a scadenza.
#  - OBJECT_LOCK_DAYS deve essere < giorni di Expiration del lifecycle (90) per non bloccarlo.
set -euo pipefail

: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET obbligatorio}"
MODE="${OBJECT_LOCK_MODE:-}"
DAYS="${OBJECT_LOCK_DAYS:-30}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIFECYCLE="${HERE}/../docs/s3-lifecycle.json"

EP=()
if [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then EP=(--endpoint-url "$BACKUP_S3_ENDPOINT"); fi
aws_s3api() { aws s3api "${EP[@]}" "$@"; }

case "$MODE" in
  ""|GOVERNANCE|COMPLIANCE) ;;
  *) echo "OBJECT_LOCK_MODE non valido: $MODE (GOVERNANCE|COMPLIANCE)" >&2; exit 2 ;;
esac
case "$DAYS" in
  ''|*[!0-9]*) echo "OBJECT_LOCK_DAYS deve essere un intero" >&2; exit 2 ;;
esac
if [ "$DAYS" -lt 1 ] || [ "$DAYS" -ge 90 ]; then
  echo "OBJECT_LOCK_DAYS deve essere tra 1 e 89 (la lifecycle scade a 90 giorni)" >&2; exit 2
fi

echo "1/3 versioning"
aws_s3api put-bucket-versioning --bucket "$BACKUP_S3_BUCKET" \
  --versioning-configuration Status=Enabled

echo "2/3 lifecycle"
aws_s3api put-bucket-lifecycle-configuration --bucket "$BACKUP_S3_BUCKET" \
  --lifecycle-configuration "file://${LIFECYCLE}"

if [ -n "$MODE" ]; then
  echo "3/3 object lock ${MODE} ${DAYS} giorni"
  aws_s3api put-object-lock-configuration --bucket "$BACKUP_S3_BUCKET" \
    --object-lock-configuration "{\"ObjectLockEnabled\":\"Enabled\",\"Rule\":{\"DefaultRetention\":{\"Mode\":\"${MODE}\",\"Days\":${DAYS}}}}"
else
  echo "3/3 object lock saltato (OBJECT_LOCK_MODE non impostato)"
fi

echo "Stato finale:"
aws_s3api get-bucket-versioning --bucket "$BACKUP_S3_BUCKET"
