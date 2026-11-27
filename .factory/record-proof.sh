#!/usr/bin/env bash
set -euo pipefail
mkdir -p proof
printf '%s\n' "${SCENARIO:-}" > proof/scenario.txt
base64 -d > proof/inbox.png <<'EOF'
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==
EOF
exit 0
