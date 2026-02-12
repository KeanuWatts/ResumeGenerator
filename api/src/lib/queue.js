import amqp from "amqplib";

const RABBITMQ_URL = process.env.RABBITMQ_URL || "";
const QUEUE_EXPORT_PDF = "export.pdf";

let connection = null;
let channel = null;

export async function connectQueue() {
  if (!RABBITMQ_URL) return { connection: null, channel: null };
  if (connection) return { connection, channel };
  connection = await amqp.connect(RABBITMQ_URL);
  channel = await connection.createChannel();
  await channel.assertQueue(QUEUE_EXPORT_PDF, { durable: true });
  return { connection, channel };
}

export async function isQueueReachable() {
  if (!RABBITMQ_URL) return true;
  try {
    const conn = await amqp.connect(RABBITMQ_URL);
    await conn.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Publish export PDF job to queue.
 * @param {{ documentId: string, userId: string, templateId?: string }} payload
 * @returns {Promise<boolean>} true if published, false if queue not configured
 */
export async function publishExportPdfJob(payload) {
  const { channel: ch } = await connectQueue();
  if (!ch) return false;
  ch.sendToQueue(QUEUE_EXPORT_PDF, Buffer.from(JSON.stringify(payload)), { persistent: true });
  return true;
}

export function getQueueExportPdfName() {
  return QUEUE_EXPORT_PDF;
}
