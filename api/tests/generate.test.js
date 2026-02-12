import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { startMemoryMongo, stopMemoryMongo } from "./setup.js";
import { connectDb } from "../src/db.js";
import { User } from "../src/models/User.js";
import { Resume } from "../src/models/Resume.js";
import { JobDescription } from "../src/models/JobDescription.js";
import { GeneratedDocument } from "../src/models/GeneratedDocument.js";
import { hashPassword } from "../src/lib/auth.js";
import { signAccessToken } from "../src/lib/auth.js";
import app from "../src/app.js";

describe("Generate resume", () => {
  let token;
  let resumeId;
  let jobId;

  before(async () => {
    await startMemoryMongo();
    await connectDb();
    const user = await User.create({
      email: "gen@example.com",
      passwordHash: await hashPassword("pass1234"),
      profile: { fullName: "Gen User" },
    });
    token = signAccessToken({ userId: user._id.toString() });
    const resume = await Resume.create({
      userId: user._id,
      name: "My Resume",
      summary: { content: "Experienced developer." },
      skills: [{ name: "Tech", items: ["JavaScript", "Node"] }],
    });
    resumeId = resume._id.toString();
    const job = await JobDescription.create({
      userId: user._id,
      title: "Engineer",
      company: "Acme",
      rawText: "We need JavaScript and Node.",
      ksas: [{ term: "JavaScript", category: "technologies", importance: "required", extracted: true }],
    });
    jobId = job._id.toString();
  });

  after(async () => {
    await stopMemoryMongo();
  });

  it("POST /v1/generate/resume returns 200 and document in DB", async () => {
    const res = await request(app)
      .post("/v1/generate/resume")
      .set("Authorization", `Bearer ${token}`)
      .send({ resumeId, jobDescriptionId: jobId })
      .expect(200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.documentId);
    assert.strictEqual(res.body.data.type, "resume");

    const doc = await GeneratedDocument.findById(res.body.data.documentId);
    assert.ok(doc);
    assert.strictEqual(doc.type, "resume");
    assert.strictEqual(doc.resumeId.toString(), resumeId);
    assert.strictEqual(doc.jobDescriptionId.toString(), jobId);
    assert.ok(doc.content.tailoredSummary || doc.content.experienceWithRelevance?.length >= 0);
  });

  it("POST /v1/generate/resume with invalid resumeId returns 404", async () => {
    await request(app)
      .post("/v1/generate/resume")
      .set("Authorization", `Bearer ${token}`)
      .send({ resumeId: "000000000000000000000000", jobDescriptionId: jobId })
      .expect(404);
  });

  it("POST /v1/generate/cover-letter returns 200 and document with letterBody", async () => {
    const res = await request(app)
      .post("/v1/generate/cover-letter")
      .set("Authorization", `Bearer ${token}`)
      .send({ resumeId, jobDescriptionId: jobId })
      .expect(200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.documentId);
    assert.strictEqual(res.body.data.type, "cover_letter");

    const doc = await GeneratedDocument.findById(res.body.data.documentId);
    assert.ok(doc);
    assert.strictEqual(doc.type, "cover_letter");
    assert.ok(doc.content.letterBody);
    assert.ok(doc.content.greeting);
    assert.ok(doc.content.closing);
  });

  it("POST /v1/generate/match-analysis returns score, matches, gaps", async () => {
    const res = await request(app)
      .post("/v1/generate/match-analysis")
      .set("Authorization", `Bearer ${token}`)
      .send({ resumeId, jobDescriptionId: jobId })
      .expect(200);
    assert.strictEqual(res.body.success, true);
    assert(typeof res.body.data.score === "number");
    assert(Array.isArray(res.body.data.matches));
    assert(Array.isArray(res.body.data.gaps));
  });

  it("POST /v1/generate/resume with same Idempotency-Key returns same response (idempotency)", async () => {
    const idemKey = "test-idem-key-" + Date.now();
    const first = await request(app)
      .post("/v1/generate/resume")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", idemKey)
      .send({ resumeId, jobDescriptionId: jobId })
      .expect(200);
    const second = await request(app)
      .post("/v1/generate/resume")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", idemKey)
      .send({ resumeId, jobDescriptionId: jobId })
      .expect(200);
    assert.strictEqual(first.body.success, true);
    assert.strictEqual(second.body.success, true);
    assert.strictEqual(first.body.data.documentId, second.body.data.documentId);
  });
});
