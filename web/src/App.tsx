import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import { ChatView } from "./components/ChatView.tsx";
import { Composer } from "./components/Composer.tsx";
import { SettingsDialog } from "./components/SettingsDialog.tsx";
import { ThemeToggle } from "./components/ThemeToggle.tsx";
import { createApiClient, type ApiClient } from "./lib/api-client.ts";
import { chatReducer, initialChatState, isBusy } from "./lib/chat-state.ts";
import { browserStorage, loadApiUrl, saveApiUrl, type StorageLike } from "./lib/settings.ts";

export interface AppProps {
  /** Injected for tests; defaults to the browser fetch. */
  fetch?: typeof globalThis.fetch;
  /** Injected for tests; defaults to localStorage (may be unavailable). */
  storage?: StorageLike | undefined;
}

const defaultFetch: typeof globalThis.fetch = (...args) => globalThis.fetch(...args);

export function App({ fetch = defaultFetch, storage = browserStorage() }: AppProps) {
  const [apiUrl, setApiUrl] = useState(() => loadApiUrl(storage));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const gear = useRef<HTMLButtonElement>(null);
  const client: ApiClient = useMemo(() => createApiClient({ baseUrl: apiUrl, fetch }), [apiUrl, fetch]);
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const nextId = useRef(0);
  const busy = isBusy(state);

  const run = useCallback(async (turnId: string, message: string, conversationId: string | null) => {
    const result = await client.chat({ message, conversationId });
    if (!result.ok) dispatch({ type: "failed", id: turnId, error: result.error });
    else if (result.kind === "answer") dispatch({ type: "answered", id: turnId, body: result.body });
    else dispatch({ type: "awaitingApproval", id: turnId, body: result.body });
  }, [client]);

  const send = (message: string) => {
    if (busy || message.trim() === "") return;
    nextId.current += 1;
    const turnId = `turn-${nextId.current}`;
    dispatch({ type: "send", id: turnId, message });
    void run(turnId, message.trim(), state.conversationId);
  };

  const retry = (turnId: string) => {
    const turn = state.turns.find(({ id }) => id === turnId);
    if (!turn || turn.status !== "failed" || busy) return;
    dispatch({ type: "retry", id: turnId });
    void run(turnId, turn.message, state.conversationId);
  };

  const decide = (turnId: string, approvalId: string, decision: "approve" | "deny") => {
    if (busy) return;
    dispatch({ type: "decisionSent", id: turnId });
    void client.decide(approvalId, decision).then((result) => {
      if (!result.ok) dispatch({ type: "decisionFailed", id: turnId, error: result.error });
      else if (result.kind === "decided") dispatch({ type: "decided", id: turnId, body: result.body });
      else dispatch({ type: "decisionRefused", id: turnId, ...(result.approval ? { approval: result.approval } : {}) });
    });
  };

  const closeSettings = () => {
    setSettingsOpen(false);
    gear.current?.focus();
  };

  const saveSettings = (url: string) => {
    // A refused write still applies for this session.
    saveApiUrl(url, storage);
    if (url !== apiUrl) {
      setApiUrl(url);
      dispatch({ type: "apiChanged" });
    }
    closeSettings();
  };

  const testUrl = (url: string) => createApiClient({ baseUrl: url, fetch, timeoutMs: 10_000 }).testConnection();

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">War Room</h1>
        <div className="header-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={busy || state.turns.length === 0}
            onClick={() => dispatch({ type: "newConversation" })}
          >
            Nova conversa
          </button>
          <ThemeToggle storage={storage} />
          <button
            ref={gear}
            type="button"
            className="button icon-button"
            aria-label="Configurações"
            aria-haspopup="dialog"
            title={`API: ${apiUrl}`}
            onClick={() => setSettingsOpen(true)}
          >
            <span aria-hidden="true">⚙</span>
          </button>
        </div>
      </header>
      <main className="app-main">
        <ChatView state={state} busy={busy} onExample={send} onRetry={retry} onDecide={decide} />
      </main>
      <footer className="app-footer">
        <Composer busy={busy} onSend={send} />
      </footer>
      <SettingsDialog open={settingsOpen} apiUrl={apiUrl} onCancel={closeSettings} onSave={saveSettings} onTest={testUrl} />
    </div>
  );
}
