import rateLimit from "express-rate-limit";

const limit = parseInt(process.env.RATE_LIMIT_REQUESTS_PER_MINUTE || "200", 10);

export const rateLimitMiddleware = rateLimit({
  windowMs: 60 * 1000,
  max: limit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many requests" },
  handler: (req, res) => {
    res.status(429).set("Retry-After", "60").json({ success: false, error: "Too many requests" });
  },
});
