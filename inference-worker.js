// inference-worker.js
// Runs ONNX Runtime inference in an isolated Web Worker.
// Terminating this worker is the only way to reclaim WASM memory,
// since WebAssembly.Memory can grow but never shrink.

let session = null;

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

    case "loadModel": {
      try {
        if (session) {
          try { await session.release(); } catch (err) {}
          session = null;
        }
        session = await ort.InferenceSession.create(e.data.modelBuffer, {
          executionProviders: ["wasm"],
        });
        self.postMessage({
          type: "modelLoaded",
          inputNames: Array.from(session.inputNames),
          outputNames: Array.from(session.outputNames),
        });
      } catch (err) {
        self.postMessage({ type: "error", message: err.message });
      }
      break;
    }

    case "predict": {
      try {
        const { chunk, inputName, outputName } = e.data;
        const inputTensor = new ort.Tensor("float32", chunk, [1, chunk.length]);
        const results = await session.run({ [inputName]: inputTensor });
        const outputTensor = results[outputName];
        const logits = new Float32Array(outputTensor.data);

        // Dispose tensors to free WASM heap between chunks
        inputTensor.dispose();
        outputTensor.dispose();

        self.postMessage({ type: "prediction", logits }, [logits.buffer]);
      } catch (err) {
        self.postMessage({ type: "error", message: err.message });
      }
      break;
    }
  }
};
