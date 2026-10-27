// Lane bck-lib-a (wave 23): lib.rs lines < 1400 on real built MIR: `ClosureOutlivesSubjectTy::{bind, instantiate}`, the
// `ResultsVisitor` methods of `MirBorrowckCtxt`, `access_place`, `borrows_in_scope` and `check_access_for_conflict`.
//
// The runtime path of `mir_borrowck` stops before the borrowck walk (in type_check), so this test drives the lane's
// methods directly, as bck_core.test.ts does: a no_core crate is compiled up to MIR building, the regions of its
// `Rvalue::Ref`s become `ReVar`s, `BorrowSet::build` (bck-core) gathers the borrows, and a `MirBorrowckCtxt` stand-in
// carries the fields these methods read. The callees owned by other lanes (lib.rs >= 1400: bck-lib-b; the error
// builders: bck-diag-*) are replaced on the stand-in by recorders, so the test checks which of them upstream's logic
// calls, with which arguments and in which order. The expected logs are worked out by hand from upstream over the MIR
// shown next to each body (statement indices as `-Zdump-mir=built` prints them).
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../scripts/lib/common.ts";
import { FieldIdx } from "../rustc_abi/layout.ts";
import type { Crate } from "../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import type { Diag } from "../rustc_errors/diagnostic.ts";
import "../rustc_hir_analysis/lib.ts";
import { MixedBitSet } from "../rustc_index/bit_set.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../rustc_interface/passes.ts";
import "../rustc_middle/lib.ts";
import {
  BasicBlock,
  type Body,
  type BorrowKind,
  debug_BorrowKind,
  debug_Location,
  debug_Operand,
  debug_Place,
  debug_PlaceRef,
  debug_Rvalue,
  Local,
  Location,
  type Operand,
  type Place,
  Place_from_Local,
  type PlaceElem,
  type PlaceRef,
  type Rvalue,
} from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import "../rustc_mir_build/lib.ts";
import { MoveData } from "../rustc_mir_dataflow/move_paths/mod.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { RegionVid } from "../rustc_type_ir/region_kind.ts";
import { Region } from "../rustc_type_ir/sty/mod.ts";
import { debug_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { intern_key } from "../rust_ts/intern_key.ts";
import { KeyedSet } from "../rust_ts/keyed.ts";
import { PLAIN } from "../std/fmt.ts";
import { Panic } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import "./lib.ts";
import { type BorrowData, BorrowSet } from "./borrow_set.ts";
import { BorrowIndex, debug_BorrowIndex } from "./dataflow.ts";
import type { BorrowckDomain } from "./dataflow.gen.ts";
import {
  type AccessDepth,
  ClosureOutlivesSubjectTy,
  debug_AccessDepth,
  debug_ReadOrWrite,
  debug_RootPlace,
  debug_WriteKind,
  type LocalMutationIsAllowed,
  MirBorrowckCtxt,
  type ReadOrWrite,
  type RootPlace,
  type WriteKind,
} from "./lib.gen.ts";

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
].join("\n");

const WORK = join(DATA, "tmp", "bck-lib-a-test", process.env.RUST_TS_AGENT ?? "default");

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
const P = (p: Place) => debug_Place(p, PLAIN);
const bw = (i: number) => BorrowIndex.from_usize(i);
const BI = (i: BorrowIndex) => debug_BorrowIndex(i, PLAIN);
const BK = (k: BorrowKind) => debug_BorrowKind(k, PLAIN);
const RW = (rw: ReadOrWrite) => debug_ReadOrWrite(rw, PLAIN);
const AD = (sd: AccessDepth) => debug_AccessDepth(sd, PLAIN);

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

/** The recorded calls of a stand-in, and what its `check_access_permissions` / `is_mutable` answer. */
interface Recorder {
  log: string[];
  permission_error: boolean;
  is_mutable: Result<RootPlace, PlaceRef>;
}

