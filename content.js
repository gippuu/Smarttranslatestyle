function sendMessageAsync(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Extension context invalidated:', chrome.runtime.lastError);
          resolve({ error: 'extension_reload', message: 'Please refresh the page after reloading the extension' });
          return;
        }
        resolve(response);
      });
    } catch (err) {
      console.error('Extension communication error:', err);
      resolve({ error: 'extension_error', message: 'Extension communication failed' });
    }
  });
}

// Play short pronunciation using the Web Speech API (falls back gracefully)
function playPronunciation(text) {
  if (!text) return;
  try {
    if (!('speechSynthesis' in window)) {
      console.warn('SpeechSynthesis API not available');
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    // simple default: use browser locale
    utter.lang = navigator.language || 'en-US';
    utter.rate = 1.0;
    window.speechSynthesis.speak(utter);
  } catch (err) {
    console.error('playPronunciation failed', err);
  }
}
// Replace double-click behavior with selection bubble trigger
let _bubble = null;
let _bubbleTimeout = null;

function removeBubble() {
  if (_bubble) {
    _bubble.remove();
    _bubble = null;
  }
  if (_bubbleTimeout) {
    clearTimeout(_bubbleTimeout);
    _bubbleTimeout = null;
  }
}

function positionElementAtRect(el, rect, offsetX = 0, offsetY = -30) {
  // Position bubble centered above or below the selection
  const centerX = rect.left + rect.width / 2;
  const left = window.scrollX + centerX - 10; // 10 = half of bubble width (20px)
  
  // Check if there's space above, otherwise position below
  const spaceAbove = rect.top;
  const spaceBelow = window.innerHeight - rect.bottom;
  
  let top;
  if (spaceAbove > 40 || spaceAbove > spaceBelow) {
    // Position above selection with more clearance
    top = window.scrollY + rect.top - 32; // 32px above the selection
  } else {
    // Position below selection with clearance
    top = window.scrollY + rect.bottom + 8; // 8px below the selection
  }
  
  el.style.position = 'absolute';
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

async function showBubbleForSelection() {
  try {
    const sel = window.getSelection();
    const text = sel.toString().trim();
    if (!text) { removeBubble(); return; }
    const range = sel.rangeCount ? sel.getRangeAt(0) : null;
    if (!range) { removeBubble(); return; }
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) { removeBubble(); return; }

    // create bubble if not present
    if (!_bubble) {
      const btn = document.createElement('button');
      btn.setAttribute('data-smarttranslate', 'bubble');
      btn.className = 'smarttranslate-bubble';
      btn.type = 'button';
      btn.title = 'Traduci';
      btn.textContent = '✦';
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        // fetch translation
        const resp = await sendMessageAsync({ type: 'TRANSLATE_TEXT', text });
        if (!resp || resp.error) {
          console.error('Errore traduzione:', resp);
          return;
        }
        removeBubble();
        showPopup(text, resp.translation);
      });
      document.body.appendChild(btn);
      _bubble = btn;
    }
    positionElementAtRect(_bubble, rect, 8, -6);
    // auto-remove bubble after some inactivity to avoid clutter
    if (_bubbleTimeout) clearTimeout(_bubbleTimeout);
    _bubbleTimeout = setTimeout(() => removeBubble(), 6000);
  } catch (err) {
    console.error('showBubbleForSelection failed', err);
    removeBubble();
  }
}

// show bubble on mouseup and keyup (keyboard selection)
const scheduleBubble = () => { setTimeout(showBubbleForSelection, 50); };
document.addEventListener('mouseup', scheduleBubble);
document.addEventListener('keyup', scheduleBubble);
// remove bubble when clicking elsewhere
document.addEventListener('click', (e) => {
  if (_bubble && !e.target.closest('[data-smarttranslate="bubble"]') && !e.target.closest('[data-smarttranslate="popup"]')) {
    removeBubble();
  }
});


