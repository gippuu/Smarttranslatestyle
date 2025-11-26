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
let _lastRequestTime = 0;
const REQUEST_COOLDOWN_MS = 2000; // 2 second cooldown between requests

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

// Extract surrounding context from the selection
function getSelectionContext(range, selectedText) {
  try {
    // Get the container node
    const container = range.commonAncestorContainer;
    const textNode = container.nodeType === Node.TEXT_NODE ? container : container.parentNode;

    // Try to get the full paragraph or sentence context
    let contextText = '';

    // First, try to get the parent paragraph
    let parentElement = textNode;
    while (parentElement && parentElement !== document.body) {
      if (parentElement.tagName && ['P', 'DIV', 'ARTICLE', 'SECTION', 'LI', 'TD', 'TH'].includes(parentElement.tagName)) {
        contextText = parentElement.textContent || '';
        break;
      }
      parentElement = parentElement.parentNode;
    }

    // If no paragraph found or text is too short, get surrounding text nodes
    if (!contextText || contextText.length < 50) {
      contextText = textNode.textContent || '';
    }

    // Clean and limit context length (200 chars before + 200 after the selection)
    contextText = contextText.trim().replace(/\s+/g, ' ');
    const selectedIndex = contextText.indexOf(selectedText);

    if (selectedIndex !== -1 && contextText.length > 500) {
      const start = Math.max(0, selectedIndex - 200);
      const end = Math.min(contextText.length, selectedIndex + selectedText.length + 200);
      contextText = (start > 0 ? '...' : '') + contextText.substring(start, end) + (end < contextText.length ? '...' : '');
    } else if (contextText.length > 500) {
      contextText = contextText.substring(0, 500) + '...';
    }

    return contextText;
  } catch (err) {
    console.warn('Failed to extract context:', err);
    return '';
  }
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

        // Check cooldown to prevent rate limiting
        const now = Date.now();
        if (now - _lastRequestTime < REQUEST_COOLDOWN_MS) {
          console.warn('Please wait before making another request');
          return;
        }
        _lastRequestTime = now;

        // fetch translation with context
        const context = getSelectionContext(range, text);
        const resp = await sendMessageAsync({ type: 'TRANSLATE_TEXT', text, context });
        if (!resp || resp.error) {
          console.error('Errore traduzione:', resp);
          if (resp && resp.status === 429) {
            alert('Rate limit reached. Please wait a moment before translating again.');
          }
          return;
        }
        removeBubble();
        showPopup(text, resp.translation, resp.detailedAnalysis, context);
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


// Render detailed analysis with structured sections
function renderDetailedAnalysis(container, analysis, originalText) {
  container.innerHTML = '';

  // 📖 FULL EXPLANATION
  if (analysis.explanation) {
    const explSection = document.createElement('div');
    explSection.className = 'st-section';

    const explTitle = document.createElement('div');
    explTitle.className = 'st-section-title';
    explTitle.textContent = '📖 FULL EXPLANATION';
    explSection.appendChild(explTitle);

    const explText = document.createElement('div');
    explText.className = 'st-section-content';
    explText.textContent = analysis.explanation;
    explSection.appendChild(explText);

    container.appendChild(explSection);

    // Add separator
    const sep1 = document.createElement('div');
    sep1.className = 'st-separator';
    container.appendChild(sep1);
  }

  // 🔤 LITERAL VS DEEP MEANING
  if (analysis.literalTranslation || analysis.deepMeaning) {
    const meaningSection = document.createElement('div');
    meaningSection.className = 'st-section';

    const meaningTitle = document.createElement('div');
    meaningTitle.className = 'st-section-title';
    meaningTitle.textContent = '🔤 LITERAL VS DEEP MEANING';
    meaningSection.appendChild(meaningTitle);

    if (analysis.literalTranslation) {
      const literalDiv = document.createElement('div');
      literalDiv.className = 'st-meaning-item';

      const literalLabel = document.createElement('div');
      literalLabel.className = 'st-meaning-label';
      literalLabel.textContent = 'Literal:';
      literalDiv.appendChild(literalLabel);

      const literalText = document.createElement('div');
      literalText.className = 'st-meaning-text st-literal';
      literalText.textContent = analysis.literalTranslation;
      literalDiv.appendChild(literalText);

      meaningSection.appendChild(literalDiv);
    }

    if (analysis.deepMeaning) {
      const deepDiv = document.createElement('div');
      deepDiv.className = 'st-meaning-item';

      const deepLabel = document.createElement('div');
      deepLabel.className = 'st-meaning-label';
      deepLabel.textContent = 'Deep Meaning:';
      deepDiv.appendChild(deepLabel);

      const deepText = document.createElement('div');
      deepText.className = 'st-meaning-text st-deep';
      deepText.textContent = analysis.deepMeaning;
      deepDiv.appendChild(deepText);

      meaningSection.appendChild(deepDiv);
    }

    container.appendChild(meaningSection);

    const sep2 = document.createElement('div');
    sep2.className = 'st-separator';
    container.appendChild(sep2);
  }

  // 📝 SENTENCE STRUCTURE (Word-by-word breakdown)
  if (analysis.sentenceStructure && analysis.sentenceStructure.words && analysis.sentenceStructure.words.length > 0) {
    const structSection = document.createElement('div');
    structSection.className = 'st-section';

    const structTitle = document.createElement('div');
    structTitle.className = 'st-section-title';
    structTitle.textContent = '📝 SENTENCE STRUCTURE';
    structSection.appendChild(structTitle);

    const structTable = document.createElement('div');
    structTable.className = 'st-structure-table';

    analysis.sentenceStructure.words.forEach((wordInfo, index) => {
      const row = document.createElement('div');
      row.className = 'st-structure-row';

      // Position number
      const posCell = document.createElement('div');
      posCell.className = 'st-structure-pos';
      posCell.textContent = wordInfo.position || (index + 1);
      row.appendChild(posCell);

      // Word details
      const detailsCell = document.createElement('div');
      detailsCell.className = 'st-structure-details';

      const wordDiv = document.createElement('div');
      wordDiv.className = 'st-structure-word';
      wordDiv.textContent = wordInfo.word;
      detailsCell.appendChild(wordDiv);

      if (wordInfo.baseForm && wordInfo.baseForm !== wordInfo.word) {
        const baseDiv = document.createElement('div');
        baseDiv.className = 'st-structure-base';
        baseDiv.textContent = `Base: ${wordInfo.baseForm}`;
        detailsCell.appendChild(baseDiv);
      }

      const roleDiv = document.createElement('div');
      roleDiv.className = 'st-structure-role';
      roleDiv.textContent = wordInfo.role || 'Unknown';
      detailsCell.appendChild(roleDiv);

      if (wordInfo.meaning) {
        const meaningDiv = document.createElement('div');
        meaningDiv.className = 'st-structure-meaning';
        meaningDiv.textContent = `→ ${wordInfo.meaning}`;
        detailsCell.appendChild(meaningDiv);
      }

      if (wordInfo.notes) {
        const notesDiv = document.createElement('div');
        notesDiv.className = 'st-structure-notes';
        notesDiv.textContent = wordInfo.notes;
        detailsCell.appendChild(notesDiv);
      }

      row.appendChild(detailsCell);
      structTable.appendChild(row);
    });

    structSection.appendChild(structTable);
    container.appendChild(structSection);

    const sep3 = document.createElement('div');
    sep3.className = 'st-separator';
    container.appendChild(sep3);
  }

  // 🔄 SYNONYMS & ALTERNATIVES
  if (analysis.synonyms && analysis.synonyms.length > 0) {
    const synSection = document.createElement('div');
    synSection.className = 'st-section';

    const synTitle = document.createElement('div');
    synTitle.className = 'st-section-title';
    synTitle.textContent = '🔄 SYNONYMS & ALTERNATIVES';
    synSection.appendChild(synTitle);

    const synList = document.createElement('ul');
    synList.className = 'st-bullet-list';
    analysis.synonyms.forEach(syn => {
      const li = document.createElement('li');
      li.textContent = syn;
      synList.appendChild(li);
    });
    synSection.appendChild(synList);

    container.appendChild(synSection);

    const sep4 = document.createElement('div');
    sep4.className = 'st-separator';
    container.appendChild(sep4);
  }

  // 💬 EXAMPLE SENTENCES
  if (analysis.examples && analysis.examples.length > 0) {
    const exSection = document.createElement('div');
    exSection.className = 'st-section';

    const exTitle = document.createElement('div');
    exTitle.className = 'st-section-title';
    exTitle.textContent = '💬 EXAMPLE SENTENCES';
    exSection.appendChild(exTitle);

    const exList = document.createElement('div');
    exList.className = 'st-examples-list';
    analysis.examples.forEach(ex => {
      const exItem = document.createElement('div');
      exItem.className = 'st-example-item';
      exItem.textContent = ex;
      exList.appendChild(exItem);
    });
    exSection.appendChild(exList);

    container.appendChild(exSection);

    const sep5 = document.createElement('div');
    sep5.className = 'st-separator';
    container.appendChild(sep5);
  }

  // ⚠️ DON'T CONFUSE WITH
  if (analysis.confusables && analysis.confusables.length > 0) {
    const confSection = document.createElement('div');
    confSection.className = 'st-section';

    const confTitle = document.createElement('div');
    confTitle.className = 'st-section-title';
    confTitle.textContent = '⚠️ DON\'T CONFUSE WITH';
    confSection.appendChild(confTitle);

    const confList = document.createElement('ul');
    confList.className = 'st-bullet-list';
    analysis.confusables.forEach(conf => {
      const li = document.createElement('li');
      li.textContent = conf;
      confList.appendChild(li);
    });
    confSection.appendChild(confList);

    container.appendChild(confSection);

    const sep6 = document.createElement('div');
    sep6.className = 'st-separator';
    container.appendChild(sep6);
  }

  // 🎯 USAGE NOTES
  if (analysis.usageNotes) {
    const usageSection = document.createElement('div');
    usageSection.className = 'st-section';

    const usageTitle = document.createElement('div');
    usageTitle.className = 'st-section-title';
    usageTitle.textContent = '🎯 USAGE NOTES';
    usageSection.appendChild(usageTitle);

    const usageList = document.createElement('ul');
    usageList.className = 'st-bullet-list';

    if (analysis.usageNotes.formality) {
      const li = document.createElement('li');
      li.textContent = `Formality: ${analysis.usageNotes.formality}`;
      usageList.appendChild(li);
    }
    if (analysis.usageNotes.register) {
      const li = document.createElement('li');
      li.textContent = `Register: ${analysis.usageNotes.register}`;
      usageList.appendChild(li);
    }
    if (analysis.usageNotes.frequency) {
      const li = document.createElement('li');
      li.textContent = `Frequency: ${analysis.usageNotes.frequency}`;
      usageList.appendChild(li);
    }

    usageSection.appendChild(usageList);
    container.appendChild(usageSection);
  }

  // Action buttons at bottom
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'st-actions';

  const listenBtn = document.createElement('button');
  listenBtn.className = 'st-action-btn';
  listenBtn.innerHTML = '🔊 Listen Again';
  listenBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    playPronunciation(originalText);
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'st-action-btn st-close-btn';
  closeBtn.innerHTML = '✕ Close';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const popup = document.querySelector('[data-smarttranslate="popup"]');
    if (popup) popup.remove();
  });

  actionsDiv.appendChild(listenBtn);
  actionsDiv.appendChild(closeBtn);
  container.appendChild(actionsDiv);
}

