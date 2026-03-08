window.BioUI = class BioUI {
  constructor(onRunCallback) {
    this.onRunCallback = onRunCallback;
    this.panel = this.createPanel();
    this.logArea = document.getElementById("bio-log-area");
    this.modelSelect = document.getElementById("bio-model-select");
    this.runBtn = document.getElementById("bio-run-btn");
    
    this.populateDropdown();
    this.setupEventListeners();
  }

  createPanel() {
    const panel = document.createElement("div");
    panel.id = "model-panel";
    panel.style.position = "fixed";
    panel.style.bottom = "10px";
    panel.style.right = "10px";
    panel.style.width = "520px";
    panel.style.background = "rgba(0,0,0,0.85)";
    panel.style.color = "#0f0";//"#74ac00"; //
    panel.style.fontFamily = "'Courier New', monospace !important";
    panel.style.fontSize = "14px";
    panel.style.padding = "10px";
    panel.style.zIndex = "999999";
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.gap = "8px";

    panel.innerHTML = `
    <div id="bio-header" style="display:flex; justify-content:space-between; align-items:center; padding:8px; background:#111; cursor:pointer; border-bottom:1px solid #333;">
      <b>iNaturalist Sound Classifier</b>
      <span id="bio-toggle-btn" style="font-weight:bold; font-size:16px;">−</span>
    </div>
    <div id="bio-content-wrapper" style="padding:10px; display: flex; flex-direction: column; gap: 8px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span>Bioacoustic Model:</span>
        <div>
          <select id="bio-model-select" style="background:#222; color:#0f0; border:1px solid #0f0; padding:2px;"></select>
          <button id="bio-run-btn" style="background:#0f0; color:#000; border:none; padding:3px 8px; cursor:pointer;">Run Analysis</button>
        </div>
      </div>
      <details>
        <summary style="cursor:pointer; color:#aaa;">+ Add Custom Model (JSON)</summary>
        <textarea id="bio-custom-model" style="width:100%; height:80px; background:#111; color:#0f0; margin-top:5px; font-size:10px; border:1px solid #444;" placeholder='{"name": "Custom", ...}'></textarea>
        <button id="bio-add-custom-btn" style="background:#444; color:#fff; border:none; padding:2px 5px; margin-top:2px; cursor:pointer;">Add to List</button>
      </details>
      <div id="bio-log-area" style="max-height: 150px; overflow-y: auto; border-top: 1px solid #333; padding-top: 5px; scroll-behavior: smooth;"></div>
    </div>
    `;
    document.body.appendChild(panel);
    return panel;
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

    const header = document.getElementById("bio-header");
    const content = document.getElementById("bio-content-wrapper");
    const toggleBtn = document.getElementById("bio-toggle-btn");

    header.addEventListener("click", () => {
        const isHidden = content.style.display === "none";
        content.style.display = isHidden ? "flex" : "none";
        toggleBtn.innerText = isHidden ? "−" : "+";
        this.panel.style.width = isHidden ? "520px" : "200px"; // Shrink width when minimized
    });

    this.runBtn.addEventListener("click", () => {
      const selectedKey = this.modelSelect.value;
      const modelConfig = window.BioModelConfig.MODELS[selectedKey];
      this.onRunCallback(modelConfig);
    });

    document.getElementById("bio-add-custom-btn").addEventListener("click", () => {
      try {
        const customJson = JSON.parse(document.getElementById("bio-custom-model").value);
        const key = "custom_" + Date.now();
        window.BioModelConfig.MODELS[key] = customJson;
        this.populateDropdown();
        this.modelSelect.value = key;
        this.log(`Added custom model: ${customJson.name}`);
      } catch (e) {
        this.log(`<span style="color:red">Invalid JSON format</span>`);
      }
    });
  }


  log(msg) {
    const area = this.logArea;
    if (!area) return;

    // 1. Calculate how far from the bottom the user is
    const threshold = 50; // Increased buffer to 50px
    const isAtBottom = (area.scrollHeight - area.scrollTop) <= (area.clientHeight + threshold);

    // 2. Append the message wrapped in a div for better height calculation
    const div = document.createElement("div");
    div.style.borderBottom = "1px solid #222"; // Optional: adds a faint line between logs
    div.innerHTML = msg;
    area.appendChild(div);

    // 3. Scroll logic
    if (isAtBottom) {
        // Using a very short timeout ensures the DOM has updated the height
        setTimeout(() => {
        area.scrollTo({
            top: area.scrollHeight,
            behavior: 'instant' // 'smooth' can cause lag during rapid logs
        });
        }, 10);
    }
    }

}