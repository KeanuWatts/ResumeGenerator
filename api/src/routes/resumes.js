import { Router } from "express";
import mongoose from "mongoose";
import { Resume } from "../models/Resume.js";
import { authMiddleware } from "../middleware/auth.js";
import { paginationMiddleware } from "../middleware/pagination.js";
import { recordAudit } from "../lib/audit.js";
import { z } from "zod";

const router = Router();

router.use(authMiddleware);

const createSchema = z.object({ name: z.string().min(1), isDefault: z.boolean().optional() });

const importSchema = z.object({
  source: z.enum(["json", "linkedin"]),
  payload: z.any(),
});

const SECTION_KEYS = [
  "experience",
  "education",
  "skills",
  "certifications",
  "awards",
  "projects",
  "publications",
  "languages",
  "volunteering",
  "references",
];

async function getResumeOwned(resumeId, userId) {
  return Resume.findOne({ _id: resumeId, userId });
}

router.get("/", paginationMiddleware, async (req, res) => {
  try {
    const { limit, offset } = req.pagination || { limit: 20, offset: 0 };
    const total = await Resume.countDocuments({ userId: req.userId });
    const list = await Resume.find({ userId: req.userId })
      .sort({ updatedAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean();
    res.status(200).json({ success: true, data: list, total });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/import", async (req, res) => {
  try {
    const { source, payload } = importSchema.parse(req.body);
    if (source === "linkedin") {
      return res.status(501).json({ success: false, error: "LinkedIn import not implemented" });
    }
    const data = typeof payload === "string" ? JSON.parse(payload) : payload;
    const { _id: _discard, userId: _discard2, ...safe } = data;
    const name = safe.name || "Imported Resume";
    const resume = await Resume.create({ userId: req.userId, name, ...safe });
    await recordAudit(req, {
      action: "resume.import",
      resourceType: "resume",
      resourceId: resume._id,
      details: { source },
    });
    res.status(201).json({ success: true, data: resume });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ success: false, error: err.errors?.[0]?.message || "Validation error" });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = createSchema.parse(req.body);
    if (body.isDefault) {
      await Resume.updateMany({ userId: req.userId }, { $set: { isDefault: false } });
    }
    const resume = await Resume.create({ userId: req.userId, name: body.name, isDefault: body.isDefault ?? false });
    res.status(201).json({ success: true, data: resume });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ success: false, error: err.errors?.[0]?.message || "Validation error" });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/:id/export", async (req, res) => {
  try {
    const resume = await Resume.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!resume) return res.status(404).json({ success: false, error: "Resume not found" });
    await recordAudit(req, {
      action: "resume.export",
      resourceType: "resume",
      resourceId: resume._id,
    });
    res.setHeader("Content-Type", "application/json");
    res.status(200).json(resume);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const resume = await Resume.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!resume) return res.status(404).json({ success: false, error: "Resume not found" });
    res.status(200).json(resume);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const resume = await Resume.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: { ...req.body, updatedAt: new Date() } },
      { new: true }
    );
    if (!resume) return res.status(404).json({ success: false, error: "Resume not found" });
    res.status(200).json(resume);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const resume = await Resume.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: { ...req.body, updatedAt: new Date() } },
      { new: true }
    );
    if (!resume) return res.status(404).json({ success: false, error: "Resume not found" });
    res.status(200).json(resume);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const result = await Resume.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!result) return res.status(404).json({ success: false, error: "Resume not found" });
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function sectionGet(sectionKey) {
  return async (req, res) => {
    try {
      const resume = await getResumeOwned(req.params.id, req.userId);
      if (!resume) return res.status(404).json({ success: false, error: "Resume not found" });
      const list = resume[sectionKey] || [];
      res.status(200).json({ success: true, data: list });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  };
}

function sectionPost(sectionKey) {
  return async (req, res) => {
    try {
      const resume = await getResumeOwned(req.params.id, req.userId);
      if (!resume) return res.status(404).json({ success: false, error: "Resume not found" });
      resume[sectionKey].push(req.body);
      resume.updatedAt = new Date();
      await resume.save();
      const added = resume[sectionKey][resume[sectionKey].length - 1];
      res.status(201).json({ success: true, data: added });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  };
}

function sectionPut(sectionKey) {
  return async (req, res) => {
    try {
      const resume = await getResumeOwned(req.params.id, req.userId);
      if (!resume) return res.status(404).json({ success: false, error: "Resume not found" });
      const itemId = req.params.itemId;
      const idx = (resume[sectionKey] || []).findIndex((e) => String(e._id) === itemId);
      if (idx === -1) return res.status(404).json({ success: false, error: "Item not found" });
      resume[sectionKey][idx] = { ...resume[sectionKey][idx].toObject(), ...req.body, _id: resume[sectionKey][idx]._id };
      resume.updatedAt = new Date();
      await resume.save();
      res.status(200).json({ success: true, data: resume[sectionKey][idx] });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  };
}

function sectionDelete(sectionKey) {
  return async (req, res) => {
    try {
      const resume = await getResumeOwned(req.params.id, req.userId);
      if (!resume) return res.status(404).json({ success: false, error: "Resume not found" });
      const hasItem = (resume[sectionKey] || []).some((e) => String(e._id) === req.params.itemId);
      if (!hasItem) return res.status(404).json({ success: false, error: "Item not found" });
      await Resume.findOneAndUpdate(
        { _id: req.params.id, userId: req.userId },
        { $pull: { [sectionKey]: { _id: new mongoose.Types.ObjectId(req.params.itemId) } }, $set: { updatedAt: new Date() } }
      );
      res.status(200).json({ success: true });
    } catch (err) {
      if (err.name === "CastError") return res.status(404).json({ success: false, error: "Item not found" });
      res.status(500).json({ success: false, error: err.message });
    }
  };
}

for (const sectionKey of SECTION_KEYS) {
  router.get(`/:id/${sectionKey}`, sectionGet(sectionKey));
  router.post(`/:id/${sectionKey}`, sectionPost(sectionKey));
  router.put(`/:id/${sectionKey}/:itemId`, sectionPut(sectionKey));
  router.delete(`/:id/${sectionKey}/:itemId`, sectionDelete(sectionKey));
}

export default router;
