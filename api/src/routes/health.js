import { Router } from "express";
import mongoose from "mongoose";
import { isQueueReachable } from "../lib/queue.js";

const router = Router();

router.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

router.get("/ready", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ status: "not ready", reason: "MongoDB not connected" });
    }
    if (process.env.RABBITMQ_URL && !(await isQueueReachable())) {
      return res.status(503).json({ status: "not ready", reason: "RabbitMQ not reachable" });
    }
    res.status(200).json({ status: "ready" });
  } catch (err) {
    res.status(503).json({ status: "not ready", reason: err.message });
  }
});

export default router;
