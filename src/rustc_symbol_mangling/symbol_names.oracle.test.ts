// Oracle checks of rustc_symbol_mangling (lane symbol-mangling): every tests/ui/symbol-names case against the pinned
// nightly rustc. The subject is src/rustc_symbol_mangling/oracle/run.ts (the ported driver up to `start_codegen`'s
// `dump_symbol_names_and_def_paths`). Both sides get compiletest's arguments (harness/compiletest.ts `uiFileCases`,
// human error format) minus the harness's `-Zparse-crate-root-only`, plus `-Zno-codegen` (the oracle would
// otherwise codegen and link for x86_64-unknown-linux-gnu; `-Zno-codegen` keeps `should_codegen()`, so the dump
// still runs), with the output directory moved under $RUST_TS_DATA/tmp. stderr and the exit code must be identical.
// Cases whose path reaches unported code are pinned to the `unported` stop they reach (`STOPS`).
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { uiFileCases } from "../../harness/compiletest.ts";
import { DATA, PIN, REPO, UPSTREAM } from "../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
function rustcAvailable(): boolean {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const HAVE = rustcAvailable();
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const WORK = join(DATA, "tmp", "symbol-names-oracle", process.env.RUST_TS_AGENT ?? "default");
const DRIVER = join(REPO, "src/rustc_symbol_mangling/oracle/run.ts");

const BASE_ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE"].includes(k)) BASE_ENV[k] = v;
}

const STOP_CCI = "cross_crate_inlinable provider";
// `eval_to_valtree` -> `eval_to_allocation_raw` -> the CTFE interpreter (`eval_in_interpreter`): a const with a body
// loads its MIR (`load_mir` -> `mir_for_ctfe` -> `mir_drops_elaborated_and_const_checked`), whose `mir_borrowck` type
// check stops relating types (`UniverseInfo::relate`, lane bck-diag-f). A trivial const (`types.rs`'s `ZERO`) now
// evaluates; the legacy manglings then stop hashing the type (`STOP_TY_HASH`), while v0 matches the oracle.
const STOP_CONST_EVAL = "rustc_borrowck::diagnostics::bound_region_errors::UniverseInfo::relate";
const STOP_TY_HASH = "StableHash for Ty";
/** The `unported` stop each case reaches instead of the oracle's output (exit 70). */
const STOPS: Record<string, string> = {
  "tests/ui/symbol-names/basic.rs#legacy": STOP_TY_HASH,
  "tests/ui/symbol-names/const-generics-demangling.rs#legacy": STOP_CCI,
  "tests/ui/symbol-names/const-generics-demangling.rs#v0": STOP_CCI,
  "tests/ui/symbol-names/const-generics-structural-demangling.rs": STOP_CONST_EVAL,
  "tests/ui/symbol-names/const-generics.rs#legacy": STOP_CONST_EVAL,
  "tests/ui/symbol-names/const-generics.rs#v0": STOP_CONST_EVAL,
  "tests/ui/symbol-names/impl1.rs#legacy": STOP_CCI,
  "tests/ui/symbol-names/impl1.rs#v0": STOP_CCI,
  "tests/ui/symbol-names/impl2.rs": STOP_CONST_EVAL,
  "tests/ui/symbol-names/issue-60925.rs#legacy": STOP_CCI,
  "tests/ui/symbol-names/issue-60925.rs#v0": STOP_CCI,
  "tests/ui/symbol-names/issue-75326.rs#legacy": STOP_CCI,
  "tests/ui/symbol-names/issue-75326.rs#v0": STOP_CCI,
  "tests/ui/symbol-names/trait-objects.rs#v0": STOP_CCI,
  "tests/ui/symbol-names/types.rs#legacy": STOP_TY_HASH,
  "tests/ui/symbol-names/types.rs#verbose-legacy": STOP_TY_HASH,
};

const DIR = "tests/ui/symbol-names";
const files = readdirSync(join(UPSTREAM, DIR))
  .filter((f) => f.endsWith(".rs"))
  .sort()
  .map((f) => `${DIR}/${f}`);
const { cases, skipped } = uiFileCases(files, "human", {});

test("symbol-names: case list", () => {
  // aux-build (same-symbol-name-for-inner-statics-9188), needs-asm-support (const-in-global-asm), only-windows (x86-stdcall).
  expect(skipped.map((s) => s.id).sort()).toEqual([
    `${DIR}/const-in-global-asm.rs`,
    `${DIR}/same-symbol-name-for-inner-statics-9188.rs`,
    `${DIR}/x86-stdcall.rs`,
  ]);
  expect(cases.length).toBe(27);
  for (const id of Object.keys(STOPS)) expect(cases.map((c) => c.id)).toContain(id);
});

for (const c of cases) {
  test.skipIf(SKIP)(`symbol-names: ${c.id}`, () => {
    const args = c.args.filter((a) => a !== "-Zparse-crate-root-only");
    for (let i = 1; i < args.length; i++) {
      if (args[i - 1] === "--out-dir") mkdirSync((args[i] = join(WORK, args[i]!)), { recursive: true });
      else if (args[i - 1] === "-o") mkdirSync(dirname((args[i] = join(WORK, args[i]!))), { recursive: true });
    }
    args.push("-Zno-codegen");
    const env = { ...BASE_ENV };
    for (const [k, v] of Object.entries(c.env)) {
      if (v === null) delete env[k];
      else env[k] = v;
    }
    const oracle = Bun.spawnSync([...RUSTC, ...args], { cwd: UPSTREAM, env, stdout: "pipe", stderr: "pipe" });
    const ours = Bun.spawnSync([process.execPath, DRIVER, ...args], { cwd: UPSTREAM, env, stdout: "pipe", stderr: "pipe" });
    const stop = STOPS[c.id];
    if (stop !== undefined) {
      expect(ours.stderr.toString()).toContain("rust-ts: unported: ");
      expect(ours.stderr.toString()).toContain(stop);
      expect(ours.exitCode).toBe(70);
    } else {
      expect(ours.stderr.toString()).toBe(oracle.stderr.toString());
      expect(ours.exitCode).toBe(oracle.exitCode);
    }
  });
}
