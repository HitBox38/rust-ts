// Lane bck-core (wave 23): borrow_set.rs, dataflow.rs, places_conflict.rs, path_utils.rs, prefixes.rs, place_ext.rs,
// def_use.rs and used_muts.rs on real built MIR.
//
// The runtime path of `mir_borrowck` stops earlier (bck-nll's `replace_regions_in_mir`), so this test drives the lane's
// entry points directly: a no_core crate is compiled up to MIR building (`build_mir_inner_impl`, as
// rustc_mir_dataflow/move_paths/move_paths.test.ts), the regions of its `Rvalue::Ref`s are replaced by fresh `ReVar`s in
// statement order (what `replace_regions_in_mir` gives the borrows), and the region-inference queries `Borrows::new` asks
// (`first_non_contained_inclusive`, `is_loan_live_at`) are answered by a stub `RegionInferenceContext` that holds a set of
// live points per borrow. The expected values are worked out by hand from upstream over the MIR shown next to each body
// (statement indices as `-Zdump-mir=built` prints them).
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../scripts/lib/common.ts";
import { FieldIdx } from "../rustc_abi/layout.ts";
import type { Crate } from "../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import "../rustc_hir_analysis/lib.ts";
import { MixedBitSet } from "../rustc_index/bit_set.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../rustc_interface/passes.ts";
import "../rustc_middle/lib.ts";
import {
  BasicBlock,
  type Body,
  type BorrowKind,
  debug_Location,
  debug_Place,
  Local,
  Location,
  type Place,
  Place_from_Local,
  type PlaceElem,
} from "../rustc_middle/mir/mod.ts";
import type { PlaceContext } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import "../rustc_mir_build/lib.ts";
import { MoveData } from "../rustc_mir_dataflow/move_paths/mod.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import type { RegionVid } from "../rustc_type_ir/region_kind.ts";
import { Region } from "../rustc_type_ir/sty/mod.ts";
import { PLAIN } from "../std/fmt.ts";
import "./lib.ts";
import { BorrowSet, debug_BorrowData, debug_TwoPhaseActivation, display_BorrowData, LocalsStateAtExit } from "./borrow_set.ts";
import { BorrowIndex, Borrows, calculate_borrows_out_of_scope_at_location, debug_BorrowIndex } from "./dataflow.ts";
import { categorize } from "./def_use.ts";
import { MirBorrowckCtxt, type AccessDepth } from "./lib.gen.ts";
import { borrow_conflicts_with_place, places_conflict } from "./places_conflict.ts";
import { borrow_of_local_data, each_borrow_involving_path, is_active } from "./path_utils.ts";
import { Iterator_Prefixes } from "./prefixes.ts";
import type { RegionInferenceContext } from "./region_infer/region_context.ts";

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
  // bb0: [0] StorageLive(_2) [1] _2 = &(_1.0: u8) [2] FakeRead(ForLet(None), _2) [3] _0 = copy (*_2)
  //      [4] StorageDead(_2) [5] return
  "pub fn shared(s: S) -> u8 { let r = &s.x; *r }",
  // bb0: [0] StorageLive(_2) [1] _2 = &mut (_1.0: u8) [2] FakeRead(ForLet(None), _2) [3] (*_2) = const 1_u8
  //      [4] _0 = copy (_1.1: u8) [5] StorageDead(_2) [6] return
  "pub fn mutb(mut s: S) -> u8 { let r = &mut s.x; *r = 1; s.y }",
  // bb0: [0] StorageLive(_2) [1] StorageLive(_3) [2] _3 = &mut _1 (two-phase) [3] StorageLive(_4)
  //      [4] _4 = copy (_1.0: u8) [5] _2 = S::m(move _3, move _4) -> [return: bb1, unwind: bb2]
  // bb1: [0] StorageDead(_4) [1] StorageDead(_3) [2] StorageDead(_2) [3] _0 = const () [4] return
  // bb2 (cleanup): [0] resume
  "pub fn two_phase(mut s: S) { s.m(s.x); }",
  // bb0: [0] StorageLive(_2) [1] _2 = &mut _1 [2] FakeRead(ForLet(None), _2) [3] (*_2) = const 2_u8
  //      [4] _1 = const 3_u8 [5] _0 = copy _1 [6] StorageDead(_2) [7] return
  "pub fn reassign(mut a: u8) -> u8 { let r = &mut a; *r = 2; a = 3; a }",
  // bb0: [0] StorageLive(_1) [1] _0 = const () [2] StorageDead(_1) [3] return
  "pub fn never_init() { let mut z: u8; }",
].join("\n");

