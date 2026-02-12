/************************************************************
 * Resume Assembler (no writes below row 12)
 * - Anchors by labels in column A; reads B..AW (ignores blanks/headers)
 * - Tailors Summary for DOC ONLY (grounded, no hallucinations)
 * - Does NOT write Summary into the sheet (no writes below row 12)
 * - KSAs in header / Acronyms in footer (font size = 1, white, not bold)
 * - Doc URL -> B7; status/debug -> Z2/Z3 (all <= row 12)
 * - Relevance lines are AI-generated per job block (no hardcoded templates)
 ************************************************************/

/* ---------------- Settings ---------------- */
const SHEET_NAME       = 'Generator';
const MAX_COL_LETTERS  = 'AW';      // read B..AW inclusive

// Only these cells are ever written (all above row 12)
const OUT_DOC_URL_CELL = 'B7';
const CELL_STATUS      = 'Z2';
const CELL_DEBUG       = 'Z3';

// Do NOT write tailored summary back to the sheet (hard-rule)
const WRITE_SUMMARY_BACK = false;

const BODY_FONT_FAMILY = 'Arial';
const BODY_FONT_SIZE   = 11;

const RELEVANCE_PREFIX     = 'Relevance:';
const MAX_RELEVANCE_WORDS  = 20;

// Section toggles (set true to include in resume output)
const INCLUDE_PROJECTS     = false;
const INCLUDE_LANGUAGES    = false;
const INCLUDE_PUBLICATIONS = false;
const INCLUDE_VOLUNTEERING = false;

// Enforce AI rewrite for summary (blank if API key missing)
const REQUIRE_AI_SUMMARY = true;

// DeepSeek API Configuration
const DS_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';
const DS_MODEL = 'deepseek-chat';
const DS_TEMPERATURE = 0.3;

/* Header tokens to ignore when scanning data rows */
const HEADER_TOKENS = new Set([
  'city','state','phone','email','linkedin','website',
  'employer','title','location','start','end','description',
  'institution','credential/degree','credential/deg? dates','credential/deg?','dates','notes',
  'publication title/year','year','award / issuer','project / role',
  'organization / role','language (english is none else)','language','level',
  'reference name','title/relationship','company','email/phone'
].map(s => s.replace(/\s+/g,' ').toLowerCase()));

/* Column-A label regexes */
const LABEL_RX = {
  CONTACT:      /^contact/i,
  SUMMARY:      /^summary/i,
  SKILLS:       /^skills/i,
  EMPLOYMENT:   /^(employment|experience|work experience)/i,
  EDUCATION:    /^education/i,
  PUBLICATIONS: /^publication/i,
  AWARDS:       /^awards?/i,
  PROJECTS:     /^projects?/i,
  VOLUNTEER:    /^volunte/i,
  LANGUAGES:    /^language/i,
  REFERENCES:   /^references/i
};

/* =========================================================
 * Entry
 * =======================================================*/
function Generate_Resume_Doc_From_Segments() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  setStatus_(sh, 'Running…');

  // Inputs / metadata (all reads)
  // Cell references verified against sheet layout:
  // B2: Job Description, B3: Title, B4: Company, B5: KSAs, B6: Acronyms, B9: Full Name
  const jobDesc = val_(sh, 'B2');
  const title   = val_(sh, 'B3');
  const company = val_(sh, 'B4');
  const ksas    = val_(sh, 'B5');
  const acr     = val_(sh, 'B6');
  const fullName= val_(sh, 'B9') || 'Candidate';

  // Debug: Log what was read from cells
  const debugInfo = [
    `Title: "${title}" (len: ${title.length})`,
    `Company: "${company}" (len: ${company.length})`,
    `JobDesc: ${jobDesc.length} chars (preview: ${jobDesc.substring(0, 50)}...)`,
    `KSAs: ${ksas.length} chars (preview: ${ksas.substring(0, 50)}...)`,
    `Acronyms: "${acr}" (len: ${acr.length})`
  ].join(' | ');
  safeWriteA1_(sh, CELL_DEBUG, debugInfo, 12);

  // Locate label rows by column A
  const rows = findAllLabelRows_(sh);

  // ---- Contact ----
  const contact = rows.CONTACT ? readContact_(sh, rows.CONTACT) : {};

  // ---- Summary (tailored for DOC ONLY; do NOT write back to sheet) ----
  const summarySeed = rows.SUMMARY ? readLongRow_(sh, candidateRows_(rows.SUMMARY)) : '';
  const resumeSeed  = buildResumeCorpusSeed_(sh, rows, ksas, acr); // grounding only
  
  // Debug: Log summary seed info
  const summaryDebug = `SummarySeed: ${summarySeed.length} chars (preview: ${summarySeed.substring(0, 80)}...) | ResumeSeed: ${resumeSeed.length} chars`;
  safeWriteA1_(sh, CELL_DEBUG, debugInfo + ' || ' + summaryDebug, 12);
  
  const summaryText = buildSummary_(sh, summarySeed, jobDesc, resumeSeed, ksas, acr, title, company);

  // ---- Skills ----
  const rawSkills = rows.SKILLS
    ? readLongRow_(sh, candidateRows_(rows.SKILLS))
    : '';

  const skills = softTailorSkills_(rawSkills, jobDesc, ksas, acr);

  // ---- Extract and Match KSAs from Original Job Descriptions ----
  let matchedKsas = [];
  const apiKey = getDeepseekKey_();
  
  if (jobDesc && apiKey) {
    try {
      // Extract original job descriptions from row 25
      const originalDescriptions = extractOriginalJobDescriptions_(sh);
      
      if (originalDescriptions && originalDescriptions.trim()) {
        // Extract KSA terminologies
        const ksaTerms = extractKsaTerminologies_(originalDescriptions);
        
        if (ksaTerms && ksaTerms.length) {
          // Match KSAs to new job description
          matchedKsas = matchKsasToJobDescription_(ksaTerms, jobDesc, ksas, apiKey);
          
          // Log matched KSAs to debug cell
          if (matchedKsas.length) {
            const ksaDebug = matchedKsas.slice(0, 5).map(m => 
              `${m.ksa} (${m.matchType}, ${Math.round(m.confidence * 100)}%)`
            ).join(', ');
            const currentDebug = val_(sh, CELL_DEBUG);
            safeWriteA1_(sh, CELL_DEBUG, (currentDebug ? currentDebug + ' | ' : '') + 'Matched KSAs: ' + ksaDebug, 12);
          }
        }
      }
    } catch (error) {
      // Log error but don't fail the entire process
      const currentDebug = val_(sh, CELL_DEBUG);
      safeWriteA1_(sh, CELL_DEBUG, (currentDebug ? currentDebug + ' | ' : '') + 'KSA matching error: ' + String(error).substring(0, 100), 12);
    }
  }

  // ---- Experience (repeating groups of 6) ----
  const expRow  = rows.EMPLOYMENT ? firstUsableDataRow_(sh, rows.EMPLOYMENT, 6) : 0;
  const expText = expRow ? readExperienceRow_(sh, expRow, matchedKsas, jobDesc) : '';
  const expWithRel = addRelevanceToExperience_(expText, jobDesc, ksas, acr); // AI here

  // ---- Education (groups of 4) ----
  const eduRow    = rows.EDUCATION ? firstUsableDataRow_(sh, rows.EDUCATION, 4) : 0;
  const educItems = eduRow ? readEducationRow_(sh, eduRow) : [];

  // ---- Pubs / Awards / Projects / Volunteer / Languages ----
  const pubs  = rows.PUBLICATIONS ? readTriplesRow_(sh, firstUsableDataRow_(sh, rows.PUBLICATIONS, 3)) : [];
  const awds  = rows.AWARDS      ? readTriplesRow_(sh, firstUsableDataRow_(sh, rows.AWARDS, 3))       : [];
  const projs = rows.PROJECTS   ? readTriplesRow_(sh, firstUsableDataRow_(sh, rows.PROJECTS, 3))     : [];
  const vols  = rows.VOLUNTEER  ? readQuadsRow_(  sh, firstUsableDataRow_(sh, rows.VOLUNTEER, 4))    : [];
  const langs = rows.LANGUAGES  ? readTriplesRow_(sh, firstUsableDataRow_(sh, rows.LANGUAGES, 3))    : [];

  // ---- References (default unless actual values present) ----
  const refRow  = rows.REFERENCES || 39; // sheet layout fallback
  const refsOut = referencesOutput_(sh, refRow);

  // ---- Create/update Doc ----
  const docName = safeName_(`${title || 'Position'}_${company || 'Company'}_${fullName}`);
  const doc = getOrCreateDoc_(val_(sh, OUT_DOC_URL_CELL), docName);
  const body = doc.getBody();
  body.clear();

  const addP = (text) => body.appendParagraph(String(text || '')).setFontFamily(BODY_FONT_FAMILY).setFontSize(BODY_FONT_SIZE);

  // Name (not bold)
  addP(fullName).setAlignment(DocumentApp.TextAlignment.CENTER);

  // Contact
  contactToLines_(contact).forEach(l => addP(l));
  addP(''); // spacer

  // Summary (Doc only) — display as one flowing paragraph
  if (String(summaryText).trim()) {
    addP('Summary');
    // Display as a single flowing paragraph with natural word wrapping
    // Replace newlines with spaces to create a flowing paragraph
    const flowingSummary = String(summaryText).replace(/\r?\n/g, ' ').trim();
    body.appendParagraph(flowingSummary)
      .setFontFamily(BODY_FONT_FAMILY)
      .setFontSize(BODY_FONT_SIZE);
    addP('');
  }

  // Skills
  if (String(skills).trim()) {
    addP('Skills');
    splitLines_(skills).forEach(l => addP(l));
    addP('');
  }

  // Experience
  if (String(expWithRel).trim()) {
    addP('Experience');
    expWithRel.split('\n').forEach(l => addP(l));
    addP('');
  }

  // Education
  if (educItems.length) {
    addP('Education');
    educItems.forEach(e => {
      // Filter out Master's and Associate's degrees
      const credLower = String(e.credential || '').toLowerCase();
      if (credLower.includes('master') || credLower.includes('associate')) {
        return; // Skip this education entry
      }
      const head = [e.institution, e.credential].filter(Boolean).join(' – ');
      if (head) addP(head);
      const sub = [e.location, e.dates].filter(Boolean).join(' | ');
      if (sub) addP(sub);
      if (e.notes) addP(e.notes);
      addP('');
    });
  }

  // Publications (disabled unless INCLUDE_PUBLICATIONS is true)
  if (INCLUDE_PUBLICATIONS && pubs.length) {
    addP('Publications');
    pubs.forEach(p => { p.filter(Boolean).forEach(line => addP(line)); addP(''); });
  }

  // Awards
  if (awds.length) {
    addP('Awards');
    awds.forEach(a => { a.filter(Boolean).forEach(line => addP(line)); addP(''); });
  }

  // Projects (disabled unless INCLUDE_PROJECTS is true)
  if (INCLUDE_PROJECTS && projs.length) {
    addP('Projects');
    projs.forEach(p => { p.filter(Boolean).forEach(line => addP(line)); addP(''); });
  }

  // Volunteering (disabled unless INCLUDE_VOLUNTEERING is true)
  if (INCLUDE_VOLUNTEERING && vols.length) {
    addP('Volunteering');
    vols.forEach(v => { v.filter(Boolean).forEach(line => addP(line)); addP(''); });
  }

  // Languages (disabled unless INCLUDE_LANGUAGES is true)
  if (INCLUDE_LANGUAGES && langs.length) {
    addP('Languages');
    langs.forEach(l => { l.filter(Boolean).forEach(line => addP(line)); });
    addP('');
  }

  // References
  addP(refsOut);

  // ---- Writes (all <= row 12) ----
  safeWriteA1_(sh, OUT_DOC_URL_CELL, 'https://docs.google.com/document/d/' + doc.getId() + '/edit', /*maxRow*/12);
  const overlaps = topOverlaps_(resumeSeed, jobDesc, 12);
  // Preserve debug info - append overlaps instead of overwriting
  const currentDebug = val_(sh, CELL_DEBUG);
  if (overlaps.length) {
    safeWriteA1_(sh, CELL_DEBUG, (currentDebug ? currentDebug + ' | ' : '') + 'Overlaps: ' + overlaps.join(', '), 12);
  }
  setStatus_(sh, 'OK');
}

