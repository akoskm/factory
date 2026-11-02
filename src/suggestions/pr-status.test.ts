import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parsePullRequestUrl,
  pickGithubSourceId,
  planSuggestionStatusUpdates,
  suggestionStatusForPull,
} from "./pr-status.js";

const prUrl = "https://github.com/acme/factory-config/pull/12";

describe("parsePullRequestUrl", () => {
  it("reads owner, repo, and number", () => {
    assert.deepEqual(parsePullRequestUrl(`${prUrl}/files?w=1`), {
      owner: "acme",
      repo: "factory-config",
      pullNumber: 12,
    });
    assert.equal(parsePullRequestUrl("https://github.com/acme/factory-config/issues/12"), null);
  });
});

describe("suggestionStatusForPull", () => {
  it("maps merged, closed, and open pulls", () => {
    assert.equal(suggestionStatusForPull({ state: "closed", merged_at: "2026-11-02T00:00:00Z" }), "merged");
    assert.equal(suggestionStatusForPull({ state: "closed", merged_at: null }), "closed");
    assert.equal(suggestionStatusForPull({ state: "open", merged_at: null }), "open");
  });
});

describe("pickGithubSourceId", () => {
  const sources = [
    { id: "product", owner: "acme", repo: "factory" },
    { id: "config", owner: "acme", repo: "factory-config" },
  ];

  it("uses the source for that repo, otherwise the project source", () => {
    assert.equal(
      pickGithubSourceId([{ owner: "acme", repo: "factory-config" }], sources),
      "config",
    );
    assert.equal(
      pickGithubSourceId([{ owner: "acme", repo: "other" }], [sources[0]]),
      "product",
    );
    assert.equal(pickGithubSourceId([{ owner: "acme", repo: "factory" }], []), null);
  });
});

describe("planSuggestionStatusUpdates", () => {
  it("updates every open suggestion that shares a pull, once", async () => {
    let calls = 0;
    const updates = await planSuggestionStatusUpdates(
      [
        { id: "a", status: "open", prUrl },
        { id: "b", status: "open", prUrl: `${prUrl}/` },
        { id: "c", status: "merged", prUrl },
        { id: "d", status: "open", prUrl: null },
      ],
      async () => {
        calls += 1;
        return { state: "closed", merged_at: "2026-11-02T00:00:00Z" };
      },
    );
    assert.equal(calls, 1);
    assert.deepEqual(updates, [
      { id: "a", status: "merged" },
      { id: "b", status: "merged" },
    ]);
  });

  it("leaves the stored status when the pull is still open or the read fails", async () => {
    const stillOpen = await planSuggestionStatusUpdates(
      [{ id: "a", status: "open", prUrl }],
      async () => ({ state: "open", merged_at: null }),
    );
    const failed = await planSuggestionStatusUpdates(
      [{ id: "a", status: "open", prUrl }],
      async () => {
        throw new Error("GitHub 502");
      },
    );
    assert.deepEqual(stillOpen, []);
    assert.deepEqual(failed, []);
  });
});
