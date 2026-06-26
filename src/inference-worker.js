// inference-worker.js
// Runs ONNX Runtime inference in an isolated Web Worker.
// Terminating this worker is the only way to reclaim WASM memory,
// since WebAssembly.Memory can grow but never shrink.

/**
 * The current inference session.
 * For "full" models this runs audio chunk -> logits directly.
 * For "classifier" models this is the head session (embedding -> logits),
 * fed by {@link backboneSession}.
 * @type {ort.InferenceSession|null}
 */
let session = null;

/**
 * Optional backbone session (audio chunk -> embedding). Only set for
 * two-stage "classifier" models; null for single-stage "full" models.
 * @type {ort.InferenceSession|null}
 */
let backboneSession = null;

/** Releases any loaded sessions and clears references. */
async function releaseSessions() {
  if (backboneSession) {
    try { await backboneSession.release(); } catch (err) {}
    backboneSession = null;
  }
  if (session) {
    try { await session.release(); } catch (err) {}
    session = null;
  }
}

/**
 * Handles messages from the main thread.
 * Supported message types:
 *  - `init`       — Loads the ORT library and configures WASM paths.
 *  - `loadModels` — Releases any existing sessions and creates new ones.
 *                   `headBuffer` is always required (the head, or the full model);
 *                   `backboneBuffer` is optional (two-stage classifier models).
 *  - `predict`    — Runs inference on an audio chunk and returns raw logits.
 *                   When `backboneInputName` is present, runs backbone -> head;
 *                   otherwise runs the single session directly.
 * @param {MessageEvent} e - Incoming message with `{ type, ... }` payload.
 */
self.onmessage = async function (e) {
  const { type } = e.data;

  switch (type) {
    case "init": {
      try {
        importScripts(e.data.ortUrl);
        ort.env.wasm.wasmPaths = e.data.wasmPaths;
        self.postMessage({ type: "ready" });
      } catch (err) {
        self.postMessage({ type: "error", message: err.message });
      }
      break;
    }

    case "loadModels": {
      try {
        await releaseSessions();

        const { backboneBuffer, headBuffer } = e.data;
        const opts = { executionProviders: ["wasm"] };

        if (backboneBuffer) {
          backboneSession = await ort.InferenceSession.create(backboneBuffer, opts);
        }
        session = await ort.InferenceSession.create(headBuffer, opts);

        const payload = {
          type: "modelLoaded",
          inputNames: Array.from(session.inputNames),
          outputNames: Array.from(session.outputNames),
        };
        if (backboneSession) {
          payload.backboneInputNames = Array.from(backboneSession.inputNames);
          payload.backboneOutputNames = Array.from(backboneSession.outputNames);
        }
        self.postMessage(payload);
      } catch (err) {
        self.postMessage({ type: "error", message: err.message });
      }
      break;
    }

    case "predict": {
      try {
        const { chunk } = e.data;
        const inputTensor = new ort.Tensor("float32", chunk, [1, chunk.length]);

        let outputTensor;
        let embeddingTensor = null;

        if (e.data.backboneInputName) {
          // Two-stage: audio chunk -> embedding -> logits.
          const bbResults = await backboneSession.run({ [e.data.backboneInputName]: inputTensor });
          embeddingTensor = bbResults[e.data.embeddingName];
          const headResults = await session.run({ [e.data.headInputName]: embeddingTensor });
          outputTensor = headResults[e.data.headOutputName];
        } else {
          // Single-stage: audio chunk -> logits.
          const results = await session.run({ [e.data.inputName]: inputTensor });
          outputTensor = results[e.data.outputName];
        }

        const logits = new Float32Array(outputTensor.data);

        // Dispose tensors to free WASM heap between chunks
        inputTensor.dispose();
        if (embeddingTensor) embeddingTensor.dispose();
        outputTensor.dispose();

        self.postMessage({ type: "prediction", logits }, [logits.buffer]);
      } catch (err) {
        self.postMessage({ type: "error", message: err.message });
      }
      break;
    }
  }
};
