// model.js
window.BioModelEngine = class BioModelEngine {
  constructor(ui) {
    this.ui = ui;
    this.session = null;
    this.labels = [];
    this.currentModelConfig = null;
  }

  async fetchWithCache(url, type = "arrayBuffer") {
    const cache = await caches.open("bioacoustic-models-v1");
    let response = await cache.match(url);
    if (!response) {
      this.ui.log(`Not found in cache: ${url.split('/').pop()}`);
      this.ui.log(`Downloading...`)
      response = await fetch(url);
      if (response.ok) await cache.put(url, response.clone());
      this.ui.log(`Saved to cache: ${url.split('/').pop()}`)
    } else {
      this.ui.log(`Loaded from cache: ${url.split('/').pop()}`);
    }
    return type === "arrayBuffer" ? await response.arrayBuffer() : await response.text();
  }

  async loadModel(modelConfig) {
    // Release old session from memory if we are switching models
    if (this.session) {
      try { await this.session.release(); } catch (e) {}
      this.session = null;
    }

    this.currentModelConfig = modelConfig;
    this.ui.log(`<span class="bio-line-header">Preparing model session...</span>`);

    // Print model config
    this.ui.log(`<b>Selected model: ${modelConfig.name} v${modelConfig.version}</b>`);
    this.ui.log(`- Duration of analysis window: ${modelConfig.windowSize}s`);
    this.ui.log(`- Sample rate: ${modelConfig.sampleRate}Hz`);
    this.ui.log(`- Input index: ${modelConfig.inputIndex}`);
    this.ui.log(`- Output index: ${modelConfig.outputIndex}`);
    this.ui.log(`- Using softmax: ${modelConfig.softmax}`);
    this.ui.log(`- Sources: <a href="${modelConfig.modelUrl}" target="_blank" class='bio-link-taxa'><u>model</u></a> | <a href="${modelConfig.labelsUrl}" target="_blank" class='bio-link-taxa'><u>labels</u></a>`);


    // Fetch model buffer and labels using Cache
    const modelBuffer = await this.fetchWithCache(modelConfig.modelUrl, "arrayBuffer");
    const labelsText = await this.fetchWithCache(modelConfig.labelsUrl, "text");
    
    this.labels = labelsText.trim().split("\n");
    this.session = await ort.InferenceSession.create(modelBuffer, { executionProviders: ["wasm"] });
    this.ui.log("<b>Model successfully loaded to memory</b>");
  }

  sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

  softmax(logits) {
    const maxLogit = Math.max(...logits);
    const exps = logits.map(x => Math.exp(x - maxLogit));
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
        const score = this.sigmoid(probs[i]);
        if (score > bestScore) { bestScore = score; bestIdx = i; }
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