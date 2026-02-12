/************************************************************
 * Reactive Resume Generator (Template JSON in Sheet + DeepSeek + Import + PDF)
 *
 * Reads (Sheet cells on SHEET_NAME):
 *   B7  = Google Doc URL (source resume text)
 *   B39 = Reactive Resume base URL (publicly reachable)
 *   B40 = Template JSON (entire JSON pasted into a single cell)
 *
 * Writes:
 *   C7  = exported PDF URL
 *
 * Script Properties required:
 *   DEEPSEEK_API_KEY
 *   RXRESUME_API_KEY
 *
 * How it works (controlled):
 *   1) Load template JSON from B40
 *   2) Read resume text from Google Doc at B7
 *   3) Build data section-by-section using DeepSeek JSON-only outputs
 *   4) Merge into template while preserving required structure/ids/metadata
 *   5) POST /api/openapi/resume/import  (returns resumeId as string)  (Reactive Resume API)
 *   6) GET  /api/openapi/printer/resume/{id}/pdf (returns PDF url as string)
 *   7) Write PDF URL to C7
 ************************************************************/

/* =========================================================
 * CONFIG
 * ======================================================= */

// Sheet cell map (per your screenshot / instruction)
const CELL_SOURCE_DOC_URL = 'B7';
const CELL_RR_BASE_URL    = 'B39';
const CELL_TEMPLATE_JSON  = 'B40';
const CELL_OUT_PDF_URL    = 'C7';
const CELL_FULL_NAME      = 'B9';
const CELL_POSITION       = 'B3';
const CELL_COMPANY        = 'B4';

/* =========================================================
 * Entry point (attach to a button)
 * ======================================================= */
function Generate_ReactiveResume_PDF_From_Doc() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) throw new Error(`Sheet "${SHEET_NAME}" not found`);

  const docUrl  = val_(sh, CELL_SOURCE_DOC_URL);
  const baseUrl = val_(sh, CELL_RR_BASE_URL);

  if (!docUrl)  throw new Error(`Missing source Google Doc URL in ${CELL_SOURCE_DOC_URL}`);
  if (!baseUrl) throw new Error(`Missing Reactive Resume base URL in ${CELL_RR_BASE_URL}`);

  const dsKey = getScriptProp_('DEEPSEEK_API_KEY');
  if (!dsKey) throw new Error('Missing Script Property: DEEPSEEK_API_KEY');

  // REQUIRED: use RXRESUME_API_KEY (matches your Script Properties)
  const rrKey = getScriptProp_('RXRESUME_API_KEY');
  if (!rrKey) throw new Error('Missing Script Property: RXRESUME_API_KEY');

  // 1) Load template JSON from B40
  const templateObj = loadTemplateJsonFromSheet_(sh, CELL_TEMPLATE_JSON);

  // 2) Read resume text from Google Doc
  const resumeText = readGoogleDocPlainText_(docUrl);
  if (!resumeText.trim()) throw new Error('Source Google Doc had no readable text');
  
  Logger.log('Resume text length: ' + resumeText.length + ' characters');
  Logger.log('Resume preview: ' + resumeText.substring(0, 200));

  // 2.5) Validate resume text
  const validationIssues = validateResumeText_(resumeText);
  if (validationIssues.length > 3) {
    throw new Error('Resume text has too many validation issues. Please check the source document.');
  }

  // 3) Build a filled resume object (section-by-section)
  const filled = fillTemplateSectionBySection_(templateObj, resumeText, dsKey);

  // 4) Validate render safety before import
  validateRenderSafety_(filled);
  
  // 5) Import into Reactive Resume (returns resumeId)
  const resumeId = rrImportResume_(baseUrl, rrKey, filled);

  // 6) Export PDF (returns URL)
  const pdfUrl = rrExportPdf_(baseUrl, rrKey, resumeId);

  // 7) Get filename components from sheet
  const fullName = val_(sh, CELL_FULL_NAME) || 'Resume';
  const position = val_(sh, CELL_POSITION) || '';
  const company = val_(sh, CELL_COMPANY) || '';
  
  // Build filename: Full Name_Position_Company.pdf
  let filenameParts = [fullName];
  if (position) filenameParts.push(position);
  if (company) filenameParts.push(company);
  
  // Sanitize filename: remove invalid characters and replace spaces with underscores
  const sanitizedFilename = filenameParts
    .join('_')
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid filename characters
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/_+/g, '_') // Collapse multiple underscores
    .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
    + '.pdf';
  
  // 8) Download PDF and save to Drive with custom filename
  let actualUrl = '';
  if (pdfUrl) {
    // Handle different return formats: string URL, JSON string, or object with url property
    let pdfDownloadUrl = '';
    if (typeof pdfUrl === 'string') {
      // Check if it's a JSON string
      if (pdfUrl.trim().startsWith('{')) {
        try {
          const urlObj = JSON.parse(pdfUrl);
          pdfDownloadUrl = urlObj.url || urlObj.href || pdfUrl;
        } catch (e) {
          pdfDownloadUrl = pdfUrl;
        }
      } else {
        pdfDownloadUrl = pdfUrl;
      }
    } else if (typeof pdfUrl === 'object' && pdfUrl.url) {
      pdfDownloadUrl = pdfUrl.url;
    } else if (typeof pdfUrl === 'object' && pdfUrl.href) {
      pdfDownloadUrl = pdfUrl.href;
    }
    
    if (pdfDownloadUrl) {
      // Download PDF and save to Drive with custom filename
      actualUrl = downloadAndSavePdfToDrive_(pdfDownloadUrl, sanitizedFilename, rrKey);
    }
  }
  
  if (actualUrl) {
    // Create clickable hyperlink using HYPERLINK formula
    // Escape quotes in URL if present
    const escapedUrl = actualUrl.replace(/"/g, '""');
    sh.getRange(CELL_OUT_PDF_URL).setFormula(`=HYPERLINK("${escapedUrl}", "View PDF")`);
  } else {
    sh.getRange(CELL_OUT_PDF_URL).setValue('');
  }
  sh.getRange(CELL_OUT_PDF_URL).setNote(
    `Reactive Resume ID: ${resumeId}\nGenerated: ${new Date().toISOString()}\nFilename: ${sanitizedFilename}`
  );
}

/* =========================================================
 * Template loading (JSON stored in single sheet cell)
 * ======================================================= */
function loadTemplateJsonFromSheet_(sh, a1) {
  const raw = String(sh.getRange(a1).getValue() || '').trim();
  if (!raw) {
    throw new Error(
      `Template JSON not found.\n` +
      `Paste the full template JSON into ${a1} (single cell).`
    );
  }

  let obj;
  try {
    obj = JSON.parse(raw);
    assertIsObject_(obj, `Template JSON at ${a1}`);
  } catch (e) {
    throw new Error(`Invalid JSON in ${a1}: ${e.message}`);
  }
  
  // Validate template structure
  if (!obj.data && !obj.basics && !obj.sections) {
    Logger.log('WARNING: Template appears to have unexpected structure');
    Logger.log('Template keys: ' + Object.keys(obj).join(', '));
  }
  
  // Log template structure for debugging
  Logger.log('Template structure loaded:');
  if (obj.data) {
    Logger.log('  Has data wrapper: YES');
    Logger.log('  Data keys: ' + Object.keys(obj.data).join(', '));
  } else {
    Logger.log('  Has data wrapper: NO');
    Logger.log('  Root keys: ' + Object.keys(obj).join(', '));
  }
  
  return obj;
}

/* =========================================================
 * Google Doc reader
 * ======================================================= */
function readGoogleDocPlainText_(docUrl) {
  const doc = DocumentApp.openByUrl(docUrl);
  return doc.getBody().getText() || '';
}

/* =========================================================
 * Section-by-section fill (controlled)
 * ======================================================= */
function fillTemplateSectionBySection_(templateObj, resumeText, dsKey) {
  // Clone so we don't mutate original template
  let out = JSON.parse(JSON.stringify(templateObj));

  // ✅ Normalize template shape:
  // If the template is "data-only" (basics/sections at root), wrap it.
  // If it already has {data:{...}}, keep it as-is.
  // CRITICAL: Check if data exists AND has proper structure to prevent double-wrapping
  if (!out.data) {
    const looksLikeDataOnly =
      (out.basics || out.sections || out.summary || out.education || out.experience || out.skills || out.picture);
    if (looksLikeDataOnly) {
      out = { data: out };
      Logger.log('Template normalization: Wrapped data-only template with data wrapper');
    } else {
      out = { data: {} };
      Logger.log('Template normalization: Created empty data structure');
    }
  } else {
    // Template already has data wrapper - verify it's not empty object
    if (typeof out.data === 'object' && Object.keys(out.data).length > 0) {
      Logger.log('Template normalization: Template already has data wrapper with content, preserving structure');
    }
  }

  // Ensure these exist to avoid AI inventing structure
  if (!out.data.basics) out.data.basics = {};
  // CRITICAL: Always create summary object - it must exist even if empty
  // NOTE: hidden property will be set once at the end in validateAndHardenForImport_
  if (!out.data.summary || typeof out.data.summary !== 'object') {
    out.data.summary = { title: '', content: '', columns: 1 };
  }
  if (typeof out.data.summary.title !== 'string') out.data.summary.title = '';
  if (typeof out.data.summary.content !== 'string') out.data.summary.content = '';
  if (typeof out.data.summary.columns !== 'number') out.data.summary.columns = 1;
  // Don't set hidden here - it will be set once at the end

  if (!out.data.sections) out.data.sections = {};
  
  // CRITICAL: Preserve metadata formatting from template (template name, theme, typography, design, etc.)
  // These are important for PDF formatting and should be kept from the template
  // The template's metadata.name (template name) and metadata.theme define the visual style
  // We'll only add/validate required fields, not overwrite existing formatting
  // The clone above (JSON.parse(JSON.stringify)) already preserves these
  if (!out.data.metadata) {
    out.data.metadata = {};
  } else {
    // Preserve critical formatting fields - these should already be in the template
    // metadata.name = template name (e.g., "modern", "classic", "minimal")
    // metadata.theme = theme settings
    // These are preserved by the clone, but we ensure they're not lost
  }

  // 1) BASICS - Extract name, email, phone, location, headline from resume text
  const basicsPatch = dsJsonOnly_(
    dsKey,
    buildBasicsPrompt_(resumeText, out.data.basics)
  );
  applyBasicsPatch_(out, basicsPatch);

  // 2) SUMMARY - Single, reliable extraction strategy
  const summaryPatch = dsJsonOnly_(
    dsKey,
    buildSectionPrompt_('summary', resumeText, out.data.summary, ['title','content'], { maxChars: 5000 })
  );
  applySummaryPatch_(out, summaryPatch);
  
  // Only one simple fallback: if empty, extract text between contact and experience
  if (!out.data.summary.content || !out.data.summary.content.trim()) {
    const summaryMatch = resumeText.match(/Summary\s*\n([\s\S]+?)(?=\n(?:Experience|Skills|Education|$))/i);
    if (summaryMatch && summaryMatch[1]) {
      out.data.summary.content = summaryMatch[1].trim();
      out.data.summary.title = 'Summary';
      Logger.log('Extracted summary using regex: ' + out.data.summary.content.substring(0, 100));
    }
  }
  
  // Ensure summary object has correct structure (title only - hidden will be set at end)
  if (!out.data.summary.title) out.data.summary.title = '';
  // Don't set hidden here - it will be set once at the end in validateAndHardenForImport_
  
  // CRITICAL: No truncation - let CSS handle text wrapping and flow
  // Summary content should flow naturally across pages, not be artificially cut off
  // If summary is very long, CSS will handle wrapping and page breaks
  if (out.data.summary.content && out.data.summary.content.length > 2000) {
    Logger.log(`NOTE: Summary is ${out.data.summary.content.length} chars (no truncation, CSS will handle wrapping)`);
  }
  
  // Clean up summary formatting for PDF
  if (out.data.summary.content) {
    // Remove excessive whitespace and normalize line breaks
    out.data.summary.content = out.data.summary.content
      .replace(/\s+/g, ' ')           // Multiple spaces → single space
      .replace(/\n\s*\n/g, '\n')      // Multiple newlines → single newline  
      .trim();
  }

  // 3) EXPERIENCE
  const expSection = (out.data.sections.experience || {});
  const expItemsTemplate = (expSection.items && expSection.items[0]) ? expSection.items[0] : null;
  const expPatch = dsJsonOnly_(
    dsKey,
    buildItemsPrompt_('experience', resumeText, expItemsTemplate, {
      requiredFields: ['company', 'position', 'location', 'period', 'description'],
      itemCountHint: 8
    })
  );
  applyItemsPatch_(out, 'experience', expPatch, expItemsTemplate);

  // 4) EDUCATION
  const eduSection = (out.data.sections.education || {});
  const eduItemsTemplate = (eduSection.items && eduSection.items[0]) ? eduSection.items[0] : null;
  const eduPatch = dsJsonOnly_(
    dsKey,
    buildItemsPrompt_('education', resumeText, eduItemsTemplate, {
      requiredFields: ['school', 'degree', 'area', 'location', 'period', 'description'],
      itemCountHint: 5
    })
  );
  applyItemsPatch_(out, 'education', eduPatch, eduItemsTemplate);

  // 5) SKILLS - Limit to 3-4 most important/relevant skills
  const skillsSection = (out.data.sections.skills || {});
  const skillsItemsTemplate = (skillsSection.items && skillsSection.items[0]) ? skillsSection.items[0] : null;
  const skillsPatch = dsJsonOnly_(
    dsKey,
    buildItemsPrompt_('skills', resumeText, skillsItemsTemplate, {
      requiredFields: ['name', 'keywords'],
      itemCountHint: 4,
      maxItems: 4,
      prioritize: true
    })
  );
  applyItemsPatch_(out, 'skills', skillsPatch, skillsItemsTemplate);
  
  // Limit skills array to maximum 4 items if more were generated
  if (out.data.sections.skills && Array.isArray(out.data.sections.skills.items) && out.data.sections.skills.items.length > 4) {
    out.data.sections.skills.items = out.data.sections.skills.items.slice(0, 4);
  }
  
  // Ensure each skill has keywords as an array
  if (out.data.sections.skills && out.data.sections.skills.items) {
    out.data.sections.skills.items.forEach((skill, idx) => {
      if (!skill.keywords || !Array.isArray(skill.keywords)) {
        Logger.log(`WARNING: Skill ${idx} (${skill.name}) has invalid keywords, fixing...`);
        skill.keywords = [];
      }
      
      // Ensure keywords are strings
      skill.keywords = skill.keywords.map(k => String(k || '').trim()).filter(k => k.length > 0);
    });
  }

  // 6) CERTIFICATIONS (optional)
  const certSection = (out.data.sections.certifications || {});
  const certItemsTemplate = (certSection.items && certSection.items[0]) ? certSection.items[0] : null;
  if (certItemsTemplate) {
    const certPatch = dsJsonOnly_(
      dsKey,
      buildItemsPrompt_('certifications', resumeText, certItemsTemplate, {
        requiredFields: ['title', 'issuer', 'date', 'description'],
        itemCountHint: 8
      })
    );
    applyItemsPatch_(out, 'certifications', certPatch, certItemsTemplate);
  }

  // 7) LANGUAGES (optional)
  const langSection = (out.data.sections.languages || {});
  const langItemsTemplate = (langSection.items && langSection.items[0]) ? langSection.items[0] : null;
  if (langItemsTemplate) {
    const langPatch = dsJsonOnly_(
      dsKey,
      buildItemsPrompt_('languages', resumeText, langItemsTemplate, {
        requiredFields: ['language', 'fluency'],
        itemCountHint: 5
      })
    );
    applyItemsPatch_(out, 'languages', langPatch, langItemsTemplate);
  }

  // Apply layout-aware content constraints before validation
  applyLayoutAwareConstraints_(out);
  
  validateAndHardenForImport_(out);
  return out;
}

/* =========================================================
 * Calculate smart layout decision based on summary length
 * ======================================================= */
