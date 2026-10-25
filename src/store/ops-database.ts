import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { alertSchema, incidentSchema, serviceSchema } from "../domain/domain.ts";

export const defaultOpsDatabasePath = fileURLToPath(
  new URL("../../data/ops-store.json", import.meta.url),
);

export const opsDatabaseSchema = z.object({
  services: z.array(serviceSchema),
  alerts: z.array(alertSchema),
  incidents: z.array(incidentSchema),
}).strict();

export type OpsDatabase = z.infer<typeof opsDatabaseSchema>;

export function parseOpsDatabase(input: unknown): OpsDatabase {
  const database = opsDatabaseSchema.parse(input);
  const serviceIds = new Set(database.services.map(({ id }) => id));
  for (const record of [...database.alerts, ...database.incidents]) {
    if (!serviceIds.has(record.serviceId)) {
      throw new Error(`Record ${record.id} references unknown service ${record.serviceId}.`);
    }
  }
  return database;
}

export function readOpsDatabase(path = defaultOpsDatabasePath): OpsDatabase {
  const content = readFileSync(path, "utf8");
  return parseOpsDatabase(JSON.parse(content) as unknown);
}
