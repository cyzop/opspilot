import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { ConnectionResult } from "../lib/api-client.ts";
import { validateApiUrl } from "../lib/settings.ts";

type TestState = { kind: "idle" } | { kind: "testing" } | { kind: "done"; result: ConnectionResult };

export interface SettingsDialogProps {
  open: boolean;
  apiUrl: string;
  onCancel: () => void;
  onSave: (url: string) => void;
  /** Tests a draft URL without saving it. */
  onTest: (url: string) => Promise<ConnectionResult>;
}

export function SettingsDialog({ open, apiUrl, onCancel, onSave, onTest }: SettingsDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(apiUrl);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const titleId = useId();
  const inputId = useId();
  const errorId = useId();
  const hintId = useId();

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      setDraft(apiUrl);
      setError(null);
      setTest({ kind: "idle" });
      node.showModal();
    } else if (!open && node.open) {
      node.close();
    }
  }, [open, apiUrl]);

  const validate = (): string | null => {
    const result = validateApiUrl(draft);
    setError(result.ok ? null : result.message);
    return result.ok ? result.url : null;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const url = validate();
    if (url) onSave(url);
  };

  const runTest = async () => {
    const url = validate();
    if (!url) return;
    setTest({ kind: "testing" });
    setTest({ kind: "done", result: await onTest(url) });
  };

  return (
    // `close` fires for Esc and for close(); the parent decides whether it was a cancel.
    <dialog ref={dialog} className="dialog" aria-labelledby={titleId} onClose={() => { if (open) onCancel(); }}>
      <form onSubmit={submit} noValidate>
        <h2 id={titleId} className="dialog-title">Configurações</h2>
        <div className="field">
          <label htmlFor={inputId}>URL da API</label>
          <input
            id={inputId}
            type="url"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            value={draft}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${errorId} ${hintId}` : hintId}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
              setTest({ kind: "idle" });
            }}
          />
          {error ? <p id={errorId} className="field-error">{error}</p> : null}
          <p id={hintId} className="hint">Endereço onde o OpsPilot responde, como http://localhost:3000. Fica salvo neste navegador.</p>
        </div>
        <p className="connection-status" role="status">
          {test.kind === "testing" ? "Testando conexão…" : null}
          {test.kind === "done" && test.result.ok ? (
            <span className="connection-ok"><span aria-hidden="true">✔ </span>Conectado</span>
          ) : null}
          {test.kind === "done" && !test.result.ok ? (
            <span className="connection-failed"><span aria-hidden="true">✖ </span>{test.result.message}</span>
          ) : null}
        </p>
        <div className="dialog-actions">
          <button type="button" className="button" disabled={test.kind === "testing"} onClick={() => void runTest()}>
            Testar conexão
          </button>
          <button type="button" className="button" onClick={onCancel}>Cancelar</button>
          <button type="submit" className="button button-primary">Salvar</button>
        </div>
      </form>
    </dialog>
  );
}
