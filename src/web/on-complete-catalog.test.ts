import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { onCompleteCatalog } from "./on-complete-catalog.js";

const agents = [{ name: "monitor", description: "Suggests improvements to factory-config after a product merge." }];

describe("onCompleteCatalog", () => {
  it("lists the file order and the built-in steps it omits", () => {
    const catalog = onCompleteCatalog(["mergeProduct", "monitor"], agents);
    assert.deepEqual(
      catalog.current.map((row) => [row.name, row.kind]),
      [
        ["mergeProduct", "Built-in"],
        ["monitor", "Agent"],
      ],
    );
    assert.equal(catalog.current[1]?.summary, agents[0]?.description);
    assert.deepEqual(
      catalog.missing.map((row) => row.name),
      ["closeIssue"],
    );
    assert.equal(catalog.missing[0]?.kind, "Built-in");
  });

  it("hides a built-in step once the file includes it", () => {
    const catalog = onCompleteCatalog(["mergeProduct", "closeIssue", "monitor"], agents);
    assert.deepEqual(
      catalog.current.map((row) => row.name),
      ["mergeProduct", "closeIssue", "monitor"],
    );
    assert.deepEqual(catalog.missing, []);
  });
});
