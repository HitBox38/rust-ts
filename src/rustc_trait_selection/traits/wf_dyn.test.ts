// Tests of lane trait-sel-traits-b: rustc_trait_selection traits/wf.rs and traits/dyn_compatibility.rs.
//
// Oracle: wf_dyn_oracle/probe.rs is a rustc-dev program that prints, for the items of wf_dyn_oracle/cases.rs, rustc's own
// dyn-compatibility facts (`dyn_compatibility_violations`, `is_dyn_compatible`, `generics_require_sized_self`,
// `hir_ty_lowering_dyn_compatibility_violations`, `dyn_compatibility_violations_for_assoc_item`, `is_vtable_safe_method`,
// `object_region_bounds`) and WF obligations (`wf::obligations` / `unnormalized_obligations` of type aliases and of
// hand-built types with inference variables, `trait_obligations` of trait impls, `clause_obligations` of fn clauses).
// The fixture wf_dyn_oracle/cases.stdout is its output (`REGEN=1` rebuilds the probe and rewrites it);
// wf_dyn_oracle/run.ts prints the same lines from the port.
//
// 1. `dump`: every line equals the fixture, except facts that stop at one of `PENDING` (other lanes' stubs). A stopped
//    query poisons the query for the rest of the run, so `FATAL` is accepted only after a PENDING stop of the same item.
// 2. dyn_e0038.rs: lowering `dyn SuperSelf` prints exactly the oracle rustc's E0038, or stops at one of `PENDING_E0038`.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "wf_dyn_oracle");
const FIXTURE = join(DIR, "cases.stdout");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

/** The exact `unported(..)` texts the dump stops at today (rustc_middle stubs of other lanes). */
const PENDING = new Set([
  // `tcx.liberate_late_bound_regions` of a receiver with a late-bound lifetime (`&self`): rustc_middle ty/region.rs
  "UNPORTED: rustc_middle::ty::region::LateParamRegionKind::from_bound",
  // `IllegalSelfTypeVisitor::is_supertrait_of_current_trait` (a `Self::A` projection in a method signature):
  // rustc_middle ty/erase_regions.rs (lane ty-results)
  "UNPORTED: rustc_middle::ty::erase_regions::TyCtxt::erase_and_anonymize_regions",
]);

/** The exact stops of dyn_e0038.rs today: none (until wave 19 it stopped at `report_dyn_incompatibility`,
 *  error_reporting/traits/mod.rs; lane errrep-traits-a ported it, merge-w19 emptied this set). */
const PENDING_E0038 = new Set<string>([]);

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

const args = (s: string, file: string): string[] => ["--sysroot", s, "--edition=2021", "--crate-type", "lib", file];

if (REGEN) {
  const s = sysroot();
  if (s === undefined) throw new Error("ERROR: oracle sysroot missing");
  const out = join(tmpdir(), "rust-ts-wf-dyn-probe");
  mkdirSync(out, { recursive: true });
  const exe = join(out, "probe");
  const b = run(["rustc", `+${PIN.toolchain}`, "--edition", "2024", join(DIR, "probe.rs"), "-o", exe, "-C", `link-arg=-Wl,-rpath,${s}/lib`]);
  if (b.exit !== 0) throw new Error(`ERROR: probe build failed: ${b.stderr.split("\n")[0]}`);
  const r = run([exe, ...args(s, "cases.rs")]);
  if (r.exit !== 0) throw new Error(`ERROR: probe exit ${r.exit}`);
  writeFileSync(FIXTURE, r.stdout);
}

/** Facts whose stop replaces every line of the item (they wrap the per-item lists). */
const WHOLE_ITEM = new Set(["type_of", "clauses_of"]);

test("wf_dyn_oracle/cases.rs: the port prints the probe's facts, or stops as PENDING", () => {
  const s = sysroot();
  if (s === undefined) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
    return;
  }
  const oracle = readFileSync(FIXTURE, "utf8").split("\n");
  const ours_run = run(["bun", join(DIR, "run.ts"), "dump", ...args(s, "cases.rs")]);
  expect({ exit: ours_run.exit, stderr: ours_run.stderr }).toEqual({ exit: 0, stderr: "" });
  const ours = ours_run.stdout.split("\n");

  let i = 0;
  let j = 0;
  let matched = 0;
  let stops = 0;
  let item_stopped = false;
  const mismatches: string[] = [];
  while (i < ours.length && j < oracle.length) {
    const a = ours[i]!;
    const m = /^ {2}(.*) STOP (.*)$/.exec(a);
    if (m === null) {
      if (a.startsWith("== ")) item_stopped = false;
      if (a !== oracle[j]) mismatches.push(`ours:   ${a}\noracle: ${oracle[j]}`);
      else matched++;
      i++;
      j++;
      continue;
    }
    const [, name, what] = m as unknown as [string, string, string];
    stops++;
    if (PENDING.has(what)) item_stopped = true;
    else if (!(what === "FATAL" && item_stopped)) mismatches.push(`unexpected stop: ${a}`);
    // Skip the oracle lines of the stopped fact.
    if (WHOLE_ITEM.has(name)) {
      while (j < oracle.length && !oracle[j]!.startsWith("== ")) j++;
    } else {
      if (!oracle[j]!.startsWith(`  ${name} `)) mismatches.push(`stopped fact ${name} is not the oracle's next line: ${oracle[j]}`);
      j++;
      while (j < oracle.length && oracle[j]!.startsWith("    ")) j++;
    }
    i++;
  }
  expect(mismatches).toEqual([]);
  expect({ ours_left: ours.length - i, oracle_left: oracle.length - j }).toEqual({ ours_left: 0, oracle_left: 0 });
  // Most of the dump is compared, not stopped (the fixture has 351 lines).
  expect(matched).toBeGreaterThan(330);
  expect(stops).toBeLessThan(20);
}, 300_000);

test("wf_dyn_oracle/dyn_e0038.rs: lowering `dyn SuperSelf` reports the oracle's E0038, or stops as PENDING", () => {
  const s = sysroot();
  if (s === undefined) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
    return;
  }
  const a = [...args(s, "dyn_e0038.rs"), "--emit=metadata", "-o", "/dev/null"];
  const oracle = run(["rustc", `+${PIN.toolchain}`, ...a]);
  expect(oracle.stderr).toContain("error[E0038]: the trait `SuperSelf` is not dyn compatible");
  const ours = run(["bun", join(DIR, "run.ts"), "e0038", ...a]);
  const stop = ours.stdout.trim();
  if (stop !== "") {
    expect(PENDING_E0038.has(stop) ? stop : `unexpected: ${stop}`).toBe(stop);
    return;
  }
  expect({ exit: ours.exit, stderr: ours.stderr }).toEqual({ exit: oracle.exit, stderr: oracle.stderr });
}, 300_000);
