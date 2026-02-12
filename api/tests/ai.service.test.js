import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { startMemoryMongo, stopMemoryMongo } from "./setup.js";
import { connectDb } from "../src/db.js";
import { extractJobFields } from "../src/services/ai.service.js";

describe("AI Service", () => {
  before(async () => {
    await startMemoryMongo();
    await connectDb();
  });

  after(async () => {
    await stopMemoryMongo();
  });

  it("extractJobFields with mocked fetch returns title, company, ksas, acronyms", async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    const mockFetch = async (url, options) => {
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Senior Engineer",
                  company: "Acme Corp",
                  ksas: ["JavaScript", "Node.js", "AWS"],
                  acronyms: ["API", "REST"],
                }),
              },
            },
          ],
        }),
      };
    };

    const result = await extractJobFields("We are hiring a Senior Engineer at Acme Corp. Need JavaScript.", mockFetch);
    assert.strictEqual(result.title, "Senior Engineer");
    assert.strictEqual(result.company, "Acme Corp");
    assert.strictEqual(result.ksas.length, 3);
    assert.strictEqual(result.acronyms.length, 2);
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("extractJobFields throws when job text empty", async () => {
    const mockFetch = () => ({ ok: true, json: async () => ({}) });
    await assert.rejects(() => extractJobFields("", mockFetch), /Job description text is required/);
  });
});