const WORK = join(DATA, "tmp", "bck-core-test", process.env.RUST_TS_AGENT ?? "default");

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

const loc = (bb: number, i: number) => new Location(BasicBlock.new(bb), i);
const L = (l: Location) => debug_Location(l, PLAIN);
const bw = (i: number) => BorrowIndex.from_usize(i);

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

/** The borrow set as lines: each borrow, then the three maps. */
function summary(set: BorrowSet): string[] {
  const out: string[] = [];
  for (const [i, b] of set.iter_enumerated()) out.push(`${debug_BorrowIndex(i, PLAIN)} = ${debug_BorrowData(b, PLAIN)} | ${display_BorrowData(b)}`);
  for (const [l, v] of set.location_map) out.push(`location ${L(l)} -> ${v.map((i) => debug_BorrowIndex(i, PLAIN)).join(",")}`);
  for (const [l, v] of set.activation_map) out.push(`activation ${L(l)} -> ${v.map((i) => debug_BorrowIndex(i, PLAIN)).join(",")}`);
  for (const [l, v] of set.local_map) out.push(`local _${l} -> ${[...v].map((i) => debug_BorrowIndex(i, PLAIN)).join(",")}`);
  return out;
}

/** A `RegionInferenceContext` stand-in: borrow `i`'s region (`'?i`) and loan `bw{i}` are live exactly at `live[i]`. */
function stub_regioncx(live: Location[][]): RegionInferenceContext {
  const has = (i: number, l: Location) => live[i]!.some((p) => p.block === l.block && p.statement_index === l.statement_index);
  return {
    first_non_contained_inclusive(r: RegionVid, block: BasicBlock, start: number, end: number): number | undefined {
      for (let i = start; i <= end; i++) if (!has(r, new Location(block, i))) return i;
      return undefined;
    },
    is_loan_live_at(loan_idx: BorrowIndex, location: Location): boolean {
      return has(loan_idx, location);
    },
  } as unknown as RegionInferenceContext;
}

const R = new Map<string, unknown>();

