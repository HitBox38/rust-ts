// Unit tests of harness/library.ts (lane harness-m5c): the library crates' argv (plan-m5 D1), the aux chain's shape
// (D2), and the M5 alloc/std suites' commands. Nothing here builds an aux crate: every `libArgs` call passes a fake
// `rmeta`, and the suites' commands are made for hand-written cases.
//
// Like compiletest.test.ts, the modules are loaded in a child process: scripts/lib/deps.test.ts points RUST_TS_DATA at
// a temp dir before it first imports scripts/lib/common.ts, and `bun test scripts harness` shares one module cache.
import { expect, test } from "bun:test";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const CHILD = `
const L = await import(${JSON.stringify(join(REPO, "harness/library.ts"))});
const S = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const { UPSTREAM } = await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))});
const { existsSync, readFileSync } = await import("node:fs");
const { dirname, join } = await import("node:path");
const fake = (c) => "/aux/" + c + "/lib" + c + ".rmeta";
const manifest = (root) => {
  for (let d = dirname(join(UPSTREAM, root)); d.startsWith(UPSTREAM); d = dirname(d))
    if (existsSync(join(d, "Cargo.toml"))) return readFileSync(join(d, "Cargo.toml"), "utf8");
};
const inTree = L.LIB_CRATES.filter((c) => !c.pkg);
const names = L.LIB_CRATES.map((c) => c.name);
const caseOf = (args) => ({ id: "x", file: "library/std/src/lib.rs", args, env: {} });
const stdArgs = L.libArgs("std", fake);
let lockErrors = [];
for (const lock of ["", '[[package]]\\nname = "a"\\nversion = "1.0.0"\\nsource = "registry+x"\\n\\n[[package]]\\nname = "a"\\nversion = "2.0.0"\\nsource = "registry+x"\\n'])
  try { L.libLockedVersion("a", lock); } catch (e) { lockErrors.push(e.message); }
console.log(JSON.stringify({
  core: L.libArgs("core", fake),
  coreSuites: S.CORE_ARGS(["lib"]),
  alloc: L.libArgs("alloc", fake),
  std: stdArgs,
  stdEnv: L.libEnv("std"),
  allocEnv: L.libEnv("alloc"),
  closure: L.libClosure("std").map((c) => c.name),
  allocClosure: L.libClosure("alloc").map((c) => c.name),
  depsFirst: L.LIB_CRATES.filter((c, i) => c.deps.some((d) => names.indexOf(d.crate) < 0 || names.indexOf(d.crate) >= i)).map((c) => c.name),
  unique: new Set(names).size === names.length,
  rootsMissing: inTree.filter((c) => !existsSync(join(UPSTREAM, c.root))).map((c) => c.name),
  editionsOff: inTree.filter((c) => !new RegExp('^edition = "' + c.edition + '"$', "m").test(manifest(c.root) ?? "")).map((c) => c.name),
  inputsMissing: inTree.flatMap((c) => c.inputs.filter((d) => !existsSync(join(UPSTREAM, d)))),
  versions: Object.fromEntries(L.LIB_CRATES.filter((c) => c.pkg).map((c) => [c.pkg, L.libLockedVersion(c.pkg)])),
  lockSynthetic: L.libLockedVersion("b", '[[package]]\\nname = "b"\\nversion = "0.1.2"\\nsource = "registry+x"\\n\\n[[package]]\\nname = "b"\\nversion = "9.9.9"\\n'),
  lockErrors,
  rmetaStd: S.suite("rmeta-std").oracle([caseOf(stdArgs)]),
  checkStd: S.suite("check-std").oracle([caseOf(stdArgs)]),
  mirAlloc: S.suite("mir-alloc").subject([caseOf(["-Zunpretty=mir"])]),
  heavy: ["check-alloc", "rmeta-alloc", "mir-alloc", "check-std", "rmeta-std", "mir-std", "check-chain"].map((n) => [n, S.suite(n).mode, !!S.suite(n).heavy, S.suite(n).inputDirs]),
  EMPTY: L.EMPTY_SYSROOT,
  CHAIN_RUN: S.CHAIN_RUN,
}));
`;

const j = (() => {
  const r = Bun.spawnSync([process.execPath, "-e", CHILD], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString() + r.stdout.toString());
  return JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);
})();
const D1 = ["--crate-type", "lib", "--target", "x86_64-unknown-linux-gnu", "-Zforce-unstable-if-unmarked", "--emit=metadata"];

test("core's argv is the core suites' (so the aux core rmeta is check-core's oracle file)", () => {
  expect(j.core).toEqual(j.coreSuites);
});

test("alloc's argv: D1, the empty sysroot, cargo's priv: mark, every transitive dep's dir", () => {
  expect(j.alloc).toEqual([
    "--crate-name", "alloc", "--edition=2024", "library/alloc/src/lib.rs", ...D1,
    "--sysroot", j.EMPTY,
    "-Zunstable-options",
    "--extern", "priv:compiler_builtins=/aux/compiler_builtins/libcompiler_builtins.rmeta",
    "--extern", "core=/aux/core/libcore.rmeta",
    "-L", "dependency=/aux/core",
    "-L", "dependency=/aux/compiler_builtins",
  ]);
  expect(j.allocEnv).toEqual({});
  expect(j.allocClosure).toEqual(["core", "compiler_builtins", "alloc"]);
});

