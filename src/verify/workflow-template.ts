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
      startHint: "Run npm ci, start the web app, then capture screenshots of the scenario.",
      // Optional: ADMIN_PASSWORD lets the recorder sign in. CURSOR_API_KEY drives complex flows.
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
          ADMIN_PASSWORD: \${{ secrets.ADMIN_PASSWORD }}
          PROOF_BASE_URL: \${{ secrets.PROOF_BASE_URL }}
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

/** Bash recorder written into the product repo. Must leave real screenshots/video under ./proof/. */
export function renderRecordProofScript(startHint: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail
# Factory-generated recorder.
# ${startHint}
# Contract: leave at least one real screenshot/video under ./proof/ (not a 1×1 stub).

mkdir -p proof
printf '%s\\n' "\${SCENARIO:-}" > proof/scenario.txt

PROOF_BASE_URL="\${PROOF_BASE_URL:-http://127.0.0.1:5173}"
APP_PID=""

cleanup() {
  if [ -n "\$APP_PID" ] && kill -0 "\$APP_PID" 2>/dev/null; then
    kill "\$APP_PID" 2>/dev/null || true
    wait "\$APP_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

start_web_app() {
  if ! command -v npx >/dev/null 2>&1 || [ ! -f package.json ]; then
    return 1
  fi
  if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then npm ci; else npm install; fi
  npm run --if-present build || true

  if npm run --if-present preview --dry-run >/dev/null 2>&1; then
    npm run preview -- --host 127.0.0.1 --port 5173 >/tmp/factory-preview.log 2>&1 &
    APP_PID=\$!
    PROOF_BASE_URL="http://127.0.0.1:5173"
  elif npm run --if-present dev --dry-run >/dev/null 2>&1; then
    # Prefer Vite alone when present so proof does not need the full API stack.
    if [ -f vite.config.ts ] || [ -f vite.config.js ] || [ -f vite.config.mjs ]; then
      npx vite --host 127.0.0.1 --port 5173 >/tmp/factory-preview.log 2>&1 &
      APP_PID=\$!
      PROOF_BASE_URL="http://127.0.0.1:5173"
    else
      npm run dev >/tmp/factory-preview.log 2>&1 &
      APP_PID=\$!
    fi
  else
    return 1
  fi

  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    if curl -fsS "\$PROOF_BASE_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "app did not become ready at \$PROOF_BASE_URL" >&2
  tail -n 80 /tmp/factory-preview.log >&2 || true
  return 1
}

capture_with_playwright() {
  # Install a transient Playwright so the product repo does not need it as a dependency.
  npm install --no-save --no-package-lock playwright@1.49.1 >/tmp/factory-pw-install.log 2>&1 || {
    echo "playwright npm install failed" >&2
    tail -n 40 /tmp/factory-pw-install.log >&2 || true
    return 1
  }
  npx playwright install chromium >/tmp/factory-pw-browser.log 2>&1 || {
    echo "playwright browser install failed" >&2
    tail -n 40 /tmp/factory-pw-browser.log >&2 || true
    return 1
  }

  PROOF_BASE_URL="\$PROOF_BASE_URL" ADMIN_PASSWORD="\${ADMIN_PASSWORD:-}" SCENARIO="\${SCENARIO:-}" node <<'NODE'
const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const base = process.env.PROOF_BASE_URL || "http://127.0.0.1:5173";
  const scenario = process.env.SCENARIO || "";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: "networkidle", timeout: 60000 }).catch(async () => {
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
  });

  const password = process.env.ADMIN_PASSWORD || "";
  if (password) {
    const field = page.locator('input[type="password"]').first();
    if (await field.count()) {
      await field.fill(password);
      const signIn = page.getByRole("button", { name: /sign in/i });
      if (await signIn.count()) await signIn.click();
      else await page.keyboard.press("Enter");
      await page.waitForTimeout(2500);
    }
  }

  // Human-visible proof of the running UI (signed-in when password was provided).
  await page.screenshot({ path: "proof/behavior.png", fullPage: false });

  const mark = page.locator("text=FACTORY").first();
  if (await mark.count()) {
    await mark.scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: "proof/feature.png", fullPage: false });
  }

  fs.writeFileSync(
    "proof/recorder-notes.txt",
    [
      "Playwright recorder",
      "base: " + base,
      "signedIn: " + Boolean(password),
      "",
      scenario,
      "",
    ].join("\\n"),
  );

  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
NODE
}

capture_with_agent() {
  local prompt
  prompt="You are recording proof that a product change works.

Scenario:
\$SCENARIO

The app should already be running at \$PROOF_BASE_URL (or start it if needed).
Sign in when ADMIN_PASSWORD is set in the environment.
Drive the happy path in the scenario.
Save one or more real screenshots (PNG/JPEG) or a short video under ./proof/.
Do not write a 1x1 placeholder image. The files must show the actual UI.
Then exit."

  if [ -n "\${CURSOR_API_KEY:-}" ]; then
    if ! command -v cursor-agent >/dev/null 2>&1; then
      curl -fsSL https://cursor.com/install | bash || true
      export PATH="\$HOME/.local/bin:\$PATH"
    fi
    if command -v cursor-agent >/dev/null 2>&1; then
      cursor-agent -p --force "\$prompt" || true
      return 0
    fi
  fi
  if [ -n "\${ANTHROPIC_API_KEY:-}" ] && command -v claude >/dev/null 2>&1; then
    claude -p "\$prompt" --allowedTools "Bash,Read,Write" || true
  fi
}

has_real_media() {
  shopt -s nullglob
  local f size
  for f in proof/*; do
    [ -f "\$f" ] || continue
    case "\$f" in
      *.png|*.jpg|*.jpeg|*.gif|*.webp|*.mp4|*.webm|*.mov)
        size=\$(wc -c < "\$f" | tr -d ' ')
        # Reject tiny stubs (1×1 PNGs are ~70 bytes).
        if [ "\$size" -ge 2048 ]; then
          return 0
        fi
        ;;
    esac
  done
  return 1
}

started=0
if start_web_app; then
  started=1
fi

# Prefer Playwright for web — it produces human-reviewable screenshots without an agent key.
if [ "\$started" = "1" ]; then
  capture_with_playwright || true
fi

if ! has_real_media; then
  capture_with_agent || true
fi

if ! has_real_media; then
  echo "No real screenshot/video in proof/ — verify cannot hand the user proof." >&2
  ls -la proof >&2 || true
  exit 1
fi

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