/** A `MirBorrowckCtxt` with the fields this lane's methods read; other lanes' callees record their calls. */
function stand_in(tcx: TyCtxt, body: Body, borrow_set: BorrowSet, rec: Recorder, movable_coroutine = false): MirBorrowckCtxt {
  const cx = Object.create(MirBorrowckCtxt.prototype) as MirBorrowckCtxt;
  const span_of = (s: Span) => (s === body.span ? "body" : "span");
  const DIAG = {} as Diag;
  Object.assign(cx, {
    infcx: { tcx },
    body,
    borrow_set,
    movable_coroutine,
    polonius_output: undefined,
    access_place_error_reported: new KeyedSet<[Place, Span]>(intern_key),
    reservation_error_reported: new KeyedSet<Place>(intern_key),
    // lane bck-lib-b (lib.rs >= 1400)
    check_activations(location: Location, _span: Span, _state: BorrowckDomain) {
      rec.log.push(`check_activations ${L(location)}`);
    },
    consume_rvalue(location: Location, [rvalue, _span]: [Rvalue, Span], _state: BorrowckDomain) {
      rec.log.push(`consume_rvalue ${L(location)} ${debug_Rvalue(rvalue, PLAIN)}`);
    },
    consume_operand(location: Location, [operand, _span]: [Operand, Span], _state: BorrowckDomain) {
      rec.log.push(`consume_operand ${L(location)} ${debug_Operand(operand, PLAIN)}`);
    },
    mutate_place(location: Location, [place, _span]: [Place, Span], kind: AccessDepth, _state: BorrowckDomain) {
      rec.log.push(`mutate_place ${L(location)} ${P(place)} ${AD(kind)}`);
    },
    check_if_path_or_subpath_is_moved(location: Location, desired_action: string, [place, _span]: [PlaceRef, Span], _state: BorrowckDomain) {
      rec.log.push(`check_if_path_or_subpath_is_moved ${L(location)} ${desired_action} ${debug_PlaceRef(place, PLAIN)}`);
    },
    check_backward_incompatible_drop(location: Location, place: Place, _state: BorrowckDomain) {
      rec.log.push(`check_backward_incompatible_drop ${L(location)} ${P(place)}`);
    },
    check_for_local_borrow(borrow: BorrowData, _yield_span: Span) {
      rec.log.push(`check_for_local_borrow ${P(borrow.borrowed_place)}`);
    },
    check_for_invalidation_at_exit(location: Location, borrow: BorrowData, _span: Span) {
      rec.log.push(`check_for_invalidation_at_exit ${L(location)} ${P(borrow.borrowed_place)}`);
    },
    check_access_permissions([place, span]: [Place, Span], kind: ReadOrWrite, is_local_mutation_allowed: LocalMutationIsAllowed, _state: BorrowckDomain, location: Location) {
      rec.log.push(`check_access_permissions ${P(place)} ${span_of(span)} ${RW(kind)} ${is_local_mutation_allowed} ${L(location)}`);
      return rec.permission_error;
    },
    is_mutable(place: PlaceRef, is_local_mutation_allowed: LocalMutationIsAllowed) {
      rec.log.push(`is_mutable ${debug_PlaceRef(place, PLAIN)} ${is_local_mutation_allowed}`);
      return rec.is_mutable;
    },
    add_used_mut(root_place: RootPlace, _state: BorrowckDomain) {
      rec.log.push(`add_used_mut ${debug_RootPlace(root_place, PLAIN)}`);
    },
    // lanes bck-diag-* (diagnostics/{mod, conflict_errors}.rs)
    buffer_error(_diag: Diag) {
      rec.log.push("buffer_error");
    },
    report_use_while_mutably_borrowed(location: Location, [place, _span]: [Place, Span], borrow: BorrowData) {
      rec.log.push(`report_use_while_mutably_borrowed ${L(location)} ${P(place)} ${P(borrow.borrowed_place)}`);
      return DIAG;
    },
    report_conflicting_borrow(location: Location, [place, _span]: [Place, Span], gen_borrow_kind: BorrowKind, issued_borrow: BorrowData) {
      rec.log.push(`report_conflicting_borrow ${L(location)} ${P(place)} ${BK(gen_borrow_kind)} ${P(issued_borrow.borrowed_place)}`);
      return DIAG;
    },
    report_borrowed_value_does_not_live_long_enough(location: Location, borrow: BorrowData, [place, _span]: [Place, Span], kind: WriteKind | undefined) {
      rec.log.push(`report_borrowed_value_does_not_live_long_enough ${L(location)} ${P(borrow.borrowed_place)} ${P(place)} ${kind === undefined ? "None" : debug_WriteKind(kind, PLAIN)}`);
    },
    report_illegal_mutation_of_borrowed(location: Location, [place, _span]: [Place, Span], loan: BorrowData) {
      rec.log.push(`report_illegal_mutation_of_borrowed ${L(location)} ${P(place)} ${P(loan.borrowed_place)}`);
    },
    report_move_out_while_borrowed(location: Location, [place, _span]: [Place, Span], borrow: BorrowData) {
      rec.log.push(`report_move_out_while_borrowed ${L(location)} ${P(place)} ${P(borrow.borrowed_place)}`);
    },
  });
  return cx;
}

