// Unit tests of the proc-macro aux crates of harness/compiletest.ts and the pm suites (lane harness-m6b, plan-m6 §4,
// D7): argv from directives, cache keying, and a real one-case build with the oracle in a temp dir. The aux crates
// are built by the oracle on first use (cached under $RUST_TS_DATA/aux/ui, like compiletest.test.ts's).
//
// As in compiletest.test.ts, the harness modules are loaded in a child process (scripts/lib/deps.test.ts points
// RUST_TS_DATA at a temp dir before it first imports scripts/lib/common.ts, and `bun test scripts harness` shares one
// module cache); the child prints what the tests check as JSON. Every test is skipped, with the reason, when the
// oracle toolchain is not installed (the aux crates cannot be built without it).
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const PIN = JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")).rust as { toolchain: string };
const oracleProbe = Bun.which("rustc") ? Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-V"]) : undefined;
const NO_ORACLE = oracleProbe?.exitCode === 0 ? undefined : `the oracle toolchain (rustc +${PIN.toolchain}) is not installed, so no aux crate can be built`;

const CHILD = `
const c = await import(${JSON.stringify(join(REPO, "harness/compiletest.ts"))});
const s = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const { DATA, UPSTREAM } = await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))});
const o = await import(${JSON.stringify(join(REPO, "scripts/lib/oracle.ts"))});
const pm = { aux: true, auxTimeoutMs: 300000, procMacro: true };
const json = (r) => ({ cases: r.cases, skipped: r.skipped, auxFiles: [...r.auxFiles], auxSteps: [...r.auxSteps] });
const step = { file: "tests/ui/proc-macro/auxiliary/test-macros.rs", args: ["a", "--target=x"], env: {} };
const suite = (n) => { const x = s.suite(n); return { name: x.name, milestone: x.milestone, mode: x.mode, heavy: x.heavy, criterion: x.criterion, timeoutMs: x.timeoutMs, oracleTimeoutMs: x.oracleTimeoutMs, unstable: x.unstable ? x.unstable() : [], subsets: Object.keys(x.subsets ?? {}) }; };
console.log(JSON.stringify({
  DATA, UPSTREAM,
  host: o.oracleHost(),
  sysroot: o.oracleSysroot(),
  dylib: c.dylibName("test_macros"),
  dylibNames: ["darwin", "linux", "win32"].map((p) => c.dylibName("x", p)),
  attr: json(c.uiFileCases(["tests/ui/proc-macro/attr-complex-fn.rs"], "human", pm)),
  attrDefault: json(c.uiFileCases(["tests/ui/proc-macro/attr-complex-fn.rs"], "human", { aux: true, auxTimeoutMs: 300000 })),
  forceHost: json(c.uiFileCases(["tests/ui/proc-macro/meta-macro-hygiene.rs"], "human", pm)),
  attrCrate: json(c.uiFileCases(["tests/ui/macros/missing-derive-1.rs"], "human", pm)),
  nested: json(c.uiFileCases(["tests/ui/proc-macro/hygiene_example.rs"], "human", pm)),
  notPm: json(c.uiFileCases(["tests/ui/traits/alias/cross-crate.rs", "tests/ui/proc-macro/two-crate-types-1.rs"], "human", pm)),
  outBase: [c.uiOutputBaseDir("tests/ui/proc-macro/smoke.rs"), c.uiOutputBaseDir("tests/ui/a/b.rs#rev")],
  keys: {
    same: [c.auxKey("x", [step]), c.auxKey("x", [{ ...step }])],
    id: c.auxKey("y", [step]),
    args: c.auxKey("x", [{ ...step, args: ["a", "--target=y"] }]),
    env: c.auxKey("x", [{ ...step, env: { K: "v" } }]),
    host: c.auxKey("x", [{ ...step, host: true }]),
    procMacroFlag: c.auxKey("x", [{ ...step, procMacro: true }]),
  },
  pmUiArgs: [s.pmUiArgs(["a", "--emit", "metadata", "b"]), s.pmUiArgs(["a", "-o", "build/x/a"])],
  suites: [suite("pm-ui"), suite("pm-expanded")],
}));
`;
const R = NO_ORACLE
  ? undefined
  : (() => {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "RUST_TS_DATA") env[k] = v;
      const child = Bun.spawnSync([process.execPath, "-e", CHILD], { cwd: REPO, env });
      if (child.exitCode !== 0) throw new Error(`ERROR: pm.test.ts child failed: ${child.stderr.toString().slice(0, 2000)}`);
      return JSON.parse(child.stdout.toString());
    })();
const t = NO_ORACLE ? (name: string, _fn: () => void) => test.skip(`${name} (skipped: ${NO_ORACLE})`, () => {}) : test;

type Steps = [string, { file: string; args: string[]; host?: boolean; procMacro?: boolean }[]][];

