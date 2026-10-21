// Lane small-gaps-17: `check_for_entry_fn` (check/entry.rs) through the ported driver (entry_test/run.ts), against the
// pinned rustc.
//
// 1. `#[track_caller] fn main` (with std): ours prints exactly the oracle's stderr (the crate's only error).
// 2. `async fn main` on a `#![no_core]` crate (E0752): rustc reports a missing lang item after it (MIR), so ours must
//    equal the oracle's first diagnostic and stop after it.
// 3. A lib crate has no entry fn: nothing is checked.
// 4. The remaining signature errors (E0580 wrong arguments, E0131 generic `main`, E0646 `where` clause; and a clean
//    `fn main() {}`) are not reachable yet. The test checks the oracle's error and that ours stops at one of `PENDING`
//    (exact `unported(..)` texts). Re-pinned by lane codegen-fn-attrs: with `codegen_fn_attrs` ported, the std crate's
//    metadata decode of `ty::TraitDef` (rustc_metadata, not ported) is the first stop; after it come this file's
//    stand-ins (`ObligationCtxt` when a `termination` lang item exists, `check_function_signature`), and the cases turn
//    into oracle matches once those lanes are integrated. Re-pinned by merge-w18: `ty::TraitDef` decodes (small-gaps-18);
//    the next stop is the std crate's metadata decode of `ty::ImplTraitHeader` (impl_trait_header, not generated yet).
//    Re-pinned by merge-w18d: `ty::ImplTraitHeader` decodes (merge-w18c); generic_main.rs, where_main.rs and plain_main.rs
//    now print the oracle's stderr exactly (NOW_EXACT); args_main.rs's E0580 is a type-error report through
//    `InferCtxt::err_ctxt` (rustc_trait_selection error_reporting, wave 19).
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "entry_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

const PENDING = new Set([
  // args_main.rs: E0580 report (wave 19); re-pinned by errctxt-contract (`err_ctxt` and `ObligationCauseExt` ported), then
  // by errrep-infer-a (`note_type_err` ported; its next callee is suggestions.rs, lane errrep-sugg-a)
  "rustc_trait_selection::error_reporting::traits::suggestions::TypeErrCtxt::note_field_shadowed_by_private_candidate_in_cause",
]);

/** Cases that print the oracle's stderr since merge-w18d: they must not stop. */
const NOW_EXACT = new Set(["generic_main.rs", "where_main.rs", "plain_main.rs"]);

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function run(cmd: string[]): { exit: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

/** Runs the oracle and ours on `file`; `undefined` when the sysroot is missing (and probes are not required). */
function both(file: string): { oracle: ReturnType<typeof run>; ours: ReturnType<typeof run> } | undefined {
  const s = sysroot();
  if (s === undefined) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
    return undefined;
  }
  const out = mkdtempSync(join(tmpdir(), "rust-ts-entry-"));
  try {
    const args = ["--sysroot", s, "--edition=2021", "--emit=metadata", "-o", join(out, "out.rmeta"), file];
    return { oracle: run(["rustc", `+${PIN.toolchain}`, ...args]), ours: run(["bun", join(DIR, "run.ts"), ...args]) };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

test("entry_test/track_caller_main.rs: ours equals the oracle", () => {
  const r = both("track_caller_main.rs");
  if (r === undefined) return;
  expect(r.oracle.stderr).toContain("`main` function is not allowed to be `#[track_caller]`");
  expect({ exit: r.ours.exit, stderr: r.ours.stderr }).toEqual({ exit: r.oracle.exit, stderr: r.oracle.stderr });
}, 120_000);

test("entry_test/async_main.rs: ours prints the oracle's E0752 and stops", () => {
  const r = both("async_main.rs");
  if (r === undefined) return;
  const first = (s: string): string => s.slice(0, s.indexOf("\n\n") + 2);
  expect(first(r.oracle.stderr)).toContain("error[E0752]");
  expect(first(r.ours.stderr)).toBe(first(r.oracle.stderr));
  expect(r.ours.exit).toBe(1);
  expect(r.ours.stderr.slice(first(r.ours.stderr).length)).toBe(
    "error: aborting due to 1 previous error\n\nFor more information about this error, try `rustc --explain E0752`.\n",
  );
}, 120_000);

test("entry_test/lib_no_main.rs: a lib crate has no entry fn", () => {
  const r = both("lib_no_main.rs");
  if (r === undefined) return;
  expect({ exit: r.ours.exit, stderr: r.ours.stderr }).toEqual({ exit: 0, stderr: "" });
}, 120_000);

for (const [file, code] of [
  ["args_main.rs", "error[E0580]"],
  ["generic_main.rs", "error[E0131]"],
  ["where_main.rs", "error[E0646]"],
  ["plain_main.rs", undefined],
] as const) {
  test(`entry_test/${file}: the oracle reports ${code ?? "nothing"}; ours stops as PENDING`, () => {
    const r = both(file);
    if (r === undefined) return;
    if (code !== undefined) expect(r.oracle.stderr).toContain(code);
    else expect({ exit: r.oracle.exit, stderr: r.oracle.stderr }).toEqual({ exit: 0, stderr: "" });
    const m = /^UNPORTED: (.*)\n/m.exec(r.ours.stderr);
    if (NOW_EXACT.has(file)) expect(m).toBeNull();
    if (m !== null) {
      expect(r.ours.exit).toBe(70);
      expect(PENDING).toContain(m[1]!);
    } else {
      expect({ exit: r.ours.exit, stderr: r.ours.stderr }).toEqual({ exit: r.oracle.exit, stderr: r.oracle.stderr });
    }
  }, 120_000);
}
