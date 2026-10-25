import { pathToFileURL } from "node:url";
import { seedOpsDatabaseFile } from "../src/db/json-seed.ts";

export function runSeed(): void {
  const counts = seedOpsDatabaseFile();
  process.stdout.write(
    `JSON seed complete: ${counts.services} services, ${counts.alerts} alerts, ${counts.incidents} incidents.\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runSeed();
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unexpected seed error occurred.";
    process.stderr.write(`Seed failed: ${message}\n`);
    process.exitCode = 1;
  }
}
