window.BioAudio = {
  async fetchObservationAudio(obsId) {
    // 1. Try API first
    try {
      const apiURL = `https://api.inaturalist.org/v1/observations/${obsId}?include=sounds`;
      const res = await fetch(apiURL);
      const json = await res.json();
      let urls = (json.results?.[0]?.sounds || []).map(s => s.file_url).filter(Boolean);
      if (urls.length > 0) return urls;
    } catch (e) {
      console.warn("API fetch failed, falling back to DOM parsing");
    }

    // 2. Fallback: Find audio tags loaded on the page
    const audioTags = document.querySelectorAll("audio source");
    const urls = Array.from(audioTags).map(src => src.src).filter(Boolean);
    return [...new Set(urls)]; // Return unique URLs
  },

  async decodeAudio(url) {
    const ctx = new AudioContext();
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    return await ctx.decodeAudioData(buf);
  },

  async resample(audioBuffer, targetSampleRate) {
    if (audioBuffer.sampleRate === targetSampleRate) return audioBuffer.getChannelData(0);
    const offline = new OfflineAudioContext(1, Math.ceil(audioBuffer.duration * targetSampleRate), targetSampleRate);
    const src = offline.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0);
  },

  chunkAudio(samples, sampleRate, windowSize, overlapSec) {
    const size = sampleRate * windowSize;
    const step_size = sampleRate * (windowSize * (1 - overlapSec));
    const chunks = [];
    for (let i = 0; i < samples.length; i += step_size) {
      let chunk = samples.slice(i, i + size);
      if (chunk.length < size) {
        const padded = new Float32Array(size);
        padded.set(chunk);
        chunk = padded;
      }
      chunks.push(chunk);
    }
    return chunks;
  }
};