test("std's argv: features and build-script cfg, 13 externs (9 priv), 19 dep dirs, STD_ENV_ARCH", () => {
  const a: string[] = j.std;
  expect(a.slice(0, 4 + D1.length)).toEqual(["--crate-name", "std", "--edition=2024", "library/std/src/lib.rs", ...D1]);
  const vals = (flag: string) => a.flatMap((x, i) => (a[i - 1] === flag ? [x] : []));
  expect(vals("--cfg")).toEqual(['feature="addr2line"', 'feature="backtrace"', 'feature="miniz_oxide"', 'feature="object"', 'feature="panic-unwind"', "backtrace_in_libstd"]);
  const ext = vals("--extern");
  expect(ext.length).toBe(13);
  expect(ext.filter((e) => e.startsWith("priv:")).map((e) => e.slice(5, e.indexOf("=")))).toEqual([
    "addr2line", "cfg_if", "hashbrown", "miniz_oxide", "object", "panic_abort", "panic_unwind", "rustc_demangle", "unwind",
  ]);
  expect(ext.filter((e) => !e.startsWith("priv:")).map((e) => e.slice(0, e.indexOf("=")))).toEqual(["alloc", "core", "libc", "std_detect"]);
  expect(vals("-L")).toEqual(j.closure.slice(0, -1).map((c: string) => `dependency=/aux/${c}`));
  expect(j.closure.length).toBe(20);
  expect(a).toContain("-Zunstable-options");
  expect(a).not.toContain("--cap-lints");
  expect(vals("--sysroot")).toEqual([j.EMPTY]);
  expect(j.stdEnv).toEqual({ STD_ENV_ARCH: "x86_64" });
});

test("the crate table: unique, deps first, in-tree roots/editions/inputs match the checkout, registry versions locked", () => {
  expect(j.unique).toBe(true);
  expect(j.depsFirst).toEqual([]);
  expect(j.rootsMissing).toEqual([]);
  expect(j.editionsOff).toEqual([]);
  expect(j.inputsMissing).toEqual([]);
  // library/Cargo.lock at the pin (plan-m5 §1a).
  expect(j.versions).toEqual({
    libc: "0.2.189", memchr: "2.8.3", adler2: "2.0.1", "rustc-demangle": "0.1.28", "cfg-if": "1.0.4",
    gimli: "0.34.0", object: "0.39.1", hashbrown: "0.17.1", miniz_oxide: "0.9.1", addr2line: "0.27.1",
  });
});

test("libLockedVersion: only crates.io entries; none or several is an error", () => {
  expect(j.lockSynthetic).toBe("0.1.2");
  expect(j.lockErrors).toHaveLength(2);
  expect(j.lockErrors[0]).toContain("has 0 crates.io versions of a");
  expect(j.lockErrors[1]).toContain("has 2 crates.io versions of a (1.0.0, 2.0.0)");
});

test("the suites: rmetadump gets the case's empty sysroot and -L dirs; mir runs the port with the case's argv", () => {
  const cmd: string[] = j.rmetaStd;
  const dumpArgs = cmd.flatMap((x, i) => (cmd[i - 1] === "--dump-arg" ? [x] : []));
  expect(dumpArgs).toEqual(["--", "--target", "x86_64-unknown-linux-gnu", "--sysroot", j.EMPTY, ...j.closure.slice(0, -1).flatMap((c: string) => ["-L", `dependency=/aux/${c}`])]);
  const sep = cmd.findIndex((x, i) => x === "--" && cmd[i - 1] !== "--dump-arg");
  expect(cmd.slice(sep + 1)).toEqual(["rustc", expect.stringMatching(/^\+/), ...j.std]);
  expect(j.checkStd).toContain("--bytes");
  expect(j.checkStd).not.toContain("--dump");
  expect(j.mirAlloc.at(-2)).toMatch(/src\/rust_ts\/main\.ts$/);
  expect(j.mirAlloc.at(-1)).toBe("-Zunpretty=mir");
  expect(j.heavy).toEqual([
    ["check-alloc", "single", true, ["library/alloc/src"]],
    ["rmeta-alloc", "split", true, ["library/alloc/src"]],
    ["mir-alloc", "split", true, ["library/alloc/src"]],
    ["check-std", "single", true, expect.arrayContaining(["library/std/src", "library/backtrace/src"])],
    ["rmeta-std", "split", true, expect.arrayContaining(["library/std/src", "library/backtrace/src"])],
    ["mir-std", "split", true, expect.arrayContaining(["library/std/src", "library/backtrace/src"])],
    ["check-chain", "single", true, ["library/alloc/src"]],
  ]);
});
