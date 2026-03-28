/** @jest-environment jsdom */

// Mock chrome API and caches before loading model.js
window.chrome = {
  runtime: {
    getURL: jest.fn(path => `chrome-extension://fakeid/${path}`)
  }
};

global.caches = {
  open: jest.fn()
};

// Load source
require('../model.js');

describe('BioModelEngine', () => {
  let engine;
  const mockUi = {
    log: jest.fn(),
    uiInputText: {
      notFoundInCache: "Not in cache",
      downloadingModel: "Downloading",
      savedModel: "Saved",
      loadedModel: "Loaded",
      preparingModel: "Preparing",
      selectedModel: "Model",
      windowDuration: "Window",
      sampleRate: "Sample Rate",
      inputIndex: "Input",
      outputIndex: "Output",
      usingSoftmax: "Softmax",
      sources: "Sources",
      loadingSuccess: "Success",
      failedAnalysis: "Failed"
    },
    uiText: {
      formatNotSupported: "format not supported"
    }
  };

  beforeEach(() => {
    engine = new window.BioModelEngine(mockUi);
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('should initialize with null/empty defaults', () => {
      expect(engine.worker).toBeNull();
      expect(engine.labels).toEqual([]);
      expect(engine.currentModelConfig).toBeNull();
      expect(engine.inputNames).toBeNull();
      expect(engine.outputNames).toBeNull();
    });
  });

  describe('isValidONNXBuffer', () => {
    test('should reject null/undefined buffer', () => {
      expect(engine.isValidONNXBuffer(null)).toBe(false);
      expect(engine.isValidONNXBuffer(undefined)).toBe(false);
    });

    test('should reject buffer smaller than 100 bytes', () => {
      const small = new ArrayBuffer(50);
      expect(engine.isValidONNXBuffer(small)).toBe(false);
    });

    test('should accept buffer starting with 0x08 (ir_version field)', () => {
      const buf = new ArrayBuffer(200);
      const view = new Uint8Array(buf);
      view[0] = 0x08;
      expect(engine.isValidONNXBuffer(buf)).toBe(true);
    });

    test('should accept buffer starting with 0x12 (producer_name field)', () => {
      const buf = new ArrayBuffer(200);
      const view = new Uint8Array(buf);
      view[0] = 0x12;
      expect(engine.isValidONNXBuffer(buf)).toBe(true);
    });

    test('should accept buffer starting with 0x1A', () => {
      const buf = new ArrayBuffer(200);
      const view = new Uint8Array(buf);
      view[0] = 0x1A;
      expect(engine.isValidONNXBuffer(buf)).toBe(true);
    });

    test('should reject buffer with invalid first byte', () => {
      const buf = new ArrayBuffer(200);
      const view = new Uint8Array(buf);
      view[0] = 0xFF;
      expect(engine.isValidONNXBuffer(buf)).toBe(false);
    });
  });

  describe('sigmoid', () => {
    test('should return 0.5 for input 0', () => {
      expect(engine.sigmoid(0)).toBeCloseTo(0.5);
    });

    test('should return ~1 for large positive input', () => {
      expect(engine.sigmoid(10)).toBeCloseTo(1.0, 3);
    });

    test('should return ~0 for large negative input', () => {
      expect(engine.sigmoid(-10)).toBeCloseTo(0.0, 3);
    });

    test('should be monotonically increasing', () => {
      expect(engine.sigmoid(1)).toBeGreaterThan(engine.sigmoid(0));
      expect(engine.sigmoid(0)).toBeGreaterThan(engine.sigmoid(-1));
    });
  });

  describe('softmax', () => {
    test('should return probabilities that sum to 1', () => {
      const result = engine.softmax([1.0, 2.0, 3.0]);
      const sum = result.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0);
    });

    test('should assign highest probability to largest logit', () => {
      const result = engine.softmax([1.0, 5.0, 2.0]);
      expect(result[1]).toBeGreaterThan(result[0]);
      expect(result[1]).toBeGreaterThan(result[2]);
    });

    test('should return equal probabilities for equal logits', () => {
      const result = engine.softmax([1.0, 1.0, 1.0]);
      expect(result[0]).toBeCloseTo(1 / 3);
      expect(result[1]).toBeCloseTo(1 / 3);
      expect(result[2]).toBeCloseTo(1 / 3);
    });

    test('should handle single element', () => {
      const result = engine.softmax([5.0]);
      expect(result[0]).toBeCloseTo(1.0);
    });

    test('should handle negative logits', () => {
      const result = engine.softmax([-1.0, -2.0, -3.0]);
      const sum = result.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0);
      expect(result[0]).toBeGreaterThan(result[1]);
      expect(result[1]).toBeGreaterThan(result[2]);
    });
  });

  describe('terminateWorker', () => {
    test('should do nothing if no worker exists', () => {
      engine.worker = null;
      expect(() => engine.terminateWorker()).not.toThrow();
      expect(engine.worker).toBeNull();
    });

    test('should terminate existing worker and reset state', () => {
      const mockTerminate = jest.fn();
      engine.worker = { terminate: mockTerminate };
      engine.inputNames = ['input'];
      engine.outputNames = ['output'];

      engine.terminateWorker();

      expect(mockTerminate).toHaveBeenCalled();
      expect(engine.worker).toBeNull();
      expect(engine.inputNames).toBeNull();
      expect(engine.outputNames).toBeNull();
    });
  });

  describe('loadModel', () => {
    test('should reject non-onnx model format', async () => {
      const badConfig = { format: 'tensorflow', name: 'test' };
      await expect(engine.loadModel(badConfig)).rejects.toThrow('Unsupported model format');
    });

    test('should terminate old worker before loading new model', async () => {
      const mockTerminate = jest.fn();
      engine.worker = { terminate: mockTerminate };

      const config = { format: 'onnx', modelUrl: 'http://example.com/model.onnx', labelsUrl: 'http://example.com/labels.txt' };

      // Mock fetchWithCache to throw so we can test early behavior
      engine.fetchWithCache = jest.fn().mockRejectedValue(new Error('test stop'));

      try { await engine.loadModel(config); } catch (e) {}

      expect(mockTerminate).toHaveBeenCalled();
      expect(engine.worker).toBeNull();
    });
  });

  describe('_sendMessage', () => {
    test('should resolve when worker sends success response', async () => {
      engine.worker = {
        postMessage: jest.fn((msg) => {
          // Simulate async worker response
          setTimeout(() => {
            engine._handleMessage({ data: { type: 'ready' } });
          }, 0);
        })
      };

      const result = await engine._sendMessage({ type: 'init' });
      expect(result.type).toBe('ready');
    });

    test('should reject when worker sends error response', async () => {
      engine.worker = {
        postMessage: jest.fn((msg) => {
          setTimeout(() => {
            engine._handleMessage({ data: { type: 'error', message: 'ORT failed' } });
          }, 0);
        })
      };

      await expect(engine._sendMessage({ type: 'init' })).rejects.toThrow('ORT failed');
    });
  });

  describe('predictChunk', () => {
    test('should return label and score using softmax mode', async () => {
      engine.currentModelConfig = {
        inputIndex: 0,
        outputIndex: 0,
        softmax: true,
        skipLabelsHeader: 0
      };
      engine.inputNames = ['input_0'];
      engine.outputNames = ['output_0'];
      engine.labels = ['Species A_code', 'Species B_code', 'Species C_code'];

      // Mock _sendMessage to return logits where index 1 is highest
      engine._sendMessage = jest.fn().mockResolvedValue({
        logits: new Float32Array([1.0, 5.0, 2.0])
      });

      const result = await engine.predictChunk(new Float32Array(48000));

      expect(result.label).toBe('Species B_code');
      expect(result.score).toBeGreaterThan(0.9);
    });

    test('should return label and score using sigmoid mode', async () => {
      engine.currentModelConfig = {
        inputIndex: 0,
        outputIndex: 0,
        softmax: false,
        skipLabelsHeader: 0
      };
      engine.inputNames = ['input_0'];
      engine.outputNames = ['output_0'];
      engine.labels = ['Cat_sound', 'Dog_sound', 'Bird_sound'];

      // logits: sigmoid(5)~0.993, sigmoid(-2)~0.119, sigmoid(1)~0.731
      engine._sendMessage = jest.fn().mockResolvedValue({
        logits: new Float32Array([5.0, -2.0, 1.0])
      });

      const result = await engine.predictChunk(new Float32Array(48000));

      expect(result.label).toBe('Cat_sound');
      expect(result.score).toBeCloseTo(0.993, 2);
    });

    test('should respect skipLabelsHeader offset', async () => {
      engine.currentModelConfig = {
        inputIndex: 0,
        outputIndex: 0,
        softmax: false,
        skipLabelsHeader: 1
      };
      engine.inputNames = ['input_0'];
      engine.outputNames = ['output_0'];
      // labels[0] is header, labels[1..] are real
      engine.labels = ['header_line', 'Real Species A_code', 'Real Species B_code'];

      engine._sendMessage = jest.fn().mockResolvedValue({
        logits: new Float32Array([5.0, -2.0])
      });

      const result = await engine.predictChunk(new Float32Array(48000));

      // bestIdx=0, label = labels[0 + 1] = 'Real Species A_code'
      expect(result.label).toBe('Real Species A_code');
    });
  });
});
