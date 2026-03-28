// model.js
window.BioModelEngine = class BioModelEngine {
  constructor(ui) {
    this.ui = ui;
    this.worker = null;
    this.labels = [];
    this.currentModelConfig = null;
    this.currentLanguageConfig = null;
    this.inputNames = null;
    this.outputNames = null;
    this._pendingResolve = null;
    this._pendingReject = null;
  }

  // Parse a labels file into an array of species names.
  // Handles CSV/TSV/text files with configurable delimiter, column, and header.
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

  // Validate if buffer looks like a valid ONNX model
  isValidONNXBuffer(buffer) {
    if (!buffer || buffer.byteLength < 100) return false; // Too small for a valid model

    const view = new Uint8Array(buffer);
    // ONNX models are protobuf files. Check for common protobuf field starts
    // First field is usually ir_version (field 1) or producer_name (field 2)
    return view[0] === 0x08 || view[0] === 0x12 || view[0] === 0x1A;
  }

  async fetchWithCache(url, type = "arrayBuffer") {
    const cache = await caches.open(window.BioConfig.modelCacheLabel);
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

  // Create a Web Worker using a blob URL for CSP compatibility
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

  _sendMessage(msg, transfer) {
    return new Promise((resolve, reject) => {
      this._pendingResolve = resolve;
      this._pendingReject = reject;
      this.worker.postMessage(msg, transfer || []);
    });
  }

  // Terminate the worker to fully reclaim WASM memory.
  // WebAssembly.Memory can grow but never shrink; terminating the
  // worker is the only way to release that memory back to the OS.
  terminateWorker() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.inputNames = null;
    this.outputNames = null;
  }

  async loadModel(modelConfig) {
    // Check model format
    if (modelConfig.format !== 'onnx') {
      this.ui.log(`<span class="bio-error">${this.ui.uiInputText.failedAnalysis}: ${modelConfig.format} ${this.ui.uiText.formatNotSupported}</span>`);
      throw new Error(`[iNaturalist Sound Classifier] Unsupported model format: ${modelConfig.format}. Only ONNX models are supported.`);
    }

    // Terminate old worker to free WASM memory before starting fresh
    this.terminateWorker();

    this.currentModelConfig = modelConfig;
    this.ui.log(`<span class="bio-line-header">${this.ui.uiInputText.preparingModel}...</span>`);

    // Print model config
    this.ui.log(`<b>${this.ui.uiInputText.selectedModel}:</b> <a href="${modelConfig.about}" target="_blank" class='bio-link-taxa'>${modelConfig.name} v${modelConfig.version}</a>`);
    this.ui.log(`- ${this.ui.uiInputText.windowDuration}: ${modelConfig.windowSize}s`);
    this.ui.log(`- ${this.ui.uiInputText.sampleRate}: ${modelConfig.sampleRate}Hz`);
    this.ui.log(`- ${this.ui.uiInputText.inputIndex}: ${modelConfig.inputIndex}`);
    this.ui.log(`- ${this.ui.uiInputText.outputIndex}: ${modelConfig.outputIndex}`);
    this.ui.log(`- ${this.ui.uiInputText.activation}: ${modelConfig.activation}`);
    this.ui.log(`- ${this.ui.uiInputText.sources}: <a href="${modelConfig.modelUrl}" target="_blank" class='bio-link-taxa'><u>model</u></a> | <a href="${modelConfig.labels.url}" target="_blank" class='bio-link-taxa'><u>labels</u></a>`);


    // Fetch model buffer and labels using Cache
    const modelBuffer = await this.fetchWithCache(modelConfig.modelUrl, "arrayBuffer");

    // Validate the model buffer
    if (!this.isValidONNXBuffer(modelBuffer)) {
      throw new Error("Downloaded model does not appear to be a valid ONNX file.");
    }

    const labelsText = await this.fetchWithCache(modelConfig.labels.url, "text");

    this.labels = this.parseLabels(labelsText, modelConfig.labels);

    // Create a fresh worker and load the model inside it
    await this._createWorker();
    const result = await this._sendMessage(
      { type: "loadModel", modelBuffer },
      [modelBuffer]
    );
    this.inputNames = result.inputNames;
    this.outputNames = result.outputNames;

    this.ui.log(`<b>${this.ui.uiInputText.loadingSuccess}</b>`);
  }

  sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

  softmax(logits) {
    const max = logits.reduce((a, b) => Math.max(a, b), -Infinity);
    const exps = logits.map(x => Math.exp(x - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(x => x / sum);
  }

  async predictChunk(chunk) {
    const config = this.currentModelConfig;
    const inputName = this.inputNames[config.inputIndex];
    const outputName = this.outputNames[config.outputIndex];

    const result = await this._sendMessage({
      type: "predict",
      chunk,
      inputName,
      outputName,
    });
    const logits = result.logits;

    let bestIdx = 0, bestScore = -Infinity;
    const activation = config.activation || "sigmoid";

    if (activation === "softmax") {
      const probs = this.softmax(Array.from(logits));
      for (let i = 0; i < probs.length; i++) {
        if (probs[i] > bestScore) { bestScore = probs[i]; bestIdx = i; }
      }
    } else if (activation === "sigmoid") {
      for (let i = 0; i < logits.length; i++) {
        const score = this.sigmoid(logits[i]);
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
