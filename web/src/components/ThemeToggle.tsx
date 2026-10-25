import { useEffect, useState } from "react";
import type { StorageLike } from "../lib/settings.ts";
import { applyTheme, loadTheme, nextTheme, saveTheme, THEME_LABELS, type Theme } from "../lib/theme.ts";

const ICONS: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" };

export function ThemeToggle({ storage }: { storage: StorageLike | undefined }) {
  const [theme, setTheme] = useState<Theme>(() => loadTheme(storage));

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const label = `Tema: ${THEME_LABELS[theme]}`;
  return (
    <button
      type="button"
      className="button icon-button"
      aria-label={label}
      title={`${label} (clique para trocar)`}
      onClick={() => {
        const next = nextTheme(theme);
        saveTheme(next, storage);
        setTheme(next);
      }}
    >
      <span aria-hidden="true">{ICONS[theme]}</span>
    </button>
  );
}
