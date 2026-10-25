import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolveBase } from "./build-config.ts";

export default defineConfig({
  plugins: [react()],
  base: resolveBase(process.env.OPSPILOT_WEB_BASE),
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
