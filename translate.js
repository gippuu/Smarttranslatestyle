export default async function handler(req, res) {
  // Robust body parsing for Vercel/Node environments
  if (req.method === 'POST' && !req.body) {
    try {
      req.body = JSON.parse(await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
        req.on('error', reject);
      }));
    } catch (e) {
      return res.status(400).json({ error: 'invalid_json', detail: String(e) });
    }
  }
  
  // Basic CORS handling for browser/ext requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-proxy-token');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  try {
    const { text, target, tts, voice, action } = req.body || {};
    if (!text || typeof text !== 'string') return res.status(400).json({ error: 'missing_text' });
    if (text.length > 10000) return res.status(400).json({ error: 'text_too_long' });

    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_KEY) return res.status(500).json({ error: 'server_misconfigured' });

    const model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

    // ===== ENHANCED ANALYZE ACTION =====
    if (action === 'analyze') {
      // Detect if input is a single word or sentence
      const trimmed = text.trim();
      const wordCount = trimmed.split(/\s+/).length;
      const isSingleWord = wordCount === 1 && !/[.!?;]/.test(trimmed);

      let systemPrompt, userPrompt;

      if (isSingleWord) {
        systemPrompt = 'You are a linguistic assistant. Respond ONLY with valid JSON, no markdown, no code fences, no extra text.';
        userPrompt = `Analyze the word "${trimmed}" and return a JSON object with this exact structure:
{
  "type": "word",
  "word": "${trimmed}",
  "definition": "brief definition",
  "synonyms": ["synonym1", "synonym2", "synonym3"],
  "antonyms": ["antonym1", "antonym2"],
  "examples": ["Example sentence 1", "Example sentence 2", "Example sentence 3"]
}

Return ONLY the JSON object, nothing else.`;
      } else {
        systemPrompt = 'You are a linguistic assistant. Respond ONLY with valid JSON, no markdown, no code fences, no extra text.';
        userPrompt = `Analyze this sentence and return a JSON object with this exact structure:
{
  "type": "sentence",
  "sentence": "${trimmed}",
  "words": [
    {
      "word": "actual_word",
      "index": 0,
      "role": "noun/verb/adjective/etc",
      "explanation": "brief explanation of its grammatical role"
    }
  ],
  "meaning": "overall meaning of the sentence",
  "examples": ["Similar example 1", "Similar example 2"]
}

Sentence to analyze: "${trimmed}"

Return ONLY the JSON object, nothing else.`;
      }

      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_KEY}`
        },
        body: JSON.stringify({ 
          model, 
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ], 
          max_tokens: 1000, 
          temperature: 0.3,
          response_format: { type: "json_object" }  // Force JSON mode if supported
        })
      });

      if (!resp.ok) {
        const txt = await resp.text();
        console.error('OpenAI error:', txt);
        return res.status(502).json({ error: 'openai_error', detail: txt });
      }

      const data = await resp.json();
      let content = data?.choices?.[0]?.message?.content || '';
      
      // Clean up the response
      content = content.trim();
      
      // Remove markdown code fences if present
      content = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
      
      // Try to parse JSON
      let parsed = null;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        // Try to extract JSON from text
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            parsed = JSON.parse(jsonMatch[0]);
          } catch (e2) {
            console.error('Failed to parse extracted JSON:', e2);
            console.error('Raw content:', content);
            return res.status(502).json({ 
              error: 'invalid_analysis', 
              raw: content,
              hint: 'Could not parse model output as JSON'
            });
          }
        } else {
          console.error('No JSON found in response:', content);
          return res.status(502).json({ 
            error: 'invalid_analysis', 
            raw: content,
            hint: 'No JSON structure found in response'
          });
        }
      }

      // Validate structure
      if (!parsed || typeof parsed !== 'object') {
        return res.status(502).json({ 
          error: 'invalid_analysis', 
          raw: content,
          hint: 'Parsed result is not an object'
        });
      }

      // Ensure required fields exist
      if (parsed.type === 'word') {
        parsed.synonyms = parsed.synonyms || [];
        parsed.antonyms = parsed.antonyms || [];
        parsed.examples = parsed.examples || [];
      } else if (parsed.type === 'sentence') {
        parsed.words = parsed.words || [];
        parsed.examples = parsed.examples || [];
      }

      return res.json({ analysis: parsed });
    }
    // ===== END ANALYZE ACTION =====

    // If client requests TTS, attempt to generate audio via configured provider
    if (tts) {
      const ELEVEN_KEY = process.env.ELEVENLABS_KEY || process.env.ELEVEN_API_KEY || null;
      const ELEVEN_VOICE = process.env.ELEVEN_VOICE_ID || voice || null;
      
      if (!ELEVEN_KEY || !ELEVEN_VOICE) {
        return res.status(500).json({ 
          error: 'tts_not_configured', 
          detail: 'Missing ELEVENLABS_KEY or ELEVEN_VOICE_ID in server env' 
        });
      }

      try {
        const elevenResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}`, {
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': ELEVEN_KEY
          },
          body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' })
        });

        if (!elevenResp.ok) {
          const txt = await elevenResp.text().catch(() => '');
          return res.status(502).json({ 
            error: 'eleven_error', 
            status: elevenResp.status, 
            detail: txt 
          });
        }

        const arrayBuffer = await elevenResp.arrayBuffer();
        const audioBase64 = Buffer.from(arrayBuffer).toString('base64');
        return res.json({ audio: audioBase64, mime: 'audio/mpeg' });
      } catch (err) {
        console.error('ElevenLabs TTS error:', err);
        return res.status(502).json({ 
          error: 'tts_failed', 
          message: String(err?.message || err) 
        });
      }
    }

    // Default: translation
    const messages = [
      { 
        role: 'system', 
        content: 'You are a concise, literal translator. Always reply only with the translated text and nothing else.' 
      },
      { 
        role: 'user', 
        content: `Translate the following text to ${target || 'it'} exactly (do not add commentary):\n"""\n${text}\n"""` 
      }
    ];

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({ model, messages, max_tokens: 800, temperature: 0.0 })
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return res.status(502).json({ error: 'openai_error', detail: txt });
    }

    const data = await resp.json();
    const translation = data?.choices?.[0]?.message?.content?.trim();
    
    if (!translation) {
      return res.status(502).json({ error: 'no_translation', raw: data });
    }

    return res.json({ translation });
    
  } catch (err) {
    console.error('Handler error:', err);
    res.status(500).json({ 
      error: 'proxy_failed', 
      message: String(err?.message || err) 
    });
  }
}
