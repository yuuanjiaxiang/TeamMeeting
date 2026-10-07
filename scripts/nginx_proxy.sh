#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ACTION="${1:-status}"
if (( $# )); then shift; fi
case "$ACTION" in
  render) exec "${TEAM_LOOP_PYTHON:-python3}" "$PROJECT_DIR/scripts/render_nginx_linux.py" "$@" ;;
  test) exec nginx -t "$@" ;;
  reload) nginx -t; exec systemctl reload nginx ;;
  start|stop|status) exec systemctl "$ACTION" nginx ;;
  *) echo 'Usage: nginx_proxy.sh {render|test|start|reload|stop|status}' >&2; exit 2 ;;
esac
