// The `miri-sysroot-*` report suites' definitions (plan-m6 D4; lane harness-m6d), in a child process for the parts that load
// scripts/lib/common.ts (see scripts/lib/deps.test.ts). No crate is compiled here: the results are in docs/handoff/miri-sysroot.md.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-miri-sysroot-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const CORPUS = JSON.parse(readFileSync(join(REPO, "harness/corpus/miri-sysroot/crates.json"), "utf8")) as Record<string, { cwd: string; args: string[]; env: Record<string, string> }>;

test("the corpus: the 26 crates with a source left, cargo-miri's flags, nothing tied to the setup run but OUT_DIR", () => {
  expect(Object.keys(CORPUS).length).toBe(26);
  expect(Object.keys(CORPUS)).not.toContain("custom_local_sysroot");
  for (const [name, c] of Object.entries(CORPUS)) {
    expect(c.args[c.args.indexOf("--crate-name") + 1]).toBe(name);
    expect(c.args.filter((a) => a === "$OUT").length).toBe(1);
    expect(c.args).toContain("--emit=dep-info,metadata,link");
    expect(c.args).toContain("embed-metadata=no");
    expect(c.args[c.args.indexOf("--target") + 1]).toBe("x86_64-unknown-linux-gnu");
    expect(JSON.stringify(c.args)).not.toContain("/var/folders");
    expect(c.cwd).toBe(c.env.CARGO_MANIFEST_DIR!);
    expect(c.cwd.startsWith("$TC/") || c.cwd.startsWith("$CARGO_HOME/")).toBe(true);
  }
  // cargo passes both files of a dep, both now in the sysroot's library directory.
  expect(CORPUS.core!.args).not.toContain("--extern");
  expect(CORPUS.std!.args.filter((a) => a.startsWith("core=$LIB/libcore-"))).toHaveLength(2);
  expect(CORPUS.std!.env.STD_ENV_ARCH).toBe("x86_64");
  // cargo-miri's own patch, which the cargo log does not show; no other crate has it.
  expect(Object.keys(CORPUS).filter((n) => CORPUS[n]!.args.includes("-Cpanic=abort"))).toEqual(["panic_abort"]);
});

test("the suites: report only, heavy, Miri's oracle, no baseline, out of the gate's default set", () => {
  const code = `
const s = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const g = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const m = await import(${JSON.stringify(join(REPO, "harness/miri-sysroot.ts"))});
const { miriBinary, MIRI_SYSROOT } = await import(${JSON.stringify(join(REPO, "scripts/lib/miri.ts"))});
const names = ["miri-sysroot-core", "miri-sysroot-alloc", "miri-sysroot-std"];
const inv = m.miriSysrootInvocation("alloc", "/o");
console.log(JSON.stringify({
  fields: names.map((n) => { const x = s.suite(n); return { mode: x.mode, miri: x.miri, heavy: Boolean(x.heavy), criterion: x.criterion, ids: x.cases().map((c) => c.id), runs: g.oracleRuns(x.oracle(x.cases())), isMiri: g.oracleRuns(x.oracle(x.cases()))[0] === miriBinary(), undeclared: g.undeclaredRuns(x), subject: x.subject(x.cases()).slice(-2)[1], side: [x.oracle(x.cases())[5], x.subject(x.cases())[5]] }; }),
  all: s.SUITES.map((x) => x.name),
  dupes: s.SUITES.length - new Set(s.SUITES.map((x) => x.name)).size,
  inv: { hasOut: inv.args.includes("/o"), sysroot: inv.args.slice(-2)[0], be: inv.env.MIRI_BE_RUSTC, left: JSON.stringify(inv).match(/\\$(TC|LIB|OUT|CARGO_HOME)/g), extern: inv.args.filter((a) => a.startsWith("core=")).map((a) => a.startsWith("core=" + MIRI_SYSROOT + "/lib/rustlib/x86_64-unknown-linux-gnu/lib/libcore-")) },
}));
`;
  const r = Bun.spawnSync([process.execPath, "-e", code], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  const j = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);
  for (const [i, f] of j.fields.entries()) {
    expect(f.mode).toBe("single");
    expect(f.miri).toBe(true);
    expect(f.heavy).toBe(true);
    expect(f.criterion).toBeUndefined();
    expect(f.ids).toEqual([["core", "alloc", "std"][i]]);
    expect(f.isMiri).toBe(true);
    expect(f.undeclared).toEqual([]);
    expect(f.subject.endsWith("src/miri/bin/miri.ts")).toBe(true);
    expect(f.side).toEqual(["oracle", "subject"]);
  }
  expect(j.dupes).toBe(0);
  expect(j.inv).toEqual({ hasOut: true, sysroot: "--sysroot", be: "target", left: null, extern: [true] });
  // scripts/gate.ts's default is the suites with a baseline file: these have none.
  const base = readdirSync(join(REPO, "harness/baseline"));
  for (const c of ["core", "alloc", "std"]) expect(base).not.toContain(`miri-sysroot-${c}.txt`);
  expect(existsSync(join(REPO, "harness/baseline/miri-sysroot-core.txt"))).toBe(false);
}, 30_000);

test("the wrapper: its command line, and the lines it prints", async () => {
  const code = `
const m = await import(${JSON.stringify(join(REPO, "scripts/miri-sysroot-run.ts"))});
const { writeFileSync } = await import("node:fs");
const T = ${JSON.stringify(TMP)};
writeFileSync(T + "/a", "abcd"); writeFileSync(T + "/b", "abXd"); writeFileSync(T + "/c", "abcd");
const parse = (a) => { try { return m.parseMiriSysrootRunArgs(a); } catch (e) { return e.message; } };
console.log(JSON.stringify({
  ok: parse(["--crate", "core", "--side", "subject", "--", "bun", "x"]),
  bad: [parse(["--crate", "core", "--side", "x", "--", "a"]), parse(["--crate", "core", "--side", "oracle"]), parse(["--side", "oracle", "--", "a"]), parse(["--nope"])],
  none: [m.fileLine("rlib", undefined), m.sysrootLine("rlib", undefined, T + "/a")],
  file: m.fileLine("rmeta", T + "/a"),
  same: m.sysrootLine("rmeta", T + "/a", T + "/c"),
  differs: m.sysrootLine("rmeta", T + "/a", T + "/b"),
  absent: m.sysrootLine("rlib", T + "/a", T + "/no-such"),
}));
`;
  const r = Bun.spawnSync([process.execPath, "-e", code], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  const j = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);
  expect(j.ok).toEqual({ crate: "core", side: "subject", compiler: ["bun", "x"] });
  expect(j.bad).toEqual(["miri-sysroot-run: --side must be oracle or subject, not x", "miri-sysroot-run: no compiler command after `--`", "miri-sysroot-run: --crate and --side are required", "miri-sysroot-run: unknown option --nope"]);
  expect(j.none).toEqual(["rlib: none", "sysroot rlib: none"]);
  expect(j.file).toBe(`rmeta: 4 bytes, sha256 ${new Bun.CryptoHasher("sha256").update("abcd").digest("hex")}`);
  expect(j.same).toBe("sysroot rmeta: same");
  expect(j.differs).toBe(`sysroot rmeta: differs from 4 bytes, sha256 ${new Bun.CryptoHasher("sha256").update("abXd").digest("hex")}, first at byte 2`);
  expect(j.absent).toBe("sysroot rlib: differs: not in the sysroot");
  writeFileSync(join(TMP, "done"), "");
}, 30_000);
