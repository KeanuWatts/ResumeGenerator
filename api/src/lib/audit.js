import { AuditLog } from "../models/AuditLog.js";

/**
 * Record an audit log entry. Reads userId, ip, user-agent from req when available.
 * @param {import("express").Request} req - Request (may have req.userId, req.ip, req.get('user-agent'))
 * @param {{ action: string, resourceType: string, resourceId?: import("mongoose").Types.ObjectId, details?: object }} opts
 */
export async function recordAudit(req, opts) {
  const { action, resourceType, resourceId, details } = opts;
  const doc = {
    userId: req.userId || null,
    action,
    resourceType,
    resourceId: resourceId || undefined,
    details: details || undefined,
    ipAddress: req.ip || req.connection?.remoteAddress || undefined,
    userAgent: req.get ? req.get("user-agent") : undefined,
  };
  try {
    await AuditLog.create(doc);
  } catch (err) {
    console.error("Audit log write failed:", err.message);
  }
}
