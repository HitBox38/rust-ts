// The gate's Bun pin (lane bun-144; docs/reviews/w40j-audit.md N1): `gate.ts run` refuses any Bun build but scripts/lib/bun-pin.ts
// `GATE_BUN` before any work, and `gate.ts accept` refuses a run whose gate.json records another build. Both in a child, with
// RUST_TS_DATA at a temp dir (an empty git repository as its upstream checkout, as scripts/gate-power.test.ts): the shared run
// directories, baselines and state records are never touched. That gate.json records the build is checked by gate-power.test.ts.
// The file the gate's children run (`process.execPath`) is checked at the start, before each suite and at the end (review bun-144
// F1): here through `GateHost.execPath`, a symlink to the running Bun that a stub suite's subject swaps for a fake Bun. And
// `gate.ts run` runs from a private copy of its Bun (`gateBunClone`, review bun-144-recheck F1-r): tested through the real copy and
// second process, with a swap of the original that is undone before the next reading.
import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// No import may load scripts/lib/common.ts (scripts/lib/subject-bin.ts does): this file runs in the runner unit-test process
// before scripts/lib/deps.test.ts, which needs common.ts to read its temp RUST_TS_DATA. That `GATE_BUN` is in `VALIDATED_BUN` is
// checked in scripts/subject-bin.cases.ts, which runs in a child.
import { GATE_BUN, acceptBunCloneRefusal, acceptBunExeRefusal, acceptBunRefusal, bornSinceCommand, builtByRefusal, bunExeChange, cloneBunFile, cloneRefusal, execBunRefusal, gateBunRefusal, pruneGateBunDirs, readBunExe } from "./lib/bun-pin.ts";
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
  // Same version and revision, other content: a change (review bun-144-recheck N1).
  expect(bunExeChange(me, { ...me, sha1: "0".repeat(40) }, "x")).toContain("changed x");
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

test("the cache warning names the exact command that lists (and with -delete removes) the entries born since the last good reading", () => {
  expect(bornSinceCommand("/d/oracle-cache", "2026-11-11T12:43:05.123Z")).toBe("cd '/d/oracle-cache' && /usr/bin/find . -type f -newerBt '2026-11-11 12:43:05 UTC'");
  expect(bornSinceCommand("/d/it's", "2026-11-11T12:43:05Z")).toStartWith("cd '/d/it'\\''s' && ");
  const me = readBunExe(process.execPath);
  const msg = bunExeChange(me, { ...me, sha1: "0".repeat(40) }, "before suite s (during r)", { dir: "/d/oracle-cache", since: "2026-11-11T12:43:05.000Z" })!;
  expect(msg).toContain("delete the oracle cache entries born since the last good reading (2026-11-11T12:43:05.000Z): `cd '/d/oracle-cache' && /usr/bin/find . -type f -newerBt '2026-11-11 12:43:05 UTC' -delete`");
  // BSD find parses that form (the shell's `find` may be another tool).
  const dir = mkdtempSync(join(TMP, "find-"));
  writeFileSync(join(dir, "x"), "x");
  const listed = Bun.spawnSync(["/bin/sh", "-c", bornSinceCommand(dir, new Date(Date.now() - 3_600_000).toISOString())]);
  expect(listed.exitCode).toBe(0);
  expect(listed.stdout.toString().trim()).toBe("./x");
});

test("the cache command with -delete stays inside a cache whose path has a space (review bun-144-recheck2 N5)", () => {
  const base = mkdtempSync(join(TMP, "space-"));
  const cache = join(base, "my data", "oracle-cache");
  mkdirSync(join(cache, "ab"), { recursive: true });
  writeFileSync(join(cache, "ab", "entry"), "x");
  // What an unquoted path would walk instead: `<base>/my` and, from the cwd, `data/oracle-cache`.
  for (const d of [join(base, "my"), join(base, "data", "oracle-cache")]) {
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "decoy"), "x");
  }
  const r = Bun.spawnSync(["/bin/sh", "-c", `${bornSinceCommand(cache, new Date(Date.now() - 3_600_000).toISOString())} -delete`], { cwd: base });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  expect(existsSync(join(cache, "ab", "entry"))).toBe(false);
  expect(existsSync(join(base, "my", "decoy"))).toBe(true);
  expect(existsSync(join(base, "data", "oracle-cache", "decoy"))).toBe(true);
  // A cache dir that is not there: the `cd` fails and nothing runs.
  const gone = Bun.spawnSync(["/bin/sh", "-c", `${bornSinceCommand(join(base, "none"), new Date(0).toISOString())} -delete`], { cwd: base });
  expect(gone.exitCode).not.toBe(0);
  expect(existsSync(join(base, "my", "decoy"))).toBe(true);
});

