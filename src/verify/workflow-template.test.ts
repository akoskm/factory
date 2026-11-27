import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectStackHint,
  renderProofWorkflow,
  renderRecordProofScript,
} from "./workflow-template.js";
import { parseVerifyProofConfig } from "./activities.js";

describe("detectStackHint", () => {
  it("picks macos + native recorder for Xcode projects", () => {
    const hint = detectStackHint(["App.xcodeproj/project.pbxproj", "README.md"]);
    assert.equal(hint.runsOn, "macos-latest");
    assert.equal(hint.recorder, "native");
    assert.match(hint.startHint, /XCUITest|Maestro/i);
  });

  it("picks macos + native recorder for Maestro flows", () => {
    const hint = detectStackHint(["maestro/login.yaml", "README.md"]);
    assert.equal(hint.runsOn, "macos-latest");
    assert.equal(hint.recorder, "native");
  });

  it("picks windows + native recorder for .sln", () => {
    const hint = detectStackHint(["Tracker.sln", "src/App.cs"]);
    assert.equal(hint.runsOn, "windows-latest");
    assert.equal(hint.recorder, "native");
  });

  it("picks ubuntu + web recorder for package.json", () => {
    const hint = detectStackHint(["package.json", "src/App.tsx"]);
    assert.equal(hint.runsOn, "ubuntu-latest");
    assert.equal(hint.recorder, "web");
  });

  it("defaults to native recorder when stack is unknown", () => {
    const hint = detectStackHint(["README.md", "Makefile"]);
    assert.equal(hint.recorder, "native");
  });
});

describe("renderRecordProofScript", () => {
  it("web recorder mentions Playwright; native does not", () => {
    const web = renderRecordProofScript("start web", "web");
    const native = renderRecordProofScript("start ios", "native");
    assert.match(web, /playwright/i);
    assert.match(web, /start_web_app/);
    assert.match(web, /is_next/);
    assert.match(web, /pkg_has_script/);
    assert.doesNotMatch(web, /preview --dry-run/);
    assert.doesNotMatch(native, /playwright/i);
    assert.doesNotMatch(native, /start_web_app/);
    assert.match(native, /Replace this script/i);
  });
});

describe("renderProofWorkflow", () => {
  it("includes the four contract inputs plus upload_token", () => {
    const yml = renderProofWorkflow({
      workflowFileName: "factory-proof.yml",
      runsOn: "ubuntu-latest",
      startHint: "start the app",
    });
    for (const key of ["sha", "scenario", "pr_number", "upload_url", "upload_token"]) {
      assert.match(yml, new RegExp(key));
    }
    assert.match(yml, /runs-on: ubuntu-latest/);
    assert.match(yml, /continue-on-error: true/);
  });
});

describe("parseVerifyProofConfig", () => {
  it("defaults the workflow name", () => {
    assert.deepEqual(parseVerifyProofConfig({}), { workflow: "factory-proof.yml" });
  });

  it("reads verify.proof.workflow", () => {
    assert.deepEqual(
      parseVerifyProofConfig({
        verify: { proof: { workflow: ".github/workflows/my-proof.yml" } },
      }),
      { workflow: "my-proof.yml" },
    );
  });
});
