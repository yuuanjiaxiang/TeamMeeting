#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "${TEAM_LOOP_PYTHON:-python3}" "$PROJECT_DIR/scripts/thanks_analysis.py" "$@"
