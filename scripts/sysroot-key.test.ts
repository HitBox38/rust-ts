// The oracle cache key of a rustc case that turns the logger on covers the oracle sysroot's files (scripts/difftest.ts
// `logsSysrootPaths`; lane harness-w44, review w40c-audit N4); every other key is as before. difftest loads scripts/lib/common.ts,
// so (as scripts/unstable.test.ts) it is loaded in a child process; it reads the real oracle toolchain and writes nothing.
import { expect, test } from "bun:test";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");

test("RUSTC_LOG in a rustc case's env adds the sysroot's files to its key, and only there", () => {
  const child = `
const d = await import(${JSON.stringify(join(REPO, "scripts/difftest.ts"))});
const { PIN, hash } = await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))});
const { rustcDriverHash } = await import(${JSON.stringify(join(REPO, "scripts/lib/oracle.ts"))});
const rustc = { name: "s", oracle: () => ["rustc", "+x"] };
const probe = { name: "p", oracle: () => ["/no/such/probe"] };
const c = (env) => ({ id: "a.rs", file: "", args: ["a.rs"], ...(env ? { env } : {}) });
const old = (s, k) => hash(JSON.stringify([PIN.commit, s === rustc ? rustcDriverHash() : PIN.commit, s.name, k.id, k.args, "", ...(k.env ? [k.env] : [])]));
const cases = { none: c(), other: c({ RUSTC_ICE: "0" }), unset: c({ RUSTC_LOG: null }), log: c({ RUSTC_LOG: "trace" }), color: c({ RUSTC_LOG_COLOR: "always" }) };
const out = {};
for (const [n, k] of Object.entries(cases)) out[n] = { logs: d.logsSysrootPaths(rustc, k), asBefore: d.oracleCacheKey(rustc, k, "", []) === old(rustc, k) };
out.probe = { logs: d.logsSysrootPaths(probe, cases.log), asBefore: d.oracleCacheKey(probe, cases.log, "", []) === old(probe, cases.log) };
console.log(JSON.stringify(out));
`;
  const env = { ...process.env, RUSTUP_AUTO_INSTALL: "0" };
  const r = Bun.spawnSync([process.execPath, "-e", child], { cwd: REPO, env, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString() + r.stdout.toString()).toBe(0);
  expect(JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!)).toEqual({
    none: { logs: false, asBefore: true },
    other: { logs: false, asBefore: true },
    unset: { logs: false, asBefore: true },
    log: { logs: true, asBefore: false },
    color: { logs: false, asBefore: true },
    probe: { logs: false, asBefore: true },
  });
}, 60_000);
