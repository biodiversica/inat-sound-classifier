// tests/geo.test.js

// Set up chrome mock and the api shim BEFORE loading the module.
// In the real extension, config.js (loaded first) declares the global `api`.
global.chrome = {
  runtime: {
    sendMessage: jest.fn()
  }
};
global.api = global.chrome;

// 1. Mock the window object since Node.js doesn't have one
global.window = {};

// 2. Load your actual extension file into the test environment
require('../geo.js');

describe('BioGeo Geographic Validation', () => {
  const bbox = { minLat: 10, maxLat: 50, minLon: -100, maxLon: -50 };

  test('should return true if coordinates are perfectly inside the box', () => {
    const coords = { lat: 30, lon: -75 };
    const result = window.BioGeo.isWithinBBox(coords, bbox);
    expect(result).toBe(true);
  });

  test('should return false if latitude is too high (too far North)', () => {
    const coords = { lat: 60, lon: -75 };
    const result = window.BioGeo.isWithinBBox(coords, bbox);
    expect(result).toBe(false);
  });

  test('should return false if longitude is too low (too far West)', () => {
    const coords = { lat: 30, lon: -120 };
    const result = window.BioGeo.isWithinBBox(coords, bbox);
    expect(result).toBe(false);
  });

  test('should handle missing or null inputs gracefully', () => {
    expect(window.BioGeo.isWithinBBox(null, bbox)).toBe(false);
    expect(window.BioGeo.isWithinBBox({ lat: 30, lon: -75 }, null)).toBe(false);
  });
});