test("cloneBunFile: an APFS clone; a plain copy, with the reason, when clonefile fails; cloneRefusal checks the copy", () => {
  const dir = mkdtempSync(join(TMP, "clone-"));
  const fake = fakeBun(dir);
  const a = cloneBunFile(fake, join(dir, "a"));
  expect(a).toEqual({ how: "clonefile" });
  expect(readFileSync(join(dir, "a"), "utf8")).toBe(readFileSync(fake, "utf8"));
  const b = cloneBunFile(fake, join(dir, "b"), ["/usr/bin/false"]);
  expect(b.how).toBe("copy");
  expect(b.why).toContain("/usr/bin/false exited 1");
  expect(readBunExe(join(dir, "b")).revision).toBe("0123abcde");
  const me = readBunExe(process.execPath);
  const running = { version: Bun.version, revision: Bun.revision };
  expect(cloneRefusal(me, { ...me, path: "/c/bun" }, running)).toBeUndefined();
  expect(cloneRefusal(me, readBunExe(fake), running)).toContain("not as");
  expect(cloneRefusal(me, { ...me, path: "/c/bun", sha1: "0".repeat(40) }, running)).toContain("reads as");
});

test("builtByRefusal: every subject binary must be built by the gate's Bun", () => {
  const bins = [{ entry: "src/rust_ts/main.ts", hash: "a".repeat(40), bun: GATE_BUN }, { entry: "src/miri/bin/miri.ts", hash: "b".repeat(40), bun: { ...GATE_BUN } }];
  expect(builtByRefusal(bins, GATE_BUN)).toBeUndefined();
  expect(builtByRefusal([], GATE_BUN)).toBeUndefined();
  const old = { version: "1.4.3", revision: "c6da4a4d3010e5553438c60f6bd76d981976867c" };
  expect(builtByRefusal([bins[0]!, { ...bins[1]!, bun: old }], GATE_BUN)).toContain("subject binary src/miri/bin/miri.ts (bbbbbbbbbbbb, built by Bun 1.4.3 (c6da4a4d3010))");
  expect(builtByRefusal([{ ...bins[0]!, bun: undefined }], GATE_BUN)).toContain("built by Bun unknown");
  // A build that records its builder's file content must have been built by the gate's file.
  expect(builtByRefusal([{ ...bins[0]!, bun: { ...GATE_BUN, sha1: "a".repeat(40) } }], GATE_BUN, "a".repeat(40))).toBeUndefined();
  expect(builtByRefusal([{ ...bins[0]!, bun: { ...GATE_BUN, sha1: "b".repeat(40) } }], GATE_BUN, "a".repeat(40))).toContain("sha1 bbbbbbbbbbbb");
});

/**
 * `gate.ts run`'s copy and second process (`gateBunClone`) on the two stub suites, started from `<dir>/bin/bun`, an APFS clone
 * of the running Bun standing for the machine's. `swap-a`'s subject replaces that file with a fake Bun, starts
 * `process.execPath --revision` (a child the gate starts in that window), records what it ran, and puts the real Bun back
 * before the next reading (review bun-144-recheck F1-r).
 */
