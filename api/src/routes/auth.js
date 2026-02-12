import { Router } from "express";
import { z } from "zod";
import { User } from "../models/User.js";
import { PasswordResetToken } from "../models/PasswordResetToken.js";
import { hashPassword, verifyPassword, signAccessToken, signRefreshToken, verifyRefreshToken } from "../lib/auth.js";
import { createResetToken, getResetTokenExpiry, hashResetToken } from "../lib/passwordReset.js";
import { recordAudit } from "../lib/audit.js";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();

const RESET_BASE_URL = process.env.PASSWORD_RESET_BASE_URL || "http://localhost:3000";
const DEV_MODE_RESET = process.env.PASSWORD_RESET_DEV_MODE === "true";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

router.post("/register", async (req, res) => {
  try {
    const body = registerSchema.parse(req.body);
    const existing = await User.findOne({ email: body.email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ success: false, error: "Email already registered" });
    }
    const passwordHash = await hashPassword(body.password);
    const user = await User.create({
      email: body.email.toLowerCase(),
      passwordHash,
      profile: { fullName: body.fullName },
    });
    req.userId = user._id;
    await recordAudit(req, { action: "auth.register", resourceType: "user", resourceId: user._id });
    res.status(201).json({
      success: true,
      data: { id: user._id.toString(), email: user.email },
    });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ success: false, error: err.errors?.[0]?.message || "Validation error" });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const body = loginSchema.parse(req.body);
    const user = await User.findOne({ email: body.email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ success: false, error: "Invalid email or password" });
    }
    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ success: false, error: "Invalid email or password" });
    }
    user.lastLoginAt = new Date();
    await user.save();
    const accessToken = signAccessToken({ userId: user._id.toString() });
    const refreshToken = signRefreshToken({ userId: user._id.toString() });
    if (!user.refreshTokens) user.refreshTokens = [];
    user.refreshTokens.push({ token: refreshToken, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
    await user.save();
    req.userId = user._id;
    await recordAudit(req, { action: "auth.login", resourceType: "user", resourceId: user._id });
    res.status(200).json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        expiresIn: 900,
      },
    });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ success: false, error: err.errors?.[0]?.message || "Validation error" });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/refresh", async (req, res) => {
  try {
    const body = refreshSchema.parse(req.body);
    const payload = verifyRefreshToken(body.refreshToken);
    const user = await User.findById(payload.userId);
    if (!user) {
      return res.status(401).json({ success: false, error: "Invalid refresh token" });
    }
    const currentToken = body.refreshToken;
    const tokenEntry = user.refreshTokens?.find((t) => t.token === currentToken);
    if (!tokenEntry) {
      return res.status(401).json({ success: false, error: "Invalid or expired refresh token" });
    }
    user.refreshTokens = user.refreshTokens.filter((t) => t.token !== currentToken);
    const newAccessToken = signAccessToken({ userId: user._id.toString() });
    const newRefreshToken = signRefreshToken({ userId: user._id.toString() });
    const refreshExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    user.refreshTokens.push({ token: newRefreshToken, expiresAt: refreshExpires });
    const maxTokens = 10;
    if (user.refreshTokens.length > maxTokens) {
      user.refreshTokens = user.refreshTokens.slice(-maxTokens);
    }
    await user.save();
    res.status(200).json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: 900,
      },
    });
  } catch (err) {
    res.status(401).json({ success: false, error: "Invalid or expired refresh token" });
  }
});

router.post("/logout", authMiddleware, async (req, res) => {
  const auth = req.headers.authorization;
  const token = auth?.slice(7);
  if (token) {
    const user = await User.findById(req.userId);
    if (user?.refreshTokens?.length) {
      user.refreshTokens = user.refreshTokens.filter((t) => t.token !== token);
      await user.save();
    }
  }
  await recordAudit(req, { action: "auth.logout", resourceType: "user", resourceId: req.userId });
  res.status(200).json({ success: true });
});

router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    const user = await User.findOne({ email: email.toLowerCase() });
    const message = { success: true, message: "If an account exists with this email, you will receive a reset link." };
    if (user) {
      const { token, tokenHash } = createResetToken();
      const expiresAt = new Date(getResetTokenExpiry());
      await PasswordResetToken.create({ userId: user._id, tokenHash, expiresAt });
      if (DEV_MODE_RESET) {
        message.resetLink = `${RESET_BASE_URL}/reset-password?token=${token}`;
      }
      req.userId = user._id;
      await recordAudit(req, { action: "auth.forgot-password", resourceType: "user", resourceId: user._id });
    }
    res.status(200).json(message);
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ success: false, error: err.errors?.[0]?.message || "Validation error" });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = resetPasswordSchema.parse(req.body);
    const tokenHash = hashResetToken(token);
    const resetRecord = await PasswordResetToken.findOne({
      tokenHash,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!resetRecord) {
      return res.status(400).json({ success: false, error: "Invalid or expired reset token" });
    }
    const user = await User.findById(resetRecord.userId);
    if (!user) {
      return res.status(400).json({ success: false, error: "Invalid or expired reset token" });
    }
    user.passwordHash = await hashPassword(newPassword);
    await user.save();
    resetRecord.usedAt = new Date();
    await resetRecord.save();
    req.userId = user._id;
    await recordAudit(req, { action: "auth.reset-password", resourceType: "user", resourceId: user._id });
    res.status(200).json({ success: true, message: "Password has been reset. You can now log in." });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ success: false, error: err.errors?.[0]?.message || "Validation error" });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-passwordHash -refreshTokens -apiKeys");
    if (!user) return res.status(404).json({ success: false, error: "User not found" });
    res.status(200).json({
      success: true,
      data: {
        id: user._id.toString(),
        email: user.email,
        profile: user.profile,
        settings: user.settings,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
