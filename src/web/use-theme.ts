import { useSyncExternalStore } from "react";
import { getThemePreference, setThemePreference, subscribeTheme, type ThemePreference } from "./theme";

export function useTheme(): {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
} {
  const preference = useSyncExternalStore(
    subscribeTheme,
    getThemePreference,
    (): ThemePreference => "system",
  );
  return { preference, setPreference: setThemePreference };
}