mkdirSync(WORK, { recursive: true });
const FILE = join(WORK, "bck_core.rs");
writeFileSync(FILE, SRC);
run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", FILE]), (compiler) => {
  const krate: Crate = parse(compiler.sess);
  create_and_enter_global_ctxt(compiler, krate, (tcx: TyCtxt) => {
    void tcx.resolver_for_lowering();
    const bodies = new Map<string, Body>();
    const moves = new Map<string, MoveData>();
    tcx.par_hir_body_owners((def) => {
      const name = tcx.def_path_str(LocalDefId.to_def_id(def));
      const body = tcx.build_mir_inner_impl(def) as Body;
      renumber_borrow_regions(tcx, body);
      bodies.set(name, body);
      moves.set(name, MoveData.gather_moves(body, tcx, () => true));
    });
    const sets = new Map<string, BorrowSet>();
    for (const [name, body] of bodies) {
      const set = BorrowSet.build(tcx, body, true, moves.get(name)!);
      sets.set(name, set);
      R.set(`${name}:set`, summary(set));
    }
    // `locals_are_invalidated_at_exit = false` (consts / statics): `_1` of `shared` is immutable and never
    // StorageDead / moved, so `ignore_borrow` drops its shared borrow.
    {
      const lsae = LocalsStateAtExit.build(false, bodies.get("shared")!, moves.get("shared")!);
      R.set("shared:lsae", lsae.$ === "SomeAreInvalidated" ? [...lsae.has_storage_dead_or_moved.iter()].map((l) => `_${l}`) : lsae.$);
      R.set("shared:set:not_invalidated", summary(BorrowSet.build(tcx, bodies.get("shared")!, false, moves.get("shared")!)));
      // `mutb`'s `_1` is `mut`: its borrow is kept
      R.set("mutb:set:not_invalidated", summary(BorrowSet.build(tcx, bodies.get("mutb")!, false, moves.get("mutb")!)).length);
    }

    const place = (local: number, elems: PlaceElem[]): Place => Place_from_Local(Local.new(local)).project_deeper(elems, tcx);
    const mutb = bodies.get("mutb")!;
    const u8_ty = mutb.local_decls[0]!.ty;
    const field = (i: number): PlaceElem => ({ $: "Field", _0: FieldIdx.from_u32(i), _1: u8_ty });
    const deref: PlaceElem = { $: "Deref" };

    // places_conflict.rs
    {
      const out: string[] = [];
      const pc = (b: Place, a: Place, bias: "Overlap" | "NoOverlap") =>
        out.push(`${debug_Place(b, PLAIN)} vs ${debug_Place(a, PLAIN)} ${bias}: ${places_conflict(tcx, mutb, b, a, bias)}`);
      pc(place(1, [field(0)]), place(1, [field(1)]), "NoOverlap");
      pc(place(1, [field(0)]), place(1, [field(0)]), "NoOverlap");
      pc(place(1, [field(0)]), place(1, []), "Overlap");
      pc(place(1, []), place(1, [field(1)]), "Overlap");
      pc(place(1, [field(0)]), place(2, []), "Overlap");
      const bc = (b: Place, kind: BorrowKind, a: Place, access: AccessDepth) =>
        out.push(
          `${debug_Place(b, PLAIN)} ${kind.$}${kind.$ === "Fake" ? `(${kind._0})` : ""} vs ${debug_Place(a, PLAIN)} ${access.$}${access.$ === "Shallow" ? `(${access._0 ?? "None"})` : ""}: ${borrow_conflicts_with_place(tcx, mutb, b, kind, a.as_ref(), access, "Overlap")}`,
        );
      const mut_: BorrowKind = { $: "Mut", kind: "Default" };
      bc(place(2, [deref]), mut_, place(2, []), { $: "Shallow", _0: undefined });
      bc(place(2, [deref]), mut_, place(2, []), { $: "Deep" });
      bc(place(2, [deref]), mut_, place(2, []), { $: "Drop" });
      bc(place(1, [field(0)]), mut_, place(1, []), { $: "Shallow", _0: "ArrayLength" });
      bc(place(1, []), { $: "Fake", _0: "Shallow" }, place(1, [field(0)]), { $: "Deep" });
      bc(place(1, []), { $: "Shared" }, place(1, [field(0)]), { $: "Deep" });
      R.set("conflicts", out);
    }

    // prefixes.rs
    {
      const prefixes = (p: Place, kind: "All" | "Shallow") => {
        const it = MirBorrowckCtxt.prototype.prefixes.call(undefined as unknown as MirBorrowckCtxt, p.as_ref(), kind);
        const out: string[] = [];
        for (let x = Iterator_Prefixes.next(it); x !== undefined; x = Iterator_Prefixes.next(it)) out.push(debug_Place(x.to_place(tcx), PLAIN));
        return out.join(" | ");
      };
      R.set("prefixes", [
        prefixes(place(2, [deref]), "All"),
        prefixes(place(2, [deref]), "Shallow"),
        prefixes(place(1, [field(0)]), "All"),
        prefixes(place(2, [deref, field(1)]), "Shallow"),
      ]);
      R.set("borrow_of_local_data", [borrow_of_local_data(place(1, [field(0)])), borrow_of_local_data(place(2, [deref]))]);
    }

    // path_utils.rs: `is_active` of `two_phase`'s two-phase borrow (reserved at bb0[2], activated at bb0[5])
    {
      const body = bodies.get("two_phase")!;
      const set = sets.get("two_phase")!;
      const dominators = body.basic_blocks.dominators();
      const b = set.index(bw(0));
      R.set(
        "is_active",
        [loc(0, 2), loc(0, 3), loc(0, 4), loc(0, 5), loc(1, 0), loc(2, 0)].map((l) => `${L(l)}: ${is_active(dominators, b, l)}`),
      );
      // `each_borrow_involving_path` over `_1` (deep): the one borrow of `_1`; `_3` has none.
      const seen: string[] = [];
      each_borrow_involving_path(seen, tcx, body, [{ $: "Deep" }, place(1, [field(0)])], set, () => true, (s, i, d) => {
        s.push(`${debug_BorrowIndex(i, PLAIN)} ${debug_TwoPhaseActivation(d.activation_location, PLAIN)}`);
        return { $: "Continue", _0: null };
      });
      each_borrow_involving_path(seen, tcx, body, [{ $: "Deep" }, place(3, [])], set, () => true, (s, i) => {
        s.push(`unexpected ${debug_BorrowIndex(i, PLAIN)}`);
        return { $: "Continue", _0: null };
      });
      R.set("each_borrow_involving_path", seen);
    }

    // dataflow.rs
    {
      // NLL's out-of-scope precomputation: `reassign`'s `'?0` lives at bb0[1..=3].
      const body = bodies.get("reassign")!;
      const set = sets.get("reassign")!;
      const regioncx = stub_regioncx([[loc(0, 1), loc(0, 2), loc(0, 3)]]);
      const oos = calculate_borrows_out_of_scope_at_location(body, regioncx, set);
      R.set("reassign:oos", [...oos].map(([l, v]) => `${L(l)} -> ${v.map((i) => debug_BorrowIndex(i, PLAIN)).join(",")}`));
      // `Borrows::new` (polonius next is the default: `PoloniusOutOfScopePrecomputer`), then the effects of bb0
      const borrows = Borrows.new(tcx, body, regioncx, set);
      R.set("reassign:loans_oos", [...borrows.borrows_out_of_scope_at_location].map(([l, v]) => `${L(l)} -> ${v.map((i) => debug_BorrowIndex(i, PLAIN)).join(",")}`));
      const state = borrows.bottom_value(body);
      const trace: string[] = [];
      const bb0 = body.basic_blocks.deref()[0]!;
      bb0.statements.forEach((stmt, i) => {
        borrows.apply_early_statement_effect(state, stmt, loc(0, i));
        borrows.apply_primary_statement_effect(state, stmt, loc(0, i));
        trace.push(`${L(loc(0, i))} ${MixedBitSet.fmt(state, PLAIN, debug_BorrowIndex)}`);
      });
      R.set("reassign:trace", trace);

      // `mutb`: an assignment to `_1.1` does not kill the borrow of `_1.0`; one to `_1.0` or `_1` does.
      {
        const set = sets.get("mutb")!;
        const borrows = Borrows.new(tcx, mutb, stub_regioncx([[]]), set);
        const kills: string[] = [];
        for (const p of [place(1, [field(1)]), place(1, [field(0)]), place(1, [])]) {
          const st = borrows.bottom_value(mutb);
          MixedBitSet.insert(st, bw(0));
          borrows.kill_borrows_on_place(st, p);
          kills.push(`${debug_Place(p, PLAIN)}: ${MixedBitSet.fmt(st, PLAIN, debug_BorrowIndex)}`);
        }
        R.set("mutb:kills", kills);
      }

      // `two_phase`: the loan of bb0[2] is live up to the call; it goes out of scope at bb1[0], so it is in bb1's
      // entry state (the fixpoint), and bb2 (the unwind edge of the call) gets it too.
      {
        const body = bodies.get("two_phase")!;
        const set = sets.get("two_phase")!;
        const regioncx = stub_regioncx([[loc(0, 2), loc(0, 3), loc(0, 4), loc(0, 5), loc(2, 0)]]);
        const borrows = Borrows.new(tcx, body, regioncx, set);
        R.set("two_phase:loans_oos", [...borrows.borrows_out_of_scope_at_location].map(([l, v]) => `${L(l)} -> ${v.map((i) => debug_BorrowIndex(i, PLAIN)).join(",")}`));
        const results = borrows.iterate_to_fixpoint(tcx, body, undefined);
        R.set(
          "two_phase:entry",
          results.entry_states.map((s, bb) => `bb${bb} ${MixedBitSet.fmt(s, PLAIN, debug_BorrowIndex)}`),
        );
      }
    }

    // used_muts.rs: `gather_used_muts` on a stand-in `MirBorrowckCtxt` (`body`, `move_data`, `used_mut`)
    {
      const run = (name: string, temporary_used_locals: number[], never_initialized_mut_locals: number[]) => {
        const mbcx = { body: bodies.get(name)!, move_data: moves.get(name)!, used_mut: new Set<Local>() } as unknown as MirBorrowckCtxt;
        MirBorrowckCtxt.prototype.gather_used_muts.call(mbcx, new Set(temporary_used_locals.map(Local.new)), new Set(never_initialized_mut_locals.map(Local.new)));
        return `${name}: ${[...mbcx.used_mut].map((l) => `_${l}`).join(",")}`;
      };
      // `never_init`'s `_1` is never assigned: it stays "never initialized" and becomes used
      // `reassign`'s `_1` is assigned at bb0[4]: removed
      // `two_phase` with `_2` as a temporary: the call assigning `_2` at bb0[5] moves out of `_3` and `_4`
      R.set("used_muts", [run("never_init", [], [1]), run("reassign", [], [1]), run("two_phase", [2], [])]);
    }

    // def_use.rs
    {
      const ctxs: PlaceContext[] = [
        { $: "MutatingUse", _0: "Store" },
        { $: "MutatingUse", _0: "Call" },
        { $: "NonUse", _0: { $: "StorageDead" } },
        { $: "NonMutatingUse", _0: "Copy" },
        { $: "MutatingUse", _0: "Borrow" },
        { $: "NonUse", _0: { $: "AscribeUserTy", _0: "Covariant" } },
        { $: "MutatingUse", _0: "Drop" },
        { $: "NonUse", _0: { $: "VarDebugInfo" } },
        { $: "NonUse", _0: { $: "BackwardIncompatibleDropHint" } },
      ];
      R.set("categorize", ctxs.map((c) => categorize(c) ?? "None"));
      let msg = "";
      try {
        categorize({ $: "MutatingUse", _0: "SetDiscriminant" });
      } catch (e) {
        msg = String(e);
      }
      R.set("categorize:set_discriminant", msg.length > 0);
    }
  });
});

