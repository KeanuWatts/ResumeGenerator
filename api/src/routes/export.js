import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import { exportDocumentToPdf } from "../services/export.service.js";
import { publishExportPdfJob } from "../lib/queue.js";
import { GeneratedDocument } from "../models/GeneratedDocument.js";
import { recordAudit } from "../lib/audit.js";

const router = Router();

router.use(authMiddleware);

const exportPdfSchema = z.object({
  generatedDocumentId: z.string().min(1),
  templateId: z.string().optional(),
  async: z.boolean().optional(),
});

router.post(
  "/pdf",
  idempotencyMiddleware("export/pdf"),
  async (req, res) => {
    try {
      const parsed = exportPdfSchema.parse(req.body);
      const { generatedDocumentId, templateId, async: asyncMode } = parsed;
      const doc = await GeneratedDocument.findOne({ _id: generatedDocumentId, userId: req.userId }).lean();
      if (!doc) return res.status(404).json({ success: false, error: "Document not found" });
      if (doc.type !== "resume") {
        return res.status(400).json({ success: false, error: "PDF export is only supported for resume documents" });
      }
      const existingExport = (doc.exports || []).find((e) => e.format === "pdf" && e.url);
      if (existingExport?.url) {
        await recordAudit(req, {
          action: "export.pdf",
          resourceType: "generatedDocument",
          resourceId: doc._id,
          details: { cached: true },
        });
        return res.status(200).json({
          success: true,
          data: { url: existingExport.url, expiresAt: existingExport.expiresAt },
        });
      }
      if (asyncMode && process.env.RABBITMQ_URL) {
        const published = await publishExportPdfJob({
          documentId: generatedDocumentId,
          userId: req.userId,
          templateId,
        });
        if (published) {
          return res.status(202).json({
            success: true,
            data: { jobId: generatedDocumentId, status: "processing" },
          });
        }
      }
      const result = await exportDocumentToPdf(generatedDocumentId, req.userId, templateId);
      await recordAudit(req, {
        action: "export.pdf",
        resourceType: "generatedDocument",
        resourceId: generatedDocumentId,
      });
      res.status(200).json({
        success: true,
        data: { url: result.url, expiresAt: result.expiresAt },
      });
    } catch (err) {
      if (err.name === "ZodError") {
        return res.status(400).json({ success: false, error: err.errors?.[0]?.message || "Validation error" });
      }
      if (err.message === "Document not found") {
        return res.status(404).json({ success: false, error: err.message });
      }
      if (err.message?.includes("only supported for resume")) {
        return res.status(400).json({ success: false, error: err.message });
      }
      res.status(503).json({ success: false, error: err.message || "Export failed" });
    }
  }
);

export default router;