t("proc-macro: aux built as a host dylib with compiletest's AuxType::ProcMacro argv; the main compile gets --extern <dylib>", () => {
  expect(R.attr.skipped).toEqual([]);
  expect(R.attr.cases.length).toBe(1);
  const steps = (R.attr.auxSteps as Steps)[0]![1];
  expect(steps.length).toBe(1);
  const st = steps[0]!;
  const dir = st.args[st.args.indexOf("--out-dir") + 1]!;
  expect(dir.startsWith(join(R.DATA, "aux", "ui"))).toBe(true);
  // runtest.rs make_compile_args (force_host, Emit::None, AllowUnused::No, LinkToAux::No), then build_auxiliary's
  // `--crate-type proc-macro`, `--extern proc_macro`, `-L <aux dir>`; no `--emit=metadata` (a real dylib).
  expect(st.args).toEqual([
    "tests/ui/proc-macro/auxiliary/test-macros.rs",
    "-Zsimulate-remapped-rust-src-base=/rustc/FAKE_PREFIX",
    "-Ztranslate-remapped-path-to-local-path=no",
    "-Z",
    `ignore-directory-in-diagnostics-source-blocks=${st.args[4]!.slice("ignore-directory-in-diagnostics-source-blocks=".length)}`,
    "-Z",
    `ignore-directory-in-diagnostics-source-blocks=${join(R.UPSTREAM, "vendor")}`,
    "--sysroot",
    R.sysroot,
    `--target=${R.host}`,
    "--check-cfg",
    "cfg(test,FALSE)",
    "-Ccodegen-units=1",
    "-Zui-testing",
    "-Zdeduplicate-diagnostics=no",
    "-Zwrite-long-types-to-disk=no",
    "-Cstrip=debuginfo",
    "-C",
    "prefer-dynamic",
    "--out-dir",
    dir,
    "-Znext-solver=coherence",
    "-A",
    "internal_features",
    "-A",
    "incomplete_features",
    "-A",
    "unused_parens",
    "-A",
    "unused_braces",
    "-Crpath",
    "-Cdebuginfo=0",
    "--edition=2015",
    "--crate-type",
    "proc-macro",
    "--extern",
    "proc_macro",
    "-L",
    dir,
  ]);
  expect(st.host).toBe(true);
  expect(st.procMacro).toBe(true);
  expect(existsSync(join(dir, R.dylib))).toBe(true);
  expect(existsSync(join(dir, ".ok"))).toBe(true);
  // The main compile: COMPILETEST_TARGET, `-L <aux dir>` before the compile-flags, `--extern` after them.
  const a: string[] = R.attr.cases[0].args;
  expect(a).toContain("--target=x86_64-unknown-linux-gnu");
  expect(a[a.indexOf("-L") + 1]).toBe(dir);
  expect(a.slice(a.indexOf("--extern"), a.indexOf("--extern") + 2)).toEqual(["--extern", `test_macros=${dir}/${R.dylib}`]);
  expect(a.at(-1)).toBe("-Zparse-crate-root-only");
  // Without `procMacro`, the test is skipped as before (plan-m2 D6).
  expect(R.attrDefault.cases).toEqual([]);
  expect(R.attrDefault.skipped[0].reason).toContain("no suite runs this yet");
});

t("dylib names follow compiletest's DLL_PREFIX/DLL_EXTENSION of the machine it runs on", () => {
  expect(R.dylibNames).toEqual(["libx.dylib", "libx.so", "x.dll"]);
});

t("force-host aux crate of the test (linked by its proc macro) and nested aux crates: host-built, full builds", () => {
  expect(R.forceHost.skipped).toEqual([]);
  const steps = (R.forceHost.auxSteps as Steps)[0]![1];
  expect(steps.map((s) => s.file)).toEqual(["tests/ui/proc-macro/auxiliary/make-macro.rs", "tests/ui/proc-macro/auxiliary/meta-macro.rs"]);
  for (const s of steps) {
    expect(s.args).toContain(`--target=${R.host}`);
    expect(s.args).not.toContain("--emit=metadata");
    expect(s.host).toBe(true);
  }
  // make-macro.rs: a plain aux-build (`force-host`, dylib by prefer-dynamic); meta-macro.rs: the proc-macro.
  expect(steps[0]!.args.slice(-4)).toEqual(["--crate-type", "dylib", "-L", steps[0]!.args.at(-1)!]);
  expect(steps[0]!.procMacro).toBe(false);
  expect(steps[1]!.procMacro).toBe(true);
});

t("aux-build of a proc-macro crate by its own crate_type: host-built, no --crate-type (no-prefer-dynamic), no --extern", () => {
  expect(R.attrCrate.skipped).toEqual([]);
  const st = (R.attrCrate.auxSteps as Steps)[0]![1][0]!;
  expect(st.file).toBe("tests/ui/macros/auxiliary/serde.rs");
  expect(st.args).toContain(`--target=${R.host}`);
  expect(st.args).not.toContain("--crate-type");
  expect(st.args).not.toContain("--emit=metadata");
  expect(st.procMacro).toBe(true);
  expect(R.attrCrate.cases[0].args).not.toContain("--extern");
});

