#!/usr/bin/env bash
set -euo pipefail
mkdir -p proof
printf '%s\n' "${SCENARIO:-}" > proof/scenario.txt
base64 -d > proof/inbox.png <<'PNG'
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==
PNG
exit 0
