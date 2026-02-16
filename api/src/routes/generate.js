import { Router } from "express";
import { z } from "zod";
import { Resume } from "../models/Resume.js";
import { JobDescription } from "../models/JobDescription.js";
import { GeneratedDocument } from "../models/GeneratedDocument.js";
import { authMiddleware } from "../middleware/auth.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import { recordAudit } from "../lib/audit.js";
import { tailorSummary, generateCoverLetterBody, enhanceBullets, isAiConfigured } from "../services/ai.service.js";

const router = Router();

router.use(authMiddleware);

const generateResumeSchema = z.object({
  resumeId: z.string().min(1),
  jobDescriptionId: z.string().min(1),
});

/**
 * Simple keyword-based KSA matching.
 */
function simpleKsaMatch(resumeText, ksaTerms) {
  const lower = (resumeText || "").toLowerCase();
  const matched = [];
  for (const term of ksaTerms) {
    const t = String(term).toLowerCase();
    if (t && lower.includes(t)) matched.push(term);
  }
  return matched;
}

function buildResumeText(resume) {
  return [
    resume.contact?.fullName,
    resume.summary?.content,
    (resume.skills || []).flatMap((s) => s.items || []).join(" "),
    (resume.experience || []).map((e) => e.description || (e.bullets || []).join(" ")).join(" "),
  ]
    .filter(Boolean)
    .join(" ");
}

router.post("/resume/preview", async (req, res) => {
  try {
    const { resumeId, jobDescriptionId } = generateResumeSchema.parse(req.body);
    const resume = await Resume.findOne({ _id: resumeId, userId: req.userId });
    if (!resume) return res.status(404).json({ success: false, error: "Resume not found" });
    const job = await JobDescription.findOne({ _id: jobDescriptionId, userId: req.userId });
    if (!job) return res.status(404).json({ success: false, error: "Job not found" });
    const resumeText = buildResumeText(resume);
    const jobText = job.rawText || [job.title, job.company].filter(Boolean).join(" ");
    const ksaTerms = (job.ksas || []).map((k) => k.term).filter(Boolean);
    const matchedKsas = simpleKsaMatch(resumeText, ksaTerms);
    let tailoredSummaryText = resume.summary?.content || "";
    if (isAiConfigured() && jobText) {
      try {
        tailoredSummaryText = await tailorSummary(resume.summary?.content || "", jobText);
      } catch (_) {
        tailoredSummaryText = resume.summary?.content || "Tailored summary unavailable.";
      }
    } else if (!tailoredSummaryText) tailoredSummaryText = "Professional summary.";
    res.status(200).json({
      success: true,
      data: {
        tailoredSummary: tailoredSummaryText,
        tailoredSkills: (resume.skills || []).slice(0, 6).map((s) => ({ name: s.name || s.category, keywords: s.items || [] })),
        experienceWithRelevance: (resume.experience || []).map((exp) => ({
          experienceId: exp._id,
          bullets: exp.bullets || [],
          relevanceLine: "",
          matchedKsas: matchedKsas.slice(0, 3),
        })),
      },
    });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ success: false, error: err.errors?.[0]?.message || "Validation error" });
    if (err.message?.includes("AI service not configured")) return res.status(503).json({ success: false, error: "AI service not configured" });
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/cover-letter/preview", async (req, res) => {
  try {
    const { resumeId, jobDescriptionId } = generateResumeSchema.parse(req.body);
    const resume = await Resume.findOne({ _id: resumeId, userId: req.userId });
    if (!resume) return res.status(404).json({ success: false, error: "Resume not found" });
    const job = await JobDescription.findOne({ _id: jobDescriptionId, userId: req.userId });
    if (!job) return res.status(404).json({ success: false, error: "Job not found" });
    const resumeText = buildResumeText(resume);
    const jobContext = {
      title: job.title || job.extracted?.title,
      company: job.company || job.extracted?.company,
      ksas: (job.ksas || []).map((k) => k.term).join("; "),
      acronyms: (job.acronyms || []).map((a) => a.acronym).join(", "),
    };
    let letterBody = "";
    if (isAiConfigured()) {
      try {
        letterBody = await generateCoverLetterBody(resumeText, jobContext);
      } catch (err) {
        return res.status(503).json({ success: false, error: err.message || "AI service failed" });
      }
    } else {
      letterBody = `I am writing to apply for the ${jobContext.title || "position"} role at ${jobContext.company || "your company"}.`;
    }
    res.status(200).json({ success: true, data: { letterBody } });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ success: false, error: err.errors?.[0]?.message || "Validation error" });
    res.status(500).json({ success: false, error: err.message });
  }
});

