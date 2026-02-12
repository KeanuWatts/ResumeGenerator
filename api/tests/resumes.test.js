import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { startMemoryMongo, stopMemoryMongo } from "./setup.js";
import { connectDb } from "../src/db.js";
import app from "../src/app.js";
import { User } from "../src/models/User.js";
import { hashPassword } from "../src/lib/auth.js";
import { signAccessToken } from "../src/lib/auth.js";

describe("Resumes CRUD", () => {
  let token;

  before(async () => {
    await startMemoryMongo();
    await connectDb();
    const user = await User.create({
      email: "resume@example.com",
      passwordHash: await hashPassword("pass1234"),
      profile: { fullName: "Resume User" },
    });
    token = signAccessToken({ userId: user._id.toString() });
  });

  after(async () => {
    await stopMemoryMongo();
  });

  it("GET /v1/resumes without token returns 401", async () => {
    await request(app).get("/v1/resumes").expect(401);
  });

  it("POST /v1/resumes creates resume", async () => {
    const res = await request(app)
      .post("/v1/resumes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "My Resume" })
      .expect(201);
    assert.strictEqual(res.body.data.name, "My Resume");
    assert.ok(res.body.data._id);
  });

  it("GET /v1/resumes returns list", async () => {
    const res = await request(app)
      .get("/v1/resumes")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    assert(Array.isArray(res.body.data));
    assert(res.body.data.length >= 1);
  });

  it("GET /v1/resumes/:id returns one resume", async () => {
    const listRes = await request(app)
      .get("/v1/resumes")
      .set("Authorization", `Bearer ${token}`);
    const id = listRes.body.data[0]._id;
    const res = await request(app)
      .get(`/v1/resumes/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    assert.strictEqual(res.body.name, "My Resume");
  });

  it("PUT /v1/resumes/:id updates resume", async () => {
    const listRes = await request(app)
      .get("/v1/resumes")
      .set("Authorization", `Bearer ${token}`);
    const id = listRes.body.data[0]._id;
    const res = await request(app)
      .put(`/v1/resumes/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Updated Resume" })
      .expect(200);
    assert.strictEqual(res.body.name, "Updated Resume");
  });

  it("DELETE /v1/resumes/:id deletes resume", async () => {
    const createRes = await request(app)
      .post("/v1/resumes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "To Delete" });
    const id = createRes.body.data._id;
    await request(app)
      .delete(`/v1/resumes/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    await request(app)
      .get(`/v1/resumes/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
  });
});
