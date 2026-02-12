import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { startMemoryMongo, stopMemoryMongo } from "./setup.js";
import { connectDb } from "../src/db.js";
import { User } from "../src/models/User.js";
import { GeneratedDocument } from "../src/models/GeneratedDocument.js";
import { Resume } from "../src/models/Resume.js";
import { JobDescription } from "../src/models/JobDescription.js";
import { hashPassword } from "../src/lib/auth.js";
import { signAccessToken } from "../src/lib/auth.js";
import app from "../src/app.js";

describe("Export PDF", () => {
  let token;
  let documentId;

  before(async () => {
    await startMemoryMongo();
    await connectDb();
    const user = await User.create({
      email: "exp@example.com",
      passwordHash: await hashPassword("pass1234"),
      profile: { fullName: "Exp User" },
    });
    token = signAccessToken({ userId: user._id.toString() });
    const resume = await Resume.create({
      userId: user._id,
      name: "My Resume",
      contact: { fullName: "Exp User", email: "exp@example.com" },
      summary: { content: "Summary." },
      skills: [{ name: "Tech", items: ["JS"] }],
    });
    const job = await JobDescription.create({
      userId: user._id,
      title: "Engineer",
      company: "Acme",
      rawText: "Job text.",
    });
    const doc = await GeneratedDocument.create({
      userId: user._id,
      resumeId: resume._id,
      jobDescriptionId: job._id,
      type: "resume",
      content: {
        tailoredSummary: "Tailored summary.",
        tailoredSkills: [{ name: "Tech", keywords: ["JS"] }],
        experienceWithRelevance: [],
      },
    });
    documentId = doc._id.toString();
  });

  after(async () => {
    await stopMemoryMongo();
  });

  it("POST /v1/export/pdf with invalid documentId returns 404", async () => {
    const res = await request(app)
      .post("/v1/export/pdf")
      .set("Authorization", `Bearer ${token}`)
      .send({ generatedDocumentId: "000000000000000000000000" })
      .expect(404);
    assert.strictEqual(res.body.success, false);
    assert(res.body.error?.includes("not found") || res.body.error === "Document not found");
  });

  it("POST /v1/export/pdf with valid documentId returns 503 when RR not configured", async () => {
    const res = await request(app)
      .post("/v1/export/pdf")
      .set("Authorization", `Bearer ${token}`)
      .send({ generatedDocumentId: documentId })
      .expect(503);
    assert.strictEqual(res.body.success, false);
  });

  it("POST /v1/export/pdf without auth returns 401", async () => {
    await request(app)
      .post("/v1/export/pdf")
      .send({ generatedDocumentId: documentId })
      .expect(401);
  });

  it("POST /v1/export/pdf with missing body returns 400", async () => {
    await request(app)
      .post("/v1/export/pdf")
      .set("Authorization", `Bearer ${token}`)
      .send({})
      .expect(400);
  });

  it("POST /v1/export/pdf with async:true and no RabbitMQ falls back to sync (503 when RR not configured)", async () => {
    const orig = process.env.RABBITMQ_URL;
    delete process.env.RABBITMQ_URL;
    const res = await request(app)
      .post("/v1/export/pdf")
      .set("Authorization", `Bearer ${token}`)
      .send({ generatedDocumentId: documentId, async: true })
      .expect(503);
    if (orig !== undefined) process.env.RABBITMQ_URL = orig;
    assert.strictEqual(res.body.success, false);
  });
});
