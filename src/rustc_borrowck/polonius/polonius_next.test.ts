// Lane bck-polonius (wave 23): polonius "next" (polonius/{mod, constraints, liveness, liveness_constraints, dump}.rs).
//
// The runtime path of `mir_borrowck` does not reach `compute_loan_liveness` yet (earlier stubs of other lanes), so this test
// drives the lane's pieces directly on built MIR of a no_core crate (the bck_core.test.ts harness): the borrow regions are
// renumbered to `'?N` in statement order, the region liveness is a hand-made `SparseIntervalMatrix`, and the localized
// constraint graph is traversed with the dump collector and the loan-liveness visitor. Expected values are worked out by
// hand from upstream over the MIR shown next to each body (statement indices as `-Zdump-mir=built` prints them).
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import "../../rustc_hir_analysis/lib.ts";
import { range_inclusive } from "../../rustc_index/idx.ts";
import { SparseIntervalMatrix } from "../../rustc_index/interval.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import "../../rustc_middle/lib.ts";
import { BasicBlock, type Body, debug_Location, Local, Location } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import type { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import "../../rustc_mir_build/lib.ts";
import { MoveData } from "../../rustc_mir_dataflow/move_paths/mod.ts";
import { DenseLocationMap, PointIndex } from "../../rustc_mir_dataflow/points.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { relate_Ty } from "../../rustc_type_ir/relate.ts";
import { Region } from "../../rustc_type_ir/sty/mod.ts";
import { PLAIN } from "../../std/fmt.ts";
import "../lib.ts";
import { BorrowSet } from "../borrow_set.ts";
import type { OutlivesConstraint } from "../constraints/mod.ts";
import { BorrowIndex } from "../dataflow.ts";
import type { LivenessValues } from "../region_infer/values.gen.ts";
import type { LivenessComputation } from "../type_check/liveness/trace.gen.ts";
import type { UniversalRegions } from "../universal_regions.gen.ts";
import { LocalizedConstraintGraph } from "./constraints.ts";
import { type CachedLivenessSource, LivenessSource_CachedLivenessSource, LocalizedConstraintGraphVisitor_MirDumpCollector, type MirDumpCollector, TEMPLATE } from "./dump.ts";
import { DeferredRegionLiveness, RegionLiveness } from "./liveness.ts";
import { record_live_region_variance } from "./liveness_constraints.ts";
import { type LiveRegionVariances, LiveLoans, type LoanLivenessVisitor, LocalizedConstraintGraphVisitor_LoanLivenessVisitor } from "./mod.ts";

const SRC = [
  "#![feature(no_core, lang_items)]",
  "#![no_core]",
  "#![allow(internal_features)]",
  '#[lang = "pointee_sized"] pub trait PointeeSized {}',
  '#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}',
  '#[lang = "sized"] pub trait Sized: MetaSized {}',
  '#[lang = "copy"] pub trait Copy {}',
  "impl Copy for u8 {}",
  '#[lang = "legacy_receiver"] pub trait LegacyReceiver {}',
  "impl<T: ?Sized> LegacyReceiver for &T {}",
  "impl<T: ?Sized> LegacyReceiver for &mut T {}",
  "pub struct S { pub x: u8, pub y: u8 }",
  "impl S { pub fn m(&mut self, v: u8) {} }",
  // bb0: [0] StorageLive(_2) [1] _2 = &mut (_1.0: u8) [2] FakeRead(ForLet(None), _2) [3] (*_2) = const 1_u8
  //      [4] _0 = copy (_1.1: u8) [5] StorageDead(_2) [6] return                      (points 0..=6)
  "pub fn mutb(mut s: S) -> u8 { let r = &mut s.x; *r = 1; s.y }",
  // bb0: [0] StorageLive(_2) [1] StorageLive(_3) [2] _3 = &mut _1 (two-phase) [3] StorageLive(_4)
  //      [4] _4 = copy (_1.0: u8) [5] _2 = S::m(move _3, move _4) -> [return: bb1, unwind: bb2]   (points 0..=5)
  // bb1: [0] StorageDead(_4) [1] StorageDead(_3) [2] StorageDead(_2) [3] _0 = const () [4] return (points 6..=10)
  // bb2 (cleanup): [0] resume                                                                      (point 11)
  "pub fn two_phase(mut s: S) { s.m(s.x); }",
].join("\n");

const WORK = join(DATA, "tmp", "bck-polonius-test", process.env.RUST_TS_AGENT ?? "default");

class CaptureConfig extends Error {}
function config_from_args(args: string[]): Config {
  let config: Config | undefined;
  try {
    compiler_entrypoint(["rustc", ...args], {
      config(c: Config) {
        config = c;
        throw new CaptureConfig();
      },
    });
  } catch (e) {
    if (!(e instanceof CaptureConfig)) throw e;
  }
  if (config === undefined) throw new Error("ERROR: no config");
  return config;
}

/** Replaces the region of every `Rvalue::Ref` by `'?N` (N counting from 0 in block / statement order). */
function renumber_borrow_regions(tcx: TyCtxt, body: Body): void {
  let n = 0;
  for (const bb of body.basic_blocks.deref()) {
    for (const stmt of bb.statements) {
      if (stmt.kind.$ === "Assign" && stmt.kind._0[1].$ === "Ref") {
        stmt.kind._0[1]._0 = Region.new_var(tcx, n++ as RegionVid);
      }
    }
  }
}

const vid = (n: number) => n as RegionVid;
const pt = (n: number) => PointIndex.new(n);
/** `UniversalRegions` stand-in: the given regions are universal; `ReVar`s map to themselves. */
function stub_universal_regions(universals: number[]): UniversalRegions {
  return {
    is_universal_region: (r: RegionVid) => universals.includes(r),
    to_region_vid: (r: Region) => r.as_var(),
  } as unknown as UniversalRegions;
}
/** A `LivenessValues` stand-in answering `points()` only (all `CachedLivenessSource` asks). */
function stub_liveness(num_points: number, live: [number, number, number][]): LivenessValues {
  const m = SparseIntervalMatrix.new<RegionVid, PointIndex>(num_points);
  for (const [r, a, b] of live) m.insert_range(vid(r), range_inclusive(pt(a), pt(b)));
  return { points: () => m } as unknown as LivenessValues;
}
const node_str = (map: DenseLocationMap, n: { region: RegionVid; point: PointIndex }) => `'?${n.region}@${debug_Location(map.to_location(n.point), PLAIN)}`;

const R = new Map<string, unknown>();

mkdirSync(WORK, { recursive: true });
const FILE = join(WORK, "polonius_next.rs");
writeFileSync(FILE, SRC);
run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", FILE]), (compiler) => {
  const krate: Crate = parse(compiler.sess);
  create_and_enter_global_ctxt(compiler, krate, (tcx: TyCtxt) => {
    void tcx.resolver_for_lowering();
    const bodies = new Map<string, Body>();
    const sets = new Map<string, BorrowSet>();
    tcx.par_hir_body_owners((def) => {
      const name = tcx.def_path_str(LocalDefId.to_def_id(def));
      const body = tcx.build_mir_inner_impl(def) as Body;
      renumber_borrow_regions(tcx, body);
      bodies.set(name, body);
      sets.set(name, BorrowSet.build(tcx, body, true, MoveData.gather_moves(body, tcx, () => true)));
    });

    // mutb: loan bw0 = `&mut (_1.0)` at bb0[1] in '?0.
    // '?0 is live at points 1..=3 (Forward, recorded variance); '?1 is never live (no variance: Bidirectional fallback);
    // '?2 is universal (Forward) and live everywhere (0..=6).
    // Constraints: '?0: '?1 at bb0[2] (physical edge), '?1: '?2 everywhere (logical edge), '?2: '?1 everywhere.
    {
      const body = bodies.get("mutb")!;
      const map = DenseLocationMap.new(body);
      const variances: LiveRegionVariances = ["Forward"];
      const constraints = [
        { sup: vid(0), sub: vid(1), locations: { $: "Single", _0: new Location(BasicBlock.new(0), 2) } },
        { sup: vid(1), sub: vid(2), locations: { $: "All", _0: undefined } },
        { sup: vid(1), sub: vid(2), locations: { $: "All", _0: undefined } }, // duplicate: deduplicated by `new`
        { sup: vid(0), sub: vid(1), locations: { $: "Single", _0: new Location(BasicBlock.new(0), 2) } }, // duplicate
      ] as unknown as OutlivesConstraint[];
      const graph = LocalizedConstraintGraph.new(map, constraints);
      R.set("mutb:graph", [graph.edges.size, [...graph.edges.values()].map((v) => v.join(",")), graph.logical_edges.map((v) => v?.join(",") ?? "-")]);
      const source: CachedLivenessSource = {
        live_region_variances: variances,
        universal_regions: stub_universal_regions([2]),
        liveness: stub_liveness(map.num_points(), [
          [0, 1, 3],
          [2, 0, 6],
        ]),
      };
      // '?2 is universal here: Forward whatever its variance
      R.set("mutb:directions", [0, 1, 2].map((r) => LivenessSource_CachedLivenessSource.liveness_for_region(source, vid(r)).direction));
      const collector: MirDumpCollector = { constraints: [], reachability: new Map() };
      graph.traverse(body, sets.get("mutb")!, map, source, collector, LivenessSource_CachedLivenessSource, LocalizedConstraintGraphVisitor_MirDumpCollector);
      R.set("mutb:reach", [...collector.reachability].map(([l, ns]) => `bw${l}: ${ns.map((n) => node_str(map, n)).join(" ")}`));
      R.set(
        "mutb:constraints",
        collector.constraints.map((c) => `${node_str(map, { region: c.source, point: c.from })} -> ${node_str(map, { region: c.target, point: c.to })}`),
      );
      const live_loans = LiveLoans.new(map.num_points(), sets.get("mutb")!.len());
      const visitor: LoanLivenessVisitor = { live_loans };
      graph.traverse(body, sets.get("mutb")!, map, source, visitor, LivenessSource_CachedLivenessSource, LocalizedConstraintGraphVisitor_LoanLivenessVisitor);
      R.set(
        "mutb:live_loans",
        [0, 1, 2, 3, 4, 5, 6].map((p) => live_loans.contains(pt(p), BorrowIndex.from_usize(0))),
      );
    }

    // two_phase: loan bw0 = `&mut _1` at bb0[2] in '?0; '?0 is live everywhere with no variance (Bidirectional): the
    // traversal reaches every point, forward across the call edges (bb1, bb2) and backward to bb0[0] and from the block
    // entries to bb0's terminator.
    {
      const body = bodies.get("two_phase")!;
      const map = DenseLocationMap.new(body);
      const source: CachedLivenessSource = {
        live_region_variances: [],
        universal_regions: stub_universal_regions([]),
        liveness: stub_liveness(map.num_points(), [[0, 0, 11]]),
      };
      const graph = LocalizedConstraintGraph.new(map, []);
      const collector: MirDumpCollector = { constraints: [], reachability: new Map() };
      graph.traverse(body, sets.get("two_phase")!, map, source, collector, LivenessSource_CachedLivenessSource, LocalizedConstraintGraphVisitor_MirDumpCollector);
      R.set("two_phase:reach", [...collector.reachability].map(([l, ns]) => `bw${l}: ${ns.map((n) => node_str(map, n)).join(" ")}`));
      R.set("two_phase:num_constraints", collector.constraints.length);
      // Backward only, '?0 live at bb0[1..=2]: from bb0[2] one step back to bb0[1], then back to bb0[0] (not live there:
      // reached, but no further edges).
      const back: CachedLivenessSource = { ...source, live_region_variances: ["Backward"], liveness: stub_liveness(map.num_points(), [[0, 1, 2]]) };
      const c2: MirDumpCollector = { constraints: [], reachability: new Map() };
      graph.traverse(body, sets.get("two_phase")!, map, back, c2, LivenessSource_CachedLivenessSource, LocalizedConstraintGraphVisitor_MirDumpCollector);
      R.set("two_phase:back", [...c2.reachability].map(([l, ns]) => `bw${l}: ${ns.map((n) => node_str(map, n)).join(" ")}`));
    }

    // liveness_constraints.rs: `&'?1 mut &'?2 u8` -> '?1 Forward, '?2 Bidirectional (invariant under `&mut`);
    // then `&'?2 u8` (covariant) keeps '?2 Bidirectional, `&'?3 u8` adds '?3 Forward; erased regions are skipped.
    {
      const u8_ty = bodies.get("mutb")!.local_decls[0]!.ty;
      const v: LiveRegionVariances = [];
      const ur = stub_universal_regions([]);
      const inner = Ty.new_imm_ref(tcx, Region.new_var(tcx, vid(2)), u8_ty);
      record_live_region_variance(tcx, v, ur, Ty.new_mut_ref(tcx, Region.new_var(tcx, vid(1)), inner), relate_Ty);
      R.set("variance:1", [...v].map((d) => d ?? "-"));
      record_live_region_variance(tcx, v, ur, inner, relate_Ty);
      record_live_region_variance(tcx, v, ur, Ty.new_imm_ref(tcx, Region.new_var(tcx, vid(3)), u8_ty), relate_Ty);
      record_live_region_variance(tcx, v, ur, Ty.new_imm_ref(tcx, tcx.lifetimes.re_erased, u8_ty), relate_Ty);
      R.set("variance:2", [...v].map((d) => d ?? "-"));

      // liveness.rs: deferred liveness of a local whose type holds '?5 and '?6.
      const deferred = new DeferredRegionLiveness([], []);
      const kinds = [u8_ty as GenericArg];
      const ty = Ty.new_mut_ref(tcx, Region.new_var(tcx, vid(5)), Ty.new_imm_ref(tcx, Region.new_var(tcx, vid(6)), u8_ty));
      deferred.defer_local(tcx, ur, Local.new(2), ty, kinds);
      R.set("deferred:by_region", [...deferred.by_region].map((l) => (l === undefined ? "-" : `_${l}`)));
      const calls: string[] = [];
      const comp = {
        compute(local: Local, _ur: UniversalRegions, variances: LiveRegionVariances | undefined, _l: LivenessValues, get_drop_args: () => readonly GenericArg[]) {
          calls.push(`_${local} variances=${variances === v} drop_args=${get_drop_args().length}`);
        },
      } as unknown as LivenessComputation;
      const liveness = {} as LivenessValues;
      deferred.ensure_deferred_liveness(vid(5), ur, liveness, v, comp);
      deferred.ensure_deferred_liveness(vid(6), ur, liveness, v, comp); // the local's drop args were already taken
      deferred.ensure_deferred_liveness(vid(9), ur, liveness, v, comp); // not deferred
      R.set("deferred:calls", calls);
    }
  });
});

