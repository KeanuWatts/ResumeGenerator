import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { JobDescription } from "../models/JobDescription.js";
import { authMiddleware } from "../middleware/auth.js";
import { paginationMiddleware } from "../middleware/pagination.js";
import { extractJobFields } from "../services/ai.service.js";
import { recordAudit } from "../lib/audit.js";

const router = Router();

router.use(authMiddleware);

const createSchema = z.object({
  title: z.string().optional(),
  company: z.string().optional(),
  location: z.string().optional(),
  url: z.string().optional(),
  source: z.string().optional(),
  rawText: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: z.string().optional(),
});

router.get("/", paginationMiddleware, async (req, res) => {
  try {
    const { limit, offset } = req.pagination || { limit: 20, offset: 0 };
    const total = await JobDescription.countDocuments({ userId: req.userId });
    const list = await JobDescription.find({ userId: req.userId })
      .sort({ updatedAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean();
    res.status(200).json({ success: true, data: list, total });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const bulkImportSchema = z.object({
  jobs: z.array(
    z.object({
      title: z.string().optional(),
      company: z.string().optional(),
      location: z.string().optional(),
      url: z.string().optional(),
      source: z.string().optional(),
      rawText: z.string().optional(),
      notes: z.string().optional(),
      tags: z.array(z.string()).optional(),
      status: z.string().optional(),
    })
  ),
});

router.post("/bulk-import", async (req, res) => {
  try {
    const { jobs } = bulkImportSchema.parse(req.body);
    if (!jobs.length) return res.status(400).json({ success: false, error: "jobs array is required and non-empty" });
    const toCreate = jobs.map((j) => ({ userId: req.userId, ...j }));
    const created = await JobDescription.insertMany(toCreate);
    await recordAudit(req, {
      action: "job.bulk-import",
      resourceType: "jobDescription",
      details: { count: created.length },
    });
    res.status(201).json({
      success: true,
      data: { count: created.length, ids: created.map((d) => d._id.toString()) },
    });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ success: false, error: err.errors?.[0]?.message || "Validation error" });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

const bulkDeleteSchema = z.object({
  ids: z.array(z.string()),
});

router.delete("/bulk", async (req, res) => {
  try {
    const { ids } = bulkDeleteSchema.parse(req.body);
    if (!ids.length) return res.status(400).json({ success: false, error: "ids array is required and non-empty" });
    const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id)).filter(Boolean);
    const result = await JobDescription.deleteMany({ _id: { $in: objectIds }, userId: req.userId });
    await recordAudit(req, {
      action: "job.bulk-delete",
      resourceType: "jobDescription",
      details: { count: result.deletedCount },
    });
    res.status(200).json({ success: true, data: { deleted: result.deletedCount } });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ success: false, error: err.errors?.[0]?.message || "Validation error" });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/search", paginationMiddleware, async (req, res) => {
  try {
    const q = (req.query.q || "").toString().trim();
    const { limit, offset } = req.pagination || { limit: 20, offset: 0 };
    const filter = { userId: req.userId };
    if (q) filter.$text = { $search: q };
    const total = await JobDescription.countDocuments(filter);
    const list = await JobDescription.find(filter)
      .sort(q ? { score: { $meta: "textScore" } } : { updatedAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean();
    res.status(200).json({ success: true, data: list, total });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/tags", async (req, res) => {
  try {
    const tags = await JobDescription.distinct("tags", { userId: req.userId });
    const list = (tags || []).filter(Boolean).sort();
    res.status(200).json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = createSchema.parse(req.body);
    const job = await JobDescription.create({ userId: req.userId, ...body });
    res.status(201).json(job);
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ success: false, error: err.errors?.[0]?.message || "Validation error" });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const job = await JobDescription.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!job) return res.status(404).json({ success: false, error: "Job not found" });
    res.status(200).json(job);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const job = await JobDescription.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: { ...req.body, updatedAt: new Date() } },
      { new: true }
    );
    if (!job) return res.status(404).json({ success: false, error: "Job not found" });
    res.status(200).json(job);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const result = await JobDescription.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!result) return res.status(404).json({ success: false, error: "Job not found" });
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /jobs/extract - extract from raw text without saving
const extractBodySchema = z.object({ rawText: z.string().min(1) });

router.post("/extract", async (req, res) => {
  try {
    const { rawText } = extractBodySchema.parse(req.body);
    const extracted = await extractJobFields(rawText);
    await recordAudit(req, {
      action: "job.extract",
      resourceType: "jobDescription",
      details: { fromBody: true },
    });
    res.status(200).json({
      success: true,
      data: {
        title: extracted.title,
        company: extracted.company,
        ksas: extracted.ksas.map((term) => ({ term, category: "technologies", importance: "required", extracted: true })),
        acronyms: extracted.acronyms.map((acronym) => ({ acronym, expansion: "" })),
      },
    });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ success: false, error: err.errors?.[0]?.message || "Validation error" });
    }
    if (err.message?.includes("DEEPSEEK_API_KEY")) {
      return res.status(503).json({ success: false, error: "AI service not configured" });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /jobs/:id/extract - extract and persist to job
router.post("/:id/extract", async (req, res) => {
  try {
    const job = await JobDescription.findOne({ _id: req.params.id, userId: req.userId });
    if (!job) return res.status(404).json({ success: false, error: "Job not found" });
    const rawText = job.rawText || "";
    if (!rawText.trim()) return res.status(400).json({ success: false, error: "Job has no raw text to extract from" });

    const extracted = await extractJobFields(rawText);
    job.title = extracted.title || job.title;
    job.company = extracted.company || job.company;
    job.ksas = extracted.ksas.map((term) => ({ term, category: "technologies", importance: "required", extracted: true }));
    job.acronyms = extracted.acronyms.map((acronym) => ({ acronym, expansion: "" }));
    job.extracted = { ...job.extracted, title: extracted.title, company: extracted.company };
    job.processingStatus = "completed";
    job.processedAt = new Date();
    job.updatedAt = new Date();
    await job.save();

    await recordAudit(req, {
      action: "job.extract",
      resourceType: "jobDescription",
      resourceId: job._id,
    });

    res.status(200).json({
      success: true,
      data: {
        title: job.title,
        company: job.company,
        ksas: job.ksas,
        acronyms: job.acronyms,
      },
    });
  } catch (err) {
    if (err.message?.includes("DEEPSEEK_API_KEY")) {
      return res.status(503).json({ success: false, error: "AI service not configured" });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
