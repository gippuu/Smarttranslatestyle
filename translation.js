// Translation.js - Core translation logic and analysis rendering
// This module handles context extraction, API communication, and detailed analysis display

// ============================================================================
// CONTEXT EXTRACTION
// ============================================================================

/**
 * Extract surrounding context from the selection
 * @param {Range} range - The selection range
 * @param {string} selectedText - The selected text
 * @returns {string} - Surrounding context (up to 500 chars)
 */
function extractSelectionContext(range, selectedText) {
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

// ============================================================================
// DETAILED ANALYSIS RENDERING
// ============================================================================

/**
 * Render detailed analysis with structured sections
 * @param {HTMLElement} container - Container element
 * @param {Object} analysis - Analysis data from API
 * @param {string} originalText - Original text for audio playback
 */
function renderDetailedAnalysis(container, analysis, originalText) {
  container.innerHTML = '';

  // 📖 FULL EXPLANATION
  if (analysis.explanation) {
    const explSection = createSection('📖 FULL EXPLANATION');

    const explText = document.createElement('div');
    explText.className = 'st-section-content';
    explText.textContent = analysis.explanation;
    explSection.appendChild(explText);

    container.appendChild(explSection);
    container.appendChild(createSeparator());
  }

  // 🔤 LITERAL VS DEEP MEANING
  if (analysis.literalTranslation || analysis.deepMeaning) {
    const meaningSection = createSection('🔤 LITERAL VS DEEP MEANING');

    if (analysis.literalTranslation) {
      const literalDiv = createMeaningItem('Literal:', analysis.literalTranslation, 'st-literal');
      meaningSection.appendChild(literalDiv);
    }

    if (analysis.deepMeaning) {
      const deepDiv = createMeaningItem('Deep Meaning:', analysis.deepMeaning, 'st-deep');
      meaningSection.appendChild(deepDiv);
    }

    container.appendChild(meaningSection);
    container.appendChild(createSeparator());
  }

  // 📝 SENTENCE STRUCTURE (Word-by-word breakdown)
  if (analysis.sentenceStructure && analysis.sentenceStructure.words && analysis.sentenceStructure.words.length > 0) {
    const structSection = createSection('📝 SENTENCE STRUCTURE');
    const structTable = createStructureTable(analysis.sentenceStructure.words);
    structSection.appendChild(structTable);
    container.appendChild(structSection);
    container.appendChild(createSeparator());
  }

  // 🔄 SYNONYMS & ALTERNATIVES
  if (analysis.synonyms && analysis.synonyms.length > 0) {
    const synSection = createSection('🔄 SYNONYMS & ALTERNATIVES');
    const synList = createBulletList(analysis.synonyms);
    synSection.appendChild(synList);
    container.appendChild(synSection);
    container.appendChild(createSeparator());
  }

  // 💬 EXAMPLE SENTENCES
  if (analysis.examples && analysis.examples.length > 0) {
    const exSection = createSection('💬 EXAMPLE SENTENCES');
    const exList = createExamplesList(analysis.examples);
    exSection.appendChild(exList);
    container.appendChild(exSection);
    container.appendChild(createSeparator());
  }

  // ⚠️ DON'T CONFUSE WITH
  if (analysis.confusables && analysis.confusables.length > 0) {
    const confSection = createSection('⚠️ DON\'T CONFUSE WITH');
    const confList = createBulletList(analysis.confusables);
    confSection.appendChild(confList);
    container.appendChild(confSection);
    container.appendChild(createSeparator());
  }

  // 🎯 USAGE NOTES
  if (analysis.usageNotes) {
    const usageSection = createSection('🎯 USAGE NOTES');
    const usageList = createUsageNotesList(analysis.usageNotes);
    usageSection.appendChild(usageList);
    container.appendChild(usageSection);
  }

  // Action buttons at bottom
  const actionsDiv = createActionButtons(originalText);
  container.appendChild(actionsDiv);
}

// ============================================================================
// HELPER FUNCTIONS FOR RENDERING
// ============================================================================

function createSection(title) {
  const section = document.createElement('div');
  section.className = 'st-section';

  const titleEl = document.createElement('div');
  titleEl.className = 'st-section-title';
  titleEl.textContent = title;
  section.appendChild(titleEl);

  return section;
}

function createSeparator() {
  const sep = document.createElement('div');
  sep.className = 'st-separator';
  return sep;
}

function createMeaningItem(label, text, className) {
  const div = document.createElement('div');
  div.className = 'st-meaning-item';

  const labelEl = document.createElement('div');
  labelEl.className = 'st-meaning-label';
  labelEl.textContent = label;
  div.appendChild(labelEl);

  const textEl = document.createElement('div');
  textEl.className = `st-meaning-text ${className}`;
  textEl.textContent = text;
  div.appendChild(textEl);

  return div;
}

function createStructureTable(words) {
  const table = document.createElement('div');
  table.className = 'st-structure-table';

  words.forEach((wordInfo, index) => {
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
    table.appendChild(row);
  });

  return table;
}

function createBulletList(items) {
  const list = document.createElement('ul');
  list.className = 'st-bullet-list';
  items.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  });
  return list;
}

function createExamplesList(examples) {
  const list = document.createElement('div');
  list.className = 'st-examples-list';
  examples.forEach(ex => {
    const exItem = document.createElement('div');
    exItem.className = 'st-example-item';
    exItem.textContent = ex;
    list.appendChild(exItem);
  });
  return list;
}

function createUsageNotesList(usageNotes) {
  const list = document.createElement('ul');
  list.className = 'st-bullet-list';

  if (usageNotes.formality) {
    const li = document.createElement('li');
    li.textContent = `Formality: ${usageNotes.formality}`;
    list.appendChild(li);
  }
  if (usageNotes.register) {
    const li = document.createElement('li');
    li.textContent = `Register: ${usageNotes.register}`;
    list.appendChild(li);
  }
  if (usageNotes.frequency) {
    const li = document.createElement('li');
    li.textContent = `Frequency: ${usageNotes.frequency}`;
    list.appendChild(li);
  }

  return list;
}

function createActionButtons(originalText) {
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'st-actions';

  const listenBtn = document.createElement('button');
  listenBtn.className = 'st-action-btn';
  listenBtn.innerHTML = '🔊 Listen Again';
  listenBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Call playPronunciation from content.js
    if (typeof playPronunciation === 'function') {
      playPronunciation(originalText);
    }
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
  return actionsDiv;
}

// ============================================================================
// API DATA STRUCTURE DOCUMENTATION
// ============================================================================

/*
Expected API Response Structure:

{
  "translation": "Translated text",
  "detailedAnalysis": {
    "clarification": "Brief clarification shown under translation",
    "explanation": "Full contextual explanation",

    "literalTranslation": "Word-for-word translation",
    "deepMeaning": "Actual contextual/idiomatic meaning",

    "sentenceStructure": {
      "words": [
        {
          "word": "going",
          "position": 2,
          "baseForm": "go",
          "role": "Main verb (present continuous)",
          "meaning": "andando",
          "notes": "Indicates ongoing action or future intention"
        }
      ]
    },

    "synonyms": [
      "financial institution (formal)",
      "credit union"
    ],

    "examples": [
      "I need to go to the bank to deposit money",
      "My bank offers good interest rates"
    ],

    "confusables": [
      "riverbank = orilla del río",
      "banca = banking industry"
    ],

    "usageNotes": {
      "formality": "Neutral (used everywhere)",
      "register": "Standard English",
      "frequency": "Very common word"
    }
  }
}
*/
