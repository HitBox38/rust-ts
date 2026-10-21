// Tests of lane collect-rbv: rustc_hir_analysis collect/resolve_bound_vars.rs + rustc_middle middle/resolve_bound_vars.rs.
//
// rbv_oracle/run.ts runs the ported driver (real parsing, expansion, resolution, AST lowering) on a `#![no_core]` crate
// and prints `tcx.resolve_bound_vars(owner)` for every HIR owner (format in its header), then `abort_if_errors`.
// - `<case>.rbv.stdout` is that dump. The oracle prints no `ResolveBoundVars`, so its values were checked by reading
//   resolve_bound_vars.rs, and the parts the oracle does show are cross-checked against the rustc-dev probe
//   tools/probes/tydump on the same crate (test "oracle cross-check"): every fn's `late_bound_vars` of the fn itself
//   (local id 0) is the `bound_vars` of its `fn_sig` binder, the DefIds `remap_opaque_captures` creates for an opaque's
//   captured lifetimes (and their order) are the opaque's `generics_of` own params, and a fn with late-bound lifetimes
//   (`is_late_bound_map`) has `has_late_bound_regions: Some(..)`.
// - `err_*.rs` are crates whose only errors come from resolve_bound_vars.rs. `<case>.stderr` is the pinned rustc's
//   stderr (`REGEN=1` rewrites it; re-checked against the oracle whenever the toolchain is present) and the subject's
//   stderr must equal it. Two of them stop UNPORTED (a provider / diagnostic of another lane), checked as such.
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";
import { ResolvedArgExt } from "./resolve_bound_vars.ts";
import { key_ResolvedArg, ResolvedArg_eq, Set1, type ResolvedArg } from "../../rustc_middle/middle/resolve_bound_vars.ts";
import type { GenericParam } from "../../rustc_hir/lib.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import type { DebruijnIndex } from "../../rustc_type_ir/lib.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";

const DIR = join(import.meta.dir, "rbv_oracle");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function rustc_at_pin(): boolean {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 && r.stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}

function tydump_probe(): string | undefined {
  try {
    const { probeBinary } = require("../../../scripts/probes.ts") as typeof import("../../../scripts/probes.ts");
    const p = probeBinary("tydump");
    return existsSync(p) ? p : undefined;
  } catch {
    return undefined;
  }
}

/** Needs the oracle sysroot (all tests run the driver against it); fails under RUST_TS_REQUIRE_PROBES=1. */
function need_sysroot(): string | undefined {
  const s = sysroot();
  if (s === undefined && REQUIRE) throw new Error("ERROR: oracle sysroot missing");
  return s;
}

