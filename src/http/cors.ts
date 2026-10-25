// CORS for the war room: only exact, configured origins; never `*`.
import type express from "express";
import { z } from "zod";
import { ConfigurationError } from "../domain/errors.ts";

export const DEFAULT_CORS_ORIGINS: readonly string[] = ["http://localhost:5173"];

const originSchema = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
  } catch {
    return false;
  }
});

/** Parses OPSPILOT_CORS_ORIGINS (comma-separated exact origins). */
export function parseCorsOrigins(raw: string | undefined): readonly string[] {
  const values = (raw ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) return DEFAULT_CORS_ORIGINS;
  const parsed = z.array(originSchema).safeParse(values);
  if (!parsed.success) {
    throw new ConfigurationError(
      "OPSPILOT_CORS_ORIGINS must list exact origins like http://localhost:5173 (no paths, no *).",
    );
  }
  return parsed.data;
}

export interface CorsRequest {
  origin: string | undefined;
  method: string;
  requestMethod?: string | undefined;
}

/** Headers to add for this request, or null when the origin is not allowed (pure). */
export function corsHeaders(request: CorsRequest, allowed: readonly string[]): Record<string, string> | null {
  if (!request.origin || !allowed.includes(request.origin)) return null;
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": request.origin,
    "Vary": "Origin",
    "Access-Control-Expose-Headers": "X-Request-Id",
  };
  if (request.method === "OPTIONS" && request.requestMethod) {
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}

export function corsMiddleware(allowed: readonly string[]): express.RequestHandler {
  return (req, res, next) => {
    const headers = corsHeaders({
      origin: req.get("Origin"),
      method: req.method,
      requestMethod: req.get("Access-Control-Request-Method"),
    }, allowed);
    if (headers) res.set(headers);
    // Preflights end here; without allow headers the browser blocks the real request.
    if (req.method === "OPTIONS" && req.get("Access-Control-Request-Method")) {
      res.status(204).end();
      return;
    }
    next();
  };
}
