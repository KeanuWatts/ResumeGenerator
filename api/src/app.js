import express from "express";
import cors from "cors";
import { rateLimitMiddleware } from "./middleware/rateLimit.js";
import healthRoutes from "./routes/health.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import resumeRoutes from "./routes/resumes.js";
import jobRoutes from "./routes/jobs.js";
import generateRoutes from "./routes/generate.js";
import documentRoutes from "./routes/documents.js";
import templateRoutes from "./routes/templates.js";
import exportRoutes from "./routes/export.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
});
app.use(rateLimitMiddleware);

const API_VERSION = process.env.API_VERSION || "v1";
const base = `/${API_VERSION}`;

app.use("/", healthRoutes);
app.use(`${base}/auth`, authRoutes);
app.use(`${base}/users`, userRoutes);
app.use(`${base}/resumes`, resumeRoutes);
app.use(`${base}/jobs`, jobRoutes);
app.use(`${base}/generate`, generateRoutes);
app.use(`${base}/documents`, documentRoutes);
app.use(`${base}/templates`, templateRoutes);
app.use(`${base}/export`, exportRoutes);

app.use((err, req, res, next) => {
  res.status(500).json({ success: false, error: err.message || "Internal server error" });
});

export default app;