test("TEMPLATE is polonius-mir-dump.template.html at the pin, byte for byte", () => {
  const upstream = readFileSync(join(DATA, "rust/compiler/rustc_borrowck/src/polonius/dump/polonius-mir-dump.template.html"), "utf8");
  expect(TEMPLATE).toBe(upstream);
  // the prologue and the 7 sections (MIR, POLONIUS_CONSTRAINTS, POLONIUS_REACHABILITY, CFG, NLL_CONSTRAINTS, NLL_SCCS,
  // INITIALIZATION)
  expect(TEMPLATE.split("$SECTION").length).toBe(8);
});

test("LiveLoans: a points x borrows bit matrix, packed column-major", () => {
  const ll = LiveLoans.new(5, 3);
  expect(ll.flat_matrix.domain_size_).toBe(15);
  ll.insert(pt(2), BorrowIndex.from_usize(1));
  ll.insert(pt(4), BorrowIndex.from_usize(2));
  expect(ll.contains(pt(2), BorrowIndex.from_usize(1))).toBe(true);
  expect(ll.contains(pt(1), BorrowIndex.from_usize(2))).toBe(false);
  expect(ll.contains(pt(4), BorrowIndex.from_usize(2))).toBe(true);
  expect(ll.flat_matrix.contains(2 + 5 * 1)).toBe(true);
  expect(ll.flat_matrix.contains(4 + 5 * 2)).toBe(true);
});

