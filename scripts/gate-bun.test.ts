// The gate's Bun pin (lane bun-144; docs/reviews/w40j-audit.md N1): `gate.ts run` refuses any Bun build but scripts/lib/bun-pin.ts
// `GATE_BUN` before any work, and `gate.ts accept` refuses a run whose gate.json records another build. Both in a child, with
// RUST_TS_DATA at a temp dir (an empty git repository as its upstream checkout, as scripts/gate-power.test.ts): the shared run
// directories, baselines and state records are never touched. That gate.json records the build is checked by gate-power.test.ts.
// The file the gate's children run (`process.execPath`) is checked at the start, before each suite and at the end (review bun-144
// F1): here through `GateHost.execPath`, a symlink to the running Bun that a stub suite's subject swaps for a fake Bun.
import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// No import may load scripts/lib/common.ts (scripts/lib/subject-bin.ts does): this file runs in the runner unit-test process
// before scripts/lib/deps.test.ts, which needs common.ts to read its temp RUST_TS_DATA. That `GATE_BUN` is in `VALIDATED_BUN` is
// checked in scripts/subject-bin.cases.ts, which runs in a child.
import { GATE_BUN, acceptBunExeRefusal, acceptBunRefusal, bunExeChange, execBunRefusal, gateBunRefusal, readBunExe } from "./lib/bun-pin.ts";
import { UNIT_ENV_REFUSED } from "./lib/unit-steps.ts";

const REPO = resolve(import.meta.dir, "..");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-gate-bun-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** A temp RUST_TS_DATA with an empty upstream checkout; the environment a child gate runs with. */
function dataDir(name: string): { data: string; env: Record<string, string | undefined> } {
  const data = join(TMP, name);
  mkdirSync(join(data, "rust", "compiler"), { recursive: true });
  expect(Bun.spawnSync(["git", "init", "-q", join(data, "rust")]).exitCode).toBe(0);
  // Without the variables the gate refuses for other reasons (scripts/gate.ts `gateEnvRefusal`).
  const { NODE_ENV: _node, RUST_TS_FREEZE_LISTS: _freeze, ...inherited } = process.env;
  for (const k of Object.keys(UNIT_ENV_REFUSED)) delete inherited[k];
  return { data, env: { ...inherited, RUST_TS_DATA: data } };
}

const errorLines = (out: string) => out.split("\n").filter((l) => l.startsWith("ERROR:"));

/** `gateRun` on a stub suite list, taking itself to run on `bun`; counts the host reads it makes. */
function gateOn(name: string, bun: { version: string; revision: string }) {
  const { data, env } = dataDir(name);
  const child = `
const { gateRun } = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
let reads = 0;
process.on("exit", () => console.log(\`host reads: \${reads}\`));
const readers = {
  pmset: async () => { reads++; return "Now drawing from 'AC Power'\\n"; },
  swapusage: async () => { reads++; return "total = 2048.00M  used = 512.00M  free = 1536.00M"; },
  load: () => { reads++; return [1, 2, 3]; },
  now: () => new Date(),
};
await gateRun(["lex"], true, false, false, { readers, pollMs: 20, keepEveryMs: 3600000, bun: ${JSON.stringify(bun)} });
`;
  const r = Bun.spawnSync([process.execPath, "-e", child], { cwd: REPO, stdout: "pipe", stderr: "pipe", env });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString(), runs: existsSync(join(data, "runs")) };
}

/** A fake Bun: a script that answers `--revision` as another build would. */
function fakeBun(dir: string): string {
  const f = join(dir, "fake-bun");
  writeFileSync(f, "#!/bin/sh\necho 1.4.5+0123abcde\n");
  chmodSync(f, 0o755);
  return f;
}

/**
 * `gateRun` on two stub suites, `swap-a` then `swap-b`, checking the Bun file `<dir>/bin/bun` (a symlink to the running Bun, or
 * with `startFake` to a fake one). The subject of the suite named `swapIn` replaces that symlink with one to the fake Bun (an
 * atomic rename, as an upgrade does) while its suite runs.
 */
