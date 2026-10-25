import { mkdirSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { alertFixtures, serviceFixtures } from "../store/seed-data.ts";
import {
  defaultOpsDatabasePath,
  parseOpsDatabase,
  readOpsDatabase,
  type OpsDatabase,
} from "../store/ops-database.ts";

export function seedOpsDatabaseFile(path = defaultOpsDatabasePath): {
  services: number;
  alerts: number;
  incidents: number;
} {
  const existing: OpsDatabase = existsSync(path)
    ? readOpsDatabase(path)
    : { services: [], alerts: [], incidents: [] };
  const services = new Map(existing.services.map((service) => [service.id, service]));
  const alerts = new Map(existing.alerts.map((alert) => [alert.id, alert]));

  for (const service of serviceFixtures) services.set(service.id, service);
  for (const alert of alertFixtures) alerts.set(alert.id, alert);

  const seeded = parseOpsDatabase({
    services: [...services.values()].sort((left, right) => left.id.localeCompare(right.id)),
    alerts: [...alerts.values()].sort((left, right) => left.id.localeCompare(right.id)),
    incidents: existing.incidents,
  });
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(seeded, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  renameSync(temporaryPath, path);

  return {
    services: serviceFixtures.length,
    alerts: alertFixtures.length,
    incidents: seeded.incidents.length,
  };
}