function calculateSmartLayout_(root) {
  const summary = root.data.summary?.content || '';
  const summaryChars = summary.length;
  
  // Check if skills exist for sidebar
  const hasSkills = root.data.sections?.skills?.items && 
                    Array.isArray(root.data.sections.skills.items) && 
                    root.data.sections.skills.items.length > 0;
  
  // Estimate lines based on layout mode
  // Two-column layout (with sidebar): narrower main column ≈ 40 chars per line (realistic for template)
  // Full-width layout: wider main column ≈ 70 chars per line (realistic for template)
  const charsPerLine = hasSkills ? 40 : 70;
  const estimatedSummaryLines = Math.ceil(summaryChars / charsPerLine);
  
  // Threshold: if summary uses more than ~14 lines, it leaves <8-12 lines for Experience start
  // This prevents orphaned Experience section headers
  const maxSummaryLinesForPage1 = 14;
  
  return {
    summaryFitsOnPage1: estimatedSummaryLines <= maxSummaryLinesForPage1,
    estimatedSummaryLines: estimatedSummaryLines,
    hasSidebar: hasSkills
  };
}

/* =========================================================
 * Layout-aware content constraints
 * ======================================================= */
function applyLayoutAwareConstraints_(root) {
  if (!root.data || !root.data.metadata || !root.data.metadata.layout) return;
  
  const pages = root.data.metadata.layout.pages;
  if (!Array.isArray(pages) || pages.length === 0) return;
  
  const firstPage = pages[0];
  if (!firstPage) return;
  
  // Detect layout mode: fullWidth vs two-column
  const isFullWidth = firstPage.fullWidth === true || 
                      !firstPage.sidebar || 
                      (Array.isArray(firstPage.sidebar) && firstPage.sidebar.length === 0);
  
  // Apply constraints based on layout mode
  // NOTE: Summary is preserved verbatim - no truncation. Smart layout handles page placement.
  
  // Cap skill keywords if sidebar is present on page 1
  if (!isFullWidth && firstPage.sidebar && Array.isArray(firstPage.sidebar) && firstPage.sidebar.includes('skills')) {
    if (root.data.sections && root.data.sections.skills && root.data.sections.skills.items) {
      for (const skill of root.data.sections.skills.items) {
        if (skill.keywords && Array.isArray(skill.keywords)) {
          // Limit to 4-6 keywords per skill
          if (skill.keywords.length > 6) {
            skill.keywords = skill.keywords.slice(0, 6);
          }
          // Ensure each keyword is short (max 40 chars)
          skill.keywords = skill.keywords.map(kw => {
            if (typeof kw === 'string' && kw.length > 40) {
              return kw.substring(0, 37) + '...';
            }
            return kw;
          });
        }
      }
    }
  }
}

/* =========================================================
 * Prompt builders (strict JSON-only)
 * ======================================================= */
function buildBasicsPrompt_(resumeText, currentBasicsObj) {
  return `
You are extracting contact and personal information from a resume.

TASK:
Extract the basics section information: name, email, phone, location, headline.

INPUTS:
- Resume text (source of truth)
- Current template basics (preserve unknown fields)

RULES:
- Output MUST be valid JSON and NOTHING ELSE (no markdown, no commentary).
- Output MUST be an object with only these keys: name, email, phone, location, headline.
- Extract the actual name from the resume (not "Your Name" or placeholders).
- Extract the actual email address if present.
- Extract the actual phone number if present.
- Extract the actual location (city, state, or address) if present - preserve the exact format as written.
- Extract a professional headline if present, or leave as empty string - preserve the exact wording if present.
- PRESERVE ORIGINAL LANGUAGE: Use exact wording and formatting from the resume text. Do NOT modify or paraphrase.
- Do NOT invent information not in the resume text.
- If a field isn't present in the resume, use empty string "".

CURRENT TEMPLATE BASICS (preserve structure but replace placeholder values):
${JSON.stringify(currentBasicsObj || {}, null, 2)}

RESUME TEXT:
${resumeText}

Return JSON ONLY with extracted values.
`.trim();
}

function buildSectionPrompt_(sectionName, resumeText, currentSectionObj, allowedKeys, opts) {
  opts = opts || {};
  const maxChars = opts.maxChars || 0;

  // Special handling for summary section - VERBATIM EXTRACTION ONLY
  const isSummary = sectionName === 'summary';
  const summaryInstructions = isSummary ? `
SUMMARY EXTRACTION RULES (ABSOLUTE - VERBATIM MODE):
- Your job is NOT to write a summary. You are ONLY copying text.
- Extract the Summary section text VERBATIM from the provided resume text.
- Output summary.content must match the source character-for-character except you may replace line breaks with single spaces.
- Do NOT add, delete, reorder, paraphrase, or "improve" any words.
- Do NOT tailor, optimize, or rewrite the summary.
- Preserve exact wording, phrasing, terminology, and sentence structure.
- If you cannot find an explicit Summary section, return an empty string.
- Output summary.content as ONE single-line paragraph string (replace line breaks with spaces).
- NO bullet characters in output.
- This is extraction, not generation.` : '';

  return `
You are transforming a plain-text resume into a Reactive Resume JSON template.

TASK:
Fill ONLY the "${sectionName}" section.

INPUTS:
- Resume text (source of truth)
- Current template fragment (preserve unknown fields)
- Allowed keys: ${JSON.stringify(allowedKeys)}

RULES:
- Output MUST be valid JSON and NOTHING ELSE (no markdown, no commentary).
- Output MUST be an object with only allowed keys (plus nested objects already present like website).
- PRESERVE ORIGINAL LANGUAGE: Use the exact wording, phrasing, and terminology from the resume text. Do NOT paraphrase, summarize, or rewrite unless absolutely necessary for formatting.
- Do NOT invent degrees, employers, dates, titles, credentials, certifications, or metrics not in the resume text.
- If a field isn't present in the resume, use empty string "" (or empty object where appropriate).
- When extracting text content (like descriptions, summaries), preserve the original sentence structure, technical terms, and professional language exactly as written.
${summaryInstructions}

CURRENT TEMPLATE FRAGMENT (do not delete keys you don't change):
${JSON.stringify(currentSectionObj || {}, null, 2)}

RESUME TEXT:
${resumeText}

Return JSON ONLY.
`.trim();
}

function buildItemsPrompt_(sectionName, resumeText, itemTemplate, cfg) {
  cfg = cfg || {};
  const requiredFields = cfg.requiredFields || [];
  const itemCountHint = cfg.itemCountHint || 8;
  const maxItems = cfg.maxItems || itemCountHint;
  const prioritize = cfg.prioritize || false;

  let selectionInstructions = '';
  if (prioritize && sectionName === 'skills') {
    selectionInstructions = `
SELECTION PRIORITY (for skills):
- Select ONLY the ${maxItems} most important and relevant skills.
- Prioritize skills that are:
  1. Most relevant to the target role/industry
  2. Most prominently featured in the resume
  3. Most technical or specialized
  4. Most recent or current
- Group related skills together when possible (e.g., "Data Analysis" with keywords like "Python, SQL, Excel").
- DO NOT exceed ${maxItems} items total.
SKILLS FORMAT RULES (CRITICAL):
- Each skill name must be a noun or noun phrase (1-4 words maximum).
- Each keyword must be a noun or noun phrase (1-4 words maximum).
- NO commas, NO periods, NO sentences, NO verbs.
- Do not repeat concepts already implied by another skill.
- Limit to 4-6 keywords per skill category.
- Example: {"name": "Data Analysis", "keywords": ["Python", "SQL", "Excel"]} NOT {"name": "I can analyze data using", "keywords": ["I use Python, SQL, and Excel for data analysis."]}`;
  } else if (maxItems && maxItems < itemCountHint) {
    selectionInstructions = `\n- IMPORTANT: Return EXACTLY ${maxItems} items (or fewer if not enough are available). Do NOT exceed ${maxItems} items.`;
  }

  // Special formatting for experience items: description as array
  const isExperience = sectionName === 'experience';
  const descriptionFormat = isExperience ? `
- DESCRIPTION FORMAT (CRITICAL - EXPERIENCE ONLY): 
  * description MUST be a string[] (array of strings)
  * Extract exactly 3 bullet points per job, word-for-word from the source resume
  * Find lines in the resume that start with bullet characters (• or *). Strip ONLY the leading bullet character and space
  * CRITICAL: Preserve the EXACT wording, phrasing, grammar, punctuation, and terminology from the source resume
  * Do NOT fix grammar, do NOT improve wording, do NOT paraphrase, rewrite, or summarize
  * Do NOT add or remove commas, periods, or any punctuation - copy text EXACTLY as it appears
  * NO bullet characters (• or *) in the array elements
  * NO newline characters (\\n) in the array elements
  * Each array element is plain text, verbatim from the resume
  * Example format: {"description": ["Provide administrative and business analysis support to the Office of the Chief Security Officer (OCSO).", "Review, edit, and create reference materials, policies, and procedures.", "Conduct interviews, surveys, and workshops to gather business requirements."]}
  * If a job has fewer than 3 bullets in the source, extract all available bullets. If it has more than 3, extract the first 3
  * The renderer will add bullet formatting automatically - you only need to provide the text content as an array` : `
- For description field, use a string if that's what the template expects.`;

  return `
You are transforming a plain-text resume into a Reactive Resume JSON template.

TASK:
Extract the "${sectionName}" entries as an ARRAY of item objects.

RULES (CRITICAL):
- Output MUST be valid JSON and NOTHING ELSE.
- Output MUST be a JSON object in this exact shape:
  {"items":[ {...}, {...} ]}
- Each item MUST include these fields: ${JSON.stringify(requiredFields)}
- Only include information grounded in the resume text.
- PRESERVE ORIGINAL LANGUAGE: Use the exact wording, phrasing, grammar, punctuation, and terminology from the resume text. Do NOT paraphrase, summarize, rewrite, or "improve" descriptions, bullet points, or any text content. Copy the original language verbatim.
- CRITICAL: Do NOT fix grammar, do NOT improve wording, do NOT add or remove punctuation. Copy text EXACTLY as it appears in the source resume, including any grammar "errors" or stylistic choices.
- For descriptions and text fields, preserve the original sentence structure, technical terms, professional language, grammar, punctuation, and formatting exactly as written in the resume.${descriptionFormat}
- Prefer fewer, higher-quality entries. Aim for up to ${itemCountHint} items.${selectionInstructions}
- Preserve original wording exactly - do not make them more concise unless they exceed reasonable length.
- DO NOT fabricate websites/urls.
- Do NOT include "id" or "hidden" unless they already exist in the provided item template.

ITEM TEMPLATE (match field names and nested shapes):
${JSON.stringify(itemTemplate || {}, null, 2)}

RESUME TEXT:
${resumeText}

Return JSON ONLY:
{"items":[ ... ]}
`.trim();
}

/* =========================================================
 * DeepSeek JSON-only call
 * ======================================================= */
function dsJsonOnly_(apiKey, userPrompt) {
  const payload = {
    model: DS_MODEL,
    temperature: DS_TEMPERATURE,
    messages: [
      { role: "system", content: "You output ONLY valid JSON. No markdown. No explanations." },
      { role: "user", content: userPrompt }
    ]
  };

  const txt = dsCallRaw_(payload, apiKey);
  const cleaned = stripJsonFences_(txt);

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // One retry: ask model to repair JSON strictly
    const repairPayload = {
      model: DS_MODEL,
      temperature: 0.1,
      messages: [
        { role: "system", content: "Repair the JSON. Output ONLY valid JSON. No markdown." },
        { role: "user", content: `Fix this into valid JSON ONLY:\n\n${txt}` }
      ]
    };
    const repaired = stripJsonFences_(dsCallRaw_(repairPayload, apiKey));
    return JSON.parse(repaired);
  }
}

function stripJsonFences_(s) {
  let t = String(s || '').trim();
  t = t.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  return t;
}

function dsCallRaw_(payload, apiKey) {
  const resp = UrlFetchApp.fetch(DS_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload)
  });

  const code = resp.getResponseCode();
  const body = resp.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error('DeepSeek HTTP ' + code + ': ' + body.substring(0, 800));
  }

  const data = JSON.parse(body);
  const content = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!content) throw new Error('DeepSeek returned empty content');
  return content;
}

/* =========================================================
 * Apply patches while preserving template structure
 * ======================================================= */
function applyBasicsPatch_(root, patch) {
  if (!patch || typeof patch !== 'object') return;
  root.data.basics = root.data.basics || {};
  const allowed = new Set(['name','headline','email','phone','location','website','customFields']);
  for (const k of Object.keys(patch)) {
    if (!allowed.has(k)) continue;
    root.data.basics[k] = patch[k];
  }
}

function applySummaryPatch_(root, patch) {
  if (!patch || typeof patch !== 'object') {
    Logger.log('WARNING: applySummaryPatch_ received invalid patch: ' + JSON.stringify(patch));
    return;
  }
  
  root.data.summary = root.data.summary || {};
  
  // Log what we received from AI
  Logger.log('Summary patch received: ' + JSON.stringify({
    hasContent: typeof patch.content === 'string',
    contentLength: typeof patch.content === 'string' ? patch.content.length : 0,
    contentPreview: typeof patch.content === 'string' ? patch.content.substring(0, 100) : 'N/A',
    hasTitle: typeof patch.title === 'string',
    title: typeof patch.title === 'string' ? patch.title : 'N/A',
    patchKeys: Object.keys(patch)
  }));
  
  // Validate and apply content - only apply if non-empty
  // CRITICAL: Use VERBATIM normalization - only whitespace, no bullet/hyphen logic
  if (typeof patch.content === 'string') {
    const trimmedContent = patch.content.trim();
    if (trimmedContent.length > 0) {
      // VERBATIM MODE: Only normalize whitespace, preserve all words exactly
      // This prevents the "- functional" bug by never running bullet/hyphen logic on summary
      const normalizedContent = normalizeSummaryVerbatim_(trimmedContent);
      root.data.summary.content = normalizedContent;
      Logger.log('Summary content applied (verbatim normalized): ' + normalizedContent.substring(0, 100) + '...');
    } else {
      Logger.log('WARNING: Summary patch content is empty after trim');
    }
  } else {
    Logger.log('WARNING: Summary patch content is not a string: ' + typeof patch.content);
  }
  
  // Handle title field if present
  if (typeof patch.title === 'string') {
    root.data.summary.title = patch.title.trim();
  }
  
  // Final check - log final state
  Logger.log('Summary after patch application: ' + JSON.stringify({
    hasContent: root.data.summary.content && root.data.summary.content.trim().length > 0,
    contentLength: root.data.summary.content ? root.data.summary.content.length : 0,
    title: root.data.summary.title || 'N/A'
  }));
}

