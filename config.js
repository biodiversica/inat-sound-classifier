// config.js
// Browser API shim: Chrome uses chrome.*, Firefox uses browser.*.
// Defined once here (loaded first) and shared across all content scripts.
const api = typeof browser !== "undefined" ? browser : chrome;

window.BioConfig = {
  modelRegistry: {},
  uiText: {},
  overlapPercentage: 0,
  confidenceThreshold: 0.5,
  timeCellWidth: 15,
  speciesCellWidth: 32,
  confidenceCellWidth: 12,
  dynamicPageInterval: 2000,
  modelCacheLabel: "bioacoustic-models-v1",
  exampleCustomModelLink: "https://github.com/biodiversica/inat-sound-classifier/raw/refs/heads/main/model_zoo/birdnet_v2.4.json"
};