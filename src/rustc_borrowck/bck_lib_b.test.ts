// Lane bck-lib-b (wave 23): lib.rs lines >= 1400 (the mutate / consume / move checks, `is_mutable`, `add_used_mut`,
// `check_access_permissions`, `lint_unused_mut`, ...) on real built MIR.
//
// The runtime path of `mir_borrowck` stops before these fns (in type_check), so this test drives them directly, as
// bck_core.test.ts does: a no_core crate is compiled up to MIR building, `MoveData` / `BorrowSet` are built for each body,
// and the fns run on a `MirBorrowckCtxt` whose other lanes' methods that they call (`access_place`, `borrows_in_scope`,
// the `report_*` builders, `retrieve_borrow_spans`, `local_excluded_from_unused_mut_lint`) are replaced on the instance by
// recorders. Calls that reach another lane's still-unported fn are recorded as `UNPORTED <path>` (where the path stops).
// The expected values are worked out by hand from upstream over the MIR shown next to each body (statement indices as
// `-Zdump-mir=built` prints them).
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../scripts/lib/common.ts";
import { FieldIdx } from "../rustc_abi/layout.ts";
import type { Crate } from "../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import "../rustc_hir_analysis/lib.ts";
import { DenseBitSet, MixedBitSet } from "../rustc_index/bit_set.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../rustc_interface/passes.ts";
import "../rustc_middle/lib.ts";
import {
  BasicBlock,
  type Body,
  debug_Location,
  debug_Place,
  debug_PlaceRef,
  Local,
  Location,
  type Place,
  Place_from_Local,
  type PlaceElem,
  type PlaceRef,
  type Rvalue,
} from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import "../rustc_mir_build/lib.ts";
import { debug_Init, MoveData, type MovePathIndex } from "../rustc_mir_dataflow/move_paths/mod.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { RegionVid } from "../rustc_type_ir/region_kind.ts";
import { Region } from "../rustc_type_ir/sty/mod.ts";
import { PLAIN } from "../std/fmt.ts";
import { Unported } from "../std/panic.ts";
import "./lib.ts";
import { BorrowSet } from "./borrow_set.ts";
import type { BorrowckDomain } from "./dataflow.gen.ts";
import { BorrowIndex, debug_BorrowIndex } from "./dataflow.ts";
import {
  type AccessDepth,
  debug_AccessDepth,
  debug_ReadOrWrite,
  debug_RootPlace,
  type InitializationRequiringAction,
  type LocalMutationIsAllowed,
  MirBorrowckCtxt,
  type ReadOrWrite,
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
  "pub struct D { pub x: u8 }",
  '#[lang = "drop"] pub trait Drop { fn drop(&mut self); }',
  "impl Drop for D { fn drop(&mut self) {} }",
  "impl S { pub fn m(&mut self, v: u8) {} }",
  // bb0: [0] StorageLive(_2) [1] _2 = &(_1.0: u8) [2] FakeRead(ForLet(None), _2) [3] _0 = copy (*_2) [4] StorageDead(_2)
  "pub fn shared(s: S) -> u8 { let r = &s.x; *r }",
  // bb0: [0] StorageLive(_2) [1] _2 = &mut (_1.0: u8) [2] FakeRead(ForLet(None), _2) [3] (*_2) = const 1_u8
  //      [4] _0 = copy (_1.1: u8) [5] StorageDead(_2)
  "pub fn mutb(mut s: S) -> u8 { let r = &mut s.x; *r = 1; s.y }",
  // bb0: [0] StorageLive(_2) [1] StorageLive(_3) [2] _3 = &mut _1 (two-phase) [3] StorageLive(_4)
  //      [4] _4 = copy (_1.0: u8) [5] _2 = S::m(move _3, move _4) -> [return: bb1, unwind: bb2]
  "pub fn two_phase(mut s: S) { s.m(s.x); }",
  // bb0: [0] StorageLive(_2) [1] _2 = &mut _1 [2] FakeRead(ForLet(None), _2) [3] (*_2) = const 2_u8 [4] _1 = const 3_u8
  //      [5] _0 = copy _1 [6] StorageDead(_2)
  "pub fn reassign(mut a: u8) -> u8 { let r = &mut a; *r = 2; a = 3; a }",
  // bb0: [0] StorageLive(_1) [1] _0 = const () [2] StorageDead(_1)
  "pub fn never_init() { let mut z: u8; }",
  // bb0: [0] StorageLive(_1) [1] _1 = const 1_u8 [2] _0 = copy _1 [3] StorageDead(_1)
  "pub fn deferred() -> u8 { let x: u8; x = 1; x }",
  // bb0: [0] StorageLive(_2) [1] _2 = &(*_1) [2] _0 = &(*_2) [3] StorageDead(_2)
  "pub fn reb(r: &mut u8) -> &u8 { &*r }",
  // bb0: [0] StorageLive(_3) [1] _3 = move _1 [2] StorageLive(_4) [3] _4 = copy (_2.0: u8) [4] _0 = (move _3, move _4)
  "pub fn moves(s: S, d: D) -> (S, u8) { (s, d.x) }",
  // `_0 = move (_1.0: S)`: a move path for `_1.0` (child of `_1`)
  "pub fn fmove(s: (S, u8)) -> S { s.0 }",
  // `x = move _1[0 of 2]`: a move path for `_1[0 of 2]` (child of `_1`)
  "pub fn arr(a: [S; 2]) -> S { let [x, _] = a; x }",
].join("\n");

