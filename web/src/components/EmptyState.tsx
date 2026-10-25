export const EXAMPLE_QUESTIONS = [
  "Quais alertas estão ativos?",
  "Liste os incidentes abertos",
  "Qual o status dos provedores?",
] as const;

export function EmptyState({ onExample, disabled }: { onExample: (question: string) => void; disabled: boolean }) {
  return (
    <section className="empty-state" aria-labelledby="empty-title">
      <h2 id="empty-title" className="empty-title">Pronto para o plantão</h2>
      <p className="muted">
        Pergunte ao OpsPilot sobre alertas, incidentes, runbooks e provedores. Cada resposta mostra o raciocínio que a sustenta.
      </p>
      <ul className="examples" aria-label="Exemplos de perguntas">
        {EXAMPLE_QUESTIONS.map((question) => (
          <li key={question}>
            <button type="button" className="button button-secondary" disabled={disabled} onClick={() => onExample(question)}>
              {question}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