test("BorrowSet::build: borrows, two-phase activations, local map", () => {
  expect(R.get("S::m:set")).toEqual([]);
  expect(R.get("never_init:set")).toEqual([]);
  expect(R.get("shared:set")).toEqual([
    "bw0 = BorrowData { reserve_location: bb0[1], activation_location: NotTwoPhase, kind: Shared, region: '?0, borrowed_place: (_1.0: u8), assigned_place: _2 } | &'?0 (_1.0: u8)",
    "location bb0[1] -> bw0",
    "local _1 -> bw0",
  ]);
  expect(R.get("mutb:set")).toEqual([
    "bw0 = BorrowData { reserve_location: bb0[1], activation_location: NotTwoPhase, kind: Mut { kind: Default }, region: '?0, borrowed_place: (_1.0: u8), assigned_place: _2 } | &'?0 mut (_1.0: u8)",
    "location bb0[1] -> bw0",
    "local _1 -> bw0",
  ]);
  expect(R.get("two_phase:set")).toEqual([
    "bw0 = BorrowData { reserve_location: bb0[2], activation_location: ActivatedAt(bb0[5]), kind: Mut { kind: TwoPhaseBorrow }, region: '?0, borrowed_place: _1, assigned_place: _3 } | &'?0 mut _1",
    "location bb0[2] -> bw0",
    "activation bb0[5] -> bw0",
    "local _1 -> bw0",
  ]);
  expect(R.get("reassign:set")).toEqual([
    "bw0 = BorrowData { reserve_location: bb0[1], activation_location: NotTwoPhase, kind: Mut { kind: Default }, region: '?0, borrowed_place: _1, assigned_place: _2 } | &'?0 mut _1",
    "location bb0[1] -> bw0",
    "local _1 -> bw0",
  ]);
});

