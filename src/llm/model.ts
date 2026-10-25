import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { Runnable, RunnableLambda, type RunnableConfig } from "@langchain/core/runnables";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { ConfigurationError, ModelUnavailableError } from "../domain/errors.ts";
import { sanitizeTraceText } from "../trace/trace.ts";
import { classifyModelError } from "./model-errors.ts";
import { reportModelFallback } from "./model-events.ts";
import { logEvent } from "../obs/logger.ts";

export interface OpenRouterEnvironment {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_MODEL_FALLBACK?: string;
}

export interface ModelSettings {
  readonly apiKey: string;
  readonly primary: string;
  readonly reserve: string | null;
  readonly reserveIgnored: "same-as-primary" | null;
}

/** Attempts per model (primary and reserve): 1 call + 1 retry. */
export const DEFAULT_MODEL_ATTEMPTS = 2;
export const MODEL_UNAVAILABLE_MESSAGE = "Language models are unavailable; try again later.";
const UNCONFIGURED = "unconfigured";
const MAX_REASON = 300;

const trimmed = z.string().optional().transform((value) => value?.trim() ?? "");
const envSchema = z.object({
  OPENROUTER_API_KEY: trimmed,
  OPENROUTER_MODEL: trimmed,
  OPENROUTER_MODEL_FALLBACK: trimmed,
});

export function readModelSettings(
  env: OpenRouterEnvironment = process.env,
  options: { lenient?: boolean } = {},
): ModelSettings {
  const parsed = envSchema.parse({
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
    OPENROUTER_MODEL: env.OPENROUTER_MODEL,
    OPENROUTER_MODEL_FALLBACK: env.OPENROUTER_MODEL_FALLBACK,
  });
  const apiKey = parsed.OPENROUTER_API_KEY;
  const primary = parsed.OPENROUTER_MODEL;
  if ((!apiKey || !primary) && !options.lenient) {
    throw new ConfigurationError(
      "OPENROUTER_API_KEY and OPENROUTER_MODEL must both be configured before using an agent.",
    );
  }
  const fallback = parsed.OPENROUTER_MODEL_FALLBACK;
  const sameAsPrimary = fallback !== "" && fallback === primary;
  return {
    apiKey,
    primary: primary || UNCONFIGURED,
    reserve: fallback === "" || sameAsPrimary ? null : fallback,
    reserveIgnored: sameAsPrimary ? "same-as-primary" : null,
  };
}

