// Oracle tests for lane check-check: compiler/rustc_hir_analysis/src/check/check.rs `check_abi` (and its callers in
// `check_item_type` / HIR ty lowering).
//
// Cases: check_oracle/cases/<name>.rs, small no_core libraries whose type checking emits exactly the ABI diagnostics under
// test (or nothing). The oracle is the pinned rustc on the same file and arguments (stderr + exit code).
//
// check_oracle/run.ts (see its header) runs the ported driver and, in `after_expansion`, one of two walks over the crate's
// items, then stops:
// - mode `abi`: the `check_abi` calls of `check_item_type`, made by their upstream callers (`type_of` of type aliases and
//   fields, `check_abi` of extern blocks);
// - mode `wf`: `check_item_type` of every item, as `check_type_wf` (wfcheck.rs, lanes check-wf-a/-b) does.
// stderr and the exit code must equal the oracle's byte for byte. A PENDING case must stop (exit 70) at exactly the listed
// `rust-ts: unported: ..` line, and what it printed before must be a prefix of the oracle's stderr; the entry has to go
// once the stop is ported (then the case must equal the oracle).
//
// Without the pinned toolchain this is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { beforeAll, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const HERE = import.meta.dir;
const CASES_DIR = join(HERE, "check_oracle", "cases");
const RUNNER = join(HERE, "check_oracle", "run.ts");
const ARGS = ["--edition", "2021", "--crate-type", "lib", "-Ainternal_features"];

const CASES = readdirSync(CASES_DIR)
  .filter((f) => f.endsWith(".rs"))
  .map((f) => f.slice(0, -3))
  .sort();

/** Mode `abi`: cases that stop at another lane's stub. */
const PENDING_ABI: Record<string, string> = {
  // `emit_node_span_lint(UNSUPPORTED_CALLING_CONVENTIONS, ..)` needs the HIR lint levels (lane lint-levels-hir)
  abi_cdecl: "rustc_lint::levels::shallow_lint_levels_on (tcx.hir_attr_map / hir_owner_node: HIR, M3)",
  // after `check_abi`, `validate_cmse_abi` (hir_ty_lowering/cmse.rs) erases the signature's regions (rustc_middle)
  abi_cmse_fn_ptr: "rustc_middle::ty::erase_regions::TyCtxt::erase_and_anonymize_regions",
};
/** Mode `wf`: `check_item_type` asks for `clauses_of` (of the lang-item traits first), whose provider needs
 * `inferred_outlives_of` (outlives/, lane variance-outlives-implwf). */
const PENDING_WF: Record<string, string> = Object.fromEntries(CASES.map((c) => [c, "inferred_outlives_of provider (not ported)"]));

const ENV: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE"].includes(k)) ENV[k] = v;
}

interface Out {
  stderr: string;
  code: number;
}
async function run(cmd: string[]): Promise<Out> {
  const p = Bun.spawn(cmd, { cwd: CASES_DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  const [, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stderr, code };
}

let have_oracle = false;
const oracle_out = new Map<string, Out>();

beforeAll(async () => {
  const oracle = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
  const probe = Bun.spawnSync(oracle.oracleRustcCmd(["-vV"]), { env: ENV });
  if (probe.exitCode !== 0) {
    if (REQUIRE) throw new Error("ERROR: the pinned rustc is not runnable and RUST_TS_REQUIRE_PROBES=1");
    console.log("SKIP: pinned rustc not runnable; RUST_TS_REQUIRE_PROBES=1 makes this a failure");
    return;
  }
  await oracle.verifyOraclePin();
  have_oracle = true;
  await Promise.all(
    CASES.map(async (c) => {
      oracle_out.set(c, await run(oracle.oracleRustcCmd([...ARGS, `${c}.rs`])));
    }),
  );
}, 120_000);

test("the cases exist", () => {
  expect(CASES.length).toBeGreaterThanOrEqual(6);
});

async function check_case(mode: "abi" | "wf", c: string, pending: string | undefined): Promise<void> {
  if (!have_oracle) return;
  const want = oracle_out.get(c)!;
  const got = await run([process.execPath, RUNNER, mode, ...ARGS, `${c}.rs`]);
  if (pending !== undefined) {
    const lines = got.stderr.split("\n");
    const at = lines.findIndex((l) => l.startsWith("rust-ts: "));
    expect({ exit: got.code, unported: lines.filter((l) => l.startsWith("rust-ts: ")) }).toEqual({ exit: 70, unported: [`rust-ts: unported: ${pending}`] });
    const before = lines.slice(0, at).join("\n");
    expect(want.stderr.startsWith(before)).toBe(true);
    return;
  }
  expect(got.stderr).toBe(want.stderr);
  expect(got.code).toBe(want.code);
}

for (const c of CASES) {
  test(`abi: ${c}`, () => check_case("abi", c, PENDING_ABI[c]), 120_000);
  test(`wf: ${c}`, () => check_case("wf", c, PENDING_WF[c]), 120_000);
}

test("the oracle exercises each kind of `check_abi` outcome", () => {
  if (!have_oracle) return;
  // `AbiMapping::Direct`: nothing
  expect(oracle_out.get("abi_direct")).toEqual({ stderr: "", code: 0 });
  // `AbiMapping::Deprecated`: the lint, with `add_abi_diag_help`'s help
  expect(oracle_out.get("abi_cdecl")!.stderr).toContain('warning: "cdecl" is not a supported ABI for the current target');
  expect(oracle_out.get("abi_cdecl")!.stderr).toContain('= help: use `extern "C-unwind"` instead');
  // `AbiMapping::Invalid`: ast_lowering's E0570 only
  expect(oracle_out.get("abi_unsupported")!.stderr).toContain("error[E0570]");
});