function applyItemsPatch_(root, sectionKey, patch, itemTemplate) {
  Logger.log(`=== applyItemsPatch_ START: sectionKey=${sectionKey} ===`);
  
  if (!patch || typeof patch !== 'object') {
    Logger.log(`applyItemsPatch_: Invalid patch, returning early`);
    return;
  }
  
  const items = Array.isArray(patch.items) ? patch.items : [];
  Logger.log(`applyItemsPatch_: Processing ${items.length} items`);
  
  if (!root.data.sections) root.data.sections = {};
  if (!root.data.sections[sectionKey]) root.data.sections[sectionKey] = {};
  root.data.sections[sectionKey].items = [];

  const isExperience = sectionKey === 'experience';
  
  // Check template shape: does template expect description as array?
  const templateExpectsArray = itemTemplate && 
                               itemTemplate.description !== undefined && 
                               Array.isArray(itemTemplate.description);
  
  // Log template structure
  Logger.log(`Template structure for ${sectionKey}:`);
  Logger.log(`  Template has description: ${itemTemplate?.description !== undefined}`);
  Logger.log(`  Template description type: ${typeof itemTemplate?.description}`);
  Logger.log(`  Template description isArray: ${Array.isArray(itemTemplate?.description)}`);
  Logger.log(`  Template has highlights: ${itemTemplate?.highlights !== undefined}`);
  Logger.log(`  Template highlights type: ${typeof itemTemplate?.highlights}`);
  Logger.log(`  Template has summary: ${itemTemplate?.summary !== undefined}`);
  Logger.log(`  Template expects array: ${templateExpectsArray}`);

  for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
    const src = items[itemIdx];
    if (!src || typeof src !== 'object') {
      Logger.log(`  Item ${itemIdx}: Skipping invalid item`);
      continue;
    }

    const itemCompany = src.company || src.position || `Item ${itemIdx}`;
    Logger.log(`  Processing item ${itemIdx}: ${itemCompany}`);
    
    const base = itemTemplate ? JSON.parse(JSON.stringify(itemTemplate)) : {};

    if (base.id !== undefined) base.id = Utilities.getUuid();
    if (base.hidden !== undefined && typeof base.hidden !== 'boolean') base.hidden = false;

    // Log incoming data
    Logger.log(`    Incoming description type: ${typeof src.description}`);
    Logger.log(`    Incoming description isArray: ${Array.isArray(src.description)}`);
    if (typeof src.description === 'string') {
      Logger.log(`    Incoming description preview: ${src.description.substring(0, 100)}`);
    } else if (Array.isArray(src.description)) {
      Logger.log(`    Incoming description array length: ${src.description.length}`);
      Logger.log(`    Incoming description array preview: ${JSON.stringify(src.description.slice(0, 2))}`);
    }

    deepCopyKnownKeys_(base, src);
    
    // CRITICAL: Normalize description shape to match template expectations
    // For experience items OR if template expects array, ALWAYS convert to array
    // This MUST happen AFTER deepCopyKnownKeys_ but BEFORE normalizeStringsDeep_
    if (isExperience || templateExpectsArray) {
      Logger.log(`    Normalizing description for ${isExperience ? 'experience' : 'template-array'} item`);
      // Always ensure description exists and is an array for experience items
      if (base.description === undefined || base.description === null) {
        Logger.log(`    Description was undefined/null, setting to empty array`);
        base.description = [];
      } else if (Array.isArray(base.description)) {
        Logger.log(`    Description is already array (length: ${base.description.length}), cleaning elements`);
        // Already an array - clean each element (remove bullet characters, trim)
        base.description = base.description.map(bullet => {
          if (typeof bullet === 'string') {
            // Remove bullet characters (• and * only, NOT hyphens) and normalize
            return bullet.replace(/^[\s]*[•*]\s*/, '').trim();
          }
          return String(bullet || '').trim();
        }).filter(b => b.length > 0);
        Logger.log(`    Cleaned array: ${base.description.length} bullets after cleaning`);
      } else if (typeof base.description === 'string') {
        Logger.log(`    Converting string description to array`);
        // String description - split into array
        // This handles cases where AI returns string instead of array
        let descStr = base.description.trim();
        if (!descStr) {
          Logger.log(`    Empty string, setting to empty array`);
          base.description = [];
        } else {
          Logger.log(`    Splitting string (length: ${descStr.length})`);
          // Split by newlines first (most common case)
          let bullets = descStr.split(/\n+/);
          Logger.log(`    After newline split: ${bullets.length} segments`);
          
          // If no newlines, try splitting by bullet patterns (• and * only, NOT hyphens)
          if (bullets.length === 1) {
            Logger.log(`    No newlines found, trying bullet pattern split`);
            // Look for real bullet characters (• and *) in the string
            bullets = descStr.split(/(?=[•*])\s*/);
            Logger.log(`    After bullet pattern split: ${bullets.length} segments`);
          }
          
          // Clean each bullet: remove bullet characters (• and * only), trim, filter empty
          bullets = bullets.map(b => {
            // Remove leading bullet characters (• and * only, NOT hyphens)
            b = b.replace(/^[\s]*[•*]\s*/, '');
            // Remove any trailing bullet characters (• and * only)
            b = b.replace(/[\s]*[•*]\s*$/, '');
            return b.trim();
          }).filter(b => b.length > 0);
          
          Logger.log(`    After cleaning: ${bullets.length} valid bullets`);
          
          // Always set as array (even if single item) to match template expectation
          base.description = bullets.length > 0 ? bullets : [descStr];
          
          // Validation: Log warning if experience item has fewer than expected bullets
          if (isExperience && bullets.length > 0 && bullets.length < 3) {
            Logger.log(`    WARNING: Experience item has ${bullets.length} bullets (expected 3)`);
          }
        }
      } else {
        Logger.log(`    Description is neither string nor array (type: ${typeof base.description}), setting to empty array`);
        // Not string or array - convert to empty array
        base.description = [];
      }
      
      Logger.log(`    Final description: type=${typeof base.description}, isArray=${Array.isArray(base.description)}`);
      if (Array.isArray(base.description)) {
        Logger.log(`    Final description array length: ${base.description.length}`);
        Logger.log(`    Final description bullets: ${JSON.stringify(base.description)}`);
      }
    }
    
    // CRITICAL: For experience items, also populate highlights field if template has it
    // Some templates use highlights instead of (or in addition to) description
    if (isExperience && base.description && Array.isArray(base.description)) {
      if (itemTemplate && itemTemplate.highlights !== undefined) {
        Logger.log(`    Template has highlights field, populating with description array`);
        // Template expects highlights - copy the same bullet array
        base.highlights = base.description.slice(); // Copy array
        Logger.log(`    Highlights populated: length=${base.highlights.length}`);
      } else {
        Logger.log(`    Template does not have highlights field`);
      }
    }
    
    // Normalize strings, but skip description for experience items (it's an array)
    normalizeStringsDeep_(base, sectionKey);
    
    // CRITICAL: Final safety check - ensure description is array if template expects it
    // This protects against normalizeStringsDeep_ accidentally converting it back
    if (isExperience || templateExpectsArray) {
      if (base.description === undefined || base.description === null || !Array.isArray(base.description)) {
        // Something converted it back to string - reconvert
        const descStr = String(base.description || '').trim();
        if (descStr) {
          // Split and clean (• and * only, NOT hyphens)
          let bullets = descStr.split(/\n+/);
          if (bullets.length === 1 && /[•*]/.test(descStr)) {
            bullets = descStr.split(/(?=[•*])\s*/);
          }
          bullets = bullets.map(b => {
            // Remove bullet characters (• and * only, NOT hyphens)
            b = b.replace(/^[\s]*[•*]\s*/, '').replace(/[\s]*[•*]\s*$/, '');
            return b.trim();
          }).filter(b => b.length > 0);
          base.description = bullets.length > 0 ? bullets : [descStr];
        } else {
          base.description = [];
        }
      }
    }

    root.data.sections[sectionKey].items.push(base);
  }
}

function deepCopyKnownKeys_(dst, src) {
  for (const k of Object.keys(dst)) {
    if (!(k in src)) continue;

    const dv = dst[k];
    const sv = src[k];

    if (dv && typeof dv === 'object' && !Array.isArray(dv) &&
        sv && typeof sv === 'object' && !Array.isArray(sv)) {
      deepCopyKnownKeys_(dv, sv);
    } else if (Array.isArray(dv) && Array.isArray(sv)) {
      dst[k] = sv;
    } else {
      dst[k] = sv;
    }
  }

  // Allow common RR fields even if template is minimal
  const allowExtras = [
    'company','position','location','period','description',
    'school','degree','area','grade',
    'name','keywords',
    'language','fluency',
    'title','issuer','date',
    'publisher','organization'
  ];
  for (const k of allowExtras) {
    if (k in src && !(k in dst)) dst[k] = src[k];
  }
}

/* =========================================================
 * Schema definition for Reactive Resume API validation
 * ======================================================= */
const REACTIVE_RESUME_SCHEMA = {
  data: {
    picture: {
      url: { type: 'string', default: '' },
      size: { type: 'number', default: 200 },
      aspectRatio: { type: 'number', default: 1 },
      borderRadius: { type: 'number', default: 0 },
      hidden: { 
        type: 'boolean', 
        default: function(obj) { 
          // Hide if no URL exists
          return !(obj.url && String(obj.url).trim()); 
        }
      },
      rotation: { type: 'number', default: 0 },
      borderColor: { type: 'string', default: '' },
      borderWidth: { type: 'number', default: 0 },
      shadowColor: { type: 'string', default: '' },
      shadowWidth: { type: 'number', default: 0 },
      effects: {
        hidden: { type: 'boolean', default: false },
        border: { type: 'boolean', default: false },
        grayscale: { type: 'boolean', default: false }
      }
    },
    summary: {
      title: { type: 'string', default: '' },
      content: { type: 'string', default: '' },
      columns: { type: 'number', default: 1 },
      hidden: { type: 'boolean', default: false }
    },
    sections: {
      profiles: {
        title: { type: 'string', default: 'Profiles' },
        columns: { type: 'number', default: 1 }
      },
      // Dynamic section titles - will be handled separately
      _sectionTitle: { type: 'string', default: function(sectionKey) { 
        // Capitalize first letter of section key as default title
        return sectionKey.charAt(0).toUpperCase() + sectionKey.slice(1);
      }}
    }
  }
};

/* =========================================================
 * Schema-driven field validation
 * ======================================================= */
function ensureSchemaFields_(root, schema, path) {
  path = path || [];
  
  if (!schema || typeof schema !== 'object') return;
  
  for (const key in schema) {
    if (key.startsWith('_')) continue; // Skip special keys like _sectionTitle
    
    const fieldDef = schema[key];
    const currentPath = path.concat(key);
    
    // Navigate to the current location in root
    let current = root;
    for (let i = 0; i < currentPath.length - 1; i++) {
      if (!current[currentPath[i]]) {
        current[currentPath[i]] = {};
      }
      current = current[currentPath[i]];
    }
    const fieldName = currentPath[currentPath.length - 1];
    
    // Check if this is a nested schema (object without type property, but with child field definitions)
    // Example: effects: { hidden: { type: 'boolean', default: false }, ... }
    const isNestedSchema = !fieldDef.type && 
                          typeof fieldDef === 'object' && 
                          !Array.isArray(fieldDef) &&
                          !fieldDef.call;
    
    if (isNestedSchema) {
      // It's a nested schema object (like effects: { hidden: {...}, border: {...} })
      // First ensure the parent object exists
      if (!current[fieldName] || typeof current[fieldName] !== 'object' || Array.isArray(current[fieldName])) {
        current[fieldName] = {};
      }
      // Recursively process nested schema fields
      ensureSchemaFields_(current[fieldName], fieldDef, currentPath);
    } else {
      // Handle fields with type definitions
      const expectedType = fieldDef.type;
      const currentValue = current[fieldName];
      const hasValue = currentValue !== undefined && currentValue !== null;
      
      // Check if field exists and has correct type
      let needsDefault = false;
      
      if (!hasValue) {
        needsDefault = true;
      } else if (expectedType === 'boolean' && typeof currentValue !== 'boolean') {
        needsDefault = true;
      } else if (expectedType === 'number' && typeof currentValue !== 'number') {
        needsDefault = true;
      } else if (expectedType === 'string' && typeof currentValue !== 'string') {
        needsDefault = true;
      } else if (expectedType === 'object' && (typeof currentValue !== 'object' || Array.isArray(currentValue))) {
        needsDefault = true;
      } else if (expectedType === 'array' && !Array.isArray(currentValue)) {
        needsDefault = true;
      }
      
      if (needsDefault) {
        if (typeof fieldDef.default === 'function') {
          // Conditional default - pass the parent object for context
          current[fieldName] = fieldDef.default(current);
        } else {
          current[fieldName] = fieldDef.default;
        }
      }
      
      // After setting default, if it's an object type, check for nested schema in the default value
      if (expectedType === 'object' && current[fieldName] && typeof current[fieldName] === 'object') {
        // Check if the default value contains nested field definitions
        const defaultValue = fieldDef.default;
        if (defaultValue && typeof defaultValue === 'object' && !defaultValue.type && !Array.isArray(defaultValue)) {
          let hasNestedFields = false;
          for (const k in defaultValue) {
            if (defaultValue[k] && typeof defaultValue[k] === 'object' && defaultValue[k].type) {
              hasNestedFields = true;
              break;
            }
          }
          if (hasNestedFields) {
            // The default object contains nested field definitions, process them
            ensureSchemaFields_(current[fieldName], defaultValue, currentPath);
          }
        }
      }
    }
  }
}

/* =========================================================
 * Validate/harden final object for import
 * ======================================================= */
