#!/usr/bin/env node
const baseURL = process.env.BASE_URL || "http://localhost:3000";
const maxAttempts = 30;
const intervalMs = 1000;

async function wait() {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(baseURL);
      if (res.ok) {
        console.log("Server ready at", baseURL);
        process.exit(0);
      }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  console.error("Server did not become ready");
  process.exit(1);
}
wait();