/* =========================================================
 * Safe write helper (never writes below a max row)
 * =======================================================*/
function safeWriteA1_(sh, a1, value, maxRow) {
  const row = a1ToRow_(a1);
  if (row <= maxRow) sh.getRange(a1).setValue(value);
}
function a1ToRow_(a1) {
  const m = String(a1).match(/\d+$/);
  return m ? parseInt(m[0], 10) : 99999;
}

function softTailorSkills_(skillsText, jobDesc, ksas, acr) {
  if (!skillsText.trim()) return '';

  // Split into individual skills
  const skills = skillsText
    .split(/\r?\n|,/)
    .map(s => s.trim())
    .filter(Boolean);

  // If no JD, just take the first 6 as-written
  if (!jobDesc.trim()) {
    return skills.slice(0, 6).join(', ');
  }

  const context = (jobDesc + ' ' + (ksas || '') + ' ' + (acr || '')).toLowerCase();

  // Score skills by relevance (soft, not exclusive)
  const scored = skills.map((skill, index) => {
    const tokens = skill.toLowerCase().split(/\W+/).filter(t => t.length > 2);
    let score = 0;
    for (const t of tokens) {
      if (context.includes(t)) score++;
    }
    return { skill, score, index };
  });

  // Sort by relevance first, preserve original order within same score
  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  // Take top 6 only, comma-separated
  return scored.slice(0, 6).map(x => x.skill).join(', ');
}


/* =========================================================
 * Readers & robust row handling
 * =======================================================*/

function candidateRows_(labelRow) { return [labelRow, labelRow + 1, labelRow + 2]; }

function firstUsableDataRow_(sh, labelRow) {
  const tries = [labelRow + 1, labelRow + 2, labelRow];
  for (const r of tries) {
    const arr = rowVals_(sh, r);
    if (!looksLikeHeaderRow_(arr)) return r;
  }
  return labelRow + 1;
}

function looksLikeHeaderRow_(arr) {
  const vals = arr.map(x => String(x||'').trim()).filter(Boolean);
  if (!vals.length) return false;
  let hdr = 0;
  for (const v of vals) if (HEADER_TOKENS.has(v.toLowerCase())) hdr++;
  return hdr >= Math.max(3, Math.ceil(vals.length * 0.6));
}

function filterHeaderTokens_(cells) {
  return cells
    .map(s => String(s||'').trim())
    .filter(s => s && !HEADER_TOKENS.has(s.toLowerCase()));
}

function readContact_(sh, labelRow) {
  for (const r of candidateRows_(labelRow)) {
    const v = rowVals_(sh, r).map(x => String(x||'').trim());
    const lower = v.map(x => x.toLowerCase());
    const headerish = ['city','state','phone','email'];
    const headerHits = headerish.reduce((k, key) => k + (lower.includes(key) ? 1 : 0), 0);
    const allBlank = v.every(x => !x);
    if (!allBlank && headerHits < 3) {
      return {
        city:     v[0] || '',
        state:    v[1] || '',
        phone:    v[2] || '',
        email:    v[3] || '',
        linkedin: v[4] || '',
        website:  v[5] || ''
      };
    }
  }
  return { city:'', state:'', phone:'', email:'', linkedin:'', website:'' };
}

function readLongRow_(sh, candRows) {
  for (const r of candRows) {
    const vals = filterHeaderTokens_(rowVals_(sh, r));
    if (vals.length) return vals.join('\n').trim();
  }
  return '';
}

