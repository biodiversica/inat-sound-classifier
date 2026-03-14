// config.js
window.BioConfig = {
  modelRegistry: {},
  uiText: {},
  overlapPercentage: 0,
  confidenceThreshold: 0.5,
  timeCellWidth: 15,
  speciesCellWidth: 32,
  confidenceCellWidth: 12,
  dynamicPageInterval: 2000,
  modelCacheLabel: "bioacoustic-models-v1"
};

// Point ORT to WASM folder
ort.env.wasm.wasmPaths = chrome.runtime.getURL("onnx/");