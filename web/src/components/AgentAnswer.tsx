import type { Metrics, TraceEvent } from "../lib/api-schemas.ts";
import { TraceToggle } from "./TraceToggle.tsx";

export function AgentAnswer({ answer, trace, metrics }: { answer: string; trace: readonly TraceEvent[]; metrics: Metrics }) {
  return (
    <>
      <div className="bubble bubble-agent">
        <span className="visually-hidden">OpsPilot: </span>
        <p className="bubble-text">{answer}</p>
      </div>
      <TraceToggle trace={trace} metrics={metrics} />
    </>
  );
}
