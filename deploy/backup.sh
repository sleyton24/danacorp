#!/usr/bin/env bash
# Backup diario de DanaCorp: dump de PostgreSQL + tar de los archivos subidos.
# Programar con cron, p.ej. (todos los días a las 03:00):
#   0 3 * * * /opt/danacorp/deploy/backup.sh >> /var/log/danacorp-backup.log 2>&1
#
# Restaurar la BD:  psql -d danacorp < danacorp-YYYY-MM-DD.sql   (o pg_restore si es -Fc)
set -euo pipefail

# ── Config (ajustar) ──────────────────────────────────────────────────────────
PGDATABASE="${PGDATABASE:-danacorp}"
PGUSER="${PGUSER:-postgres}"
PGHOST="${PGHOST:-localhost}"
UPLOADS_DIR="${UPLOADS_DIR:-/var/lib/danacorp/uploads}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/danacorp}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

DATE="$(date +%F)"
mkdir -p "$BACKUP_DIR"

# ── Dump de la base (formato custom, comprimido) ──────────────────────────────
PGPASSWORD="${PGPASSWORD:-}" pg_dump -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -Fc \
  -f "$BACKUP_DIR/danacorp-$DATE.dump"

# ── Tar de los archivos subidos ───────────────────────────────────────────────
if [ -d "$UPLOADS_DIR" ]; then
  tar -czf "$BACKUP_DIR/uploads-$DATE.tar.gz" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
fi

# ── Rotación: borra backups más viejos que RETENTION_DAYS ─────────────────────
find "$BACKUP_DIR" -name 'danacorp-*.dump' -mtime "+$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name 'uploads-*.tar.gz' -mtime "+$RETENTION_DAYS" -delete

echo "[backup] OK $DATE -> $BACKUP_DIR"
