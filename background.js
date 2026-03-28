// background.js

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // Handle Audio Fetching
  if (request.type === "FETCH_AUDIO") {
    fetchAsBase64(request.url)
      .then(base64 => sendResponse({ success: true, data: base64 }))
      .catch(err => sendResponse({ success: false, error: err.message }));

    return true; // Keeps the message channel open for the async fetch
  }

  // Handle API Fetching (e.g., GBIF Bounding Boxes)
  if (request.type === "FETCH_JSON") {
    fetch(request.url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => sendResponse({ success: true, data: data }))
      .catch(err => sendResponse({ success: false, error: err.message }));

    return true; // Keep the message channel open for async response
  }
});

// Long-lived port connection for large file downloads (e.g., ONNX models).
// Using connect() instead of sendMessage() because:
// 1. The open port keeps the MV3 service worker alive during long downloads
// 2. Chunked transfer avoids memory spikes from base64-encoding the whole file
// 3. Enables progress reporting back to the content script
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "download") return;

  port.onMessage.addListener(async (msg) => {
    try {
      const response = await fetch(msg.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const total = parseInt(response.headers.get("content-length") || "0", 10);
      port.postMessage({ type: "size", total });

      // Stream the response body — never buffer the entire file.
      // Batch network chunks into ~1MB before sending to reduce
      // message overhead while keeping memory usage low.
      const reader = response.body.getReader();
      const BATCH_SIZE = 1024 * 1024;
      let pending = [];
      let pendingSize = 0;
      let downloaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        pending.push(value);
        pendingSize += value.length;
        downloaded += value.length;

        if (pendingSize >= BATCH_SIZE) {
          const combined = new Uint8Array(pendingSize);
          let offset = 0;
          for (const chunk of pending) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }
          port.postMessage({ type: "chunk", data: uint8ToBase64(combined), downloaded });
          pending = [];
          pendingSize = 0;
        }
      }

      // Flush remaining bytes
      if (pendingSize > 0) {
        const combined = new Uint8Array(pendingSize);
        let offset = 0;
        for (const chunk of pending) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }
        port.postMessage({ type: "chunk", data: uint8ToBase64(combined), downloaded });
      }

      port.postMessage({ type: "done" });
    } catch (err) {
      try {
        port.postMessage({ type: "error", message: err.message });
      } catch (e) {
        // Port already disconnected
      }
    }
  });
});

// Efficient Base64 encoding for Uint8Array
function uint8ToBase64(bytes) {
  const BLOCK = 0x8000; // 32KB sub-blocks to avoid call stack limits
  let binary = "";
  for (let i = 0; i < bytes.length; i += BLOCK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + BLOCK));
  }
  return btoa(binary);
}

// Helper for small binary fetches (audio files)
async function fetchAsBase64(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  return uint8ToBase64(new Uint8Array(arrayBuffer));
}
