# Quickstart: History Summarization

## Prerequisites

- Node.js 22 LTS, `npm install` done.
- Live runs only: OpenRouter variables configured in `.env` (loaded by npm scripts; do not
  print it). Automated tests never call a model.

## 1. Automated validation (fake summarizer)

```bash
npm run typecheck
npm test
```

Expected new coverage (see [data-model.md](./data-model.md)):

- `tests/context/conversation-history.test.ts` — `planHistory` threshold/window; service
  with a fake summarizer: no call below 8 pending, first call at 8, merge input includes the
  previous summary, no call on the following turn, failure keeps the previous summary,
  > 302-token output rejected, secrets redacted before and after.
- `tests/store/sqlite-conversation-store.test.ts` — `conversation_summaries` persistence,
  `messagesAfter`, conditional upsert (lesser/equal coverage rejected), survives a new store
  instance on the same file, cascade on conversation delete.
- `tests/http/compose-chat-prompt.test.ts` — summary section order and breakdown `summary`.
- `tests/http/server.test.ts` — `summarize` trace event on the threshold turn only,
  `contextBreakdown.summary`, failure turn still 200.

## 2. Live check

```bash
npm run dev
TURNS=20 npm run conversa-longa
```

Expected (see [contracts/chat-summarization.md](./contracts/chat-summarization.md)):
turns 9, 13 and 17 take one extra summarization call; from turn 9 on, `history` stays
bounded (8–15 messages) and a `summary` estimate around 151 tokens appears in the breakdown.
To see the event:

```bash
curl -s localhost:3000/chat -X POST -H "Content-Type: application/json" \
  -d '{"message":"o que ficou pendente?","conversationId":"<id>"}' \
  | jq '.trace[0], .metrics.contextBreakdown'
```

The persisted summary can be inspected in the SQLite DB (`OPSPILOT_DB`, default
`./data/opspilot.db`), table `conversation_summaries`.
