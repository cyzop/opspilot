import type { TestContext } from "node:test";
import { setLogWriter } from "../../src/obs/logger.ts";

/** Collects JSON log lines for the duration of a test. */
export function captureLogs(context: TestContext) {
  const lines: string[] = [];
  context.after(setLogWriter((line) => lines.push(line)));
  const events = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return {
    lines,
    events,
    named: (event: string) => events().filter((line) => line.event === event),
  };
}
