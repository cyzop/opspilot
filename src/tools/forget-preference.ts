import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { memoryUserIdSchema } from "../domain/domain.ts";
import type { MemoryStore } from "../memory/memory-store.ts";

const forgetPreferenceInputSchema = z.object({
  userId: memoryUserIdSchema.describe("Identidade do usuário atual para a preferência a ser apagada."),
  preference: z.string().trim().min(1).describe("Descrição da preferência ou contexto aprendido para procurar."),
}).strict();

export function createForgetPreferenceTool(memoryStore?: MemoryStore) {
  return tool(async ({ userId, preference }) => {
    if (!memoryStore) {
      return JSON.stringify({
        deleted: false,
        message: "Semantic memory is not configured for forget_preference.",
      });
    }

    const matches = await memoryStore.recall(userId, preference, 10);
    if (matches.length === 0) {
      return JSON.stringify({
        deleted: false,
        message: `No learned preference matched "${preference}" for this user.`,
      });
    }

    if (matches.length > 1) {
      return JSON.stringify({
        deleted: false,
        message: `Multiple learned preferences matched "${preference}" for this user; please clarify which one to forget.`,
        matches: matches.map(({ memory }) => memory.fact),
      });
    }

    const match = matches[0];
    const deleted = memoryStore.forget(userId, match.memory.id);
    return JSON.stringify({
      deleted,
      message: deleted ? `Forgot preference: ${match.memory.fact}` : `Failed to forget preference: ${match.memory.fact}`,
    });
  }, {
    name: "forget_preference",
    description: "Remove one learned user preference only when it matches exactly one memory for the current user. If there is no match or more than one match, do not delete anything and ask for clarification.",
    schema: forgetPreferenceInputSchema,
  });
}