const WORK = join(DATA, "tmp", "bck-lib-b-test", process.env.RUST_TS_AGENT ?? "default");

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
const PR = (p: PlaceRef) => debug_PlaceRef(p, PLAIN);
const RW = (rw: ReadOrWrite) => debug_ReadOrWrite(rw, PLAIN);
const AD = (a: AccessDepth) => debug_AccessDepth(a, PLAIN);

/** Runs `f`; a stop in another lane's unported fn is recorded in `log` as `UNPORTED <path>`. */
function run(log: string[], f: () => void): void {
  try {
    f();
  } catch (e) {
    if (!(e instanceof Unported)) throw e;
    log.push(`UNPORTED ${e.what}`);
  }
}

/** Replaces the region of every `Rvalue::Ref` by `'?N` (N counting from 0 in block / statement order), what
 * `replace_regions_in_mir` gives the borrows `BorrowSet::build` collects (as bck_core.test.ts). */
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

const R = new Map<string, unknown>();

mkdirSync(WORK, { recursive: true });
const FILE = join(WORK, "bck_lib_b.rs");
writeFileSync(FILE, SRC);
run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", FILE]), (compiler) => {
  const krate: Crate = parse(compiler.sess);
  create_and_enter_global_ctxt(compiler, krate, (tcx: TyCtxt) => {
    void tcx.resolver_for_lowering();
    const bodies = new Map<string, Body>();
    tcx.par_hir_body_owners((def) => {
      const name = tcx.def_path_str(LocalDefId.to_def_id(def));
      const body = tcx.build_mir_inner_impl(def) as Body;
      renumber_borrow_regions(tcx, body);
      bodies.set(name, body);
    });

    const place = (local: number, elems: PlaceElem[]): Place => Place_from_Local(Local.new(local)).project_deeper(elems, tcx);
    const u8_ty = bodies.get("mutb")!.local_decls[0]!.ty;
    const field = (i: number): PlaceElem => ({ $: "Field", _0: FieldIdx.from_u32(i), _1: u8_ty });
    const deref: PlaceElem = { $: "Deref" };

    /** A `MirBorrowckCtxt` over `name`'s built MIR whose calls into other lanes are recorded in `log`. */
    const mk = (name: string) => {
      const body = bodies.get(name)!;
      const move_data = MoveData.gather_moves(body, tcx, () => true);
      const borrow_set = BorrowSet.build(tcx, body, true, move_data);
      const log: string[] = [];
      const mbcx = new MirBorrowckCtxt(
        undefined as never,
        { tcx } as never,
        body,
        move_data,
        undefined as never,
        false,
        new Set(),
        new Set(),
        new Set(),
        new Set(),
        new Set<Local>(),
        [],
        undefined as never,
        borrow_set,
        [],
        undefined,
        new Map(),
        1,
        undefined as never,
        [],
        undefined,
        undefined,
      );
      const mpi_name = (mpi: MovePathIndex) => P(move_data.move_paths[mpi]!.place);
      Object.assign(mbcx, {
        access_place(location: Location, [p, _span]: [Place, Span], [sd, rw]: [AccessDepth, ReadOrWrite], lmia: LocalMutationIsAllowed) {
          log.push(`access_place ${L(location)} ${P(p)} (${AD(sd)}, ${RW(rw)}) ${lmia}`);
        },
        report_use_of_moved_or_uninitialized(location: Location, action: InitializationRequiringAction, [a, b]: [PlaceRef, PlaceRef, Span], mpi: MovePathIndex) {
          log.push(`report_use_of_moved_or_uninitialized ${L(location)} ${action} (${PR(a)}, ${PR(b)}) ${mpi_name(mpi)}`);
        },
        report_mutability_error(p: Place, _span: Span, err: PlaceRef, access: string, location: Location) {
          log.push(`report_mutability_error ${P(p)} ${PR(err)} ${access} ${L(location)}`);
        },
        report_illegal_reassignment([p, _span]: [Place, Span], assigned_span: Span, err: Place) {
          const init_span = body.source_info(loc(0, 1)).span;
          log.push(`report_illegal_reassignment ${P(p)} assigned_span=bb0[1]:${assigned_span === init_span} ${P(err)}`);
        },
        report_borrowed_value_does_not_live_long_enough(location: Location, borrow: { borrowed_place: Place }, [p, _span]: [Place, Span], kind: unknown) {
          log.push(`report_borrowed_value_does_not_live_long_enough ${L(location)} ${P(borrow.borrowed_place)} ${P(p)} ${kind ?? "None"}`);
        },
        retrieve_borrow_spans(borrow: { borrowed_place: Place }) {
          log.push(`retrieve_borrow_spans ${P(borrow.borrowed_place)}`);
          return { $: "OtherUse", _0: body.span };
        },
        local_excluded_from_unused_mut_lint(local: Local) {
          log.push(`local_excluded_from_unused_mut_lint _${local}`);
          return true;
        },
      });
      /** A `BorrowckDomain`: the move paths of `uninit` (places) maybe-uninitialized, `ever_init` locals ever initialized. */
      const state = (uninit: Place[], ever_init: number[]): BorrowckDomain => {
        const uninits = MixedBitSet.new_empty<MovePathIndex>(move_data.move_paths.length);
        for (const p of uninit) {
          const r = move_data.rev_lookup.find(p.as_ref());
          if (r.$ !== "Exact") throw new Error(`ERROR: no move path for ${P(p)}`);
          MixedBitSet.insert(uninits, r._0);
        }
        const ever_inits = DenseBitSet.new_empty<Local>(body.local_decls.length);
        for (const l of ever_init) ever_inits.insert(Local.new(l));
        return { borrows: MixedBitSet.new_empty<BorrowIndex>(borrow_set.len()), uninits, ever_inits };
      };
      return { mbcx, log, body, move_data, borrow_set, state };
    };
    const span_of = (body: Body) => body.span;
    const res = (r: ReturnType<MirBorrowckCtxt["is_mutable"]>) => (r.$ === "Ok" ? `Ok(${debug_RootPlace(r._0, PLAIN)})` : `Err(${PR(r._0)})`);

    // is_mutable
    {
      const out: string[] = [];
      const im = (name: string, p: Place, lmia: LocalMutationIsAllowed) => out.push(`${name} ${P(p)} ${lmia}: ${res(mk(name).mbcx.is_mutable(p.as_ref(), lmia))}`);
      // `s` is not `mut`: only allowed local mutation passes, blamed on `_1` itself
      im("shared", place(1, []), "No");
      im("shared", place(1, []), "Yes");
      im("shared", place(1, []), "ExceptUpvars");
      // a field is owned by its base: the error names the base
      im("shared", place(1, [field(0)]), "No");
      // shared borrowed data is never mutable
      im("shared", place(2, [deref]), "No");
      // `mut s`
      im("mutb", place(1, [field(0)]), "No");
      // `*r` with `r: &mut u8` (not an upvar): `r` itself is checked with `Yes`
      im("mutb", place(2, [deref]), "No");
      im("reb", place(1, [deref]), "No");
      R.set("is_mutable", out);
    }

    // add_used_mut
    {
      const out: string[] = [];
      const au = (proj: PlaceElem[], lmia: LocalMutationIsAllowed, ever_init: number[]) => {
        const { mbcx, state } = mk("reassign");
        mbcx.add_used_mut({ place_local: Local.new(1), place_projection: proj, is_local_mutation_allowed: lmia }, state([], ever_init));
        out.push(`[${proj.map((e) => e.$).join(",")}] ${lmia} ${ever_init}: used_mut={${[...mbcx.used_mut].map((l) => `_${l}`)}} upvars=${mbcx.used_mut_upvars.length}`);
      };
      au([], "No", [1]);
      au([], "No", []);
      au([], "Yes", [1]);
      au([field(0)], "No", [1]);
      R.set("add_used_mut", out);
    }

    // check_access_permissions
    {
      const out: string[] = [];
      const cap = (name: string, p: Place, kind: ReadOrWrite, lmia: LocalMutationIsAllowed, ever_init: number[], l: Location) => {
        const { mbcx, log, state, body } = mk(name);
        const r = mbcx.check_access_permissions([p, span_of(body)], kind, lmia, state([], ever_init), l);
        out.push(`${name} ${P(p)} ${RW(kind)}: ${r} used_mut={${[...mbcx.used_mut].map((x) => `_${x}`)}}${log.length > 0 ? ` | ${log.join(" | ")}` : ""}`);
      };
      const mutate: ReadOrWrite = { $: "Write", _0: { $: "Mutate" } };
      cap("reassign", place(1, []), mutate, "No", [1], loc(0, 4));
      // `x = 1; x = ..`: an immutable local assigned again is an illegal reassignment (first reaching init at bb0[1])
      cap("deferred", place(1, []), mutate, "No", [1], loc(0, 2));
      // not yet initialized: a deferred init, no error
      cap("deferred", place(1, []), mutate, "No", [], loc(0, 2));
      cap("shared", place(1, [field(0)]), { $: "Write", _0: { $: "MutableBorrow", _0: { $: "Mut", kind: "Default" } } }, "No", [1], loc(0, 1));
      // `ClosureCapture` allows the local mutation: `Ok(Yes)`, and `Yes` roots are not recorded as used
      cap("shared", place(1, [field(0)]), { $: "Reservation", _0: { $: "MutableBorrow", _0: { $: "Mut", kind: "ClosureCapture" } } }, "No", [1], loc(0, 1));
      cap("shared", place(1, []), { $: "Read", _0: { $: "Copy" } }, "No", [1], loc(0, 1));
      cap("shared", place(1, []), { $: "Activation", _0: { $: "Mutate" }, _1: BorrowIndex.from_usize(0) }, "No", [1], loc(0, 1));
      cap("mutb", place(1, []), { $: "Write", _0: { $: "Move" } }, "Yes", [1], loc(0, 1));
      R.set("check_access_permissions", out);
    }

    // first_reaching_init, move_path_closest_to, move_path_for_place
    {
      const out: string[] = [];
      const fri = (name: string, l: Location) => {
        const { mbcx, move_data } = mk(name);
        const ii = mbcx.first_reaching_init(Local.new(1), l);
        out.push(`first_reaching_init ${name} _1 ${L(l)}: ${ii === undefined ? "None" : debug_Init(move_data.inits[ii]!, PLAIN)}`);
      };
      fri("deferred", loc(0, 2));
      fri("deferred", loc(0, 1));
      fri("reassign", loc(0, 5));
      const { mbcx, move_data } = mk("fmove");
      for (const p of [place(1, []), place(1, [field(0)]), place(1, [field(1)])]) {
        const [prefix, mpi] = mbcx.move_path_closest_to(p.as_ref());
        const exact = mbcx.move_path_for_place(p.as_ref());
        out.push(`${P(p)}: closest=(${PR(prefix)}, ${P(move_data.move_paths[mpi]!.place)}) for_place=${exact === undefined ? "None" : P(move_data.move_paths[exact]!.place)}`);
      }
      R.set("move_paths", out);
    }

    // check_if_full_path_is_moved / check_if_path_or_subpath_is_moved / check_if_subslice_element_is_moved
    {
      const out: string[] = [];
      const go = (label: string, name: string, f: (m: ReturnType<typeof mk>) => void) => {
        const m = mk(name);
        run(m.log, () => f(m));
        out.push(`${label}: ${m.log.join(" | ")}`);
      };
      go("full mutb _1.0 uninit _1", "mutb", (m) => m.mbcx.check_if_full_path_is_moved(loc(0, 4), "Use", [place(1, [field(0)]).as_ref(), span_of(m.body)], m.state([place(1, [])], [])));
      go("full mutb _1.0 init", "mutb", (m) => m.mbcx.check_if_full_path_is_moved(loc(0, 4), "Use", [place(1, [field(0)]).as_ref(), span_of(m.body)], m.state([], [])));
      // a moved-out child: the full path `_1` is initialized, its subpath `_1.0` is not
      go("path_or_subpath fmove _1 uninit _1.0", "fmove", (m) =>
        m.mbcx.check_if_path_or_subpath_is_moved(loc(0, 1), "Use", [place(1, []).as_ref(), span_of(m.body)], m.state([place(1, [field(0)])], [])),
      );
      go("full fmove _1 uninit _1.0", "fmove", (m) => m.mbcx.check_if_full_path_is_moved(loc(0, 1), "Use", [place(1, []).as_ref(), span_of(m.body)], m.state([place(1, [field(0)])], [])));
      const ci0: PlaceElem = { $: "ConstantIndex", offset: 0, min_length: 2, from_end: false };
      go("subslice arr _1[0..1] uninit _1[0 of 2]", "arr", (m) =>
        m.mbcx.check_if_subslice_element_is_moved(loc(0, 1), "Use", [place(1, []).as_ref(), span_of(m.body)], m.state([place(1, [ci0])], []).uninits, 0, 1),
      );
      go("subslice arr _1[1..2] uninit _1[0 of 2]", "arr", (m) =>
        m.mbcx.check_if_subslice_element_is_moved(loc(0, 1), "Use", [place(1, []).as_ref(), span_of(m.body)], m.state([place(1, [ci0])], []).uninits, 1, 2),
      );
      // `_1[1..2]` (a `Subslice` of an array): checked element-wise on the base `_1`
      go("path_or_subpath arr _1[0..1] uninit _1[0 of 2]", "arr", (m) =>
        m.mbcx.check_if_path_or_subpath_is_moved(loc(0, 1), "Borrow", [place(1, [{ $: "Subslice", from: 0, to: 1, from_end: false }]).as_ref(), span_of(m.body)], m.state([place(1, [ci0])], [])),
      );
      R.set("moved", out);
    }

    // check_if_assigned_path_is_moved (+ the fn-local check_parent_of_field), mutate_place
    {
      const out: string[] = [];
      const go = (label: string, name: string, p: Place, uninit: Place[]) => {
        const m = mk(name);
        run(m.log, () => m.mbcx.check_if_assigned_path_is_moved(loc(0, 3), [p, span_of(m.body)], m.state(uninit, [])));
        out.push(`${label}: ${m.log.join(" | ")} used_mut={${[...m.mbcx.used_mut].map((x) => `_${x}`)}}`);
      };
      go("mutb (*_2) uninit _2", "mutb", place(2, [deref]), [place(2, [])]);
      go("mutb (*_2) init", "mutb", place(2, [deref]), []);
      go("mutb _1.0 uninit _1", "mutb", place(1, [field(0)]), [place(1, [])]);
      go("mutb _1.0 init", "mutb", place(1, [field(0)]), []);
      // `D: Drop`: assigning `d.x` needs `d` (and every subpath) initialized
      go("moves _2.0 uninit _2", "moves", place(2, [field(0)]), [place(2, [])]);
      const m = mk("mutb");
      m.mbcx.mutate_place(loc(0, 3), [place(2, [deref]), span_of(m.body)], { $: "Deep" }, m.state([], []));
      out.push(`mutate_place: ${m.log.join(" | ")}`);
      R.set("assigned", out);
    }

    // check_movable_place
    {
      const out: string[] = [];
      const go = (name: string, p: Place) => {
        const m = mk(name);
        run(m.log, () => m.mbcx.check_movable_place(loc(0, 1), p));
        out.push(`${name} ${P(p)}: ${m.log.join(" | ")} errors=${m.mbcx.move_errors.length}`);
      };
      go("mutb", place(2, [deref]));
      go("moves", place(2, [field(0)]));
      go("moves", place(1, [field(0)]));
      go("shared", place(1, []));
      R.set("movable", out);
    }

    // consume_rvalue / consume_operand
    {
      const out: string[] = [];
      const rv = (name: string, bb: number, i: number): Rvalue => {
        const k = bodies.get(name)!.basic_blocks.deref()[bb]!.statements[i]!.kind;
        if (k.$ !== "Assign") throw new Error("ERROR: not an assignment");
        return k._0[1];
      };
      const go = (label: string, name: string, l: Location, rvalue: Rvalue, uninit: Place[] = []) => {
        const m = mk(name);
        run(m.log, () => m.mbcx.consume_rvalue(l, [rvalue, span_of(m.body)], m.state(uninit, [])));
        out.push(`${label}: ${m.log.join(" | ")}`);
      };
      const shared_ref = rv("shared", 0, 1);
      go("shared &(_1.0)", "shared", loc(0, 1), shared_ref);
      go("mutb &mut (_1.0)", "mutb", loc(0, 1), rv("mutb", 0, 1));
      go("two_phase &mut _1", "two_phase", loc(0, 2), rv("two_phase", 0, 2));
      go("reb &(*_1)", "reb", loc(0, 1), rv("reb", 0, 1));
      if (shared_ref.$ !== "Ref") throw new Error("ERROR: not a ref");
      go("fake shallow &(_1.0) uninit _1", "shared", loc(0, 1), { $: "Ref", _0: shared_ref._0, _1: { $: "Fake", _0: "Shallow" }, _2: place(1, [field(0)]) }, [place(1, [])]);
      go("fake deep &(_1.0)", "shared", loc(0, 1), { $: "Ref", _0: shared_ref._0, _1: { $: "Fake", _0: "Deep" }, _2: place(1, [field(0)]) });
      go("raw fake metadata _1 uninit _1", "shared", loc(0, 1), { $: "RawPtr", _0: "FakeForPtrMetadata", _1: place(1, []) }, [place(1, [])]);
      go("raw mut _1", "shared", loc(0, 1), { $: "RawPtr", _0: "Mut", _1: place(1, []) });
      go("reborrow mut (*_1)", "reb", loc(0, 1), { $: "Reborrow", _0: u8_ty, _1: "Mut", _2: place(1, [deref]) });
      go("reborrow not (*_1)", "reb", loc(0, 1), { $: "Reborrow", _0: u8_ty, _1: "Not", _2: place(1, [deref]) });
      go("discriminant _1 uninit _1", "shared", loc(0, 1), { $: "Discriminant", _0: place(1, []) }, [place(1, [])]);
      go("use copy (_1.0)", "two_phase", loc(0, 4), rv("two_phase", 0, 4));
      go("aggregate (move _3, move _4)", "moves", loc(0, 4), rv("moves", 0, 4));
      go("use move _1", "moves", loc(0, 1), rv("moves", 0, 1));
      R.set("consume", out);
    }

    // check_activations
    {
      const out: string[] = [];
      for (const l of [loc(0, 4), loc(0, 5)]) {
        const m = mk("two_phase");
        m.mbcx.check_activations(l, span_of(m.body), m.state([], []));
        out.push(`${L(l)}: ${m.log.join(" | ")}`);
      }
      R.set("activations", out);
    }

    // check_for_invalidation_at_exit / check_for_local_borrow / check_backward_incompatible_drop
    {
      const out: string[] = [];
      for (const name of ["shared", "reb"]) {
        const m = mk(name);
        const b = m.borrow_set.index(BorrowIndex.from_usize(0));
        run(m.log, () => m.mbcx.check_for_invalidation_at_exit(loc(0, 4), b, span_of(m.body)));
        out.push(`exit ${name} ${P(b.borrowed_place)}: ${m.log.join(" | ")}`);
      }
      for (const name of ["reb", "shared"]) {
        const m = mk(name);
        const b = m.borrow_set.index(BorrowIndex.from_usize(0));
        run(m.log, () => m.mbcx.check_for_local_borrow(b, span_of(m.body)));
        out.push(`local_borrow ${name} ${P(b.borrowed_place)}: ${m.log.join(" | ")}`);
      }
      for (const in_scope of [[], [0]]) {
        const m = mk("shared");
        Object.assign(m.mbcx, {
          borrows_in_scope(location: Location) {
            m.log.push(`borrows_in_scope ${L(location)}`);
            const set = MixedBitSet.new_empty<BorrowIndex>(m.borrow_set.len());
            for (const i of in_scope) MixedBitSet.insert(set, BorrowIndex.from_usize(i));
            return set;
          },
        });
        run(m.log, () => m.mbcx.check_backward_incompatible_drop(loc(0, 3), place(1, []), m.state([], [])));
        out.push(`backward_incompatible_drop in_scope=[${in_scope.map((i) => debug_BorrowIndex(BorrowIndex.from_usize(i), PLAIN))}]: ${m.log.join(" | ")}`);
      }
      R.set("borrows", out);
    }

    // propagate_closure_used_mut_upvar
    {
      const out: string[] = [];
      const go = (name: string, kind: "Copy" | "Move", p: Place) => {
        const m = mk(name);
        m.mbcx.propagate_closure_used_mut_upvar({ $: kind, _0: p });
        out.push(`${name} ${kind}(${P(p)}): used_mut={${[...m.mbcx.used_mut].map((x) => `_${x}`)}} upvars=${m.mbcx.used_mut_upvars.length}`);
      };
      go("mutb", "Copy", place(1, []));
      go("mutb", "Copy", place(2, [deref]));
      go("two_phase", "Move", place(3, []));
      go("two_phase", "Copy", place(4, []));
      R.set("propagate", out);
    }

    // lint_unused_mut
    {
      const out: string[] = [];
      for (const [name, used] of [["never_init", []], ["reassign", [1]], ["reassign", []]] as const) {
        const m = mk(name);
        for (const l of used) m.mbcx.used_mut.add(Local.new(l));
        m.mbcx.lint_unused_mut();
        out.push(`${name} used_mut={${used.map((x) => `_${x}`)}}: ${m.log.join(" | ")}`);
      }
      R.set("lint_unused_mut", out);
    }
  });
});