function gateSwap(name: string, opts: { swapIn?: "swap-a" | "swap-b"; startFake?: boolean }) {
  const { data, env } = dataDir(name);
  const bin = join(data, "bin");
  mkdirSync(bin);
  const fake = fakeBun(bin);
  const exe = join(bin, "bun");
  const next = join(bin, "next");
  symlinkSync(opts.startFake ? fake : process.execPath, exe);
  symlinkSync(fake, next);
  const stub = join(data, "stub.mjs");
  const child = `
import { writeFileSync } from "node:fs";
const { gateRun } = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const { SUITES } = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const { PIN } = await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))});
const ORACLE = ["rustc", \`+\${PIN.toolchain}\`, "-vV"];
writeFileSync(${JSON.stringify(stub)}, \`
import { existsSync, renameSync } from "node:fs";
if (process.argv[2] === \${JSON.stringify(${JSON.stringify(opts.swapIn ?? "")})} && existsSync(\${JSON.stringify(${JSON.stringify(next)})})) renameSync(\${JSON.stringify(${JSON.stringify(next)})}, \${JSON.stringify(${JSON.stringify(exe)})});
await Bun.write(Bun.stdout, Bun.spawnSync(\${JSON.stringify(ORACLE)}).stdout);
\`);
for (const name of ["swap-a", "swap-b"]) SUITES.push({
  name, milestone: "test", description: "", mode: "single", cwd: ${JSON.stringify(data)}, timeoutMs: 30000,
  cases: () => [{ id: "same", file: "", args: [] }],
  oracle: () => ORACLE, subject: () => [process.execPath, ${JSON.stringify(stub)}, name],
});
let reads = 0;
process.on("exit", () => console.log(\`host reads: \${reads}\`));
const readers = {
  pmset: async () => { reads++; return "Now drawing from 'AC Power'\\n"; },
  swapusage: async () => "total = 2048.00M  used = 512.00M  free = 1536.00M",
  load: () => [1, 2, 3],
  now: () => new Date(),
};
await gateRun(["swap-a", "swap-b"], true, false, false, { readers, pollMs: 3600000, keepEveryMs: 3600000, execPath: ${JSON.stringify(exe)} });
`;
  const r = Bun.spawnSync([process.execPath, "-e", child], { cwd: REPO, stdout: "pipe", stderr: "pipe", env });
  const runs = join(data, "runs");
  const dirs = existsSync(runs) ? readdirSync(runs).filter((d) => d.startsWith("gate-")) : [];
  const dir = dirs[0] === undefined ? undefined : join(runs, dirs[0]);
  return {
    code: r.exitCode,
    stdout: r.stdout.toString(),
    stderr: r.stderr.toString(),
    exe,
    runs: existsSync(runs),
    gateJson: dir === undefined ? undefined : (JSON.parse(readFileSync(join(dir, "gate.json"), "utf8")) as any),
    ran: dir === undefined ? [] : ["swap-a", "swap-b"].filter((s) => existsSync(join(dir, `${s}.jsonl`))),
  };
}

/** `gate.ts accept --run <id>` of a gate.json holding `g`. */
function acceptOf(name: string, g: Record<string, unknown>) {
  const { data, env } = dataDir(name);
  const runId = `gate-test-${name}`;
  mkdirSync(join(data, "runs", runId), { recursive: true });
  writeFileSync(join(data, "runs", runId, "gate.json"), JSON.stringify({ runId, pass: true, skipStatic: false, dirty: [], suites: [], ...g }));
  const r = Bun.spawnSync([process.execPath, join(REPO, "scripts/gate.ts"), "accept", "--run", runId], { cwd: REPO, stdout: "pipe", stderr: "pipe", env });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString(), runId };
}

/** A head no repository has: with the Bun check passed, accept stops at the next one ("tested … but HEAD is …"), before any write. */
const NO_HEAD = "0".repeat(40);

test("GATE_BUN names a full revision", () => {
  expect(GATE_BUN.revision).toMatch(/^[0-9a-f]{40}$/);
});