function validateAndHardenForImport_(root) {
  if (!root.data) throw new Error('Final JSON missing "data"');

  // BASICS - preserve existing special handling
  if (!root.data.basics) root.data.basics = {};

  // website must be an object with url/label strings (RxResume validator)
  if (!root.data.basics.website || typeof root.data.basics.website !== 'object') {
    root.data.basics.website = { url: '', label: '' };
  } else {
    if (typeof root.data.basics.website.url !== 'string') root.data.basics.website.url = '';
    if (typeof root.data.basics.website.label !== 'string') root.data.basics.website.label = '';
  }

  // customFields must be an array
  if (!Array.isArray(root.data.basics.customFields)) root.data.basics.customFields = [];

  // Ensure sections object exists before schema validation
  if (!root.data.sections) root.data.sections = {};
  
  // CRITICAL: Preserve summary content BEFORE schema validation
  // Schema validation might overwrite it if we don't preserve it first
  let preservedSummaryContent = root.data.summary && root.data.summary.content ? String(root.data.summary.content) : null;
  let preservedSummaryTitle = root.data.summary && root.data.summary.title ? String(root.data.summary.title) : null;
  
  // Move summary from data.sections.summary to data.summary if it's in the wrong location
  if (root.data.sections && root.data.sections.summary && typeof root.data.sections.summary === 'object') {
    // Summary is in the wrong location - move it to data.summary
    Logger.log('Moving summary from data.sections.summary to data.summary');
    root.data.summary = root.data.sections.summary;
    delete root.data.sections.summary;
    // Update preserved values if we moved the summary
    if (root.data.summary.content) preservedSummaryContent = String(root.data.summary.content);
    if (root.data.summary.title) preservedSummaryTitle = String(root.data.summary.title);
  }
  
  // CRITICAL: Ensure summary is completely removed from sections (force delete if still present)
  if (root.data.sections && root.data.sections.summary !== undefined) {
    Logger.log('WARNING: Summary still exists in data.sections after move, force deleting');
    delete root.data.sections.summary;
  }
  
  // Verify summary is only in data.summary
  if (root.data.sections && root.data.sections.summary !== undefined) {
    throw new Error('Summary could not be removed from data.sections - this indicates a structural issue');
  }
  
  // Ensure summary has all required fields BEFORE schema validation
  // CRITICAL: Summary should be visible if it has content
  // ALWAYS create summary object - even if empty, it must exist for the API
  // NOTE: hidden property will be set once at the end after all content is finalized
  if (!root.data.summary || typeof root.data.summary !== 'object') {
    root.data.summary = { title: '', content: '', columns: 1 };
  }
  
  // Ensure all summary fields exist with correct types, but preserve existing content
  if (typeof root.data.summary.title !== 'string') {
    root.data.summary.title = preservedSummaryTitle || '';
  } else if (preservedSummaryTitle) {
    root.data.summary.title = preservedSummaryTitle;
  }
  if (typeof root.data.summary.content !== 'string') {
    root.data.summary.content = preservedSummaryContent || '';
  } else if (preservedSummaryContent) {
    // Restore preserved content if it was lost
    root.data.summary.content = preservedSummaryContent;
  }
  if (typeof root.data.summary.columns !== 'number') root.data.summary.columns = 1;
  
  // Apply schema-driven validation (this might overwrite summary, so we'll restore it after)
  ensureSchemaFields_(root, REACTIVE_RESUME_SCHEMA);
  
  // CRITICAL: Restore preserved summary content after schema validation
  // Schema validation might have overwritten it with empty defaults
  if (preservedSummaryContent && (!root.data.summary.content || root.data.summary.content.trim().length === 0)) {
    root.data.summary.content = preservedSummaryContent;
    Logger.log('Restored summary content after schema validation: ' + preservedSummaryContent.substring(0, 100) + '...');
  }
  if (preservedSummaryTitle && (!root.data.summary.title || root.data.summary.title.trim().length === 0)) {
    root.data.summary.title = preservedSummaryTitle;
  }
  
  // CRITICAL: Set summary hidden property ONCE at the end with consistent logic
  // This is the single source of truth for summary visibility
  // hidden = false if content exists, true if empty
  const hasContent = root.data.summary.content && root.data.summary.content.trim().length > 0;
  root.data.summary.hidden = !hasContent;
  Logger.log(`Summary hidden property set: ${root.data.summary.hidden} (hasContent: ${hasContent})`);
  
  // Summary content is now frozen - normalization already applied in applySummaryPatch_
  // Layout will be set up separately in layout creation logic

  // Ensure picture object exists with all required fields
  // Picture can be at data.picture or data.basics.picture - handle both
  let pictureObj = root.data.picture || root.data.basics?.picture;
  if (!pictureObj || typeof pictureObj !== 'object') {
    pictureObj = {};
  }
  
  // Normalize picture location to data.picture (API expects it here)
  const hasUrl = pictureObj.url && String(pictureObj.url).trim();
  root.data.picture = {
    url: pictureObj.url || '',
    size: pictureObj.size || 200,
    aspectRatio: pictureObj.aspectRatio || 1,
    borderRadius: pictureObj.borderRadius || 0,
    hidden: typeof pictureObj.hidden === 'boolean' ? pictureObj.hidden : !hasUrl,
    rotation: typeof pictureObj.rotation === 'number' ? pictureObj.rotation : 0,
    borderColor: typeof pictureObj.borderColor === 'string' ? pictureObj.borderColor : '',
    borderWidth: typeof pictureObj.borderWidth === 'number' ? pictureObj.borderWidth : 0,
    shadowColor: typeof pictureObj.shadowColor === 'string' ? pictureObj.shadowColor : '',
    shadowWidth: typeof pictureObj.shadowWidth === 'number' ? pictureObj.shadowWidth : 0,
    effects: pictureObj.effects && typeof pictureObj.effects === 'object' ? pictureObj.effects : { hidden: false, border: false, grayscale: false }
  };
  
  // Ensure all required picture fields exist with correct types (double-check after setting)
  if (typeof root.data.picture.url !== 'string') root.data.picture.url = '';
  if (typeof root.data.picture.size !== 'number') root.data.picture.size = 200;
  if (typeof root.data.picture.aspectRatio !== 'number') root.data.picture.aspectRatio = 1;
  if (typeof root.data.picture.borderRadius !== 'number') root.data.picture.borderRadius = 0;
  if (typeof root.data.picture.rotation !== 'number') root.data.picture.rotation = 0;
  if (typeof root.data.picture.borderColor !== 'string') root.data.picture.borderColor = '';
  if (typeof root.data.picture.borderWidth !== 'number') root.data.picture.borderWidth = 0;
  if (typeof root.data.picture.shadowColor !== 'string') root.data.picture.shadowColor = '';
  if (typeof root.data.picture.shadowWidth !== 'number') root.data.picture.shadowWidth = 0;
  const finalHasUrl = root.data.picture.url && String(root.data.picture.url).trim();
  if (typeof root.data.picture.hidden !== 'boolean') {
    root.data.picture.hidden = !finalHasUrl;
  }
  if (!root.data.picture.effects || typeof root.data.picture.effects !== 'object') {
    root.data.picture.effects = { hidden: false, border: false, grayscale: false };
  }
  
  // Ensure profiles section exists (required by API)
  if (!root.data.sections.profiles || typeof root.data.sections.profiles !== 'object') {
    root.data.sections.profiles = {
      title: 'Profiles',
      hidden: false,
      items: [],
      columns: 1
    };
  }
  
  // Ensure all section objects have required fields (title, hidden, items, columns)
  // CRITICAL: Preserve section structure to maintain colored section separation
  // Colored sections (like sidebar skills) are handled by layout.main vs layout.sidebar
  // Each section maintains its own structure for proper rendering in colored templates
  const sectionTitleMap = {
    experience: 'Experience',
    education: 'Education',
    skills: 'Skills',
    certifications: 'Certifications',
    languages: 'Languages',
    awards: 'Awards',
    publications: 'Publications',
    projects: 'Projects',
    interests: 'Interests',
    references: 'References',
    volunteer: 'Volunteer',
    profiles: 'Profiles'
  };
  
  for (const sectionKey in root.data.sections) {
    const section = root.data.sections[sectionKey];
    if (section && typeof section === 'object' && !Array.isArray(section)) {
      // Ensure title exists
      if (typeof section.title !== 'string') {
        section.title = sectionTitleMap[sectionKey] || 
                        sectionKey.charAt(0).toUpperCase() + sectionKey.slice(1);
      }
      
      // Ensure hidden field exists (boolean)
      if (typeof section.hidden !== 'boolean') {
        section.hidden = false;
      }
      
      // Ensure items array exists
      if (!Array.isArray(section.items)) {
        section.items = section.items ? [section.items] : [];
      }
      
      // Ensure columns field exists (number) - some sections may need this
      // Colored sections may use different column layouts, preserve template settings
      if (typeof section.columns !== 'number') {
        section.columns = 1;
      }
      
      // Ensure all items in the section have hidden field (required by API for some sections)
      if (Array.isArray(section.items)) {
        for (let i = 0; i < section.items.length; i++) {
          const item = section.items[i];
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            // Ensure hidden field exists and is boolean (API requires this for items)
            if (typeof item.hidden !== 'boolean') {
              item.hidden = false;
            }
          }
        }
      }
    }
  }
  
  // Auto-hide empty sections
  if (root.data.sections) {
    Object.keys(root.data.sections).forEach(sectionKey => {
      const section = root.data.sections[sectionKey];
      if (section && typeof section === 'object') {
        // If section has no items or empty items array, hide it
        if (!section.items || !Array.isArray(section.items) || section.items.length === 0) {
          section.hidden = true;
          Logger.log(`Auto-hiding empty section: ${sectionKey}`);
        }
      }
    });
  }

  // Normalize field names in section items (map template names to API-expected names)
  Logger.log(`=== validateAndHardenForImport_ START ===`);
  normalizeItemFieldNames_(root);

  // Ensure metadata exists with all required nested structures
  // CRITICAL: Preserve template name, theme, and all formatting metadata from template
  if (!root.data.metadata) root.data.metadata = {};
  
  // ==============================
  // FINAL, AUTHORITATIVE LAYOUT
  // ==============================
  // Single source of truth - no branching, no template preservation, no competing logic
  
  const page1Main = [];
  // Check if summary should be added - only if it has content and is not hidden
  if (root.data.summary?.content?.trim() && !root.data.summary?.hidden) {
    // Check if summary is already in page1Main (shouldn't happen, but prevent duplicates)
    if (!page1Main.includes('summary')) {
      page1Main.push('summary');
    } else {
      Logger.log('WARNING: Summary already in page1Main, skipping duplicate');
    }
  }
  if (root.data.sections.experience?.items?.length) {
    page1Main.push('experience'); // ALWAYS allow flow
  }
  
  const page1Sidebar = [];
  if (root.data.sections.skills?.items?.length) {
    page1Sidebar.push('skills');
  }
  
  // CRITICAL: Default to single-page layout - put everything on page 1
  // Only create page 2 if we have an exceptionally large amount of content
  
  // CRITICAL: Verify and enforce section order - Experience must come immediately after Summary
  // Reorder page1Main to ensure: summary, experience, education, certifications
  const correctOrder = ['summary', 'experience', 'education', 'certifications'];
  const orderedPage1Main = [];
  
  // Add sections in correct order
  for (const section of correctOrder) {
    if (page1Main.includes(section)) {
      orderedPage1Main.push(section);
    }
  }
  
  // Add any other sections that might exist (shouldn't happen, but be safe)
  for (const section of page1Main) {
    if (!correctOrder.includes(section) && !orderedPage1Main.includes(section)) {
      orderedPage1Main.push(section);
    }
  }
  
  page1Main.length = 0;
  page1Main.push(...orderedPage1Main);
  
  Logger.log(`Section order verified: page1Main = ${JSON.stringify(page1Main)}`);
  
  // Add education and certifications to page 1 by default (if not already added)
  if (root.data.sections.education?.items?.length && !page1Main.includes('education')) {
    // Find where to insert - after experience
    const expIndex = page1Main.indexOf('experience');
    if (expIndex !== -1) {
      page1Main.splice(expIndex + 1, 0, 'education');
    } else {
      page1Main.push('education');
    }
  }
  if (root.data.sections.certifications?.items?.length && !page1Main.includes('certifications')) {
    page1Main.push('certifications');
  }
  
  // Single layout page - let the renderer handle page breaks naturally
  // With breakLine: true, content will automatically flow to page 2 if needed (max 2 pages)
  const pages = [
    {
      fullWidth: false,
      main: page1Main,
      sidebar: page1Sidebar
    }
  ];
  
  root.data.metadata.layout = { pages: pages };
  
  Logger.log(`Layout: Single page entry - renderer will handle page breaks (breakLine: true). Main sections: ${JSON.stringify(page1Main)}, Sidebar: ${JSON.stringify(page1Sidebar)}`);
  
  // Ensure skills is never in main content, only in sidebar
  // Also deduplicate skills in sidebar arrays
  // Also deduplicate summary in main arrays (summary should only appear once)
  if (Array.isArray(root.data.metadata.layout.pages)) {
    root.data.metadata.layout.pages.forEach((page, pageIdx) => {
      if (page && typeof page === 'object') {
        // Remove skills from main content if it's there
        if (Array.isArray(page.main)) {
          const skillsIndex = page.main.indexOf('skills');
          if (skillsIndex !== -1) {
            page.main.splice(skillsIndex, 1);
            Logger.log(`Removed skills from page ${pageIdx + 1} main content (skills should only be in sidebar)`);
          }
          
          // Deduplicate summary in main - keep only first occurrence
          const summaryIndices = [];
          page.main.forEach((section, idx) => {
            if (section === 'summary') {
              summaryIndices.push(idx);
            }
          });
          // If there are duplicates, remove all but the first one
          if (summaryIndices.length > 1) {
            // Remove from end to beginning to maintain indices
            for (let i = summaryIndices.length - 1; i > 0; i--) {
              page.main.splice(summaryIndices[i], 1);
            }
            Logger.log(`Removed ${summaryIndices.length - 1} duplicate summary entry/entries from page ${pageIdx + 1} main`);
          }
        }
        
        // Deduplicate skills in sidebar - keep only first occurrence
        if (Array.isArray(page.sidebar)) {
          const skillsIndices = [];
          page.sidebar.forEach((section, idx) => {
            if (section === 'skills') {
              skillsIndices.push(idx);
            }
          });
          // If there are duplicates, remove all but the first one
          if (skillsIndices.length > 1) {
            // Remove from end to beginning to maintain indices
            for (let i = skillsIndices.length - 1; i > 0; i--) {
              page.sidebar.splice(skillsIndices[i], 1);
            }
            Logger.log(`Removed ${skillsIndices.length - 1} duplicate skills entry/entries from page ${pageIdx + 1} sidebar`);
          }
        }
      }
    });
  }
  
  // Ensure metadata.css exists with enabled and value
  // CRITICAL: Preserve template CSS and only add minimal fixes
  // CRITICAL: CSS must be enabled for our fixes to take effect
  if (!root.data.metadata.css || typeof root.data.metadata.css !== 'object') {
    root.data.metadata.css = { enabled: true, value: '' }; // Enable CSS by default
    Logger.log('Template styling: Created CSS object (was missing), enabled=true');
  } else {
    // Preserve template CSS - use marker-based patching to ensure our fixes always apply
    // CRITICAL: Always enable CSS to ensure our fixes are applied
    const wasEnabled = root.data.metadata.css.enabled === true;
    root.data.metadata.css.enabled = true;
    if (!wasEnabled) {
      Logger.log('Template styling: Enabled CSS (was disabled)');
    }
    const existingCss = root.data.metadata.css.value || '';
    
    const PATCH_START = '/* RR_PATCH_START */';
    const PATCH_END   = '/* RR_PATCH_END */';
    
    // Strip any previous version of our patch
    const stripped = existingCss.replace(
      new RegExp(`${PATCH_START}[\\s\\S]*?${PATCH_END}\\s*`, 'g'),
      ''
    );
    
    const minimalCss = `
${PATCH_START}
/* --- Remove all borders and outlines --- */
* {
  border: none !important;
  outline: none !important;
  box-shadow: none !important;
}

/* CRITICAL: Global text wrapping - ensure all text can wrap properly */
/* This must be at the top level to override any template defaults */
* {
  word-wrap: break-word !important;
  overflow-wrap: break-word !important;
  word-break: break-word !important;
}

/* --- Sidebar should paint to bottom of each printed page --- */
.page, [data-page] { 
  align-items: stretch !important;
  page-break-after: auto !important; /* Allow natural page breaks */
}
.page > *, [data-page] > * { align-self: stretch !important; }

/* ===== PRINT FRAGMENTATION FIX (stops huge blank gaps) ===== */
@media print {
  /* CRITICAL: Prevent orphaned blank pages */
  .page:last-child:empty,
  [data-page]:last-child:empty {
    display: none !important;
  }
  
  /* Prevent page breaks before the first item */
  .page:first-child,
  [data-page]:first-child {
    page-break-before: avoid !important;
  }
  
  /* Allow content to flow more naturally */
  body, html {
    orphans: 3 !important;
    widows: 3 !important;
  }
  
  /* CRITICAL: Flex items often won't fragment cleanly in Chromium print.
     Force the main column to block layout so sections can split across pages. */
  .page .main,
  [data-page] .main,
  .page [class*="main"],
  [data-page] [class*="main"] {
    display: block !important;
  }
  
  /* Make sections explicitly splittable/fragmentable */
  .section,
  .page .main > .section,
  [data-page] .main > .section {
    break-inside: auto !important;
    page-break-inside: auto !important;
  }
  
  /* Ensure no forced "keep together" behavior on headings/item headers */
  .section .heading,
  .section-header,
  .section > h2,
  .section > h3,
  h2, h3,
  .section[data-section="experience"] .item-header,
  .item-header,
  .item > .header {
    break-after: auto !important;
    page-break-after: auto !important;
    break-before: auto !important;
    page-break-before: auto !important;
  }
  
  /* Prevent an extra trailing blank page caused by page-break-after rules */
  .page:last-child,
  [data-page]:last-child {
    break-after: auto !important;
    page-break-after: auto !important;
  }
  
  /* Force sidebar to natural height in print - don't force 100% */
  .page .sidebar,
  [data-page] .sidebar,
  .page [class*="sidebar"],
  [data-page] [class*="sidebar"],
  .page [data-sidebar],
  [data-page] [data-sidebar] {
    height: auto !important;
    min-height: auto !important;
  }
  
  /* Also reset sidebar children */
  .page .sidebar > *, 
  [data-page] .sidebar > * {
    min-height: auto !important;
  }
}

/* Stretch the sidebar column - SCREEN ONLY (not print) */
@media screen {
  .page [class*="sidebar"],
  .page [data-sidebar],
  .page .sidebar,
  [data-page] [class*="sidebar"],
  [data-page] [data-sidebar],
  [data-page] .sidebar {
    height: 100% !important;
    min-height: 100% !important;
    align-self: stretch !important;
  }
}

/* --- Section spacing --- */
/* Section margins controlled by gapY for natural spacing between sections */
.section {
  margin: 0 !important;
  padding: 0 !important;
  /* margin-bottom controlled by gapY */
}

/* CRITICAL: Override page-level gapY spacing that creates large gaps */
.page > *,
[data-page] > * {
  margin-top: 0 !important;
  padding-top: 0 !important;
}

/* Section headers - natural spacing */
/* Allow natural page breaks - don't force sections to next page */
.section .heading,
.section-header,
.section > h2,
.section > h3,
h2, h3 {
  margin-top: 0 !important;
  margin-bottom: 6px !important; /* Tuned for good rhythm */
  padding: 0 !important;
  break-after: auto !important; /* Allow natural page breaks */
  page-break-after: auto !important; /* Allow natural page breaks */
}

/* All items - spacing between job items */
.section .item,
.item {
  margin: 0 !important;
  padding: 0 !important;
  margin-bottom: 10px !important; /* Natural spacing between items */
  break-inside: auto !important;
  page-break-inside: auto !important;
  orphans: 2 !important;
  widows: 2 !important;
}

/* Item headers - tight spacing */
.item-header,
.item > .header {
  margin: 0 !important;
  padding: 0 !important;
  margin-bottom: 2px !important;
}

/* CRITICAL: Allow experience items to break across pages when needed */
.section[data-section="experience"] .item {
  break-inside: auto !important;
  page-break-inside: auto !important;
  orphans: 1 !important;
  widows: 1 !important;
}

/* Allow item headers to break naturally - don't force page jumps */
.section[data-section="experience"] .item-header {
  break-after: auto !important; /* Allow natural breaks */
  page-break-after: auto !important; /* Allow natural breaks */
}

/* Allow description text to flow naturally across pages */
.section[data-section="experience"] .item .description {
  break-inside: auto !important;
  page-break-inside: auto !important;
  margin: 0 !important;
  padding: 0 !important;
}

/* Summary section - minimal spacing */
/* Allow page breaks - content can flow naturally across pages */
.section[data-section="summary"] {
  margin-bottom: 4px !important;
  padding-bottom: 0 !important;
}

.section[data-section="summary"] .content {
  margin: 0 !important;
  padding: 0 !important;
}

/* Experience section - allow page breaks */
/* Content can flow naturally across pages */
.section[data-section="experience"] {
  margin-top: 0 !important;
  padding-top: 0 !important;
}

/* Education section - tight spacing */
.section[data-section="education"] {
  margin-top: 0 !important;
  padding-top: 0 !important;
}

/* Skills section - tight spacing */
.section[data-section="skills"] {
  margin-top: 0 !important;
  padding-top: 0 !important;
}

.section[data-section="skills"] .item {
  margin-bottom: 6px !important; /* Tighter but readable spacing for skills */
}

/* Keep list formatting sane */
ul { margin: 0 !important; padding-left: 1.1em !important; list-style-type: disc !important; }
li { margin-bottom: 4px !important; display: list-item !important; }

/* CRITICAL: Text wrapping and overflow handling - prevent text cutoff */
/* Ensure all text content can wrap properly and flow across pages */
* {
  word-wrap: break-word !important;
  overflow-wrap: break-word !important;
  word-break: break-word !important;
}

/* Fix summary text rendering - prevent vertical character breaking */
.section[data-section="summary"] .content,
[data-section="summary"] .content {
  white-space: normal !important;
  overflow-wrap: break-word !important;
  word-wrap: break-word !important;
  word-break: break-word !important;
  text-overflow: clip !important; /* Don't use ellipsis - let text flow */
  overflow: visible !important; /* Allow text to flow, don't clip */
}

/* Ensure experience description strings render with newlines preserved */
/* CRITICAL: Allow text to wrap and flow - prevent truncation */
.section[data-section="experience"] .item .description,
[data-section="experience"] .item .description {
  display: block !important;
  white-space: pre-line !important;
  word-wrap: break-word !important;
  overflow-wrap: break-word !important;
  word-break: break-word !important;
  text-overflow: clip !important; /* Don't use ellipsis - let text flow */
  overflow: visible !important; /* Allow text to flow, don't clip */
  max-width: 100% !important; /* Ensure it doesn't overflow container */
}

.section[data-section="experience"] .item .description ul,
[data-section="experience"] .item .description ul {
  list-style-type: disc !important;
  margin-left: 1.2em !important;
  padding-left: 0.5em !important;
}

.section[data-section="experience"] .item .description li,
[data-section="experience"] .item .description li {
  display: list-item !important;
  margin-bottom: 3px !important;
}

/* CRITICAL: Control line-height to reduce excessive vertical spacing */
* {
  line-height: 1.3 !important; /* Reduced to 1.3 for tighter content to fit within 2 pages */
}

/* Specific line-height for text blocks */
p, .content, .description {
  line-height: 1.3 !important;
  margin: 0 !important;
  padding: 0 !important;
}

/* Section headings - tighter line-height */
h1, h2, h3, h4, h5, h6 {
  line-height: 1.2 !important;
  margin: 0 !important;
  padding: 0 !important;
}
${PATCH_END}
`;
    
    root.data.metadata.css.enabled = true;
    root.data.metadata.css.value = stripped.trim() + "\n\n" + minimalCss;
    
    // Log CSS application for debugging
    const cssLength = root.data.metadata.css.value.length;
    const hasPatch = root.data.metadata.css.value.includes(PATCH_START);
    Logger.log(`Template styling: CSS enabled=true, total length=${cssLength} chars, hasPatch=${hasPatch}`);
    
    // Verify CSS contains critical spacing rules
    const hasSectionSpacing = root.data.metadata.css.value.includes('margin-bottom: 6px !important');
    Logger.log(`CSS verification: hasSectionSpacing=${hasSectionSpacing}`);
  }
  
  // Preserve theme colors from template FIRST (before design, so design can use theme colors)
  // This is critical for colored templates
  if (!root.data.metadata.theme || typeof root.data.metadata.theme !== 'object') {
    // Only create default if completely missing
    root.data.metadata.theme = {
      primary: '#000000',
      text: '#000000',
      background: '#ffffff'
    };
    Logger.log('Template styling: Created default theme (template had no theme)');
  } else {
    // Preserve existing theme colors - only set defaults if truly missing
    const hadPrimary = typeof root.data.metadata.theme.primary === 'string';
    const hadText = typeof root.data.metadata.theme.text === 'string';
    const hadBackground = typeof root.data.metadata.theme.background === 'string';
    
    if (typeof root.data.metadata.theme.primary !== 'string') {
      root.data.metadata.theme.primary = '#000000';
    }
    if (typeof root.data.metadata.theme.text !== 'string') {
      root.data.metadata.theme.text = '#000000';
    }
    if (typeof root.data.metadata.theme.background !== 'string') {
      root.data.metadata.theme.background = '#ffffff';
    }
    
    if (hadPrimary && hadText && hadBackground) {
      Logger.log('Template styling: Preserved existing theme colors from template');
    } else {
      Logger.log(`Template styling: Preserved theme (had ${hadPrimary ? 'primary' : ''} ${hadText ? 'text' : ''} ${hadBackground ? 'background' : ''}), filled missing values`);
    }
  }
  
  // Ensure metadata.design exists with level and colors
  // Preserve existing design settings from template (colors, level, etc.)
  // Use theme colors as defaults if theme exists
  if (!root.data.metadata.design || typeof root.data.metadata.design !== 'object') {
    const theme = root.data.metadata.theme;
    root.data.metadata.design = { 
      level: { icon: 'circle', type: 'circle' }, 
      colors: {
        primary: (theme && typeof theme.primary === 'string' && theme.primary) ? theme.primary : '#000000',
        text: (theme && typeof theme.text === 'string' && theme.text) ? theme.text : '#000000',
        background: (theme && typeof theme.background === 'string' && theme.background) ? theme.background : '#ffffff'
      }
    };
    Logger.log('Template styling: Created default design (template had no design)');
  } else {
    const hadDesign = root.data.metadata.design && typeof root.data.metadata.design === 'object';
    Logger.log(`Template styling: Preserving existing design settings from template (hadDesign: ${hadDesign})`);
    // Only add missing nested objects - preserve existing design settings
    if (!root.data.metadata.design.level || typeof root.data.metadata.design.level !== 'object') {
      root.data.metadata.design.level = { icon: 'circle', type: 'circle' };
    } else {
      // Only set defaults if fields are missing - preserve existing values
      if (typeof root.data.metadata.design.level.icon !== 'string') root.data.metadata.design.level.icon = 'circle';
      // Only validate type if it's invalid - preserve valid existing values
      if (typeof root.data.metadata.design.level.type !== 'string' || 
          !['hidden', 'circle', 'square', 'rectangle', 'rectangle-full', 'progress-bar', 'icon'].includes(root.data.metadata.design.level.type)) {
        root.data.metadata.design.level.type = 'circle';
      }
    }
    if (!root.data.metadata.design.colors || typeof root.data.metadata.design.colors !== 'object') {
      // Use theme colors as defaults if theme exists, otherwise use black/white defaults
      const theme = root.data.metadata.theme;
      if (theme && typeof theme === 'object') {
        root.data.metadata.design.colors = {
          primary: (typeof theme.primary === 'string' && theme.primary) ? theme.primary : '#000000',
          text: (typeof theme.text === 'string' && theme.text) ? theme.text : '#000000',
          background: (typeof theme.background === 'string' && theme.background) ? theme.background : '#ffffff'
        };
      } else {
        root.data.metadata.design.colors = { primary: '#000000', text: '#000000', background: '#ffffff' };
      }
    } else {
      // Only set defaults if fields are missing - use theme colors if available, otherwise black/white
      const theme = root.data.metadata.theme;
      if (typeof root.data.metadata.design.colors.primary !== 'string') {
        root.data.metadata.design.colors.primary = (theme && typeof theme.primary === 'string' && theme.primary) ? theme.primary : '#000000';
      }
      if (typeof root.data.metadata.design.colors.text !== 'string') {
        root.data.metadata.design.colors.text = (theme && typeof theme.text === 'string' && theme.text) ? theme.text : '#000000';
      }
      if (typeof root.data.metadata.design.colors.background !== 'string') {
        root.data.metadata.design.colors.background = (theme && typeof theme.background === 'string' && theme.background) ? theme.background : '#ffffff';
      }
    }
  }
  
  // Ensure metadata.typography exists with body and heading
  // Preserve existing typography.font structure from template if it exists
  if (!root.data.metadata.typography || typeof root.data.metadata.typography !== 'object') {
    root.data.metadata.typography = { 
      body: { fontFamily: 'Inter' }, 
      heading: { fontFamily: 'Inter' } 
    };
  } else {
    // Only add body/heading if they don't exist - preserve existing font structure
    if (!root.data.metadata.typography.body || typeof root.data.metadata.typography.body !== 'object') {
      // Check if there's a font object we should preserve
      if (root.data.metadata.typography.font && typeof root.data.metadata.typography.font === 'object') {
        root.data.metadata.typography.body = { fontFamily: root.data.metadata.typography.font.family || 'Inter' };
      } else {
        root.data.metadata.typography.body = { fontFamily: 'Inter' };
      }
    } else {
      // Only set fontFamily if it's missing - preserve other body properties
      if (typeof root.data.metadata.typography.body.fontFamily !== 'string') {
        if (root.data.metadata.typography.font && root.data.metadata.typography.font.family) {
          root.data.metadata.typography.body.fontFamily = root.data.metadata.typography.font.family;
        } else {
          root.data.metadata.typography.body.fontFamily = 'Inter';
        }
      }
    }
    if (!root.data.metadata.typography.heading || typeof root.data.metadata.typography.heading !== 'object') {
      // Check if there's a font object we should preserve
      if (root.data.metadata.typography.font && typeof root.data.metadata.typography.font === 'object') {
        root.data.metadata.typography.heading = { fontFamily: root.data.metadata.typography.font.family || 'Inter' };
      } else {
        root.data.metadata.typography.heading = { fontFamily: 'Inter' };
      }
    } else {
      // Only set fontFamily if it's missing - preserve other heading properties
      if (typeof root.data.metadata.typography.heading.fontFamily !== 'string') {
        if (root.data.metadata.typography.font && root.data.metadata.typography.font.family) {
          root.data.metadata.typography.heading.fontFamily = root.data.metadata.typography.font.family;
        } else {
          root.data.metadata.typography.heading.fontFamily = 'Inter';
        }
      }
    }
  }
  
  // Ensure metadata.page exists with required fields
  // Support both old format (marginX/marginY) and new format (margin)
  // Preserve existing page settings from template
  // CRITICAL: Set proper margins to prevent text from touching edges
  // Use 36px (0.5in) margins for better space utilization
  // IMPORTANT: breakLine: true allows content to flow to second page (up to 2 pages allowed)
  if (!root.data.metadata.page || typeof root.data.metadata.page !== 'object') {
    // Default to margins for modern professional resume layout
    // Reduced to 36px (0.5in) for better space utilization
    root.data.metadata.page = { 
      marginX: 36,      // Left margin: 0.5in
      marginY: 36,      // Top margin: 0.5in
      format: 'a4',     // Page format (can be changed to 'letter' for US Letter format if needed)
      options: { breakLine: true, pageNumbers: true },  // breakLine: true allows multi-page (up to 2 pages)
      gapX: 32,         // Horizontal spacing between columns (increased to 32px for better separation)
      gapY: 12          // Vertical spacing between sections (REDUCED to 12px for tighter layout)
    };
  } else {
    // Preserve existing format fields
    // NOTE: Format can be 'a4' or 'letter' - A4 is default, change to 'letter' for US Letter if needed
    if (root.data.metadata.page.format === undefined) {
      root.data.metadata.page.format = 'a4';
    }
    if (!root.data.metadata.page.options || typeof root.data.metadata.page.options !== 'object') {
      root.data.metadata.page.options = { breakLine: true, pageNumbers: true };
    } else {
      // Ensure breakLine is true to allow multi-page (even if template has different setting)
      if (typeof root.data.metadata.page.options.breakLine !== 'boolean') {
        root.data.metadata.page.options.breakLine = true;
      } else if (root.data.metadata.page.options.breakLine === false) {
        // Override template setting if it disables page breaks - we need multi-page support
        root.data.metadata.page.options.breakLine = true;
      }
      // Preserve pageNumbers setting
      if (typeof root.data.metadata.page.options.pageNumbers !== 'boolean') {
        root.data.metadata.page.options.pageNumbers = true;
      }
    }
    
    // Handle margin: support both new format (margin) and old format (marginX/marginY)
    // Use 36px (0.5in) margins for better space utilization
    // CRITICAL: Always enforce minimum margins even if template has smaller values
    if (root.data.metadata.page.margin !== undefined) {
      // New format exists - convert to 36px margins
      if (typeof root.data.metadata.page.margin === 'number' && root.data.metadata.page.margin >= 30) {
        // Convert single margin to 36px for both X and Y
        root.data.metadata.page.marginX = 36;  // Left: 0.5in
        root.data.metadata.page.marginY = 36;  // Top: 0.5in
        // Keep margin for backward compatibility, but marginX/marginY take precedence
      } else {
        root.data.metadata.page.marginX = 36;
        root.data.metadata.page.marginY = 36;
      }
    } else if (root.data.metadata.page.marginX !== undefined || root.data.metadata.page.marginY !== undefined) {
      // Old format exists - enforce 36px minimum values
      if (root.data.metadata.page.marginX === undefined) {
        root.data.metadata.page.marginX = 36;  // Left: 0.5in
      } else if (root.data.metadata.page.marginX < 30) {
        root.data.metadata.page.marginX = 36;  // Enforce minimum 0.5in for left
      }
      if (root.data.metadata.page.marginY === undefined) {
        root.data.metadata.page.marginY = 36;  // Top: 0.5in
      } else if (root.data.metadata.page.marginY < 30) {
        root.data.metadata.page.marginY = 36;  // Enforce minimum 0.5in for top
      }
    } else {
      // Neither format exists - default to 36px margins
      root.data.metadata.page.marginX = 36;  // Left: 0.5in
      root.data.metadata.page.marginY = 36;  // Top: 0.5in
    }
    
    // Set gap defaults only if missing, with generous spacing for colored sections
    if (root.data.metadata.page.gapX === undefined) {
      root.data.metadata.page.gapX = 32;
    } else if (root.data.metadata.page.gapX < 24) {
      // Ensure minimum horizontal gap (24px) for colored section separation
      root.data.metadata.page.gapX = 32;
    }
    // Use a sensible default gapY (10px) and clamp template values (6-14)
    // This allows natural section spacing controlled by the layout engine
    const originalGapY = root.data.metadata.page.gapY;
    if (typeof root.data.metadata.page.gapY !== 'number') {
      root.data.metadata.page.gapY = 10;  // Default 10px for natural spacing
    } else {
      // Clamp template gapY to reasonable range
      root.data.metadata.page.gapY = Math.max(6, Math.min(14, root.data.metadata.page.gapY));
    }
    if (originalGapY !== root.data.metadata.page.gapY) {
      Logger.log(`gapY adjusted: ${originalGapY} → ${root.data.metadata.page.gapY}px`);
    } else {
      Logger.log(`gapY preserved: ${root.data.metadata.page.gapY}px`);
    }
  }
  
  // Preserve template name (new format: metadata.template, old format: metadata.name)
  // Both are critical for visual formatting
  // Don't overwrite either if they exist - they define the visual template
  if (root.data.metadata.name || root.data.metadata.template) {
    Logger.log(`Template styling: Preserved template name (name: ${root.data.metadata.name || 'N/A'}, template: ${root.data.metadata.template || 'N/A'})`);
  } else {
    Logger.log('Template styling: No template name found in metadata (using template defaults)');
  }
  
  // Ensure metadata.notes exists
  if (typeof root.data.metadata.notes !== 'string') root.data.metadata.notes = '';

  // Layout is now frozen - do not mutate after this point
  // Summary full-width on page 1 is handled in layout creation logic above
  
  // CRITICAL: Ensure all sections with content are placed in layout
  ensureSectionsPlaced_(root);
  
  // Force sidebar column on ALL pages (keeps right color bar consistent across all pages)
  // This ensures the colored sidebar column exists on all pages, even when empty
  // CRITICAL: This must run after all layout logic to ensure consistency
  if (Array.isArray(root.data.metadata.layout?.pages)) {
    root.data.metadata.layout.pages.forEach(p => {
      if (p && typeof p === 'object') {
        p.fullWidth = false;  // Always maintain two-column grid
        if (!Array.isArray(p.sidebar)) p.sidebar = [];  // Ensure sidebar array exists
      }
    });
    Logger.log(`Forced sidebar column on all ${root.data.metadata.layout.pages.length} pages (maintains colored background)`);
  }

  // CRITICAL: Protect summary.content from bullet/hyphen normalization
  // Normalize summary separately with verbatim mode, then normalize rest
  if (root.data && root.data.summary && root.data.summary.content && typeof root.data.summary.content === 'string') {
    root.data.summary.content = normalizeSummaryVerbatim_(root.data.summary.content);
  }
  
  // Normalize everything else (summary.content is already protected by guard in normalizeStringsDeep_)
  normalizeStringsDeep_(root, null); // Root-level normalization, no section context
}