test("RegionLiveness: universal regions are Forward, missing variance falls back to Bidirectional", () => {
  const m = SparseIntervalMatrix.new<RegionVid, PointIndex>(10);
  m.insert_range(vid(1), range_inclusive(pt(3), pt(5)));
  const ur = stub_universal_regions([0]);
  const variances: LiveRegionVariances = ["Backward", "Backward"];
  const a = RegionLiveness.new(vid(0), variances, ur, m);
  const b = RegionLiveness.new(vid(1), variances, ur, m);
  const c = RegionLiveness.new(vid(7), variances, ur, m);
  expect([a.direction, b.direction, c.direction]).toEqual(["Forward", "Backward", "Bidirectional"]);
  expect([a.is_live_at(pt(3)), b.is_live_at(pt(2)), b.is_live_at(pt(3)), b.is_live_at(pt(5)), b.is_live_at(pt(6))]).toEqual([false, false, true, true, false]);
});

test("LocalizedConstraintGraph: indexing and traversal (mutb)", () => {
  // one physical node ('?0@bb0[2]) -> ['?1]; logical edges: '?0 empty (filled by `ensure_contains_elem`), '?1 -> ['?2]
  expect(R.get("mutb:graph")).toEqual([1, ["1"], ["", "2"]]);
  expect(R.get("mutb:directions")).toEqual(["Forward", "Bidirectional", "Forward"]);
  // DFS from '?0@bb0[1]; the stack pops the last pushed successor first
  expect(R.get("mutb:reach")).toEqual(["bw0: '?0@bb0[1] '?0@bb0[2] '?0@bb0[3] '?1@bb0[2] '?2@bb0[2] '?2@bb0[3] '?2@bb0[4] '?2@bb0[5] '?2@bb0[6]"]);
  expect(R.get("mutb:constraints")).toEqual([
    "'?0@bb0[1] -> '?0@bb0[2]",
    "'?0@bb0[2] -> '?1@bb0[2]",
    "'?0@bb0[2] -> '?0@bb0[3]",
    "'?1@bb0[2] -> '?2@bb0[2]",
    "'?2@bb0[2] -> '?2@bb0[3]",
    "'?2@bb0[3] -> '?2@bb0[4]",
    "'?2@bb0[4] -> '?2@bb0[5]",
    "'?2@bb0[5] -> '?2@bb0[6]",
  ]);
  // live loans: the points where a reached region is live ('?1@bb0[2] is not live, but '?0 is there)
  expect(R.get("mutb:live_loans")).toEqual([false, true, true, true, true, true, true]);
});

