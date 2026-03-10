// audio.js
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
    // 1. Ask background.js to fetch the file
    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "FETCH_AUDIO", url: url }, resolve);
    });

    if (!response.success) {
      throw new Error("Background fetch failed: " + response.error);
    }

    // 2. Convert the Base64 string back into an ArrayBuffer
    const binaryString = atob(response.data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const arrayBuffer = bytes.buffer;

    // 3. Decode the audio
    const ctx = new AudioContext();
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    
    // Always close the AudioContext when done to free up memory!
    await ctx.close(); 
    return decoded;
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