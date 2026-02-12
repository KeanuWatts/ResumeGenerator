import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { startMemoryMongo, stopMemoryMongo } from "./setup.js";
import { connectDb, disconnectDb } from "../src/db.js";
import app from "../src/app.js";

describe("Auth", () => {
  before(async () => {
    await startMemoryMongo();
    await connectDb();
  });

  after(async () => {
    await stopMemoryMongo();
  });

  it("POST /v1/auth/register returns 201 and user in DB", async () => {
    const res = await request(app)
      .post("/v1/auth/register")
      .send({ email: "test@example.com", password: "password123", fullName: "Test User" })
      .expect(201);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.id);
    assert.strictEqual(res.body.data.email, "test@example.com");
  });

  it("POST /v1/auth/login returns 200 and access token", async () => {
    const res = await request(app)
      .post("/v1/auth/login")
      .send({ email: "test@example.com", password: "password123" })
      .expect(200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.accessToken);
    assert.ok(res.body.data.refreshToken);
  });

  it("POST /v1/auth/refresh returns new access token", async () => {
    const loginRes = await request(app)
      .post("/v1/auth/login")
      .send({ email: "test@example.com", password: "password123" });
    const refreshToken = loginRes.body.data.refreshToken;
    const res = await request(app)
      .post("/v1/auth/refresh")
      .send({ refreshToken })
      .expect(200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.accessToken);
  });

  it("Invalid token returns 401", async () => {
    await request(app)
      .get("/v1/auth/me")
      .set("Authorization", "Bearer invalid-token")
      .expect(401);
  });

  it("GET /v1/auth/me with valid token returns user", async () => {
    const loginRes = await request(app)
      .post("/v1/auth/login")
      .send({ email: "test@example.com", password: "password123" });
    const res = await request(app)
      .get("/v1/auth/me")
      .set("Authorization", `Bearer ${loginRes.body.data.accessToken}`)
      .expect(200);
    assert.strictEqual(res.body.data.email, "test@example.com");
    assert.ok(res.body.data.profile.fullName);
  });
});
