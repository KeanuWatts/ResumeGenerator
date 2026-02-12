/************************************************************
 * B2 → DeepSeek → Fill B3..B6
 * Layout (active sheet):
 *   B2  Job Description (input)
 *   B3  Title (output)
 *   B4  Company (output)
 *   B5  KSAs (joined; semicolons)
 *   B6  Acronyms (joined; commas)
 *
 * Before use: in Apps Script editor, go to:
 *   Project Settings → Script properties → Add:
 *     DEEPSEEK_API_KEY = sk-...your key...
 ************************************************************/

const MAX_INPUT_CHARS = 50000;

function extractFields_FromB2() {
  const sh = SpreadsheetApp.getActiveSheet();

  const jobText = String(sh.getRange('B2').getValue() || '').trim();
  if (!jobText) {
    throw new Error('Cell B2 is empty. Paste a job description into B2 first.');
  }
  if (jobText.length > MAX_INPUT_CHARS) {
    throw new Error(`Job text too long (${jobText.length}). Limit is ${MAX_INPUT_CHARS} characters.`);
  }

  // Call DeepSeek
  const parsed = callDeepSeekForFields_(jobText);

  // Write results
  sh.getRange('B3').setValue(parsed.title || '');
  sh.getRange('B4').setValue(parsed.company || '');
  sh.getRange('B5').setValue((parsed.ksas || []).join('; '));
  sh.getRange('B6').setValue((parsed.acronyms || []).join(', '));
}

/* ---------------- DeepSeek helper ---------------- */

function callDeepSeekForFields_(jobText) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('DEEPSEEK_API_KEY');
  if (!apiKey) {
    throw new Error('Missing DEEPSEEK_API_KEY in Script Properties.');
  }

  const system = [
    'You are a precise information extractor for job descriptions.',
    'Return STRICT JSON with keys: title (string), company (string),',
    'ksas (array of concise KSA phrases, max 25), acronyms (array of UPPERCASE strings).',
    'If unknown, use an empty string or empty array. No extra keys, no commentary.'
  ].join(' ');

  const user = [
    'Extract fields from this job description:',
    jobText
  ].join('\n\n');

  const payload = {
    model: DS_MODEL,
    temperature: DS_TEMPERATURE,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    response_format: { type: 'json_object' } // nudge for pure-JSON
  };

  const res = UrlFetchApp.fetch(DS_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { Authorization: `Bearer ${apiKey}` },
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`DeepSeek HTTP ${code}: ${res.getContentText()}`);
  }

  const data = JSON.parse(res.getContentText());
  const text = data.choices?.[0]?.message?.content || '{}';

  // Be resilient if the model returned a JSON string inside the content
  let obj;
  try {
    obj = typeof text === 'string' ? JSON.parse(text) : text;
  } catch (e) {
    throw new Error('DeepSeek returned non-JSON content. Raw: ' + text);
  }

  // Normalize shapes
  return {
    title: (obj.title || '').toString().trim(),
    company: (obj.company || '').toString().trim(),
    ksas: Array.isArray(obj.ksas) ? obj.ksas.map(s => String(s).trim()).filter(Boolean) : [],
    acronyms: Array.isArray(obj.acronyms) ? obj.acronyms.map(s => String(s).trim().toUpperCase()).filter(Boolean) : [],
  };
}

/* -------------- Optional: custom menu -------------- */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Resume Tools')
    .addItem('Extract Title/Company/KSAs/Acronyms from B2', 'extractFields_FromB2')
    .addToUi();
}
