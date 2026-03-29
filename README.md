# iNaturalist Sound Classifier (Web Extension)

**[Versão em Português (BR)](README_pt-BR.md)**

A browser extension for biologists and citizen scientists to analyze sound recordings directly on iNaturalist observation pages. It runs state-of-the-art machine learning models locally in your browser to identify species from sound, and validates detections against geographic occurrence data from GBIF and iNaturalist. Currently restricted to models in ONNX format.

Supports **Chromium-based browsers** (Chrome, Brave, Edge) and **Firefox**.

## Key Features

* **Browser-Native Inference:** Runs ONNX models locally using ONNX Runtime WebAssembly in an isolated Web Worker. No audio data leaves your machine.
* **Cross-Browser Support:** Works as a Chrome/Chromium extension (Manifest V3 service worker) and as a Firefox add-on (Manifest V3 event page).
* **Geographic Filtering:** Automatically filters the model registry based on the observation's coordinates so you only see relevant models.
* **Geographic Validation:** Top detections are checked against GBIF and iNaturalist occurrence bounding boxes to flag species outside their known range.
* **Multi-Model Support:** Ships with **BirdNET v2.4** and **Google Perch v2.0**. Custom models can be added via JSON configuration or through the UI.
* **Flexible Label Parsing:** Model label files can use any delimiter (comma, tab, semicolon, underscore, etc.), with configurable header skipping and column selection.
* **Configurable Activation:** Each model specifies its activation function (`softmax`, `sigmoid`, or `none`) in its JSON config.
* **Local Caching:** Downloaded models are stored in the browser's `CacheStorage` for instant loading on future sessions.
* **Streaming Downloads:** Large models (400 MB+) are downloaded via a flow-controlled streaming connection through the background script, avoiding memory spikes.
* **Memory Management:** The inference Web Worker is terminated after each analysis to fully reclaim WebAssembly memory.
* **Multilingual UI:** English and Português (BR) included. Other languages can be added as JSON files.

---

## Installation

### From Source (Developer Mode)

1. **Clone and install dependencies:**
   ```bash
   git clone https://github.com/biodiversica/inat-sound-classifier.git
   cd inat-sound-classifier
   npm install
   npm run sync-onnx
   ```

2. **Build for your browser:**
   ```bash
   # Development builds (for loading as unpacked/temporary extension)
   npm run dev:chrome
   npm run dev:firefox

   # Production builds (zip packages for store submission)
   npm run build:chrome
   npm run build:firefox

   # Build both
   npm run build
   ```

3. **Load the extension:**

   **Chrome / Brave / Edge:**
   - Navigate to `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked** and select `dist/chrome/`

   **Firefox:**
   - Navigate to `about:debugging#/runtime/this-firefox`
   - Click **Load Temporary Add-on** and select any file inside `dist/firefox/`

4. **Use it:** Navigate to any iNaturalist observation page with sound recordings. The analysis panel appears automatically.

---

## Project Structure

```
inat-sound-classifier/
+-- manifest.json           # Extension manifest (Chrome MV3 source of truth)
+-- src/config.js           # Global config and browser API shim (chrome/browser)
+-- src/content.js          # Main entry point: page detection, analysis orchestration
+-- src/model.js            # iNatSCModelEngine: model loading, caching, inference
+-- src/ui.js               # iNatSCUI: DOM injection, controls, logging
+-- src/audio.js            # iNatSCAudio: fetching, decoding, resampling, chunking
+-- src/geo.js              # iNatSCGeo: GBIF/iNaturalist geographic validation
+-- src/background.js       # Service worker / event page: CORS proxy, streaming downloads
+-- src/inference-worker.js # Web Worker: ONNX Runtime WASM inference
+-- onnx/                   # ONNX Runtime WASM binaries (synced from node_modules)
+-- model_zoo/              # Model configuration JSON files + index.json
+-- language/               # UI translation JSON files + index.json
+-- styles/                 # CSS themes (inaturalist.css, biodiversica.css)
+-- scripts/
|   +-- build.js            # Build script for Chrome/Firefox packages
+-- tests/                  # Jest test suite
+-- package.json
```

---

## Adding Custom Models

### Via the UI

1. Open the **Advanced Settings** panel on any observation page.
2. Paste a model JSON configuration into the **Custom Model** text area.
3. Click **Add**. The model is saved to `localStorage` and persists across sessions.

### Via the Model Zoo

1. Create a JSON file in `model_zoo/` following this format:
   ```json
   {
     "id": "my_model_v1",
     "name": "My Model",
     "version": 1.0,
     "about": "https://example.com/about",
     "modelUrl": "https://example.com/model.onnx",
     "labels": {
       "url": "https://example.com/labels.csv",
       "header": true,
       "delimiter": ",",
       "column": 0
     },
     "sampleRate": 48000,
     "windowSize": 3,
     "activation": "sigmoid",
     "inputIndex": 0,
     "outputIndex": 0,
     "bbox": null,
     "format": "onnx",
     "taxa": ["aves"]
   }
   ```

2. Add the filename to `model_zoo/index.json`.

### Label File Configuration

| Field       | Description                                                          |
|-------------|----------------------------------------------------------------------|
| `url`       | URL of the labels text/CSV file                                      |
| `header`    | `true` to skip the first row as a header                             |
| `delimiter` | Column separator: `","`, `"\t"`, `";"`, `"_"`, or `null` for single-column |
| `column`    | Zero-based column index for the species name                         |

### Activation Options

| Value      | Description                                      |
|------------|--------------------------------------------------|
| `"softmax"` | Softmax over all logits (mutually exclusive classes) |
| `"sigmoid"` | Independent sigmoid per logit (multi-label)       |
| `"none"`    | Raw logit values (no transformation)              |

---

## Settings

* **Confidence Threshold:** Filters results by the model's output score (0.05 to 0.95).
* **Overlap %:** Controls how much adjacent analysis windows overlap (0% to 90%).
* **Language:** Switch UI language. Detected from browser locale on first visit.
* **Clear Cache:** Removes all cached models from `CacheStorage`.

---

## Testing

```bash
npm test
```

Runs the Jest test suite (60 tests) covering `model.js`, `audio.js`, `geo.js`, and `ui.js`.

---

## Troubleshooting

### Models not loading (Linux)
Verify your local storage quota. Chrome/Brave on Linux stores extension cache in:
```
~/.config/BraveSoftware/Brave-Browser/Default/Service Worker/CacheStorage/
```
You can clear it using the **Clear Cache** button in Advanced Settings.

### Firefox: model download stalls
Ensure the extension has permissions for the model hosting domain. The manifest includes wildcards for HuggingFace (`*.huggingface.co`, `*.hf.co`) and Zenodo (`zenodo.org`). Custom model URLs from other domains may require adding `host_permissions` to the manifest.

---

## Contributing

1. Fork the project.
2. Create your feature branch (`git checkout -b feature/AmazingFeature`).
3. Run `npm test` to verify all tests pass.
4. Commit your changes (`git commit -m 'Add some AmazingFeature'`).
5. Push to the branch (`git push origin feature/AmazingFeature`).
6. Open a Pull Request.

---

## License

Source code is distributed under the [GPL-3.0](LICENSE). The current available models have specific licenses:

* BirdNET v2.4: [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
* Perch v2.0: [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0)