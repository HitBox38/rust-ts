// The unit of `ProcResult.usage.maxRssBytes` on this host (lane harness-m5b): bytes, whatever the platform's `ru_maxrss`
// unit is (KiB on Linux). A child that touches 256 MiB must report at least that many bytes; KiB read as bytes would
// report about 1,000x less. common.ts is loaded in a child process (see scripts/lib/deps.test.ts for why: it fixes
// RUST_TS_DATA when first loaded, and test files share one module registry).
import { expect, test } from "bun:test";
import { join } from "node:path";

const CHILD = `
const { run } = await import(${JSON.stringify(join(import.meta.dir, "common.ts"))});
const r = await run([process.execPath, "-e", "const b = new Uint8Array(256 * 2 ** 20); for (let i = 0; i < b.length; i += 4096) b[i] = 1; let x = 0; const t = Date.now(); while (Date.now() - t < 300) x++; console.log(b[4096] + (x > 0 ? 0 : 1));"]);
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
  expect(r.usage!.userMs).toBeGreaterThan(100);
  expect(r.usage!.userMs).toBeLessThan(60_000);
}, 60_000);