test("LocalsStateAtExit / PlaceExt::ignore_borrow", () => {
  expect(R.get("shared:lsae")).toEqual(["_2"]);
  expect(R.get("shared:set:not_invalidated")).toEqual([]);
  expect(R.get("mutb:set:not_invalidated")).toBe(3);
});

test("places_conflict / borrow_conflicts_with_place", () => {
  expect(R.get("conflicts")).toEqual([
    "(_1.0: u8) vs (_1.1: u8) NoOverlap: false",
    "(_1.0: u8) vs (_1.0: u8) NoOverlap: true",
    "(_1.0: u8) vs _1 Overlap: true",
    "_1 vs (_1.1: u8) Overlap: true",
    "(_1.0: u8) vs _2 Overlap: false",
    "(*_2) Mut vs _2 Shallow(None): false",
    "(*_2) Mut vs _2 Deep: true",
    "(*_2) Mut vs _2 Drop: false",
    "(_1.0: u8) Mut vs _1 Shallow(ArrayLength): false",
    "_1 Fake(Shallow) vs (_1.0: u8) Deep: false",
    "_1 Shared vs (_1.0: u8) Deep: true",
  ]);
});

test("prefixes / borrow_of_local_data", () => {
  expect(R.get("prefixes")).toEqual(["(*_2) | _2", "(*_2)", "(_1.0: u8) | _1", "((*_2).1: u8) | (*_2)"]);
  expect(R.get("borrow_of_local_data")).toEqual([true, false]);
});

