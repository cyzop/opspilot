// Design tokens: the single source for spacing, type and colour (see .claude/rules/design.md).
// tokens.css mirrors these values; a test keeps both in sync.

export const space = [4, 8, 12, 16, 24, 32, 48, 64] as const;
export const fontSize = [12, 14, 16, 20, 24, 32] as const;
export const lineHeight = 1.5;

export const traceKinds = [
  "route", "thought", "action", "observation", "plan", "critique",
  "summarize", "fallback", "approval", "answer", "unknown",
] as const;
export type TraceKind = (typeof traceKinds)[number];

export const colorRoles = [
  "bg", "surface", "surface-raised", "text", "text-muted", "border",
  "primary", "primary-text", "danger", "warning", "success", "focus",
] as const;
export type ColorRole = (typeof colorRoles)[number];

export type Palette = Record<ColorRole, string> & Record<`trace-${TraceKind}`, string>;

export const palettes: { light: Palette; dark: Palette } = {
  light: {
    "bg": "#f6f7f9",
    "surface": "#ffffff",
    "surface-raised": "#eef1f5",
    "text": "#1a1d23",
    "text-muted": "#4f5663",
    "border": "#767d8a",
    "primary": "#1f5fbf",
    "primary-text": "#ffffff",
    "danger": "#b42318",
    "warning": "#8a5a00",
    "success": "#17712f",
    "focus": "#1f5fbf",
    "trace-route": "#6f42c1",
    "trace-thought": "#57606a",
    "trace-action": "#1f5fbf",
    "trace-observation": "#17712f",
    "trace-plan": "#8a5a00",
    "trace-critique": "#b42318",
    "trace-summarize": "#57606a",
    "trace-fallback": "#a84300",
    "trace-approval": "#8250df",
    "trace-answer": "#1a1d23",
    "trace-unknown": "#57606a",
  },
  dark: {
    "bg": "#14171c",
    "surface": "#1c2027",
    "surface-raised": "#252a33",
    "text": "#e8eaee",
    "text-muted": "#a8afbb",
    "border": "#6b7380",
    "primary": "#7cb1ff",
    "primary-text": "#0b1220",
    "danger": "#ff8a80",
    "warning": "#e3b341",
    "success": "#56d364",
    "focus": "#7cb1ff",
    "trace-route": "#b392f0",
    "trace-thought": "#9ea7b3",
    "trace-action": "#7cb1ff",
    "trace-observation": "#56d364",
    "trace-plan": "#e3b341",
    "trace-critique": "#ff8a80",
    "trace-summarize": "#9ea7b3",
    "trace-fallback": "#ffa657",
    "trace-approval": "#d2a8ff",
    "trace-answer": "#e8eaee",
    "trace-unknown": "#9ea7b3",
  },
};
