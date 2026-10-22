// Oracle tests for lane errrep-region: compiler/rustc_trait_selection/src/error_reporting/infer/region.rs (+ the
// nice_region_error files of the lane) on region errors of the lexical resolver.
//
// Cases: region_oracle/cases/<name>.rs, small no_core libraries whose type checking emits exactly one region error
// (`GenericBoundFailure`: E0309 / E0310 / E0311, `construct_generic_bound_failure` with its lifetime-bound suggestion,
// `suggest_name_region`, `msg_span_from_named_region`, `label_msg_span`, `note_region_origin`). They are compiled by
// two existing in-process drivers (not edited here):
// - `compare`: rustc_hir_analysis check/compare_impl_item_oracle/run.ts (`compare_impl_item` on every trait impl item:
//   the associated type bound check reports the region errors through `ObligationCtxt::resolve_regions_and_report_errors`);
// - `wf`: rustc_hir_analysis check/wfcheck_b_test/run.ts `wf` (`check_item_fn` on every fn: WF of the where clauses).
// The oracle is the pinned rustc on the same file (stderr + exit code).
//
// Every case first goes through `TypeErrCtxt::try_report_nice_region_error`, whose other `NiceRegionError` reports
// (`try_report_placeholder_conflict`, ...) belong to lane errrep-nice-region, and its plain report notes the origin with
// `RegionOriginNote`'s manual `Subdiagnostic` impl (diagnostics.rs:440, lane errrep-infer-b). Until those lanes were
// merged a case stopped at exactly one line of PENDING (exit 70); since merge-w19 PENDING is empty and stderr and the
// exit code must equal the oracle's byte for byte.
//
// Without the pinned toolchain this is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { REPO } from "../../../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const CASES_DIR = join(import.meta.dir, "region_oracle", "cases");
const CHECK = join(REPO, "src", "rustc_hir_analysis", "check");
const RUNNERS = {
  compare: (sysroot: string) => [join(CHECK, "compare_impl_item_oracle", "run.ts"), "--sysroot", sysroot],
  wf: (sysroot: string) => [join(CHECK, "wfcheck_b_test", "run.ts"), "wf", "--sysroot", sysroot],
} as const;
const ARGS = ["--edition", "2021", "--crate-type", "lib", "-Ainternal_features"];

/** case -> [driver, the oracle's error code] */
const CASES: Record<string, [keyof typeof RUNNERS, string]> = {
  e0309_assoc_bound: ["compare", "E0309"],
  e0310_assoc_bound: ["compare", "E0310"],
  e0311_anon_impl: ["compare", "E0311"],
  e0309_where_wf: ["wf", "E0309"],
  e0309_projection_where: ["wf", "E0309"],
  e0309_bounded_param: ["wf", "E0309"],
};

/** The other wave-19 lanes' placeholders a case may stop at (exact `unported(..)` texts): none since merge-w19
 * (`NiceRegionError::try_report_placeholder_conflict`, lane errrep-nice-region, and `<RegionOriginNote as
 * Subdiagnostic>::add_to_diag`, lane errrep-infer-b, are ported). */
const PENDING = new Set<string>([]);

const ENV: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE"].includes(k)) ENV[k] = v;
}
ENV.RUST_BACKTRACE = "0";

interface Out {
  stderr: string;
  code: number;
}
async function run(cmd: string[]): Promise<Out> {
  const p = Bun.spawn(cmd, { cwd: CASES_DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  const [, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stderr, code };
}

let sysroot: string | undefined;
const oracle_out = new Map<string, Out>();

beforeAll(async () => {
  const oracle = require("../../../../scripts/lib/oracle.ts") as typeof import("../../../../scripts/lib/oracle.ts");
  const probe = Bun.spawnSync(oracle.oracleRustcCmd(["-vV"]), { env: ENV });
  if (probe.exitCode !== 0) {
    if (REQUIRE) throw new Error("ERROR: the pinned rustc is not runnable and RUST_TS_REQUIRE_PROBES=1");
    console.log("SKIP: pinned rustc not runnable; RUST_TS_REQUIRE_PROBES=1 makes this a failure");
    return;
  }
  await oracle.verifyOraclePin();
  sysroot = oracle.oracleSysroot();
  await Promise.all(
    Object.keys(CASES).map(async (c) => {
      oracle_out.set(c, await run(oracle.oracleRustcCmd([...ARGS, `${c}.rs`])));
    }),
  );
}, 120_000);

for (const [c, [driver, code]] of Object.entries(CASES)) {
  test(`oracle: ${c} emits exactly one ${code}`, () => {
    if (sysroot === undefined) return;
    const want = oracle_out.get(c)!;
    expect(want.code).toBe(1);
    const heads = want.stderr.split("\n").filter((l) => /^(error|warning)(\[E\d+\])?: /.test(l) && !/^error: aborting/.test(l));
    expect(heads.length).toBe(1);
    expect(heads[0]!.startsWith(`error[${code}]: `)).toBe(true);
  });

  test(`${driver}: ${c} prints the oracle's stderr, or stops at another lane's placeholder`, async () => {
    if (sysroot === undefined) return;
    const got = await run([process.execPath, ...RUNNERS[driver](sysroot), ...ARGS, `${c}.rs`]);
    const stops = got.stderr.split("\n").filter((l) => l.startsWith("rust-ts: unported: ") || l.startsWith("Unported: unported: "));
    if (stops.length > 0) {
      const what = stops[0]!.replace(/^(rust-ts|Unported): unported: /, "");
      expect(PENDING).toContain(what);
      return;
    }
    expect(got).toEqual(oracle_out.get(c)!);
  }, 120_000);
}
