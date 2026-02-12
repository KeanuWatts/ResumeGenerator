import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { startMemoryMongo, stopMemoryMongo } from "./setup.js";
import { connectDb } from "../src/db.js";
import { User } from "../src/models/User.js";
import { Template } from "../src/models/Template.js";
import { hashPassword } from "../src/lib/auth.js";
import { signAccessToken } from "../src/lib/auth.js";
import app from "../src/app.js";

describe("Templates", () => {
  let token;

  before(async () => {
    await startMemoryMongo();
    await connectDb();
    const user = await User.create({
      email: "tpl@example.com",
      passwordHash: await hashPassword("pass1234"),
      profile: { fullName: "Tpl User" },
    });
    token = signAccessToken({ userId: user._id.toString() });
  });

  after(async () => {
    await stopMemoryMongo();
  });

  it("GET /v1/templates returns list with at least default template", async () => {
    const res = await request(app)
      .get("/v1/templates")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    assert.strictEqual(res.body.success, true);
    assert(Array.isArray(res.body.data));
    assert(res.body.data.length >= 1);
    const defaultTpl = res.body.data.find((t) => t.isDefault);
    assert(defaultTpl, "Default template should exist");
    assert.strictEqual(defaultTpl.name, "Default");
  });

  it("GET /v1/templates/:id returns template when found", async () => {
    const listRes = await request(app).get("/v1/templates").set("Authorization", `Bearer ${token}`).expect(200);
    const id = listRes.body.data[0]._id;
    const res = await request(app)
      .get(`/v1/templates/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    assert(res.body.name);
    assert.strictEqual(res.body._id, id);
  });

  it("GET /v1/templates/:id returns 404 for invalid id", async () => {
    await request(app)
      .get("/v1/templates/000000000000000000000000")
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
  });
});
