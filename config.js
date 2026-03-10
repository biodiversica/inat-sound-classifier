window.BioModelConfig = {
  MODELS: {
    birdnet: {
      name: "BirdNET",
      version: 2.4,
      about: "https://birdnet.cornell.edu/",
      modelUrl: "https://huggingface.co/justinchuby/BirdNET-onnx/resolve/main/model.onnx",
      labelsUrl: "https://huggingface.co/justinchuby/BirdNET-onnx/resolve/main/BirdNET_GLOBAL_6K_V2.4_Labels.txt",
      sampleRate: 48000,
      windowSize: 3,
      softmax: false,
      inputIndex: 0,
      outputIndex: 0,
      skipLabelsHeader: 0
    },
    perch: {
      name: "Perch",
      version: 2.0,
      about: "https://www.kaggle.com/models/google/bird-vocalization-classifier",
      modelUrl: "https://huggingface.co/justinchuby/Perch-onnx/resolve/main/perch_v2.onnx",
      labelsUrl: "https://huggingface.co/cgeorgiaw/Perch/resolve/main/assets/labels.csv",
      sampleRate: 32000,
      windowSize: 5,
      softmax: true,
      inputIndex: 0,
      outputIndex: 3,
      skipLabelsHeader: 1
    }
  },
  overlapPercentage: 0,
  confidenceThreshold: 0.5
};

// Point ORT to WASM folder
ort.env.wasm.wasmPaths = chrome.runtime.getURL("onnx/");