/** A `BorrowckDomain` whose `borrows` holds exactly `live` (the move-path sets are not read by these methods). */
function state_with(set: BorrowSet, live: number[]): BorrowckDomain {
  const borrows = MixedBitSet.new_empty<BorrowIndex>(set.len());
  for (const i of live) MixedBitSet.insert(borrows, bw(i));
  return { borrows } as unknown as BorrowckDomain;
}

const R = new Map<string, unknown>();

mkdirSync(WORK, { recursive: true });
const FILE = join(WORK, "bck_lib_a.rs");
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
    const set_of = (name: string) => BorrowSet.build(tcx, bodies.get(name)!, true, moves.get(name)!);

    const place = (local: number, elems: PlaceElem[]): Place => Place_from_Local(Local.new(local)).project_deeper(elems, tcx);
    const mutb = bodies.get("mutb")!;
    const u8_ty = mutb.local_decls[0]!.ty;
    const field = (i: number): PlaceElem => ({ $: "Field", _0: FieldIdx.from_u32(i), _1: u8_ty });
    const span = mutb.span;
    const shallow: AccessDepth = { $: "Shallow", _0: undefined };
    const deep: AccessDepth = { $: "Deep" };
    const mut_default: BorrowKind = { $: "Mut", kind: "Default" };
    const mut_two_phase: BorrowKind = { $: "Mut", kind: "TwoPhaseBorrow" };

    // ClosureOutlivesSubjectTy: `&'?3 &'?1 u8` -> bound vars 3 and 1 (anonymous, innermost) -> `'?vid` mapped to `'?(vid+10)`
    {
      const ty = Ty.new_imm_ref(tcx, Region.new_var(tcx, 3 as RegionVid), Ty.new_imm_ref(tcx, Region.new_var(tcx, 1 as RegionVid), u8_ty));
      const subject = ClosureOutlivesSubjectTy.bind(tcx, ty);
      const seen: string[] = [];
      const back = subject.instantiate(tcx, (vid) => {
        seen.push(`'?${vid}`);
        return Region.new_var(tcx, (vid + 10) as RegionVid);
      });
      R.set("closure_subject", [debug_Ty(subject.inner, PLAIN), seen.join(","), debug_Ty(back, PLAIN)]);
      // any other region is a bug: `bind` of `'static`, `instantiate` of a free region
      const bugs: string[] = [];
      for (const f of [
        () => ClosureOutlivesSubjectTy.bind(tcx, Ty.new_imm_ref(tcx, tcx.lifetimes.re_static, u8_ty)),
        () => new ClosureOutlivesSubjectTy(ty).instantiate(tcx, () => tcx.lifetimes.re_static),
      ]) {
        try {
          f();
          bugs.push("no bug");
        } catch (e) {
          bugs.push(e instanceof Panic ? "bug" : `other: ${String(e)}`);
        }
      }
      R.set("closure_subject_bugs", bugs);
    }

    // check_access_for_conflict on `mutb`: `bw0 = &mut (_1.0)` in scope at bb0[3]
    {
      const rec: Recorder = { log: [], permission_error: false, is_mutable: Ok({} as RootPlace) };
      const set = set_of("mutb");
      const cx = stand_in(tcx, mutb, set, rec);
      const live = state_with(set, [0]);
      const out: string[] = [];
      const check = (p: Place, sd: AccessDepth, rw: ReadOrWrite, state = live, at = loc(0, 3)) => {
        rec.log = [];
        const r = cx.check_access_for_conflict(at, [p, span], sd, rw, state);
        out.push(`${P(p)} ${AD(sd)} ${RW(rw)}: ${r}${rec.log.length > 0 ? ` | ${rec.log.join(" | ")}` : ""}`);
      };
      check(place(1, [field(1)]), deep, { $: "Read", _0: { $: "Copy" } });
      check(place(1, [field(0)]), deep, { $: "Read", _0: { $: "Copy" } });
      check(place(1, []), deep, { $: "Read", _0: { $: "Borrow", _0: { $: "Shared" } } });
      check(place(1, []), deep, { $: "Read", _0: { $: "Borrow", _0: { $: "Fake", _0: "Shallow" } } });
      check(place(1, []), deep, { $: "Read", _0: { $: "Borrow", _0: { $: "Fake", _0: "Deep" } } });
      check(place(1, [field(0)]), shallow, { $: "Write", _0: { $: "Mutate" } });
      check(place(1, []), deep, { $: "Write", _0: { $: "Move" } });
      check(place(1, []), shallow, { $: "Write", _0: { $: "StorageDeadOrDrop" } });
      check(place(1, []), { $: "Drop" }, { $: "Write", _0: { $: "Replace" } });
      check(place(1, [field(0)]), deep, { $: "Write", _0: { $: "MutableBorrow", _0: mut_default } });
      check(place(1, []), deep, { $: "Activation", _0: { $: "MutableBorrow", _0: mut_two_phase }, _1: bw(0) });
      check(place(1, []), deep, { $: "Activation", _0: { $: "MutableBorrow", _0: mut_two_phase }, _1: bw(7) });
      out.push(`reservations: ${[...cx.reservation_error_reported].map(P).join(",")}`);
      check(place(1, []), deep, { $: "Reservation", _0: { $: "MutableBorrow", _0: mut_two_phase } });
      out.push(`reservations: ${[...cx.reservation_error_reported].map(P).join(",")}`);
      // not in scope: nothing to check
      check(place(1, [field(0)]), deep, { $: "Write", _0: { $: "Mutate" } }, state_with(set, []));
      R.set("conflict:mutb", out);
    }

    // check_access_for_conflict on `shared`: `bw0 = &(_1.0)`; then the same borrow as a fake shallow / fake deep borrow
    {
      const rec: Recorder = { log: [], permission_error: false, is_mutable: Ok({} as RootPlace) };
      const body = bodies.get("shared")!;
      const out: string[] = [];
      for (const kind of [{ $: "Shared" }, { $: "Fake", _0: "Shallow" }, { $: "Fake", _0: "Deep" }] as BorrowKind[]) {
        const set = set_of("shared");
        set.index(bw(0)).kind = kind;
        const cx = stand_in(tcx, body, set, rec);
        const live = state_with(set, [0]);
        const check = (p: Place, sd: AccessDepth, rw: ReadOrWrite) => {
          rec.log = [];
          const r = cx.check_access_for_conflict(loc(0, 3), [p, span], sd, rw, live);
          out.push(`${BK(kind)}: ${P(p)} ${AD(sd)} ${RW(rw)}: ${r}${rec.log.length > 0 ? ` | ${rec.log.join(" | ")}` : ""}`);
        };
        check(place(1, [field(0)]), deep, { $: "Read", _0: { $: "Copy" } });
        check(place(1, []), deep, { $: "Reservation", _0: { $: "MutableBorrow", _0: mut_two_phase } });
        check(place(1, []), deep, { $: "Write", _0: { $: "Move" } });
        check(place(1, [field(0)]), shallow, { $: "Write", _0: { $: "Mutate" } });
        out.push(`${BK(kind)}: reservations: ${[...cx.reservation_error_reported].map(P).join(",")}`);
      }
      R.set("conflict:shared", out);
    }

    // check_access_for_conflict on `two_phase`: `bw0 = &mut _1` reserved at bb0[2], activated at bb0[5]
    {
      const rec: Recorder = { log: [], permission_error: false, is_mutable: Ok({} as RootPlace) };
      const body = bodies.get("two_phase")!;
      const set = set_of("two_phase");
      const cx = stand_in(tcx, body, set, rec);
      const live = state_with(set, [0]);
      const out: string[] = [];
      for (const at of [loc(0, 4), loc(0, 5)]) {
        rec.log = [];
        const r = cx.check_access_for_conflict(at, [place(1, [field(0)]), span], deep, { $: "Read", _0: { $: "Copy" } }, live);
        out.push(`${L(at)}: ${r}${rec.log.length > 0 ? ` | ${rec.log.join(" | ")}` : ""}`);
      }
      R.set("conflict:two_phase", out);
    }

    // access_place on `mutb` (bw0 in scope)
    {
      const rec: Recorder = { log: [], permission_error: false, is_mutable: Ok({} as RootPlace) };
      const set = set_of("mutb");
      const live = state_with(set, [0]);
      const out: string[] = [];
      const access = (cx: MirBorrowckCtxt, p: Place, kind: [AccessDepth, ReadOrWrite], lmia: LocalMutationIsAllowed = "No") => {
        rec.log = [];
        cx.access_place(loc(0, 3), [p, span], kind, lmia, live);
        out.push(`${P(p)} ${AD(kind[0])} ${RW(kind[1])}: ${rec.log.join(" | ")} | reported ${cx.access_place_error_reported.size}`);
      };
      // no error: permissions, then conflicts; nothing recorded
      let cx = stand_in(tcx, mutb, set, rec);
      access(cx, place(1, [field(1)]), [deep, { $: "Read", _0: { $: "Copy" } }]);
      // a conflict: recorded once, the same (place, span) is then suppressed (a read: nothing else is called)
      access(cx, place(1, [field(0)]), [deep, { $: "Read", _0: { $: "Copy" } }]);
      access(cx, place(1, [field(0)]), [deep, { $: "Read", _0: { $: "Copy" } }]);
      // suppressed mutation: `is_mutable` and (when `Ok`) `add_used_mut`
      rec.is_mutable = Ok({ place_local: Local.new(1), place_projection: [], is_local_mutation_allowed: "No" });
      access(cx, place(1, [field(0)]), [shallow, { $: "Write", _0: { $: "Mutate" } }], "ExceptUpvars");
      rec.is_mutable = Err(place(1, []).as_ref());
      access(cx, place(1, [field(0)]), [shallow, { $: "Write", _0: { $: "Mutate" } }]);
      // a suppressed move does not ask `is_mutable`
      access(cx, place(1, [field(0)]), [deep, { $: "Write", _0: { $: "Move" } }]);
      // a permission error alone is recorded too
      cx = stand_in(tcx, mutb, set, rec);
      rec.permission_error = true;
      access(cx, place(1, [field(1)]), [shallow, { $: "Write", _0: { $: "Mutate" } }], "Yes");
      rec.permission_error = false;
      // an activation of a reservation that already failed is skipped entirely
      cx = stand_in(tcx, mutb, set, rec);
      cx.reservation_error_reported.add(place(1, []));
      access(cx, place(1, []), [deep, { $: "Activation", _0: { $: "MutableBorrow", _0: mut_two_phase }, _1: bw(0) }]);
      // ... but not the activation of another place
      access(cx, place(1, [field(1)]), [deep, { $: "Activation", _0: { $: "MutableBorrow", _0: mut_two_phase }, _1: bw(0) }]);
      R.set("access_place", out);
    }

    // borrows_in_scope without polonius output: the dataflow state's set itself
    {
      const rec: Recorder = { log: [], permission_error: false, is_mutable: Ok({} as RootPlace) };
      const set = set_of("mutb");
      const cx = stand_in(tcx, mutb, set, rec);
      const live = state_with(set, [0]);
      R.set("borrows_in_scope", cx.borrows_in_scope(loc(0, 3), live) === live.borrows);
    }

    // The ResultsVisitor methods over every statement / terminator
    for (const [name, all_invalidated] of [
      ["mutb", true],
      ["two_phase", true],
      ["two_phase", false],
    ] as const) {
      const rec: Recorder = { log: [], permission_error: false, is_mutable: Ok({} as RootPlace) };
      const body = bodies.get(name)!;
      const set = BorrowSet.build(tcx, body, all_invalidated, moves.get(name)!);
      const cx = stand_in(tcx, body, set, rec);
      const live = state_with(set, set.len() > 0 ? [0] : []);
      const out: string[] = [];
      body.basic_blocks.deref().forEach((bb, b) => {
        bb.statements.forEach((stmt, i) => {
          rec.log = [];
          cx.visit_after_early_statement_effect(live, stmt, loc(b, i));
          out.push(`${L(loc(b, i))}: ${rec.log.join(" | ")}`);
        });
        const term = bb.terminator!;
        const at = loc(b, bb.statements.length);
        rec.log = [];
        cx.visit_after_early_terminator_effect(live, term, at);
        cx.visit_after_primary_terminator_effect(live, term, at);
        out.push(`${L(at)} ${term.kind.$}: ${rec.log.join(" | ")}`);
      });
      R.set(`visit:${name}:${all_invalidated}`, out);
    }
  });
});

