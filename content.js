// content.js
(async () => {
  let ui;
  let engine;
  let currentAttachedId = null;

  function getObservationId() {
    const meta = document.querySelector("meta[property='og:url']");
    const url = meta?.getAttribute("content");
    const match = url?.match(/\/observations\/(\d+)/);
    return match ? match[1] : null;
  }

  async function runAnalysis(modelConfig, languageConfig) {
    const obsId = getObservationId();
    if (!obsId) return ui.log("<span class='bio-error'>ID Error</span>");

    ui.runBtn.disabled = true;
    ui.runBtn.innerText = languageConfig.tmpRunButton;

    try {
      // ui.log(`Target: Observation ${obsId}`);
      const urls = await window.BioAudio.checkObservationSounds(obsId);
      // if (!urls.length) return ui.log(languageConfig.audioNotFound);

      if (!engine) engine = new window.BioModelEngine(ui);
      await engine.loadModel(modelConfig);

      let soundFileIndex = 1;
      for (const url of urls) {
        ui.log(`<span class="bio-line-header">${languageConfig.analyzingSound} ${soundFileIndex}...</span>`);
        const decoded = await window.BioAudio.decodeAudio(url);
        const samples = await window.BioAudio.resample(decoded, modelConfig.sampleRate);
        const chunks = window.BioAudio.chunkAudio(samples, modelConfig.sampleRate, modelConfig.windowSize, window.BioConfig.overlapPercentage);

        let best = { range:null, name: null, score: 0 };

        ui.printTableHeader(window.BioConfig.timeCellWidth, window.BioConfig.speciesCellWidth, window.BioConfig.confidenceCellWidth, "bio-header");

        for (let i = 0; i < chunks.length; i++) {
          await new Promise(r => setTimeout(r, 0));
          const res = await engine.predictChunk(chunks[i]);
          const t1 = (i * (modelConfig.windowSize * (1 - window.BioConfig.overlapPercentage))).toFixed(1);
          const t2 = (i * (modelConfig.windowSize * (1 - window.BioConfig.overlapPercentage)) + modelConfig.windowSize).toFixed(1);
          if (res.score > window.BioConfig.confidenceThreshold) {
            const speciesName = res.label.split("_")[0].replace(/[\n\r]/g, "").trim();
            const timeRange = `${t1} - ${t2}s`;

            // Format cells with fixed widths
            const col1 = ui.pad(timeRange, window.BioConfig.timeCellWidth);
            const col2 = ui.pad(speciesName, window.BioConfig.speciesCellWidth);
            const col3 = ui.pad(res.score.toFixed(2), window.BioConfig.confidenceCellWidth);
            const slug = speciesName.replace(" ", "_");
            const taxaUrl = `https://www.inaturalist.org/taxa/${slug}`;

            // Log the formatted row
            ui.log(`${col1} | <a href="${taxaUrl}" target="_blank" class="bio-link-taxa-soft"><u><i>${col2}</i></u></a> | ${col3}`);

            if (res.score > best.score) best = { range: timeRange, name: speciesName, score: res.score };
          }
        }

        if (best.name) {
          const slug = best.name.replace(" ", "_");
          const taxaUrl = `https://www.inaturalist.org/taxa/${slug}`;
          ui.log(`<b>${languageConfig.topDetection}:</b>`);
          ui.log(`<b>${ui.pad(best.range, window.BioConfig.timeCellWidth)}</b> | <a href="${taxaUrl}" target="_blank" class='bio-link-taxa'><u><i>${ui.pad(best.name, window.BioConfig.speciesCellWidth)}</i></u></a>  | <b>${ui.pad(best.score.toFixed(2), window.BioConfig.confidenceCellWidth)}</b>`);

          ui.log(`<span class="bio-line-header">${languageConfig.validatingDetection}...</span>`);
          ui.log(`${languageConfig.checkingGBIF} <i>${best.name}</i>`);
          const coords = await window.BioGeo.getObservationCoords(obsId);
          const bbox = await window.BioGeo.getSpeciesBBox(best.name);
          if (!coords) {
              ui.log(`<span class='bio-error'>${languageConfig.coordNotFound}</span>`);
          } else {
             if (!bbox) {
               ui.log(`<span class='bio-error'>${languageConfig.fetchGBIFError} ${best.name}.</span>`);
             } else {
               const isMatch = window.BioGeo.isWithinBBox(coords, bbox);
               const cls = isMatch ? "bio-geo-match" : "bio-geo-mismatch";
               ui.log(`<span class="${cls}">${isMatch ? languageConfig.withinGBIF : languageConfig.outsideGBIF}</span>`);
             }
          }
        } else {
          ui.log(`${languageConfig.noDetection}`);
        }
        ui.log(`<b>${languageConfig.endOfAnalysis}</b>`);
        soundFileIndex += 1;
      }
    } catch (e) {
      ui.log(`<span class="bio-error">Fail: ${e.message}</span>`);
    } finally {
      ui.runBtn.disabled = false;
      ui.runBtn.innerText = languageConfig.analysisButton;
    }
  }

  function triggerRebuild() {
    ui.panel.remove();
    ui = null;
    currentAttachedId = null;
    init(); // Force it to run immediately instead of waiting for the interval
  }

  async function init() {
    const obsId = getObservationId();
    
    // Stop if no ID or if we've already started processing this specific ID
    if (!obsId || obsId === currentAttachedId) return;

    // LOCK THE STATE
    // This prevents the setInterval from spamming the API while waiting for the fetch.
    currentAttachedId = obsId;

    try {
      // Check if this observation actually has audio files
      const audioUrls = await window.BioAudio.checkObservationSounds(obsId);
      
      // Handle the "No Audio" scenario
      if (!audioUrls || audioUrls.length === 0) {
        // If the UI exists (from a previous observation), hide it
        if (ui && ui.panel) {
          ui.panel.style.setProperty('display', 'none', 'important');
        }
        return; // Stop execution here
      }

      //Get saved language (default to 'en' if null)
      const savedLang = localStorage.getItem('bio-language') || 'en';

      // Get language setting
      const uiInputText = window.BioConfig.uiText[savedLang];

      // Handle the "Audio Found" scenario
      if (!ui) {
        // First time seeing audio on this session, build the UI
        ui = new window.BioUI(runAnalysis, uiInputText, triggerRebuild);
      } else {
        // UI already exists, just reveal it and clear old logs
        ui.panel.style.setProperty('display', 'flex', 'important'); 
        ui.clearLog();
      }

      ui.log(`${uiInputText.initLog} <b>'${uiInputText.analysisButton}'</b>`);
      
    } catch (error) {
      console.warn("[iNaturalist Sound Classifier] Failed to check for sounds in this observation.", error);
      // Reset the ID so the interval tries again on the next tick
      currentAttachedId = null; 
    }
  }

  // Handle iNaturalist's dynamic page transitions
  setInterval(init, 2000);
  init();
})();