test("is_mutable", () => {
  expect(R.get("is_mutable")).toEqual([
    "shared _1 No: Err(_1)",
    "shared _1 Yes: Ok(RootPlace { place_local: _1, place_projection: [], is_local_mutation_allowed: Yes })",
    "shared _1 ExceptUpvars: Ok(RootPlace { place_local: _1, place_projection: [], is_local_mutation_allowed: ExceptUpvars })",
    "shared (_1.0: u8) No: Err(_1)",
    "shared (*_2) No: Err((*_2))",
    "mutb (_1.0: u8) No: Ok(RootPlace { place_local: _1, place_projection: [], is_local_mutation_allowed: No })",
    "mutb (*_2) No: Ok(RootPlace { place_local: _2, place_projection: [], is_local_mutation_allowed: Yes })",
    "reb (*_1) No: Ok(RootPlace { place_local: _1, place_projection: [], is_local_mutation_allowed: Yes })",
  ]);
});

test("add_used_mut", () => {
  expect(R.get("add_used_mut")).toEqual([
    "[] No 1: used_mut={_1} upvars=0",
    "[] No : used_mut={} upvars=0",
    "[] Yes 1: used_mut={} upvars=0",
    "[Field] No 1: used_mut={} upvars=0",
  ]);
});

test("check_access_permissions", () => {
  expect(R.get("check_access_permissions")).toEqual([
    "reassign _1 Write(Mutate): false used_mut={_1}",
    "deferred _1 Write(Mutate): true used_mut={} | report_illegal_reassignment _1 assigned_span=bb0[1]:true _1",
    "deferred _1 Write(Mutate): false used_mut={}",
    "shared (_1.0: u8) Write(MutableBorrow(Mut { kind: Default })): true used_mut={} | report_mutability_error (_1.0: u8) _1 MutableBorrow bb0[1]",
    "shared (_1.0: u8) Reservation(MutableBorrow(Mut { kind: ClosureCapture })): false used_mut={}",
    "shared _1 Read(Copy): false used_mut={}",
    "shared _1 Activation(Mutate, bw0): false used_mut={}",
    "mutb _1 Write(Move): false used_mut={}",
  ]);
});