test("ClosureOutlivesSubjectTy::{bind, instantiate}", () => {
  expect(R.get("closure_subject")).toEqual([
    "&'^3 &'^1 u8",
    "'?3,'?1",
    "&'?13 &'?11 u8",
  ]);
  expect(R.get("closure_subject_bugs")).toEqual([
    "bug",
    "bug",
  ]);
});

test("check_access_for_conflict: mutable borrow", () => {
  expect(R.get("conflict:mutb")).toEqual([
    "(_1.1: u8) Deep Read(Copy): false",
    "(_1.0: u8) Deep Read(Copy): true | report_use_while_mutably_borrowed bb0[3] (_1.0: u8) (_1.0: u8) | buffer_error",
    "_1 Deep Read(Borrow(Shared)): true | report_conflicting_borrow bb0[3] _1 Shared (_1.0: u8) | buffer_error",
    "_1 Deep Read(Borrow(Fake(Shallow))): false",
    "_1 Deep Read(Borrow(Fake(Deep))): true | report_conflicting_borrow bb0[3] _1 Fake(Deep) (_1.0: u8) | buffer_error",
    "(_1.0: u8) Shallow(None) Write(Mutate): true | report_illegal_mutation_of_borrowed bb0[3] (_1.0: u8) (_1.0: u8)",
    "_1 Deep Write(Move): true | report_move_out_while_borrowed bb0[3] _1 (_1.0: u8)",
    "_1 Shallow(None) Write(StorageDeadOrDrop): true | report_borrowed_value_does_not_live_long_enough bb0[3] (_1.0: u8) _1 StorageDeadOrDrop",
    "_1 Drop Write(Replace): true | report_illegal_mutation_of_borrowed bb0[3] _1 (_1.0: u8)",
    "(_1.0: u8) Deep Write(MutableBorrow(Mut { kind: Default })): true | report_conflicting_borrow bb0[3] (_1.0: u8) Mut { kind: Default } (_1.0: u8) | buffer_error",
    "_1 Deep Activation(MutableBorrow(Mut { kind: TwoPhaseBorrow }), bw0): false",
    "_1 Deep Activation(MutableBorrow(Mut { kind: TwoPhaseBorrow }), bw7): true | report_conflicting_borrow bb0[3] _1 Mut { kind: TwoPhaseBorrow } (_1.0: u8) | buffer_error",
    "reservations: ",
    "_1 Deep Reservation(MutableBorrow(Mut { kind: TwoPhaseBorrow })): true | report_conflicting_borrow bb0[3] _1 Mut { kind: TwoPhaseBorrow } (_1.0: u8) | buffer_error",
    "reservations: _1",
    "(_1.0: u8) Deep Write(Mutate): false",
  ]);
});

