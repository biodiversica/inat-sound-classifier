// ui.js
window.BioUI = class BioUI {
  constructor(onRunCallback, uiInputText, triggerRebuild) {
    this.onRunCallback = onRunCallback;
    this.uiInputText = uiInputText;
    this.triggerRebuild = triggerRebuild;
    

    // Inject the HTML skeleton
    this.injectPanel(this.uiInputText);
    
    // Cache DOM elements for easy access later
    this.panel = document.getElementById("bio-model-panel");
    this.content = document.getElementById("bio-content-wrapper");
    this.toggleBtn = document.getElementById("bio-toggle-btn");
    this.logArea = document.getElementById("bio-log-area");
    this.modelSelect = document.getElementById("bio-model-select");
    this.languageSelect = document.getElementById("bio-language-select");
    this.runBtn = document.getElementById("bio-run-btn");
    this.customModelInput = document.getElementById("bio-custom-model");
    this.addCustomBtn = document.getElementById("bio-add-custom-btn");
    this.exportBtn = document.getElementById("bio-export-btn");
    this.clearCacheBtn = document.getElementById("bio-clear-cache-btn");
    
    // Setup initial state
    this.populateDropdown();
    this.populateLanguageDropdown();
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
  printTableHeader(timeWidth, speciesWidth, confidenceWidth, tableClass) {
    const col1 = this.pad(this.uiInputText.timeCell, timeWidth);
    const col2 = this.pad(this.uiInputText.speciesCell, speciesWidth);
    const col3 = this.pad(this.uiInputText.confidenceCell, confidenceWidth);
    
    this.log(`<b class=${tableClass}>${col1} | ${col2} | ${col3}</b>`);
  }

  clearLog() {
    const logArea = document.getElementById("bio-log-area");
    if (logArea) {
      logArea.innerHTML = ""; // This physically removes the text from the UI
    }
  }

  injectPanel(inputText) {
    // Prevent duplicate panels if the script runs twice
    if (document.getElementById("bio-model-panel")) return;

    const panelDiv = document.createElement("div");
    panelDiv.id = "bio-model-panel";
    
    panelDiv.innerHTML = `
      <div id="bio-header">
        <b>${inputText.extensionName}</b>
        <span id="bio-toggle-btn">−</span>
      </div>
      
      <div id="bio-content-wrapper">
        <div class="bio-controls-row">
          <div>
            <span class="bio-help" data-tooltip="${inputText.bioacousticModelHelp}"><b>${inputText.bioacousticModel}</b></span>
            <select id="bio-model-select"></select>
            <button id="bio-run-btn">${inputText.analysisButton}</button>
          </div>
        </div>
        
        <details>
          <summary class="bio-custom-summary">${inputText.advancedSettings}</summary>
          <div id="bio-settings-panel">
            <div class="bio-setting-row">
              <label class="bio-help" data-tooltip="${inputText.confidenceHelp}">${inputText.confidence}<span id="bio-conf-val"></span></label>
              <input type="range" id="bio-conf-slider" min="0.05" max="0.95" step="0.05">
            </div>
            <div class="bio-setting-row">
              <label class="bio-help" data-tooltip="${inputText.overlapHelp}">${inputText.overlap}<span id="bio-overlap-val"></span></label>
              <input type="range" id="bio-overlap-slider" min="0" max="90" step="10">
            </div>
            <div class="bio-setting-row">
              <span class="bio-help" data-tooltip="${inputText.setLanguageHelp}">${inputText.setLanguage}</span>
              <select id="bio-language-select"></select>
            </div>
            
            <div class="bio-setting-row">
              <details>
                <summary class="bio-help" data-tooltip="${inputText.customModelHelp}">${inputText.customModelSettings}</summary>
                <textarea id="bio-custom-model" placeholder='{"name": "custom-model-name", "version": 1.0, ...}'></textarea>
                <button id="bio-add-custom-btn">${inputText.addCustomButton}</button>
              </details>
            </div>
            <div class="bio-setting-row" style="justify-content: center;">
              <button id="bio-clear-cache-btn">${inputText.clearCacheButton}</button>
            </div>
          </div>
        </details>
        
        <div id="bio-log-area"></div>
        <div class="bio-bottom-controls"> 
          <button id="bio-export-btn">${inputText.exportButton}</button>
          <button id="bio-clear-btn">${inputText.clearLogsButton}</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(panelDiv);
  }

  populateDropdown() {
    this.modelSelect.innerHTML = "";
    for (const [key, model] of Object.entries(window.BioConfig.modelRegistry)) {
      const option = document.createElement("option");
      option.value = key;
      option.text = `${model.name} v${model.version}`;
      this.modelSelect.appendChild(option);
    }
  }

  populateLanguageDropdown() {
    this.languageSelect.innerHTML = "";
    for (const [key, language] of Object.entries(window.BioConfig.uiText)) {
      const option = document.createElement("option");
      option.value = key;
      option.text = `${language.language}`;
      this.languageSelect.appendChild(option);
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

    // Ensure the dropdown displays the currently active language
    this.languageSelect.value = localStorage.getItem('bio-language') || 'en';

    // Listen for the user changing the language
    this.languageSelect.addEventListener("change", (e) => {
      const newLangKey = e.target.value;
      
      // Save the new choice to the browser
      localStorage.setItem('bio-language', newLangKey);

      // --- THE "SOFT RESET" TRICK ---
      // Physically remove the UI from the webpage
      if (this.panel) this.panel.remove(); 
      
      // Reset the global variables in content.js 
      // (Assuming these are globally accessible. If they are in a module, 
      // you might need to pass a "reset" callback to your UI class)
      this.triggerRebuild();
      
      // Now, within 1 to 2 seconds, your existing setInterval will say 
      // "Hey, there's no UI here!" and trigger init() again, 
      // reading the new language from localStorage!
    });

    // Run Analysis Button
    this.runBtn.addEventListener("click", () => {
      const selectedKey = this.modelSelect.value;
      const modelConfig = window.BioConfig.modelRegistry[selectedKey];
      const selectedLanguageKey = this.languageSelect.value;
      const languageConfig = window.BioConfig.uiText[selectedLanguageKey];
      this.onRunCallback(modelConfig, languageConfig);
    });

    // Clear Logs Button
    const clearBtn = document.getElementById("bio-clear-btn");
    clearBtn.addEventListener("click", () => {
      this.clearLog();
      this.log(`${this.uiInputText.initLog} <b>'${this.uiInputText.analysisButton}'</b>`);
    });

    // Export CSV Button
    this.exportBtn.addEventListener("click", () => {
      this.exportDetections();
    });

    // Clear Cache Button
    this.clearCacheBtn.addEventListener("click", async () => {
      try {
        const deleted = await caches.delete(window.BioConfig.modelCacheLabel);
        if (deleted) {
          this.log(this.uiInputText.cacheCleared);
        } else {
          this.log(this.uiInputText.cacheNotFound);
        }
      } catch (e) {
        this.log(this.uiInputText.cacheClearError + " " + e.message);
      }
    });

    // Add Custom Model Button
    this.addCustomBtn.addEventListener("click", () => {
      try {
        const customJson = JSON.parse(this.customModelInput.value);
        const key = "custom_" + Date.now();
        window.BioConfig.modelRegistry[key] = customJson;
        
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
    
    // Set initial slider position based on the default config
    confSlider.value = window.BioConfig.confidenceThreshold;
    confVal.innerText = parseFloat(confSlider.value).toFixed(2);

    // Listen for drags and update the config live
    confSlider.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      confVal.innerText = val.toFixed(2);
      window.BioConfig.confidenceThreshold = val;
    });

    // --- Overlap Slider Logic ---
    const overlapSlider = document.getElementById("bio-overlap-slider");
    const overlapVal = document.getElementById("bio-overlap-val");

    // Set initial slider position
    overlapSlider.value = window.BioConfig.overlapPercentage;
    overlapVal.innerText = overlapSlider.value + "%";

    // Listen for drags
    overlapSlider.addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      overlapVal.innerText = val + "%";
      window.BioConfig.overlapPercentage = val / 100;
    });
  }

  log(msg, updateId = null) {
    if (!this.logArea) return;

    if (updateId) {
      const existing = document.getElementById(updateId);
      if (existing) {
        existing.innerHTML = msg;
        return;
      }
    }

    // Calculate how far from the bottom the user is (50px buffer)
    const isAtBottom = (this.logArea.scrollHeight - this.logArea.scrollTop) <= (this.logArea.clientHeight + 50);

    // Append the message using the CSS class
    const div = document.createElement("div");
    div.className = "bio-log-entry";
    if (updateId) div.id = updateId;
    div.innerHTML = msg;
    this.logArea.appendChild(div);

    // Auto-scroll logic
    if (isAtBottom) {
      setTimeout(() => {
        this.logArea.scrollTo({
          top: this.logArea.scrollHeight,
          behavior: 'instant' 
        });
      }, 10);
    }
  }

  exportDetections() {
    if (!window.lastAnalysisData) {
      this.log(`${this.uiInputText.noDetectionsToExport}`);
      return;
    }
    const { detections, obsId, modelName } = window.lastAnalysisData;
    const csv = "start_time,end_time,species,confidence\n" + detections.map(d => {
      const [start, end] = d.timeRange.split(' - ').map(t => t.replace('s', ''));
      return `${start},${end},${d.speciesName},${d.score}`;
    }).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${obsId}_${modelName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.log(`${this.uiInputText.exportMessage} ${obsId}_${modelName}.csv`);
  }
}