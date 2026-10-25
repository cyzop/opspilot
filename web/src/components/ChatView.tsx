import { useEffect, useRef } from "react";
import type { ChatState } from "../lib/chat-state.ts";
import { EmptyState } from "./EmptyState.tsx";
import { TurnView, type TurnHandlers } from "./Turn.tsx";

export function ChatView({ state, busy, onExample, ...handlers }: {
  state: ChatState;
  busy: boolean;
  onExample: (question: string) => void;
} & TurnHandlers) {
  const endRef = useRef<HTMLDivElement>(null);
  const lastTurn = state.turns.at(-1);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [state.turns.length, lastTurn?.status]);

  return (
    <>
      {state.notice ? <p className="notice notice-info" role="status">{state.notice}</p> : null}
      {state.turns.length === 0 ? (
        <EmptyState onExample={onExample} disabled={busy} />
      ) : (
        <div role="log" aria-live="polite" aria-label="Conversa">
          <ol className="conversation">
            {state.turns.map((turn) => (
              <TurnView key={turn.id} turn={turn} busy={busy} {...handlers} />
            ))}
          </ol>
        </div>
      )}
      <div ref={endRef} />
    </>
  );
}
