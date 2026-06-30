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
   *
   * Some browsers (e.g. Firefox) cap Web Audio at 192 kHz and reject higher
   * rates. In that case we decode at 192 kHz — preserving the full band up to its
   * ~96 kHz Nyquist — and let {@link resample} bring the array up to the model's
   * target rate in JS. Content above 96 kHz cannot be recovered there, but most
   * of the ultrasonic signal is retained.
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
    // If the browser rejects the requested rate (e.g. Firefox caps Web Audio at
    // 192 kHz), retry at the highest supported rate so we keep everything up to
    // its ~96 kHz Nyquist; resample() then converts to the target rate in JS.
    let ctx;
    try {
      ctx = targetSampleRate ? new AudioContext({ sampleRate: targetSampleRate }) : new AudioContext();
    } catch (e) {
      const fallbackRate = targetSampleRate ? Math.min(targetSampleRate, 192000) : undefined;
      ctx = fallbackRate ? new AudioContext({ sampleRate: fallbackRate }) : new AudioContext();
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
    try {
      const offline = new OfflineAudioContext(1, Math.ceil(audioBuffer.duration * targetSampleRate), targetSampleRate);
      const src = offline.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(offline.destination);
      src.start();
      const rendered = await offline.startRendering();
      return rendered.getChannelData(0);
    } catch (e) {
      // OfflineAudioContext rejects rates above the browser's Web Audio cap
      // (192 kHz in Firefox). Resample the array directly instead so models above
      // that cap (e.g. 256 kHz bat models) still run.
      return this.resampleLinear(audioBuffer.getChannelData(0), audioBuffer.sampleRate, targetSampleRate);
    }
  },

  /**
   * Resamples mono samples to a target rate using linear interpolation, without
   * Web Audio. Used as a fallback when the target rate exceeds the browser's
   * OfflineAudioContext limit. Intended for upsampling (e.g. 192 kHz → 256 kHz);
   * it applies no anti-alias filter, so significant downsampling would alias.
   * @param {Float32Array} input - Mono input samples.
   * @param {number} inputRate - Sample rate of `input` in Hz.
   * @param {number} targetRate - Desired sample rate in Hz.
   * @returns {Float32Array} Resampled mono samples at `targetRate`.
   */
  resampleLinear(input, inputRate, targetRate) {
    if (inputRate === targetRate || input.length === 0) return input;
    const ratio = targetRate / inputRate;
    const outLength = Math.ceil(input.length * ratio);
    const output = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const pos = i / ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(i0 + 1, input.length - 1);
      output[i] = input[i0] * (1 - (pos - i0)) + input[i1] * (pos - i0);
    }
    return output;
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