// Prints tokens.css from tokens.ts: `node --import tsx src/styles/generate-tokens-css.ts > src/styles/tokens.css`.
import { fontSize, lineHeight, palettes, space, type Palette } from "./tokens.ts";

const colors = (palette: Palette, indent: string) =>
  Object.entries(palette).map(([role, value]) => `${indent}--color-${role}: ${value};`).join("\n");

export function tokensCss(): string {
  return `/* Generated from tokens.ts by generate-tokens-css.ts — do not edit by hand. */
:root {
${space.map((value, index) => `  --space-${index + 1}: ${value}px;`).join("\n")}
${fontSize.map((value, index) => `  --font-${index + 1}: ${value}px;`).join("\n")}
  --line-height: ${lineHeight};
  --radius: var(--space-2);
  color-scheme: light;
${colors(palettes.light, "  ")}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
${colors(palettes.dark, "    ")}
  }
}

:root[data-theme="dark"] {
  color-scheme: dark;
${colors(palettes.dark, "  ")}
}

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: var(--font-3);
  line-height: var(--line-height);
}

:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;
}

if (process.argv[1]?.endsWith("generate-tokens-css.ts")) process.stdout.write(tokensCss());
