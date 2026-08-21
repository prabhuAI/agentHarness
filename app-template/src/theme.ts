import type { DesignConfig } from "./product-config.js";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "agent-cofounder:theme";
const PREFERENCES: ThemePreference[] = ["system", "light", "dark"];
const DARK_QUERY = "(prefers-color-scheme: dark)";

const safeStorage = (): Storage | undefined =>
  typeof window === "undefined" ? undefined : window.localStorage;

export const isThemePreference = (value: unknown): value is ThemePreference =>
  value === "system" || value === "light" || value === "dark";

export function loadThemePreference(storage: Storage | undefined = safeStorage()): ThemePreference {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function saveThemePreference(preference: ThemePreference, storage: Storage | undefined = safeStorage()): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Persisting the preference is best-effort; the app stays usable without it.
  }
}

/** Cycles system → light → dark → system for a single-button toggle. */
export const nextPreference = (current: ThemePreference): ThemePreference =>
  PREFERENCES[(PREFERENCES.indexOf(current) + 1) % PREFERENCES.length];

export const systemPrefersDark = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(DARK_QUERY).matches;

export function watchSystemTheme(onChange: (prefersDark: boolean) => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(DARK_QUERY);
  const handler = (event: MediaQueryListEvent) => onChange(event.matches);
  query.addEventListener("change", handler);
  return () => query.removeEventListener("change", handler);
}

export const resolveTheme = (preference: ThemePreference, prefersDark = systemPrefersDark()): ResolvedTheme =>
  preference === "system" ? (prefersDark ? "dark" : "light") : preference;

export const themeLabel = (preference: ThemePreference, resolved: ResolvedTheme): string =>
  preference === "system" ? `System (${resolved})` : preference[0].toUpperCase() + preference.slice(1);

/**
 * Neutral dark surfaces that pair with any compiled brand accent. Only the brand
 * colours (accent, accentText) carry over from the light design; surfaces, ink,
 * borders, and topbar are replaced with a tuned dark ramp so contrast stays legible
 * regardless of the product the compiler produced.
 */
export const darkColors = (design: DesignConfig): DesignConfig["colors"] => ({
  canvas: "#0d1117",
  surface: "#161b22",
  surfaceAlt: "#20262e",
  ink: "#e6edf3",
  muted: "#9aa4b2",
  border: "#2b323c",
  accent: design.colors.accent,
  accentText: design.colors.accentText,
  topbar: "#0a0e14",
  topbarText: "#e6edf3",
  danger: "#ff8a80",
});

export const paletteFor = (design: DesignConfig, theme: ResolvedTheme): DesignConfig["colors"] =>
  theme === "dark" ? darkColors(design) : design.colors;
