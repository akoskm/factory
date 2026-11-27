import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectStackHint, renderProofWorkflow } from "./workflow-template.js";
import { parseVerifyProofConfig } from "./activities.js";

describe("detectStackHint", () => {
  it("picks macos for Xcode projects", () => {
    const hint = detectStackHint(["App.xcodeproj/project.pbxproj", "README.md"]);
    assert.equal(hint.runsOn, "macos-latest");
  });

  it("picks windows for .sln", () => {
    const hint = detectStackHint(["Tracker.sln", "src/App.cs"]);
    assert.equal(hint.runsOn, "windows-latest");
  });

  it("picks ubuntu for package.json", () => {
    const hint = detectStackHint(["package.json", "src/App.tsx"]);
    assert.equal(hint.runsOn, "ubuntu-latest");
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
