(async () => {
  let ui;
  let engine;

  function getObservationId() {
    const meta = document.querySelector("meta[property='og:url']");
    const url = meta?.getAttribute("content");
    const match = url?.match(/\/observations\/(\d+)/);
    return match ? match[1] : null;
  }

  async function runAnalysis(modelConfig) {
    const obsId = getObservationId();
    if (!obsId) {
      ui.log("No observation ID found on this page.");
      return;
    }

    ui.runBtn.disabled = true;
    ui.runBtn.innerText = "Running...";

    try {
      ui.log(`Fetching audio for observation ${obsId}...`);
      const urls = await window.BioAudio.fetchObservationAudio(obsId);
      
      if (!urls.length) { ui.log("No sounds found."); return; }

      for (const url of urls) {
        // ... (audio decoding & model loading code remains the same) ...
        const decoded = await window.BioAudio.decodeAudio(url);
        const samples = await window.BioAudio.resample(decoded, modelConfig.sampleRate);
        const chunks = window.BioAudio.chunkAudio(samples, modelConfig.sampleRate, modelConfig.windowSize, window.BioModelConfig.overlapPercentage);

        ui.log(`Selected model: <a href="${modelConfig.about}" target="_blank" style="color:#0ff">${modelConfig.name} v${modelConfig.version}</a>`);
        await engine.loadModel(modelConfig);
        ui.log(`Analyzing ${chunks.length} chunks...`);

        // Track the absolute best detection for this audio file
        let bestOverall = { name: null, score: 0 };

        for (let i = 0; i < chunks.length; i++) {
          await new Promise(resolve => setTimeout(resolve, 0)); 
          const res = await engine.predictChunk(chunks[i]);
          
          const t1 = (i * (modelConfig.windowSize * (1 - window.BioModelConfig.overlapPercentage))).toFixed(1);
          const t2 = (i * (modelConfig.windowSize * (1 - window.BioModelConfig.overlapPercentage)) + modelConfig.windowSize).toFixed(1);
          
          if (res.score > window.BioModelConfig.confidenceThreshold) {
            const sciName = res.label.split("_")[0];
            // const slug = sciName.replace(" ", "_");
            // const taxaUrl = `https://www.inaturalist.org/taxa/${slug}`;
            // ui.log(`${t1} - ${t2}s : <a href="${taxaUrl}" target="_blank" style="color:#0f0"><i>${sciName}</i></a> (${res.score.toFixed(2)})`);
            ui.log(`${t1} - ${t2}s : <i>${sciName}</i> (${res.score.toFixed(2)})`);
            

            // Update highest score
            if (res.score > bestOverall.score) {
              bestOverall = { name: sciName, score: res.score };
            }
          }
        }
        
        // --- NEW: Geographic Validation Step ---
        if (bestOverall.name) {
          const slug = bestOverall.name.replace(" ", "_");
          const taxaUrl = `https://www.inaturalist.org/taxa/${slug}`;
          ui.log(`<br><b style="color:#0ff">--- Geo Validation ---</b>`);
          ui.log(`Top detection:  <a href="${taxaUrl}" target="_blank" style="color:#FF00FF"><u><i>${bestOverall.name}</i></u></a> (${bestOverall.score.toFixed(2)})`);
          ui.log(`Fetching GBIF & iNat coordinates...`);
          
          const coords = await window.BioGeo.getObservationCoords(obsId);
          if (!coords) {
            ui.log(`<span style="color:#f90">Could not find coordinates for this observation.</span>`);
          } else {
            const bbox = await window.BioGeo.getSpeciesBBox(bestOverall.name);
            if (!bbox) {
              ui.log(`<span style="color:#f90">Could not fetch GBIF range for ${bestOverall.name}.</span>`);
            } else {
              const isMatch = window.BioGeo.isWithinBBox(coords, bbox);
              if (isMatch) {
                ui.log(`<span style="color:#0f0">✓ Geographic match!</span> Obs coords (${coords.lat.toFixed(2)}, ${coords.lon.toFixed(2)}) are within the GBIF bounding box.`);
              } else {
                ui.log(`<span style="color:#f55">⚠ Geographic mismatch.</span> Obs coords are outside the known GBIF bounding box.`);
              }
            }
          }
        } else {
          ui.log(`No species detected above threshold.`);
        }
        ui.log("--- Analysis Complete ---<br>");
      }
    } catch (e) {
      ui.log(`<span style="color:red">Error: ${e.message}</span>`);
      console.error(e);
    } finally {
      ui.runBtn.disabled = false;
      ui.runBtn.innerText = "Run Analysis";
    }
  }



  function init() {
    if (document.getElementById("model-panel")) return; // Prevent duplicates
    
    const obsId = getObservationId();
    if (obsId) {
      ui = new window.BioUI(runAnalysis);
      engine = new window.BioModelEngine(ui);
      ui.log("Observation detected. Select a model and press Run.");
    }
  }

  // Monitor DOM for SPA navigation (iNaturalist uses Turbolinks/React routing sometimes)
  const observer = new MutationObserver(init);
  observer.observe(document.body, { childList: true, subtree: true });
  init();
})();