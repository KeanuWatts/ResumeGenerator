import { Router } from "express";
import { z } from "zod";
import { Template } from "../models/Template.js";
import { authMiddleware } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";

const router = Router();

router.use(authMiddleware);

const templateCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  templateType: z.enum(["reactive_resume", "custom_html"]).optional(),
  reactiveResumeJson: z.any().optional(),
  htmlTemplate: z.string().optional(),
  cssStyles: z.string().optional(),
  options: z.any().optional(),
  sectionOrder: z.array(z.string()).optional(),
  sidebarSections: z.array(z.string()).optional(),
  isPublic: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

router.get("/", async (req, res) => {
  try {
    const list = await Template.find({
      $or: [{ userId: null }, { userId: req.userId }, { isPublic: true }],
    })
      .sort({ isDefault: -1, name: 1 })
      .lean();
    res.status(200).json({ success: true, data: list, total: list.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = templateCreateSchema.parse(req.body);
    const template = await Template.create({ ...body, userId: req.userId });
    await recordAudit(req, {
      action: "template.create",
      resourceType: "template",
      resourceId: template._id,
    });
    res.status(201).json({ success: true, data: template });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ success: false, error: err.errors?.[0]?.message || "Validation error" });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const template = await Template.findOne({
      _id: req.params.id,
      $or: [{ userId: null }, { userId: req.userId }, { isPublic: true }],
    }).lean();
    if (!template) return res.status(404).json({ success: false, error: "Template not found" });
    res.status(200).json(template);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const template = await Template.findOne({ _id: req.params.id });
    if (!template) return res.status(404).json({ success: false, error: "Template not found" });
    if (template.userId == null) return res.status(403).json({ success: false, error: "System templates cannot be updated" });
    if (String(template.userId) !== String(req.userId)) return res.status(403).json({ success: false, error: "Forbidden" });
    const updated = await Template.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: { ...req.body, updatedAt: new Date() } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, error: "Template not found" });
    await recordAudit(req, { action: "template.update", resourceType: "template", resourceId: template._id });
    res.status(200).json(updated);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const template = await Template.findOne({ _id: req.params.id });
    if (!template) return res.status(404).json({ success: false, error: "Template not found" });
    if (template.userId == null) return res.status(403).json({ success: false, error: "System templates cannot be deleted" });
    if (String(template.userId) !== String(req.userId)) return res.status(403).json({ success: false, error: "Forbidden" });
    await Template.findByIdAndDelete(req.params.id);
    await recordAudit(req, { action: "template.delete", resourceType: "template", resourceId: template._id });
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const previewSchema = z.object({ sampleData: z.any().optional() });

router.post("/:id/preview", async (req, res) => {
  try {
    const template = await Template.findOne({
      _id: req.params.id,
      $or: [{ userId: null }, { userId: req.userId }, { isPublic: true }],
    }).lean();
    if (!template) return res.status(404).json({ success: false, error: "Template not found" });
    const body = previewSchema.safeParse(req.body);
    const sampleData = body.success ? body.data.sampleData : undefined;
    res.status(200).json({
      success: true,
      data: {
        template: { name: template.name, templateType: template.templateType, options: template.options },
        reactiveResumeJson: template.reactiveResumeJson,
        htmlTemplate: template.htmlTemplate,
        cssStyles: template.cssStyles,
        sampleData: sampleData ?? null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
