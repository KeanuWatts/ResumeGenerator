import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { startMemoryMongo, stopMemoryMongo } from "./setup.js";
import { connectDb } from "../src/db.js";

let appWithLowLimit;

describe("Rate limit", () => {
  before(async () => {
    await startMemoryMongo();
    await connectDb();
    process.env.RATE_LIMIT_REQUESTS_PER_MINUTE = "2";
    const mod = await import("../src/app.js");
    appWithLowLimit = mod.default;
  });

  after(async () => {
    process.env.RATE_LIMIT_REQUESTS_PER_MINUTE = "200";
    await stopMemoryMongo();
  });

  it("exceeding limit returns 429 and Retry-After", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(appWithLowLimit).get("/health");
      if (res.status === 429) {
        assert.strictEqual(res.headers["retry-after"], "60");
        assert.strictEqual(res.body.error, "Too many requests");
        return;
      }
    }
    assert.fail("Expected 429 after exceeding limit");
  });
});
