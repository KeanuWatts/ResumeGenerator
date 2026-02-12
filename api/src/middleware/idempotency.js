import { IdempotencyKey } from "../models/IdempotencyKey.js";

const IDEMPOTENCY_HEADER = "idempotency-key";

/**
 * Middleware for POST routes that support Idempotency-Key.
 * Must run after auth so req.userId is set.
 * If key present and cached: return cached response and skip handler.
 * If key present and not cached: wrap res.json to store response for 24h.
 * @param {string} pathLabel - Logical path for storage (e.g. "generate/resume")
 */
export function idempotencyMiddleware(pathLabel) {
  return async (req, res, next) => {
    const key = req.get(IDEMPOTENCY_HEADER) || req.get("Idempotency-Key");
    if (!key || typeof key !== "string" || key.length > 256) {
      return next();
    }
    const normalizedKey = key.trim();
    if (!normalizedKey) return next();

    try {
      const cached = await IdempotencyKey.findOne({
        key: normalizedKey,
        userId: req.userId,
        path: pathLabel,
      }).lean();
      if (cached) {
        return res.status(cached.statusCode).json(cached.responseBody);
      }

      req.idempotencyKey = normalizedKey;
      req.idempotencyPath = pathLabel;
      const originalJson = res.json.bind(res);
      res.json = function (body) {
        IdempotencyKey.create({
          key: normalizedKey,
          userId: req.userId,
          method: req.method,
          path: pathLabel,
          statusCode: res.statusCode,
          responseBody: body,
        }).catch(() => {});
        originalJson(body);
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}