function gateCloned(name: string, opts: { cp?: string[] } = {}) {
  const { data, env } = dataDir(name);
  const bin = join(data, "bin");
  mkdirSync(bin);
  const orig = join(bin, "bun");
  const real2 = join(bin, "bun-again");
  for (const f of [orig, real2]) cloneBunFile(process.execPath, f);
  const fake = fakeBun(bin);
  // A `bunx` on PATH that is not the gate's (the copy's directory must come first).
  writeFileSync(join(bin, "bunx"), "#!/bin/sh\necho 1.4.5\n");
  chmodSync(join(bin, "bunx"), 0o755);
  const witness = join(data, "witness.json");
  const stub = join(data, "stub.mjs");
  const script = join(data, "gate-child.ts");
  writeFileSync(script, `
import { writeFileSync } from "node:fs";
const { gateBunClone, gateRun } = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const bunClone = await gateBunClone(${opts.cp ? JSON.stringify({ cp: opts.cp }) : ""});
console.log("second process on " + process.execPath);
const { SUITES } = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const { PIN } = await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))});
const ORACLE = ["rustc", \`+\${PIN.toolchain}\`, "-vV"];
writeFileSync(${JSON.stringify(stub)}, \`
import { existsSync, renameSync, writeFileSync } from "node:fs";
if (process.argv[2] === "swap-a" && existsSync(\${JSON.stringify(${JSON.stringify(fake)})})) {
  renameSync(\${JSON.stringify(${JSON.stringify(fake)})}, \${JSON.stringify(${JSON.stringify(orig)})});
  const p = Bun.spawnSync([process.execPath, "--revision"]);
  const bare = Bun.spawnSync(["bun", "--revision"]);
  const bunx = Bun.spawnSync(["bunx", "--version"]);
  writeFileSync(\${JSON.stringify(${JSON.stringify(witness)})}, JSON.stringify({ execPath: process.execPath, revision: p.stdout.toString().trim(), bare: bare.stdout.toString().trim(), bunx: bunx.stdout.toString().trim() }));
  renameSync(\${JSON.stringify(${JSON.stringify(real2)})}, \${JSON.stringify(${JSON.stringify(orig)})});
}
await Bun.write(Bun.stdout, Bun.spawnSync(\${JSON.stringify(ORACLE)}).stdout);
\`);
for (const name of ["swap-a", "swap-b"]) SUITES.push({
  name, milestone: "test", description: "", mode: "single", cwd: ${JSON.stringify(data)}, timeoutMs: 30000,
  cases: () => [{ id: "same", file: "", args: [] }],
  oracle: () => ORACLE, subject: () => [process.execPath, ${JSON.stringify(stub)}, name],
});
const readers = { pmset: async () => "Now drawing from 'AC Power'\\n", swapusage: async () => "total = 2048.00M  used = 512.00M  free = 1536.00M", load: () => [1, 2, 3], now: () => new Date() };
await gateRun(["swap-a", "swap-b"], true, false, false, { readers, pollMs: 3600000, keepEveryMs: 3600000, bunClone });
`);
  // `<dir>/bin` (the machine's Bun, swapped) first on PATH, as `~/.bun/bin` is: a bare `bun` resolves there unless the gate puts
  // its copy first (review bun-144-recheck2 F1-rr).
  const r = Bun.spawnSync([orig, script], { cwd: REPO, stdout: "pipe", stderr: "pipe", env: { ...env, PATH: `${bin}:${env.PATH ?? ""}` } });
  const runs = join(data, "runs");
  const dirs = existsSync(runs) ? readdirSync(runs).filter((d) => d.startsWith("gate-")) : [];
  const dir = dirs[0] === undefined ? undefined : join(runs, dirs[0]);
  return {
    code: r.exitCode,
    stdout: r.stdout.toString(),
    stderr: r.stderr.toString(),
    orig,
    gateBunDir: join(data, "gate-bun"),
    witness: existsSync(witness) ? (JSON.parse(readFileSync(witness, "utf8")) as { execPath: string; revision: string; bare: string; bunx: string }) : undefined,
    gateJson: dir === undefined ? undefined : (JSON.parse(readFileSync(join(dir, "gate.json"), "utf8")) as any),
  };
}

test("a swap of the machine's Bun undone before the next reading cannot reach the gate's children: they run its private copy", () => {
  const r = gateCloned("clone-swap-restore");
  expect(r.code, r.stdout + r.stderr).toBe(0);
  const copyPath = /\/gate-bun\/run-\d+-[^/]+\/bun$/;
  // The children started while the original was swapped ran the gate's copy, so the gate's build: as `process.execPath`, as a
  // bare `bun` and as a bare `bunx` through PATH.
  expect(r.witness).toBeDefined();
  expect(r.witness!.revision).toBe(`${Bun.version}+${Bun.revision.slice(0, 9)}`);
  expect(r.witness!.bare).toBe(`${Bun.version}+${Bun.revision.slice(0, 9)}`);
  expect(r.witness!.bunx).toBe(Bun.version);
  expect(r.witness!.execPath).toMatch(copyPath);
  expect(r.stdout).toMatch(/^second process on .*\/gate-bun\/run-\d+-[^/]+\/bun$/m);
  expect(errorLines(r.stdout)).toEqual([]);
  expect(r.gateJson.pass).toBe(true);
  const c = r.gateJson.bunClone;
  expect(c.path).toMatch(copyPath);
  expect(c.parent).toBeGreaterThan(0);
  expect(c.from.endsWith("/bin/bun")).toBe(true);
  expect(c.sha1).toBe(readBunExe(process.execPath).sha1);
  expect(c.how).toBe("clonefile");
  // The readings were of the copy, unchanged.
  expect(r.gateJson.bunExec.start.path).toBe(c.path);
  expect(r.gateJson.bunExec.end.sha1).toBe(c.sha1);
  // The copy is removed at the end; the original was put back, so no note about it.
  expect(readdirSync(r.gateBunDir)).toEqual([]);
  expect(r.stdout).not.toContain("changed while the gate ran");
});