test("gateBunRefusal: only the pin's version and full revision pass", () => {
  expect(gateBunRefusal(GATE_BUN)).toBeUndefined();
  expect(gateBunRefusal({ ...GATE_BUN })).toBeUndefined();
  const otherRev = gateBunRefusal({ version: GATE_BUN.version, revision: "f".repeat(40) });
  expect(otherRev).toContain(`not on ${GATE_BUN.version} (ffffffffffff)`);
  expect(otherRev).toContain("scripts/lib/bun-pin.ts GATE_BUN");
  expect(gateBunRefusal({ version: "1.4.3", revision: GATE_BUN.revision })).toContain("not on 1.4.3");
  expect(gateBunRefusal({ version: "1.4.3", revision: "c6da4a4d3010e5553438c60f6bd76d981976867c" }, { version: "1.4.3", revision: "c6da4a4d3010e5553438c60f6bd76d981976867c" })).toBeUndefined();
});

test("acceptBunRefusal: a recorded build other than the pin is refused; none recorded is let through", () => {
  expect(acceptBunRefusal("r", GATE_BUN)).toBeUndefined();
  expect(acceptBunRefusal("r", undefined)).toBeUndefined();
  expect(acceptBunRefusal("r", { version: GATE_BUN.version, revision: "a".repeat(40) })).toContain("gate run r ran on Bun");
  expect(acceptBunRefusal("r", { version: "1.4.3", revision: GATE_BUN.revision })).toContain("nothing accepted");
});

test("gate run on another Bun: one ERROR: line before anything else (no host read, no run directory)", () => {
  for (const [name, bun] of [
    ["other-version", { version: "1.4.3", revision: "c6da4a4d3010e5553438c60f6bd76d981976867c" }],
    ["other-revision", { version: GATE_BUN.version, revision: "0123456789abcdef0123456789abcdef01234567" }],
  ] as const) {
    const r = gateOn(name, bun);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const errors = errorLines(r.stdout);
    expect(errors.length, r.stdout).toBe(1);
    expect(errors[0]).toContain(`the gate runs only on Bun ${GATE_BUN.version} (${GATE_BUN.revision.slice(0, 12)})`);
    expect(errors[0]).toContain(`not on ${bun.version} (${bun.revision.slice(0, 12)})`);
    expect(r.stdout).toContain("host reads: 0");
    expect(r.runs).toBe(false);
  }
});

test("gate run on the pin passes the Bun check (it goes on to the host's first reading)", () => {
  // An unknown suite stops it right after the Bun check, before the host is read: the Bun check comes first of all.
  const { env } = dataDir("pin-unknown-suite");
  const child = `const { gateRun } = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))}); await gateRun(["no-such-suite"], true, false, false, { readers: {}, pollMs: 20, keepEveryMs: 3600000, bun: ${JSON.stringify(GATE_BUN)} });`;
  const r = Bun.spawnSync([process.execPath, "-e", child], { cwd: REPO, stdout: "pipe", stderr: "pipe", env });
  const out = r.stdout.toString() + r.stderr.toString();
  expect(r.exitCode).not.toBe(0);
  expect(out).not.toContain("the gate runs only on Bun");
  expect(out).toContain("no-such-suite");
});

test("accept refuses a run recorded on another Bun, before any other check", () => {
  const other = { version: GATE_BUN.version, revision: "1".repeat(40) };
  const r = acceptOf("other", { head: NO_HEAD, bun: other });
  expect(r.code, r.stdout + r.stderr).toBe(1);
  expect(errorLines(r.stdout)).toEqual([`ERROR: gate run ${r.runId} ran on Bun ${GATE_BUN.version} (111111111111), but the gate's Bun is ${GATE_BUN.version} (${GATE_BUN.revision.slice(0, 12)}) (scripts/lib/bun-pin.ts GATE_BUN); nothing accepted`]);
});

