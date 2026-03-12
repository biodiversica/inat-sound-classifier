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

  async function runAnalysis(modelConfig) {
    const obsId = getObservationId();
    if (!obsId) return ui.log("<span class='bio-error'>ID Error</span>");

    ui.runBtn.disabled = true;
    ui.runBtn.innerText = "Analyzing...";

    try {
      ui.log(`Target: Observation ${obsId}`);
      const urls = await window.BioAudio.checkObservationSounds(obsId);
      if (!urls.length) return ui.log("No audio found.");

      if (!engine) engine = new window.BioModelEngine(ui);
      await engine.loadModel(modelConfig);

      let soundFileIndex = 1;
      for (const url of urls) {
        ui.log(`<span class="bio-line-header">Analyzing sound ${soundFileIndex}...</span>`);
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

            // Log the formatted row
            ui.log(`${col1} | <i>${col2}</i> | ${col3}`);

            if (res.score > best.score) best = { range: timeRange, name: speciesName, score: res.score };
          }
        }

        if (best.name) {
          const slug = best.name.replace(" ", "_");
          const taxaUrl = `https://www.inaturalist.org/taxa/${slug}`;
          ui.log(`<b>Top detection:</b>`);
          ui.log(`<b>${ui.pad(best.range, window.BioConfig.timeCellWidth)}</b> | <a href="${taxaUrl}" target="_blank" class='bio-link-taxa'><u><i>${ui.pad(best.name, window.BioConfig.speciesCellWidth)}</i></u></a>  | <b>${ui.pad(best.score.toFixed(2), window.BioConfig.confidenceCellWidth)}</b>`);

          ui.log(`<span class="bio-line-header">Validating top detection species location...</span>`);
          ui.log(`Checking GBIF coordinate range for <i>${best.name}</i>`);
          const coords = await window.BioGeo.getObservationCoords(obsId);
          const bbox = await window.BioGeo.getSpeciesBBox(best.name);
          if (!coords) {
              ui.log(`<span class='bio-error'>Could not find coordinates for this observation.</span>`);
          } else {
             if (!bbox) {
               ui.log(`<span class='bio-error'>Could not fetch GBIF range for ${best.name}.</span>`);
             } else {
               const isMatch = window.BioGeo.isWithinBBox(coords, bbox);
               const cls = isMatch ? "bio-geo-match" : "bio-geo-mismatch";
               ui.log(`<span class="${cls}">${isMatch ? "✓ Within GBIF bounding box for this species" : "⚠ Outside GBIF bounding box for this species"}</span>`);
             }
          }
        } else {
          ui.log(`No species detected above threshold.`);
        }
        ui.log(`<b>End of Analysis.</b>`);
        soundFileIndex += 1;
      }
    } catch (e) {
      ui.log(`<span class="bio-error">Fail: ${e.message}</span>`);
    } finally {
      ui.runBtn.disabled = false;
      ui.runBtn.innerText = "Run Analysis";
    }
  }

  async function init() {
    const obsId = getObservationId();
    
    // Stop if no ID or if we've already started processing this specific ID
    if (!obsId || obsId === currentAttachedId) return;

    // 1. LOCK THE STATE IMMEDIATELY! 
    // This prevents the setInterval from spamming the API while we wait for the fetch.
    currentAttachedId = obsId;

    try {
      // 2. Check if this observation actually has audio files
      const audioUrls = await window.BioAudio.checkObservationSounds(obsId);
      
      // 3. Handle the "No Audio" scenario
      if (!audioUrls || audioUrls.length === 0) {
        // If the UI exists (from a previous observation), hide it
        if (ui && ui.panel) {
          ui.panel.style.setProperty('display', 'none', 'important');
        }
        return; // Stop execution here
      }

      // 4. Handle the "Audio Found" scenario
      if (!ui) {
        // First time seeing audio on this session, build the UI
        ui = new window.BioUI(runAnalysis);
      } else {
        // UI already exists, just reveal it and clear old logs
        ui.panel.style.setProperty('display', 'flex', 'important'); 
        ui.clearLog();
      }

      ui.log("Select a model and press <b>'Run Analysis'</b>");
      
    } catch (error) {
      console.warn("BioAcoustics: Failed to check for audio.", error);
      // Reset the ID so the interval tries again on the next tick
      currentAttachedId = null; 
    }
  }

  // Handle iNaturalist's dynamic page transitions
  setInterval(init, 2000);
  init();
})();