test("a copy of the gate's Bun that does not read as the original: one ERROR: line, no run, no copy left", () => {
  const r = gateCloned("clone-bad", { cp: ["/bin/sh", "-c", 'echo junk > "$2"', "sh"] });
  expect(r.code, r.stdout + r.stderr).toBe(1);
  expect(errorLines(r.stdout)).toEqual([expect.stringContaining("the gate's copy of its Bun")]);
  expect(r.stdout).not.toContain("second process on");
  expect(r.gateJson).toBeUndefined();
  expect(readdirSync(r.gateBunDir)).toEqual([]);
});

test("acceptBunCloneRefusal and accept: a run with no copy (null) is refused; an old gate.json (absent) gets a note", () => {
  expect(acceptBunCloneRefusal("r", undefined)).toBeUndefined();
  expect(acceptBunCloneRefusal("r", { path: "/c/bun", from: "/b/bun", sha1: "a".repeat(40), how: "clonefile", parent: 1 })).toBeUndefined();
  expect(acceptBunCloneRefusal("r", null)).toContain("did not run from a private copy");
  const me = readBunExe(process.execPath);
  const base = { head: NO_HEAD, bun: GATE_BUN, bunExec: { start: me, end: me } };
  const none = acceptOf("clone-null", { ...base, bunClone: null });
  expect(errorLines(none.stdout)).toEqual([expect.stringContaining(`gate run ${none.runId} did not run from a private copy of its Bun`)]);
  const ok = acceptOf("clone-ok", { ...base, bunClone: { path: "/c/bun", from: "/b/bun", sha1: me.sha1, how: "clonefile", parent: 1 } });
  expect(errorLines(ok.stdout)).toEqual([expect.stringContaining("tested 0000000000 but HEAD is")]);
  expect(ok.stdout).not.toContain("records no private copy");
  const old = acceptOf("clone-old", base);
  expect(old.stdout).toContain(`note: gate run ${old.runId} records no private copy of its Bun`);
  expect(errorLines(old.stdout)).toEqual([expect.stringContaining("tested 0000000000 but HEAD is")]);
});

test("the gate's second process takes its copy only from its own parent's record, under gate-bun/, and runs from it", () => {
  const { data, env } = dataDir("clone-second");
  const script = join(data, "second.ts");
  writeFileSync(script, `
const { gateBunClone } = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const c = await gateBunClone();
const child = Bun.spawnSync(["/usr/bin/env"]).stdout.toString();
console.log("returned " + c.path + "; a child's environment names it: " + /gate-bun-clone|GATE_BUN_CLONE/i.test(child));
`);
  const me = readBunExe(process.execPath);
  // A copy and its record where the first process puts them (`GATE_BUN_DIR` of the child's RUST_TS_DATA).
  const home = join(data, "gate-bun", "run-1-x");
  mkdirSync(home, { recursive: true });
  const copy = realpathSync(home) + "/bun";
  cloneBunFile(process.execPath, copy);
  const write = (name: string, rec: Record<string, unknown>) => {
    const f = join(realpathSync(home), name);
    writeFileSync(f, JSON.stringify({ path: copy, from: "/b/bun", sha1: me.sha1, how: "clonefile", parent: process.pid, ...rec }));
    return `--gate-bun-clone=${f}`;
  };
  const run = (exe: string, arg: string) => {
    const p = Bun.spawnSync([exe, script, arg], { cwd: REPO, stdout: "pipe", stderr: "pipe", env });
    return { code: p.exitCode, out: p.stdout.toString(), errors: errorLines(p.stdout.toString()) };
  };
  // This process is the second's parent: its record is taken, and no child sees the hand-off.
  const ok = run(copy, write("clone.json", {}));
  expect(ok.code, ok.out).toBe(0);
  expect(ok.out).toContain(`returned ${copy}; a child's environment names it: false`);
  // Another parent's record (a stale one, or one handed on): refused.
  const stale = run(copy, write("stale.json", { parent: 1 }));
  expect(stale.code).toBe(1);
  expect(stale.errors).toEqual([expect.stringContaining(`names first process 1, but this process's parent is ${process.pid}`)]);
  // Not run from the copy: refused.
  const notCopy = run(process.execPath, write("clone.json", {}));
  expect(notCopy.errors).toEqual([`ERROR: the gate's second process runs ${process.execPath}, not its copy of Bun ${copy}`]);
  // A record that names the machine's Bun itself, to skip the copy: refused.
  const byHand = run(process.execPath, write("hand.json", { path: process.execPath }));
  expect(byHand.errors).toEqual([expect.stringContaining(`the gate's copy of its Bun, ${process.execPath}, is not a copy the first process made under`)]);
});

