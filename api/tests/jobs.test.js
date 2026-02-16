import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { startMemoryMongo, stopMemoryMongo } from "./setup.js";
import { connectDb } from "../src/db.js";
import { User } from "../src/models/User.js";
import { hashPassword } from "../src/lib/auth.js";
import { signAccessToken } from "../src/lib/auth.js";
import app from "../src/app.js";

describe("Jobs CRUD and extract", () => {
  let token;

  before(async () => {
    await startMemoryMongo();
    await connectDb();
    const user = await User.create({
      email: "jobs@example.com",
      passwordHash: await hashPassword("pass1234"),
      profile: { fullName: "Jobs User" },
    });
    token = signAccessToken({ userId: user._id.toString() });
  });

  after(async () => {
    await stopMemoryMongo();
  });

  it("POST /v1/jobs creates job", async () => {
    const res = await request(app)
      .post("/v1/jobs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Dev", company: "Co", rawText: "We need a developer. JavaScript required." })
      .expect(201);
    assert.ok(res.body._id);
    assert.strictEqual(res.body.title, "Dev");
    assert.strictEqual(res.body.company, "Co");
  });

  it("GET /v1/jobs returns list", async () => {
    const res = await request(app).get("/v1/jobs").set("Authorization", `Bearer ${token}`).expect(200);
    assert(Array.isArray(res.body.data));
    assert(res.body.data.length >= 1);
  });

  it("GET /v1/jobs/:id returns one job", async () => {
    const listRes = await request(app).get("/v1/jobs").set("Authorization", `Bearer ${token}`);
    const id = listRes.body.data[0]._id;
    const res = await request(app).get(`/v1/jobs/${id}`).set("Authorization", `Bearer ${token}`).expect(200);
    assert.strictEqual(res.body.title, "Dev");
  });

  it("PUT /v1/jobs/:id updates job", async () => {
    const listRes = await request(app).get("/v1/jobs").set("Authorization", `Bearer ${token}`);
    const id = listRes.body.data[0]._id;
    const res = await request(app)
      .put(`/v1/jobs/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Senior Dev" })
      .expect(200);
    assert.strictEqual(res.body.title, "Senior Dev");
  });

  it("POST /v1/jobs/extract without AI configured returns 503 or 500", async () => {
    const prevKey = process.env.DEEPSEEK_API_KEY;
    const prevOllama = process.env.OLLAMA_BASE_URL;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OLLAMA_BASE_URL;
    const res = await request(app)
      .post("/v1/jobs/extract")
      .set("Authorization", `Bearer ${token}`)
      .send({ rawText: "Senior Engineer at Acme. Python and AWS required." });
    if (prevKey !== undefined) process.env.DEEPSEEK_API_KEY = prevKey;
    if (prevOllama !== undefined) process.env.OLLAMA_BASE_URL = prevOllama;
    assert(res.status === 503 || res.status === 500);
  });

  it("POST /v1/jobs/extract with invalid body returns 400", async () => {
    const res = await request(app)
      .post("/v1/jobs/extract")
      .set("Authorization", `Bearer ${token}`)
      .send({})
      .expect(400);
    assert.strictEqual(res.body.success, false);
  });
});
