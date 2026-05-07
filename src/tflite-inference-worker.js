// tflite-inference-worker.js
// Runs LiteRT (TFLite) inference in an isolated Web Worker.
// This file is bundled by esbuild into tflite/tflite-worker-bundle.js —
// it is not used directly by the extension.

import { loadLiteRt, loadAndCompile, Tensor } from '@litertjs/core';

/** @type {import('@litertjs/core').CompiledModel|null} */
let model = null;

self.onmessage = async function (e) {
  const { type } = e.data;

  switch (type) {
    case "init": {
      try {
        // Emscripten detects a blob: worker URL and resets scriptDirectory to "",
        // making the .wasm XHR request use an invalid relative URL.
        // Setting Module.locateFile before loadLiteRt overrides path resolution
        // inside ModuleFactory, which receives self.Module as its argument.
        self.Module = { locateFile: (filename) => e.data.wasmPath + filename };
        await loadLiteRt(e.data.wasmPath);
        self.postMessage({ type: "ready" });
      } catch (err) {
        self.postMessage({ type: "error", message: err.message });
      }
      break;
    }

    case "loadModel": {
      try {
        if (model) {
          try { model.delete(); } catch (_) {}
          model = null;
        }
        // loadAndCompile requires Uint8Array, not ArrayBuffer
        model = await loadAndCompile(new Uint8Array(e.data.modelBuffer));
        self.postMessage({
          type: "modelLoaded",
          inputNames: model.getInputDetails().map(d => d.name),
          outputNames: model.getOutputDetails().map(d => d.name),
        });
      } catch (err) {
        self.postMessage({ type: "error", message: err.message });
      }
      break;
    }

    case "predict": {
      try {
        const { chunk, outputName } = e.data;
        const input = new Tensor(chunk, [1, chunk.length]);
        // Passing a single Tensor makes run() return Tensor[]
        const outputs = await model.run(input);
        const outputIdx = model.getOutputDetails().findIndex(d => d.name === outputName);
        const output = outputs[outputIdx >= 0 ? outputIdx : 0];
        const logits = new Float32Array(await output.data());
        input.delete();
        outputs.forEach(o => o.delete());
        self.postMessage({ type: "prediction", logits }, [logits.buffer]);
      } catch (err) {
        self.postMessage({ type: "error", message: err.message });
      }
      break;
    }
  }
};
