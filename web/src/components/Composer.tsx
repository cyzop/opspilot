import { useState, type FormEvent, type KeyboardEvent } from "react";

export function Composer({ busy, onSend }: { busy: boolean; onSend: (message: string) => void }) {
  const [message, setMessage] = useState("");
  const canSend = !busy && message.trim() !== "";

  const submit = () => {
    if (!canSend) return;
    onSend(message);
    setMessage("");
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form className="composer" onSubmit={onSubmit}>
      <label htmlFor="composer-input" className="composer-label">Mensagem</label>
      <div className="composer-row">
        <textarea
          id="composer-input"
          className="composer-input"
          rows={2}
          value={message}
          placeholder="Pergunte sobre alertas, incidentes ou provedores"
          aria-describedby="composer-hint"
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="button button-primary" disabled={!canSend}>
          Enviar
        </button>
      </div>
      <p id="composer-hint" className="hint">Enter envia · Shift+Enter quebra a linha</p>
    </form>
  );
}
