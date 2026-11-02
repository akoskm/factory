export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "factory.theme";

export function parseThemePreference(stored: string | null | undefined): ThemePreference {
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

export function resolveIsDark(preference: ThemePreference, systemDark: boolean): boolean {
  if (preference === "dark") return true;
  if (preference === "light") return false;
  return systemDark;
}

export function applyThemeClass(
  preference: ThemePreference,
  root: { classList: { toggle: (name: string, force: boolean) => void } },
  systemDark: boolean,
): void {
  root.classList.toggle("dark", resolveIsDark(preference, systemDark));
}

export function readThemePreference(storage: Pick<Storage, "getItem">): ThemePreference {
  try {
    return parseThemePreference(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function writeThemePreference(
  preference: ThemePreference,
  storage: Pick<Storage, "setItem">,
): void {
  storage.setItem(THEME_STORAGE_KEY, preference);
}

/** Self-contained boot script injected into index.html (see vite theme-boot plugin). */
export function createThemeBootScript(): string {
  const key = JSON.stringify(THEME_STORAGE_KEY);
  return `(function(){var k=${key};function parse(s){return s==="light"||s==="dark"||s==="system"?s:"system";}function sys(){return window.matchMedia("(prefers-color-scheme: dark)").matches;}function dark(p){return p==="dark"||(p==="system"&&sys());}function apply(){var p=parse(localStorage.getItem(k));document.documentElement.classList.toggle("dark",dark(p));}apply();window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",function(){if(parse(localStorage.getItem(k))==="system")apply();});})();`;
}

function getSystemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function getThemePreference(): ThemePreference {
  return readThemePreference(localStorage);
}

export function setThemePreference(preference: ThemePreference): void {
  writeThemePreference(preference, localStorage);
  applyThemeClass(preference, document.documentElement, getSystemDark());
  for (const listener of themeListeners) listener(preference);
}

const themeListeners = new Set<(preference: ThemePreference) => void>();

export function subscribeTheme(listener: (preference: ThemePreference) => void): () => void {
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}

let themeInitialized = false;

export function initTheme(): () => void {
  if (themeInitialized) return () => {};
  themeInitialized = true;

  applyThemeClass(getThemePreference(), document.documentElement, getSystemDark());

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => {
    if (getThemePreference() === "system") {
      applyThemeClass("system", document.documentElement, mq.matches);
      for (const listener of themeListeners) listener("system");
    }
  };
  mq.addEventListener("change", onSystemChange);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    const preference = getThemePreference();
    applyThemeClass(preference, document.documentElement, getSystemDark());
    for (const listener of themeListeners) listener(preference);
  };
  window.addEventListener("storage", onStorage);

  return () => {
    mq.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
    themeInitialized = false;
  };
}
