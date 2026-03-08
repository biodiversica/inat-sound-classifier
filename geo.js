window.BioGeo = {
  async getSpeciesBBox(name) {
    try {
      // 1. Get taxon key
      const matchRes = await fetch(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(name)}`);
      const match = await matchRes.json();
      if (!match.usageKey) return null;

      // 2. Get occurrences (limit 300 is good for performance)
      const occRes = await fetch(`https://api.gbif.org/v1/occurrence/search?taxonKey=${match.usageKey}&hasCoordinate=true&limit=300`);
      const occ = await occRes.json();
      
      if (!occ.results || occ.results.length === 0) return null;

      // Extract valid coordinates
      const lats = occ.results.map(o => o.decimalLatitude).filter(v => v != null);
      const lons = occ.results.map(o => o.decimalLongitude).filter(v => v != null);

      if (lats.length === 0) return null;

      return {
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
        minLon: Math.min(...lons),
        maxLon: Math.max(...lons)
      };
    } catch (e) {
      console.error("GBIF fetch error:", e);
      return null;
    }
  },

  async getObservationCoords(obsId) {
    try {
      // iNaturalist API returns a 'location' string formatted as "latitude,longitude"
      const res = await fetch(`https://api.inaturalist.org/v1/observations/${obsId}`);
      const json = await res.json();
      const obs = json.results?.[0];
      
      if (!obs || !obs.location) return null;
      
      const [lat, lon] = obs.location.split(',').map(Number);
      return { lat, lon };
    } catch(e) {
      console.error("iNat coord fetch error:", e);
      return null;
    }
  },

  isWithinBBox(coords, bbox) {
    if (!coords || !bbox) return false;
    return (
      coords.lat >= bbox.minLat && coords.lat <= bbox.maxLat &&
      coords.lon >= bbox.minLon && coords.lon <= bbox.maxLon
    );
  }
};