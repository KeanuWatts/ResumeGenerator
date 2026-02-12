/**
 * AI Service - DeepSeek integration.
 * Ported from ExtractJobReport.gs (extractJobFields).
 */

const DS_ENDPOINT = "https://api.deepseek.com/v1/chat/completions";
const DS_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DS_TEMPERATURE = parseFloat(process.env.DEEPSEEK_TEMPERATURE || "0.3", 10);
const MAX_INPUT_CHARS = 50000;

/**
 * @param {string} jobText - Raw job description text
 * @param {typeof fetch} [fetchFn] - Optional fetch implementation (for tests)
 * @returns {Promise<{ title: string, company: string, ksas: string[], acronyms: string[] }>}
 */
export async function extractJobFields(jobText, fetchFn = fetch) {
  const text = String(jobText || "").trim();
  if (!text) throw new Error("Job description text is required");
  if (text.length > MAX_INPUT_CHARS) {
    throw new Error(`Job text too long (${text.length}). Limit is ${MAX_INPUT_CHARS} characters.`);
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");

  const system =
    "You are a precise information extractor for job descriptions. " +
    "Return STRICT JSON with keys: title (string), company (string), " +
    "ksas (array of concise KSA phrases, max 25), acronyms (array of UPPERCASE strings). " +
    "If unknown, use an empty string or empty array. No extra keys, no commentary.";

  const user = "Extract fields from this job description:\n\n" + text;

  const payload = {
    model: DS_MODEL,
    temperature: DS_TEMPERATURE,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  };

  const res = await fetchFn(DS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DeepSeek HTTP ${res.status}: ${body}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "{}";
  let obj;
  try {
    obj = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    throw new Error("DeepSeek returned non-JSON content");
  }

  return {
    title: (obj.title ?? "").toString().trim(),
    company: (obj.company ?? "").toString().trim(),
    ksas: Array.isArray(obj.ksas)
      ? obj.ksas.map((s) => String(s).trim()).filter(Boolean)
      : [],
    acronyms: Array.isArray(obj.acronyms)
      ? obj.acronyms.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
      : [],
  };
}

/**
 * Tailor summary for a job. Ported from GenerateResume.gs (aiSummaryRewrite_).
 * @param {string} baseSummary
 * @param {string} jobDescriptionText
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<string>}
 */
export async function tailorSummary(baseSummary, jobDescriptionText, fetchFn = fetch) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return baseSummary || "";

  const system =
    "You are a resume summary rewriter. Rewrite the candidate's professional summary in 2-4 sentences to align with the job description. " +
    "Use only facts from the summary. No invented experience. Output only the rewritten summary, no preamble.";
  const user = `Job description:\n${(jobDescriptionText || "").slice(0, 8000)}\n\nCandidate summary to tailor:\n${baseSummary || ""}`;

  const payload = {
    model: DS_MODEL,
    temperature: Math.min(DS_TEMPERATURE, 0.5),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  const res = await fetchFn(DS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DeepSeek HTTP ${res.status}: ${body}`);
  }

  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content || "").trim();
  return text || baseSummary || "";
}

/**
 * Generate cover letter body. Ported from GenerateCV.gs.ts (callDeepSeek_CoverLetterBody_).
 * @param {string} resumeText
 * @param {{ title?: string, company?: string, ksas?: string, acronyms?: string }} jobContext
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<string>}
 */
export async function generateCoverLetterBody(resumeText, jobContext, fetchFn = fetch) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");

  const { title = "", company = "", ksas = "", acronyms = "" } = jobContext;
  const contextLines = [
    title ? `Target position: ${title}` : "",
    company ? `Company: ${company}` : "",
    ksas ? `Relevant KSAs: ${ksas}` : "",
    acronyms ? `Acronyms/context: ${acronyms}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const system =
    "You are a professional cover-letter writer. " +
    "Write ONLY the body paragraphs (no date line, no greeting, no closing, no signature). " +
    "3–5 concise paragraphs, ~220–350 words, clear US business English. " +
    "Strict grounding: use only facts from the provided resume text and KSAs/acronyms. " +
    "Do NOT invent employers, titles, dates, or achievements. No valediction or name.";

  const user = `${contextLines}\n\nResume (plaintext):\n${(resumeText || "").slice(0, MAX_INPUT_CHARS)}`;

  const payload = {
    model: DS_MODEL,
    temperature: 0.28,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  const res = await fetchFn(DS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DeepSeek HTTP ${res.status}: ${body}`);
  }

  const data = await res.json();
  let text = (data.choices?.[0]?.message?.content || "").trim();
  text = text.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "");
  return text.trim();
}

/**
 * Enhance resume bullet points for a job context.
 * @param {string[]} bullets - Original bullet points
 * @param {string} jobContext - Job description or context text
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<string[]>} Enhanced bullet points
 */
export async function enhanceBullets(bullets, jobContext, fetchFn = fetch) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");

  if (!Array.isArray(bullets) || bullets.length === 0) return bullets;

  const system =
    "You are a resume bullet enhancer. Given a list of resume bullet points and job context, " +
    "return a JSON object with key 'bullets' (array of strings): the same number of enhanced bullets, " +
    "each improved to align with the job while keeping facts. No extra keys, no commentary.";

  const user = `Job context:\n${(jobContext || "").slice(0, 8000)}\n\nResume bullets (one per line):\n${bullets.join("\n")}`;

  const payload = {
    model: DS_MODEL,
    temperature: Math.min(DS_TEMPERATURE, 0.4),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  };

  const res = await fetchFn(DS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DeepSeek HTTP ${res.status}: ${body}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "{}";
  let obj;
  try {
    obj = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    throw new Error("DeepSeek returned non-JSON content");
  }

  const out = Array.isArray(obj.bullets)
    ? obj.bullets.map((s) => String(s).trim()).filter(Boolean)
    : bullets;
  return out.length ? out : bullets;
}
