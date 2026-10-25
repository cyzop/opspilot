// Theme choice. "system" leaves `data-theme` unset, so the CSS follows prefers-color-scheme live.
import type { StorageLike } from "./settings.ts";

export type Theme = "system" | "light" | "dark";

export const THEME_KEY = "opspilot.theme";
export const THEME_LABELS: Record<Theme, string> = { system: "sistema", light: "claro", dark: "escuro" };

const ORDER: readonly Theme[] = ["system", "light", "dark"];

export const nextTheme = (theme: Theme): Theme => ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] ?? "system";

const isTheme = (value: unknown): value is Theme => ORDER.includes(value as Theme);

export function loadTheme(storage: StorageLike | undefined): Theme {
  try {
    const saved = storage?.getItem(THEME_KEY);
    return isTheme(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

export function saveTheme(theme: Theme, storage: StorageLike | undefined): void {
  try {
    storage?.setItem(THEME_KEY, theme);
  } catch {
    // Storage blocked: the choice still applies for this session.
  }
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}
