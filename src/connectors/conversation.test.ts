import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatConversation,
  isCodeAgent,
  loadWorkItemConversation,
  postsOnPullRequest,
  type ThreadComment,
} from "./conversation.js";

describe("postsOnPullRequest", () => {
  it("puts implement, review, and verify on the pull request", () => {
    for (const agentName of ["implement", "review", "verify"]) {
      assert.equal(
        postsOnPullRequest({ agentName, agentType: "CUSTOM", prNumber: 40 }),
        true,
      );
    }
  });

  it("keeps spec, coordination, and learn on the issue", () => {
    for (const agentName of ["foreman", "triage", "spec", "monitor"]) {
      assert.equal(
        postsOnPullRequest({ agentName, agentType: "CUSTOM", prNumber: 40 }),
        false,
      );
    }
    assert.equal(
      postsOnPullRequest({ agentName: "review", agentType: "REVIEW", prNumber: 40, learn: true }),
      false,
    );
  });

  it("stays on the issue until a pull request exists", () => {
    assert.equal(
      postsOnPullRequest({ agentName: "implement", agentType: "IMPLEMENT", prNumber: null }),
      false,
    );
  });

  it("follows agent type when the name is custom", () => {
    assert.equal(isCodeAgent("checker", "VERIFY"), true);
    assert.equal(
      postsOnPullRequest({ agentName: "checker", agentType: "verify", prNumber: 9 }),
      true,
    );
  });
});

describe("formatConversation", () => {
  const issue: ThreadComment[] = [
    { createdAt: "2026-11-06T10:00:00Z", author: "factory", body: "Factory `spec` finished." },
  ];
  const pr: ThreadComment[] = [
    { createdAt: "2026-11-06T09:00:00Z", author: "factory", body: "Factory `implement` finished." },
    { createdAt: "2026-11-06T11:00:00Z", author: "factory", body: "Factory `review` finished." },
  ];

  it("merges the issue and the pull request in time order", () => {
    const text = formatConversation({
      issueNumber: "12",
      prNumber: 40,
      issueComments: issue,
      prComments: pr,
    });
    const implement = text.indexOf("implement");
    const spec = text.indexOf("`spec`");
    const review = text.indexOf("`review`");
    assert.ok(implement < spec && spec < review);
    assert.match(text, /pull request #40/);
    assert.match(text, /issue #12/);
  });

  it("drops the oldest comments when the thread exceeds the cap", () => {
    const text = formatConversation({
      issueNumber: "12",
      prNumber: 40,
      issueComments: issue,
      prComments: pr,
      maxChars: 180,
    });
    assert.doesNotMatch(text, /implement/);
    assert.match(text, /review/);
  });

  it("is empty when there are no comments", () => {
    assert.equal(
      formatConversation({ issueNumber: "1", prNumber: null, issueComments: [], prComments: [] }),
      "",
    );
  });
});

describe("loadWorkItemConversation", () => {
  it("keeps the issue thread when the pull request listing fails", async () => {
    const text = await loadWorkItemConversation({
      issueNumber: "12",
      prNumber: 40,
      listComments: async (number) => {
        if (number === 40) throw new Error("unavailable");
        return [{ createdAt: "2026-11-06T10:00:00Z", author: "factory", body: "spec note" }];
      },
    });
    assert.match(text, /spec note/);
    assert.doesNotMatch(text, /pull request #40 —/);
  });
});
