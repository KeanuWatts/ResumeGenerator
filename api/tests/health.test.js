import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { startMemoryMongo, stopMemoryMongo } from "./setup.js";
import { connectDb } from "../src/db.js";
import app from "../src/app.js";

describe("Health", () => {
  before(async () => {
    await startMemoryMongo();
    await connectDb();
  });

  after(async () => {
    await stopMemoryMongo();
  });

  it("GET /health returns 200", async () => {
    const res = await request(app).get("/health").expect(200);
    assert.strictEqual(res.body.status, "ok");
  });

  it("GET /ready returns 200 when DB connected", async () => {
    const res = await request(app).get("/ready").expect(200);
    assert.strictEqual(res.body.status, "ready");
  });
});
