import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readSidebarOpenFromCookie } from "./sidebar-state-cookie";

describe("readSidebarOpenFromCookie", () => {
  it("returns undefined when cookie is missing", () => {
    assert.equal(readSidebarOpenFromCookie(""), undefined);
    assert.equal(readSidebarOpenFromCookie("other=value"), undefined);
  });

  it("parses true and false", () => {
    assert.equal(readSidebarOpenFromCookie("sidebar_state=true"), true);
    assert.equal(readSidebarOpenFromCookie("sidebar_state=false"), false);
  });

  it("finds sidebar_state among other cookies", () => {
    assert.equal(
      readSidebarOpenFromCookie("foo=bar; sidebar_state=true; baz=qux"),
      true
    );
  });

  it("ignores invalid values", () => {
    assert.equal(readSidebarOpenFromCookie("sidebar_state=yes"), undefined);
  });
});