test("pruneGateBunDirs removes only copies whose gate is gone, and half-made ones that are old", () => {
  const root = mkdtempSync(join(TMP, "prune-"));
  const make = (name: string, owner?: unknown) => {
    mkdirSync(join(root, name));
    if (owner !== undefined) writeFileSync(join(root, name, "owner.json"), JSON.stringify(owner));
    return join(root, name);
  };
  const dead = Bun.spawnSync(["/usr/bin/true"]).pid;
  make("live", { pid: process.pid });
  make("dead", { pid: dead });
  make("fresh");
  const old = make("old");
  utimesSync(old, new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));
  expect(pruneGateBunDirs(root).map((d) => d.slice(root.length + 1)).sort()).toEqual(["dead", "old"]);
  expect(readdirSync(root).sort()).toEqual(["fresh", "live"]);
});

test("gate.ts run refuses a subject binary its builder's record says another Bun built (review bun-144-recheck2 N8, N7)", () => {
  const { data, env } = dataDir("forged-builder");
  // Records (no binaries are built) under the keys this tree's builds have, computed here from the machine's Bun path: the gate,
  // from its own copy, finds them, since a build is keyed by the Bun's content, not its path (N7).
  const forge = join(data, "forge.ts");
  writeFileSync(forge, `
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const { BINARY_ENTRIES, SUBJECT_BIN_DIR, buildSpec, subjectBinKey } = await import(${JSON.stringify(join(REPO, "scripts/lib/subject-bin.ts"))});
for (const entry of BINARY_ENTRIES) {
  const spec = buildSpec(entry);
  const { hash, inputs, config, runtimeC } = await subjectBinKey(spec);
  const dir = join(SUBJECT_BIN_DIR, hash);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "rts"), "");
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ hash, entry, spec, bun: { version: "1.4.3", revision: "c6da4a4d3010e5553438c60f6bd76d981976867c" }, inputs, config, runtimeC, builtAt: new Date().toISOString(), buildMs: 0 }));
  console.log(entry + " " + hash);
}
`);
  const f = Bun.spawnSync([process.execPath, forge], { cwd: REPO, stdout: "pipe", stderr: "pipe", env });
  expect(f.exitCode, f.stdout.toString() + f.stderr.toString()).toBe(0);
  const keys = f.stdout.toString().trim().split("\n").map((l) => l.split(" ")[1]!.slice(0, 12));
  const r = Bun.spawnSync([process.execPath, join(REPO, "scripts/gate.ts"), "run", "--suites", "check-rg", "--skip-static", "--allow-battery"], {
    cwd: REPO,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...env, RUST_TS_SUBJECT: "binary" },
  });
  const out = r.stdout.toString();
  expect(r.exitCode, out + r.stderr.toString()).toBe(1);
  const errors = errorLines(out);
  expect(errors.length, out).toBe(1);
  expect(errors[0]).toContain(`subject binary src/rust_ts/main.ts (${keys[0]}, built by Bun 1.4.3 (c6da4a4d3010))`);
  expect(errors[0]).toContain(`src/miri/bin/miri.ts (${keys[1]}, built by Bun 1.4.3 (c6da4a4d3010))`);
  expect(errors[0]).toContain(`was not built by the gate's Bun ${GATE_BUN.version}`);
  // Refused before the run directory; the gate's copy is removed.
  expect(existsSync(join(data, "runs"))).toBe(false);
  expect(readdirSync(join(data, "gate-bun"))).toEqual([]);
}, 120_000);
