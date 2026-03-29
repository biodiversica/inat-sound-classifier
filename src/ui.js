// ui.js

/**
 * Manages the extension's UI panel injected into iNaturalist observation pages.
 * Handles model/language dropdowns, settings sliders, log output, and CSV export.
 */
window.iNatSCUI = class iNatSCUI {
  /**
   * Creates and injects the UI panel into the page.
   * @param {Function} onRunCallback - Called when the user clicks "Run Analysis" with `(modelConfig, languageConfig)`.
   * @param {Object} uiInputText - Localized UI strings for the selected language.
   * @param {Function} triggerRebuild - Called when the user changes language to tear down and re-initialize the UI.
   */
  constructor(onRunCallback, uiInputText, triggerRebuild) {
    this.onRunCallback = onRunCallback;
    this.uiInputText = uiInputText;
    this.triggerRebuild = triggerRebuild;
    

    // Inject the HTML skeleton
    this.injectPanel(this.uiInputText);
    
    // Cache DOM elements for easy access later
    this.panel = document.getElementById("insc-model-panel");
    this.content = document.getElementById("insc-content-wrapper");
    this.toggleBtn = document.getElementById("insc-toggle-btn");
    this.logArea = document.getElementById("insc-log-area");
    this.modelSelect = document.getElementById("insc-model-select");
    this.languageSelect = document.getElementById("insc-language-select");
    this.runBtn = document.getElementById("insc-run-btn");
    this.customModelInput = document.getElementById("insc-custom-model");
    this.addCustomBtn = document.getElementById("insc-add-custom-btn");
    this.exportBtn = document.getElementById("insc-export-btn");
    this.clearCacheBtn = document.getElementById("insc-clear-cache-btn");
    
    // Setup initial state
    this.populateDropdown();
    this.populateLanguageDropdown();
    this.setupEventListeners();
  }

  /**
   * Pads or truncates a string to a fixed display width.
   * Strings longer than `length` are truncated with an ellipsis ("...").
   * @param {*} str - The value to format (coerced to string).
   * @param {number} length - Target character width.
   * @returns {string} Fixed-width string.
   */
  pad(str, length) {
    str = String(str); // Ensure it's a string
    if (str.length >= length) {
      return str.substring(0, length - 3) + "..."; // Truncate if too long
    }
    return str + " ".repeat(length - str.length);
  }

  /**
   * Prints a formatted table header row to the log area.
   * @param {number} timeWidth - Column width for the time range.
   * @param {number} speciesWidth - Column width for the species name.
   * @param {number} confidenceWidth - Column width for the confidence score.
   * @param {string} tableClass - CSS class applied to the header row.
   */
  printTableHeader(timeWidth, speciesWidth, confidenceWidth, tableClass) {
    const col1 = this.pad(this.uiInputText.timeCell, timeWidth);
    const col2 = this.pad(this.uiInputText.speciesCell, speciesWidth);
    const col3 = this.pad(this.uiInputText.confidenceCell, confidenceWidth);
    
    this.log(`<b class=${tableClass}>${col1} | ${col2} | ${col3}</b>`);
  }

  /**
   * Removes all entries from the log area.
   */
  clearLog() {
    const logArea = document.getElementById("insc-log-area");
    if (logArea) {
      logArea.innerHTML = ""; // This physically removes the text from the UI
    }
  }

  /**
   * Injects the extension's HTML panel into the page DOM.
   * No-ops if the panel already exists (prevents duplicates on re-runs).
   * @param {Object} inputText - Localized UI strings used for labels and tooltips.
   */
  injectPanel(inputText) {
    // Prevent duplicate panels if the script runs twice
    if (document.getElementById("insc-model-panel")) return;

    const panelDiv = document.createElement("div");
    panelDiv.id = "insc-model-panel";
    
    panelDiv.innerHTML = `
      <div id="insc-header">
        <b>${inputText.extensionName}</b>
        <span id="insc-toggle-btn">−</span>
      </div>
      
      <div id="insc-content-wrapper">
        <div class="insc-controls-row">
          <div>
            <span class="insc-help" data-tooltip="${inputText.bioacousticModelHelp}"><b>${inputText.bioacousticModel}</b></span>
            <select id="insc-model-select"></select>
            <button id="insc-run-btn">${inputText.analysisButton}</button>
          </div>
        </div>
        
        <details>
          <summary class="insc-custom-summary">${inputText.advancedSettings}</summary>
          <div id="insc-settings-panel">
            <div class="insc-setting-row">
              <label class="insc-help" data-tooltip="${inputText.confidenceHelp}">${inputText.confidence}<span id="insc-conf-val"></span></label>
              <input type="range" id="insc-conf-slider" min="0.05" max="0.95" step="0.05">
            </div>
            <div class="insc-setting-row">
              <label class="insc-help" data-tooltip="${inputText.overlapHelp}">${inputText.overlap}<span id="insc-overlap-val"></span></label>
              <input type="range" id="insc-overlap-slider" min="0" max="90" step="10">
            </div>
            <div class="insc-setting-row">
              <span class="insc-help" data-tooltip="${inputText.setLanguageHelp}">${inputText.setLanguage}</span>
              <select id="insc-language-select"></select>
            </div>
            
            <div class="insc-setting-row">
              <details>
                <summary class="insc-help" data-tooltip="${inputText.customModelHelp}">${inputText.customModelSettings}</summary>
                <textarea id="insc-custom-model" placeholder='{"name": "custom-model-name", "version": 1.0, ...}'></textarea>
                <div class="insc-custom-model-instructions">
                  <a href=${window.iNatSCConfig.exampleCustomModelLink} target="_blank"><u>${inputText.customModelInstructions}</u></a>
                  <button id="insc-add-custom-btn">${inputText.addCustomButton}</button>
                </div>
                
              </details>
            </div>
            <div class="insc-setting-row" style="justify-content: center;">
              <button id="insc-clear-cache-btn">${inputText.clearCacheButton}</button>
            </div>
          </div>
        </details>
        
        <div id="insc-log-area"></div>
        <div class="insc-bottom-controls"> 
          <a href="https://biodiversica.xyz" target="_blank" id="insc-biodiversica-link">~/biodiversica</a>
          <button id="insc-export-btn">${inputText.exportButton}</button>
          <button id="insc-clear-btn">${inputText.clearLogsButton}</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(panelDiv);
  }

  /**
   * Populates the model selection dropdown from the global model registry.
   */
  populateDropdown() {
    this.modelSelect.innerHTML = "";
    for (const [key, model] of Object.entries(window.iNatSCConfig.modelRegistry)) {
      const option = document.createElement("option");
      option.value = key;
      option.text = `${model.name} v${model.version}`;
      this.modelSelect.appendChild(option);
    }
  }

  /**
   * Populates the language selection dropdown from available UI translations.
   */
  populateLanguageDropdown() {
    this.languageSelect.innerHTML = "";
    for (const [key, language] of Object.entries(window.iNatSCConfig.uiText)) {
      const option = document.createElement("option");
      option.value = key;
      option.text = `${language.language}`;
      this.languageSelect.appendChild(option);
    }
  }

  /**
   * Binds event listeners for all interactive controls: panel toggle, model run,
   * language switch, custom model input, confidence/overlap sliders, cache clearing,
   * log clearing, and CSV export.
   */
  setupEventListeners() {
    // Toggle Panel Minimization
    document.getElementById("insc-header").addEventListener("click", () => {
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
    this.languageSelect.value = localStorage.getItem('insc-language') || 'en';

    // Listen for the user changing the language
    this.languageSelect.addEventListener("change", (e) => {
      const newLangKey = e.target.value;
      
      // Save the new choice to the browser
      localStorage.setItem('insc-language', newLangKey);

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
      const modelConfig = window.iNatSCConfig.modelRegistry[selectedKey];
      const selectedLanguageKey = this.languageSelect.value;
      const languageConfig = window.iNatSCConfig.uiText[selectedLanguageKey];
      this.onRunCallback(modelConfig, languageConfig);
    });

    // Clear Logs Button
    const clearBtn = document.getElementById("insc-clear-btn");
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
        const deleted = await caches.delete(window.iNatSCConfig.modelCacheLabel);
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
        window.iNatSCConfig.modelRegistry[key] = customJson;
        
        // Save to localStorage
        const customModels = JSON.parse(localStorage.getItem('insc-custom-models') || '{}');
        customModels[key] = customJson;
        localStorage.setItem('insc-custom-models', JSON.stringify(customModels));
        
        this.populateDropdown();
        this.modelSelect.value = key;
        
        this.log(`Added custom model: ${customJson.name}`);
        this.customModelInput.value = ""; // Clear the text area on success
      } catch (e) {
        this.log(`<span style="color:red">Invalid JSON format</span>`);
      }
    });

    // --- Confidence Slider Logic ---
    const confSlider = document.getElementById("insc-conf-slider");
    const confVal = document.getElementById("insc-conf-val");
    
    // Set initial slider position based on the default config
    confSlider.value = window.iNatSCConfig.confidenceThreshold;
    confVal.innerText = parseFloat(confSlider.value).toFixed(2);

    // Listen for drags and update the config live
    confSlider.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      confVal.innerText = val.toFixed(2);
      window.iNatSCConfig.confidenceThreshold = val;
    });

    // --- Overlap Slider Logic ---
    const overlapSlider = document.getElementById("insc-overlap-slider");
    const overlapVal = document.getElementById("insc-overlap-val");

    // Set initial slider position
    overlapSlider.value = window.iNatSCConfig.overlapPercentage;
    overlapVal.innerText = overlapSlider.value + "%";

    // Listen for drags
    overlapSlider.addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      overlapVal.innerText = val + "%";
      window.iNatSCConfig.overlapPercentage = val / 100;
    });
  }

  /**
   * Appends a message to the log area, with optional in-place update.
   * Auto-scrolls to the bottom if the user was already scrolled near the end.
   * @param {string} msg - HTML content to display.
   * @param {string|null} [updateId=null] - If provided, updates an existing entry with this DOM id instead of appending.
   */
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
    div.className = "insc-log-entry";
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

  /**
   * Exports the most recent analysis detections as a CSV file download.
   * The CSV includes start_time, end_time, species, and confidence columns.
   */
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