test("first_reaching_init, move_path_closest_to, move_path_for_place", () => {
  expect(R.get("move_paths")).toEqual([
    "first_reaching_init deferred _1 bb0[2]: mp1@Statement(bb0[1]) (Deep)",
    "first_reaching_init deferred _1 bb0[1]: None",
    "first_reaching_init reassign _1 bb0[5]: mp1@Argument(_1) (Deep)",
    "_1: closest=(_1, _1) for_place=_1",
    "(_1.0: u8): closest=((_1.0: S), (_1.0: S)) for_place=(_1.0: S)",
    "(_1.1: u8): closest=(_1, _1) for_place=None",
  ]);
});

test("check_if_full_path_is_moved / check_if_path_or_subpath_is_moved / check_if_subslice_element_is_moved", () => {
  expect(R.get("moved")).toEqual([
    "full mutb _1.0 uninit _1: report_use_of_moved_or_uninitialized bb0[4] Use (_1, (_1.0: u8)) _1",
    "full mutb _1.0 init: ",
    "path_or_subpath fmove _1 uninit _1.0: report_use_of_moved_or_uninitialized bb0[1] Use (_1, _1) (_1.0: S)",
    "full fmove _1 uninit _1.0: ",
    "subslice arr _1[0..1] uninit _1[0 of 2]: report_use_of_moved_or_uninitialized bb0[1] Use (_1, _1) _1[0 of 2]",
    "subslice arr _1[1..2] uninit _1[0 of 2]: ",
    "path_or_subpath arr _1[0..1] uninit _1[0 of 2]: report_use_of_moved_or_uninitialized bb0[1] Borrow (_1, _1) _1[0 of 2]",
  ]);
});

