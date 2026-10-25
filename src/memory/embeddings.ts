import { InvalidEmbeddingError, MemoryValidationError } from "../domain/errors.ts";
import { memoryFactSchema } from "../domain/domain.ts";
import { validateEmbedding } from "./vector.ts";

const MODEL_ID = "onnx-community/all-MiniLM-L6-v2-ONNX";
const PIPELINE_OPTIONS = { pooling: "mean", normalize: true } as const;

export type EmbeddingPipeline = (
  text: string,
  options: typeof PIPELINE_OPTIONS,
) => Promise<unknown>;
export type EmbeddingFunction = (text: string) => Promise<Float32Array>;
export type EmbeddingPipelineFactory = () => Promise<EmbeddingPipeline>;

async function createLocalPipeline(): Promise<EmbeddingPipeline> {
  const { pipeline } = await import("@huggingface/transformers");
  const extractor = await pipeline("feature-extraction", MODEL_ID);
  return (text, options) => extractor(text, options);
}

let pipelinePromise: Promise<EmbeddingPipeline> | undefined;
let pipelineFactory: EmbeddingPipelineFactory = createLocalPipeline;

async function getPipeline(): Promise<EmbeddingPipeline> {
  if (!pipelinePromise) {
    const pending = pipelineFactory();
    pipelinePromise = pending;
    void pending.catch(() => {
      if (pipelinePromise === pending) {
        pipelinePromise = undefined;
      }
    });
  }
  return await pipelinePromise;
}

export async function embed(text: string): Promise<Float32Array> {
  let input: string;
  try {
    input = memoryFactSchema.parse(text);
  } catch (error) {
    throw new MemoryValidationError("Embedding text must be a non-empty string.", { cause: error });
  }
  const extractor = await getPipeline();
  const output = await extractor(input, PIPELINE_OPTIONS);
  if (
    typeof output !== "object"
    || output === null
    || !("data" in output)
    || !("dims" in output)
    || !(output.data instanceof Float32Array)
    || !Array.isArray(output.dims)
    || output.dims.length !== 2
    || output.dims[0] !== 1
    || output.dims[1] !== 384
  ) {
    throw new InvalidEmbeddingError("The embedding model returned an invalid tensor shape or type.");
  }
  return validateEmbedding(output.data);
}

export function setEmbeddingPipelineFactory(factory: EmbeddingPipelineFactory): void {
  pipelineFactory = factory;
  pipelinePromise = undefined;
}

export function resetEmbeddingPipelineForTests(): void {
  pipelineFactory = createLocalPipeline;
  pipelinePromise = undefined;
}
