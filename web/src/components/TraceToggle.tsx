import { useId, useState } from "react";
import type { Metrics, TraceEvent } from "../lib/api-schemas.ts";
import { toTraceItem } from "../lib/trace-view.ts";
import { MetricsSummary } from "./MetricsSummary.tsx";
import { TraceEventItem } from "./TraceEventItem.tsx";

export function TraceList({ trace }: { trace: readonly TraceEvent[] }) {
  if (trace.length === 0) return <p className="muted">Nenhuma etapa de raciocínio registrada.</p>;
  return (
    <ol className="trace-list" aria-label="Etapas do raciocínio">
      {trace.map((event, index) => {
        const item = toTraceItem(event, index);
        return <TraceEventItem key={item.key} item={item} />;
      })}
    </ol>
  );
}

export function TraceToggle({ trace, metrics }: { trace: readonly TraceEvent[]; metrics: Metrics }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <>
      <button
        type="button"
        className="trace-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">{open ? "▾ " : "▸ "}</span>
        Ver raciocínio
      </button>
      <div id={panelId} className="trace-panel" hidden={!open}>
        {open ? (
          <>
            <MetricsSummary metrics={metrics} />
            <TraceList trace={trace} />
          </>
        ) : null}
      </div>
    </>
  );
}
