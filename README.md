# iNaturalist Sound Classifier (Web Extension)

A browser-based tool for biologists and citizen scientists to analyze sound recordings directly on iNaturalist observation pages. This extension utilizes state-of-the-art machine learning models to identify species from sound, validating detections against geographic data. Currently restricted to models in ONNX format.

## 🌟 Key Features

* **Browser-Native Inference:** Runs ONNX models locally in your browser using the ONNX Runtime—no audio data is uploaded to a server, ensuring privacy and speed.
* **Geographic Filtering:** Automatically filters the model registry based on the observation's coordinates. You only see models relevant to the region.
* **Multi-Model Support:** Includes support for **BirdNET v2.4** and **Google's Perch v2.0**, with an easy-to-use JSON registry for adding custom models.
* **Local Caching:** Once a model is downloaded (100MB+), it is saved to the browser's `CacheStorage` for instant loading on future sessions.
* **GBIF Validation:** (Planned/Alpha) Automatically checks if a detection falls within the known GBIF bounding box for that species.
* **Multilingual UI:** Support for English and Português (BR) out of the box. Easy addition of other languages.

---

## 🚀 Installation (Developer Mode)

Since this extension is currently in active development, it must be installed as an "Unpacked Extension."

1. **Download the Project:**
Clone this repository or download the ZIP and extract it to a folder on your machine.
```bash
git clone https://github.com/biodiversica/inat-sound-classifier.git

```


2. **Open Extension Management:**
Open Brave, Chrome, or Edge and navigate to `chrome://extensions`.
3. **Enable Developer Mode:**
Toggle the **Developer mode** switch in the top right corner.
4. **Load Unpacked:**
Click the **Load unpacked** button and select the root folder of the project.
5. **Refresh iNaturalist:**
Navigate to any iNaturalist observation page that contains a sound recording. The analysis panel will appear automatically.

---

## 🛠 Project Structure

The project follows a modular, hexagonal architecture to allow for easy updates to the ML models or UI components.

```text
├── manifest.json         # Extension configuration & permissions
├── content.js            # Main entry point; handles page observation
├── model.js              # ML Logic: loading a model, running inference
├── ui.js                 # UI Class: Handles DOM injection and event listeners
├── audio.js              # Audio processing: chunking and sample rate conversion
├── styles.css            # Default theme
├── language/             # Language-specific JSON files
└── model_zoo/            # Model metadata JSON files

```

---

## 🌍 Adding Custom Models

You can add your own regional models without modifying the core source code:

1. Create a JSON file in `/model_zoo/your_model.json`.
2. Define the `bbox` (Bounding Box) to limit where the model appears (null if worldwide):
```json
"bbox": [minLat, minLon, maxLat, maxLon]

```


3. Add your filename to `/model_zoo/index.json`.

---

## ⚙️ Settings

* **Confidence Threshold:** Filters results based on the model's output score (0.05 to 0.95).
* **Overlap %:** Sets how much the analysis windows overlap. 50% overlap is default.
* **Model Cache:** Models are stored in your browser's `Service Worker/CacheStorage` directory to save bandwidth.

---

## 📝 Troubleshooting

### Ubuntu/Linux
If models are not loading, verify your local storage quota. Brave/Chrome on Ubuntu typically stores extension data in:
`~/.config/BraveSoftware/Brave-Browser/Default/Service Worker/CacheStorage/`

You can clear the model cache at any time using the "Clear Cache" button in the Advanced Settings menu or by deleting the folder above.

---

## 🤝 Contributing

We welcome contributions from biologists and developers alike!

1. Fork the Project.
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`).
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the Branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

---

## 📜 License

Distributed under the GPLv3 License. See `LICENSE` for more information.

---
