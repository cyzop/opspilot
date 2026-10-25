import type { TraceItemView } from "../lib/trace-view.ts";

export function TraceEventItem({ item }: { item: TraceItemView }) {
  return (
    <li className={`trace-item trace-kind-${item.kind}`}>
      <div className="trace-head">
        <span aria-hidden="true">{item.icon}</span>
        <span className="trace-label">{item.label}</span>
        {item.node ? <span className="badge">etapa: {item.node}</span> : null}
      </div>
      {item.content ? <pre className="trace-content">{item.content}</pre> : null}
      {item.details.length > 0 ? (
        <dl className="details">
          {item.details.map((detail) => (
            <div key={detail.label} style={{ display: "contents" }}>
              <dt>{detail.label}</dt>
              <dd>{detail.code ? <pre>{detail.value}</pre> : detail.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}