test("check_if_assigned_path_is_moved, check_parent_of_field, mutate_place", () => {
  expect(R.get("assigned")).toEqual([
    "mutb (*_2) uninit _2: report_use_of_moved_or_uninitialized bb0[3] Use (_2, _2) _2 used_mut={}",
    "mutb (*_2) init:  used_mut={}",
    "mutb _1.0 uninit _1: report_use_of_moved_or_uninitialized bb0[3] PartialAssignment (_1, _1) _1 used_mut={_1}",
    "mutb _1.0 init:  used_mut={}",
    "moves _2.0 uninit _2: report_use_of_moved_or_uninitialized bb0[3] Assignment (_2, _2) _2 | report_use_of_moved_or_uninitialized bb0[3] Assignment (_2, _2) _2 used_mut={}",
    "mutate_place: access_place bb0[3] (*_2) (Deep, Write(Mutate)) No",
  ]);
});

test("check_movable_place", () => {
  expect(R.get("movable")).toEqual([
    "mutb (*_2): UNPORTED rustc_borrowck::diagnostics::move_errors::MoveError::new errors=0",
    "moves (_2.0: u8): UNPORTED rustc_borrowck::diagnostics::move_errors::MoveError::new errors=0",
    "moves (_1.0: u8):  errors=0",
    "shared _1:  errors=0",
  ]);
});