const enhanceBulletsSchema = z.object({
  bullets: z.array(z.string()),
  jobContext: z.string(),
});

router.post("/enhance-bullets", async (req, res) => {
  try {
    const { bullets, jobContext } = enhanceBulletsSchema.parse(req.body);
    const enhanced = await enhanceBullets(bullets, jobContext);
    res.status(200).json({ success: true, data: { bullets: enhanced } });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ success: false, error: err.errors?.[0]?.message || "Validation error" });
    if (err.message?.includes("AI service not configured")) return res.status(503).json({ success: false, error: "AI service not configured" });
    res.status(500).json({ success: false, error: err.message });
  }
});

const tailorSummaryBodySchema = z.object({
  baseSummary: z.string(),
  jobDescriptionId: z.string().min(1),
});

router.post("/tailor-summary", async (req, res) => {
  try {
    const { baseSummary, jobDescriptionId } = tailorSummaryBodySchema.parse(req.body);
    const job = await JobDescription.findOne({ _id: jobDescriptionId, userId: req.userId });
    if (!job) return res.status(404).json({ success: false, error: "Job not found" });
    const jobText = job.rawText || [job.title, job.company].filter(Boolean).join(" ");
    const tailored = await tailorSummary(baseSummary, jobText);
    res.status(200).json({ success: true, data: { tailoredSummary: tailored } });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ success: false, error: err.errors?.[0]?.message || "Validation error" });
    if (err.message?.includes("AI service not configured")) return res.status(503).json({ success: false, error: "AI service not configured" });
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/resume", idempotencyMiddleware("generate/resume"), async (req, res) => {
  try {
    const { resumeId, jobDescriptionId } = generateResumeSchema.parse(req.body);

    const resume = await Resume.findOne({ _id: resumeId, userId: req.userId });
    if (!resume) return res.status(404).json({ success: false, error: "Resume not found" });

    const job = await JobDescription.findOne({ _id: jobDescriptionId, userId: req.userId });
    if (!job) return res.status(404).json({ success: false, error: "Job not found" });

    const resumeText = buildResumeText(resume);
    const jobText = job.rawText || [job.title, job.company].filter(Boolean).join(" ");
    const ksaTerms = (job.ksas || []).map((k) => k.term).filter(Boolean);
    const matchedKsas = simpleKsaMatch(resumeText, ksaTerms);
    const totalKsas = Math.max(ksaTerms.length, 1);
    const overallScore = Math.round((matchedKsas.length / totalKsas) * 100);

    let tailoredSummaryText = resume.summary?.content || "";
    if (isAiConfigured() && jobText) {
      try {
        tailoredSummaryText = await tailorSummary(resume.summary?.content || "", jobText);
      } catch (_) {
        tailoredSummaryText = resume.summary?.content || "Tailored summary unavailable.";
      }
    } else if (!tailoredSummaryText) {
      tailoredSummaryText = "Professional summary.";
    }

    const doc = await GeneratedDocument.create({
      userId: req.userId,
      resumeId: resume._id,
      jobDescriptionId: job._id,
      type: "resume",
      content: {
        tailoredSummary: tailoredSummaryText,
        tailoredSkills: (resume.skills || []).slice(0, 6).map((s) => ({ name: s.name || s.category, keywords: s.items || [] })),
        experienceWithRelevance: (resume.experience || []).map((exp) => ({
          experienceId: exp._id,
          bullets: exp.bullets || [],
          relevanceLine: "",
          matchedKsas: matchedKsas.slice(0, 3),
        })),
      },
      matchAnalysis: {
        overallScore,
        ksaMatches: matchedKsas.map((ksa) => ({ ksa, matchType: "token", confidence: 1, sourceEvidence: "" })),
        missingRequirements: ksaTerms.filter((t) => !matchedKsas.includes(t)).slice(0, 10),
        suggestions: [],
      },
      metadata: { version: "1.0", processingTimeMs: 0 },
    });

    await recordAudit(req, {
      action: "resume.generate",
      resourceType: "generatedDocument",
      resourceId: doc._id,
      details: { type: "resume" },
    });

    res.status(200).json({
      success: true,
      data: {
        documentId: doc._id.toString(),
        type: "resume",
        matchAnalysis: { overallScore, matchedKsas: matchedKsas.length, totalKsas },
        createdAt: doc.createdAt,
      },
    });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ success: false, error: err.errors?.[0]?.message || "Validation error" });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/cover-letter", idempotencyMiddleware("generate/cover-letter"), async (req, res) => {
  try {
    const { resumeId, jobDescriptionId } = generateResumeSchema.parse(req.body);

    const resume = await Resume.findOne({ _id: resumeId, userId: req.userId });
    if (!resume) return res.status(404).json({ success: false, error: "Resume not found" });

    const job = await JobDescription.findOne({ _id: jobDescriptionId, userId: req.userId });
    if (!job) return res.status(404).json({ success: false, error: "Job not found" });

    const resumeText = buildResumeText(resume);
    const jobContext = {
      title: job.title || job.extracted?.title,
      company: job.company || job.extracted?.company,
      ksas: (job.ksas || []).map((k) => k.term).join("; "),
      acronyms: (job.acronyms || []).map((a) => a.acronym).join(", "),
    };

    let letterBody = "";
    if (isAiConfigured()) {
      try {
        letterBody = await generateCoverLetterBody(resumeText, jobContext);
      } catch (err) {
        return res.status(503).json({ success: false, error: err.message || "AI service failed" });
      }
    } else {
      letterBody = `I am writing to apply for the ${jobContext.title || "position"} role at ${jobContext.company || "your company"}. My background aligns with the requirements. Please see my resume for details.`;
    }

    const doc = await GeneratedDocument.create({
      userId: req.userId,
      resumeId: resume._id,
      jobDescriptionId: job._id,
      type: "cover_letter",
      content: {
        letterBody,
        greeting: "Dear Hiring Manager,",
        closing: `Sincerely,\n${resume.contact?.fullName || "Candidate"}`,
      },
      metadata: { version: "1.0" },
    });

    await recordAudit(req, {
      action: "cover_letter.generate",
      resourceType: "generatedDocument",
      resourceId: doc._id,
      details: { type: "cover_letter" },
    });

    res.status(200).json({
      success: true,
      data: {
        documentId: doc._id.toString(),
        type: "cover_letter",
        createdAt: doc.createdAt,
      },
    });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ success: false, error: err.errors?.[0]?.message || "Validation error" });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

