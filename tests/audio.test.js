/** @jest-environment jsdom */

// Set up chrome mock and the api shim BEFORE loading the module.
// In the real extension, config.js (loaded first) declares the global `api`.
window.chrome = {
  runtime: {
    sendMessage: jest.fn()
  }
};
global.api = window.chrome;

// Mock AudioContext on the window object
window.AudioContext = jest.fn().mockImplementation(() => ({
  decodeAudioData: jest.fn().mockResolvedValue({
    sampleRate: 48000,
    duration: 10,
    getChannelData: () => new Float32Array(48000 * 10)
  }),
  close: jest.fn().mockResolvedValue()
}));

// Polyfill atob if it's missing in your JSDOM version
if (typeof window.atob === 'undefined') {
  window.atob = (str) => Buffer.from(str, 'base64').toString('binary');
}

// Import source code so it attaches to the window object
require('../src/audio.js');

describe('iNatSCAudio Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    window.chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message.url && message.url.includes('missing.mp3')) {
        callback({ success: false, error: '404 Not Found' });
      } else {
        callback({ success: true, data: "UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=" });
      }
    });
  });

  test('decodeAudio should send message to background and return buffer', async () => {
    const url = 'https://static.inaturalist.org/sound.mp3';
    const result = await window.iNatSCAudio.decodeAudio(url);

    expect(window.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "FETCH_AUDIO", url: url }),
      expect.any(Function)
    );
    expect(result.sampleRate).toBe(48000);
  });

  test('decodeAudio should throw on background fetch failure', async () => {
    await expect(window.iNatSCAudio.decodeAudio('https://example.com/missing.mp3'))
      .rejects.toThrow('Background fetch failed');
  });

  test('decodeAudio should close AudioContext after decoding', async () => {
    await window.iNatSCAudio.decodeAudio('https://example.com/sound.mp3');
    const ctxInstance = window.AudioContext.mock.results[0].value;
    expect(ctxInstance.close).toHaveBeenCalled();
  });

  describe('chunkAudio', () => {
    test('should split samples into chunks of correct size', () => {
      const sampleRate = 48000;
      const windowSize = 3; // 3 seconds
      const samples = new Float32Array(sampleRate * 9); // 9 seconds
      const chunks = window.iNatSCAudio.chunkAudio(samples, sampleRate, windowSize, 0);

      expect(chunks.length).toBe(3);
      chunks.forEach(chunk => {
        expect(chunk.length).toBe(sampleRate * windowSize);
      });
    });

    test('should pad the last chunk if shorter than window size', () => {
      const sampleRate = 48000;
      const windowSize = 3;
      // 7 seconds: 2 full chunks + 1 padded chunk
      const samples = new Float32Array(sampleRate * 7);
      samples[sampleRate * 6] = 0.5; // mark a sample in the last chunk

      const chunks = window.iNatSCAudio.chunkAudio(samples, sampleRate, windowSize, 0);

      expect(chunks.length).toBe(3);
      expect(chunks[2].length).toBe(sampleRate * windowSize);
      // Padded portion should be zeros
      expect(chunks[2][sampleRate * 2]).toBe(0);
    });

    test('should handle overlap correctly', () => {
      const sampleRate = 100; // small for easy math
      const windowSize = 1; // 1 second = 100 samples
      const samples = new Float32Array(300); // 3 seconds

      // 50% overlap: step = 100 * (1 - 0.5) = 50 samples
      const chunks = window.iNatSCAudio.chunkAudio(samples, sampleRate, windowSize, 0.5);

      // With step=50 and length=300: positions 0,50,100,150,200,250
      expect(chunks.length).toBe(6);
      chunks.forEach(chunk => {
        expect(chunk.length).toBe(100);
      });
    });

    test('should return single padded chunk for short audio', () => {
      const sampleRate = 48000;
      const windowSize = 3;
      const samples = new Float32Array(1000); // very short

      const chunks = window.iNatSCAudio.chunkAudio(samples, sampleRate, windowSize, 0);

      expect(chunks.length).toBe(1);
      expect(chunks[0].length).toBe(sampleRate * windowSize);
    });
  });
});