test("check_access_for_conflict: shared and fake borrows", () => {
  expect(R.get("conflict:shared")).toEqual([
    "Shared: (_1.0: u8) Deep Read(Copy): false",
    "Shared: _1 Deep Reservation(MutableBorrow(Mut { kind: TwoPhaseBorrow })): false",
    "Shared: _1 Deep Write(Move): true | report_move_out_while_borrowed bb0[3] _1 (_1.0: u8)",
    "Shared: (_1.0: u8) Shallow(None) Write(Mutate): true | report_illegal_mutation_of_borrowed bb0[3] (_1.0: u8) (_1.0: u8)",
    "Shared: reservations: ",
    "Fake(Shallow): (_1.0: u8) Deep Read(Copy): false",
    "Fake(Shallow): _1 Deep Reservation(MutableBorrow(Mut { kind: TwoPhaseBorrow })): false",
    "Fake(Shallow): _1 Deep Write(Move): false",
    "Fake(Shallow): (_1.0: u8) Shallow(None) Write(Mutate): true | report_illegal_mutation_of_borrowed bb0[3] (_1.0: u8) (_1.0: u8)",
    "Fake(Shallow): reservations: ",
    "Fake(Deep): (_1.0: u8) Deep Read(Copy): false",
    "Fake(Deep): _1 Deep Reservation(MutableBorrow(Mut { kind: TwoPhaseBorrow })): false",
    "Fake(Deep): _1 Deep Write(Move): true | report_move_out_while_borrowed bb0[3] _1 (_1.0: u8)",
    "Fake(Deep): (_1.0: u8) Shallow(None) Write(Mutate): true | report_illegal_mutation_of_borrowed bb0[3] (_1.0: u8) (_1.0: u8)",
    "Fake(Deep): reservations: ",
  ]);
});

