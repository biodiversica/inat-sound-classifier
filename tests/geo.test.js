// tests/geo.test.js

// 1. Mock the window object since Node.js doesn't have one
global.window = {};

// 2. Load your actual extension file into the test environment
// (Assuming geo.js is in the root directory)
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