test("is_active / each_borrow_involving_path", () => {
  expect(R.get("is_active")).toEqual(["bb0[2]: true", "bb0[3]: false", "bb0[4]: false", "bb0[5]: true", "bb1[0]: true", "bb2[0]: true"]);
  expect(R.get("each_borrow_involving_path")).toEqual(["bw0 ActivatedAt(bb0[5])"]);
});

test("Borrows: out-of-scope precomputation (NLL and polonius next), effects, fixpoint", () => {
  expect(R.get("reassign:oos")).toEqual(["bb0[4] -> bw0"]);
  expect(R.get("reassign:loans_oos")).toEqual(["bb0[4] -> bw0"]);
  expect(R.get("reassign:trace")).toEqual([
    "bb0[0] []",
    "bb0[1] [bw0]",
    "bb0[2] [bw0]",
    "bb0[3] [bw0]",
    "bb0[4] []",
    "bb0[5] []",
    "bb0[6] []",
  ]);
  expect(R.get("mutb:kills")).toEqual(["(_1.1: u8): [bw0]", "(_1.0: u8): []", "_1: []"]);
  expect(R.get("two_phase:loans_oos")).toEqual(["bb1[0] -> bw0"]);
  expect(R.get("two_phase:entry")).toEqual(["bb0 []", "bb1 [bw0]", "bb2 [bw0]"]);
});

test("gather_used_muts", () => {
  expect(R.get("used_muts")).toEqual(["never_init: _1", "reassign: ", "two_phase: _3,_4"]);
});

test("def_use::categorize", () => {
  expect(R.get("categorize")).toEqual(["Def", "Def", "Def", "Use", "Use", "Use", "Drop", "None", "None"]);
  expect(R.get("categorize:set_discriminant")).toBe(true);
});
