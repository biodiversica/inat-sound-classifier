// background.js

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  
  // 1. Handle Audio Fetching
  if (request.type === "FETCH_AUDIO") {
    fetchAudioAsBase64(request.url)
      .then(base64 => sendResponse({ success: true, data: base64 }))
      .catch(err => sendResponse({ success: false, error: err.message }));
      
    return true; // Keeps the message channel open for the async fetch
  }

  // 2. Handle API Fetching (e.g., GBIF Bounding Boxes)
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

// Helper function to fetch binary data and convert to Base64
async function fetchAudioAsBase64(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  
  const arrayBuffer = await response.arrayBuffer();
  
  // Convert ArrayBuffer to Base64
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}