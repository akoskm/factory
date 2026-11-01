import assert from "node:assert/strict";
import test from "node:test";
import { redactSecrets } from "./redact.js";

const token = "github_pat_EXAMPLE_SECRETVALUE";

test("redacts git credentials from command failures", () => {
  const raw = [
    `Command failed: git clone --depth 50 https://x-access-token:${token}@github.com/acme/factory-config workspaces/run-1`,
    "remote: Write access to repository not granted.",
    "fatal: unable to access 'https://github.com/acme/factory-config/': The requested URL returned error: 403",
  ].join("\n");
  const clean = redactSecrets(raw);
  assert.equal(clean.includes(token), false);
  assert.equal(clean.includes("SECRETVALUE"), false);
  assert.match(clean, /https:\/\/x-access-token:\[redacted\]@github\.com\/acme\/factory-config/);
  assert.match(clean, /Write access to repository not granted/);
  assert.match(clean, /The requested URL returned error: 403/);
  assert.equal(redactSecrets("token ghp_abc123xyz").includes("ghp_"), false);
  assert.equal(
    redactSecrets("Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==").includes("QWxh"),
    false,
  );
});
