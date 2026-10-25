# Research: Semantic User Memory

## Decision 1: Use a local Transformers.js feature-extraction pipeline

**Decision**: Use `@huggingface/transformers` with the ONNX model `onnx-community/all-MiniLM-L6-v2-ONNX`, task `feature-extraction`, `pooling: "mean"`, and `normalize: true`. Validate output as one Float32 vector with 384 finite elements. Resolve the pipeline through a lazy module-level promise shared by callers; clear the cached promise if initialization rejects so a later request can retry.

**Rationale**: The official ONNX model card provides a Transformers.js-compatible Node example with this pooling and normalization. The original all-MiniLM-L6-v2 model documents 384 dimensions and mean pooling with L2 normalization. Lazy initialization avoids startup cost for users who do not invoke memory; promise sharing avoids duplicate loads under concurrent first calls. Retry after load failure prevents a transient cache/network issue from permanently poisoning the process.

**Alternatives considered**:
- Load the model synchronously at service startup: rejected because it adds startup latency and makes existing chat dependent on model initialization even without `userId`.
- Cache a rejected initialization promise forever: rejected because temporary model/cache failures would make every later memory request fail until restart.
- Run inference through a hosted embedding API: rejected because the feature requires local inference and offline runtime after assets are available.

**References**:
- [Transformers.js Node tutorial: lazy pipeline, singleton, and cache](https://huggingface.co/docs/transformers.js/tutorials/node)
- [ONNX model card for Transformers.js](https://huggingface.co/onnx-community/all-MiniLM-L6-v2-ONNX)
- [Original all-MiniLM-L6-v2 model card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
- [Transformers.js Tensor API](https://huggingface.co/docs/transformers.js/api/utils/tensor)

## Decision 2: Persist Float32 embeddings as SQLite BLOB values

**Decision**: Encode each normalized 384-element Float32 vector as its exact 1536 bytes and store it in the `embedding` BLOB column. Validate the BLOB byte length, decoded dimension, finite values, and expected vector dimension whenever reading it. Keep the requested table columns exactly `id`, `user_id`, `fact`, `embedding`, and `created_at`; record the model/dimension convention in code and documentation rather than adding unspecified columns.

**Rationale**: BLOB storage preserves the numeric vector without JSON parsing and is supported by Node's built-in SQLite typed-array bindings. Fixed dimension allows strict size validation and stable dot-product comparisons.

**Alternatives considered**:
- JSON/text storage: rejected because it is larger and introduces parsing/precision concerns.
- Add model and dimensions columns: not selected because the requested table names the exact columns; the selected fixed model and dimension are defined by this feature.
- Silently skip corrupt or incompatible vectors: rejected because it would turn data corruption into a success-shaped no-recall result.

**References**:
- [Node.js 22 `node:sqlite` documentation](https://nodejs.org/docs/latest-v22.x/api/sqlite.html)
- [Node.js SQLite TypedArray input documentation](https://nodejs.org/api/sqlite.html)

## Decision 3: Use dot product for ranking and strict specified thresholds

**Decision**: Use a pure dot-product helper over finite 384-dimension normalized vectors. Rank per-user memories by the unrounded score descending, break ties deterministically by `created_at` then `id`, retain scores `>= 0.3` for recall, and treat a new fact as a duplicate only when score `> 0.92`.

**Rationale**: For L2-normalized vectors, dot product equals cosine similarity. Keeping the requested inclusive/exclusive boundary semantics explicit and comparing unrounded scores avoids threshold drift. Deterministic ties produce repeatable top-three results.

**Alternatives considered**:
- Euclidean distance or unnormalized dot product: rejected because the request selects normalized vectors and dot-product similarity.
- Round scores before threshold/ranking: rejected because rounding can change boundary eligibility and ordering.
- Apply a universal dedup threshold: rejected because thresholds depend on the product domain; this feature uses the user's explicit `0.92` threshold.

**References**:
- [Transformers.js feature-extraction implementation](https://github.com/huggingface/transformers.js/blob/main/packages/transformers/src/pipelines/feature-extraction.js)
- [Original all-MiniLM-L6-v2 model card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)

## Decision 4: Inject an embedder interface for deterministic tests

**Decision**: `MemoryStore` depends on an embedding function/interface; production defaults to the lazy local singleton, while tests inject deterministic normalized vectors. The HTTP tests inject a fake memory store and strategy.

**Rationale**: Tests can precisely exercise dedup thresholds, top-three ordering, user isolation, malformed BLOBs, and semantic matching without downloading model artifacts or making network requests.

**Alternatives considered**:
- Download and execute the model in every test run: rejected because it requires network/cache availability and slows tests.
- Mock only model outputs globally: rejected because explicit dependency injection is clearer and isolates per-test vectors.

## Decision 5: Provision model assets deliberately for offline deployments

**Decision**: Allow the library's first-use cache download when remote access is available; deployments that must run offline should provision model files into the Transformers.js cache/local model path before running and verify an embedding call during deployment validation. Do not silently fall back to a different model.

**Rationale**: “Local embedding” means inference executes in the service process, but a clean machine may still need to obtain model artifacts once. Explicit provisioning makes that operational dependency visible.

**Alternatives considered**:
- Treat model files as always present without validation: rejected because a first request could unexpectedly fail.
- Switch models automatically if the configured one is missing: rejected because embedding spaces must stay compatible with stored vectors.

**Reference**: [Transformers.js Node tutorial: cache directories and local-only configuration](https://huggingface.co/docs/transformers.js/tutorials/node).

## Unresolved Questions

None. The model identity, dimensions, thresholds, data fields, user trust assumption, chat behavior, and offline test approach are specified.