const matchAnalysisSchema = z.object({
  resumeId: z.string().min(1),
  jobDescriptionId: z.string().min(1),
});

router.post("/match-analysis", async (req, res) => {
  try {
    const { resumeId, jobDescriptionId } = matchAnalysisSchema.parse(req.body);

    const resume = await Resume.findOne({ _id: resumeId, userId: req.userId });
    if (!resume) return res.status(404).json({ success: false, error: "Resume not found" });

    const job = await JobDescription.findOne({ _id: jobDescriptionId, userId: req.userId });
    if (!job) return res.status(404).json({ success: false, error: "Job not found" });

    const resumeText = buildResumeText(resume);
    const ksaTerms = (job.ksas || []).map((k) => k.term).filter(Boolean);
    const matchedKsas = simpleKsaMatch(resumeText, ksaTerms);
    const totalKsas = Math.max(ksaTerms.length, 1);
    const overallScore = Math.round((matchedKsas.length / totalKsas) * 100);

    res.status(200).json({
      success: true,
      data: {
        score: overallScore,
        matches: matchedKsas.map((ksa) => ({ ksa, matchType: "token", confidence: 1 })),
        gaps: ksaTerms.filter((t) => !matchedKsas.includes(t)),
        suggestions: [],
      },
    });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ success: false, error: err.errors?.[0]?.message || "Validation error" });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