// --- Funzione per creare il mini tooltip vicino al testo ---
function showPopup(original, translated, detailedAnalysis = null, context = '') {
  // Rimuovi popup precedente (solo i nostri popup, usando un data-attribute)
  document.querySelectorAll('[data-smarttranslate="popup"]').forEach(e => e.remove());

  const popup = document.createElement("div");
  popup.className = "smarttranslate-popup";
  // Marca il popup come creato dalla nostra estensione per evitare collisioni
  popup.setAttribute('data-smarttranslate', 'popup');

  // Costruisci DOM in modo sicuro (no innerHTML con stringhe non attendibili)
  const boldOriginal = document.createElement('b');
  boldOriginal.className = 'smarttranslate-original-text';
  // Truncate long text with smart word boundary
  const maxLength = 50;
  let displayText = original;
  if (original.length > maxLength) {
    // Find last space before maxLength to avoid cutting words
    const truncated = original.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    displayText = (lastSpace > 0 ? original.substring(0, lastSpace) : truncated) + '...';
    // Store full text in title for tooltip
    boldOriginal.title = original;
  }
  boldOriginal.textContent = displayText;

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

  // Translation section - now includes clarification if available
  const translationSection = document.createElement('div');
  translationSection.className = 'smarttranslate-translation';

  const translatedDiv = document.createElement('div');
  translatedDiv.className = 'st-translation-text';
  translatedDiv.textContent = translated;
  translationSection.appendChild(translatedDiv);

  // Add clarification if available from detailed analysis
  if (detailedAnalysis && detailedAnalysis.clarification) {
    const clarificationDiv = document.createElement('div');
    clarificationDiv.className = 'st-clarification';
    clarificationDiv.textContent = detailedAnalysis.clarification;
    translationSection.appendChild(clarificationDiv);
  }

  // plus button to show synonyms/examples or sentence breakdown
  const plusBtn = document.createElement('button');
  plusBtn.className = 'smarttranslate-plus-btn';
  plusBtn.type = 'button';
  plusBtn.title = 'Show more details';

  // details container
  const details = document.createElement('div');
  details.className = 'smarttranslate-details';

  // If we have detailed analysis, show it immediately
  let analysisLoaded = false;
  if (detailedAnalysis) {
    renderDetailedAnalysis(details, detailedAnalysis, original);
    details.style.display = 'block';
    popup.classList.add('expanded');
    plusBtn.innerHTML = '<span class="plus-icon">−</span><span class="plus-text">Hide details</span>';
    analysisLoaded = true;
  } else {
    details.style.display = 'none';
    plusBtn.innerHTML = '<span class="plus-icon">+</span><span class="plus-text">Show details</span>';
  }

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

  // Handler for plusBtn: fetch analysis or toggle (analysisLoaded already declared above)
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
    // Try to use the new detailed format if available, otherwise fall back to legacy
    if (a.explanation || a.synonyms || a.examples || a.confusables || a.usageNotes) {
      // New detailed format
      renderDetailedAnalysis(details, a, original);
    } else {
      // Legacy format for backward compatibility
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