function readExperienceRow_(sh, dataRow, matchedKsas, jobDesc) {
  const groups = groupRow_(sh, dataRow, 6);
  const out = [];

  for (const g of groups) {
    const cells = g.map(x => String(x || '').trim());
    if (looksLikeHeaderRow_(cells)) continue;

    const [employer, title, location, start, end, desc] = cells;
    if (!(employer || title || location || start || end || desc)) continue;

    // Job header
    out.push([employer, title].filter(Boolean).join(' – '));
    out.push([location, dateRange_(start, end)].filter(Boolean).join(' | '));

    // Description → exactly 3 bullets (condense/pad as needed)
    if (desc) {
      // Generate bullets first (existing logic untouched)
      let bullets = condenseToBullets_(desc, 3);
      
      // THEN enhance with matched KSAs if available
      if (matchedKsas && matchedKsas.length && jobDesc) {
        bullets = enhanceBulletsWithKsas_(bullets, matchedKsas, jobDesc);
      }
      
      bullets.forEach(b => out.push('• ' + b));
    }

    out.push('');
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function readEducationRow_(sh, dataRow) {
  const groups = groupRow_(sh, dataRow, 4);
  const out = [];
  for (const g of groups) {
    const cells = g.map(x => String(x||'').trim());
    if (looksLikeHeaderRow_(cells)) continue;
    const [inst, cred, dates, notes] = cells;
    if (!(inst||cred||dates||notes)) continue;
    out.push({ institution: inst, credential: cred, dates, notes, location: '' });
  }
  return out;
}

function readTriplesRow_(sh, dataRow) {
  const groups = groupRow_(sh, dataRow, 3);
  const out = [];
  for (const g of groups) {
    const cells = g.map(x => String(x||'').trim());
    if (looksLikeHeaderRow_(cells)) continue;
    if (cells.join('').trim() === '') continue;
    out.push(cells);
  }
  return out;
}

function readQuadsRow_(sh, dataRow) {
  const groups = groupRow_(sh, dataRow, 4);
  const out = [];
  for (const g of groups) {
    const cells = g.map(x => String(x||'').trim());
    if (looksLikeHeaderRow_(cells)) continue;
    if (cells.join('').trim() === '') continue;
    out.push(cells);
  }
  return out;
}

function condenseToBullets_(text, maxBullets) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  // Split into sentences, or fallback to clause splits if needed
  let sentences = clean
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  if (sentences.length < maxBullets) {
    const parts = clean.split(/[•;]\s*/).map(s => s.trim()).filter(Boolean);
    if (parts.length > sentences.length) sentences = parts;
  }

  // Rank by information density
  const scored = sentences.map((s, i) => {
    const words = s.split(/\s+/).length;
    return { s, score: words, i };
  }).sort((a, b) => b.score - a.score || a.i - b.i);

  // Pick up to maxBullets, then restore original order
  const picked = scored
    .slice(0, maxBullets)
    .sort((a, b) => a.i - b.i)
    .map(x => ensureEndsWithPeriod_(x.s));

  // If fewer than maxBullets, split the longest sentence(s) to reach exactly maxBullets
  while (picked.length < maxBullets) {
    const idx = picked.findIndex(s => s.split(/\s+/).length >= 12);
    if (idx === -1) break;
    const words = picked[idx].replace(/[.!?]$/, '').split(/\s+/);
    const mid = Math.floor(words.length / 2);
    const a = ensureEndsWithPeriod_(words.slice(0, mid).join(' '));
    const b = ensureEndsWithPeriod_(words.slice(mid).join(' '));
    picked.splice(idx, 1, a, b);
  }

  // If still short, pad with trimmed fragments
  while (picked.length < maxBullets) {
    picked.push('Additional relevant responsibilities and results aligned to the role.');
  }

  return picked.slice(0, maxBullets);
}

/* =========================================================
 * Summary (grounded; Doc only)
 * =======================================================*/
function buildSummary_(sh, existingSummary, jobDesc, resumeSeed, ksas, acr, title, company) {
  const apiKey = getDeepseekKey_();
  const baseSummary = String(existingSummary || '').trim();
  if (!baseSummary) {
    // Ensure there's always material to rewrite
    existingSummary = groundedOverlapSummary_(resumeSeed, jobDesc, ksas, acr);
  }
  if (!apiKey) {
    if (REQUIRE_AI_SUMMARY) {
      setStatus_(sh, 'Missing DEEPSEEK_API_KEY: summary not generated');
      return '';
    }
    // Force a multi-line rewrite even without AI
    return forceMultiLineSummary_(existingSummary, resumeSeed, ksas, acr);
  }

  // Debug: Log what's being passed to AI
  const aiInputDebug = [
    `To AI - Title: "${title}"`,
    `Company: "${company}"`,
    `JobDesc: ${jobDesc.length} chars`,
    `KSAs: ${ksas.length} chars`,
    `ExistingSummary: ${baseSummary.length} chars (preview: ${baseSummary.substring(0, 60)}...)`,
    `ResumeSeed: ${resumeSeed.length} chars`
  ].join(' | ');
  safeWriteA1_(sh, CELL_DEBUG, aiInputDebug, 12);

  try {
    let debugMsg = aiInputDebug;
    let txt = '';
    try {
      txt = aiSummaryRewrite_(existingSummary, jobDesc, resumeSeed, ksas, acr, title, company, apiKey, 0);
    } catch (aiError) {
      debugMsg += ' || AI CALL ERROR (mode 0): ' + String(aiError).substring(0, 200);
      safeWriteA1_(sh, CELL_DEBUG, debugMsg, 12);
      txt = '';
    }
    const fullResponse = txt ? txt.substring(0, 500) : 'EMPTY';
    debugMsg += ' || AI raw (mode 0): ' + fullResponse;
    safeWriteA1_(sh, CELL_DEBUG, debugMsg, 12);
    let cleaned = sanitizeSummary_(txt, resumeSeed, jobDesc, ksas, acr, existingSummary);
    debugMsg += ' || After sanitize (mode 0): ' + (cleaned ? cleaned.length + ' chars' : 'EMPTY');
    safeWriteA1_(sh, CELL_DEBUG, debugMsg, 12);

    // Only retry if AI returned nothing or was completely filtered out
    // Don't retry based on similarity - always use AI output if it exists
    if (!cleaned || !cleaned.trim()) {
      try {
        txt = aiSummaryRewrite_(existingSummary, jobDesc, resumeSeed, ksas, acr, title, company, apiKey, 1);
      } catch (aiError) {
        debugMsg += ' || AI CALL ERROR (mode 1): ' + String(aiError).substring(0, 200);
        safeWriteA1_(sh, CELL_DEBUG, debugMsg, 12);
        txt = '';
      }
      debugMsg += ' || AI raw (mode 1): ' + (txt ? txt.substring(0, 500) : 'EMPTY');
      safeWriteA1_(sh, CELL_DEBUG, debugMsg, 12);
      cleaned = sanitizeSummary_(txt, resumeSeed, jobDesc, ksas, acr, existingSummary);
      debugMsg += ' || After sanitize (mode 1): ' + (cleaned ? cleaned.length + ' chars' : 'EMPTY');
      safeWriteA1_(sh, CELL_DEBUG, debugMsg, 12);
    }
    if (!cleaned || !cleaned.trim()) {
      try {
        txt = aiSummaryRewrite_(existingSummary, jobDesc, resumeSeed, ksas, acr, title, company, apiKey, 2);
      } catch (aiError) {
        debugMsg += ' || AI CALL ERROR (mode 2): ' + String(aiError).substring(0, 200);
        safeWriteA1_(sh, CELL_DEBUG, debugMsg, 12);
        txt = '';
      }
      debugMsg += ' || AI raw (mode 2): ' + (txt ? txt.substring(0, 500) : 'EMPTY');
      safeWriteA1_(sh, CELL_DEBUG, debugMsg, 12);
      cleaned = sanitizeSummary_(txt, resumeSeed, jobDesc, ksas, acr, existingSummary);
      debugMsg += ' || After sanitize (mode 2): ' + (cleaned ? cleaned.length + ' chars' : 'EMPTY');
      safeWriteA1_(sh, CELL_DEBUG, debugMsg, 12);
    }
    if (!cleaned || !cleaned.trim()) {
      try {
        txt = aiSummaryRewrite_(existingSummary, jobDesc, resumeSeed, ksas, acr, title, company, apiKey, 3);
      } catch (aiError) {
        debugMsg += ' || AI CALL ERROR (mode 3): ' + String(aiError).substring(0, 200);
        safeWriteA1_(sh, CELL_DEBUG, debugMsg, 12);
        txt = '';
      }
      debugMsg += ' || AI raw (mode 3): ' + (txt ? txt.substring(0, 500) : 'EMPTY');
      safeWriteA1_(sh, CELL_DEBUG, debugMsg, 12);
      cleaned = sanitizeSummary_(txt, resumeSeed, jobDesc, ksas, acr, existingSummary);
      debugMsg += ' || After sanitize (mode 3): ' + (cleaned ? cleaned.length + ' chars' : 'EMPTY');
      safeWriteA1_(sh, CELL_DEBUG, debugMsg, 12);
    }

    // Always use AI output if it exists, regardless of similarity
    // Only fall back to original if AI truly returned nothing
    const finalSummary = cleaned && cleaned.trim() ? cleaned : existingSummary;
    const simRatio = finalSummary === cleaned && cleaned ? getSimilarityRatio_(cleaned, existingSummary) : 0;
    debugMsg += ' || Final: ' + (finalSummary === cleaned ? 'AI' : 'ORIGINAL') + ' (similarity: ' + Math.round(simRatio * 100) + '%)';
    safeWriteA1_(sh, CELL_DEBUG, debugMsg, 12);
    return forceMultiLineSummary_(finalSummary, resumeSeed, ksas, acr);
  } catch (e) {
    const errorMsg = aiInputDebug + ' || OUTER TRY-CATCH ERROR: ' + String(e).substring(0, 200);
    safeWriteA1_(sh, CELL_DEBUG, errorMsg, 12);
    return forceMultiLineSummary_(existingSummary, resumeSeed, ksas, acr);
  }
}

function deterministicSummary_(seed, ksas, acr) {
  const lines = [];
  if (/\$7[04]b\+|70b\+|74b\+/i.test(seed)) {
    lines.push('Program/Business Analyst with oversight of $70B–$74B+ assets and large budgets.');
  } else {
    lines.push('Program/Business Analyst experienced in defense acquisition and financial operations.');
  }
  if (/presidential drawdown|foreign military sales|fms/i.test(seed))
    lines.push('Supported Presidential Drawdown and FMS with cross-functional coordination.');
  if (/python|sql|power\s*bi|excel/i.test(seed))
    lines.push('Data analysis with Excel/SQL/Python/Power BI to drive reporting and decisions.');
  if (/requirements|brd|frs|process|stakeholder/i.test(seed))
    lines.push('Requirements (BRDs/FRS), process improvement, and stakeholder engagement.');
  if (/dod|compliance|dts|tmt/i.test(seed))
    lines.push('DoD environment experience with compliance, DTS, and TMT.');
  return lines.slice(0,6).join('\n');
}

function groundedOverlapSummary_(seed, jd, ksas, acr) {
  const overlaps = topOverlaps_((seed + ' ' + (ksas||'') + ' ' + (acr||'')), jd, 6);
  const lines = [];
  if (overlaps.includes('program') || overlaps.includes('analysis'))
    lines.push('Program/Business Analyst aligning analysis with portfolio and budget objectives.');
  if (overlaps.includes('financial') || overlaps.includes('budget'))
    lines.push('Financial planning, budget oversight, and cost analysis for decisions.');
  if (overlaps.includes('requirements') || overlaps.includes('stakeholder'))
    lines.push('Requirements gathering and stakeholder coordination for delivery and governance.');
  if (overlaps.includes('data') || overlaps.includes('sql') || overlaps.includes('power') || overlaps.includes('excel'))
    lines.push('Data analysis with SQL/Power BI/Excel for accurate, actionable reporting.');
  if (overlaps.includes('dod') || overlaps.includes('compliance'))
    lines.push('Experience in DoD environments with compliance and process rigor.');
  if (!lines.length) lines.push('Analyst with directly relevant skills and experience for the role.');
  return lines.slice(0,6).join('\n');
}

function sanitizeSummary_(txt, seed, jobDesc, ksas, acr, existingSummary) {
  let lines = String(txt||'').split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0,8);
  if (!lines.length) return ''; // AI returned nothing
  
  // Only filter out obvious PII and links - trust the AI for everything else
  const bad = [/@/i, /https?:\/\//i, /linkedin\.com/i, /\bphone\b/i, /\bmorgan\b/i, /\btemple hills\b/i];
  lines = lines.filter(l => !bad.some(rx => rx.test(l)));
  
  // Don't filter out list-like lines - the AI might write in that style
  // lines = lines.filter(l => !isListLikeLine_(l));
  
  if (!lines.length) return ''; // All lines filtered out as bad (PII/links only)
  
  // TRUST THE AI: If it passed PII/link filters, use it
  // The AI was explicitly instructed to write about the job position
  // Don't reject based on overlap - the whole point is to rewrite for a different job
  return lines.join('\n');
}

function forceMultiLineSummary_(text, seed, ksas, acr) {
  const lines = summaryToLines_(text);
  if (lines.length >= 2) return lines.join('\n');
  // Expand with grounded overlap lines to ensure 2+ lines
  const fallback = groundedOverlapSummary_(seed, '', ksas, acr);
  const extra = summaryToLines_(fallback);
  const merged = lines.concat(extra).filter(Boolean);
  return merged.slice(0, 6).join('\n');
}

/* =========================================================
 * Relevance lines — AI generated (no hardcoded templates)
 * =======================================================*/

function addRelevanceToExperience_(expText, jd, ksas, acr) {
  if (!expText.trim()) return '';
  // Remove relevance lines - just return the experience blocks as-is
  const blocks = expText.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const out = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // Remove any accidental relevance lines already in the block
    const cleaned = block
      .split('\n')
      .filter(l => !/^relevance\s*:/i.test(l.trim()))
      .join('\n')
      .trim();

    if (cleaned) {
      out.push(cleaned);
      out.push('');
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Calls DeepSeek to produce a single grounded, unique relevance sentence.
 */
function aiRelevanceLine_(block, context, ksaPick, ksaList, apiKey, idx) {
  const prompt = `
You are writing ONE short sentence labeled "Relevance:" for a resume.
Goal: Explain why THIS specific job block is relevant to the provided job description.
Constraints:
- 1 sentence only (concise, 12–28 words).
- Must be grounded in the job block + JD + KSAs/Acronyms context.
- No PII, names, links, phone numbers, or email.
- No bullets, no colons except the initial "Relevance:" label will be added outside this sentence.
- Avoid generic fluff; mention the most concrete, role-relevant capability or result present in the block.
- Make it distinct from other blocks; if multiple angles exist, pick the most unique here.
- If a KSA from the list is supported by the block, explicitly reference 1–2 KSAs by name.

JOB DESCRIPTION + KSAS/ACRONYMS CONTEXT:
${context}

KSA LIST (reference these by name if relevant):
${(ksaList || []).join(', ')}

PREFERRED KSA TO REFERENCE (if applicable):
${ksaPick || '(none)'}

THIS JOB BLOCK:
${block}

Return ONLY the sentence WITHOUT any leading label, quotes, or extra lines.`.trim();

  const payload = {
    model: DS_MODEL,
    temperature: 0.3,
    messages: [
      { role: "system", content: "You produce concise, grounded, non-repetitive resume relevance sentences." },
      { role: "user", content: prompt }
    ]
  };
  const txt = dsCall_(payload, apiKey);
  return String(txt || '').trim();
}

/**
 * Fallback when API not available: generate a simple grounded sentence from overlaps (no hardcoded library).
 */
function fallbackRelevance_(block, jd, ksas, acr, ksaPick) {
  const phrase = pickBestOverlapPhrase_(block, (jd + ' ' + (ksas||'') + ' ' + (acr||'')), 12);
  if (phrase) {
    return ensureEndsWithPeriod_(`Demonstrates directly relevant experience in ${phrase}, aligned with the position's requirements`);
  }
  return ensureEndsWithPeriod_('Demonstrates directly transferable experience aligned with the position\'s requirements');
}

/**
 * Enforce formatting, dedupe, and length constraints for relevance sentences.
 */
function postProcessRel_(s, usedSet, block, jd, ksas, acr, ksaPick) {
  let sentence = String(s||'').replace(/\s+/g,' ').trim();

  // Strip quotes/labels
  sentence = sentence.replace(/^relevance\s*:\s*/i, '');
  sentence = sentence.replace(/^[-–•\u2022]+\s*/, '');

  // Strip markdown formatting: **bold**, *italic*, __bold__, _italic_
  sentence = sentence.replace(/\*\*([^*]+)\*\*/g, '$1'); // **bold**
  sentence = sentence.replace(/\*([^*]+)\*/g, '$1');     // *italic* (but not **)
  sentence = sentence.replace(/__([^_]+)__/g, '$1');     // __bold__
  sentence = sentence.replace(/_([^_]+)_/g, '$1');       // _italic_ (but not __)
  sentence = sentence.replace(/~~([^~]+)~~/g, '$1');    // ~~strikethrough~~
  sentence = sentence.replace(/`([^`]+)`/g, '$1');      // `code`

  // Remove PII / links if any slipped through
  if (/@|https?:\/\//i.test(sentence)) sentence = fallbackRelevance_(block, jd, ksas, acr);

  // Ensure sentence casing & punctuation
  sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  sentence = ensureEndsWithPeriod_(sentence);

  // Keep it concise
  if (sentence.split(/\s+/).length > 30) {
    const words = sentence.split(/\s+/).slice(0, 28).join(' ');
    sentence = ensureEndsWithPeriod_(words);
  }

  // De-duplicate across blocks
  let attempt = 0;
  while (usedSet.has(sentence) && attempt < 2) {
    // Minimal perturbation: append a specific anchor from this block to make it unique
    const anchor = (pickBestOverlapPhrase_(block, jd + ' ' + ksas + ' ' + acr, 6) || '').trim();
    if (anchor) {
      sentence = ensureEndsWithPeriod_(sentence.replace(/\.$/, '') + ` (notably ${anchor})`);
    } else {
      sentence = ensureEndsWithPeriod_(sentence.replace(/\.$/, '') + ' (distinct focus)');
    }
    attempt++;
  }
  usedSet.add(sentence);
  return sentence;
}

function extractKsaList_(ksas) {
  return String(ksas || '')
    .split(/[,;\n]/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 30);
}

function pickRelevantKsa_(block, ksaList, usedKsa) {
  if (!ksaList.length) return '';
  let best = '';
  let bestScore = 0;
  for (const ksa of ksaList) {
    const score = scoreKsaOverlap_(block, ksa);
    if (score > bestScore && !usedKsa.has(ksa)) {
      best = ksa;
      bestScore = score;
    }
  }
  if (!best) {
    // Allow reuse if nothing else fits
    for (const ksa of ksaList) {
      const score = scoreKsaOverlap_(block, ksa);
      if (score > bestScore) {
        best = ksa;
        bestScore = score;
      }
    }
  }
  if (best) usedKsa.add(best);
  return best;
}

function scoreKsaOverlap_(block, ksa) {
  const text = String(block || '').toLowerCase();
  const tokens = String(ksa || '').toLowerCase().split(/\W+/).filter(t => t.length > 2);
  let score = 0;
  for (const t of tokens) if (text.indexOf(t) !== -1) score++;
  return score;
}

function isListLikeLine_(line) {
  const s = String(line || '');
  const commaCount = (s.match(/,/g) || []).length;
  if (commaCount >= 4) return true;
  if (/^[A-Z0-9\s-]{10,}$/.test(s) && s.split(' ').length > 6) return true;
  if (/[•\u2022]/.test(s)) return true;
  return false;
}

/* =========================================================
 * References handling
 * =======================================================*/
function referencesOutput_(sh, row) {
  const cells = rowVals_(sh, row).map(x => String(x||'').trim());
  const filtered = cells.filter(x => x && !HEADER_TOKENS.has(x.toLowerCase()));
  if (!filtered.length) return 'References available upon request';
  return filtered.join('\n');
}

function ensureEndsWithPeriod_(s) {
  let str = String(s || '').trim();
  if (!str) return '';
  return /[.!?]$/.test(str) ? str : str + '.';
}

/* =========================================================
 * Lookup, grouping, utilities
 * =======================================================*/
function val_(sh, a1){ return String(sh.getRange(a1).getValue()||'').trim(); }

function findAllLabelRows_(sh) {
  const out = {};
  const lastRow = Math.min(200, sh.getLastRow() || 200);
  const colA = sh.getRange(1,1,lastRow,1).getDisplayValues().map(r => String(r[0]||'').trim());
  for (let i=0; i<colA.length; i++) {
    const label = colA[i];
    for (const key of Object.keys(LABEL_RX)) {
      if (!out[key] && LABEL_RX[key].test(label)) out[key] = i+1;
    }
  }
  return out;
}

function rowVals_(sh, row){
  const width = colIndex_(MAX_COL_LETTERS) - 2 + 1; // B..MAX inclusive
  return sh.getRange(row, 2, 1, width).getDisplayValues()[0];
}

function groupRow_(sh, row, size){
  const a = rowVals_(sh, row);
  const out = [];
  for (let i=0;i<a.length;i+=size) out.push(a.slice(i, i+size));
  return out;
}

function dateRange_(start, end){
  const s = (start||'').toString().trim();
  const e = (end||'').toString().trim();
  if (!s && !e) return '';
  return `${s || ''} – ${e || ''}`.replace(/ – $/, '');
}

function contactToLines_(c){
  const lines = [];
  const loc = [c.city, c.state].filter(Boolean).join(', ');
  if (loc) lines.push(loc);
  if (c.phone) lines.push(`Phone: ${c.phone}`);
  if (c.email) lines.push(`Email: ${c.email}`);
  if (c.website) lines.push(`Website: ${c.website}`);
  if (c.linkedin) lines.push(`LinkedIn: ${c.linkedin}`);
  return lines;
}

function splitLines_(s){ return String(s||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean); }

function summaryToLines_(s) {
  const raw = String(s || '').trim();
  if (!raw) return [];
  
  // First, split by actual newlines if they exist (preserve intentional line breaks)
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    // If already has line breaks, use them (but ensure sentences are complete)
    return lines.map(l => ensureEndsWithPeriod_(l)).slice(0, 8);
  }
  
  // Otherwise, split by sentences
  const normalized = raw.replace(/\s+/g, ' ').trim();
  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map(x => x.trim())
    .filter(Boolean)
    .map(x => ensureEndsWithPeriod_(x));
  return sentences.slice(0, 8);
}

function aiSummaryRewrite_(existingSummary, jobDesc, resumeSeed, ksas, acr, title, company, apiKey, mode) {
  // Receives: existingSummary (from sheet), jobDesc (B2), title (B3), company (B4), ksas (B5), acr (B6), resumeSeed (built from resume data)
  // Debug output is written in buildSummary_ before calling this function
  const system = `Rewrite ONLY the SUMMARY (aim for ~5–8 sentences).

CRITICAL: The existing summary is ONLY a style/voice reference. DO NOT copy its content, terminology, or subject matter.

PRIMARY GOAL: Write a CONTEXT-AWARE summary that synthesizes the APPLICANT'S ACTUAL BACKGROUND with the TARGET JOB POSITION. 

CONTEXT-AWARENESS REQUIREMENTS:
1. Analyze the applicant's actual background/field from their resume (e.g., security, analysis, administration, IT, etc.)
2. Identify the target job role/field from the job description (e.g., administrative assistant, computer technician, etc.)
3. Create a natural opening statement that bridges both - acknowledge the target role while recognizing the applicant's background
   - Example: "Administrative professional with a background in physical security" (not just "Administrative professional")
   - Example: "IT support specialist transitioning from program analysis" (if applicable)
   - Example: "Business analyst with experience in defense acquisition" (if background aligns)
4. Then explain what the applicant offers based on their ACTUAL experience from the resume seed
5. Connect their real skills/experience to the job requirements naturally

Write as a cohesive, flowing narrative paragraph. Connect sentences naturally using transitions. Be concise, professional, and strictly grounded in the provided resume seed and KSAs/Acronyms. The summary should feel authentic - it's about THIS applicant applying for THIS job, not a generic job description rewrite.

Avoid PII, links, names, or contact info. No bullets or markdown formatting.`;
  const rewriteHint =
    mode === 3
      ? 'CRITICAL: DO NOT copy original content. Match original voice/style only. Write about the job position using 3–5 specific job requirements and job description terminology throughout.'
      : mode === 2
        ? 'DO NOT copy original content. Match original voice/style only. Write about the job position using 2–4 key job requirements and job description language.'
        : mode === 1
          ? 'DO NOT copy original content. Match original voice/style only. Write about the job position using job description terminology.'
        : 'DO NOT copy original content. Match original voice/style only. Write about the job position using job terminology when supported by resume seed.';

  const payload = {
    model: DS_MODEL,
    temperature: mode === 3
      ? 0.95
      : mode === 2
        ? 0.9
        : mode === 1
          ? Math.min(0.7, (DS_TEMPERATURE || 0.3) + 0.2)
          : Math.max(0.5, DS_TEMPERATURE || 0.3), // Increased from 0.3 to 0.5 for mode 0 to encourage variation
    messages: [
      { role: "system", content: system },
      { role: "user", content:
`*** CRITICAL: DO NOT COPY THE ORIGINAL SUMMARY'S CONTENT. Create a CONTEXT-AWARE summary that bridges the APPLICANT'S BACKGROUND with the TARGET JOB. ***

TARGET JOB POSITION:
Title: ${title || '(unknown)'} | Company: ${company || '(unknown)'}

JOB DESCRIPTION (Requirements and responsibilities):
${jobDesc}

APPLICANT'S ACTUAL BACKGROUND (from their resume - use this to understand their field/experience):
${resumeSeed}

KSAs (skills/knowledge from applicant's background - use when factual):
${ksas || '(none)'}

ACRONYMS (expand if used):
${acr || '(none)'}

ORIGINAL SUMMARY (ONLY use this for VOICE/STYLE - DO NOT copy its content):
${existingSummary}

CONTEXT-AWARE SUMMARY REQUIREMENTS:

1. ANALYZE THE APPLICANT'S BACKGROUND:
   - What field/domain does their resume show? (e.g., security, program analysis, administration, IT support, business analysis, etc.)
   - What are their key experiences, skills, or specializations?
   - What is their actual professional identity based on their work history?

2. IDENTIFY THE TARGET JOB:
   - What is the job role/field? (e.g., administrative assistant, computer technician, business analyst, etc.)
   - What are the key requirements?

3. CREATE A BRIDGE STATEMENT (Opening sentence):
   - Acknowledge the TARGET ROLE while recognizing the APPLICANT'S BACKGROUND
   - Examples:
     * If applying for admin role with security background: "Administrative professional with a background in physical security..."
     * If applying for IT role with analysis background: "IT support specialist with experience in program analysis and data management..."
     * If applying for analyst role with admin background: "Business analyst transitioning from administrative and program support roles..."
   - DO NOT just say "Administrative professional" - add the background context
   - DO NOT just say "Aspiring [role]" - state it confidently with background

4. EXPLAIN WHAT THEY OFFER:
   - Based on their ACTUAL experience from the resume seed
   - Connect their real skills to the job requirements
   - Use job description terminology but ground it in their actual background
   - Show how their experience translates to the new role

5. MAINTAIN AUTHENTICITY:
   - This is about THIS specific applicant with THIS background applying for THIS job
   - Not a generic job description rewrite
   - Should feel natural and truthful

EXAMPLE: 
- Applicant background: Program Analyst with DoD Secret Clearance, defense acquisition, financial management
- Target job: Administrative Assistant (manage calendars, coordinate meetings, handle correspondence)
- Good opening: "Administrative professional with a background in program analysis and defense acquisition, bringing strong organizational skills and experience managing complex projects and stakeholder communications..."
- Bad opening: "Administrative professional with experience in administrative tasks..." (too generic, ignores background)

MANDATORY INSTRUCTIONS:
1. DO NOT copy the original summary's content
2. DO create a bridge statement that acknowledges both the target role AND the applicant's background
3. DO use the applicant's actual experience from the resume seed to explain what they offer
4. DO use job description terminology but connect it to their real background
5. Match the original's VOICE: same sentence structure patterns, natural transitions, human tone
6. The summary should feel authentic - it's about THIS person with THIS background applying for THIS job

${rewriteHint}

Write as a cohesive, flowing narrative paragraph. The summary must SOUND like the original (voice) but be CONTEXT-AWARE, bridging the applicant's background with the target job.

Return ONLY the rewritten summary lines (no heading, no markdown formatting like ** or *).` }
    ]
  };
  return dsCall_(payload, apiKey);
}

function summariesTooSimilar_(a, b) {
  const norm = s => String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const A = norm(a);
  const B = norm(b);
  if (!A || !B) return false;
  if (A === B) return true;
  const aWords = new Set(A.split(' ').filter(Boolean));
  const bWords = new Set(B.split(' ').filter(Boolean));
  let overlap = 0;
  for (const w of aWords) if (bWords.has(w)) overlap++;
  const ratio = overlap / Math.max(1, Math.min(aWords.size, bWords.size));
  return ratio >= 0.65; // Lowered from 0.75 to allow more variation in rewrites
}

function getSimilarityRatio_(a, b) {
  const norm = s => String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const A = norm(a);
  const B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const aWords = new Set(A.split(' ').filter(Boolean));
  const bWords = new Set(B.split(' ').filter(Boolean));
  let overlap = 0;
  for (const w of aWords) if (bWords.has(w)) overlap++;
  return overlap / Math.max(1, Math.min(aWords.size, bWords.size));
}

function safeName_(s){ return String(s||'Untitled').replace(/[^\w\s.-]+/g,'').trim() || 'Untitled'; }

function setStatus_(sh, msg){ safeWriteA1_(sh, CELL_STATUS, String(msg), 12); }

function getOrCreateDoc_(existingUrl, docName){
  const idMatch = (existingUrl||'').match(/[-\w]{25,}/);
  if (idMatch) {
    try { const id=idMatch[0]; const doc=DocumentApp.openById(id); DriveApp.getFileById(id).setName(docName); return doc; }
    catch(_){}
  }
  return DocumentApp.create(docName);
}

function colIndex_(letters){
  let n=0; for (let i=0;i<letters.length;i++) n = n*26 + (letters.charCodeAt(i)-64);
  return n;
}

/* ---------------- Overlap helpers ---------------- */
function topOverlaps_(a, b, n){
  const A = tokenCounts_(a), B = tokenCounts_(b);
  const scores = [];
  for (const [t,c] of A.entries()) { const d = B.get(t)||0; if (d) scores.push([t, Math.min(c,d)]); }
  scores.sort((x,y)=>y[1]-x[1]);
  return scores.slice(0,n).map(x=>x[0]);
}

function pickBestOverlapPhrase_(roleText, jdText, maxLen){
  const clean = s => String(s||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
  const a = clean(roleText), b = clean(jdText);
  if (!a || !b) return '';
  const words = a.split(' ');
  let best = '';
  for (let size = Math.min(6, words.length); size >= 2; size--) {
    for (let i=0;i+size<=words.length;i++){
      const ph = words.slice(i,i+size).join(' ');
      if (b.indexOf(ph) !== -1 && ph.length > best.length) best = ph;
    }
    if (best) break;
  }
  if (!best) {
    const ov = topOverlaps_(roleText, jdText, 1);
    best = ov[0] || '';
  }
  return best ? best.split(/\s+/).slice(0, maxLen).join(' ') : '';
}

function tokenCounts_(txt){
  const m=new Map();
  String(txt||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ')
    .split(/\s+/).filter(Boolean).forEach(t=>{
      if (t.length<3) return;
      m.set(t,(m.get(t)||0)+1);
    });
  return m;
}

function dsCall_(payload, apiKey){
  if (!apiKey || !apiKey.trim()) {
    throw new Error('API key is missing or empty');
  }
  if (!DS_ENDPOINT || !DS_MODEL) {
    throw new Error('DS_ENDPOINT or DS_MODEL not defined');
  }
  const resp = UrlFetchApp.fetch(DS_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload)
  });
  const code = resp.getResponseCode();
  const responseText = resp.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('DeepSeek HTTP ' + code + ': ' + responseText.substring(0, 500));
  }
  try {
    const data = JSON.parse(responseText);
    const content = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!content) {
      throw new Error('AI returned empty content. Response: ' + responseText.substring(0, 200));
    }
    return content;
  } catch (parseError) {
    throw new Error('Failed to parse AI response: ' + String(parseError) + ' | Response: ' + responseText.substring(0, 200));
  }
}

function getDeepseekKey_(){
  return (PropertiesService.getScriptProperties().getProperty('DEEPSEEK_API_KEY')||'').trim();
}

/* ---------------- Grounding seed for summary ---------------- */
function buildResumeCorpusSeed_(sh, rows, ksas, acr) {
  const contact = rows.CONTACT ? readContact_(sh, rows.CONTACT) : {};
  const skills  = rows.SKILLS ? readLongRow_(sh, candidateRows_(rows.SKILLS)) : '';
  const expRow  = rows.EMPLOYMENT ? firstUsableDataRow_(sh, rows.EMPLOYMENT, 6) : 0;
  const expText = expRow ? readExperienceRow_(sh, expRow) : '';
  const parts = [];
  parts.push([contact.city, contact.state, contact.phone, contact.email, contact.linkedin].filter(Boolean).join(' | '));
  if (skills) parts.push('SKILLS: ' + skills.replace(/\n+/g,'; '));
  if (expText) parts.push('EXP: ' + expText.replace(/\n+/g,' '));
  if (ksas) parts.push('KSAS: ' + ksas);
  if (acr)  parts.push('ACR: '  + acr);
  return parts.filter(Boolean).join('\n');
}

/* =========================================================
 * Extract Original Job Descriptions from Row 25
 * =======================================================*/
function extractOriginalJobDescriptions_(sh) {
  const rowNum = 25;
  const allCells = rowVals_(sh, rowNum);
  
  // Filter to populated cells with their column indices
  const populated = [];
  for (let i = 0; i < allCells.length; i++) {
    const val = String(allCells[i] || '').trim();
    if (val) {
      populated.push({ index: i, value: val, col: String.fromCharCode(66 + i) }); // B=66
    }
  }
  
  if (!populated.length) return '';
  
  // Identify job description cells by heuristics
  const jobDescs = [];
  for (let i = 0; i < populated.length; i++) {
    const cell = populated[i];
    const val = cell.value;
    
    // Skip if it's a header token
    if (HEADER_TOKENS.has(val.toLowerCase())) continue;
    
    // Skip if it looks like a date
    if (/^\d{4}$|^\d{1,2}\/\d{4}$|^\d{4}-\d{2}$/.test(val)) continue;
    
    // Skip very short text unless clearly descriptive
    if (val.length < 20 && !/[a-z]{4,}/i.test(val)) continue;
    
    // Job descriptions are typically longer text (> 50 chars) or contain action verbs/technical terms
    const isLongText = val.length > 50;
    const hasActionVerbs = /\b(managed|developed|created|implemented|analyzed|designed|built|maintained|supported|coordinated|led|executed|performed|delivered|improved|optimized|streamlined|facilitated|established|provided|ensured|monitored|tracked|reported|prepared|produced|conducted|administered|reviewed|edited|audited|compiled|facilitated|collaborated|worked|used|utilized|leveraged|applied|configured|deployed|installed|troubleshot|diagnosed|resolved|tested|validated|verified|documented|trained|mentored|supervised|oversaw)\b/i.test(val);
    const hasTechnicalTerms = /\b(python|sql|excel|power\s*bi|linux|windows|macos|unix|sap|crm|erp|agile|scrum|sla|tat|kpi|api|aws|azure|docker|kubernetes|git|jenkins|vba|javascript|java|\.net|html|css|json|xml|database|server|network|system|platform|software|application|tool|framework|library|methodology|process|procedure|workflow|automation|script|scripting|command|line|interface|gui|ui|ux|frontend|backend|fullstack|devops|ci\/cd|infrastructure|cloud|security|compliance|certification|clearance|defense|acquisition|financial|budget|analysis|modeling|reporting|dashboard|visualization|data|analytics|business|intelligence|requirements|stakeholder|project|management|portfolio|program|operations|strategy|planning|execution|delivery|governance|risk|quality|assurance|testing|deployment|integration|migration|upgrade|maintenance|support|helpdesk|troubleshooting|documentation|training|mentoring|supervision|leadership|team|collaboration|communication|presentation|report|meeting|coordination|facilitation)\b/i.test(val);
    
    if (isLongText || (hasActionVerbs && hasTechnicalTerms) || (val.length > 30 && hasTechnicalTerms)) {
      // Look LEFT for company/title (usually 1-3 cells to the left)
      let company = '';
      let title = '';
      
      // Scan left to find company/title
      for (let j = Math.max(0, i - 3); j < i; j++) {
        const leftCell = populated[j];
        if (!leftCell) continue;
        const leftVal = leftCell.value;
        
        // Skip if header, date, or very long (likely another description)
        if (HEADER_TOKENS.has(leftVal.toLowerCase()) || /^\d{4}$|^\d{1,2}\/\d{4}$/.test(leftVal) || leftVal.length > 80) continue;
        
        // Company names are usually shorter, may contain common company words
        if (!company && leftVal.length < 50 && !/[•\u2022-]/.test(leftVal)) {
          if (/inc|llc|corp|company|ltd|group|systems|solutions|services|technologies|tech|consulting|partners/i.test(leftVal) || leftVal.length < 30) {
            company = leftVal;
          }
        }
        
        // Job titles are usually medium length, may contain common title words
        if (!title && leftVal.length < 60 && leftVal.length > 5) {
          if (/analyst|specialist|manager|director|engineer|developer|administrator|coordinator|consultant|advisor|assistant|associate|senior|junior|lead|principal|executive|officer|representative|technician|support|specialist/i.test(leftVal)) {
            title = leftVal;
          } else if (!company && leftVal.length < 40) {
            title = leftVal; // Assume it's a title if no company found
          }
        }
      }
      
      jobDescs.push({
        company: company,
        title: title,
        description: val,
        cellRef: cell.col + rowNum
      });
    }
  }
  
  // If no descriptions found with heuristics, try fallback: all long text cells
  if (!jobDescs.length) {
    for (let i = 0; i < populated.length; i++) {
      const cell = populated[i];
      if (cell.value.length > 50 && !HEADER_TOKENS.has(cell.value.toLowerCase())) {
        jobDescs.push({
          company: '',
          title: '',
          description: cell.value,
          cellRef: cell.col + rowNum
        });
      }
    }
  }
  
  // Return concatenated text of all job descriptions for KSA extraction
  return jobDescs.map(jd => jd.description).join(' ');
}

/* =========================================================
 * Extract KSA Terminologies from Original Descriptions
 * =======================================================*/
function extractKsaTerminologies_(originalDescriptions) {
  if (!originalDescriptions || !originalDescriptions.trim()) return [];
  
  const text = String(originalDescriptions).toLowerCase();
  const ksaTerms = [];
  
  // Systems/Platforms patterns
  const systemPatterns = [
    /\b([A-Z][a-zA-Z]+ (?:System|Platform|Software|Tool|Application|Environment))\b/g,
    /\b([A-Z]{2,}[\s-]?[A-Z0-9]+)\b/g, // Acronyms like SAP, CRM, ERP, AWS, API
    /\b(linux|windows|macos|unix|android|ios)\b/gi,
    /\b(sap|oracle|salesforce|microsoft|google|amazon|aws|azure|gcp)\b/gi,
  ];
  
  // Processes/Methodologies patterns
  const processPatterns = [
    /\b(agile|scrum|kanban|waterfall|devops|ci\/cd|lean|six\s*sigma)\b/gi,
    /\b(sla|tat|kpi|sop|brd|frs|requirements\s*gathering|stakeholder\s*management)\b/gi,
    /\b(project\s*management|program\s*management|portfolio\s*management|risk\s*management)\b/gi,
  ];
  
  // Technologies/Tools patterns
  const techPatterns = [
    /\b(python|java|javascript|typescript|sql|html|css|json|xml|yaml|bash|powershell|vba)\b/gi,
    /\b(excel|power\s*bi|tableau|sql\s*server|mysql|postgresql|mongodb|oracle\s*database)\b/gi,
    /\b(docker|kubernetes|jenkins|git|github|gitlab|jira|confluence|slack|teams)\b/gi,
    /\b(\.net|react|angular|vue|node\.js|django|flask|spring|hibernate)\b/gi,
  ];
  
  // Certifications patterns
  const certPatterns = [
    /\b([A-Z]{2,}[\s-]?[A-Z0-9]+)\s+[Cc]ertified/gi,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+[Cc]ertification/gi,
    /\b(comptia|pmp|cissp|aws\s*certified|microsoft\s*certified|google\s*certified)\b/gi,
    /\b(dod\s*secret|dod\s*top\s*secret|security\s*clearance)\b/gi,
  ];
  
  // Domain-specific terms
  const domainPatterns = [
    /\b(defense\s*acquisition|financial\s*modeling|budget\s*oversight|program\s*analysis)\b/gi,
    /\b(data\s*analytics|business\s*intelligence|data\s*visualization|reporting)\b/gi,
    /\b(requirements\s*analysis|business\s*analysis|systems\s*analysis|process\s*improvement)\b/gi,
  ];
  
  // Extract and categorize
  const found = new Set();
  
  // Systems
  systemPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const term = match[1] || match[0];
      if (term && term.length > 2 && !found.has(term.toLowerCase())) {
        found.add(term.toLowerCase());
        ksaTerms.push({ term: term, category: 'systems' });
      }
    }
  });
  
  // Processes
  processPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const term = match[1] || match[0];
      if (term && term.length > 2 && !found.has(term.toLowerCase())) {
        found.add(term.toLowerCase());
        ksaTerms.push({ term: term, category: 'processes' });
      }
    }
  });
  
  // Technologies
  techPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const term = match[1] || match[0];
      if (term && term.length > 2 && !found.has(term.toLowerCase())) {
        found.add(term.toLowerCase());
        ksaTerms.push({ term: term, category: 'technologies' });
      }
    }
  });
  
  // Certifications
  certPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const term = match[1] || match[0];
      if (term && term.length > 2 && !found.has(term.toLowerCase())) {
        found.add(term.toLowerCase());
        ksaTerms.push({ term: term, category: 'certifications' });
      }
    }
  });
  
  // Domain-specific
  domainPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const term = match[1] || match[0];
      if (term && term.length > 2 && !found.has(term.toLowerCase())) {
        found.add(term.toLowerCase());
        ksaTerms.push({ term: term, category: 'domain' });
      }
    }
  });
  
  return ksaTerms;
}

/* =========================================================
 * AI Similarity Check for Equivalent Systems/Technologies
 * =======================================================*/
function checkKsaSimilarity_(originalKsa, jobRequirement, apiKey) {
  if (!apiKey || !originalKsa || !jobRequirement) {
    return { similar: false, confidence: 0, explanation: 'Missing input' };
  }
  
  // Quick token-based check first (faster, no API call)
  const origLower = String(originalKsa).toLowerCase();
  const reqLower = String(jobRequirement).toLowerCase();
  
  // Exact match (case-insensitive)
  if (origLower === reqLower) {
    return { similar: true, confidence: 1.0, explanation: 'Exact match' };
  }
  
  // Check if one contains the other
  if (origLower.includes(reqLower) || reqLower.includes(origLower)) {
    return { similar: true, confidence: 0.9, explanation: 'Substring match' };
  }
  
  // Use AI for semantic similarity check
  try {
    const prompt = `Determine if these two technologies/systems/processes are similar or equivalent enough that someone with experience in the first could reasonably claim relevant experience for the second (without lying).

Original KSA: "${originalKsa}"
Job Requirement: "${jobRequirement}"

Consider:
- Are they similar technologies (e.g., Apple macOS vs Microsoft Windows - both are operating systems)?
- Are they equivalent tools (e.g., Excel vs Google Sheets - both are spreadsheets)?
- Are they related systems (e.g., Linux vs Unix - Linux is Unix-like)?
- Would someone with the original experience have transferable skills?

Respond with ONLY a JSON object in this exact format:
{"similar": true/false, "confidence": 0.0-1.0, "explanation": "brief reason"}

Examples:
- Apple macOS vs Microsoft Windows → {"similar": true, "confidence": 0.8, "explanation": "Both are operating systems with similar functionality"}
- Excel vs Google Sheets → {"similar": true, "confidence": 0.9, "explanation": "Both are spreadsheet applications"}
- Python vs Java → {"similar": true, "confidence": 0.7, "explanation": "Both are programming languages, though different syntax"}
- Linux vs Unix → {"similar": true, "confidence": 0.85, "explanation": "Linux is Unix-like, similar command structure"}
- SAP vs Excel → {"similar": false, "confidence": 0.2, "explanation": "Different types of software - ERP vs spreadsheet"}`;

    const payload = {
      model: DS_MODEL,
      temperature: 0.2, // Lower temperature for more consistent similarity judgments
      messages: [
        { role: "system", content: "You are an expert at determining if technologies, systems, or processes are similar enough for transferable experience claims. Respond only with valid JSON." },
        { role: "user", content: prompt }
      ]
    };
    
    const response = dsCall_(payload, apiKey);
    
    // Parse JSON response
    try {
      const result = JSON.parse(response);
      return {
        similar: Boolean(result.similar),
        confidence: Math.max(0, Math.min(1, parseFloat(result.confidence) || 0)),
        explanation: String(result.explanation || 'AI analysis')
      };
    } catch {
      // If JSON parse fails, try to extract from text
      const similarMatch = response.match(/similar["\s:]*true/i);
      const confidenceMatch = response.match(/confidence["\s:]*([0-9.]+)/i);
      const similar = similarMatch !== null;
      const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5;
      
      return {
        similar: similar,
        confidence: confidence,
        explanation: 'Parsed from AI response'
      };
    }
  } catch {
    // Fallback to token-based similarity
    const origTokens = new Set(origLower.split(/\W+/).filter(t => t.length > 2));
    const reqTokens = new Set(reqLower.split(/\W+/).filter(t => t.length > 2));
    let overlap = 0;
    for (const token of origTokens) {
      if (reqTokens.has(token)) overlap++;
    }
    const similarity = overlap / Math.max(1, Math.min(origTokens.size, reqTokens.size));
    
    return {
      similar: similarity > 0.3,
      confidence: similarity,
      explanation: 'Token-based fallback'
    };
  }
}

/* =========================================================
 * Match KSAs to New Job Description (Flexible Semantic Matching)
 * OPTIMIZED: Limits AI API calls to prevent timeouts
 * =======================================================*/
function matchKsasToJobDescription_(ksaTerms, jobDesc, existingKsas, apiKey) {
  if (!ksaTerms || !ksaTerms.length || !jobDesc) return [];
  
  const jobDescLower = String(jobDesc).toLowerCase();
  const matched = [];
  
  // Pre-extract job description keywords (only once)
  const jobWords = jobDescLower.split(/\W+/).filter(w => w.length > 3);
  const jobPhrases = (jobDesc.match(/\b\w+(?:\s+\w+){1,2}\b/gi) || []).filter(p => p.length >= 5);
  
  // Limit job words/phrases to most relevant (reduce API calls)
  const MAX_JOB_WORDS_TO_CHECK = 15; // Limit to top 15 words
  const MAX_JOB_PHRASES_TO_CHECK = 10; // Limit to top 10 phrases
  
  // Score and prioritize job words/phrases by relevance
  const jobWordScores = jobWords.map(word => {
    // Prioritize technical terms, systems, technologies
    const isTechnical = /\b(python|sql|excel|linux|windows|macos|unix|sap|crm|erp|agile|scrum|aws|azure|docker|kubernetes|git|jenkins|vba|javascript|java|\.net|html|css|database|server|network|system|platform|software|application|tool|framework|library|methodology|process|procedure|workflow|automation|script|scripting|command|line|interface|gui|ui|ux|frontend|backend|fullstack|devops|ci\/cd|infrastructure|cloud|security|compliance|certification|clearance|defense|acquisition|financial|budget|analysis|modeling|reporting|dashboard|visualization|data|analytics|business|intelligence|requirements|stakeholder|project|management|portfolio|program|operations|strategy|planning|execution|delivery|governance|risk|quality|assurance|testing|deployment|integration|migration|upgrade|maintenance|support|helpdesk|troubleshooting|documentation|training|mentoring|supervision|leadership|team|collaboration|communication|presentation|report|meeting|coordination|facilitation)\b/i.test(word);
    return { word, score: isTechnical ? 2 : 1 };
  }).sort((a, b) => b.score - a.score).slice(0, MAX_JOB_WORDS_TO_CHECK).map(x => x.word);
  
  const jobPhraseScores = jobPhrases.map(phrase => {
    const phraseLower = phrase.toLowerCase();
    const isTechnical = /\b(project\s*management|program\s*management|portfolio\s*management|risk\s*management|requirements\s*gathering|stakeholder\s*management|data\s*analysis|business\s*analysis|systems\s*analysis|process\s*improvement|software\s*development|application\s*development|system\s*administration|network\s*administration|database\s*administration|cloud\s*computing|devops|ci\/cd|agile\s*methodology|scrum\s*framework)\b/i.test(phraseLower);
    return { phrase, score: isTechnical ? 2 : 1 };
  }).sort((a, b) => b.score - a.score).slice(0, MAX_JOB_PHRASES_TO_CHECK).map(x => x.phrase);
  
  // Limit total AI similarity checks per KSA
  const MAX_AI_CHECKS_PER_KSA = 5; // Only check top 5 candidates per KSA
  
  for (const ksa of ksaTerms) {
    const ksaTerm = String(ksa.term);
    const ksaLower = ksaTerm.toLowerCase();
    
    // 1. Exact match check
    if (jobDescLower.includes(ksaLower) || ksaLower.includes(jobDescLower.split(/\s+/).find(w => w.length > 3 && jobDescLower.includes(w)) || '')) {
      matched.push({
        ksa: ksaTerm,
        category: ksa.category,
        matchType: 'exact',
        confidence: 1.0,
        similarityNote: null
      });
      continue;
    }
    
    // 2. Token overlap check
    const ksaTokens = new Set(ksaLower.split(/\W+/).filter(t => t.length > 2));
    const jobTokens = new Set(jobDescLower.split(/\W+/).filter(t => t.length > 2));
    let overlap = 0;
    for (const token of ksaTokens) {
      if (jobTokens.has(token)) overlap++;
    }
    const tokenSimilarity = overlap / Math.max(1, Math.min(ksaTokens.size, jobTokens.size));
    
    if (tokenSimilarity > 0.5) {
      matched.push({
        ksa: ksaTerm,
        category: ksa.category,
        matchType: 'token',
        confidence: tokenSimilarity,
        similarityNote: null
      });
      continue;
    }
    
    // 3. AI similarity check - ONLY if no exact/token match AND limit checks
    // Pre-filter candidates by quick token check before expensive AI call
    const candidates = [];
    
    // Check limited job words
    for (const jobWord of jobWordScores.slice(0, MAX_AI_CHECKS_PER_KSA)) {
      // Quick pre-check: do they share any meaningful tokens?
      const jobWordTokens = new Set(jobWord.toLowerCase().split(/\W+/).filter(t => t.length > 2));
      let quickOverlap = 0;
      for (const token of ksaTokens) {
        if (jobWordTokens.has(token)) quickOverlap++;
      }
      // Only add to candidates if some token overlap or both are technical terms
      if (quickOverlap > 0 || (ksaTokens.size > 0 && jobWordTokens.size > 0)) {
        candidates.push({ term: jobWord, type: 'word', quickScore: quickOverlap });
      }
    }
    
    // Check limited job phrases
    for (const phrase of jobPhraseScores.slice(0, MAX_AI_CHECKS_PER_KSA)) {
      const phraseTokens = new Set(phrase.toLowerCase().split(/\W+/).filter(t => t.length > 2));
      let quickOverlap = 0;
      for (const token of ksaTokens) {
        if (phraseTokens.has(token)) quickOverlap++;
      }
      if (quickOverlap > 0 || (ksaTokens.size > 0 && phraseTokens.size > 0)) {
        candidates.push({ term: phrase, type: 'phrase', quickScore: quickOverlap });
      }
    }
    
    // Sort candidates by quick score and limit
    candidates.sort((a, b) => b.quickScore - a.quickScore);
    const topCandidates = candidates.slice(0, MAX_AI_CHECKS_PER_KSA);
    
    // Only do AI checks on top candidates
    let bestMatch = null;
    let bestConfidence = 0;
    
    for (const candidate of topCandidates) {
      if (!apiKey) break; // Skip if no API key
      
      try {
        const similarity = checkKsaSimilarity_(ksaTerm, candidate.term, apiKey);
        if (similarity.similar && similarity.confidence > bestConfidence) {
          bestConfidence = similarity.confidence;
          bestMatch = {
            jobTerm: candidate.term,
            similarity: similarity
          };
          
          // Early exit if we find a very high confidence match
          if (bestConfidence > 0.85) break;
        }
      } catch {
        // Skip this candidate if API call fails
        continue;
      }
    }
    
    if (bestMatch && bestConfidence > 0.6) {
      matched.push({
        ksa: ksaTerm,
        category: ksa.category,
        matchType: 'similar',
        confidence: bestConfidence,
        similarityNote: bestMatch.similarity.explanation,
        jobTerm: bestMatch.jobTerm
      });
    }
  }
  
  // Sort by confidence (highest first), then by match type (exact > token > similar)
  matched.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const typeOrder = { 'exact': 0, 'token': 1, 'similar': 2 };
    return (typeOrder[a.matchType] || 3) - (typeOrder[b.matchType] || 3);
  });
  
  return matched;
}

/* =========================================================
 * Enhance Bullets with KSAs (Post-Generation, Natural Language)
 * =======================================================*/
function enhanceBulletsWithKsas_(bullets, matchedKsas, jobDesc) {
  if (!bullets || !bullets.length || !matchedKsas || !matchedKsas.length) {
    return bullets;
  }
  
  const enhanced = [];
  const usedKsas = new Set(); // Track across ALL bullets to prevent repetition
  const ksaUsageCount = new Map(); // Track how many times each KSA is used
  
  // Limit each KSA to maximum 1 use across all bullets (strict limit to prevent overuse)
  const MAX_KSA_USES = 1;
  
  for (const bullet of bullets) {
    const enhancedBullet = enhanceSingleBullet_(bullet, matchedKsas, jobDesc, usedKsas, ksaUsageCount, MAX_KSA_USES);
    enhanced.push(enhancedBullet);
  }
  
  return enhanced;
}

function enhanceSingleBullet_(bullet, matchedKsas, jobDesc, usedKsas, ksaUsageCount, maxKsaUses) {
  if (!bullet || !matchedKsas || !matchedKsas.length) return bullet;
  
  const bulletLower = String(bullet).toLowerCase();
  const bulletWords = bulletLower.split(/\W+/).filter(w => w.length > 2);
  
  // Find best matching KSA for this bullet
  let bestKsa = null;
  let bestScore = 0;
  
  for (const matched of matchedKsas) {
    // Skip if KSA has been used too many times
    const usageCount = ksaUsageCount.get(matched.ksa) || 0;
    if (usageCount >= maxKsaUses) continue;
    
    // Skip if already used in this bullet
    const ksaLower = String(matched.ksa).toLowerCase();
    if (bulletLower.includes(ksaLower)) continue;
    
    // Score by relevance to bullet context
    const ksaWords = ksaLower.split(/\W+/).filter(w => w.length > 2);
    
    // Check for word overlap
    let overlap = 0;
    for (const word of ksaWords) {
      if (bulletWords.includes(word)) overlap++;
    }
    
    // Check if bullet mentions related concepts - VERY strict context checking
    let contextScore = 0;
    let contextPenalty = 0; // Penalty for bad context matches
    
    // Check if KSA makes sense with the action verb
    const actionVerb = bulletLower.match(/\b(provide|review|edit|create|conduct|manage|maintain|supervise|coordinate|track|support|develop|monitor|compile|audit)\b/);
    const verb = actionVerb ? actionVerb[1] : '';
    
    // Domain terms like "business analysis" need VERY specific context
    if (matched.category === 'domain' || ksaLower.includes('analysis') || ksaLower.includes('business')) {
      // "Business analysis" should ONLY be used with analysis-related verbs and contexts
      if (verb && !['analyze', 'analyzed', 'review', 'reviewed', 'conduct', 'conducted', 'gather', 'gathered', 'compile', 'compiled', 'audit', 'audited'].includes(verb)) {
        contextPenalty += 0.5; // Heavy penalty for wrong verb
      }
      // Should NOT be used with administrative tasks
      if (bulletLower.match(/\b(calendar|schedule|meeting|correspondence|visitor|screening|travel|order|record|policy|administrative|supervise|supervised|maintain|maintained|coordinate|coordinated)\b/)) {
        contextPenalty += 0.5; // Heavy penalty for administrative context
      }
      // Should be used with analysis/requirements contexts
      if (bulletLower.match(/\b(requirement|analysis|analyze|data|report|reporting|financial|cost|audit|compile|gather|interview|survey|workshop)\b/)) {
        contextScore += 0.4; // Good context match
      }
    }
    
    // Technologies/systems should only be inserted where tools/software make sense
    if (matched.category === 'technologies' || matched.category === 'systems') {
      // Should NOT be used with purely administrative tasks
      if (bulletLower.match(/\b(calendar|schedule|meeting|correspondence|visitor|screening|travel|order|record|policy|administrative|supervise|supervised|maintain|maintained|coordinate|coordinated|handle|handled)\b/) && 
          !bulletLower.match(/\b(database|system|tool|software|application|platform|technology)\b/)) {
        contextPenalty += 0.4; // Penalty for administrative context without tech mention
      }
      // Should be used with tech-related verbs or contexts
      if (bulletLower.match(/\b(using|with|via|through|developed|created|built|designed|implemented|configured|deployed|installed|maintained|managed|monitored|tracked|analyzed|tested|validated|verified|database|system|tool|software|application|platform)\b/)) {
        contextScore += 0.3;
      }
    } else if (matched.category === 'processes') {
      // Processes should only be inserted where methodologies/processes make sense
      if (bulletLower.match(/\b(process|methodology|framework|procedure|workflow|approach|method)\b/)) {
        contextScore += 0.3;
      }
    }
    
    // Heavy penalty if KSA has been used before (strongly prefer variety)
    const usagePenalty = usageCount * 0.3;
    
    const score = (overlap / Math.max(1, ksaWords.length)) * 0.5 + matched.confidence * 0.3 + contextScore - usagePenalty - contextPenalty;
    
    if (score > bestScore) {
      bestScore = score;
      bestKsa = matched;
    }
  }
  
  // Only enhance if we found a good match (score > 0.3, higher threshold for quality)
  // Also check that context penalty didn't make it negative
  if (!bestKsa || bestScore < 0.3 || bestScore <= 0) return bullet;
  
  // Mark as used and increment usage count
  usedKsas.add(bestKsa.ksa);
  ksaUsageCount.set(bestKsa.ksa, (ksaUsageCount.get(bestKsa.ksa) || 0) + 1);
  
  // Natural language insertion patterns
  let enhanced = String(bullet);
  
  // Clean up any obvious duplicate text that might exist
  // Remove patterns like "word (word" or duplicate phrases
  enhanced = enhanced.replace(/\b(\w+)\s*\(\s*\1\b/gi, '$1 (');
  enhanced = enhanced.replace(/\b(\w+\s+\w+)\s*\(\s*\1\b/gi, '$1 (');
  
  // Remove trailing period temporarily for manipulation
  const hasPeriod = /\.$/.test(enhanced);
  enhanced = enhanced.replace(/\.$/, '');
  
  // Determine best insertion point and method - prioritize natural flow and grammar
  // Strategy: Find the best natural insertion point that doesn't break grammar
  
  // Detect if bullet contains a list structure (comma-separated items)
  // Pattern: word, word, and word OR word, word (at least 2 commas or 1 comma + "and")
  const hasCommaList = /[^,]+,\s*[^,]+(?:,\s*[^,]+)*(?:\s+and\s+[^,]+)?/.test(enhanced);
  
  // If there's a list, find where it ends and insert after it
  if (hasCommaList) {
    // Find the last item in the list (after the last comma or "and")
    // Match: everything up to and including the list, then insert after
    const listPattern = /(.+?)((?:\s+(?:for|with|to|in|at|on)\s+)?[^,]+(?:,\s*[^,]+)*(?:\s+and\s+[^,]+)?)([,.]|$)/i;
    const listMatch = enhanced.match(listPattern);
    
    if (listMatch) {
      // Check if the matched part is actually a list (has commas or "and")
      const listPart = listMatch[2];
      if (listPart.includes(',') || /\s+and\s+/.test(listPart)) {
        // This is a list - insert after it
        const beforeList = listMatch[1].trim();
        const punct = listMatch[3] || '.';
        enhanced = `${beforeList}${listPart} using ${bestKsa.ksa}${punct}`;
      } else {
        // Not really a list, use standard logic below
        const hasPreposition = enhanced.match(/\b(using|with|via|through)\s+([^,.]+?)([,.]|$)/i);
        if (!hasPreposition) {
          // No preposition, add at end
          enhanced = enhanced.replace(/\.$/, '') + ` using ${bestKsa.ksa}.`;
        } else {
          // Has preposition, will be handled below
        }
      }
    } else {
      // Couldn't parse list, add at end
      enhanced = enhanced.replace(/\.$/, '') + ` using ${bestKsa.ksa}.`;
    }
  }
  
  // If we haven't inserted yet (no list or list logic didn't apply), use standard insertion
  if (!enhanced.includes(bestKsa.ksa)) {
    // Use standard insertion logic
    const hasPreposition = enhanced.match(/\b(using|with|via|through)\s+([^,.]+?)([,.]|$)/i);
    
    if (hasPreposition) {
      const prep = hasPreposition[1];
      const existing = hasPreposition[2].trim();
      const punct = hasPreposition[3];
      
      // If existing phrase is short and doesn't already contain the KSA
      if (existing.length < 40 && !existing.toLowerCase().includes(bestKsa.ksa.toLowerCase())) {
        // Add to existing list if it's comma-separated, otherwise use "and"
        if (existing.includes(',')) {
          enhanced = enhanced.replace(/\b(using|with|via|through)\s+([^,.]+?)([,.]|$)/i, `${prep} ${existing}, ${bestKsa.ksa}${punct}`);
        } else {
          enhanced = enhanced.replace(/\b(using|with|via|through)\s+([^,.]+?)([,.]|$)/i, `${prep} ${existing} and ${bestKsa.ksa}${punct}`);
        }
      } else {
        // Existing phrase is long or already has KSA - don't add another, skip this bullet
        // Actually, let's add at end instead
        enhanced = enhanced.replace(/\.$/, '') + ` using ${bestKsa.ksa}.`;
      }
    } else {
      // No existing preposition phrase - find action verb or add at end
      const verbMatch = enhanced.match(/\b(reviewed|edited|created|analyzed|developed|managed|implemented|designed|built|maintained|supported|coordinated|led|executed|performed|delivered|improved|optimized|streamlined|facilitated|established|provided|ensured|monitored|tracked|reported|prepared|produced|conducted|administered|audited|compiled|collaborated|worked|configured|deployed|installed|troubleshot|diagnosed|resolved|tested|validated|verified|documented|trained|mentored|supervised|oversaw)\s+([^,.]+?)([,.]|$)/i);
      
      if (verbMatch) {
        const verb = verbMatch[1];
        const rest = verbMatch[2].trim();
        const punct = verbMatch[3];
        
        // Check if rest contains a list - if so, insert after the list
        if (rest.match(/[^,]+(?:,\s*[^,]+)+(?:\s+and\s+[^,]+)?/)) {
          // Rest contains a list, insert after it
          enhanced = enhanced.replace(/\b(reviewed|edited|created|analyzed|developed|managed|implemented|designed|built|maintained|supported|coordinated|led|executed|performed|delivered|improved|optimized|streamlined|facilitated|established|provided|ensured|monitored|tracked|reported|prepared|produced|conducted|administered|audited|compiled|collaborated|worked|configured|deployed|installed|troubleshot|diagnosed|resolved|tested|validated|verified|documented|trained|mentored|supervised|oversaw)\s+([^,.]+?)([,.]|$)/i, `${verb} ${rest} using ${bestKsa.ksa}${punct}`);
        } else if (rest.length < 50) {
          // Rest is short and no list - insert after verb phrase
          enhanced = enhanced.replace(/\b(reviewed|edited|created|analyzed|developed|managed|implemented|designed|built|maintained|supported|coordinated|led|executed|performed|delivered|improved|optimized|streamlined|facilitated|established|provided|ensured|monitored|tracked|reported|prepared|produced|conducted|administered|audited|compiled|collaborated|worked|configured|deployed|installed|troubleshot|diagnosed|resolved|tested|validated|verified|documented|trained|mentored|supervised|oversaw)\s+([^,.]+?)([,.]|$)/i, `${verb} ${rest} using ${bestKsa.ksa}${punct}`);
        } else {
          // Rest is too long, add at very end
          enhanced = enhanced.replace(/\.$/, '') + ` using ${bestKsa.ksa}.`;
        }
      } else {
        // No clear insertion point - add naturally at end
        enhanced = enhanced.replace(/\.$/, '') + ` using ${bestKsa.ksa}.`;
      }
    }
  }
  
  // Restore period if it was there
  if (hasPeriod && !/\.$/.test(enhanced)) {
    enhanced += '.';
  }
  
  return enhanced;
}