test("accept of a run on the pin, or with no Bun recorded, goes on to the next check", () => {
  const pinned = acceptOf("pinned", { head: NO_HEAD, bun: GATE_BUN });
  expect(pinned.code).toBe(1);
  expect(errorLines(pinned.stdout)).toEqual([expect.stringContaining(`gate run ${pinned.runId} tested 0000000000 but HEAD is`)]);
  expect(pinned.stdout).not.toContain("records no Bun");
  const old = acceptOf("old", { head: NO_HEAD });
  expect(old.code).toBe(1);
  expect(old.stdout).toContain(`note: gate run ${old.runId} records no Bun build`);
  expect(errorLines(old.stdout)).toEqual([expect.stringContaining(`gate run ${old.runId} tested 0000000000 but HEAD is`)]);
});

test("an unknown suite on another Bun: the Bun refusal comes first (review bun-144 N1)", () => {
  const { env } = dataDir("other-bun-unknown-suite");
  const child = `const { gateRun } = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))}); await gateRun(["no-such-suite"], true, false, false, { readers: {}, pollMs: 20, keepEveryMs: 3600000, bun: { version: "1.4.3", revision: "c6da4a4d3010e5553438c60f6bd76d981976867c" } });`;
  const r = Bun.spawnSync([process.execPath, "-e", child], { cwd: REPO, stdout: "pipe", stderr: "pipe", env });
  expect(r.exitCode).toBe(1);
  expect(errorLines(r.stdout.toString())).toEqual([expect.stringContaining("the gate runs only on Bun")]);
  expect(r.stdout.toString() + r.stderr.toString()).not.toContain("no-such-suite");
});

test("readBunExe: the running Bun reads as itself; a fake answers as its build; a missing file is an error", () => {
  const me = readBunExe(process.execPath);
  expect(me.error).toBeUndefined();
  expect(me.version).toBe(Bun.version);
  expect(Bun.revision.startsWith(me.revision!)).toBe(true);
  expect(me.sha1).toBe(new Bun.CryptoHasher("sha1").update(readFileSync(process.execPath)).digest("hex"));
  expect(execBunRefusal(me, { version: Bun.version, revision: Bun.revision })).toBeUndefined();
  const dir = mkdtempSync(join(TMP, "exe-"));
  const fake = readBunExe(fakeBun(dir));
  expect([fake.version, fake.revision, fake.error]).toEqual(["1.4.5", "0123abcde", undefined]);
  expect(execBunRefusal(fake, { version: Bun.version, revision: Bun.revision })).toContain("not the gate's own Bun");
  // Same version, another revision: refused.
  expect(execBunRefusal({ ...me, revision: "fffffffff" }, { version: Bun.version, revision: Bun.revision })).toContain("not the gate's own Bun");
  const missing = readBunExe(join(dir, "none"));
  expect(missing.sha1).toBeNull();
  expect(missing.error).toContain("cannot read it");
  expect(execBunRefusal(missing, { version: Bun.version, revision: Bun.revision })).toBeDefined();
  // A change is by content: the same reading is no change; another file, or an unreadable one, is.
  expect(bunExeChange(me, { ...me }, "x")).toBeUndefined();
  expect(bunExeChange(me, fake, "before suite s")).toContain("changed before suite s");
  expect(bunExeChange(me, missing, "at the end")).toContain("changed at the end");
});

test("acceptBunExeRefusal: start and end must be the same file; none recorded is let through", () => {
  const me = readBunExe(process.execPath);
  expect(acceptBunExeRefusal("r", undefined)).toBeUndefined();
  expect(acceptBunExeRefusal("r", { start: me, end: { ...me } })).toBeUndefined();
  expect(acceptBunExeRefusal("r", { start: me, end: { ...me, sha1: "0".repeat(40) } })).toContain("changed during the run");
  expect(acceptBunExeRefusal("r", { start: { ...me, sha1: null }, end: { ...me, sha1: null } })).toBeDefined();
});

