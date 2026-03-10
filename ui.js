// ui.js
window.BioUI = class BioUI {
  constructor(onRunCallback) {
    this.onRunCallback = onRunCallback;
    
    // 1. Inject the HTML skeleton
    this.injectPanel();
    
    // 2. Cache DOM elements for easy access later
    this.panel = document.getElementById("bio-model-panel");
    this.content = document.getElementById("bio-content-wrapper");
    this.toggleBtn = document.getElementById("bio-toggle-btn");
    this.logArea = document.getElementById("bio-log-area");
    this.modelSelect = document.getElementById("bio-model-select");
    this.runBtn = document.getElementById("bio-run-btn");
    this.customModelInput = document.getElementById("bio-custom-model");
    this.addCustomBtn = document.getElementById("bio-add-custom-btn");
    
    // 3. Setup initial state
    this.populateDropdown();
    this.setupEventListeners();
  }

  // Pad string to specific length
  pad(str, length) {
    str = String(str); // Ensure it's a string
    if (str.length >= length) {
      return str.substring(0, length - 3) + "..."; // Truncate if too long
    }
    return str + " ".repeat(length - str.length);
  }

  // Helper to print a table header
  printTableHeader(timeWidth, speciesWidth, confidenceWidth) {
    const col1 = this.pad("Time Window", timeWidth);
    const col2 = this.pad("Species", speciesWidth);
    const col3 = this.pad("Confidence", confidenceWidth);
    
    this.log(`<b class="bio-header">${col1} | ${col2} | ${col3}</b>`);
  }

  clearLog() {
    const logArea = document.getElementById("bio-log-area");
    if (logArea) {
      logArea.innerHTML = ""; // This physically removes the text from the UI
    }
  }

  injectPanel() {
    // Prevent duplicate panels if the script runs twice
    if (document.getElementById("bio-model-panel")) return;

    const panelDiv = document.createElement("div");
    panelDiv.id = "bio-model-panel";
    
    panelDiv.innerHTML = `
      <div id="bio-header">
        <b>iNaturalist Sound Classifier</b>
        <span id="bio-toggle-btn">−</span>
      </div>
      
      <div id="bio-content-wrapper">
        <div class="bio-controls-row">
          <div>
            <span>Bioacoustic Model:</span>
            <select id="bio-model-select"></select>
            <button id="bio-run-btn">Run Analysis</button>
            
          </div>
        </div>

        <div id="bio-settings-panel">
          <div class="bio-setting-row">
            <label>Confidence: <span id="bio-conf-val"></span></label>
            <input type="range" id="bio-conf-slider" min="0.05" max="0.95" step="0.05">
          </div>
          <div class="bio-setting-row">
            <label>Overlap: <span id="bio-overlap-val"></span></label>
            <input type="range" id="bio-overlap-slider" min="0" max="90" step="10">
          </div>
        </div>
        
        <details>
          <summary class="bio-custom-summary">+ Add Custom Model (JSON)</summary>
          <textarea id="bio-custom-model" placeholder='{"name": "Custom", "version": 1.0, ...}'></textarea>
          <button id="bio-add-custom-btn">Add to List</button>
        </details>
        
        <div id="bio-log-area"></div>
        <div class="bio-bottom-controls"> 
          <button id="bio-clear-btn" title="Clear Logs">Clear Logs</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(panelDiv);
  }

  populateDropdown() {
    this.modelSelect.innerHTML = "";
    for (const [key, model] of Object.entries(window.BioModelConfig.MODELS)) {
      const option = document.createElement("option");
      option.value = key;
      option.text = `${model.name} v${model.version}`;
      this.modelSelect.appendChild(option);
    }
  }

  setupEventListeners() {
    // Toggle Panel Minimization
    document.getElementById("bio-header").addEventListener("click", () => {
      const isHidden = this.content.style.display === "none";
      
      this.content.style.display = isHidden ? "flex" : "none";
      this.toggleBtn.innerText = isHidden ? "−" : "+";
      
      // Use CSS class for width toggling instead of inline styles
      if (isHidden) {
        this.panel.classList.remove("minimized");
      } else {
        this.panel.classList.add("minimized");
      }
    });

    // Run Analysis Button
    this.runBtn.addEventListener("click", () => {
      const selectedKey = this.modelSelect.value;
      const modelConfig = window.BioModelConfig.MODELS[selectedKey];
      this.onRunCallback(modelConfig);
    });

    // Clear Logs Button
    const clearBtn = document.getElementById("bio-clear-btn");
    clearBtn.addEventListener("click", () => {
      this.clearLog();
      this.log("Select a model and press <b>'Run Analysis'</b>");
    });

    // Add Custom Model Button
    this.addCustomBtn.addEventListener("click", () => {
      try {
        const customJson = JSON.parse(this.customModelInput.value);
        const key = "custom_" + Date.now();
        window.BioModelConfig.MODELS[key] = customJson;
        
        this.populateDropdown();
        this.modelSelect.value = key;
        
        this.log(`Added custom model: ${customJson.name}`);
        this.customModelInput.value = ""; // Clear the text area on success
      } catch (e) {
        this.log(`<span style="color:red">Invalid JSON format</span>`);
      }
    });

    // --- Confidence Slider Logic ---
    const confSlider = document.getElementById("bio-conf-slider");
    const confVal = document.getElementById("bio-conf-val");
    
    // 1. Set initial slider position based on the default config
    confSlider.value = window.BioModelConfig.confidenceThreshold;
    confVal.innerText = parseFloat(confSlider.value).toFixed(2);

    // 2. Listen for drags and update the config live
    confSlider.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      confVal.innerText = val.toFixed(2);
      window.BioModelConfig.confidenceThreshold = val;
    });

    // --- Overlap Slider Logic ---
    const overlapSlider = document.getElementById("bio-overlap-slider");
    const overlapVal = document.getElementById("bio-overlap-val");

    // 1. Set initial slider position
    // (Assuming your audio.js expects overlap as a whole number like 0 to 90)
    overlapSlider.value = window.BioModelConfig.overlapPercentage;
    overlapVal.innerText = overlapSlider.value + "%";

    // 2. Listen for drags
    overlapSlider.addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      overlapVal.innerText = val + "%";
      window.BioModelConfig.overlapPercentage = val / 100;
    });
  }

  log(msg) {
    if (!this.logArea) return;

    // 1. Calculate how far from the bottom the user is (50px buffer)
    const isAtBottom = (this.logArea.scrollHeight - this.logArea.scrollTop) <= (this.logArea.clientHeight + 50);

    // 2. Append the message using the CSS class
    const div = document.createElement("div");
    div.className = "bio-log-entry";
    div.innerHTML = msg;
    this.logArea.appendChild(div);

    // 3. Auto-scroll logic
    if (isAtBottom) {
      setTimeout(() => {
        this.logArea.scrollTo({
          top: this.logArea.scrollHeight,
          behavior: 'instant' 
        });
      }, 10);
    }
  }
}