/** One line for the chat server startup log. */
export function describeModelFallback(settings: ModelSettings): string {
  if (settings.reserve) return `Model fallback enabled: ${settings.primary} → ${settings.reserve}`;
  if (settings.reserveIgnored) return "Model fallback ignored: OPENROUTER_MODEL_FALLBACK equals OPENROUTER_MODEL";
  return `Model fallback not configured: retries only on ${settings.primary}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Build<I, O> = (model: BaseChatModel) => Runnable<I, O>;

interface ResilientFields {
  primaryModel: BaseChatModel;
  primaryName: string;
  reserveModel?: BaseChatModel;
  reserveName?: string;
  attempts: number;
}

/** Runs a per-call chain through ResilientChatModel (used for bindTools / withStructuredOutput). */
class ResilientRunnable<I, O> extends Runnable<I, O> {
  lc_namespace = ["opspilot", "llm"];

  constructor(private readonly owner: ResilientChatModel, private readonly build: Build<I, O>) {
    super();
  }

  override invoke(input: I, options?: Partial<RunnableConfig>): Promise<O> {
    return this.owner.runResilient(this.build, input, options);
  }
}

/**
 * Chat model that, for every call, runs
 * `build(primary).withRetry({ stopAfterAttempt }).withFallbacks([build(reserve).withRetry(...)])`.
 * Applying the chain per call (after bindTools / withStructuredOutput) keeps each model's own
 * tool and structured-output support, which a plain RunnableWithFallbacks would lose.
 */
export class ResilientChatModel extends BaseChatModel {
  readonly primaryModel: BaseChatModel;
  readonly reserveModel: BaseChatModel | undefined;
  readonly primaryName: string;
  readonly reserveName: string | undefined;
  readonly attempts: number;

  constructor(fields: ResilientFields) {
    super({});
    this.primaryModel = fields.primaryModel;
    this.reserveModel = fields.reserveModel;
    this.primaryName = fields.primaryName;
    this.reserveName = fields.reserveName;
    this.attempts = fields.attempts;
  }

  _llmType(): string {
    return "resilient";
  }

  private retrying<I, O>(build: Build<I, O>, model: BaseChatModel, onError: (error: unknown) => void) {
    return build(model).withRetry({
      stopAfterAttempt: this.attempts,
      onFailedAttempt: (error: unknown) => {
        onError(error);
        // Throwing here stops retrying this model (permanent errors, budget, aborts).
        if (classifyModelError(error) !== "transient") throw error;
      },
    });
  }

  async runResilient<I, O>(build: Build<I, O>, input: I, config?: Partial<RunnableConfig>): Promise<O> {
    let primaryError: unknown;
    let primaryAttempts = 0;
    let reserveError: unknown;
    const primary = this.retrying(build, this.primaryModel, (error) => {
      primaryError = error;
      primaryAttempts += 1;
    });
    const reserveModel = this.reserveModel;
    const reserveName = this.reserveName;
    const chain = reserveModel && reserveName
      ? primary.withFallbacks([RunnableLambda.from(async (fallbackInput: I, fallbackConfig?: RunnableConfig) => {
        if (classifyModelError(primaryError) === "abort") throw primaryError;
        const reason = sanitizeTraceText(
          `Primary failed after ${primaryAttempts} attempt${primaryAttempts === 1 ? "" : "s"}: ${errorText(primaryError)}`,
        ).slice(0, MAX_REASON);
        reportModelFallback({ primaryModel: this.primaryName, reserveModel: reserveName, reason });
        logEvent("warn", "model_fallback", { primaryModel: this.primaryName, reserveModel: reserveName });
        return this.retrying(build, reserveModel, (error) => { reserveError = error; })
          .invoke(fallbackInput, fallbackConfig);
      })])
      : primary;
    try {
      return await chain.invoke(input, config);
    } catch (error) {
      // withFallbacks rethrows the primary error; a budget/abort error on the reserve still wins.
      if (classifyModelError(reserveError) === "abort" && reserveError !== undefined) throw reserveError;
      if (classifyModelError(error) === "abort") throw error;
      throw new ModelUnavailableError(MODEL_UNAVAILABLE_MESSAGE, { cause: error });
    }
  }

  override invoke(
    input: BaseLanguageModelInput,
    options?: Partial<BaseChatModelCallOptions>,
  ): Promise<AIMessageChunk> {
    return this.runResilient(
      (model) => model as unknown as Runnable<BaseLanguageModelInput, AIMessageChunk>,
      input,
      options,
    );
  }

  override bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<BaseChatModelCallOptions>,
  ): Runnable<BaseLanguageModelInput, AIMessageChunk, BaseChatModelCallOptions> {
    return new ResilientRunnable<BaseLanguageModelInput, AIMessageChunk>(this, (model) => {
      if (!model.bindTools) throw new ConfigurationError(`Model ${model._llmType()} does not support tools.`);
      return model.bindTools(tools, kwargs) as Runnable<BaseLanguageModelInput, AIMessageChunk>;
    });
  }

  // Overloads of BaseChatModel.withStructuredOutput all accept (schema, config?).
  override withStructuredOutput(outputSchema: any, config?: any): Runnable<BaseLanguageModelInput, any> {
    return new ResilientRunnable(this, (model) => model.withStructuredOutput(outputSchema, config));
  }

  // Safety net for code paths that call generate() directly.
  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
  ): Promise<ChatResult> {
    const message = await this.runResilient(
      (model) => model as unknown as Runnable<BaseMessage[], AIMessageChunk>,
      messages,
      options,
    );
    const text = typeof message.content === "string" ? message.content : "";
    return { generations: [{ text, message }] };
  }
}

export interface CreateModelOptions {
  /** Attempts per model (default 2). */
  readonly attempts?: number;
  /** Test seam: builds the underlying chat model for a model id. */
  readonly buildChatModel?: (model: string, apiKey: string) => BaseChatModel;
}

function openRouterChatModel(model: string, apiKey: string): BaseChatModel {
  return new ChatOpenAI({
    model,
    apiKey,
    configuration: { baseURL: "https://openrouter.ai/api/v1" },
    temperature: 0,
    // Retries are handled once, by ResilientChatModel.
    maxRetries: 0,
  });
}

export function createModel(
  env: OpenRouterEnvironment = process.env,
  options: CreateModelOptions = {},
): ResilientChatModel {
  const settings = readModelSettings(env);
  const attempts = z.number().int().positive().safe().parse(options.attempts ?? DEFAULT_MODEL_ATTEMPTS);
  const build = options.buildChatModel ?? openRouterChatModel;
  return new ResilientChatModel({
    primaryModel: build(settings.primary, settings.apiKey),
    primaryName: settings.primary,
    ...(settings.reserve
      ? { reserveModel: build(settings.reserve, settings.apiKey), reserveName: settings.reserve }
      : {}),
    attempts,
  });
}
