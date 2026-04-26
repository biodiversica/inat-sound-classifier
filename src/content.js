// content.js
(async () => {
  let ui;
  let engine;
  let currentAttachedId = null;

  /**
   * Extracts the iNaturalist observation ID from the page's og:url meta tag.
   * @returns {string|null} The numeric observation ID, or null if not found.
   */
  function getObservationId() {
    const meta = document.querySelector("meta[property='og:url']");
    const url = meta?.getAttribute("content");
    const match = url?.match(/\/observations\/(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Extracts latitude/longitude from iNaturalist-specific meta tags in the DOM.
   * @returns {{lat: number, lon: number}|null} Coordinates, or null if not present.
   */
  function getObservationLocation() {
    // iNaturalist stores coords in the map link or global variables.
    // Example checking a common metadata tag or DOM element:
    const latElement = document.querySelector('meta[property="inat:latitude"]');
    const lonElement = document.querySelector('meta[property="inat:longitude"]');
    
    if (latElement && lonElement) {
      return {
        lat: parseFloat(latElement.content),
        lon: parseFloat(lonElement.content)
      };
    }
    return null; // Observation has no location data
  }

  /**
   * Checks whether observation coordinates fall within a model's geographic bounding box.
   * @param {number} obsLat - Observation latitude.
   * @param {number} obsLon - Observation longitude.
   * @param {number[]|null} bbox - Bounding box as [minLat, minLon, maxLat, maxLon], or null for global models.
   * @returns {boolean} `true` if inside the box or if the model has no bbox restriction.
   */
  function isWithinBBox(obsLat, obsLon, bbox) {
    if (!bbox) return true; // Global model (no bbox restrictions)
    
    const [minLat, minLon, maxLat, maxLon] = bbox;
    return (obsLat >= minLat && obsLat <= maxLat && obsLon >= minLon && obsLon <= maxLon);
  }

  /**
   * Builds the global model registry by loading model zoo JSON files and
   * filtering them against the current observation's geographic location.
   * Also loads any user-added custom models from localStorage.
   * @returns {Promise<void>}
   */
  async function loadGeographicModelRegistry() {
    window.iNatSCConfig.modelRegistry = {}; // Clear existing
    const obsLocation = getObservationLocation();

    try {
      // 1. Fetch the index of available models
      const indexUrl = api.runtime.getURL("model_zoo/index.json");
      const indexRes = await fetch(indexUrl);
      const modelFiles = await indexRes.json();

      // 2. Fetch and evaluate each model
      for (const file of modelFiles) {
        const modelUrl = api.runtime.getURL(`model_zoo/${file}`);
        const modelRes = await fetch(modelUrl);
        const modelData = await modelRes.json();

        // 3. Geographic Validation Check
        let shouldAddModel = true;
        if (modelData.bbox && obsLocation) {
          shouldAddModel = isWithinBBox(obsLocation.lat, obsLocation.lon, modelData.bbox);
        } else if (modelData.bbox && !obsLocation) {
          // Decide what to do if the model requires a location but the observation is hidden/missing coords.
          // Usually safer to exclude it to prevent false positives.
          shouldAddModel = true; 
        }

        if (shouldAddModel) {
          // Add to the global registry using the JSON 'id' as the key
          window.iNatSCConfig.modelRegistry[modelData.id] = modelData;
        }
      }

      // Load custom models from localStorage
      const customModels = JSON.parse(localStorage.getItem('insc-custom-models') || '{}');
      for (const [key, model] of Object.entries(customModels)) {
        // Apply the same geographic validation as built-in models
        let shouldAddModel = true;
        if (model.bbox && obsLocation) {
          shouldAddModel = isWithinBBox(obsLocation.lat, obsLocation.lon, model.bbox);
        } else if (model.bbox && !obsLocation) {
          // If model requires location but observation has none, exclude it
          shouldAddModel = false;
        }
        // If no bbox, it's global and should be included

        if (shouldAddModel) {
          window.iNatSCConfig.modelRegistry[key] = model;
        }
      }

      console.log("[iNaturalist Sound Classifier] Valid models for this location:", Object.keys(window.iNatSCConfig.modelRegistry));

    } catch (error) {
      console.error("[iNaturalist Sound Classifier] Failed to load model registry:", error);
    }
  }

  /**
   * Loads all available UI language translations from bundled JSON files
   * into the global config.
   * @returns {Promise<void>}
   */
  async function loadLanguageOptions() {
    window.iNatSCConfig.uiText = {}; // Clear existing

    try {
      const indexUrl = api.runtime.getURL("language/index.json");
      const indexRes = await fetch(indexUrl);
      const languageFiles = await indexRes.json();

      for (const file of languageFiles) {
        const languageUrl = api.runtime.getURL(`language/${file}`);
        const languageRes = await fetch(languageUrl);
        const languageData = await languageRes.json();

        window.iNatSCConfig.uiText[languageData.id] = languageData;
      }
    } catch (error) {
      console.error("[iNaturalist Sound Classifier] Failed to load language options:", error);
    }
  }

  /**
   * Main analysis pipeline: loads the selected model, decodes all sound files,
   * runs chunk-by-chunk inference, validates top detections against GBIF/iNaturalist
   * geographic data, and logs results. The inference worker is terminated on completion
   * to reclaim WASM memory.
   * @param {Object} modelConfig - Model configuration from the model zoo.
   * @param {Object} languageConfig - Localized UI strings for the selected language.
   * @returns {Promise<void>}
   */
  async function runAnalysis(modelConfig, languageConfig) {
    const obsId = getObservationId();
    if (!obsId) return ui.log("<span class='insc-error'>ID Error</span>");

    ui.runBtn.disabled = true;
    ui.runBtn.innerText = languageConfig.tmpRunButton;

    try {
      // ui.log(`Target: Observation ${obsId}`);
      const urls = await window.iNatSCAudio.checkObservationSounds(obsId);
      // if (!urls.length) return ui.log(languageConfig.audioNotFound);

      if (!engine) engine = new window.iNatSCModelEngine(ui);
      await engine.loadModel(modelConfig);

      let detections = [];
      let soundFileIndex = 1;
      for (const url of urls) {
        ui.log(`<span class="insc-line-header">${languageConfig.analyzingSound} ${soundFileIndex}...</span>`);
        const decoded = await window.iNatSCAudio.decodeAudio(url);
        const samples = await window.iNatSCAudio.resample(decoded, modelConfig.sampleRate);
        const chunks = window.iNatSCAudio.chunkAudio(samples, modelConfig.sampleRate, modelConfig.windowSize, window.iNatSCConfig.overlapPercentage);

        ui.printTableHeader(window.iNatSCConfig.timeCellWidth, window.iNatSCConfig.speciesCellWidth, window.iNatSCConfig.confidenceCellWidth, "insc-header");

        for (let i = 0; i < chunks.length; i++) {
          await new Promise(r => setTimeout(r, 0));
          const res = await engine.predictChunk(chunks[i]);
          const t1 = (i * (modelConfig.windowSize * (1 - window.iNatSCConfig.overlapPercentage))).toFixed(1);
          const t2 = (i * (modelConfig.windowSize * (1 - window.iNatSCConfig.overlapPercentage)) + modelConfig.windowSize).toFixed(1);
          if (res.score > window.iNatSCConfig.confidenceThreshold) {
            const speciesName = res.label.replace(/[\n\r]/g, "").trim();
            const timeRange = `${t1} - ${t2}s`;

            // Format cells with fixed widths
            const col1 = ui.pad(timeRange, window.iNatSCConfig.timeCellWidth);
            const col2 = ui.pad(speciesName, window.iNatSCConfig.speciesCellWidth);
            const col3 = ui.pad(res.score.toFixed(2), window.iNatSCConfig.confidenceCellWidth);
            const slug = speciesName.replace(" ", "_");
            const taxaUrl = `https://www.inaturalist.org/taxa/${slug}`;

            // Log the formatted row
            ui.log(`${col1} | <a href="${taxaUrl}" target="_blank" class="insc-link-taxa-soft"><u><i>${col2}</i></u></a> | ${col3}`);

            detections.push({ timeRange, speciesName, score: res.score });
          }
        }

        soundFileIndex += 1;
      }

      // Store data for export
      window.lastAnalysisData = { detections, obsId, modelName: modelConfig.name };

      if (detections.length > 0) {
        ui.log(`<span class="insc-line-header">${languageConfig.validatingDetection}...</span>`);
        const coords = await window.iNatSCGeo.getObservationCoords(obsId);
        if (!coords) {
          ui.log(`<span class='insc-error'>${languageConfig.coordNotFound}</span>`);
        } else {
          // Get unique species
          const uniqueSpecies = [...new Set(detections.map(d => d.speciesName))];
          ui.log(`${languageConfig.checkingGBIF} ${uniqueSpecies.length} species...`);
          const bboxes = {};
          // Fetch bboxes from both GBIF and iNaturalist in parallel
          const gbifPromises = uniqueSpecies.map(species => window.iNatSCGeo.getSpeciesBBox(species));
          const inatPromises = uniqueSpecies.map(species => window.iNatSCGeo.getiNaturalistSpeciesBBox(species));
          const [gbifArray, inatArray] = await Promise.all([Promise.all(gbifPromises), Promise.all(inatPromises)]);
          uniqueSpecies.forEach((species, i) => {
            bboxes[species] = { gbif: gbifArray[i], inat: inatArray[i] };
          });

          const validDetections = detections.filter(d => {
            const bbox = bboxes[d.speciesName];
            const gbifValid = bbox.gbif && window.iNatSCGeo.isWithinBBox(coords, bbox.gbif);
            const inatValid = bbox.inat && window.iNatSCGeo.isWithinBBox(coords, bbox.inat);
            return gbifValid || inatValid;
          });

          if (validDetections.length > 0) {
            const top = validDetections.reduce((max, d) => d.score > max.score ? d : max);
            const slug = top.speciesName.replace(" ", "_");
            const taxaUrl = `https://www.inaturalist.org/taxa/${slug}`;
            ui.log(`<b>${languageConfig.topDetection}:</b>`);
            ui.log(`<b>${ui.pad(top.timeRange, window.iNatSCConfig.timeCellWidth)}</b> | <a href="${taxaUrl}" target="_blank" class='insc-link-taxa'><u><i>${ui.pad(top.speciesName, window.iNatSCConfig.speciesCellWidth)}</i></u></a>  | <b>${ui.pad(top.score.toFixed(2), window.iNatSCConfig.confidenceCellWidth)}</b>`);
            
            // Determine validation status for the top species
            const bbox = bboxes[top.speciesName];
            const gbifValid = bbox.gbif && window.iNatSCGeo.isWithinBBox(coords, bbox.gbif);
            const inatValid = bbox.inat && window.iNatSCGeo.isWithinBBox(coords, bbox.inat);
            
            let validationMessage;
            let messageClass;
            if (gbifValid && inatValid) {
              validationMessage = languageConfig.withinBoth;
              messageClass = "insc-geo-match";
            } else if (gbifValid) {
              validationMessage = languageConfig.withinGBIFOnly;
              messageClass = "insc-geo-match";
            } else if (inatValid) {
              validationMessage = languageConfig.withinINatOnly;
              messageClass = "insc-geo-match";
            } else {
              validationMessage = languageConfig.outsideBoth;
              messageClass = "insc-geo-mismatch";
            }
            
            ui.log(`<span class="${messageClass}">${validationMessage}</span>`);
          } else {
            ui.log(`${languageConfig.noDetection}`);
          }
        }
      } else {
        ui.log(`${languageConfig.noDetection}`);
      }
      ui.log(`<b>${languageConfig.endOfAnalysis}</b>`);
      // ui.log(`<span class="insc-error">Fail: ${e.message}</span>`);
    } catch (e) {
      ui.log(`<span class="insc-error">${languageConfig.failedAnalysis}: ${e.message}</span>`);
    } finally {
      // Terminate the worker to reclaim WASM memory.
      // WebAssembly.Memory can grow but never shrink; the only way
      // to free it is to terminate the worker holding the WASM instance.
      if (engine) engine.terminateWorker();
      ui.runBtn.disabled = false;
      ui.runBtn.innerText = languageConfig.analysisButton;
    }
  }

  /**
   * Tears down the current UI panel and re-initializes from scratch.
   * Called when the user switches the display language.
   */
  function triggerRebuild() {
    ui.panel.remove();
    ui = null;
    currentAttachedId = null;
    init(); // Force it to run immediately instead of waiting for the interval
  }

  /**
   * Entry point: detects the current observation, checks for audio files,
   * loads the model registry and language options, resolves the user's preferred
   * language, and creates or reveals the UI panel. Called on page load and
   * periodically to handle iNaturalist's dynamic page transitions.
   * @returns {Promise<void>}
   */
  async function init() {
    const obsId = getObservationId();
    
    // Stop if no ID or if we've already started processing this specific ID
    if (!obsId || obsId === currentAttachedId) return;

    // LOCK THE STATE
    // This prevents the setInterval from spamming the API while waiting for the fetch.
    currentAttachedId = obsId;

    try {
      // Check if this observation actually has audio files
      const audioUrls = await window.iNatSCAudio.checkObservationSounds(obsId);
      
      // Handle the "No Audio" scenario
      if (!audioUrls || audioUrls.length === 0) {
        // If the UI exists (from a previous observation), hide it
        if (ui && ui.panel) {
          ui.panel.style.setProperty('display', 'none', 'important');
        }
        return; // Stop execution here
      }

      // Dynamically build the registry based on location
      await loadGeographicModelRegistry();
      
      // IF the registry is empty (no models cover this area)
      if (Object.keys(window.iNatSCConfig.modelRegistry).length === 0) {
        console.log("[iNaturalist Sound Classifier] No models available for this geographic region.");
        return; 
      }

      // Load language options
      await loadLanguageOptions();

      // Get the list of IDs we actually have files for (e.g., ['en', 'pt_BR'])
      const availableLangs = Object.keys(window.iNatSCConfig.uiText);

      // Determine the target language key
      // Priority: 1. Manual Save | 2. Browser Language | 3. English
      let targetLang = localStorage.getItem('insc-language');

      if (!targetLang) {
        const browserLang = navigator.language; //.replace('-', '_');
        
        // Check if we have an exact match (pt-BR) or a partial match (en)
        if (availableLangs.includes(browserLang)) {
          targetLang = browserLang;
        } else {
          // Check if the short version exists (e.g., if browser is 'en-GB', check 'en')
          const shortLang = browserLang.split('_')[0];
          targetLang = availableLangs.includes(shortLang) ? shortLang : 'en';
        }
      }

      // Fetch language dictionary
      const uiInputText = window.iNatSCConfig.uiText[targetLang] || window.iNatSCConfig.uiText['en'];

      if (!uiInputText) {
        console.error("[iNaturalist Sound Classifier] Language initialization failed. Fallback to English.");
        return;
      }

      // Handle the "Audio Found" scenario
      if (!ui) {
        // First time seeing audio on this session, build the UI
        ui = new window.iNatSCUI(runAnalysis, uiInputText, triggerRebuild);
      } else {
        // UI already exists, just reveal it and clear old logs
        ui.panel.style.setProperty('display', 'flex', 'important'); 
        ui.clearLog();
      }

      ui.log(`${uiInputText.initLog} <b>'${uiInputText.analysisButton}'</b>`);

      if (navigator.userAgentData) {
        const { bitness } = await navigator.userAgentData.getHighEntropyValues(['bitness']);
        if (bitness === '32') {
          ui.log(`<span class="insc-error">⚠ ${uiInputText.browser32bitWarning}</span>`);
        }
      } else if (navigator.userAgent.includes('WOW64')) {
        ui.log(`<span class="insc-error">⚠ ${uiInputText.browser32bitWarning}</span>`);
      }
      
    } catch (error) {
      console.warn("[iNaturalist Sound Classifier] Failed to check for sounds in this observation.", error);
      // Reset the ID so the interval tries again on the next tick
      currentAttachedId = null; 
    }
  }

  // Handle iNaturalist's dynamic page transitions
  setInterval(init, window.iNatSCConfig.dynamicPageInterval);
  init();
})();