test("check_access_for_conflict: reads of a reserved two-phase borrow", () => {
  expect(R.get("conflict:two_phase")).toEqual([
    "bb0[4]: false",
    "bb0[5]: true | report_use_while_mutably_borrowed bb0[5] (_1.0: u8) _1 | buffer_error",
  ]);
});

test("access_place: permissions, conflicts, error suppression", () => {
  expect(R.get("access_place")).toEqual([
    "(_1.1: u8) Deep Read(Copy): check_access_permissions (_1.1: u8) body Read(Copy) No bb0[3] | reported 0",
    "(_1.0: u8) Deep Read(Copy): check_access_permissions (_1.0: u8) body Read(Copy) No bb0[3] | report_use_while_mutably_borrowed bb0[3] (_1.0: u8) (_1.0: u8) | buffer_error | reported 1",
    "(_1.0: u8) Deep Read(Copy):  | reported 1",
    "(_1.0: u8) Shallow(None) Write(Mutate): is_mutable (_1.0: u8) ExceptUpvars | add_used_mut RootPlace { place_local: _1, place_projection: [], is_local_mutation_allowed: No } | reported 1",
    "(_1.0: u8) Shallow(None) Write(Mutate): is_mutable (_1.0: u8) No | reported 1",
    "(_1.0: u8) Deep Write(Move):  | reported 1",
    "(_1.1: u8) Shallow(None) Write(Mutate): check_access_permissions (_1.1: u8) body Write(Mutate) Yes bb0[3] | reported 1",
    "_1 Deep Activation(MutableBorrow(Mut { kind: TwoPhaseBorrow }), bw0):  | reported 0",
    "(_1.1: u8) Deep Activation(MutableBorrow(Mut { kind: TwoPhaseBorrow }), bw0): check_access_permissions (_1.1: u8) body Activation(MutableBorrow(Mut { kind: TwoPhaseBorrow }), bw0) No bb0[3] | reported 0",
  ]);
  expect(R.get("borrows_in_scope")).toBe(true);
});

