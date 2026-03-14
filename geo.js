// geo.js 
window.BioGeo = {
  cache: {},
  cacheinat: {},

  // Helper to abstract the messaging boilerplate
  async fetchViaBackground(url) {
    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "FETCH_JSON", url: url }, resolve);
    });

    if (!response.success) {
      console.warn(`Fetch Error (${url}):`, response.error);
      return null;
    }
    return response.data;
  },

  // 1. Fetch iNaturalist Coordinates
  async getObservationCoords(obsId) {
    const url = `https://api.inaturalist.org/v1/observations/${obsId}`;
    const data = await this.fetchViaBackground(url);
    
    if (!data || !data.results || data.results.length === 0) return null;
    
    const location = data.results[0].location; // Format: "lat,lon"
    if (!location) return null;
    
    const [lat, lon] = location.split(',').map(Number);
    return { lat, lon };
  },

  // 2. Fetch GBIF Data / Bounding Box
  async getSpeciesBBox(speciesName) {
    if (this.cache[speciesName]) return this.cache[speciesName];
    
    try {
      // First, match the species name to a GBIF usage key
      const matchUrl = `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(speciesName)}`;
      const matchData = await this.fetchViaBackground(matchUrl);
      
      if (!matchData || !matchData.usageKey) {
        this.cache[speciesName] = null;
        return null;
      }
      
      const usageKey = matchData.usageKey;
      
      // Fetching a summary or map geometry from GBIF (reduced limit for speed)
      const bboxUrl = `https://api.gbif.org/v1/occurrence/search?taxonKey=${usageKey}&hasCoordinate=true&limit=100`;
      const occ = await this.fetchViaBackground(bboxUrl);

      if (!occ.results || occ.results.length === 0) {
        this.cache[speciesName] = null;
        return null;
      }

      // Extract valid coordinates
      const lats = occ.results.map(o => o.decimalLatitude).filter(v => v != null);
      const lons = occ.results.map(o => o.decimalLongitude).filter(v => v != null);

      if (lats.length === 0) {
        this.cache[speciesName] = null;
        return null;
      }

      const bbox = {
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
        minLon: Math.min(...lons),
        maxLon: Math.max(...lons)
      };
      
      this.cache[speciesName] = bbox;
      return bbox;
    } catch (e) {
      console.error("GBIF fetch error:", e);
      this.cache[speciesName] = null;
      return null;
    }
  },

  // 3. Fetch iNaturalist Data / Bounding Box
  async getiNaturalistSpeciesBBox(speciesName) {
    if (this.cacheinat[speciesName]) return this.cacheinat[speciesName];
    
    try {
      const url = `https://api.inaturalist.org/v1/observations?taxon_name=${encodeURIComponent(speciesName)}&has[]=geo&per_page=100`;
      const data = await this.fetchViaBackground(url);
      
      if (!data || !data.results || data.results.length === 0) {
        this.cacheinat[speciesName] = null;
        return null;
      }

      // Extract valid coordinates from location field (format: "lat,lon")
      const coords = data.results.map(o => o.location ? o.location.split(',').map(Number) : null).filter(c => c && c.length === 2);
      const lats = coords.map(c => c[0]);
      const lons = coords.map(c => c[1]);

      if (lats.length === 0) {
        this.cacheinat[speciesName] = null;
        return null;
      }

      const bbox = {
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
        minLon: Math.min(...lons),
        maxLon: Math.max(...lons)
      };
      
      this.cacheinat[speciesName] = bbox;
      return bbox;
    } catch (e) {
      console.error("iNaturalist fetch error:", e);
      this.cacheinat[speciesName] = null;
      return null;
    }
  },

  // Math check (No network requests, so this stays purely local)
  isWithinBBox(coords, bbox) {
    if (!coords || !bbox) return false;
    return (
      coords.lat >= bbox.minLat &&
      coords.lat <= bbox.maxLat &&
      coords.lon >= bbox.minLon &&
      coords.lon <= bbox.maxLon
    );
  }
};