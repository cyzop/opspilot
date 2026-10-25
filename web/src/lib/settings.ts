// API address settings, kept in this browser. Storage may be missing or throw (private mode).
import { z } from "zod";

export const DEFAULT_API_URL = "http://localhost:3000";
export const API_URL_KEY = "opspilot.apiUrl";
export const INVALID_URL_MESSAGE = "Informe uma URL http ou https completa, como http://localhost:3000.";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function browserStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

export type UrlValidation = { ok: true; url: string } | { ok: false; message: string };

const absoluteUrl = z.url({ protocol: /^https?$/ });

export function validateApiUrl(raw: string): UrlValidation {
  const value = raw.trim();
  if (!absoluteUrl.safeParse(value).success) return { ok: false, message: INVALID_URL_MESSAGE };
  const url = new URL(value);
  if (url.username || url.password) return { ok: false, message: "A URL não pode conter usuário ou senha." };
  if (url.search || url.hash || value.includes("?") || value.includes("#")) {
    return { ok: false, message: "A URL não pode ter parâmetros (?) nem âncora (#)." };
  }
  return { ok: true, url: `${url.origin}${url.pathname.replace(/\/+$/, "")}` };
}

export function loadApiUrl(storage: StorageLike | undefined = browserStorage()): string {
  try {
    const saved = storage?.getItem(API_URL_KEY);
    if (saved) {
      const valid = validateApiUrl(saved);
      if (valid.ok) return valid.url;
    }
  } catch {
    // Storage blocked: fall back to the default.
  }
  return DEFAULT_API_URL;
}

/** Returns false when the browser refused to store the value (it still applies for this session). */
export function saveApiUrl(url: string, storage: StorageLike | undefined = browserStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(API_URL_KEY, url);
    return true;
  } catch {
    return false;
  }
}