/* =========================================================
 * Ensure all sections with content are placed in layout
 * ======================================================= */
function ensureSectionsPlaced_(root) {
  if (!root.data || !root.data.metadata || !root.data.metadata.layout) return;
  
  const pages = root.data.metadata.layout.pages;
  if (!Array.isArray(pages) || pages.length === 0) return;
  
  // Collect all sections present in layout
  const sectionsInLayout = new Set();
  for (const page of pages) {
    if (page && typeof page === 'object') {
      if (Array.isArray(page.main)) {
        page.main.forEach(s => sectionsInLayout.add(s));
      }
      if (Array.isArray(page.sidebar)) {
        page.sidebar.forEach(s => sectionsInLayout.add(s));
      }
    }
  }
  
  // Get the last page (or create one if needed)
  let lastPage = pages[pages.length - 1];
  if (!lastPage || typeof lastPage !== 'object') {
    lastPage = { fullWidth: false, main: [], sidebar: [] };
    pages.push(lastPage);
  }
  if (!Array.isArray(lastPage.main)) {
    lastPage.main = [];
  }
  if (!Array.isArray(lastPage.sidebar)) {
    lastPage.sidebar = [];
  }
  
  // Check experience - must be in main
  if (root.data.sections.experience && 
      root.data.sections.experience.items && 
      root.data.sections.experience.items.length > 0 && 
      !sectionsInLayout.has('experience')) {
    lastPage.main.push('experience');
    Logger.log('Added missing experience section to layout');
  }
  
  // Check education - must be in main
  if (root.data.sections.education && 
      root.data.sections.education.items && 
      root.data.sections.education.items.length > 0 && 
      !sectionsInLayout.has('education')) {
    lastPage.main.push('education');
    Logger.log('Added missing education section to layout');
  }
  
  // Check skills - must be in sidebar (never in main)
  if (root.data.sections.skills && 
      root.data.sections.skills.items && 
      root.data.sections.skills.items.length > 0) {
    // Check if skills is already in any sidebar across all pages
    let skillsInSidebar = false;
    for (const page of pages) {
      if (page && typeof page === 'object' && Array.isArray(page.sidebar)) {
        if (page.sidebar.includes('skills')) {
          skillsInSidebar = true;
          break;
        }
      }
    }
    
    // Only add if not already present in any sidebar
    if (!skillsInSidebar) {
      // Find the first page with a sidebar and add skills there
      let skillsAdded = false;
      for (const page of pages) {
        if (page && typeof page === 'object') {
          if (!Array.isArray(page.sidebar)) {
            page.sidebar = [];
          }
          if (!page.sidebar.includes('skills')) {
            page.sidebar.push('skills');
            skillsAdded = true;
            Logger.log('Added missing skills section to sidebar');
            break;
          }
        }
      }
      // If no page had a sidebar, add to last page
      if (!skillsAdded) {
        lastPage.sidebar.push('skills');
        Logger.log('Added missing skills section to last page sidebar');
      }
    } else {
      Logger.log('Skills section already present in sidebar, skipping duplicate');
    }
  }
  
  // Check certifications - must be in main
  if (root.data.sections.certifications && 
      root.data.sections.certifications.items && 
      root.data.sections.certifications.items.length > 0 && 
      !sectionsInLayout.has('certifications')) {
    lastPage.main.push('certifications');
    Logger.log('Added missing certifications section to layout');
  }
}

