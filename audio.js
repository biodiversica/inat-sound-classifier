// audio.js
window.BioAudio = {
  async checkObservationSounds(obsId) {
    
    const apiURL = `https://api.inaturalist.org/v1/observations/${obsId}?include=sounds`;
    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "FETCH_JSON", url: apiURL }, resolve);
    });

    if (!response.success) {
      console.warn(`Fetch Error (${url}):`, response.error);
      return null;
    }

    const obsInfo = response.data.results;

    let urls = (obsInfo?.[0]?.sounds || []).map(s => s.file_url).filter(Boolean);
    if (urls.length > 0) return urls;
  },

  async decodeAudio(url) {
    // Ask background.js to fetch the file
    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "FETCH_AUDIO", url: url }, resolve);
    });

    if (!response.success) {
      throw new Error("Background fetch failed: " + response.error);
    }

    // Convert the Base64 string back into an ArrayBuffer
    const binaryString = atob(response.data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const arrayBuffer = bytes.buffer;

    // Decode the audio
    const ctx = new AudioContext();
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    
    // Close the AudioContext when done to free up memory
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
    // console.log(`window size: ${size}`)
    // console.log(`step size: ${size}`)
    for (let i = 0; i < samples.length; i += step_size) {
      let chunk = samples.slice(i, i + size);
      if (chunk.length < size) {
        const padded = new Float32Array(size);
        padded.set(chunk);
        chunk = padded;
      }
      if(chunk.length > size) chunk = chunk.slice(0,size);
      // console.log(`chunk length: ${chunk.length}`)
      chunks.push(chunk);
    }
    return chunks;
  }
};