interface Run {
  exit: number;
  stdout: string;
  stderr: string;
}
function run(cmd: string[]): Run {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}
const args = (s: string, file: string, edition: string): string[] => ["--sysroot", s, `--edition=${edition}`, file];
const subject = (s: string, file: string, edition: string): Run => run(["bun", join(DIR, "run.ts"), ...args(s, file, edition)]);
/** The pinned rustc on the case, through `--emit=metadata` (into a scratch dir). */
function oracle_rustc(s: string, file: string, edition: string): Run {
  const out = mkdtempSync(join(tmpdir(), "rbv-oracle-"));
  try {
    return run(["rustc", `+${PIN.toolchain}`, ...args(s, file, edition), "--emit=metadata", "--out-dir", out]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

const OK_CASES = [
  { c: "late_bound", edition: "2021" },
  { c: "capture_2024", edition: "2024" },
] as const;
const ERR_CASES = [
  // `ClosureImplicitHrtb` (visit_expr) on a `for<'a> |..| -> _` closure
  { c: "err_closure", edition: "2021" },
  // `deny_non_region_late_bound` on `for<T> fn(T)` with `feature(non_lifetime_binders)`
  { c: "err_nlb", edition: "2021" },
  // resolve_lifetime_ref's `anonymous_lifetime_in_impl_trait` feature error (E0658; `tcx.asyncness(..)` is ported since
  // merge-w16a, lane ty-utils)
  { c: "err_anon", edition: "2021" },
  // visit_precise_capturing_arg: `BadPreciseCapture` (diagnostics/precise_captures.rs, generated since small-gaps-21)
  { c: "err_precise", edition: "2021" },
] as const;
const UNPORTED_CASES: readonly { c: string; edition: string; what: string }[] = [];

if (REGEN) {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) throw new Error("ERROR: REGEN needs the pinned toolchain");
  for (const { c, edition } of [...ERR_CASES, ...UNPORTED_CASES]) writeFileSync(join(DIR, `${c}.stderr`), oracle_rustc(s, `${c}.rs`, edition).stderr);
}

// ---- unit tests ---------------------------------------------------------------------------------

test("Set1::insert (middle/resolve_bound_vars.rs:32)", () => {
  const eq = (a: number, b: number) => a === b;
  const s = { value: Set1.Empty as Set1<number> };
  Set1.insert(s, 3, eq);
  expect(s.value).toEqual({ $: "One", _0: 3 });
  Set1.insert(s, 3, eq);
  expect(s.value).toEqual({ $: "One", _0: 3 });
  Set1.insert(s, 4, eq);
  expect(s.value).toBe(Set1.Many);
  Set1.insert(s, 3, eq);
  expect(s.value).toBe(Set1.Many);
});

test("ResolvedArgExt (resolve_bound_vars.rs:35) and ResolvedArg's Eq/Hash", () => {
  const def_id = 7 as LocalDefId;
  const param = { def_id } as unknown as GenericParam;
  expect(ResolvedArgExt.early(param)).toEqual({ $: "EarlyBound", _0: def_id });
  const late = ResolvedArgExt.late(2, param);
  expect(late).toEqual({ $: "LateBound", _0: 0 as DebruijnIndex, _1: 2, _2: def_id });
  expect(ResolvedArgExt.shifted(late, 3)).toEqual({ $: "LateBound", _0: 3 as DebruijnIndex, _1: 2, _2: def_id });
  const early = ResolvedArgExt.early(param);
  expect(ResolvedArgExt.shifted(early, 3)).toBe(early);
  expect(ResolvedArgExt.id(late)).toBe(def_id);
  expect(ResolvedArgExt.id({ $: "Free", _0: 1 as LocalDefId, _1: def_id })).toBe(def_id);
  expect(ResolvedArgExt.id({ $: "StaticLifetime" })).toBeUndefined();
  const e1: ResolvedArg = { $: "Error", _0: {} as ErrorGuaranteed };
  const e2: ResolvedArg = { $: "Error", _0: {} as ErrorGuaranteed };
  // `ErrorGuaranteed` is zero-sized: two errors are equal and hash alike
  expect(ResolvedArg_eq(e1, e2)).toBe(true);
  expect(key_ResolvedArg(late)).not.toBe(key_ResolvedArg(ResolvedArgExt.shifted(late, 1)));
});

// ---- the driver ---------------------------------------------------------------------------------

for (const { c, edition } of OK_CASES) {
  test(`rbv_oracle/${c}.rs (edition ${edition}): resolve_bound_vars of every owner`, () => {
    const s = need_sysroot();
    if (s === undefined) return;
    const r = subject(s, `${c}.rs`, edition);
    expect({ c, exit: r.exit, stderr: r.stderr, stdout: r.stdout }).toEqual({
      c,
      exit: 0,
      stderr: "",
      stdout: readFileSync(join(DIR, `${c}.rbv.stdout`), "utf8"),
    });
  }, 120_000);

  test(`rbv_oracle/${c}.rs (edition ${edition}): oracle cross-check against tools/probes/tydump`, () => {
    const s = need_sysroot();
    const probe = tydump_probe();
    if (s === undefined || probe === undefined) {
      if (REQUIRE) throw new Error("ERROR: tydump probe missing");
      return;
    }
    const o = run([probe, ...args(s, `${c}.rs`, edition)]);
    expect({ c, exit: o.exit }).toEqual({ c, exit: 0 });
    const oracle = parse_tydump(o.stdout);
    const ours = parse_rbv(readFileSync(join(DIR, `${c}.rbv.stdout`), "utf8"));
    let fns = 0;
    let opaques = 0;
    for (const [def, item] of oracle) {
      if (item.kind === "Fn" || item.kind === "AssocFn") {
        const mine = ours.get(def);
        expect([def, mine !== undefined]).toEqual([def, true]);
        expect([def, mine!.late_bound_vars0]).toEqual([def, item.fn_sig_bound_vars]);
        if (mine!.is_late_bound_map.length > 0) expect([def, item.has_late_bound_regions]).toEqual([def, true]);
        fns++;
      }
      if (item.kind === "OpaqueTy") {
        const owner = [...ours.values()].find((x) => x.opaques.has(def));
        expect([def, owner !== undefined]).toEqual([def, true]);
        expect([def, owner!.opaques.get(def)]).toEqual([def, item.own_param_def_ids]);
        opaques++;
      }
    }
    expect(fns).toBeGreaterThan(5);
    expect(opaques).toBeGreaterThan(0);
  }, 120_000);
}

for (const { c, edition } of ERR_CASES) {
  test(`rbv_oracle/${c}.rs: the diagnostics equal the pinned rustc's`, () => {
    const s = need_sysroot();
    if (s === undefined) return;
    const want = readFileSync(join(DIR, `${c}.stderr`), "utf8");
    if (rustc_at_pin()) expect({ c, oracle: oracle_rustc(s, `${c}.rs`, edition).stderr }).toEqual({ c, oracle: want });
    else if (REQUIRE) throw new Error("ERROR: pinned toolchain missing");
    const r = subject(s, `${c}.rs`, edition);
    expect({ c, exit: r.exit, stderr: r.stderr }).toEqual({ c, exit: 1, stderr: want });
  }, 120_000);
}

for (const { c, edition, what } of UNPORTED_CASES) {
  test(`rbv_oracle/${c}.rs: stops UNPORTED at ${what}`, () => {
    const s = need_sysroot();
    if (s === undefined) return;
    if (rustc_at_pin()) {
      const want = readFileSync(join(DIR, `${c}.stderr`), "utf8");
      expect({ c, oracle: oracle_rustc(s, `${c}.rs`, edition).stderr }).toEqual({ c, oracle: want });
    } else if (REQUIRE) throw new Error("ERROR: pinned toolchain missing");
    const r = subject(s, `${c}.rs`, edition);
    expect({ c, exit: r.exit, stderr: r.stderr }).toEqual({ c, exit: 70, stderr: `rust-ts: unported: ${what}\n` });
  }, 120_000);
}

// ---- parsers ------------------------------------------------------------------------------------

interface OracleItem {
  kind: string;
  fn_sig_bound_vars?: string;
  has_late_bound_regions?: boolean;
  own_param_def_ids?: string[];
}
/** tydump's `== items` section: `<DefId:?> <DefKind:?>` headers and their indented facts (probe header). */
function parse_tydump(text: string): Map<string, OracleItem> {
  const out = new Map<string, OracleItem>();
  let cur: OracleItem | undefined;
  for (const line of text.split("\n")) {
    const h = /^(DefId\([^)]*\)) (.*)$/.exec(line);
    if (h) {
      cur = { kind: h[2]!.split(/[ (]/)[0]! };
      out.set(h[1]!, cur);
      continue;
    }
    if (cur === undefined) continue;
    if (line.startsWith("  fn_sig ")) {
      // the outermost binder's `bound_vars` is the last one on the line: `.., bound_vars: [..] }, .. }`
      const at = line.lastIndexOf("bound_vars: ");
      cur.fn_sig_bound_vars = at >= 0 && line.endsWith(" }, .. }") ? line.slice(at + "bound_vars: ".length, line.length - " }, .. }".length) : undefined;
    } else if (line.startsWith("  generics_of ")) {
      cur.has_late_bound_regions = !line.endsWith("has_late_bound_regions: None }");
      const own = /own_params: \[(.*?)\], param_def_id_to_index/.exec(line)?.[1] ?? "";
      cur.own_param_def_ids = [...own.matchAll(/def_id: (DefId\([^)]*\))/g)].map((m) => m[1]!);
    }
  }
  return out;
}

interface OurOwner {
  is_late_bound_map: string[];
  late_bound_vars0?: string;
  opaques: Map<string, string[]>;
}
/** rbv_oracle/run.ts's dump (its header). */
function parse_rbv(text: string): Map<string, OurOwner> {
  const out = new Map<string, OurOwner>();
  let cur: OurOwner | undefined;
  for (const line of text.split("\n")) {
    if (/^DefId\(/.test(line)) {
      cur = { is_late_bound_map: [], opaques: new Map() };
      out.set(line, cur);
      continue;
    }
    if (cur === undefined) continue;
    let m: RegExpExecArray | null;
    if ((m = /^ {2}is_late_bound_map \[(.*)\]$/.exec(line))) cur.is_late_bound_map = m[1] === "" ? [] : m[1]!.split(", ");
    else if ((m = /^ {2}late_bound_vars 0 (\[.*\])$/.exec(line))) cur.late_bound_vars0 = m[1];
    else if ((m = /^ {2}opaque (DefId\([^)]*\)) (\[.*\])$/.exec(line))) {
      // the second element of each `(ResolvedArg, LocalDefId)` pair
      cur.opaques.set(m[1]!, [...m[2]!.matchAll(/, (DefId\([^)]*\))\)(?=, \(|\]$)/g)].map((x) => x[1]!));
    }
  }
  return out;
}
