import { Router } from "express";
import { z } from "zod";
import { User } from "../models/User.js";
import { GeneratedDocument } from "../models/GeneratedDocument.js";
import { Resume } from "../models/Resume.js";
import { JobDescription } from "../models/JobDescription.js";
import { IdempotencyKey } from "../models/IdempotencyKey.js";
import { PasswordResetToken } from "../models/PasswordResetToken.js";
import { authMiddleware } from "../middleware/auth.js";
import { encrypt } from "../lib/encryption.js";
import { recordAudit } from "../lib/audit.js";

const router = Router();

router.use(authMiddleware);

const apiKeysSchema = z.object({
  deepseek: z.string().optional(),
  reactiveResume: z.string().optional(),
});

router.get("/profile", async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-passwordHash -refreshTokens -apiKeys");
    if (!user) return res.status(404).json({ success: false, error: "User not found" });
    res.status(200).json({ success: true, data: { profile: user.profile } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch("/profile", async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.userId,
      { $set: { "profile": req.body.profile || req.body, updatedAt: new Date() } },
      { new: true }
    ).select("-passwordHash -refreshTokens -apiKeys");
    if (!user) return res.status(404).json({ success: false, error: "User not found" });
    res.status(200).json({ success: true, data: { profile: user.profile } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put("/settings", async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.userId,
      { $set: { settings: req.body, updatedAt: new Date() } },
      { new: true }
    ).select("-passwordHash -refreshTokens -apiKeys");
    if (!user) return res.status(404).json({ success: false, error: "User not found" });
    res.status(200).json({ success: true, data: { settings: user.settings } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put("/api-keys", async (req, res) => {
  try {
    const body = apiKeysSchema.parse(req.body);
    const update = { updatedAt: new Date() };
    if (body.deepseek !== undefined) {
      update["apiKeys.deepseek"] = body.deepseek ? encrypt(body.deepseek) : null;
    }
    if (body.reactiveResume !== undefined) {
      update["apiKeys.reactiveResume"] = body.reactiveResume ? encrypt(body.reactiveResume) : null;
    }
    const user = await User.findByIdAndUpdate(req.userId, { $set: update }, { new: true }).select(
      "-passwordHash -refreshTokens -apiKeys"
    );
    if (!user) return res.status(404).json({ success: false, error: "User not found" });
    await recordAudit(req, { action: "user.api-keys.update", resourceType: "user", resourceId: req.userId });
    res.status(200).json({ success: true, data: { message: "API keys updated" } });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ success: false, error: err.errors?.[0]?.message || "Validation error" });
    }
    if (err.message?.includes("ENCRYPTION_KEY")) {
      return res.status(503).json({ success: false, error: "Encryption not configured" });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete("/account", async (req, res) => {
  try {
    const userId = req.userId;
    await recordAudit(req, { action: "user.account.delete", resourceType: "user", resourceId: userId });
    await GeneratedDocument.deleteMany({ userId });
    await Resume.deleteMany({ userId });
    await JobDescription.deleteMany({ userId });
    await IdempotencyKey.deleteMany({ userId });
    await PasswordResetToken.deleteMany({ userId });
    await User.findByIdAndDelete(userId);
    res.status(200).json({ success: true, message: "Account and all associated data have been deleted." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
