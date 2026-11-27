import type { ProofSidecar } from "./types.js";

/** Detect a coarse stack hint from repo file names (not an engine platform enum). */
export function detectStackHint(paths: string[]): {
  runsOn: string;
  startHint: string;
  requiredSecrets: string[];
} {
  const lower = paths.map((p) => p.toLowerCase());
  const has = (re: RegExp) => lower.some((p) => re.test(p));

  if (has(/\.xcodeproj\b/) || has(/\.xcworkspace\b/) || has(/package\.swift$/)) {
    return {
      runsOn: "macos-latest",
      startHint: "Build with xcodebuild and boot the iOS Simulator before recording.",
      requiredSecrets: [],
    };
  }
  if (has(/\.sln$/) || has(/\.csproj$/) || has(/wpf|winui|maui/)) {
    return {
      runsOn: "windows-latest",
      startHint: "Build the Windows desktop app and launch it before recording.",
      requiredSecrets: [],
    };
  }
  if (has(/package\.json$/)) {
    return {
      runsOn: "ubuntu-latest",
      startHint: "Run npm ci and start the web app (npm run dev / preview) before recording.",
      requiredSecrets: [],
    };
  }
  return {
    runsOn: "ubuntu-latest",
    startHint: "Inspect the repo and start the application the usual way before recording.",
    requiredSecrets: [],
  };
}

export function renderProofWorkflow(input: {
  workflowFileName: string;
  runsOn: string;
  startHint: string;
}): string {
  const name = input.workflowFileName.replace(/\.yml$/i, "");
  return `name: ${name}

on:
  workflow_dispatch:
    inputs:
      sha:
        description: Commit SHA to check out
        required: true
        type: string
      scenario:
        description: Behavior to record
        required: true
        type: string
      pr_number:
        description: Feature pull request number
        required: true
        type: string
      upload_url:
        description: Factory proof upload URL
        required: true
        type: string
      upload_token:
        description: Bearer token for Factory upload
        required: true
        type: string

jobs:
  proof:
    runs-on: ${input.runsOn}
    permissions:
      contents: read
    steps:
      - name: Checkout feature SHA
        uses: actions/checkout@v4
        with:
          ref: \${{ inputs.sha }}

      - name: Record behavior
        env:
          SCENARIO: \${{ inputs.scenario }}
          UPLOAD_URL: \${{ inputs.upload_url }}
          UPLOAD_TOKEN: \${{ inputs.upload_token }}
          CURSOR_API_KEY: \${{ secrets.CURSOR_API_KEY }}
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          set -euo pipefail
          chmod +x .factory/record-proof.sh || true
          # ${input.startHint}
          if [ -x .factory/record-proof.sh ]; then
            .factory/record-proof.sh
          else
            mkdir -p proof
            printf '%s\\n' "\$SCENARIO" > proof/scenario.txt
            echo "record-proof.sh missing — wrote scenario only" >&2
            exit 1
          fi

      - name: Upload proof to Factory
        if: always()
        env:
          UPLOAD_URL: \${{ inputs.upload_url }}
          UPLOAD_TOKEN: \${{ inputs.upload_token }}
        run: |
          set -euo pipefail
          if [ ! -d proof ]; then exit 0; fi
          shopt -s nullglob
          for f in proof/*; do
            [ -f "\$f" ] || continue
            curl -fsS -X POST "\$UPLOAD_URL" \\
              -H "Authorization: Bearer \$UPLOAD_TOKEN" \\
              -F "file=@\$f"
          done

      - name: Keep Actions artifacts as fallback
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: factory-proof
          path: proof/
          if-no-files-found: ignore
`;
}

export function renderRecordProofScript(startHint: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail
# Factory-generated recorder.
# ${startHint}
# Goal: start the app, drive \$SCENARIO (via coding agent or UI test), write media under ./proof/

mkdir -p proof
printf '%s\\n' "\${SCENARIO:-}" > proof/scenario.txt

if command -v npx >/dev/null 2>&1 && [ -f package.json ]; then
  if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then npm ci; else npm install; fi
  npm run --if-present build || true
  # Start a long-lived preview in the background when the script exists.
  if npm run --if-present preview --dry-run >/dev/null 2>&1; then
    npm run preview >/tmp/factory-preview.log 2>&1 &
    sleep 3
  elif npm run --if-present dev --dry-run >/dev/null 2>&1; then
    npm run dev >/tmp/factory-preview.log 2>&1 &
    sleep 3
  fi
fi

# Prefer an agent on this runner when a key is present.
PROMPT="Record the following user-visible behavior. Save screenshots or video under ./proof/ then exit.\\n\\n\$SCENARIO"
if [ -n "\${CURSOR_API_KEY:-}" ] && command -v cursor-agent >/dev/null 2>&1; then
  cursor-agent -p --force "\$PROMPT" || true
elif [ -n "\${ANTHROPIC_API_KEY:-}" ] && command -v claude >/dev/null 2>&1; then
  claude -p "\$PROMPT" --allowedTools "Bash,Read,Write" || true
fi

# Exit 0 if anything landed in proof/ (even scenario.txt) so Factory can collect it.
exit 0
`;
}

export function renderProofSidecar(hint: {
  runsOn: string;
  requiredSecrets: string[];
}): string {
  const sidecar: ProofSidecar = {
    runsOn: hint.runsOn,
    requiredSecrets: hint.requiredSecrets.length
      ? hint.requiredSecrets
      : hint.runsOn.includes("macos") || hint.runsOn.includes("windows")
        ? []
        : [],
  };
  return `${JSON.stringify(sidecar, null, 2)}\n`;
}
