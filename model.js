// model.js
window.BioModelEngine = class BioModelEngine {
  constructor(ui) {
    this.ui = ui;
    this.session = null;
    this.labels = [];
    this.currentModelConfig = null;
    this.currentLanguageConfig = null;
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
      response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : null;
      const reader = response.body.getReader();
      const chunks = [];
      let loaded = 0;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        if (total) {
          const percent = Math.round((loaded / total) * 100);
          this.ui.log(`${this.ui.uiInputText.downloadingModel}... ${percent}%`, "download-progress");
        }
      }
      
      // Combine chunks
      const uint8Array = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) {
        uint8Array.set(chunk, offset);
        offset += chunk.length;
      }
      
      // Create response for caching
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

  async loadModel(modelConfig) {
    // Check model format
    if (modelConfig.format !== 'onnx') {
      this.ui.log(`<span class="bio-error">${this.ui.uiInputText.failedAnalysis}: ${modelConfig.format} ${this.ui.uiText.formatNotSupported}</span>`);
      throw new Error(`[iNaturalist Sound Classifier] Unsupported model format: ${modelConfig.format}. Only ONNX models are supported.`);
    }

    // Release old session from memory if we are switching models
    if (this.session) {
      try { await this.session.release(); } catch (e) {}
      this.session = null;
    }

    this.currentModelConfig = modelConfig;
    this.ui.log(`<span class="bio-line-header">${this.ui.uiInputText.preparingModel}...</span>`);

    // Print model config
    this.ui.log(`<b>${this.ui.uiInputText.selectedModel}:</b> <a href="${modelConfig.about}" target="_blank" class='bio-link-taxa'>${modelConfig.name} v${modelConfig.version}</a>`);
    this.ui.log(`- ${this.ui.uiInputText.windowDuration}: ${modelConfig.windowSize}s`);
    this.ui.log(`- ${this.ui.uiInputText.sampleRate}: ${modelConfig.sampleRate}Hz`);
    this.ui.log(`- ${this.ui.uiInputText.inputIndex}: ${modelConfig.inputIndex}`);
    this.ui.log(`- ${this.ui.uiInputText.outputIndex}: ${modelConfig.outputIndex}`);
    this.ui.log(`- ${this.ui.uiInputText.usingSoftmax}: ${modelConfig.softmax}`);
    this.ui.log(`- ${this.ui.uiInputText.sources}: <a href="${modelConfig.modelUrl}" target="_blank" class='bio-link-taxa'><u>model</u></a> | <a href="${modelConfig.labelsUrl}" target="_blank" class='bio-link-taxa'><u>labels</u></a>`);


    // Fetch model buffer and labels using Cache
    const modelBuffer = await this.fetchWithCache(modelConfig.modelUrl, "arrayBuffer");
    
    // Validate the model buffer
    if (!this.isValidONNXBuffer(modelBuffer)) {
      throw new Error("Downloaded model does not appear to be a valid ONNX file.");
    }
    
    const labelsText = await this.fetchWithCache(modelConfig.labelsUrl, "text");
    
    this.labels = labelsText.trim().split("\n");
    this.session = await ort.InferenceSession.create(modelBuffer, { executionProviders: ["wasm"] });
    this.ui.log(`<b>${this.ui.uiInputText.loadingSuccess}</b>`);
  }

  sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

  softmax(logits) {
    const exps = logits.map(x => Math.exp(x));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(x => x / sum);
  }

  async predictChunk(chunk) {
    const config = this.currentModelConfig;
    const inputName = this.session.inputNames[config.inputIndex];
    const outputName = this.session.outputNames[config.outputIndex];
    const tensor = new ort.Tensor("float32", chunk, [1, chunk.length]);
    
    const results = await this.session.run({ [inputName]: tensor });
    const logits = results[outputName].data;
    
    let bestIdx = 0, bestScore = 0;

    if (config.softmax) {
      const probs = this.softmax(logits);
      for (let i = 0; i < probs.length; i++) {
        if (probs[i] > bestScore) { bestScore = probs[i]; bestIdx = i; }
      }
    } else {
      for (let i = 0; i < logits.length; i++) {
        const score = this.sigmoid(logits[i]);
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }
    }

    return { 
      label: this.labels[bestIdx + config.skipLabelsHeader], 
      score: bestScore 
    };
  }
};