test("the Bun file unchanged: both suites run, the run passes, gate.json bunExec has the same reading at both ends", () => {
  const r = gateSwap("exe-steady", {});
  expect(r.code, r.stdout + r.stderr).toBe(0);
  expect(errorLines(r.stdout)).toEqual([]);
  expect(r.ran).toEqual(["swap-a", "swap-b"]);
  expect(r.gateJson.pass).toBe(true);
  const x = r.gateJson.bunExec;
  expect(x.start.path).toBe(r.exe);
  expect(x.start.version).toBe(Bun.version);
  expect(x.end.sha1).toBe(x.start.sha1);
  expect(x.changed).toBeUndefined();
});

test("the Bun file swapped between suites: one ERROR: line, the next suite is not run, the run fails, gate.json has both builds", () => {
  const r = gateSwap("exe-swap-between", { swapIn: "swap-a" });
  expect(r.code, r.stdout + r.stderr).toBe(1);
  const errors = errorLines(r.stdout);
  expect(errors.length, r.stdout).toBe(1);
  expect(errors[0]).toContain(`changed before suite swap-b (during swap-a): ${Bun.version}+`);
  expect(errors[0]).toContain("now 1.4.5+0123abcde");
  expect(r.ran).toEqual(["swap-a"]);
  expect(r.gateJson.pass).toBe(false);
  expect(r.gateJson.suites.map((s: { suite: string }) => s.suite)).toEqual(["swap-a"]);
  expect(r.gateJson.notRun).toEqual([{ suite: "swap-b", reason: "the Bun file changed before suite swap-b (during swap-a)" }]);
  const x = r.gateJson.bunExec;
  expect(x.start.version).toBe(Bun.version);
  expect([x.end.version, x.end.revision]).toEqual(["1.4.5", "0123abcde"]);
  expect(x.end.sha1).not.toBe(x.start.sha1);
  expect(x.changed).toBe("before suite swap-b (during swap-a)");
  expect(r.stdout).toContain("gate FAIL");
});

test("the Bun file swapped during the last suite: seen at the end, the run fails", () => {
  const r = gateSwap("exe-swap-last", { swapIn: "swap-b" });
  expect(r.code, r.stdout + r.stderr).toBe(1);
  expect(errorLines(r.stdout)).toEqual([expect.stringContaining("changed at the end (during swap-b)")]);
  expect(r.ran).toEqual(["swap-a", "swap-b"]);
  expect(r.gateJson.pass).toBe(false);
  expect(r.gateJson.bunExec.changed).toBe("at the end (during swap-b)");
  expect(r.gateJson.bunExec.end.version).toBe("1.4.5");
});

test("a Bun file that is not the running build at the start: refused before any work", () => {
  const r = gateSwap("exe-start-fake", { startFake: true });
  expect(r.code, r.stdout + r.stderr).toBe(1);
  expect(errorLines(r.stdout)).toEqual([expect.stringContaining(`the Bun the gate's children run, ${r.exe}, is 1.4.5+0123abcde`)]);
  expect(r.stdout).toContain("host reads: 0");
  expect(r.runs).toBe(false);
});

test("accept refuses a run whose Bun file changed; the same file at both ends, or none recorded, goes on", () => {
  const me = readBunExe(process.execPath);
  const changed = acceptOf("exe-changed", { head: NO_HEAD, bun: GATE_BUN, bunExec: { start: me, end: { ...me, sha1: "1".repeat(40), version: "1.4.5" }, changed: "at the end" } });
  expect(changed.code).toBe(1);
  expect(errorLines(changed.stdout)).toEqual([expect.stringContaining(`gate run ${changed.runId}: the Bun file its children ran changed during the run`)]);
  const same = acceptOf("exe-same", { head: NO_HEAD, bun: GATE_BUN, bunExec: { start: me, end: me } });
  expect(errorLines(same.stdout)).toEqual([expect.stringContaining("tested 0000000000 but HEAD is")]);
  expect(same.stdout).not.toContain("records no reading");
  const old = acceptOf("exe-old", { head: NO_HEAD, bun: GATE_BUN });
  expect(old.stdout).toContain(`note: gate run ${old.runId} records no reading of the Bun file`);
  expect(errorLines(old.stdout)).toEqual([expect.stringContaining("tested 0000000000 but HEAD is")]);
});