/* =========================================================
 * Normalize item field names (template → API format)
 * ======================================================= */
function normalizeItemFieldNames_(root) {
  Logger.log(`=== normalizeItemFieldNames_ START ===`);
  
  if (!root.data || !root.data.sections) {
    Logger.log(`normalizeItemFieldNames_: No sections found, returning early`);
    return;
  }
  
  for (const sectionKey in root.data.sections) {
    const section = root.data.sections[sectionKey];
    if (!section || typeof section !== 'object' || Array.isArray(section)) continue;
    
    if (!Array.isArray(section.items)) continue;
    
    Logger.log(`Processing section: ${sectionKey} (${section.items.length} items)`);
    
    for (let i = 0; i < section.items.length; i++) {
      const item = section.items[i];
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      
      const itemId = item.company || item.position || item.school || `Item ${i}`;
      Logger.log(`  Item ${i} (${itemId}):`);
      
      // Map date → period (API requires period field)
      if (item.date !== undefined && item.period === undefined) {
        item.period = typeof item.date === 'string' ? item.date : String(item.date || '');
      }
      // Ensure period exists as string (required by API - always ensure it exists)
      if (typeof item.period !== 'string') {
        item.period = item.date ? (typeof item.date === 'string' ? item.date : String(item.date)) : '';
      }
      
      // Map url → website (API requires website field)
      if (item.url !== undefined && item.website === undefined) {
        // Convert url object to website format
        if (item.url && typeof item.url === 'object') {
          item.website = {
            label: typeof item.url.label === 'string' ? item.url.label : '',
            url: typeof item.url.href === 'string' ? item.url.href : (typeof item.url.url === 'string' ? item.url.url : '')
          };
        } else {
          // If url is a string, convert to website object
          item.website = {
            label: '',
            url: typeof item.url === 'string' ? item.url : ''
          };
        }
      }
      // Ensure website is an object with proper structure (required by API - always ensure it exists)
      // API expects {url: string, label: string}
      if (typeof item.website !== 'object' || Array.isArray(item.website) || item.website === undefined) {
        item.website = { label: '', url: '' };
      } else {
        if (typeof item.website.label !== 'string') item.website.label = '';
        // Handle both href (old format) and url (API format)
        if (item.website.href !== undefined && item.website.url === undefined) {
          item.website.url = typeof item.website.href === 'string' ? item.website.href : '';
          delete item.website.href;
        }
        if (typeof item.website.url !== 'string') item.website.url = '';
      }
      
      // Map summary → description (only when description is missing)
      // CRITICAL: For experience items, preserve arrays - don't convert to string
      if (item.summary !== undefined && item.description === undefined) {
        Logger.log(`    Mapping summary to description (summary type: ${typeof item.summary})`);
        if (sectionKey === 'experience') {
          // For experience, if summary is an array, preserve it as array
          if (Array.isArray(item.summary)) {
            item.description = item.summary;
          } else {
            // Convert string summary to array for experience
            const summaryStr = String(item.summary || '').trim();
            if (summaryStr) {
              // Split by common separators and clean
              let bullets = summaryStr.split(/[.,]\s*(?=[A-Z])/).filter(b => b.trim().length > 0);
              if (bullets.length === 0) bullets = [summaryStr];
              item.description = bullets.map(b => b.trim());
            } else {
              item.description = [];
            }
          }
        } else {
          // Non-experience: convert to string
          item.description = (typeof item.summary === 'string') ? item.summary : String(item.summary || '');
        }
      }
      
      // CRITICAL: Do NOT coerce experience.description arrays into strings
      // Experience items use arrays for bullets - preserve them
      if (sectionKey === 'experience') {
        Logger.log(`    Experience item: checking description preservation`);
        Logger.log(`      Description BEFORE: type=${typeof item.description}, isArray=${Array.isArray(item.description)}`);
        if (Array.isArray(item.description)) {
          Logger.log(`      Description array length: ${item.description.length}`);
        }
        
        // For experience, description should remain as array during processing
        // It will be converted to string at the very end (in convertExperienceDescriptionsToStrings_)
        // So we preserve arrays here - don't convert strings to arrays
        if (item.description === undefined || item.description === null) {
          Logger.log(`      Description was undefined/null, setting to empty array`);
          item.description = [];
        } else if (Array.isArray(item.description)) {
          Logger.log(`      Description is array (length: ${item.description.length}) - PRESERVING IT (will convert to string at API call)`);
          // Array is correct - leave it alone (will be converted to string later)
        } else if (typeof item.description === 'string') {
          Logger.log(`      Description is string - preserving as string (will be handled at API call if needed)`);
          // String exists - keep it as string for now
          // Note: If it came from API validation, it might already be a string
          // The convertExperienceDescriptionsToStrings_ function will handle it
        } else {
          Logger.log(`      Description was invalid type (${typeof item.description}), setting to empty array`);
          // Invalid type - set to empty array (will become empty string at API call)
          item.description = [];
        }
        
        Logger.log(`      Description AFTER: type=${typeof item.description}, isArray=${Array.isArray(item.description)}`);
        if (Array.isArray(item.description)) {
          Logger.log(`      Description array length: ${item.description.length}`);
          Logger.log(`      Description content: ${JSON.stringify(item.description)}`);
        } else if (typeof item.description === 'string') {
          Logger.log(`      Description string length: ${item.description.length}`);
        }
      } else {
        // Non-experience sections: keep old behavior (string description)
        Logger.log(`    Non-experience item: ensuring description is string`);
        if (typeof item.description !== 'string') {
          Logger.log(`      Converting description from ${typeof item.description} to string`);
          item.description = item.description ? String(item.description) : '';
        }
      }
      
      // Education-specific field mappings
      if (sectionKey === 'education') {
        // Map institution → school (API requires school field)
        if (item.institution !== undefined && item.school === undefined) {
          item.school = typeof item.institution === 'string' ? item.institution : String(item.institution || '');
        }
        // Ensure school exists as string (required by API - always ensure it exists)
        if (typeof item.school !== 'string') {
          item.school = item.institution ? (typeof item.institution === 'string' ? item.institution : String(item.institution)) : '';
        }
        
        // Map studyType → degree (API requires degree field)
        if (item.studyType !== undefined && item.degree === undefined) {
          item.degree = typeof item.studyType === 'string' ? item.studyType : String(item.studyType || '');
        }
        // Ensure degree exists as string (required by API - always ensure it exists)
        if (typeof item.degree !== 'string') {
          item.degree = item.studyType ? (typeof item.studyType === 'string' ? item.studyType : String(item.studyType)) : '';
        }
        
        // Map score → grade (API requires grade field)
        if (item.score !== undefined && item.grade === undefined) {
          item.grade = typeof item.score === 'string' ? item.score : String(item.score || '');
        }
        // Ensure grade exists as string (required by API - always ensure it exists)
        if (typeof item.grade !== 'string') {
          item.grade = item.score ? (typeof item.score === 'string' ? item.score : String(item.score)) : '';
        }
        
        // Ensure location exists as string (required by API)
        if (typeof item.location !== 'string') {
          item.location = '';
        }
      }
    }
  }
}

/* =========================================================
 * Convert experience description arrays to strings (API requirement)
 * ======================================================= */
function convertExperienceDescriptionsToStrings_(root) {
  if (!root.data || !root.data.sections || !root.data.sections.experience) {
    return;
  }
  
  const expItems = root.data.sections.experience.items;
  if (!Array.isArray(expItems)) {
    return;
  }
  
  Logger.log('=== convertExperienceDescriptionsToStrings_ START ===');
  Logger.log(`Processing ${expItems.length} experience items`);
  
  for (let i = 0; i < expItems.length; i++) {
    const item = expItems[i];
    if (!item || typeof item !== 'object') continue;
    
    if (Array.isArray(item.description)) {
      const arrayLength = item.description.length;
      // Join without bullets - each line is a separate paragraph
      const descriptionString = item.description
        .filter(d => d && typeof d === 'string' && d.trim().length > 0)
        .map(d => d.trim())
        .join('\n\n'); // Double newline for slight spacing between description items
      item.description = descriptionString;
      Logger.log(`  Item ${i} (${item.company || item.position || 'Unknown'}): Converted array[${arrayLength}] to string without bullets (${descriptionString.length} chars)`);
    } else if (item.description === undefined || item.description === null) {
      // Empty description - set to empty string
      item.description = '';
      Logger.log(`  Item ${i} (${item.company || item.position || 'Unknown'}): Set empty description to empty string`);
    } else if (typeof item.description !== 'string') {
      // Unexpected type - convert to string
      item.description = String(item.description || '');
      Logger.log(`  Item ${i} (${item.company || item.position || 'Unknown'}): Converted ${typeof item.description} to string`);
    } else {
      // Already a string - log but don't change
      Logger.log(`  Item ${i} (${item.company || item.position || 'Unknown'}): Description already string (${item.description.length} chars)`);
    }
    
    // NOTE: No length limit on descriptions - CSS will handle text wrapping and flow
    // Descriptions should flow naturally across pages, not be artificially limited
    if (item.description && typeof item.description === 'string' && item.description.length > 1000) {
      Logger.log(`  NOTE: Experience ${i} (${item.company || item.position || 'Unknown'}) description is ${item.description.length} chars (CSS will handle wrapping)`);
    }
  }
  
  Logger.log('=== convertExperienceDescriptionsToStrings_ END ===');
}

/* =========================================================
 * Text reflow utility - normalize paragraph text
 * ======================================================= */
function normalizeParagraphText_(text) {
  if (!text || typeof text !== 'string') return '';
  
  let normalized = text;
  
  // Step 1: Replace all line breaks with spaces (preserve content)
  normalized = normalized.replace(/\r\n/g, ' ').replace(/\n/g, ' ');
  
  // Step 2: Only remove leading list markers if they're truly list markers (• and * only, NOT hyphens)
  // Pattern: start of string, optional whitespace, bullet char, space, then word character
  // This ensures we don't remove hyphenated words that happen to start with a hyphen
  // Only match if there's a space after the bullet character and then a word
  normalized = normalized.replace(/^[\s]*([•*])\s+(?=\w)/, '');
  
  // Step 3: Fix broken hyphenation (one- on- one → one-on-one)
  // Match: word character, hyphen, whitespace, word character
  normalized = normalized.replace(/(\w)-\s+(\w)/g, '$1-$2');
  
  // Step 4: Fix broken dash spacing in compounds (one- on- one → one-on-one)
  // This handles cases where hyphenated words were split across lines
  // Be more conservative: only fix if both parts are short words
  normalized = normalized.replace(/(\w+)\s*-\s*(\w+)/g, function(match, p1, p2) {
    // Only fix if it looks like a compound word (short words, common patterns)
    if (p1.length <= 10 && p2.length <= 10) {
      return p1 + '-' + p2;
    }
    return match; // Keep original if it's likely intentional
  });
  
  // Step 5: Collapse multiple spaces to single space
  normalized = normalized.replace(/\s+/g, ' ');
  
  // Step 6: Trim leading/trailing whitespace
  normalized = normalized.trim();
  
  return normalized;
}

