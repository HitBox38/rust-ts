// Oracle checks of the MIR lints of `mir_built` / `mir_promoted` (lane mt-built-lints: lint_and_remove_uninhabited,
// check_inline, check_call_recursion, check_packed_ref, check_const_item_mutation, check_mut_restriction,
// function_item_references, ffi_unwind_calls) against the pinned nightly rustc.
//
// Each case runs the test driver built_lints_oracle/run.ts (see its header): the ported driver through type checking,
// then per body owner `check_unsafety` (which runs `mir_built` with its pass list) and `has_ffi_unwind_calls`. The
// oracle compiles the same file (`--emit=metadata`, target x86_64-unknown-linux-gnu, the oracle sysroot). The cases
// avoid what the driver does not run (borrowck, liveness, dead code, late lints), so the complete stderr and the exit
// code of both sides must be equal, and the oracle's stderr must contain the diagnostics under test.
// Hand-written cases are in built_lints_oracle/cases/; the tests/ui cases are UI tests whose whole oracle stderr is
// covered (run with `-Zui-testing --crate-type lib` and their `//@ edition`).
// lint_tail_expr_drop_order is not reached here (it runs after promotion and needs the dataflow lanes).
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

const WORK = join(DATA, "tmp", "built-lints-oracle", process.env.RUST_TS_AGENT ?? "default");
mkdirSync(WORK, { recursive: true });
const CASES_DIR = join(import.meta.dir, "built_lints_oracle", "cases");
const RUNNER = join(REPO, "src/rustc_mir_transform/built_lints_oracle/run.ts");

const ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE"].includes(k)) ENV[k] = v;
}
interface Out {
  stderr: string;
  code: number;
}
function run(cmd: string[], cwd: string): Out {
  const r = Bun.spawnSync(cmd, { cwd, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}
let SYSROOT: string | undefined;
const sysroot = (): string => (SYSROOT ??= Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim());
const args = (edition: string, extra: string[]): string[] => [
  "--target",
  "x86_64-unknown-linux-gnu",
  "--sysroot",
  sysroot(),
  `--edition=${edition}`,
  "--emit=metadata",
  "-o",
  join(WORK, "out.rmeta"),
  ...extra,
];

function compare(cwd: string, file: string, a: string[], expected: string[]): void {
  const oracle = run([...RUSTC, ...a, file], cwd);
  const ours = run([process.execPath, RUNNER, ...a, file], cwd);
  expect(ours.stderr).not.toContain("rust-ts: ");
  if (ours.stderr !== oracle.stderr) {
    // Show the first differing line.
    const ol = oracle.stderr.split("\n");
    const pl = ours.stderr.split("\n");
    let k = 0;
    while (k < pl.length && ol[k] === pl[k]) k++;
    expect(`line ${k + 1}: ${pl[k]}`).toBe(`line ${k + 1}: ${ol[k]}`);
  }
  expect(ours.code).toBe(oracle.code);
  for (const e of expected) expect(oracle.stderr).toContain(e);
}

interface Case {
  file: string;
  /** Text the oracle's stderr must contain (the diagnostics under test were really emitted). */
  expect: string[];
}

const HAND: Case[] = [
  {
    file: "unconditional_recursion.rs",
    expect: ["function cannot return without recursing", "recursive call site", "cannot return without recursing"],
  },
  { file: "uninhabited_call.rs", expect: ["unreachable definition", "which is uninhabited"] },
  { file: "uninhabited_call_2.rs", expect: ["unreachable definition", "unreachable expression"] },
  {
    file: "function_item_references.rs",
    expect: [
      "taking a reference to a function item does not give a function pointer",
      "foo as fn()",
      "bar as fn(_, _) -> _",
      "baz::<u8> as unsafe fn(_)",
      "ext as extern \"C\" fn(_)",
    ],
  },
  {
    file: "const_item_mutation.rs",
    expect: [
      "attempting to modify a `const` item",
      "taking a mutable reference to a `const` item",
      "mutable reference created due to call to this method",
    ],
  },
  { file: "packed_ref.rs", expect: ["error[E0793]: reference to field of packed struct is unaligned", "at most 2-byte aligned"] },
  { file: "ffi_unwind_calls.rs", expect: ["call to foreign function with FFI-unwind ABI", "call to function pointer with FFI-unwind ABI"] },
  { file: "ffi_unwind_asm.rs", expect: ["call to inline assembly that may unwind"] },
  { file: "force_inline.rs", expect: ["`f` is incompatible with `#[rustc_force_inline]`", "incompatible due to: cold"] },
  {
    file: "mut_restriction.rs",
    expect: [
      "field `x` cannot be mutated outside `crate::m`",
      "field `0` cannot be mutated outside `crate::m`",
      "`U` cannot be constructed using a `union` expression outside `crate::m`",
      "`Tup` cannot be constructed using a `struct` expression outside `crate::m`",
    ],
  },
];

for (const c of HAND) {
  test.skipIf(SKIP)(`oracle: ${c.file}`, () => {
    // the fixture really has the source the expectations talk about
    expect(readFileSync(join(CASES_DIR, c.file), "utf8").length).toBeGreaterThan(0);
    compare(CASES_DIR, c.file, args("2021", []), c.expect);
  }, 120_000);
}

const UI: Case[] = [
  { file: "lint/lint-unconditional-recursion-tail-calls.rs", expect: ["function cannot return without recursing"] },
  { file: "mut-restriction/mut-restriction-ctor-value.rs", expect: ["cannot be constructed using a `struct` expression outside"] },
  { file: "mut-restriction/stricter-of-non-ancestor-160873.rs", expect: [] },
  { file: "force-inlining/deny.rs", expect: ["is incompatible with `#[rustc_force_inline]`"] },
  { file: "force-inlining/deny-closure.rs", expect: ["is incompatible with `#[rustc_force_inline]`"] },
];

for (const c of UI) {
  test.skipIf(SKIP)(`oracle: tests/ui/${c.file}`, () => {
    const path = join(UPSTREAM, "tests/ui", c.file);
    const src = readFileSync(path, "utf8");
    const edition = /\/\/@ *edition: *(\d+)/.exec(src)?.[1] ?? "2015";
    compare(join(UPSTREAM, "tests/ui"), c.file, args(edition, ["-Zui-testing", "--crate-type", "lib"]), c.expect);
  }, 120_000);
}
