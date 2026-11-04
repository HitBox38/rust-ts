// The unit of `ProcResult.usage.maxRssBytes` on this host (lane harness-m5b): bytes, whatever the platform's `ru_maxrss`
// unit is (KiB on Linux). A child that touches 256 MiB must report at least that many bytes; KiB read as bytes would
// report about 1,000x less. common.ts is loaded in a child process (see scripts/lib/deps.test.ts for why: it fixes
// RUST_TS_DATA when first loaded, and test files share one module registry).
import { expect, test } from "bun:test";
import { join } from "node:path";

// The grandchild spins until its own clock says it has used `CPU_MS` of CPU, so the amount does not depend on how fast the
// host is or how much of it this process gets: at any load only the wall time grows. Read as seconds or microseconds,
// `run()` would report about 1,000x off, outside the bounds below.
const CPU_MS = 300;
const CHILD = `
const { run } = await import(${JSON.stringify(join(import.meta.dir, "common.ts"))});
const r = await run([process.execPath, "-e", "const b = new Uint8Array(256 * 2 ** 20); for (let i = 0; i < b.length; i += 4096) b[i] = 1; const start = process.cpuUsage().user; let x = 0; while (process.cpuUsage().user - start < ${CPU_MS} * 1000) x++; console.log(b[4096] + (x > 0 ? 0 : 1));"]);
console.log(JSON.stringify({ code: r.code, stderr: r.stderr, usage: r.usage }));
`;

test("run() reports max RSS in bytes and CPU time in ms", () => {
  const MiB = 2 ** 20;
  const p = Bun.spawnSync([process.execPath, "-e", CHILD], { stdout: "pipe", stderr: "pipe" });
  expect(p.exitCode, p.stderr.toString()).toBe(0);
  const r = JSON.parse(p.stdout.toString().trim().split("\n").at(-1)!) as { code: number; stderr: string; usage?: { userMs: number; sysMs: number; maxRssBytes: number } };
  expect(r.code, r.stderr).toBe(0);
  expect(r.usage).toBeDefined();
  expect(r.usage!.maxRssBytes).toBeGreaterThanOrEqual(256 * MiB);
  expect(r.usage!.maxRssBytes).toBeLessThan(4096 * MiB);
  // The process's whole user time, which holds at least the spin.
  expect(r.usage!.userMs).toBeGreaterThanOrEqual(CPU_MS);
  expect(r.usage!.userMs).toBeLessThan(60_000);
}, 600_000);
