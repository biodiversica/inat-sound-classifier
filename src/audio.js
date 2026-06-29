// audio.js

/** Audio fetching, decoding, resampling, and chunking utilities. */
window.iNatSCAudio = {
  /**
   * Queries the iNaturalist API for sound file URLs attached to an observation.
   * @param {string} obsId - The iNaturalist observation ID.
   * @returns {Promise<string[]|undefined>} Array of sound file URLs, or undefined if none found.
   */
  async checkObservationSounds(obsId) {
    
    const apiURL = `https://api.inaturalist.org/v1/observations/${obsId}?include=sounds`;
    const response = await new Promise(resolve => {
      api.runtime.sendMessage({ type: "FETCH_JSON", url: apiURL }, resolve);
    });

    if (!response.success) {
      console.warn(`Fetch Error (${url}):`, response.error);
      return null;
    }

    const obsInfo = response.data.results;

    let urls = (obsInfo?.[0]?.sounds || []).map(s => s.file_url).filter(Boolean);
    if (urls.length > 0) return urls;
  },

  /**
   * Fetches an audio file via the background script and decodes it into an AudioBuffer.
   * The AudioContext is closed after decoding to free resources.
   *
   * `decodeAudioData` resamples the decoded audio to the AudioContext's sample
   * rate, so the context MUST be created at the model's target rate. Otherwise a
   * default-rate context (~48 kHz) would low-pass the audio at decode time and
   * irreversibly discard any content above ~24 kHz — which for ultrasonic models
   * is the entire signal. Decoding at the target rate also makes the subsequent
   *  {@link resample} call a no-op.
   * @param {string} url - URL of the audio file.
   * @param {number} [targetSampleRate] - Sample rate (Hz) to decode at; defaults to the device rate.
   * @returns {Promise<AudioBuffer>} Decoded audio buffer.
   * @throws {Error} If the background fetch fails.
   */
  async decodeAudio(url, targetSampleRate) {
    // Ask background.js to fetch the file
    const response = await new Promise(resolve => {
      api.runtime.sendMessage({ type: "FETCH_AUDIO", url: url }, resolve);
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

    // Decode the audio at the model's target rate to preserve the full band.
    // Fall back to a default-rate context if the browser rejects the requested
    // rate (resample() then converts to the target rate as before).
    let ctx;
    try {
      ctx = targetSampleRate ? new AudioContext({ sampleRate: targetSampleRate }) : new AudioContext();
    } catch (e) {
      ctx = new AudioContext();
    }
    const decoded = await ctx.decodeAudioData(arrayBuffer);

    // Close the AudioContext when done to free up memory
    await ctx.close();
    return decoded;
  },

  /**
   * Resamples an AudioBuffer to a target sample rate using an OfflineAudioContext.
   * Returns the original channel data unchanged if the rates already match.
   * @param {AudioBuffer} audioBuffer - The decoded audio buffer to resample.
   * @param {number} targetSampleRate - Desired sample rate in Hz (e.g. 48000).
   * @returns {Promise<Float32Array>} Mono audio samples at the target rate.
   */
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

  /**
   * Splits audio samples into fixed-size chunks for inference.
   * The last chunk is zero-padded if shorter than the window size.
   * @param {Float32Array} samples - Mono audio samples.
   * @param {number} sampleRate - Sample rate in Hz.
   * @param {number} windowSize - Analysis window duration in seconds.
   * @param {number} overlapSec - Overlap fraction between consecutive windows (0–1).
   * @returns {Float32Array[]} Array of audio chunks, each of length `sampleRate * windowSize`.
   */
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