// --- Funzione per creare il mini tooltip vicino al testo ---
function showPopup(original, translated) {
  // Rimuovi popup precedente (solo i nostri popup, usando un data-attribute)
  document.querySelectorAll('[data-smarttranslate="popup"]').forEach(e => e.remove());

  const popup = document.createElement("div");
  popup.className = "smarttranslate-popup";
  // Marca il popup come creato dalla nostra estensione per evitare collisioni
  popup.setAttribute('data-smarttranslate', 'popup');

  // Costruisci DOM in modo sicuro (no innerHTML con stringhe non attendibili)
  const boldOriginal = document.createElement('b');
  boldOriginal.textContent = original;
  const translatedDiv = document.createElement('div');
  translatedDiv.textContent = translated;

  // build header with original text + audio button
  const header = document.createElement('div');
  header.className = 'smarttranslate-header';

  const audioBtn = document.createElement('button');
  audioBtn.className = 'smarttranslate-audio-btn';
  audioBtn.type = 'button';
  audioBtn.title = 'Pronuncia';
  audioBtn.textContent = '🔊';

  audioBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    playPronunciation(original);
  });

  header.appendChild(boldOriginal);
  header.appendChild(audioBtn);

  // Translation section
  const translationSection = document.createElement('div');
  translationSection.className = 'smarttranslate-translation';
  translationSection.appendChild(translatedDiv);

  // plus button to show synonyms/examples or sentence breakdown
  const plusBtn = document.createElement('button');
  plusBtn.className = 'smarttranslate-plus-btn';
  plusBtn.type = 'button';
  plusBtn.title = 'Show more details';
  plusBtn.innerHTML = '<span class="plus-icon">+</span><span class="plus-text">Show details</span>';

  // details container (hidden by default)
  const details = document.createElement('div');
  details.className = 'smarttranslate-details';
  details.style.display = 'none';

  popup.appendChild(header);
  popup.appendChild(translationSection);
  popup.appendChild(plusBtn);
  popup.appendChild(details);

  document.body.appendChild(popup);
  // Make the popup draggable using CSS classes for cursor; position is absolute via CSS
  // Ensure any previous dragging class is cleared
  popup.classList.remove('dragging');

  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const onPointerMove = (ev) => {
    if (!isDragging) return;
    const popupW = popup.offsetWidth;
    const popupH = popup.offsetHeight;
    const viewportW = document.documentElement.clientWidth;
    const viewportH = document.documentElement.clientHeight;

    // desired position relative to document (including scroll)
    const desiredLeft = window.scrollX + ev.clientX - offsetX;
    const desiredTop = window.scrollY + ev.clientY - offsetY;

    // clamp so the popup stays in the visible viewport area
    const minLeft = window.scrollX;
    const maxLeft = window.scrollX + viewportW - popupW;
    const minTop = window.scrollY;
    const maxTop = window.scrollY + viewportH - popupH;

    const clampedLeft = clamp(desiredLeft, minLeft, Math.max(minLeft, maxLeft));
    const clampedTop = clamp(desiredTop, minTop, Math.max(minTop, maxTop));

    popup.style.left = `${clampedLeft}px`;
    popup.style.top = `${clampedTop}px`;
  };

  const onPointerUp = (ev) => {
    if (!isDragging) return;
    isDragging = false;
    document.removeEventListener('pointermove', onPointerMove);
    // suppress the immediate next click to avoid the outside-click handler removing the popup
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    // restore dragging visual state
    popup.classList.remove('dragging');
  };

  const onPointerDown = (ev) => {
    // Only start dragging with the primary pointer (usually left mouse button / touch)
    if (ev.button && ev.button !== 0) return;
    isDragging = true;
    const rect = popup.getBoundingClientRect();
    offsetX = ev.clientX - rect.left;
    offsetY = ev.clientY - rect.top;
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp, { once: true });
    // prevent text selection while dragging
    ev.preventDefault();
    // change cursor to closed/active hand while dragging
    popup.classList.add('dragging');
  };

  popup.addEventListener('pointerdown', onPointerDown);

  // Posiziona vicino alla selezione
  const rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
  popup.style.top = `${window.scrollY + rect.bottom + 8}px`;
  popup.style.left = `${window.scrollX + rect.left}px`;

  // Handler for plusBtn: fetch analysis or toggle
  let analysisLoaded = false;
  plusBtn.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    if (details.style.display === 'block') {
      details.style.display = 'none';
      popup.classList.remove('expanded');
      plusBtn.innerHTML = '<span class="plus-icon">+</span><span class="plus-text">Show details</span>';
      return;
    }
    // if already loaded, just show
    if (analysisLoaded) {
      details.style.display = 'block';
      popup.classList.add('expanded');
      plusBtn.innerHTML = '<span class="plus-icon">−</span><span class="plus-text">Hide details</span>';
      return;
    }
    // request analysis from background/proxy
    plusBtn.disabled = true;
    plusBtn.innerHTML = '<span class="plus-icon">…</span><span class="plus-text">Loading...</span>';
    const resp = await sendMessageAsync({ type: 'ANALYZE_TEXT', text: original });
    plusBtn.disabled = false;
    plusBtn.innerHTML = '<span class="plus-icon">−</span><span class="plus-text">Hide details</span>';
    if (!resp || resp.error) {
      const errMsg = resp ? (resp.message || resp.error || JSON.stringify(resp.raw || resp)) : 'no response';
      details.textContent = `Analisi non disponibile: ${errMsg}`;
      // if raw data exists, show a small JSON preview
      if (resp && resp.raw) {
        const pre = document.createElement('pre'); pre.style.whiteSpace = 'pre-wrap'; pre.style.maxHeight = '120px'; pre.style.overflow = 'auto'; pre.textContent = JSON.stringify(resp.raw, null, 2);
        details.appendChild(pre);
      }
      details.style.display = 'block';
      popup.classList.add('expanded');
      return;
    }
    const a = resp.analysis;
    // render based on type
    details.innerHTML = '';
    if (a.type === 'word' || a.word) {
      // synonyms, antonyms, examples
      const syn = (a.synonyms || []).slice(0, 12);
      const ant = (a.antonyms || a.contrary || []).slice(0, 12);
      const ex = (a.examples || []).slice(0, 6);
      if (syn.length) {
        const h = document.createElement('div'); h.className = 'st-detail-title'; h.textContent = 'Synonyms'; details.appendChild(h);
        const ul = document.createElement('div'); ul.className = 'st-list'; ul.textContent = syn.join(', '); details.appendChild(ul);
      }
      if (ant.length) {
        const h = document.createElement('div'); h.className = 'st-detail-title'; h.textContent = 'Antonyms'; details.appendChild(h);
        const ul = document.createElement('div'); ul.className = 'st-list'; ul.textContent = ant.join(', '); details.appendChild(ul);
      }
      if (ex.length) {
        const h = document.createElement('div'); h.className = 'st-detail-title'; h.textContent = 'Examples'; details.appendChild(h);
        ex.forEach(s => { const p = document.createElement('div'); p.className = 'st-example'; p.textContent = s; details.appendChild(p); });
      }
    } else if (a.type === 'sentence' || a.words) {
      const h = document.createElement('div'); h.className = 'st-detail-title'; h.textContent = 'Sentence breakdown'; details.appendChild(h);
      const container = document.createElement('div'); container.className = 'st-words';
      (a.words || []).forEach((w, idx) => {
        const item = document.createElement('div'); item.className = 'st-word-item';
        const left = document.createElement('div'); left.className = 'st-word-left'; left.textContent = `${w.word}`;
        const right = document.createElement('div'); right.className = 'st-word-right'; right.innerHTML = `<strong>${w.role || ''}</strong>: ${w.explanation || ''}`;
        item.appendChild(left); item.appendChild(right); container.appendChild(item);
      });
      details.appendChild(container);
      if (a.examples && a.examples.length) {
        const he = document.createElement('div'); he.className = 'st-detail-title'; he.textContent = 'Examples'; details.appendChild(he);
        a.examples.slice(0,6).forEach(s => { const p = document.createElement('div'); p.className = 'st-example'; p.textContent = s; details.appendChild(p); });
      }
    } else {
      details.textContent = 'Nessuna informazione disponibile.';
    }
    details.style.display = 'block';
    popup.classList.add('expanded');
    analysisLoaded = true;
  });


// Rimuove il popup quando si clicca fuori da esso
let suppressClick = false;
document.addEventListener('click', (e) => {
  const popup = document.querySelector('[data-smarttranslate="popup"]');
  if (!popup) return;
  if (suppressClick) { // a drag just finished — ignore this click
    suppressClick = false;
    return;
  }
  // se il click non è dentro il popup, rimuovilo
  if (!e.target.closest('[data-smarttranslate="popup"]')) {
    popup.remove();
  }
});

}