test("ResultsVisitor: statements and terminators", () => {
  expect(R.get("visit:mutb:true")).toEqual([
    "bb0[0]: check_activations bb0[0]",
    "bb0[1]: check_activations bb0[1] | consume_rvalue bb0[1] &mut (_1.0: u8) | mutate_place bb0[1] _2 Shallow(None)",
    "bb0[2]: check_activations bb0[2] | check_if_path_or_subpath_is_moved bb0[2] Use _2",
    "bb0[3]: check_activations bb0[3] | consume_rvalue bb0[3] const 1_u8 | mutate_place bb0[3] (*_2) Shallow(None)",
    "bb0[4]: check_activations bb0[4] | consume_rvalue bb0[4] copy (_1.1: u8) | mutate_place bb0[4] _0 Shallow(None)",
    "bb0[5]: check_activations bb0[5] | check_access_permissions _2 span Write(StorageDeadOrDrop) Yes bb0[5]",
    "bb0[6] Return: check_activations bb0[6] | check_for_invalidation_at_exit bb0[6] (_1.0: u8)",
  ]);
  expect(R.get("visit:two_phase:true")).toEqual([
    "bb0[0]: check_activations bb0[0]",
    "bb0[1]: check_activations bb0[1]",
    "bb0[2]: check_activations bb0[2] | consume_rvalue bb0[2] &mut _1 | mutate_place bb0[2] _3 Shallow(None)",
    "bb0[3]: check_activations bb0[3]",
    "bb0[4]: check_activations bb0[4] | consume_rvalue bb0[4] copy (_1.0: u8) | mutate_place bb0[4] _4 Shallow(None)",
    "bb0[5] Call: check_activations bb0[5] | consume_operand bb0[5] S::m | consume_operand bb0[5] move _3 | consume_operand bb0[5] move _4 | mutate_place bb0[5] _2 Deep",
    "bb1[0]: check_activations bb1[0] | check_access_permissions _4 span Write(StorageDeadOrDrop) Yes bb1[0]",
    "bb1[1]: check_activations bb1[1] | check_access_permissions _3 span Write(StorageDeadOrDrop) Yes bb1[1]",
    "bb1[2]: check_activations bb1[2] | check_access_permissions _2 span Write(StorageDeadOrDrop) Yes bb1[2]",
    "bb1[3]: check_activations bb1[3] | consume_rvalue bb1[3] const () | mutate_place bb1[3] _0 Shallow(None)",
    "bb1[4] Return: check_activations bb1[4] | check_for_invalidation_at_exit bb1[4] _1",
    "bb2[0] UnwindResume: check_activations bb2[0] | check_for_invalidation_at_exit bb2[0] _1",
  ]);
  expect(R.get("visit:two_phase:false")).toEqual([
    "bb0[0]: check_activations bb0[0]",
    "bb0[1]: check_activations bb0[1]",
    "bb0[2]: check_activations bb0[2] | consume_rvalue bb0[2] &mut _1 | mutate_place bb0[2] _3 Shallow(None)",
    "bb0[3]: check_activations bb0[3]",
    "bb0[4]: check_activations bb0[4] | consume_rvalue bb0[4] copy (_1.0: u8) | mutate_place bb0[4] _4 Shallow(None)",
    "bb0[5] Call: check_activations bb0[5] | consume_operand bb0[5] S::m | consume_operand bb0[5] move _3 | consume_operand bb0[5] move _4 | mutate_place bb0[5] _2 Deep",
    "bb1[0]: check_activations bb1[0] | check_access_permissions _4 span Write(StorageDeadOrDrop) Yes bb1[0]",
    "bb1[1]: check_activations bb1[1] | check_access_permissions _3 span Write(StorageDeadOrDrop) Yes bb1[1]",
    "bb1[2]: check_activations bb1[2] | check_access_permissions _2 span Write(StorageDeadOrDrop) Yes bb1[2]",
    "bb1[3]: check_activations bb1[3] | consume_rvalue bb1[3] const () | mutate_place bb1[3] _0 Shallow(None)",
    "bb1[4] Return: check_activations bb1[4]",
    "bb2[0] UnwindResume: check_activations bb2[0]",
  ]);
});
