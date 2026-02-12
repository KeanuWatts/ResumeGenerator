/************************************************************
 * Generate / Update Cover Letter (pulls resume from B7 URL)
 * Inputs (active sheet):
 *   B3  = Position Title
 *   B4  = Company
 *   B5  = KSAs (optional)
 *   B6  = Acronyms (optional)
 *   B7  = Resume Google Doc URL  <-- USED as the resume body source
 *   B9  = Individual's Name (e.g., "Morgan Kesecker")
 * Output:
 *   B8  = Cover Letter Google Doc URL
 *
 * Behavior:
 * - Opens the Doc in B7, extracts plaintext, and feeds that to the LLM.
 * - Writes ONLY the letter Doc URL to B8 (no other cells touched).
 * - Ensures a single greeting and single closing (no duplicated sign-off).
 ************************************************************/

function generateOrUpdateCoverLetter() {
  const sh = SpreadsheetApp.getActiveSheet();

  const title    = String(sh.getRange('B3').getValue() || '').trim();
  const company  = String(sh.getRange('B4').getValue() || '').trim();
  const ksas     = String(sh.getRange('B5').getValue() || '').trim();
  const acr      = String(sh.getRange('B6').getValue() || '').trim();
  const resumeUrl= String(sh.getRange('B7').getValue() || '').trim();
  const person   = String(sh.getRange('B9').getValue() || '').trim();

  // Pull resume text from B7 Doc
  const resume = extractDocTextFromUrl_(resumeUrl).trim();
  if (!resume) throw new Error('Resume Doc (B7) missing or empty.');

  const norm = v => (v || '').replace(/[^\w\s-]/g, '').trim() || 'Untitled';
  const safePerson = norm(person) || 'Candidate';
  const docName = `${norm(title)}_${norm(company)}_${safePerson}_Cover Letter`;

  const bodyOnly = callDeepSeek_CoverLetterBody_(resume, title, company, ksas, acr);

  const existingUrl = String(sh.getRange('B8').getValue() || '').trim();
  const { doc, docId } = openOrCreateDoc_(existingUrl, docName);

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM d, yyyy');
  const clean = cleanupLetterBody_(bodyOnly);

  const body = doc.getBody();
  body.clear();

  // Helper for plain text lines
  const addP = (txt) => body.appendParagraph(String(txt || '')).setFontFamily('Arial').setFontSize(11);

  // ---- Format with spacing ----
  addP(today);
  addP(company);
  addP('');   // blank line

  addP('Dear Hiring Manager,');
  addP('');   // blank line

  // Split the model’s body into paragraphs
  clean.split(/\n\s*\n/).forEach(p => {
    addP(p.trim());
    addP(''); // blank line after each paragraph
  });

  addP('Sincerely,');
  addP(person || 'Candidate');

  DriveApp.getFileById(docId).setName(docName);
  doc.saveAndClose();

  sh.getRange('B8').setValue('https://docs.google.com/document/d/' + docId + '/edit');
}


/* ---------------- DeepSeek call ---------------- */

function callDeepSeek_CoverLetterBody_(resumeText, title, company, ksas, acronyms) {
  const DS_ENDPOINT     = 'https://api.deepseek.com/v1/chat/completions';
  const DS_MODEL        = 'deepseek-chat';
  const DS_TEMPERATURE  = 0.28;
  const MAX_INPUT_CHARS = 50000;

  const apiKey = PropertiesService.getScriptProperties().getProperty('DEEPSEEK_API_KEY');
  if (!apiKey) throw new Error('Missing DEEPSEEK_API_KEY in Script Properties.');
  if (resumeText.length > MAX_INPUT_CHARS) {
    throw new Error(`Resume text too long (${resumeText.length}). Limit is ${MAX_INPUT_CHARS}.`);
  }

  const contextLines = [
    title    ? `Target position: ${title}` : '',
    company  ? `Company: ${company}` : '',
    ksas     ? `Relevant KSAs: ${ksas}` : '',
    acronyms ? `Acronyms/context: ${acronyms}` : ''
  ].filter(Boolean).join('\n');

  const system = [
    'You are a professional cover-letter writer.',
    'Write ONLY the body paragraphs (no date line, no greeting, no closing, no signature).',
    '3–5 concise paragraphs, ~220–350 words, clear US business English.',
    'Strict grounding: use only facts from the provided resume text and KSAs/acronyms.',
    'Do NOT invent employers, titles, dates, or achievements. No valediction or name.'
  ].join(' ');

  const user = [
    contextLines,
    '',
    'Resume (plaintext extracted from Google Doc):',
    resumeText
  ].join('\n');

  const payload = {
    model: DS_MODEL,
    temperature: DS_TEMPERATURE,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user }
    ]
  };

  const res = UrlFetchApp.fetch(DS_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { Authorization: 'Bearer ' + apiKey },
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`DeepSeek HTTP ${code}: ${res.getContentText()}`);
  }

  const data = JSON.parse(res.getContentText());
  let text = data.choices?.[0]?.message?.content || '';

  // Strip code fences (if any)
  text = text.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '');

  return text.trim();
}

/* ---------------- Google Doc text extraction ---------------- */

function extractDocTextFromUrl_(url) {
  if (!url) return '';
  const m = url.match(/[-\w]{25,}/);
  if (!m) return '';
  try {
    const doc = DocumentApp.openById(m[0]);
    const body = doc.getBody();
    if (!body) return '';
    // Get text with newlines; include list items & tables best-effort
    let text = body.getText() || '';
    // Normalize whitespace a bit
    text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    return text;
  } catch (e) {
    return '';
  }
}

/* ---------------- Utilities ---------------- */

function openOrCreateDoc_(url, desiredName) {
  const match = url && url.match(/[-\w]{25,}/);
  if (match) {
    try {
      const docId = match[0];
      const doc = DocumentApp.openById(docId);
      return { doc, docId };
    } catch (e) {
      // fall through to create new
    }
  }
  const doc = DocumentApp.create(desiredName);
  return { doc, docId: doc.getId() };
}

function cleanupLetterBody_(text) {
  if (!text) return '';
  let t = text.trim();

  // Remove any accidental closers/signatures the model might include
  t = t.replace(/\n*\s*(Sincerely|Regards|Best regards|Respectfully)[\s,]*\n[\s\S]*$/i, '');

  // Normalize excessive blank lines
  t = t.replace(/\n{3,}/g, '\n\n');

  return t.trim();
}

function appendPlain_(body, text) {
  body.appendParagraph(String(text || '')).setFontFamily('Arial').setFontSize(11);
}
