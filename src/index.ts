import { createChatServer } from "./http/server.ts";
import { createStrategyRegistry } from "./agentes/index.ts";
import { SqliteConversationStore } from "./store/sqlite-conversation-store.ts";
import { SqliteOpsStore } from "./store/sqlite-ops-store.ts";
import { SqliteMemoryStore } from "./memory/memory-store.ts";

const port = Number(process.env.PORT ?? 3000);
const store = new SqliteOpsStore();
const conversationStore = new SqliteConversationStore();
const memoryStore = new SqliteMemoryStore();
const registry = createStrategyRegistry({ store, memoryStore });
const app = createChatServer({ registry, conversationStore, memoryStore, opsStore: store });
const server = app.listen(port, () => {
  console.log(`OpsPilot chat server listening on http://localhost:${port}`);
});

server.on("close", () => {
  store.close();
  conversationStore.close();
  memoryStore.close();
});
