import { z } from "zod";

/** Base usada no dev, no preview e no build local. */
export const DEFAULT_BASE = "/opspilot/";

// Começa e termina com "/", segmentos de [A-Za-z0-9._-] sem "//", espaço, "?" ou "#".
const baseSchema = z
  .string()
  .regex(/^\/([A-Za-z0-9._-]+\/)*$/)
  .refine((value) => !value.split("/").includes(".."));

/** Resolve a base do Vite a partir de OPSPILOT_WEB_BASE; ausente ou vazia → DEFAULT_BASE. */
export function resolveBase(raw: string | undefined): string {
  const value = raw?.trim() ?? "";
  if (value === "") return DEFAULT_BASE;
  const parsed = baseSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`OPSPILOT_WEB_BASE inválida: "${value}". Use algo como /opspilot/.`);
  }
  return parsed.data;
}
