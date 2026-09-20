#!/usr/bin/env bash
# macOS local preview; launchd owns the process independently of the terminal.
set -euo pipefail
cd "$(dirname "$0")/.."
project_dir="$PWD"
job_label="local.folio-kb.preview"
action="${1:-start}"
case "$action" in
  start)
    if launchctl list "$job_label" >/dev/null 2>&1; then
      echo 'Preview job already registered. Use status or restart.'
      exit 0
    fi
    : "${FOLIO_PASSWORD:?Set FOLIO_PASSWORD before starting the local preview}"
    test -x "$project_dir/backend/target/debug/folio-kb"
    test -f "$project_dir/frontend/dist/index.html"
    mkdir -p "$project_dir/data"
    launchctl submit -l "$job_label" \
      -o "$project_dir/data/preview.log" \
      -e "$project_dir/data/preview-error.log" \
      -- /usr/bin/env \
      "FOLIO_PASSWORD=$FOLIO_PASSWORD" \
      "FOLIO_BIND=127.0.0.1:8787" \
      "FOLIO_DATA=$project_dir/data" \
      "FOLIO_WEB=$project_dir/frontend/dist" \
      "$project_dir/backend/target/debug/folio-kb"
    echo 'Local preview started: http://127.0.0.1:8787'
    ;;
  stop)
    launchctl remove "$job_label"
    ;;
  restart)
    launchctl remove "$job_label" 2>/dev/null || true
    exec "$0" start
    ;;
  status)
    launchctl list | awk -v label="$job_label" '$3 == label {print "PID:", $1, "Last exit:", $2, "Job:", $3}'
    curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8787/healthz
    ;;
  *) echo 'Usage: preview-local.sh [start|stop|restart|status]' >&2; exit 2 ;;
esac
