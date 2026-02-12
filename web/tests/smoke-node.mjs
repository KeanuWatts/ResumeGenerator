#!/usr/bin/env node
/**
 * Phase 0 smoke test: all routes return 200 and contain expected content.
 * Run with: node tests/smoke-node.mjs [baseURL]
 * Or: BASE_URL=http://localhost:3000 node tests/smoke-node.mjs
 * No browser required; works in Docker/CI.
 */
const baseURL = process.env.BASE_URL || process.argv[2] || "http://localhost:3000";

const ROUTES = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/dashboard",
  "/resumes",
  "/jobs",
  "/jobs/new",
  "/generate",
  "/documents",
  "/settings",
];

async function main() {
  let failed = 0;
  for (const path of ROUTES) {
    const url = `${baseURL.replace(/\/$/, "")}${path}`;
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (res.status !== 200) {
        console.error(`FAIL ${path}: status ${res.status}`);
        failed++;
        continue;
      }
      if (!text.includes("<!DOCTYPE html>") && !text.includes("<html")) {
        console.error(`FAIL ${path}: no HTML in response`);
        failed++;
        continue;
      }
      console.log(`OK   ${path}`);
    } catch (err) {
      console.error(`FAIL ${path}: ${err.message}`);
      failed++;
    }
  }
  if (failed > 0) {
    process.exit(1);
  }
  console.log("All routes OK.");
}

main();
