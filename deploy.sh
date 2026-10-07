#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if (( $# == 0 )); then set -- status; fi
exec "${TEAM_LOOP_PYTHON:-python3}" "$PROJECT_DIR/scripts/linux_service.py" "$@"