test("consume_rvalue / consume_operand", () => {
  expect(R.get("consume")).toEqual([
    "shared &(_1.0): access_place bb0[1] (_1.0: u8) (Deep, Read(Borrow(Shared))) No",
    "mutb &mut (_1.0): access_place bb0[1] (_1.0: u8) (Deep, Write(MutableBorrow(Mut { kind: Default }))) No",
    "two_phase &mut _1: access_place bb0[2] _1 (Deep, Reservation(MutableBorrow(Mut { kind: TwoPhaseBorrow }))) No",
    "reb &(*_1): access_place bb0[1] (*_1) (Deep, Read(Borrow(Shared))) No",
    "fake shallow &(_1.0) uninit _1: access_place bb0[1] (_1.0: u8) (Shallow(Some(FakeBorrow)), Read(Borrow(Fake(Shallow)))) No | report_use_of_moved_or_uninitialized bb0[1] MatchOn (_1, (_1.0: u8)) _1",
    "fake deep &(_1.0): access_place bb0[1] (_1.0: u8) (Deep, Read(Borrow(Fake(Deep)))) No",
    "raw fake metadata _1 uninit _1: access_place bb0[1] _1 (Shallow(Some(ArrayLength)), Read(Copy)) No | report_use_of_moved_or_uninitialized bb0[1] Borrow (_1, _1) _1 | report_use_of_moved_or_uninitialized bb0[1] Borrow (_1, _1) _1",
    "raw mut _1: access_place bb0[1] _1 (Deep, Write(MutableBorrow(Mut { kind: Default }))) No",
    "reborrow mut (*_1): access_place bb0[1] (*_1) (Deep, Write(MutableBorrow(Mut { kind: Default }))) Yes",
    "reborrow not (*_1): access_place bb0[1] (*_1) (Deep, Read(Borrow(Shared))) Yes",
    "discriminant _1 uninit _1: access_place bb0[1] _1 (Shallow(None), Read(Copy)) No | report_use_of_moved_or_uninitialized bb0[1] Use (_1, _1) _1 | report_use_of_moved_or_uninitialized bb0[1] Use (_1, _1) _1",
    "use copy (_1.0): access_place bb0[4] (_1.0: u8) (Deep, Read(Copy)) No",
    "aggregate (move _3, move _4): access_place bb0[4] _3 (Deep, Write(Move)) Yes | access_place bb0[4] _4 (Deep, Write(Move)) Yes",
    "use move _1: access_place bb0[1] _1 (Deep, Write(Move)) Yes",
  ]);
});

