// model.js

/**
 * Manages ONNX model lifecycle: downloading, caching, label parsing,
 * Web Worker–based inference, and activation functions (softmax/sigmoid).
 */
window.iNatSCModelEngine = class iNatSCModelEngine {
  /**
   * @param {iNatSCUI} ui - UI instance used for logging progress and status messages.
   */
  constructor(ui) {
    this.ui = ui;
    this.worker = null;
    this.labels = [];
    this.currentModelConfig = null;
    this.currentBackboneConfig = null;
    this.currentLanguageConfig = null;
    this.inputNames = null;
    this.outputNames = null;
    // Resolved I/O tensor names used at predict time.
    this.isClassifier = false;
    this.inputName = null;        // full model input
    this.outputName = null;       // full model output (logits)
    this.backboneInputName = null; // classifier: backbone audio input
    this.embeddingName = null;     // classifier: backbone embedding output
    this.headInputName = null;     // classifier: head embedding input
    this.headOutputName = null;    // classifier: head logits output
    this._pendingResolve = null;
    this._pendingReject = null;
  }

  /**
   * Resolves a tensor name using a name-first, index-fallback strategy.
   * Newer (backbone/classifier) configs reference tensors by name; legacy
   * "full" model configs reference them by numeric index.
   * @param {string[]} names - Tensor names exposed by the session.
   * @param {string} [nameValue] - Preferred tensor name from the config.
   * @param {number} [indexValue] - Fallback index from the config.
   * @returns {string} The resolved tensor name.
   */
  _resolveIO(names, nameValue, indexValue) {
    if (nameValue && names.includes(nameValue)) return nameValue;
    return names[indexValue ?? 0];
  }

  /**
   * Parses a labels file into an array of species names.
   * Handles CSV/TSV/plain-text files with configurable delimiter, column index,
   * and optional header row.
   * @param {string} text - Raw text content of the labels file.
   * @param {Object} labelsConfig - Parsing options.
   * @param {boolean} labelsConfig.header - Whether the first row is a header to skip.
   * @param {string|null} labelsConfig.delimiter - Column delimiter (e.g. ",", "\t", "_"), or null for single-column files.
   * @param {number} [labelsConfig.column=0] - Zero-based column index to extract.
   * @returns {string[]} Array of trimmed label strings.
   */
  parseLabels(text, labelsConfig) {
    const lines = text.trim().split("\n");
    const start = labelsConfig.header ? 1 : 0;
    const delimiter = labelsConfig.delimiter;
    const column = labelsConfig.column || 0;

    const labels = [];
    for (let i = start; i < lines.length; i++) {
      const line = lines[i].replace(/[\r]/g, "");
      if (!line) continue;
      const value = delimiter ? line.split(delimiter)[column] : line;
      labels.push((value || "").trim());
    }
    return labels;
  }

  /**
   * Checks whether an ArrayBuffer looks like a valid ONNX model by inspecting
   * its size and the first protobuf field tag byte.
   * @param {ArrayBuffer|null} buffer - The buffer to validate.
   * @returns {boolean} `true` if the buffer passes basic ONNX format checks.
   */
  isValidONNXBuffer(buffer) {
    if (!buffer || buffer.byteLength < 100) return false; // Too small for a valid model

    const view = new Uint8Array(buffer);
    // ONNX models are protobuf files. Check for common protobuf field starts
    // First field is usually ir_version (field 1) or producer_name (field 2)
    return view[0] === 0x08 || view[0] === 0x12 || view[0] === 0x1A;
  }

  /**
   * Downloads a resource via the background service worker with Cache API storage.
   * Uses a long-lived port connection with flow control for large files (e.g. ONNX models)
   * and logs download progress to the UI.
   * @param {string} url - The URL to fetch.
   * @param {"arrayBuffer"|"text"} [type="arrayBuffer"] - Desired return type.
   * @returns {Promise<ArrayBuffer|string>} The fetched data, from cache or network.
   */
  async fetchWithCache(url, type = "arrayBuffer") {
    const cache = await caches.open(window.iNatSCConfig.modelCacheLabel);
    let response = await cache.match(url);
    if (!response) {
      this.ui.log(`${this.ui.uiInputText.notFoundInCache}: ${url.split('/').pop()}`);
      this.ui.log(`${this.ui.uiInputText.downloadingModel}... 0%`, "download-progress");

      // Download via a long-lived port to the background service worker.
      // This bypasses CORS (content scripts run under the page's origin)
      // and keeps the MV3 service worker alive during large downloads.
      const uint8Array = await new Promise((resolve, reject) => {
        const port = api.runtime.connect({ name: "download" });
        const chunks = [];
        let totalSize = 0;

        port.onMessage.addListener((msg) => {
          if (msg.type === "size") {
            totalSize = msg.total;
          } else if (msg.type === "chunk") {
            const binary = atob(msg.data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            chunks.push(bytes);

            if (totalSize && msg.downloaded) {
              const pct = Math.round((msg.downloaded / totalSize) * 100);
              this.ui.log(`${this.ui.uiInputText.downloadingModel}... ${pct}%`, "download-progress");
            }
            // ACK so the background sends the next chunk (flow control)
            port.postMessage({ type: "ack" });
          } else if (msg.type === "done") {
            const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
            const combined = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
              combined.set(chunk, offset);
              offset += chunk.length;
            }
            port.disconnect();
            resolve(combined);
          } else if (msg.type === "error") {
            port.disconnect();
            reject(new Error(msg.message));
          }
        });

        port.onDisconnect.addListener(() => {
          if (api.runtime.lastError) {
            reject(new Error(api.runtime.lastError.message));
          }
        });

        port.postMessage({ url });
      });

      // Cache for future use
      const cachedResponse = new Response(uint8Array);
      await cache.put(url, cachedResponse);

      this.ui.log(`${this.ui.uiInputText.savedModel}: ${url.split('/').pop()}`);

      // Return the data
      if (type === "arrayBuffer") {
        return uint8Array.buffer;
      } else {
        return new TextDecoder().decode(uint8Array);
      }
    } else {
      this.ui.log(`${this.ui.uiInputText.loadedModel}: ${url.split('/').pop()}`);
      return type === "arrayBuffer" ? await response.arrayBuffer() : await response.text();
    }
  }

  /**
   * Creates a Web Worker for ONNX Runtime inference using a blob URL.
   * The blob URL approach avoids Content Security Policy restrictions that
   * block loading worker scripts from extension URLs in content script context.
   * @returns {Promise<void>} Resolves when the worker is initialized and ORT is ready.
   */
  _createWorker() {
    return new Promise((resolve, reject) => {
      const workerScriptUrl = api.runtime.getURL("inference-worker.js");
      // Fetch the worker script and create a blob URL so it runs
      // under the page's origin, avoiding content script CSP issues
      fetch(workerScriptUrl)
        .then((r) => r.text())
        .then((code) => {
          const blob = new Blob([code], { type: "text/javascript" });
          const blobUrl = URL.createObjectURL(blob);
          this.worker = new Worker(blobUrl);
          URL.revokeObjectURL(blobUrl);

          this.worker.onmessage = (e) => this._handleMessage(e);
          this.worker.onerror = (e) => {
            if (this._pendingReject) {
              this._pendingReject(new Error(e.message));
              this._pendingResolve = null;
              this._pendingReject = null;
            }
          };

          // Initialize ORT inside the worker
          const ortUrl = api.runtime.getURL("onnx/ort.min.js");
          const wasmPaths = api.runtime.getURL("onnx/");
          this._sendMessage({ type: "init", ortUrl, wasmPaths })
            .then(() => resolve())
            .catch(reject);
        })
        .catch(reject);
    });
  }

  /**
   * Handles incoming messages from the inference worker.
   * Routes success responses to the pending resolve callback and error
   * responses to the pending reject callback.
   * @param {MessageEvent} e - Worker message event.
   */
  _handleMessage(e) {
    const { type } = e.data;
    if (type === "error") {
      if (this._pendingReject) {
        this._pendingReject(new Error(e.data.message));
      }
    } else if (this._pendingResolve) {
      this._pendingResolve(e.data);
    }
    this._pendingResolve = null;
    this._pendingReject = null;
  }

  /**
   * Sends a message to the inference worker and returns a promise that resolves
   * with the worker's response. Only one request can be in-flight at a time.
   * @param {Object} msg - The message payload to send.
   * @param {Transferable[]} [transfer] - Optional transferable objects (e.g. ArrayBuffers).
   * @returns {Promise<Object>} The worker's response data.
   */
  _sendMessage(msg, transfer) {
    return new Promise((resolve, reject) => {
      this._pendingResolve = resolve;
      this._pendingReject = reject;
      this.worker.postMessage(msg, transfer || []);
    });
  }

  /**
   * Terminates the inference worker to fully reclaim WASM memory.
   * WebAssembly.Memory can grow but never shrink; terminating the
   * worker is the only way to release that memory back to the OS.
   */
  terminateWorker() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.inputNames = null;
    this.outputNames = null;
    this.isClassifier = false;
    this.inputName = null;
    this.outputName = null;
    this.backboneInputName = null;
    this.embeddingName = null;
    this.headInputName = null;
    this.headOutputName = null;
  }

  /**
   * Loads an ONNX model: validates format, terminates any existing worker,
   * downloads the model and labels (with caching), creates a fresh worker,
   * and initializes the ORT inference session.
   * @param {Object} modelConfig - Model configuration from the model zoo JSON.
   * @param {string} modelConfig.format - Must be "onnx".
   * @param {string} modelConfig.modelUrl - URL of the ONNX model file (full model or classifier head).
   * @param {Object} modelConfig.labels - Label file configuration passed to {@link parseLabels}.
   * @param {string} modelConfig.activation - Activation function: "softmax", "sigmoid", or "none".
   * @param {string} [modelConfig.type] - "full" (default, single-stage) or "classifier" (head requiring a backbone).
   * @param {Object|null} [backbone] - Resolved backbone config (audio -> embedding) for "classifier" models.
   * @returns {Promise<void>}
   * @throws {Error} If a format is not ONNX, a buffer is invalid, or preprocessing length mismatches the backbone.
   */
  async loadModel(modelConfig, backbone = null) {
    const isClassifier = modelConfig.type === "classifier";

    // Check model format(s)
    if (modelConfig.format !== 'onnx') {
      this.ui.log(`<span class="insc-error">${this.ui.uiInputText.failedAnalysis}: ${modelConfig.format} ${this.ui.uiText.formatNotSupported}</span>`);
      throw new Error(`[iNaturalist Sound Classifier] Unsupported model format: ${modelConfig.format}. Only ONNX models are supported.`);
    }
    if (isClassifier) {
      if (!backbone) {
        throw new Error(`[iNaturalist Sound Classifier] Classifier model "${modelConfig.id || modelConfig.name}" has no resolvable backbone.`);
      }
      if (backbone.format !== 'onnx') {
        throw new Error(`[iNaturalist Sound Classifier] Unsupported backbone format: ${backbone.format}. Only ONNX backbones are supported.`);
      }
    }

    // Resolve preprocessing (sampleRate/windowSize). For classifier models the
    // head may override the backbone's rate/window to feed the same input length
    // from a different time/frequency scale (e.g. time-expanded bat audio), as
    // long as the resulting sample count matches the backbone input length.
    const sampleRate = isClassifier ? (modelConfig.sampleRate ?? backbone.sampleRate) : modelConfig.sampleRate;
    const windowSize = isClassifier ? (modelConfig.windowSize ?? backbone.windowSize) : modelConfig.windowSize;

    if (isClassifier) {
      const backboneLength = Math.round(backbone.sampleRate * backbone.windowSize);
      const headLength = Math.round(sampleRate * windowSize);
      if (headLength !== backboneLength) {
        throw new Error(`[iNaturalist Sound Classifier] Preprocessing length mismatch: ${sampleRate}Hz x ${windowSize}s = ${headLength} samples, but backbone "${backbone.name}" expects ${backboneLength}.`);
      }
    }

    // Terminate old worker to free WASM memory before starting fresh
    this.terminateWorker();

    this.currentModelConfig = modelConfig;
    this.currentBackboneConfig = isClassifier ? backbone : null;
    this.isClassifier = isClassifier;
    this.ui.log(`<span class="insc-line-header">${this.ui.uiInputText.preparingModel}...</span>`);

    // Print model config
    this.ui.log(`<b>${this.ui.uiInputText.selectedModel}:</b> <a href="${modelConfig.about}" target="_blank" class='insc-link-taxa'>${modelConfig.name} v${modelConfig.version}</a>`);
    if (isClassifier) {
      this.ui.log(`- ${this.ui.uiInputText.backbone || "Backbone"}: <a href="${backbone.about}" target="_blank" class='insc-link-taxa'>${backbone.name} v${backbone.version}</a>`);
    }
    this.ui.log(`- ${this.ui.uiInputText.windowDuration}: ${windowSize}s`);
    this.ui.log(`- ${this.ui.uiInputText.sampleRate}: ${sampleRate}Hz`);
    this.ui.log(`- ${this.ui.uiInputText.activation}: ${modelConfig.activation}`);
    if (isClassifier) {
      this.ui.log(`- ${this.ui.uiInputText.sources}: <a href="${backbone.modelUrl}" target="_blank" class='insc-link-taxa'><u>backbone</u></a> | <a href="${modelConfig.modelUrl}" target="_blank" class='insc-link-taxa'><u>head</u></a> | <a href="${modelConfig.labels.url}" target="_blank" class='insc-link-taxa'><u>labels</u></a>`);
    } else {
      this.ui.log(`- ${this.ui.uiInputText.inputIndex}: ${modelConfig.inputIndex}`);
      this.ui.log(`- ${this.ui.uiInputText.outputIndex}: ${modelConfig.outputIndex}`);
      this.ui.log(`- ${this.ui.uiInputText.sources}: <a href="${modelConfig.modelUrl}" target="_blank" class='insc-link-taxa'><u>model</u></a> | <a href="${modelConfig.labels.url}" target="_blank" class='insc-link-taxa'><u>labels</u></a>`);
    }

    // Fetch the head/full model buffer and (optionally) the backbone buffer, with caching.
    let backboneBuffer = null;
    if (isClassifier) {
      backboneBuffer = await this.fetchWithCache(backbone.modelUrl, "arrayBuffer");
      if (!this.isValidONNXBuffer(backboneBuffer)) {
        throw new Error("Downloaded backbone does not appear to be a valid ONNX file.");
      }
    }

    const headBuffer = await this.fetchWithCache(modelConfig.modelUrl, "arrayBuffer");
    if (!this.isValidONNXBuffer(headBuffer)) {
      throw new Error("Downloaded model does not appear to be a valid ONNX file.");
    }

    const labelsText = await this.fetchWithCache(modelConfig.labels.url, "text");
    this.labels = this.parseLabels(labelsText, modelConfig.labels);

    // Create a fresh worker and load the model(s) inside it
    await this._createWorker();
    const transfer = backboneBuffer ? [backboneBuffer, headBuffer] : [headBuffer];
    const result = await this._sendMessage(
      { type: "loadModels", backboneBuffer, headBuffer },
      transfer
    );
    this.inputNames = result.inputNames;
    this.outputNames = result.outputNames;

    // Resolve I/O tensor names for predict time.
    if (isClassifier) {
      this.backboneInputName = this._resolveIO(result.backboneInputNames, backbone.inputName, backbone.inputIndex);
      this.embeddingName = this._resolveIO(result.backboneOutputNames, backbone.embeddingName, backbone.embeddingIndex);
      this.headInputName = this._resolveIO(result.inputNames, modelConfig.inputName, modelConfig.inputIndex);
      this.headOutputName = this._resolveIO(result.outputNames, modelConfig.outputName, modelConfig.outputIndex);
    } else {
      this.inputName = this._resolveIO(result.inputNames, modelConfig.inputName, modelConfig.inputIndex);
      this.outputName = this._resolveIO(result.outputNames, modelConfig.outputName, modelConfig.outputIndex);
    }

    this.ui.log(`<b>${this.ui.uiInputText.loadingSuccess}</b>`);
  }

  /**
   * Computes the (parametrized) sigmoid activation for a single logit.
   * Matches BirdNET-style sensitivity/bias controls: `bias` shifts the curve
   * horizontally (values > 1.0 are more sensitive / higher scores; < 1.0 more
   * conservative), and `sensitivity` controls steepness. The logit is clipped
   * to [-20, 20] after the bias shift to avoid overflow. With the defaults
   * (sensitivity -1.0, bias 1.0) this reduces to the standard sigmoid.
   * @param {number} x - Input logit.
   * @param {number} [sensitivity=-1.0] - Steepness of the sigmoid curve.
   * @param {number} [bias=1.0] - Horizontal shift, typically in [0.01, 1.99].
   * @returns {number} Value in the range (0, 1).
   */
  sigmoid(x, sensitivity = -1.0, bias = 1.0) {
    const transformedBias = (bias - 1.0) * 10.0;
    const clipped = Math.max(-20, Math.min(20, x + transformedBias));
    return 1 / (1 + Math.exp(sensitivity * clipped));
  }

  /**
   * Computes the softmax probability distribution over an array of logits.
   * Numerically stable: subtracts the max logit before exponentiation to
   * prevent overflow.
   * @param {number[]} logits - Array of raw model output values.
   * @returns {number[]} Probability distribution that sums to 1.
   */
  softmax(logits) {
    const max = logits.reduce((a, b) => Math.max(a, b), -Infinity);
    const exps = logits.map(x => Math.exp(x - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(x => x / sum);
  }

  /**
   * Runs inference on a single audio chunk and returns the top prediction.
   * Sends the chunk to the worker, applies the configured activation function,
   * and maps the best-scoring index to its label.
   * @param {Float32Array} chunk - Audio samples for one analysis window.
   * @returns {Promise<{label: string, score: number}>} The top species label and its score.
   */
  async predictChunk(chunk) {
    const config = this.currentModelConfig;

    const msg = this.isClassifier
      ? {
          type: "predict",
          chunk,
          backboneInputName: this.backboneInputName,
          embeddingName: this.embeddingName,
          headInputName: this.headInputName,
          headOutputName: this.headOutputName,
        }
      : {
          type: "predict",
          chunk,
          inputName: this.inputName,
          outputName: this.outputName,
        };

    const result = await this._sendMessage(msg);
    const logits = result.logits;

    let bestIdx = 0, bestScore = -Infinity;
    const activation = config.activation || "sigmoid";

    if (activation === "softmax") {
      const probs = this.softmax(Array.from(logits));
      for (let i = 0; i < probs.length; i++) {
        if (probs[i] > bestScore) { bestScore = probs[i]; bestIdx = i; }
      }
    } else if (activation === "sigmoid") {
      const sensitivity = config.sigmoid_sensitivity ?? -1.0;
      const bias = config.sigmoid_bias ?? 1.0;
      for (let i = 0; i < logits.length; i++) {
        const score = this.sigmoid(logits[i], sensitivity, bias);
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }
    } else {
      // "none" — use raw logits
      for (let i = 0; i < logits.length; i++) {
        if (logits[i] > bestScore) { bestScore = logits[i]; bestIdx = i; }
      }
    }

    return {
      label: this.labels[bestIdx],
      score: bestScore
    };
  }
};
