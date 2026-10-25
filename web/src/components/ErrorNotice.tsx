import type { ApiError } from "../lib/api-client.ts";

export function ErrorNotice({ error, onRetry, retryLabel = "Tentar de novo", disabled = false }: {
  error: ApiError;
  onRetry?: () => void;
  retryLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div className="notice notice-error" role="alert">
      <p className="notice-title">
        <span aria-hidden="true">⚠ </span>
        {error.message}
      </p>
      {error.requestId ? (
        <p className="notice-meta">
          ID do request: <code>{error.requestId}</code>
        </p>
      ) : null}
      {onRetry ? (
        <button type="button" className="button button-secondary" onClick={onRetry} disabled={disabled}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
