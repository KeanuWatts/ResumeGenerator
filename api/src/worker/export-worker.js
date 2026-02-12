#!/usr/bin/env node
/**
 * Consumes export.pdf jobs from RabbitMQ and runs PDF export (Reactive Resume + S3).
 * Run: node src/worker/export-worker.js
 * Requires: MONGODB_URI, RABBITMQ_URL, RXRESUME_BASE_URL, RXRESUME_API_KEY, AWS_* (or MinIO)
 */
import amqp from "amqplib";
import { connectDb } from "../db.js";
import { getQueueExportPdfName, connectQueue } from "../lib/queue.js";
import { exportDocumentToPdf } from "../services/export.service.js";

const RABBITMQ_URL = process.env.RABBITMQ_URL;
if (!RABBITMQ_URL) {
  console.error("RABBITMQ_URL is required");
  process.exit(1);
}

async function run() {
  await connectDb();
  const { connection, channel } = await connectQueue();
  if (!channel) {
    console.error("Could not connect to RabbitMQ");
    process.exit(1);
  }
  const queue = getQueueExportPdfName();
  channel.prefetch(1);
  channel.consume(
    queue,
    async (msg) => {
      if (!msg) return;
      try {
        const payload = JSON.parse(msg.content.toString());
        const { documentId, userId, templateId } = payload;
        if (!documentId || !userId) {
          channel.nack(msg, false, false);
          return;
        }
        await exportDocumentToPdf(documentId, userId, templateId);
        channel.ack(msg);
      } catch (err) {
        console.error("Export job failed:", err.message);
        channel.nack(msg, false, true);
      }
    },
    { noAck: false }
  );
  console.log("Export worker consuming from", queue);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