t("a lib aux crate with a nested proc-macro: the lib stays a COMPILETEST_TARGET rmeta, its proc macro is a host dylib", () => {
  expect(R.nested.skipped).toEqual([]);
  const steps = (R.nested.auxSteps as Steps)[0]![1];
  expect(steps.map((s) => s.file)).toEqual(["tests/ui/proc-macro/auxiliary/hygiene_example_codegen.rs", "tests/ui/proc-macro/auxiliary/hygiene_example.rs"]);
  const [codegen, lib] = steps as [Steps[number][1][number], Steps[number][1][number]];
  expect(codegen.args).toContain(`--target=${R.host}`);
  expect(lib.args).toContain("--target=x86_64-unknown-linux-gnu");
  expect(lib.args.at(-1)).toBe("--emit=metadata");
  const dir = lib.args[lib.args.indexOf("--out-dir") + 1]!;
  expect(lib.args.slice(lib.args.indexOf("--extern"), lib.args.indexOf("--extern") + 2)).toEqual(["--extern", `hygiene_example_codegen=${dir}/${R.dylib.replace("test_macros", "hygiene_example_codegen")}`]);
  expect(existsSync(join(dir, "libhygiene_example.rmeta"))).toBe(true);
});

t("procMacro case sets hold only tests with a proc-macro crate in their aux tree (others: no case, no skip)", () => {
  // cross-crate.rs has a non-proc-macro aux crate; two-crate-types-1.rs is itself a proc-macro crate without aux.
  expect(R.notPm.cases).toEqual([]);
  expect(R.notPm.skipped).toEqual([]);
});

t("aux keys: the same plan gives the same key; the case id, argv, env and host/linker PATH change it", () => {
  const k = R.keys;
  expect(k.same[0]).toBe(k.same[1]);
  expect(k.same[0]).toMatch(/^[0-9a-f]{16}$/);
  for (const other of [k.id, k.args, k.env, k.host]) expect(other).not.toBe(k.same[0]);
  // `procMacro` is a label: it changes nothing a build depends on.
  expect(k.procMacroFlag).toBe(k.same[0]);
});

t("output base dirs as runtest.rs output_base_dir (the harness layout)", () => {
  expect(R.outBase).toEqual(["build/x86_64-unknown-linux-gnu/test/ui/proc-macro/smoke", "build/x86_64-unknown-linux-gnu/test/ui/a/b.rev"]);
});

t("pm suites: pm-ui appends --emit=metadata unless compiletest passes it; definitions", () => {
  expect(R.pmUiArgs).toEqual([
    ["a", "--emit", "metadata", "b"],
    ["a", "-o", "build/x/a", "--emit=metadata"],
  ]);
  const [ui, exp] = R.suites;
  expect(ui).toMatchObject({ name: "pm-ui", milestone: "M6", mode: "single", timeoutMs: 60000, oracleTimeoutMs: 300000, subsets: ["tests/ui/proc-macro"] });
  expect(ui.criterion.percent).toBe(95);
  expect(ui.heavy).toBeUndefined();
  expect(ui.unstable).toEqual([]);
  expect(exp).toMatchObject({ name: "pm-expanded", milestone: "M6", mode: "single", unstable: [] });
  expect(exp.criterion).toBeUndefined();
});

t("a real one-case build in a temp dir: the oracle builds the proc macro and its main compile loads and runs it", () => {
  const st = (R.attr.auxSteps as Steps)[0]![1][0]!;
  const cached = st.args[st.args.indexOf("--out-dir") + 1]!;
  const tmp = mkdtempSync(join(tmpdir(), "rust-ts-pm-"));
  try {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("RUSTC_") && !k.startsWith("CARGO_")) env[k] = v;
    env.RUSTC_ICE = "0";
    const build = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, ...st.args.map((a) => a.replaceAll(cached, tmp))], { cwd: R.UPSTREAM, env });
    expect(build.stderr.toString()).toBe("");
    expect(build.exitCode).toBe(0);
    expect(existsSync(join(tmp, R.dylib))).toBe(true);
    // pm-expanded's argv for the case, with the temp dir's dylib.
    const main = (R.attr.cases[0].args as string[]).slice(0, -1).map((a) => a.replaceAll(cached, tmp));
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, ...main, "-Zunpretty=expanded"], { cwd: R.UPSTREAM, env });
    expect(r.exitCode).toBe(0);
    // test-macros.rs's `print_attr` prints the tokens it gets (PRINT-ATTR), then the expanded crate follows.
    expect(r.stdout.toString()).toContain("PRINT-ATTR INPUT (DISPLAY): fn foo<T: MyTrait<MyStruct<{ true }>>>() {}");
    expect(r.stdout.toString()).toContain("fn foo<T: MyTrait<MyStruct<{ true }>>>() {}");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
