import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  THEME_STORAGE_KEY,
  applyThemeClass,
  createThemeBootScript,
  parseThemePreference,
  readThemePreference,
  resolveIsDark,
  writeThemePreference,
} from "./theme";

describe("parseThemePreference", () => {
  it("accepts system, light, and dark", () => {
    assert.equal(parseThemePreference("system"), "system");
    assert.equal(parseThemePreference("light"), "light");
    assert.equal(parseThemePreference("dark"), "dark");
  });

  it("falls back to system for missing or invalid values", () => {
    assert.equal(parseThemePreference(null), "system");
    assert.equal(parseThemePreference(undefined), "system");
    assert.equal(parseThemePreference(""), "system");
    assert.equal(parseThemePreference("invalid"), "system");
  });
});

describe("resolveIsDark", () => {
  it("respects explicit light and dark", () => {
    assert.equal(resolveIsDark("light", true), false);
    assert.equal(resolveIsDark("dark", false), true);
  });

  it("follows system when preference is system", () => {
    assert.equal(resolveIsDark("system", true), true);
    assert.equal(resolveIsDark("system", false), false);
  });
});

describe("applyThemeClass", () => {
  it("toggles dark on the root element", () => {
    const classes = new Set<string>();
    const root = {
      classList: {
        toggle(name: string, force: boolean) {
          if (force) classes.add(name);
          else classes.delete(name);
        },
      },
    };
    applyThemeClass("light", root, true);
    assert.equal(classes.has("dark"), false);
    applyThemeClass("dark", root, false);
    assert.equal(classes.has("dark"), true);
    applyThemeClass("system", root, true);
    assert.equal(classes.has("dark"), true);
  });
});

describe("localStorage helpers", () => {
  it("reads and writes under factory.theme", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem(key: string) {
        return store.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        store.set(key, value);
      },
    };
    assert.equal(readThemePreference(storage), "system");
    writeThemePreference("dark", storage);
    assert.equal(store.get(THEME_STORAGE_KEY), "dark");
    assert.equal(readThemePreference(storage), "dark");
  });
});

describe("createThemeBootScript", () => {
  it("references the storage key and prefers-color-scheme", () => {
    const script = createThemeBootScript();
    assert.match(script, /factory\.theme/);
    assert.match(script, /prefers-color-scheme: dark/);
  });
});