/* =========================================================
 * Summary content normalization - VERBATIM MODE
 * Only whitespace normalization allowed. No bullet/hyphen logic.
 * ======================================================= */
function normalizeSummaryVerbatim_(content) {
  Logger.log(`=== normalizeSummaryVerbatim_ START ===`);
  Logger.log(`Input type: ${typeof content}`);
  Logger.log(`Input length: ${content ? content.length : 0} chars`);
  Logger.log(`Input preview (first 200 chars): ${content ? content.substring(0, 200) : 'N/A'}`);
  Logger.log(`Input contains newlines: ${content ? (content.includes('\n') || content.includes('\r')) : false}`);
  
  if (!content || typeof content !== 'string') {
    Logger.log(`normalizeSummaryVerbatim_: Invalid input, returning empty string`);
    return '';
  }
  
  // VERBATIM MODE: Preserve words exactly; only normalize whitespace.
  // This prevents the "- functional" bug by never treating hyphens as bullets.
  let normalized = content
    .replace(/\r\n/g, '\n')  // Normalize line endings
    .replace(/\n+/g, ' ')   // Replace all newlines with spaces
    .replace(/[ \t\u00A0]+/g, ' ')  // Collapse multiple spaces/tabs to single space
    .trim();                 // Trim leading/trailing whitespace
  
  Logger.log(`Output length: ${normalized.length} chars`);
  Logger.log(`Output preview (first 200 chars): ${normalized.substring(0, 200)}`);
  Logger.log(`Output contains newlines: ${normalized.includes('\n') || normalized.includes('\r')}`);
  Logger.log(`=== normalizeSummaryVerbatim_ END ===`);
  
  return normalized;
}

/* =========================================================
 * Summary content normalization (legacy - kept for compatibility)
 * ======================================================= */
function normalizeSummaryContent_(content) {
  // Use verbatim normalizer for safety
  return normalizeSummaryVerbatim_(content);
}

function normalizeStringsDeep_(obj, sectionKey) {
  sectionKey = sectionKey || null; // Allow null/undefined for root-level calls
  if (obj === null || obj === undefined) return;
  if (typeof obj === 'string') {
    // Trim strings at the leaf level
    return obj.trim();
  }

  if (Array.isArray(obj)) {
    // Process each element in the array
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'string') {
        // Trim string elements in arrays
        obj[i] = obj[i].trim();
      } else {
        // Recursively process non-string elements
        normalizeStringsDeep_(obj[i], sectionKey);
      }
    }
    return;
  }

  if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      
      // CRITICAL: Summary content must NEVER go through bullet/hyphen normalization
      // This prevents the "- functional" bug by ensuring summary.content is verbatim
      // Detect summary by: (1) explicit sectionKey, or (2) object structure (has 'title' and 'content')
      const isSummaryContent = (sectionKey === 'summary' && k === 'content') ||
                                (k === 'content' && obj.title !== undefined && typeof obj.title === 'string');
      
      if (isSummaryContent && typeof v === 'string') {
        // Use verbatim normalizer - only whitespace, no bullet/hyphen logic
        obj[k] = normalizeSummaryVerbatim_(v);
        continue;
      }
      
      // CRITICAL: For experience items, description and highlights are arrays - normalize each element
      if (sectionKey === 'experience' && (k === 'description' || k === 'highlights') && Array.isArray(v)) {
        // Normalize each array element: trim and remove bullet characters/newlines (• and * only, NOT hyphens)
        for (let i = 0; i < v.length; i++) {
          if (typeof v[i] === 'string') {
            // Remove bullet characters (• and * only, NOT hyphens) and newlines, then trim
            let cleaned = v[i].replace(/^[\s]*[•*]\s*/, '').replace(/[\s]*[•*]\s*$/, '');
            cleaned = cleaned.replace(/\n+/g, ' ').trim();
            obj[k][i] = cleaned;
          }
        }
        continue; // Skip string processing for array descriptions/highlights
      }
      
      if (typeof v === 'string') {
        // content fields: preserve as-authored; don't try to bullet-normalize
        if (k === 'content') {
          obj[k] = v.replace(/\r\n/g, '\n').trim();
          continue;
        }

        // description fields (non-experience): may need bullet reflow for • and *
        if (k === 'description' && sectionKey !== 'experience') {
          // For descriptions, normalize line endings but preserve newlines
          // Only trim leading/trailing whitespace (spaces, tabs) but NOT newlines
          // Use [ \t\u00A0] instead of \s to exclude newlines
          // CRITICAL: Ensure each bullet is on its own line with NO text before it
          // IMPORTANT: Only handle real bullet glyphs (• and *), NOT hyphens
          let normalized = v.replace(/\r\n/g, '\n').replace(/^[ \t\u00A0]+|[ \t\u00A0]+$/g, '');
          
          // Step 1: Collapse multiple consecutive newlines to single newlines (prevents \n\n\n)
          normalized = normalized.replace(/\n{3,}/g, '\n\n');
          
          // Step 2: Handle real bullet characters (• and *) only
          // Match: any non-newline, non-whitespace character followed by • or *
          normalized = normalized.replace(/([^\n\s])([•\*])\s+/g, '$1\n$2 ');
          
          // Step 3: Clean up lines that have text before real bullets (• or * only)
          // Match: start of line, any text/whitespace, then bullet - keep only the bullet
          // Require the bullet glyph, not hyphen-minus, to avoid breaking "cross-functional"
          normalized = normalized.replace(/^[^\n]*?([•\*])\s*/gm, '$1 ');
          
          // Step 4: Remove leading spaces/tabs before bullets (clean up any remaining)
          normalized = normalized.replace(/^[ \t]+([•\*])/gm, '$1');
          
          // Step 5: Ensure consistent spacing: bullet, space, text (but don't break words)
          normalized = normalized.replace(/([•\*])([^\s\n])/g, '$1 $2');
          
          // Step 6: Remove any trailing whitespace on lines (but preserve newlines)
          normalized = normalized.replace(/[ \t]+$/gm, '');
          
          // Step 7: Final cleanup - collapse any remaining excessive newlines
          normalized = normalized.replace(/\n{3,}/g, '\n\n');
          
          obj[k] = normalized;
          continue;
        }
        
        // For other fields, normal trim is fine
        obj[k] = v.replace(/\r\n/g, '\n').trim();
      } else {
        normalizeStringsDeep_(v, sectionKey);
      }
    }
  }
}

/* =========================================================
 * Field Mapping Registry - Future-proof field mappings
 * ======================================================= */
const FIELD_MAPPING_REGISTRY = {
  // Section-specific field mappings (template field → API field)
  sectionMappings: {
    education: {
      institution: 'school',
      studyType: 'degree',
      score: 'grade'
    },
    experience: {
      // Experience uses standard mappings handled elsewhere
    }
  },
  // Common field mappings (apply to all sections)
  commonMappings: {
    date: 'period',
    url: 'website',
    summary: 'description'
  },
  // Default values by type
  typeDefaults: {
    string: '',
    number: 0,
    boolean: false,
    object: {},
    array: []
  },
  // Section-specific required fields
  sectionRequiredFields: {
    education: ['school', 'degree', 'grade', 'location', 'period', 'website', 'description'],
    experience: ['period', 'website', 'description'],
    certifications: ['period', 'website', 'description'],
    skills: ['description'],
    // Add more as discovered
  }
};

/* =========================================================
 * Parse API Validation Errors
 * ======================================================= */
function parseApiValidationErrors_(errorBody) {
  const missingFields = [];
  
  try {
    const errorObj = JSON.parse(errorBody);
    if (errorObj && errorObj.data && errorObj.data.issues && Array.isArray(errorObj.data.issues)) {
      for (const issue of errorObj.data.issues) {
        if (issue.path && Array.isArray(issue.path)) {
          // Handle different error types
          if (issue.expected) {
            // invalid_type errors
            missingFields.push({
              path: issue.path,
              expectedType: issue.expected,
              message: issue.message || '',
              errorCode: issue.code || 'invalid_type'
            });
          } else if (issue.code === 'too_small' && issue.origin === 'string') {
            // too_small errors for strings (empty strings that need content)
            missingFields.push({
              path: issue.path,
              expectedType: 'string',
              message: issue.message || '',
              errorCode: 'too_small',
              minimum: issue.minimum || 1
            });
          } else if (issue.code === 'invalid_value' && issue.values) {
            // invalid_value errors (enum validation)
            missingFields.push({
              path: issue.path,
              expectedType: 'enum',
              message: issue.message || '',
              errorCode: 'invalid_value',
              allowedValues: issue.values || []
            });
          }
        }
      }
    }
  } catch (e) {
    Logger.log('Error parsing API validation errors: ' + e.message);
  }
  
  return missingFields;
}

/* =========================================================
 * Auto-fix missing fields based on parsed errors
 * ======================================================= */
function applyFieldFixes_(root, missingFields) {
  if (!missingFields || missingFields.length === 0) return;
  
  Logger.log(`Applying fixes for ${missingFields.length} missing fields...`);
  
  for (const field of missingFields) {
    const path = field.path;
    const expectedType = field.expectedType;
    const errorCode = field.errorCode || 'invalid_type';
    
    if (!path || path.length === 0) continue;
    
    // Navigate to the parent object, handling array indices
    let current = root;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      const nextKey = (i < path.length - 2) ? path[i + 1] : null;
      const isNextKeyArrayIndex = nextKey && !isNaN(parseInt(nextKey));
      
      // Handle array indices
      if (!isNaN(parseInt(key))) {
        const index = parseInt(key);
        if (!Array.isArray(current)) {
          Logger.log(`Warning: Expected array at path ${path.slice(0, i).join('.')}, got ${typeof current}`);
          break;
        }
        // Ensure array is large enough
        while (current.length <= index) {
          current.push(isNextKeyArrayIndex ? [] : {});
        }
        current = current[index];
      } else {
        // Handle object keys
        if (!current[key]) {
          current[key] = isNextKeyArrayIndex ? [] : {};
        }
        current = current[key];
      }
      
      if (!current) break;
    }
    
    if (!current) {
      Logger.log(`Warning: Could not navigate to parent of ${path.join('.')}`);
      continue;
    }
    
    const fieldName = path[path.length - 1];
    const isFieldArrayIndex = !isNaN(parseInt(fieldName));
    
    // Determine default value based on expected type
    let defaultValue = FIELD_MAPPING_REGISTRY.typeDefaults[expectedType];
    if (defaultValue === undefined) {
      // Fallback defaults
      if (expectedType === 'string') defaultValue = '';
      else if (expectedType === 'number') defaultValue = 0;
      else if (expectedType === 'boolean') defaultValue = false;
      else if (expectedType === 'object') defaultValue = {};
      else if (expectedType === 'array') defaultValue = [];
      else defaultValue = '';
    }
    
    // Special handling for nested objects with known structures
    if (expectedType === 'object') {
      if (fieldName === 'website') {
        defaultValue = { label: '', url: '' };
      } else if (fieldName === 'url') {
        defaultValue = { label: '', href: '' };
      } else if (fieldName === 'effects') {
        defaultValue = { hidden: false, border: false, grayscale: false };
      } else if (fieldName === 'layout') {
        defaultValue = { pages: [] };
      } else if (fieldName === 'css') {
        defaultValue = { enabled: false, value: '' };
      } else if (fieldName === 'design') {
        defaultValue = { 
          level: { icon: 'circle', type: 'circle' }, 
          colors: { primary: '#000000', text: '#000000', background: '#ffffff' } 
        };
      } else if (fieldName === 'typography') {
        defaultValue = { 
          body: { fontFamily: 'Inter' }, 
          heading: { fontFamily: 'Inter' } 
        };
      } else if (fieldName === 'level') {
        defaultValue = { icon: 'circle', type: 'circle' };
      } else if (fieldName === 'colors') {
        defaultValue = { primary: '#000000', text: '#000000', background: '#ffffff' };
      } else if (fieldName === 'body' || fieldName === 'heading') {
        defaultValue = { fontFamily: 'Inter' };
      } else if (fieldName === 'page') {
        defaultValue = { gapX: 0, gapY: 0, marginX: 0, marginY: 0 };
      } else {
        // Default empty object
        defaultValue = {};
      }
    }
    
    // When creating parent objects with known nested structures, create nested properties too
    // This handles cases where we create layout={} but also need layout.pages=[]
    if (expectedType === 'object' && defaultValue && typeof defaultValue === 'object' && Object.keys(defaultValue).length > 0) {
      // We're creating an object with nested structure - apply it
      if (current[fieldName] === undefined || current[fieldName] === null || typeof current[fieldName] !== 'object') {
        current[fieldName] = JSON.parse(JSON.stringify(defaultValue)); // Deep clone
      } else {
        // Merge nested properties into existing object recursively
        for (const nestedKey in defaultValue) {
          if (current[fieldName][nestedKey] === undefined || current[fieldName][nestedKey] === null) {
            current[fieldName][nestedKey] = JSON.parse(JSON.stringify(defaultValue[nestedKey])); // Deep clone nested objects
          } else if (typeof defaultValue[nestedKey] === 'object' && !Array.isArray(defaultValue[nestedKey])) {
            // Recursively merge nested objects
            for (const deepKey in defaultValue[nestedKey]) {
              if (current[fieldName][nestedKey][deepKey] === undefined || current[fieldName][nestedKey][deepKey] === null) {
                current[fieldName][nestedKey][deepKey] = defaultValue[nestedKey][deepKey];
              }
            }
          }
        }
      }
    }
    
    // Special handling for deeply nested properties that might be created as empty objects
    // Handle design.level.icon, design.colors.*, typography.body.fontFamily, typography.heading.fontFamily
    if (path.length >= 4) {
      const grandParentKey = path[path.length - 3];
      const parentKey = path[path.length - 2];
      
      if (grandParentKey === 'design' && parentKey === 'level') {
        if (fieldName === 'icon' && (current[fieldName] === undefined || current[fieldName] === null || current[fieldName] === '')) {
          current[fieldName] = 'circle';
        } else if (fieldName === 'type') {
          // Always ensure type has a valid value
          if (current[fieldName] === undefined || current[fieldName] === null || current[fieldName] === '' || 
              !['hidden', 'circle', 'square', 'rectangle', 'rectangle-full', 'progress-bar', 'icon'].includes(current[fieldName])) {
            current[fieldName] = 'circle'; // Default type for design.level
            Logger.log(`Fixed design.level.type: ${path.join('.')} = "${current[fieldName]}"`);
          }
        }
      } else if (grandParentKey === 'design' && parentKey === 'colors') {
        if (fieldName === 'primary' || fieldName === 'text' || fieldName === 'background') {
          if (current[fieldName] === undefined || current[fieldName] === null || current[fieldName] === '') {
            current[fieldName] = fieldName === 'background' ? '#ffffff' : '#000000';
          }
        }
      } else if (grandParentKey === 'typography' && (parentKey === 'body' || parentKey === 'heading') && fieldName === 'fontFamily') {
        if (current[fieldName] === undefined || current[fieldName] === null || current[fieldName] === '') {
          current[fieldName] = 'Inter';
        }
      }
    }
    
    // Apply the fix
    if (isFieldArrayIndex) {
      const index = parseInt(fieldName);
      if (Array.isArray(current)) {
        while (current.length <= index) {
          current.push(defaultValue);
        }
        if (current[index] === undefined || current[index] === null) {
          current[index] = defaultValue;
          Logger.log(`Fixed: ${path.join('.')} = ${JSON.stringify(defaultValue)}`);
        }
      }
    } else {
      // Check for specific error types first, before setting defaults
      if (errorCode === 'too_small' && expectedType === 'string') {
        // Handle too_small errors - string is too short (empty or below minimum)
        if (fieldName === 'title') {
          // For title fields, try to use 'name' field if available
          if (current.name && typeof current.name === 'string' && current.name.trim()) {
            current[fieldName] = current.name;
            Logger.log(`Fixed too_small title: ${path.join('.')} = "${current[fieldName]}" (from name field)`);
          } else {
            current[fieldName] = 'Untitled';
            Logger.log(`Fixed too_small title: ${path.join('.')} = "${current[fieldName]}"`);
          }
        } else if (current[fieldName] === '' || !current[fieldName] || String(current[fieldName]).trim().length < (field.minimum || 1)) {
          current[fieldName] = fieldName === 'name' ? 'Untitled' : (defaultValue || 'Default');
          Logger.log(`Fixed too_small: ${path.join('.')} = "${current[fieldName]}"`);
        }
      } else if (errorCode === 'invalid_value' && field.allowedValues && field.allowedValues.length > 0) {
        // Handle invalid_value errors - use first allowed value as default
        if (fieldName === 'type' && path.includes('design') && path.includes('level')) {
          current[fieldName] = 'circle'; // Default for design.level.type
          Logger.log(`Fixed invalid_value: ${path.join('.')} = "${current[fieldName]}" (from allowed values)`);
        } else {
          current[fieldName] = field.allowedValues[0];
          Logger.log(`Fixed invalid_value: ${path.join('.')} = "${current[fieldName]}" (from allowed values)`);
        }
      } else if (current[fieldName] === undefined || current[fieldName] === null) {
        // For title fields, use name if available even when undefined
        if (fieldName === 'title' && current.name && typeof current.name === 'string' && current.name.trim()) {
          current[fieldName] = current.name;
          Logger.log(`Fixed missing title: ${path.join('.')} = "${current[fieldName]}" (from name field)`);
        } else {
          current[fieldName] = defaultValue;
          Logger.log(`Fixed: ${path.join('.')} = ${JSON.stringify(defaultValue)}`);
        }
      } else if (expectedType === 'string' && current[fieldName] === '') {
        // Handle minimum length requirements - use field name or a default
        if (fieldName === 'title') {
          // For title fields, try to use 'name' field if available, otherwise use placeholder
          if (current.name && typeof current.name === 'string' && current.name.trim()) {
            current[fieldName] = current.name;
            Logger.log(`Fixed empty title: ${path.join('.')} = "${current[fieldName]}" (from name field)`);
          } else {
            current[fieldName] = 'Untitled';
            Logger.log(`Fixed empty title: ${path.join('.')} = "${current[fieldName]}"`);
          }
        } else if (fieldName === 'name') {
          current[fieldName] = 'Untitled';
          Logger.log(`Fixed empty string: ${path.join('.')} = "${current[fieldName]}"`);
        } else {
          current[fieldName] = defaultValue || '';
          Logger.log(`Fixed empty string: ${path.join('.')} = "${current[fieldName]}"`);
        }
      } else if (typeof current[fieldName] !== expectedType) {
        // Type mismatch - try to convert or use default
        if (expectedType === 'string') {
          current[fieldName] = String(current[fieldName] || '');
        } else if (expectedType === 'number') {
          current[fieldName] = typeof current[fieldName] === 'number' ? current[fieldName] : 0;
        } else if (expectedType === 'boolean') {
          current[fieldName] = Boolean(current[fieldName]);
        } else {
          current[fieldName] = defaultValue;
        }
        Logger.log(`Fixed type: ${path.join('.')} (was ${typeof current[fieldName]}, now ${expectedType})`);
      }
    }
  }
}

