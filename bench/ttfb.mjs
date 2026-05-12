// TTFB benchmark.
//
// Spawns the dev server on a free port, POSTs N requests serially, measures
// the time from request send to first SSE byte parsed. Prints p50/p95/p99.

import { spawn } from "node:child_process";
import http from "node:http";

const N = Number(process.env.N ?? 50);
const PORT = 18787;

function startServer() {
  const proc = spawn(
    "node",
    ["--import", "tsx/esm", "src/server/server.ts"],
    {
      env: { ...process.env, PORT: String(PORT), BACKEND: "mock" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return new Promise((resolve, reject) => {
    proc.stdout.on("data", (b) => {
      if (String(b).includes("dev server on")) resolve(proc);
    });
    proc.stderr.on("data", (b) => process.stderr.write(b));
    proc.on("error", reject);
    setTimeout(() => reject(new Error("server start timed out")), 10_000);
  });
}

function postOne(body) {
  return new Promise((resolve, reject) => {
    const t0 = process.hrtime.bigint();
    let firstByteAtNs = 0n;
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path: "/chat",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        res.on("data", (chunk) => {
          if (firstByteAtNs === 0n && chunk.length > 0) {
            firstByteAtNs = process.hrtime.bigint();
          }
        });
        res.on("end", () => {
          const totalNs = process.hrtime.bigint() - t0;
          if (firstByteAtNs === 0n) firstByteAtNs = process.hrtime.bigint();
          resolve({
            ttfbMs: Number(firstByteAtNs - t0) / 1e6,
            totalMs: Number(totalNs) / 1e6,
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function pct(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))));
  return s[i];
}

async function main() {
  const proc = await startServer();
  // tiny warm-up
  await postOne({ messages: [{ role: "user", content: "warmup" }] });

  const ttfbs = [];
  const totals = [];
  for (let i = 0; i < N; i++) {
    const r = await postOne({
      messages: [{ role: "user", content: `req ${i}` }],
    });
    ttfbs.push(r.ttfbMs);
    totals.push(r.totalMs);
  }
  proc.kill();

  const out = {
    requests: N,
    ttfb_ms: {
      p50: pct(ttfbs, 0.5).toFixed(2),
      p95: pct(ttfbs, 0.95).toFixed(2),
      p99: pct(ttfbs, 0.99).toFixed(2),
      max: Math.max(...ttfbs).toFixed(2),
      mean: (ttfbs.reduce((a, b) => a + b, 0) / ttfbs.length).toFixed(2),
    },
    total_ms: {
      p50: pct(totals, 0.5).toFixed(2),
      p95: pct(totals, 0.95).toFixed(2),
      p99: pct(totals, 0.99).toFixed(2),
    },
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
