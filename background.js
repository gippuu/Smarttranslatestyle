// Background listener that forwards translation requests to a proxy (e.g. Vercel)
// The proxy URL and optional token can be stored in chrome.storage.local as
// { proxyUrl: 'https://your.vercel.app/api/translate', proxyToken: 'secret' }

function getProxyConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['proxyUrl', 'proxyToken'], (res) => {
      resolve({
        url: res?.proxyUrl || 'https://smarttranslateplus-f5y4.vercel.app/api/translate',
        token: res?.proxyToken || null
      });
    });
  });
}

// Simple persistent cache stored in chrome.sto rage.local to avoid repeated API calls
const CACHE_KEY = 'translationCacheV1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCachedTranslation(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([CACHE_KEY], (res) => {
      const map = res?.[CACHE_KEY] || {};
      const entry = map[key];
      if (!entry) return resolve(null);
      if (Date.now() - entry.ts > CACHE_TTL_MS) {
        // expired
        delete map[key];
        chrome.storage.local.set({ [CACHE_KEY]: map }, () => resolve(null));
        return;
      }
      resolve(entry.translation);
    });
  });
}

function setCachedTranslation(key, translation) {
  return new Promise((resolve) => {
    chrome.storage.local.get([CACHE_KEY], (res) => {
      const map = res?.[CACHE_KEY] || {};
      map[key] = { translation, ts: Date.now() };
      chrome.storage.local.set({ [CACHE_KEY]: map }, () => resolve());
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  const text = String(message.text || '').trim();
  if (!text) {
    sendResponse({ error: 'empty_text' });
    return true;
  }
  if (text.length > 10000) {
    sendResponse({ error: 'text_too_long' });
    return true;
  }

  // common proxy config
  (async () => {
    const { url: PROXY_URL, token } = await getProxyConfig();

    // Use AbortController to implement a timeout for the fetch
    const controller = new AbortController();
    const timeoutMs = message.type === 'GET_TTS' ? 25000 : 15000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['x-proxy-token'] = token;

      if (message.type === 'TRANSLATE_TEXT') {
        const target = message.target || 'it';
        // Check cache first
        const cacheKey = `t:${target}|${text}`;
        try {
          const cached = await getCachedTranslation(cacheKey);
          if (cached) {
            sendResponse({ translation: cached, cached: true });
            clearTimeout(timeout);
            return;
          }
        } catch (err) {
          console.warn('Cache read failed', err);
        }

        const resp = await fetch(PROXY_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify({ text, target }),
          signal: controller.signal
        });

        clearTimeout(timeout);
        if (!resp.ok) {
          const txt = await resp.text().catch(() => '');
          console.error('Proxy responded with error', resp.status, txt);
          sendResponse({ error: 'proxy_error', status: resp.status, message: txt });
          return;
        }

        const data = await resp.json().catch(() => null);
        if (!data) { sendResponse({ error: 'invalid_response' }); return; }
        if (data.translation) {
          setCachedTranslation(cacheKey, data.translation).catch(() => {});
          sendResponse({ translation: data.translation });
        } else if (data.error) {
          sendResponse({ error: 'proxy_error', detail: data });
        } else {
          sendResponse({ error: 'proxy_no_translation', raw: data });
        }
        return;
      }

      if (message.type === 'ANALYZE_TEXT') {
        const resp = await fetch(PROXY_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify({ text, action: 'analyze' }),
          signal: controller.signal
        });

        clearTimeout(timeout);
        if (!resp.ok) {
          const txt = await resp.text().catch(() => '');
          console.error('Proxy analyze error', resp.status, txt);
          sendResponse({ error: 'proxy_error', status: resp.status, message: txt });
          return;
        }
        const data = await resp.json().catch(() => null);
        if (!data || !data.analysis) { sendResponse({ error: 'no_analysis', raw: data }); return; }
        sendResponse({ analysis: data.analysis });
        return;
      }

      if (message.type === 'GET_TTS') {
        const voice = message.voice || null;
        const resp = await fetch(PROXY_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify({ text, tts: true, voice }),
          signal: controller.signal
        });

        clearTimeout(timeout);
        if (!resp.ok) {
          const txt = await resp.text().catch(() => '');
          console.error('TTS proxy error', resp.status, txt);
          sendResponse({ error: 'proxy_error', status: resp.status, message: txt });
          return;
        }

        const data = await resp.json().catch(() => null);
        if (!data || !data.audio) { sendResponse({ error: 'no_audio', raw: data }); return; }
        sendResponse({ audio: data.audio, mime: data.mime || 'audio/mpeg' });
        return;
      }

      // unknown type
      sendResponse({ error: 'unknown_message_type' });
      clearTimeout(timeout);
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        console.error('Proxy request timed out');
        sendResponse({ error: 'timeout' });
      } else {
        console.error('Proxy request failed', err);
        sendResponse({ error: 'request_failed', message: String(err && err.message ? err.message : err) });
      }
    }
  })();

  // Keep the message channel open for the asynchronous sendResponse
  return true;
});