test("LocalizedConstraintGraph: forward / backward edges across blocks (two_phase)", () => {
  // From bb0[2]: forward bb0[3] is pushed, then backward bb0[1]; bb0[1] is popped first (backward to bb0[0]; forward
  // bb0[2] already visited), then bb0[0], then bb0[3] .. bb0[5]; bb0[5]'s successors bb1[0] and bb2[0] (pushed in that
  // order, so bb2[0] is popped first; its backward edge to bb0[5] is already visited), then bb1[0] .. bb1[4].
  expect(R.get("two_phase:reach")).toEqual([
    "bw0: '?0@bb0[2] '?0@bb0[1] '?0@bb0[0] '?0@bb0[3] '?0@bb0[4] '?0@bb0[5] '?0@bb2[0] '?0@bb1[0] '?0@bb1[1] '?0@bb1[2] '?0@bb1[3] '?0@bb1[4]",
  ]);
  // every point but the start is discovered exactly once
  expect(R.get("two_phase:num_constraints")).toBe(11);
  expect(R.get("two_phase:back")).toEqual(["bw0: '?0@bb0[2] '?0@bb0[1] '?0@bb0[0]"]);
});

test("record_live_region_variance: the variance of each region of a live type", () => {
  expect(R.get("variance:1")).toEqual(["-", "Forward", "Bidirectional"]);
  expect(R.get("variance:2")).toEqual(["-", "Forward", "Bidirectional", "Forward"]);
});

test("DeferredRegionLiveness: computes a deferred local's liveness once, from its first region", () => {
  expect(R.get("deferred:by_region")).toEqual(["-", "-", "-", "-", "-", "_2", "_2"]);
  expect(R.get("deferred:calls")).toEqual(["_2 variances=true drop_args=1"]);
});
