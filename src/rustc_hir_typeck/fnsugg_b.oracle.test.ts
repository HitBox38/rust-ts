// Oracle tests of lane typeck-fnsugg-b: the manual diagnostic impls of compiler/rustc_hir_typeck/src/diagnostics.rs and
// the reachable parts of fn_ctxt/suggestions.rs:2026..3956, through type checking.
//
// Oracle: the tydump probe (tools/probes/tydump, rustc-dev: run_required_analyses up to typeck, then the dump). Subject:
// src/rust_ts/tydump.ts (as the tydump-* suites). stdout, stderr and the exit code must be identical.
// - `break_value`: `impl Diagnostic for BreakNonLoop` (E0571; the loop-label alternative suggestion; `break 'a 3`).
// - `cast_ptr`: `impl Subdiagnostic for CastUnknownPointerSub` (E0641, the `To` arm).
// - `naked`: `impl Diagnostic for NakedFunctionsAsmBlock` (E0787: multiple `naked_asm!`, a statement before it).
// - `fallback`: `impl Subdiagnostic for SuggestAnnotations` (never-type fallback lint: the `Turbo` and `Local` arms).
// The FnCtxt suggestion methods of suggestions.rs:2026.. are reached from demand.rs / op.rs / _match.rs error paths that
// stop earlier today (`TypeErrCtxt::note_type_err`, `adjust_expr_for_assert_eq_macro`, `suggest_fn_call`, ...); PENDING
// cases pin the exact stop past the code of this lane.
//
// Without the probe this is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { beforeAll, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, REPO } from "../../scripts/lib/common.ts";
import { test_scratch_dir } from "../rust_ts/test_scratch.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const PROBE = join(DATA, "target", "probes", "release", "tydump");
const SKIP = !existsSync(PROBE) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: tydump probe not built (bun scripts/probes.ts build tydump); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const WORK = test_scratch_dir("typeck-fnsugg-b-oracle");
const SUBJECT = join(REPO, "src/rust_ts/tydump.ts");

const ENV: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE"].includes(k)) ENV[k] = v;
}

interface Out {
  stdout: string;
  stderr: string;
  code: number;
}
async function run(cmd: string[], cwd: string): Promise<Out> {
  const p = Bun.spawn(cmd, { cwd, env: ENV, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, code };
}

/** A `#![no_core]` library with the `sized` lang items (typeck needs them), plus `features`. */
function lib(features: string[], body: string): string {
  return (
    `#![feature(${["lang_items", "no_core", ...features].join(", ")})]\n#![no_core]\n#![crate_type = "lib"]\n` +
    '#[lang = "pointee_sized"] pub trait PointeeSized {}\n#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}\n#[lang = "sized"] pub trait Sized: MetaSized {}\n' +
    body
  );
}

interface Case {
  name: string;
  src: string;
  edition: string;
}
const CASES: Case[] = [
  {
    name: "break_value",
    edition: "2021",
    src: lib(
      [],
      "pub fn f(c: bool) {\n    while c {\n        break 1;\n    }\n}\npub fn g(c: bool) {\n    'a: while c {\n        break 2;\n    }\n}\n" +
        "pub fn h(c: bool) {\n    'a: while c {\n        break 'a 3;\n    }\n}\n",
    ),
  },
  { name: "cast_ptr", edition: "2021", src: lib([], "pub fn f() {\n    let _ = 0 as *const _;\n}\n") },
  {
    name: "naked",
    edition: "2021",
    src: lib(
      ["rustc_attrs", "decl_macro"],
      "#[rustc_builtin_macro]\npub macro naked_asm($($t:tt)*) { /* compiler built-in */ }\n" +
        '#[unsafe(naked)]\npub extern "C" fn f() {\n    naked_asm!("");\n    naked_asm!("");\n}\n' +
        '#[unsafe(naked)]\npub extern "C" fn g() {\n    let _x = 1;\n    naked_asm!("")\n}\n',
    ),
  },
  {
    name: "fallback",
    edition: "2021",
    src: lib(
      [],
      "unsafe fn mem_zeroed<T>() -> T { loop {} }\npub fn f(c: bool) {\n    if c { unsafe { mem_zeroed() } } else { return };\n}\n" +
        "pub fn g(c: bool) {\n    let _x = if c { unsafe { mem_zeroed() } } else { return };\n}\n",
    ),
  },
  // ---- PENDING (see below) ----
  // `maybe_emit_plus_equals_diagnostic` (op.rs's `check_overloaded_binop` error path calls it first); the diagnostic is
  // emitted after `suggest_deref_or_call_for_binop_error` -> `suggest_fn_call` (lane typeck-fnsugg-a).
  { name: "plus_eq", edition: "2024", src: lib([], "pub fn f(x: u32, y: bool) {\n    if let _ = x && y += 1 {}\n}\n") },
];

/** Cases that stop at a piece another lane ports, with the `unported(..)` text they must reach. */
const PENDING: Record<string, string> = {
  plus_eq: "rustc_hir_typeck::fn_ctxt::suggestions::FnCtxt::suggest_fn_call",
};

beforeAll(() => {
  for (const c of CASES) writeFileSync(join(WORK, `${c.name}.rs`), c.src);
});

for (const c of CASES) {
  test.skipIf(SKIP)(`typeck-fnsugg-b oracle: ${c.name}`, async () => {
    const args = [`${c.name}.rs`, "--edition", c.edition, "-Zui-testing"];
    const [oracle, subject] = await Promise.all([run([PROBE, ...args], WORK), run(["bun", SUBJECT, ...args], WORK)]);
    const pending = PENDING[c.name];
    if (pending !== undefined) {
      expect(subject.code).toBe(70);
      expect(subject.stderr).toContain(`rust-ts: unported: ${pending}\n`);
      return;
    }
    expect(subject.stderr).toBe(oracle.stderr);
    expect(subject.stdout).toBe(oracle.stdout);
    expect(subject.code).toBe(oracle.code);
  }, 120_000);
}
