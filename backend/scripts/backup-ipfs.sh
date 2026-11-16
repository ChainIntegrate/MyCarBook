#!/usr/bin/env bash
# Backup fuori server dei contenuti IPFS di MyCarBook (audit MCB-17).
# 1. esporta i CAR di tutti i CID referenziati dal contratto;
# 2. li copia su una destinazione ESTERNA al VPS (BACKUP_REMOTE);
# 3. tiene in locale solo le ultime KEEP_LOCAL copie.
#
# Variabili (in backend/.env o nell'ambiente del servizio systemd):
#   BACKUP_DIR     cartella locale        (default /var/backups/mycarbook-ipfs)
#   BACKUP_REMOTE  destinazione esterna: "rclone:<remote>:<percorso>" oppure
#                  "rsync:<utente>@<host>:<percorso>" (chiave SSH dedicata)
#   KEEP_LOCAL     copie locali da tenere (default 4)
set -euo pipefail
cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-/var/backups/mycarbook-ipfs}"
KEEP_LOCAL="${KEEP_LOCAL:-4}"
: "${BACKUP_REMOTE:?BACKUP_REMOTE non impostata: il backup deve uscire dal server}"

STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
OUT="$BACKUP_DIR/$STAMP"
node scripts/backup-ipfs.js --out "$OUT"

case "$BACKUP_REMOTE" in
  rclone:*) rclone copy "$OUT" "${BACKUP_REMOTE#rclone:}/$STAMP" --checksum ;;
  rsync:*)  rsync -a --checksum "$OUT/" "${BACKUP_REMOTE#rsync:}/$STAMP/" ;;
  *) echo "BACKUP_REMOTE deve iniziare con rclone: o rsync:" >&2; exit 2 ;;
esac

# rotazione locale
ls -1d "$BACKUP_DIR"/*/ 2>/dev/null | sort | head -n -"$KEEP_LOCAL" | xargs -r rm -rf
echo "Backup $STAMP copiato su $BACKUP_REMOTE"
