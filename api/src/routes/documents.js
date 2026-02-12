import { Router } from "express";
import { GeneratedDocument } from "../models/GeneratedDocument.js";
import { authMiddleware } from "../middleware/auth.js";
import { paginationMiddleware } from "../middleware/pagination.js";

const router = Router();

router.use(authMiddleware);

router.get("/", paginationMiddleware, async (req, res) => {
  try {
    const { limit, offset } = req.pagination || { limit: 20, offset: 0 };
    const total = await GeneratedDocument.countDocuments({ userId: req.userId });
    const list = await GeneratedDocument.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean();
    res.status(200).json({ success: true, data: list, total });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const doc = await GeneratedDocument.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!doc) return res.status(404).json({ success: false, error: "Document not found" });
    res.status(200).json(doc);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const result = await GeneratedDocument.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!result) return res.status(404).json({ success: false, error: "Document not found" });
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