/* =========================================================
 * Render safety validation
 * ======================================================= */
function validateRenderSafety_(root) {
  const errors = [];
  
  // Assert: No newlines in summary
  if (root.data && root.data.summary && root.data.summary.content) {
    const content = root.data.summary.content;
    if (typeof content === 'string' && (content.includes('\n') || content.includes('\r'))) {
      errors.push('Summary content contains newline characters. Use normalizeSummaryContent_ to fix.');
    }
  }
  
  // Assert: Experience descriptions are arrays
  if (root.data && root.data.sections && root.data.sections.experience && root.data.sections.experience.items) {
    for (let i = 0; i < root.data.sections.experience.items.length; i++) {
      const item = root.data.sections.experience.items[i];
      if (item) {
        // Experience items MUST have description as array (even if empty)
        if (item.description === undefined || item.description === null) {
          // Missing description - set to empty array
          item.description = [];
          Logger.log(`Fixed: Experience item ${i} had missing description, set to empty array`);
        } else if (!Array.isArray(item.description)) {
          // Wrong type - convert to array
          const descStr = String(item.description || '').trim();
          if (descStr) {
            // Split and clean (• and * only, NOT hyphens)
            let bullets = descStr.split(/\n+/);
            if (bullets.length === 1 && /[•*]/.test(descStr)) {
              bullets = descStr.split(/(?=[•*])\s*/);
            }
            bullets = bullets.map(b => {
              // Remove bullet characters (• and * only, NOT hyphens)
              b = b.replace(/^[\s]*[•*]\s*/, '').replace(/[\s]*[•*]\s*$/, '');
              return b.trim();
            }).filter(b => b.length > 0);
            item.description = bullets.length > 0 ? bullets : [descStr];
          } else {
            item.description = [];
          }
          Logger.log(`Fixed: Experience item ${i} ("${item.company || item.position || 'Unknown'}") description was ${typeof item.description}, converted to array`);
        } else {
          // Validate array contents - check bullet count
          const bulletCount = item.description.length;
          if (bulletCount === 0) {
            Logger.log(`WARNING: Experience item ${i} ("${item.company || item.position || 'Unknown'}") has 0 bullets (expected 3)`);
          } else if (bulletCount < 3) {
            Logger.log(`WARNING: Experience item ${i} ("${item.company || item.position || 'Unknown'}") has ${bulletCount} bullets (expected 3)`);
          }
          
          // Check for bullet characters (• and * only) or newlines in array elements
          for (let j = 0; j < item.description.length; j++) {
            const bullet = item.description[j];
            if (typeof bullet === 'string' && (/^[\s]*[•*]/.test(bullet) || bullet.includes('\n'))) {
              errors.push(`Experience item ${i}, bullet ${j} contains bullet characters or newlines: "${bullet.substring(0, 50)}"`);
            }
          }
        }
      }
    }
  }
  
  // Auto-fix: Truncate sidebar item lengths > 40 chars (instead of throwing error)
  if (root.data && root.data.sections && root.data.sections.skills && root.data.sections.skills.items) {
    for (let i = 0; i < root.data.sections.skills.items.length; i++) {
      const skill = root.data.sections.skills.items[i];
      if (skill) {
        if (skill.name && typeof skill.name === 'string' && skill.name.length > 40) {
          Logger.log(`Auto-fixing: Skill ${i} name exceeds 40 chars, truncating: "${skill.name.substring(0, 50)}"`);
          skill.name = skill.name.substring(0, 37) + '...';
        }
        if (skill.keywords && Array.isArray(skill.keywords)) {
          for (let j = 0; j < skill.keywords.length; j++) {
            const kw = skill.keywords[j];
            if (typeof kw === 'string' && kw.length > 40) {
              Logger.log(`Auto-fixing: Skill ${i}, keyword ${j} exceeds 40 chars, truncating: "${kw.substring(0, 50)}"`);
              skill.keywords[j] = kw.substring(0, 37) + '...';
            }
          }
        }
      }
    }
  }
  
  if (errors.length > 0) {
    const errorMsg = 'Render safety validation failed:\n' + errors.join('\n');
    Logger.log('ERROR: ' + errorMsg);
    throw new Error(errorMsg);
  }
}

/* =========================================================
 * Reactive Resume API calls
 * ======================================================= */
function rrImportResume_(baseUrl, apiKey, fullPayloadObj) {
  Logger.log('=== PRE-API CALL DIAGNOSTICS ===');
  
  // Log summary
  if (fullPayloadObj.data && fullPayloadObj.data.summary) {
    Logger.log('Summary:');
    Logger.log(`  Content length: ${fullPayloadObj.data.summary.content ? fullPayloadObj.data.summary.content.length : 0} chars`);
    Logger.log(`  Content preview: ${fullPayloadObj.data.summary.content ? fullPayloadObj.data.summary.content.substring(0, 150) : 'N/A'}`);
    Logger.log(`  Hidden: ${fullPayloadObj.data.summary.hidden}`);
  }
  
  // Log experience items
  if (fullPayloadObj.data && fullPayloadObj.data.sections && fullPayloadObj.data.sections.experience) {
    const expItems = fullPayloadObj.data.sections.experience.items || [];
    Logger.log(`Experience section: ${expItems.length} items`);
    
    for (let i = 0; i < expItems.length; i++) {
      const item = expItems[i];
      Logger.log(`  Experience Item ${i}:`);
      Logger.log(`    Company: ${item.company || 'N/A'}`);
      Logger.log(`    Position: ${item.position || 'N/A'}`);
      Logger.log(`    Description type: ${typeof item.description}`);
      Logger.log(`    Description isArray: ${Array.isArray(item.description)}`);
      if (Array.isArray(item.description)) {
        Logger.log(`    Description array length: ${item.description.length}`);
        Logger.log(`    Description bullets: ${JSON.stringify(item.description)}`);
      } else {
        Logger.log(`    Description value: ${String(item.description || '').substring(0, 100)}`);
      }
      if (item.highlights !== undefined) {
        Logger.log(`    Highlights type: ${typeof item.highlights}`);
        Logger.log(`    Highlights isArray: ${Array.isArray(item.highlights)}`);
        if (Array.isArray(item.highlights)) {
          Logger.log(`    Highlights array length: ${item.highlights.length}`);
        }
      }
    }
  }
  
  // Log layout structure
  if (fullPayloadObj.data && fullPayloadObj.data.metadata && fullPayloadObj.data.metadata.layout) {
    Logger.log('Layout structure:');
    if (fullPayloadObj.data.metadata.layout.pages) {
      fullPayloadObj.data.metadata.layout.pages.forEach((page, idx) => {
        Logger.log(`  Page ${idx}: fullWidth=${page.fullWidth}, main=${JSON.stringify(page.main)}, sidebar=${JSON.stringify(page.sidebar)}`);
      });
    }
  }
  
  Logger.log('=== END PRE-API CALL DIAGNOSTICS ===');
  
  // CRITICAL: Convert experience description arrays to strings (API requirement)
  // This must happen AFTER all validation and normalization, but BEFORE JSON serialization
  convertExperienceDescriptionsToStrings_(fullPayloadObj);
  
  // Log the final JSON payload for debugging
  try {
    const jsonPayload = JSON.stringify(fullPayloadObj, null, 2);
    Logger.log('=== Final JSON Payload Being Sent to Reactive Resume API ===');
    Logger.log(jsonPayload);
    Logger.log('=== End of JSON Payload ===');
  } catch (e) {
    Logger.log('Error serializing JSON payload for logging: ' + e.message);
  }
  
  const url = joinUrl_(baseUrl, '/api/openapi/resume/import');
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { 'x-api-key': apiKey },
    payload: JSON.stringify(fullPayloadObj)
  });

  const code = resp.getResponseCode();
  const body = resp.getContentText();

  if (code < 200 || code >= 300) {
    // Log FULL error response for debugging
    Logger.log('=== FULL API ERROR RESPONSE ===');
    Logger.log('HTTP Status Code: ' + code);
    Logger.log('Response Body:');
    Logger.log(body);
    Logger.log('=== END FULL API ERROR RESPONSE ===');
    
    // Try to parse validation errors and auto-fix
    if (code === 400) {
      const missingFields = parseApiValidationErrors_(body);
      if (missingFields.length > 0) {
        Logger.log(`Detected ${missingFields.length} validation errors. Attempting auto-fix...`);
        
        // Apply fixes to the payload
        applyFieldFixes_(fullPayloadObj, missingFields);
        
        // Re-validate the fixed payload
        validateAndHardenForImport_(fullPayloadObj);
        
        // CRITICAL: Convert experience description arrays to strings again (API requirement)
        // This is needed in case validation/normalization converted them back to arrays
        convertExperienceDescriptionsToStrings_(fullPayloadObj);
        
        // Retry the request with fixed payload
        Logger.log('Retrying request with fixed payload...');
        const retryResp = UrlFetchApp.fetch(url, {
          method: 'post',
          contentType: 'application/json',
          muteHttpExceptions: true,
          headers: { 'x-api-key': apiKey },
          payload: JSON.stringify(fullPayloadObj)
        });
        
        const retryCode = retryResp.getResponseCode();
        const retryBody = retryResp.getContentText();
        
        if (retryCode >= 200 && retryCode < 300) {
          Logger.log('Auto-fix successful! Request succeeded on retry.');
          return parseMaybeJsonString_(retryBody);
        } else {
          // Still failed after auto-fix - log remaining errors
          const remainingErrors = parseApiValidationErrors_(retryBody);
          Logger.log(`Auto-fix applied but ${remainingErrors.length} errors remain.`);
          Logger.log('Remaining errors: ' + JSON.stringify(remainingErrors, null, 2));
          throw new Error(`Reactive Resume import failed HTTP ${retryCode} after auto-fix: ${retryBody.substring(0, 800)}`);
        }
      }
    }
    
    // If not a validation error or auto-fix didn't work, throw original error
    throw new Error(`Reactive Resume import failed HTTP ${code}: ${body.substring(0, 800)}`);
  }

  return parseMaybeJsonString_(body);
}

function rrExportPdf_(baseUrl, apiKey, resumeId) {
  const url = joinUrl_(baseUrl, `/api/openapi/printer/resume/${encodeURIComponent(resumeId)}/pdf`);
  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: { 'x-api-key': apiKey }
  });

  const code = resp.getResponseCode();
  const body = resp.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error(`Reactive Resume PDF export failed HTTP ${code}: ${body.substring(0, 800)}`);
  }

  return parseMaybeJsonString_(body);
}

function parseMaybeJsonString_(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    try { return JSON.parse(t); } catch (_) {}
  }
  return t.replace(/^"+|"+$/g, '');
}

function joinUrl_(base, path) {
  const b = String(base || '').replace(/\/+$/,'');
  const p = String(path || '').replace(/^\/+/, '');
  return `${b}/${p}`;
}

/* =========================================================
 * Download PDF and save to Google Drive with custom filename
 * ======================================================= */
function downloadAndSavePdfToDrive_(pdfUrl, filename, apiKey) {
  try {
    // Download PDF from URL (may require API key for authentication)
    let pdfBlob;
    try {
      // Try direct download first
      pdfBlob = UrlFetchApp.fetch(pdfUrl).getBlob();
    } catch (e) {
      // If direct download fails, try with API key header
      if (apiKey) {
        pdfBlob = UrlFetchApp.fetch(pdfUrl, {
          headers: { 'x-api-key': apiKey }
        }).getBlob();
      } else {
        throw e;
      }
    }
    
    // Verify it's actually a PDF
    if (pdfBlob.getContentType() !== 'application/pdf') {
      Logger.log('Warning: Downloaded file is not a PDF, content type: ' + pdfBlob.getContentType());
    }
    
    pdfBlob.setName(filename);
    
    // Save to Google Drive root folder
    const file = DriveApp.createFile(pdfBlob);
    
    // Make file shareable (anyone with link can view)
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    // Return shareable URL
    return file.getUrl();
  } catch (e) {
    Logger.log('Error downloading/saving PDF to Drive: ' + e.message);
    Logger.log('PDF URL was: ' + pdfUrl);
    // Fallback: return original URL if Drive save fails
    return pdfUrl;
  }
}

/* =========================================================
 * Utilities
 * ======================================================= */
function val_(sh, a1) {
  return String(sh.getRange(a1).getValue() || '').trim();
}

function getScriptProp_(key) {
  return (PropertiesService.getScriptProperties().getProperty(key) || '').trim();
}

function assertIsObject_(v, label) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error(`${label} must be a JSON object`);
  }
}

/* =========================================================
 * Validate resume text structure
 * ======================================================= */
function validateResumeText_(text) {
  const issues = [];
  
  if (!text || text.trim().length < 100) {
    issues.push('Resume text is too short (less than 100 characters)');
  }
  
  // Check for key sections
  const hasName = /[A-Z][a-z]+\s+[A-Z][a-z]+/.test(text);
  const hasEmail = /@/.test(text);
  const hasExperience = /experience|work|employment/i.test(text);
  
  if (!hasName) issues.push('Could not find a name pattern');
  if (!hasEmail) issues.push('Could not find an email address');
  if (!hasExperience) issues.push('Could not find Experience section');
  
  if (issues.length > 0) {
    Logger.log('WARNING: Resume text validation issues:');
    issues.forEach(i => Logger.log('  - ' + i));
  }
  
  return issues;
}