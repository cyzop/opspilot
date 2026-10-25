import { z } from "zod";

// Leaf module (no project imports) so the logger and stores can use routes without cycles.
export const ROUTES = ["react", "plan-and-execute", "reflection"] as const;
export const routeSchema = z.enum(ROUTES);
export type Route = z.infer<typeof routeSchema>;
