import { GeneratedDocument } from "../models/GeneratedDocument.js";
import { Resume } from "../models/Resume.js";
import { Template } from "../models/Template.js";
import { uploadPdf } from "./s3.service.js";

const RXRESUME_BASE = process.env.RXRESUME_BASE_URL || "";
const RXRESUME_API_KEY = process.env.RXRESUME_API_KEY || "";
const PDF_PRINTER_URL = process.env.PDF_PRINTER_URL || "";
const PDF_PRINTER_TOKEN = process.env.PDF_PRINTER_TOKEN || "";
const IDEMPOTENCY_RETENTION_HOURS = 24;

function escapeHtml(s) {
  if (s == null || s === "") return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function rrItem(id = uuid()) {
  return { id, hidden: false };
}

function rrWebsite(url, label = "") {
  return { url: url || "", label: label || "" };
}

/**
 * Build Reactive Resume schema JSON from our GeneratedDocument + Resume.
 * Only supports type "resume"; cover letters are not exported to PDF via RR.
 * @param {object} doc - GeneratedDocument (with content.tailoredSummary, etc.)
 * @param {object} resume - Resume (contact, experience, education, etc.)
 * @param {object} [template] - Optional Template (reactiveResumeJson for metadata)
 * @returns {object} RR import payload { data: { ... } }
 */
export function buildReactiveResumeJson(doc, resume, template) {
  const contact = resume?.contact || {};
  const loc = contact.location;
  const locationStr = [loc?.city, loc?.state, loc?.country].filter(Boolean).join(", ");
  const basics = {
    name: contact.fullName || "Candidate",
    headline: "",
    email: contact.email || "",
    phone: contact.phone || "",
    location: locationStr,
    website: rrWebsite(contact.website || contact.portfolio),
    customFields: [],
  };
  const summary = {
    title: "Summary",
    columns: 1,
    hidden: !doc?.content?.tailoredSummary,
    content: (doc?.content?.tailoredSummary || "").replace(/\n/g, "<br/>"),
  };
  const experienceItems = (doc?.content?.experienceWithRelevance || []).map((exp, i) => {
    const src = (resume?.experience || [])[i] || {};
    const period = [src.startDate, src.endDate]
      .filter(Boolean)
      .map((d) => (d instanceof Date ? d.toLocaleDateString("en-US", { year: "numeric", month: "short" }) : String(d)))
      .join(" – ");
    const bullets = (exp.bullets || []).map((b) => `<li>${String(b).replace(/</g, "&lt;")}</li>`).join("");
    const description = bullets ? `<ul>${bullets}</ul>` : (src.description || "").replace(/\n/g, "<br/>");
    return {
      ...rrItem(),
      company: src.employer || "Company",
      position: src.title || "Role",
      location: src.location || "",
      period: period || "",
      website: rrWebsite(),
      description,
    };
  });
  const experience = {
    title: "Experience",
    columns: 1,
    hidden: experienceItems.length === 0,
    items: experienceItems,
  };
  const educationItems = (resume?.education || []).slice(0, 5).map((edu) => ({
    ...rrItem(),
    school: edu.institution || "",
    degree: edu.degree || "",
    area: edu.field || "",
    grade: edu.gpa || "",
    location: edu.location || "",
    period: [edu.startDate, edu.endDate]
      .filter(Boolean)
      .map((d) => (d instanceof Date ? d.toLocaleDateString("en-US", { year: "numeric", month: "short" }) : String(d)))
      .join(" – "),
    website: rrWebsite(),
    description: "",
  }));
  const education = {
    title: "Education",
    columns: 1,
    hidden: educationItems.length === 0,
    items: educationItems,
  };
  const skillItems = (doc?.content?.tailoredSkills || []).map((s) => ({
    ...rrItem(),
    icon: "",
    name: s.name || "Skills",
    proficiency: "intermediate",
    level: 2.5,
    keywords: s.keywords || [],
  }));
  const skills = {
    title: "Skills",
    columns: 1,
    hidden: skillItems.length === 0,
    items: skillItems,
  };
  const defaultMetadata = {
    template: "azurill",
    layout: { sidebarWidth: 30, pages: [{ fullWidth: false, main: ["summary", "experience", "education", "skills"], sidebar: [] }] },
    css: { enabled: false, value: "" },
    page: { gapX: 16, gapY: 16, marginX: 16, marginY: 16, format: "a4", locale: "en" },
    design: { level: { icon: "circle", type: "border" }, colors: { primary: "rgba(0,0,0,1)", text: "rgba(0,0,0,1)", background: "rgba(255,255,255,1)" } },
    typography: {
      body: { fontFamily: "Inter", fontWeights: ["400"], fontSize: 14, lineHeight: 2 },
      heading: { fontFamily: "Inter", fontWeights: ["700"], fontSize: 20, lineHeight: 1.5 },
    },
    notes: "",
  };
  const metadata = template?.reactiveResumeJson?.metadata
    ? { ...defaultMetadata, ...template.reactiveResumeJson.metadata }
    : defaultMetadata;
  const data = {
    picture: { hidden: true, url: "", size: 128, rotation: 0, aspectRatio: 1, borderRadius: 0, borderColor: "", borderWidth: 0, shadowColor: "", shadowWidth: 0 },
    basics,
    summary,
    sections: {
      profiles: { title: "Profiles", columns: 1, hidden: true, items: [] },
      experience,
      education,
      projects: { title: "Projects", columns: 1, hidden: true, items: [] },
      skills,
      languages: { title: "Languages", columns: 1, hidden: true, items: [] },
      interests: { title: "Interests", columns: 1, hidden: true, items: [] },
      awards: { title: "Awards", columns: 1, hidden: true, items: [] },
      certifications: { title: "Certifications", columns: 1, hidden: true, items: [] },
      publications: { title: "Publications", columns: 1, hidden: true, items: [] },
      volunteer: { title: "Volunteer", columns: 1, hidden: true, items: [] },
      references: { title: "References", columns: 1, hidden: true, items: [] },
    },
    customSections: [],
    metadata,
  };
  return { data };
}

/**
 * Build a simple HTML resume for direct PDF rendering (browserless). Used when RXRESUME_API_KEY is not set.
 * @param {object} doc - GeneratedDocument (with content.tailoredSummary, etc.)
 * @param {object} resume - Resume (contact, experience, education)
 * @returns {string} HTML document
 */
export function buildResumeHtml(doc, resume) {
  const contact = resume?.contact || {};
  const loc = contact.location;
  const locationStr = [loc?.city, loc?.state, loc?.country].filter(Boolean).join(", ");
  const name = escapeHtml(contact.fullName || "Candidate");
  const email = escapeHtml(contact.email || "");
  const phone = escapeHtml(contact.phone || "");
  const summary = escapeHtml((doc?.content?.tailoredSummary || "").replace(/\n/g, "<br/>"));
  const experienceItems = (doc?.content?.experienceWithRelevance || []).map((exp, i) => {
    const src = (resume?.experience || [])[i] || {};
    const period = [src.startDate, src.endDate]
      .filter(Boolean)
      .map((d) => (d instanceof Date ? d.toLocaleDateString("en-US", { year: "numeric", month: "short" }) : String(d)))
      .join(" – ");
    const bullets = (exp.bullets || []).map((b) => `<li>${escapeHtml(String(b))}</li>`).join("");
    return {
      title: escapeHtml(src.title || "Role"),
      employer: escapeHtml(src.employer || "Company"),
      period: escapeHtml(period),
      description: bullets ? `<ul>${bullets}</ul>` : escapeHtml(src.description || "").replace(/\n/g, "<br/>"),
    };
  });
  const educationItems = (resume?.education || []).slice(0, 5).map((edu) => ({
    institution: escapeHtml(edu.institution || ""),
    degree: escapeHtml(edu.degree || ""),
    field: escapeHtml(edu.field || ""),
    period: [edu.startDate, edu.endDate]
      .filter(Boolean)
      .map((d) => (d instanceof Date ? d.toLocaleDateString("en-US", { year: "numeric", month: "short" }) : String(d)))
      .join(" – "),
  }));
  const skillGroups = (doc?.content?.tailoredSkills || []).map((s) => ({
    name: escapeHtml(s.name || "Skills"),
    keywords: (s.keywords || []).map((k) => escapeHtml(k)).join(", "),
  }));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Resume – ${name}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; font-size: 11pt; line-height: 1.4; color: #222; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { font-size: 22pt; margin: 0 0 8px 0; }
    .contact { color: #444; font-size: 10pt; margin-bottom: 16px; }
    .contact span + span::before { content: " · "; }
    h2 { font-size: 12pt; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #ccc; margin: 16px 0 8px 0; padding-bottom: 4px; }
    .job { margin-bottom: 12px; }
    .job-title { font-weight: 600; }
    .job-meta { color: #555; font-size: 10pt; margin-bottom: 4px; }
    ul { margin: 4px 0; padding-left: 20px; }
    .edu-item { margin-bottom: 8px; }
    .skills p { margin: 2px 0; }
  </style>
</head>
<body>
  <h1>${name}</h1>
  <div class="contact">
    ${[email, phone, locationStr].filter(Boolean).map((x) => `<span>${x}</span>`).join("")}
  </div>
  ${summary ? `<h2>Summary</h2><p>${summary}</p>` : ""}
  ${experienceItems.length ? `<h2>Experience</h2>${experienceItems.map((j) => `<div class="job"><div class="job-title">${j.title}</div><div class="job-meta">${j.employer}${j.period ? " · " + j.period : ""}</div><div>${j.description}</div></div>`).join("")}` : ""}
  ${educationItems.length ? `<h2>Education</h2>${educationItems.map((e) => `<div class="edu-item"><strong>${e.degree}${e.field ? ", " + e.field : ""}</strong> – ${e.institution}${e.period ? " · " + e.period : ""}</div>`).join("")}` : ""}
  ${skillGroups.length ? `<h2>Skills</h2>${skillGroups.map((g) => `<p><strong>${g.name}:</strong> ${g.keywords}</p>`).join("")}` : ""}
</body>
</html>`;
}

/**
 * Generate PDF via browserless printer (no Reactive Resume). Requires PDF_PRINTER_URL.
 * @param {string} generatedDocumentId
 * @param {string} userId
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<{ url: string, expiresAt: Date }>}
 */
async function exportDocumentToPdfViaPrinter(generatedDocumentId, userId, fetchFn = fetch) {
  const doc = await GeneratedDocument.findOne({ _id: generatedDocumentId, userId }).lean();
  if (!doc) throw new Error("Document not found");
  const resume = await Resume.findOne({ _id: doc.resumeId, userId }).lean();
  if (!resume) throw new Error("Resume not found");
  const html = buildResumeHtml(doc, resume);
  const base = PDF_PRINTER_URL.replace(/\/$/, "");
  const token = PDF_PRINTER_TOKEN ? `?token=${encodeURIComponent(PDF_PRINTER_TOKEN)}` : "";
  const res = await fetchFn(`${base}/pdf${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      html,
      options: { format: "A4", printBackground: true },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PDF printer failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const pdfBuffer = Buffer.from(await res.arrayBuffer());
  const s3Key = `exports/${userId}/${doc._id}.pdf`;
  const { url, expiresAt } = await uploadPdf(s3Key, pdfBuffer, "application/pdf");
  await GeneratedDocument.updateOne(
    { _id: generatedDocumentId, userId },
    {
      $push: {
        exports: {
          format: "pdf",
          url,
          generatedAt: new Date(),
          expiresAt,
        },
      },
      updatedAt: new Date(),
    }
  );
  return { url, expiresAt };
}

/**
 * Call Reactive Resume import API. Returns RR resume ID.
 * @param {object} rrPayload - { data: ... } from buildReactiveResumeJson
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<string>} RR resume id
 */
export async function importToReactiveResume(rrPayload, fetchFn = fetch) {
  if (!RXRESUME_BASE || !RXRESUME_API_KEY) {
    throw new Error(
      "PDF export requires RXRESUME_BASE_URL and RXRESUME_API_KEY. " +
        "Start Reactive Resume (e.g. docker compose --profile pdf up), open it in the browser, sign in, go to Settings → API Keys, create a key, then set RXRESUME_API_KEY."
    );
  }
  const base = RXRESUME_BASE.replace(/\/$/, "");
  const url = `${base}/api/openapi/resume/import`;
  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": RXRESUME_API_KEY,
    },
    body: JSON.stringify(rrPayload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Reactive Resume import failed: ${res.status} ${text}`);
  }
  const id = await res.json();
  return typeof id === "string" ? id : id?.id || String(id);
}

/**
 * Get PDF download URL from Reactive Resume printer API.
 * @param {string} rrResumeId
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<string>} URL to PDF (temporary)
 */
export async function getPdfUrlFromReactiveResume(rrResumeId, fetchFn = fetch) {
  if (!RXRESUME_BASE || !RXRESUME_API_KEY) {
    throw new Error(
      "PDF export requires RXRESUME_BASE_URL and RXRESUME_API_KEY. " +
        "Start Reactive Resume (e.g. docker compose --profile pdf up), open it in the browser, sign in, go to Settings → API Keys, create a key, then set RXRESUME_API_KEY."
    );
  }
  const base = RXRESUME_BASE.replace(/\/$/, "");
  const url = `${base}/api/openapi/printer/resume/${encodeURIComponent(rrResumeId)}/pdf`;
  const res = await fetchFn(url, {
    method: "GET",
    headers: { "x-api-key": RXRESUME_API_KEY },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Reactive Resume PDF export failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  const pdfUrl = data?.url;
  if (!pdfUrl) throw new Error("Reactive Resume did not return a PDF URL");
  return pdfUrl;
}

/**
 * Export a generated document (resume type) to PDF: build RR JSON, import to RR, get PDF URL,
 * download PDF, upload to S3, update document.exports. Cover letters are not supported for RR PDF.
 * @param {string} generatedDocumentId
 * @param {string} userId
 * @param {string} [templateId]
 * @returns {Promise<{ url: string, expiresAt: Date }>}
 */
export async function exportDocumentToPdf(generatedDocumentId, userId, templateId) {
  const doc = await GeneratedDocument.findOne({ _id: generatedDocumentId, userId }).lean();
  if (!doc) throw new Error("Document not found");
  if (doc.type !== "resume") {
    throw new Error("PDF export is only supported for resume documents; use download for cover letters");
  }
  const existingExport = (doc.exports || []).find((e) => e.format === "pdf" && e.url);
  if (existingExport?.url) {
    return { url: existingExport.url, expiresAt: existingExport.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) };
  }
  const resume = await Resume.findOne({ _id: doc.resumeId, userId }).lean();
  if (!resume) throw new Error("Resume not found");

  if (RXRESUME_BASE && RXRESUME_API_KEY) {
    let template = null;
    if (templateId) {
      template = await Template.findOne({ _id: templateId, $or: [{ userId: null }, { userId }, { isPublic: true }] }).lean();
    }
    if (!template) {
      template = await Template.findOne({ $or: [{ isDefault: true }, { userId: null }] }).sort({ isDefault: -1 }).lean();
    }
    const rrPayload = buildReactiveResumeJson(doc, resume, template);
    const rrResumeId = await importToReactiveResume(rrPayload);
    const pdfUrl = await getPdfUrlFromReactiveResume(rrResumeId);
    const pdfRes = await fetch(pdfUrl);
    if (!pdfRes.ok) throw new Error("Failed to download PDF from Reactive Resume");
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    const s3Key = `exports/${userId}/${doc._id}.pdf`;
    const { url, expiresAt } = await uploadPdf(s3Key, pdfBuffer, "application/pdf");
    await GeneratedDocument.updateOne(
      { _id: generatedDocumentId, userId },
      {
        $push: {
          exports: { format: "pdf", url, externalId: rrResumeId, generatedAt: new Date(), expiresAt },
        },
        updatedAt: new Date(),
      }
    );
    return { url, expiresAt };
  }

  if (PDF_PRINTER_URL) {
    return exportDocumentToPdfViaPrinter(generatedDocumentId, userId);
  }

  throw new Error(
    "PDF export requires either PDF_PRINTER_URL (built-in printer) or RXRESUME_BASE_URL + RXRESUME_API_KEY. " +
      "Start the stack with docker compose up -d (printer is included) to use the built-in PDF export."
  );
}