test("check_activations", () => {
  expect(R.get("activations")).toEqual([
    "bb0[4]: ",
    "bb0[5]: access_place bb0[5] _1 (Deep, Activation(MutableBorrow(Mut { kind: TwoPhaseBorrow }), bw0)) No",
  ]);
});

test("check_for_invalidation_at_exit / check_for_local_borrow / check_backward_incompatible_drop", () => {
  expect(R.get("borrows")).toEqual([
    "exit shared (_1.0: u8): report_borrowed_value_does_not_live_long_enough bb0[4] (_1.0: u8) (_1.0: u8) None",
    "exit reb (*_1): ",
    "local_borrow reb (*_1): ",
    "local_borrow shared (_1.0: u8): retrieve_borrow_spans (_1.0: u8) | UNPORTED rustc_borrowck::diagnostics::UseSpans::var_or_use",
    "backward_incompatible_drop in_scope=[]: borrows_in_scope bb0[3]",
    "backward_incompatible_drop in_scope=[bw0]: borrows_in_scope bb0[3] | retrieve_borrow_spans (_1.0: u8) | UNPORTED rustc_borrowck::diagnostics::UseSpans::var_or_use_path_span",
  ]);
});

test("propagate_closure_used_mut_upvar", () => {
  expect(R.get("propagate")).toEqual([
    "mutb Copy(_1): used_mut={_1} upvars=0",
    "mutb Copy((*_2)): used_mut={} upvars=0",
    "two_phase Move(_3): used_mut={} upvars=0",
    "two_phase Copy(_4): used_mut={_1} upvars=0",
  ]);
});

test("lint_unused_mut", () => {
  expect(R.get("lint_unused_mut")).toEqual([
    "never_init used_mut={}: local_excluded_from_unused_mut_lint _1",
    "reassign used_mut={_1}: ",
    "reassign used_mut={}: local_excluded_from_unused_mut_lint _1",
  ]);
});
