/** @jest-environment jsdom */

describe('iNatSCUI', () => {
  let ui;

  beforeAll(() => {
    // Mock chrome API
    window.chrome = {
      runtime: { sendMessage: jest.fn() }
    };

    // Mock caches API
    global.caches = {
      delete: jest.fn().mockResolvedValue(true)
    };

    // Mock localStorage
    const store = {};
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn(key => store[key] || null),
        setItem: jest.fn((key, val) => { store[key] = val; }),
        removeItem: jest.fn(key => { delete store[key]; }),
      },
      writable: true
    });

    // Set up iNatSCConfig
    window.iNatSCConfig = {
      modelRegistry: {
        birdnet: { name: "BirdNET", version: "2.4", id: "birdnet" }
      },
      uiText: {
        en: { language: "English", id: "en" }
      },
      confidenceThreshold: 0.5,
      overlapPercentage: 0,
      modelCacheLabel: "bioacoustic-models-v1"
    };

    // Load UI source
    require('../src/ui.js');

    const uiInputText = {
      extensionName: "Test Extension",
      bioacousticModel: "Model",
      bioacousticModelHelp: "Help text",
      analysisButton: "Analyze",
      advancedSettings: "Advanced",
      confidence: "Confidence: ",
      confidenceHelp: "Confidence help",
      overlap: "Overlap: ",
      overlapHelp: "Overlap help",
      setLanguage: "Language",
      setLanguageHelp: "Language help",
      customModelSettings: "Custom Model",
      customModelHelp: "Custom model help",
      addCustomButton: "Add",
      clearCacheButton: "Clear Cache",
      exportButton: "Export",
      clearLogsButton: "Clear",
      initLog: "Click",
      timeCell: "Time",
      speciesCell: "Species",
      confidenceCell: "Confidence",
      cacheCleared: "Cache cleared",
      cacheNotFound: "No cache found",
      cacheClearError: "Error clearing cache",
      noDetectionsToExport: "No detections"
    };

    ui = new window.iNatSCUI(jest.fn(), uiInputText, jest.fn());
  });

  describe('pad', () => {
    test('should pad short strings with spaces', () => {
      const result = ui.pad("hello", 10);
      expect(result).toBe("hello     ");
      expect(result.length).toBe(10);
    });

    test('should truncate long strings with ellipsis', () => {
      const result = ui.pad("a very long species name", 15);
      expect(result).toBe("a very long ...");
      expect(result.length).toBe(15);
    });

    test('should truncate with ellipsis when length equals string length', () => {
      // pad truncates when str.length >= length (uses >= not >)
      const result = ui.pad("exact", 5);
      expect(result).toBe("ex...");
    });

    test('should handle numeric input by converting to string', () => {
      const result = ui.pad(42, 5);
      expect(result).toBe("42   ");
    });
  });

  describe('log', () => {
    beforeEach(() => {
      ui.logArea.innerHTML = "";
    });

    test('should append a log entry to the log area', () => {
      ui.log("Test message");
      expect(ui.logArea.children.length).toBe(1);
      expect(ui.logArea.children[0].innerHTML).toBe("Test message");
      expect(ui.logArea.children[0].className).toBe("insc-log-entry");
    });

    test('should update existing entry when updateId matches', () => {
      ui.log("First", "progress");
      ui.log("Second", "progress");

      const entries = ui.logArea.querySelectorAll("#progress");
      expect(entries.length).toBe(1);
      expect(entries[0].innerHTML).toBe("Second");
    });

    test('should create new entry with updateId when none exists', () => {
      ui.log("Download 50%", "dl-progress");
      const entry = document.getElementById("dl-progress");
      expect(entry).not.toBeNull();
      expect(entry.innerHTML).toBe("Download 50%");
    });
  });

  describe('clearLog', () => {
    test('should remove all log entries', () => {
      ui.logArea.innerHTML = "";
      ui.log("entry 1");
      ui.log("entry 2");
      expect(ui.logArea.children.length).toBe(2);

      ui.clearLog();
      expect(ui.logArea.innerHTML).toBe("");
    });
  });

  describe('injectPanel', () => {
    test('should not create duplicate panels', () => {
      // Panel already exists from constructor
      const before = document.querySelectorAll("#insc-model-panel").length;
      ui.injectPanel(ui.uiInputText);
      const after = document.querySelectorAll("#insc-model-panel").length;
      expect(after).toBe(before);
    });
  });

  describe('exportDetections', () => {
    test('should log message when no analysis data exists', () => {
      window.lastAnalysisData = null;
      ui.logArea.innerHTML = "";
      ui.exportDetections();
      expect(ui.logArea.innerHTML).toContain("No detections");
    });
  });
});
