#!/usr/bin/env node
/**
 * Build (if needed), start Next.js server, wait for it, run smoke tests, then exit.
 * Use when Docker is not available.
 */
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, "..");
const baseURL = process.env.BASE_URL || "http://localhost:3000";

async function waitForServer() {
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(baseURL);
      if (res.ok) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Server did not become ready");
}

function runSmoke() {
  return new Promise((resolve) => {
    const proc = spawn("node", [join(__dirname, "smoke-node.mjs")], {
      stdio: "inherit",
      env: { ...process.env, BASE_URL: baseURL },
      cwd: webRoot,
    });
    proc.on("exit", (code) => resolve(code ?? 0));
  });
}

async function main() {
  const needBuild = !existsSync(join(webRoot, ".next", "BUILD_ID"));
  if (needBuild) {
    console.log("Building...");
    const build = spawn("npm", ["run", "build"], { stdio: "inherit", shell: true, cwd: webRoot });
    await new Promise((resolve, reject) => {
      build.on("exit", (c) => (c === 0 ? resolve() : reject(new Error("Build failed"))));
    });
  }

  const nextBin = join(webRoot, "node_modules", "next", "dist", "bin", "next");
  const server = spawn(process.execPath, [nextBin, "start"], {
    stdio: "pipe",
    env: { ...process.env, PORT: "3000" },
    cwd: webRoot,
  });
  server.stderr?.on("data", (d) => process.stderr.write(d));
  server.stdout?.on("data", (d) => process.stdout.write(d));

  let exitCode = 1;
  try {
    await waitForServer();
    console.log("Running smoke tests...");
    exitCode = await runSmoke();
  } finally {
    server.kill("SIGTERM");
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
