// Lane dataflow-move-paths: `MoveData::gather_moves` (move_paths/{mod, builder}.rs), drop_flag_effects.rs, un_derefer.rs,
// points.rs and debuginfo.rs on real built MIR.
//
// A no_core crate is compiled up to MIR building (`build_mir_inner_impl`, as rustc_mir_build/builder/contract.test.ts;
// its `-Zdump-mir=built` output is byte-identical to the pinned rustc's for these bodies). The expected move paths,
// move-outs, inits, the child / sibling structure and the drop-flag effects below were worked out by hand from upstream's
// builder.rs over that MIR (statement indices as in the oracle dump; see the comments next to each body).
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import "../../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import "../../rustc_middle/lib.ts";
import {
  BasicBlock,
  type Body,
  debug_Place,
  Local,
  LocalDecl,
  Location,
  type Place,
  Place_from_Local,
  type PlaceElem,
  PlaceRef,
  Statement,
} from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import "../../rustc_mir_build/lib.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { FieldIdx, VariantIdx } from "../../rustc_abi/layout.ts";
import { PLAIN } from "../../std/fmt.ts";
import { debuginfo_locals } from "../debuginfo.ts";
import {
  drop_flag_effects_for_function_entry,
  drop_flag_effects_for_location,
  type DropFlagState,
  type InactiveVariants,
  move_path_children_matching,
  on_all_inactive_variants,
  on_lookup_result_bits,
} from "../drop_flag_effects.ts";
import { DenseLocationMap, PointIndex } from "../points.ts";
import { UnDerefer } from "../un_derefer.ts";
import {
  debug_Init,
  debug_MoveOut,
  debug_MovePath,
  display_MovePath,
  type LookupResult,
  MoveData,
  MoveOutIndex,
  MovePathIndex,
  MovePathLookup,
  MoveSubPath,
} from "./mod.ts";

const SRC = [
  "#![feature(no_core, lang_items)]",
  "#![no_core]",
  "#![allow(internal_features)]",
  '#[lang = "pointee_sized"] pub trait PointeeSized {}',
  '#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}',
  '#[lang = "sized"] pub trait Sized: MetaSized {}',
  '#[lang = "copy"] pub trait Copy {}',
  "impl Copy for u8 {}",
  "impl Copy for bool {}",
  '#[lang = "legacy_receiver"] pub trait LegacyReceiver {}',
  "impl<T: ?Sized> LegacyReceiver for &T {}",
  "impl<T: ?Sized> LegacyReceiver for &mut T {}",
  '#[lang = "drop"] pub trait Drop { fn drop(&mut self); }',
  "pub struct S { pub x: u8 }",
  "pub struct P { pub a: S, pub b: S }",
  "pub struct D { pub s: S }",
  "impl Drop for D { fn drop(&mut self) {} }",
  "pub union U { pub a: u8, pub b: u8 }",
  "pub enum Opt { Nothing, Just(S) }",
  "pub fn take(s: S) -> S { s }",
  "pub fn fields(p: P) -> S { let x = p.b; let y = p.a; take(y); x }",
  "pub fn tuple(t: (S, S), c: bool) -> S { if c { t.0 } else { t.1 } }",
  "pub fn by_ref(r: &mut S) { r.x = 1; }",
  "pub fn un(mut u: U) -> U { u.a = 1; u }",
  "pub fn downcast(o: Opt) -> S { match o { Opt::Just(s) => s, Opt::Nothing => S { x: 0 } } }",
  "pub fn arr(a: [S; 3]) -> [S; 2] { let [x, rest @ ..] = a; take(x); rest }",
  "pub fn dtor(mut d: D) -> u8 { d.s = S { x: 1 }; let n = d.s.x; n }",
  "pub fn dd(r: &&mut S) -> u8 { (**r).x }",
].join("\n");

const WORK = join(DATA, "tmp", "dataflow-move-paths-test", process.env.RUST_TS_AGENT ?? "default");

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

/** `MoveData`'s tables as the lines upstream's `finalize` `debug!` dump would show, plus the inits. */
function summary(md: MoveData): string[] {
  const out: string[] = [];
  md.move_paths.forEach((p, i) => out.push(`${MovePathIndex.debug(MovePathIndex.new(i), PLAIN)} = ${debug_MovePath(p, PLAIN)}`));
  md.move_outs.forEach((m, i) => out.push(`${MoveOutIndex.debug(MoveOutIndex.new(i), PLAIN)} = ${debug_MoveOut(m, PLAIN)}`));
  md.inits.forEach((m, i) => out.push(`in${i} = ${debug_Init(m, PLAIN)}`));
  return out;
}

const mp = (i: number) => MovePathIndex.new(i);
const loc = (bb: number, i: number) => new Location(BasicBlock.new(bb), i);
const lookup = (r: LookupResult) => (r.$ === "Exact" ? `Exact(${MovePathIndex.debug(r._0, PLAIN)})` : `Parent(${r._0 === undefined ? "None" : MovePathIndex.debug(r._0, PLAIN)})`);
const effects = (f: (cb: (mpi: MovePathIndex, s: DropFlagState) => void) => void) => {
  const out: string[] = [];
  f((mpi, s) => out.push(`${MovePathIndex.debug(mpi, PLAIN)} ${s}`));
  return out;
};
const bits = (f: (cb: (mpi: MovePathIndex) => void) => void) => {
  const out: string[] = [];
  f((mpi) => out.push(MovePathIndex.debug(mpi, PLAIN)));
  return out;
};

/** Everything the tests check, computed inside the compiler session (printing places needs the `TyCtxt`). */
const R = new Map<string, unknown>();
const bodies = new Map<string, Body>();
const datas = new Map<string, MoveData>();

mkdirSync(WORK, { recursive: true });
const FILE = join(WORK, "move_paths.rs");
writeFileSync(FILE, SRC);
run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", FILE]), (compiler) => {
  const krate: Crate = parse(compiler.sess);
  create_and_enter_global_ctxt(compiler, krate, (tcx: TyCtxt) => {
    void tcx.resolver_for_lowering();
    tcx.par_hir_body_owners((def) => {
      const name = tcx.def_path_str(LocalDefId.to_def_id(def));
      const body = tcx.build_mir_inner_impl(def) as Body;
      bodies.set(name, body);
      const md = MoveData.gather_moves(body, tcx, () => true);
      datas.set(name, md);
      R.set(`${name}:summary`, summary(md));
    });
    const place = (local: number, elems: PlaceElem[]): Place => Place_from_Local(Local.new(local)).project_deeper(elems, tcx);

    // `fields`: lookups through the `rev_lookup` tables
    {
      const md = datas.get("fields")!;
      const body = bodies.get("fields")!;
      const p1 = place(1, []);
      const f1: PlaceElem = { $: "Field", _0: FieldIdx.from_u32(1), _1: body.local_decls[2]!.ty };
      const f1_0: PlaceElem = { $: "Field", _0: FieldIdx.from_u32(0), _1: tcx.types.u8 };
      R.set("fields:find", [
        lookup(md.rev_lookup.find(p1.as_ref())),
        lookup(md.rev_lookup.find(place(1, [f1]).as_ref())),
        lookup(md.rev_lookup.find(place(1, [f1, f1_0]).as_ref())),
        lookup(md.rev_lookup.find(place(1, [{ $: "Index", _0: Local.new(5) }]).as_ref())),
      ]);
      R.set("fields:display", md.move_paths.map((p) => display_MovePath(p)));
      R.set("fields:children_matching", [
        move_path_children_matching(md, mp(1), (e) => e.$ === "Field" && e._0 === FieldIdx.from_u32(0)),
        move_path_children_matching(md, mp(1), (e) => e.$ === "Field" && e._0 === FieldIdx.from_u32(7)),
      ]);
      R.set("fields:entry", effects((cb) => drop_flag_effects_for_function_entry(body, md, cb)));
      R.set("fields:effects", [
        effects((cb) => drop_flag_effects_for_location(body, md, loc(0, 1), cb)),
        effects((cb) => drop_flag_effects_for_location(body, md, loc(0, 9), cb)),
        effects((cb) => drop_flag_effects_for_location(body, md, loc(1, 2), cb)),
        effects((cb) => drop_flag_effects_for_location(body, md, loc(1, 5), cb)),
      ]);
      R.set("fields:lookup_bits", [
        bits((cb) => on_lookup_result_bits(md, md.rev_lookup.find(p1.as_ref()), cb)),
        bits((cb) => on_lookup_result_bits(md, { $: "Parent", _0: mp(1) }, cb)),
      ]);
      R.set("fields:debuginfo", [...debuginfo_locals(body).iter()].map((l) => Local.index(l)));
    }

    // `downcast`: enum variants
    {
      const md = datas.get("downcast")!;
      const enum_place = place(1, []);
      const run = (iv: InactiveVariants) => bits((cb) => on_all_inactive_variants(md, enum_place, iv, cb));
      R.set("downcast:inactive", [
        run({ $: "Active", _0: VariantIdx.from_u32(0) }),
        run({ $: "Active", _0: VariantIdx.from_u32(1) }),
        run({ $: "Inactives", _0: [VariantIdx.from_u32(1)] }),
        run({ $: "Inactives", _0: [VariantIdx.from_u32(0)] }),
      ]);
      R.set("downcast:display", md.move_paths.map((p) => display_MovePath(p)));
    }

    // `arr`: the split subslice
    {
      const md = datas.get("arr")!;
      R.set("arr:find", [
        lookup(md.rev_lookup.find(place(1, [{ $: "ConstantIndex", offset: 2, min_length: 3, from_end: false }]).as_ref())),
        lookup(md.rev_lookup.find(place(1, [{ $: "ConstantIndex", offset: 0, min_length: 3, from_end: true }]).as_ref())),
        lookup(md.rev_lookup.find(place(1, [{ $: "Subslice", from: 1, to: 3, from_end: false }]).as_ref())),
      ]);
      R.set("arr:display", md.move_paths.map((p) => display_MovePath(p)));
    }

    // `dd` with the `CopyForDeref` the `Derefer` pass would insert (rustc_mir_transform deref_separator.rs, not
    // ported): `_2 = deref_copy (*_1); _0 = copy ((*_2).0: u8); StorageDead(_2)` with `_2` a `DerefTemp`.
    {
      const body = bodies.get("dd")!;
      const bb0 = body.basic_blocks.as_mut()[0]!;
      const si = bb0.statements[0]!.source_info;
      const deref: PlaceElem = { $: "Deref" };
      const star_1 = place(1, [deref]);
      const tmp = LocalDecl.with_source_info(star_1.ty(body, tcx).ty, si);
      tmp.local_info = { $: "Set", _0: { $: "DerefTemp" } };
      body.local_decls.push(tmp);
      const field0: PlaceElem = { $: "Field", _0: FieldIdx.from_u32(0), _1: tcx.types.u8 };
      const read = place(2, [deref, field0]);
      bb0.statements.splice(
        0,
        1,
        Statement.new(si, { $: "Assign", _0: [place(2, []), { $: "CopyForDeref", _0: star_1 }] }),
        Statement.new(si, { $: "Assign", _0: [place(0, []), { $: "Use", _0: { $: "Copy", _0: read }, _1: "No" }] }),
        Statement.new(si, { $: "StorageDead", _0: Local.new(2) }),
      );
      const md = MoveData.gather_moves(body, tcx, () => true);
      R.set("dd:summary", summary(md));
      R.set("dd:locals", md.rev_lookup.locals.map((x) => (x === undefined ? "None" : MovePathIndex.debug(x, PLAIN))));
      R.set("dd:chain", md.rev_lookup.un_derefer.deref_chain(Local.new(2)).map((p) => debug_Place(p.to_place(tcx), PLAIN)));
      R.set(
        "dd:iter",
        [...md.rev_lookup.un_derefer.iter_projections(read.as_ref())].map(([b, e]) => `${debug_Place(b.to_place(tcx), PLAIN)} ${e.$}`),
      );
      R.set("dd:find", [lookup(md.rev_lookup.find(read.as_ref())), lookup(md.rev_lookup.find(place(2, []).as_ref()))]);
      // `u8` filtered out: no move path for `_0` / `_0`'s init
      R.set("dd:filtered", summary(MoveData.gather_moves(body, tcx, (ty) => ty !== tcx.types.u8)));
    }

    // `fields` with `S` filtered out (as drop elaboration's `needs_drop` filter would): no paths for `_0`, `_2`..`_5` nor
    // `_1.0` / `_1.1`; moving `p.b` stops at the filter
    R.set("fields:filtered", summary(MoveData.gather_moves(bodies.get("fields")!, tcx, (ty) => ty === bodies.get("fields")!.local_decls[1]!.ty)));
  });
});

test("gather_moves on built MIR: struct fields become sibling child paths, inits and moves per location", () => {
  // fields: bb0[1] `_2 = move (_1.1: S)` creates mp6, bb0[4] `_3 = move (_1.0: S)` creates mp7 (new first child of mp1,
  // mp6 its next sibling); bb0[9] `_4 = take(move _5)` (target Some) inits `_4` NonPanicPathOnly; StorageDead moves out
  expect(R.get("fields:summary")).toEqual([
    "mp0 = MovePath { place: _0 }",
    "mp1 = MovePath { first_child: mp7, place: _1 }",
    "mp2 = MovePath { place: _2 }",
    "mp3 = MovePath { place: _3 }",
    "mp4 = MovePath { place: _4 }",
    "mp5 = MovePath { place: _5 }",
    "mp6 = MovePath { parent: mp1, place: (_1.1: S) }",
    "mp7 = MovePath { parent: mp1, next_sibling: mp6 place: (_1.0: S) }",
    "mo0 = mp6@bb0[1]",
    "mo1 = mp7@bb0[4]",
    "mo2 = mp3@bb0[8]",
    "mo3 = mp5@bb0[9]",
    "mo4 = mp5@bb1[0]",
    "mo5 = mp4@bb1[1]",
    "mo6 = mp2@bb1[2]",
    "mo7 = mp3@bb1[3]",
    "mo8 = mp2@bb1[4]",
    "in0 = mp1@Argument(_1) (Deep)",
    "in1 = mp2@Statement(bb0[1]) (Deep)",
    "in2 = mp3@Statement(bb0[4]) (Deep)",
    "in3 = mp5@Statement(bb0[8]) (Deep)",
    "in4 = mp4@Statement(bb0[9]) (NonPanicPathOnly)",
    "in5 = mp0@Statement(bb1[2]) (Deep)",
  ]);
  expect(R.get("fields:display")).toEqual(["_0", "_1", "_2", "_3", "_4", "_5", "(_1.1: S)", "(_1.0: S)"]);
  // tuple: `switchInt(move _3)` moves; the two arms move `t.0` / `t.1`
  expect(R.get("tuple:summary")).toEqual([
    "mp0 = MovePath { place: _0 }",
    "mp1 = MovePath { first_child: mp5, place: _1 }",
    "mp2 = MovePath { place: _2 }",
    "mp3 = MovePath { place: _3 }",
    "mp4 = MovePath { parent: mp1, place: (_1.0: S) }",
    "mp5 = MovePath { parent: mp1, next_sibling: mp4 place: (_1.1: S) }",
    "mo0 = mp3@bb0[2]",
    "mo1 = mp4@bb1[0]",
    "mo2 = mp5@bb3[0]",
    "mo3 = mp3@bb4[0]",
    "in0 = mp1@Argument(_1) (Deep)",
    "in1 = mp2@Argument(_2) (Deep)",
    "in2 = mp3@Statement(bb0[1]) (Deep)",
    "in3 = mp0@Statement(bb1[0]) (Deep)",
    "in4 = mp0@Statement(bb3[0]) (Deep)",
  ]);
});

test("gather_moves: references, unions, Drop types, enum downcasts and split subslices", () => {
  // by_ref: `((*_1).0: u8) = const 1_u8`: the `Deref` of `&mut S` stops (no path), the init finds only `Parent(mp1)`
  expect(R.get("by_ref:summary")).toEqual([
    "mp0 = MovePath { place: _0 }",
    "mp1 = MovePath { place: _1 }",
    "in0 = mp1@Argument(_1) (Deep)",
    "in1 = mp0@Statement(bb0[1]) (Deep)",
  ]);
  // un: `(_1.0: u8) = const 1_u8` creates no child path (union) and inits the whole union
  expect(R.get("un:summary")).toEqual([
    "mp0 = MovePath { place: _0 }",
    "mp1 = MovePath { place: _1 }",
    "mo0 = mp1@bb0[1]",
    "in0 = mp1@Argument(_1) (Deep)",
    "in1 = mp1@Statement(bb0[0]) (Deep)",
    "in2 = mp0@Statement(bb0[1]) (Deep)",
  ]);
  // dtor: `(_1.0: S) = move _2` on a type with a destructor: no child path, no init; `drop(_1)` gathers nothing
  expect(R.get("dtor:summary")).toEqual([
    "mp0 = MovePath { place: _0 }",
    "mp1 = MovePath { place: _1 }",
    "mp2 = MovePath { place: _2 }",
    "mp3 = MovePath { place: _3 }",
    "mo0 = mp2@bb0[2]",
    "mo1 = mp2@bb0[3]",
    "mo2 = mp3@bb0[8]",
    "in0 = mp1@Argument(_1) (Deep)",
    "in1 = mp2@Statement(bb0[1]) (Deep)",
    "in2 = mp3@Statement(bb0[5]) (Deep)",
    "in3 = mp0@Statement(bb0[7]) (Deep)",
  ]);
  // downcast: `_3 = move ((_1 as Just).0: S)` creates `(_1 as Just)` then its field
  expect(R.get("downcast:summary")).toEqual([
    "mp0 = MovePath { place: _0 }",
    "mp1 = MovePath { first_child: mp4, place: _1 }",
    "mp2 = MovePath { place: _2 }",
    "mp3 = MovePath { place: _3 }",
    "mp4 = MovePath { parent: mp1, first_child: mp5, place: (_1 as Just) }",
    "mp5 = MovePath { parent: mp4, place: ((_1 as Just).0: S) }",
    "mo0 = mp2@bb0[2]",
    "mo1 = mp5@bb6[1]",
    "mo2 = mp3@bb6[2]",
    "mo3 = mp3@bb6[3]",
    "in0 = mp1@Argument(_1) (Deep)",
    "in1 = mp2@Statement(bb0[1]) (Deep)",
    "in2 = mp0@Statement(bb4[0]) (Deep)",
    "in3 = mp3@Statement(bb6[1]) (Deep)",
    "in4 = mp0@Statement(bb6[2]) (Deep)",
  ]);
  // arr: `_3 = move _1[1..3]` is split into `_1[1 of 3]` and `_1[2 of 3]`, each moved at bb0[4]
  expect(R.get("arr:summary")).toEqual([
    "mp0 = MovePath { place: _0 }",
    "mp1 = MovePath { first_child: mp8, place: _1 }",
    "mp2 = MovePath { place: _2 }",
    "mp3 = MovePath { place: _3 }",
    "mp4 = MovePath { place: _4 }",
    "mp5 = MovePath { place: _5 }",
    "mp6 = MovePath { parent: mp1, place: _1[0 of 3] }",
    "mp7 = MovePath { parent: mp1, next_sibling: mp6 place: _1[1 of 3] }",
    "mp8 = MovePath { parent: mp1, next_sibling: mp7 place: _1[2 of 3] }",
    "mo0 = mp6@bb0[2]",
    "mo1 = mp7@bb0[4]",
    "mo2 = mp8@bb0[4]",
    "mo3 = mp2@bb0[7]",
    "mo4 = mp5@bb0[8]",
    "mo5 = mp5@bb2[0]",
    "mo6 = mp4@bb2[1]",
    "mo7 = mp3@bb2[2]",
    "mo8 = mp3@bb2[3]",
    "mo9 = mp2@bb2[4]",
    "in0 = mp1@Argument(_1) (Deep)",
    "in1 = mp2@Statement(bb0[2]) (Deep)",
    "in2 = mp3@Statement(bb0[4]) (Deep)",
    "in3 = mp5@Statement(bb0[7]) (Deep)",
    "in4 = mp4@Statement(bb0[8]) (NonPanicPathOnly)",
    "in5 = mp0@Statement(bb2[2]) (Deep)",
  ]);
  expect(R.get("arr:display")).toEqual(["_0", "_1", "_2", "_3", "_4", "_5", "_1[0 of 3]", "_1[1 of 3]", "_1[2 of 3]"]);
  // the anonymous consts of the array lengths: one init of the return place
  expect(R.get("arr::{constant#0}:summary")).toEqual(["mp0 = MovePath { place: _0 }", "in0 = mp0@Statement(bb0[0]) (Deep)"]);
});

test("the filter: unfiltered locals and projections get no move path", () => {
  // only `p: P` passes: `_1.1` / `_1.0` have type `S` (filtered) so the moves out of them stop at the filter
  expect(R.get("fields:filtered")).toEqual(["mp0 = MovePath { place: _1 }", "in0 = mp0@Argument(_1) (Deep)"]);
});

test("MovePathLookup::find, MovePath iterators and searches", () => {
  // `_1`, `_1.1`, `_1.1.0` (no path: parent `_1.1`), `_1[_5]` (`Index` stops: parent `_1`)
  expect(R.get("fields:find")).toEqual(["Exact(mp1)", "Exact(mp6)", "Parent(mp6)", "Parent(mp1)"]);
  // `_1[2 of 3]`; `_1[-3 of 3]` (from_end stops); `_1[1..3]` (a subslice is looked up as its parent)
  expect(R.get("arr:find")).toEqual(["Exact(mp8)", "Parent(mp1)", "Parent(mp1)"]);

  const fields = datas.get("fields")!;
  const dbg = (it: Iterable<[MovePathIndex, unknown]>) => [...it].map(([i]) => MovePathIndex.debug(i, PLAIN));
  expect(dbg(fields.move_paths[1]!.children(fields.move_paths))).toEqual(["mp7", "mp6"]);
  expect(dbg(fields.move_paths[6]!.parents(fields.move_paths))).toEqual(["mp1"]);
  expect(dbg(fields.move_paths[1]!.parents(fields.move_paths))).toEqual([]);
  const down = datas.get("downcast")!;
  expect(dbg(down.move_paths[5]!.parents(down.move_paths))).toEqual(["mp4", "mp1"]);
  expect(down.base_local(mp(5))).toBe(Local.new(1));
  expect(down.base_local(mp(3))).toBe(Local.new(3));
  expect(fields.rev_lookup.iter_locals_enumerated().map(([l, m]) => [Local.index(l), MovePathIndex.index(m)])).toEqual([
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 5],
  ]);

  // find_descendant: depth-first over first children, then siblings; `f` is never called on the root
  const arr = datas.get("arr")!;
  const seen: number[] = [];
  expect(arr.move_paths[1]!.find_descendant(arr.move_paths, (m) => (seen.push(m), m === mp(6)))).toBe(mp(6));
  expect(seen).toEqual([8, 7, 6]);
  expect(arr.find_in_move_path_or_its_descendants(mp(1), (m) => m === mp(1))).toBe(mp(1));
  expect(arr.find_in_move_path_or_its_descendants(mp(1), () => false)).toBeUndefined();
  expect(down.find_in_move_path_or_its_descendants(mp(1), (m) => m === mp(5))).toBe(mp(5));
  expect(MoveOutIndex.move_path_index(MoveOutIndex.new(1), arr)).toBe(mp(7));
  expect(MovePathIndex.Atom.index(mp(4))).toBe(4);

  // MoveSubPath::of
  expect(MoveSubPath.of({ $: "OpaqueCast", _0: null }).$).toBe("Skip");
  expect(MoveSubPath.of({ $: "Index", _0: null }).$).toBe("Stop");
  expect(MoveSubPath.of({ $: "Subslice", from: 1, to: 2, from_end: true }).$).toBe("Stop");
  expect(MoveSubPath.of({ $: "ConstantIndex", offset: 4, min_length: 5, from_end: false })).toEqual({ $: "One", _0: { $: "ConstantIndex", _0: 4 } });
  expect(() => MoveSubPath.of({ $: "PhantomDeref" })).toThrow("unexpected PhantomDeref in MoveSubPath::of");

  // a bare lookup table: an untracked local is `Parent(None)`
  const empty = new MovePathLookup([undefined], new Map(), new UnDerefer(new Map()));
  expect(lookup(empty.find(new PlaceRef(Local.new(0), [])))).toBe("Parent(None)");
});

test("drop_flag_effects on built MIR", () => {
  // entry: the argument `p` and all its children (mp1, then its children first-child first)
  expect(R.get("fields:entry")).toEqual(["mp1 Present", "mp7 Present", "mp6 Present"]);
  expect(R.get("fields:effects")).toEqual([
    // bb0[1]: move out of `_1.1`, then the Deep init of `_2`
    ["mp6 Absent", "mp2 Present"],
    // bb0[9]: the call moves `_5`; its NonPanicPathOnly init of `_4` has no effect
    ["mp5 Absent"],
    // bb1[2]: `_0 = move _2`
    ["mp2 Absent", "mp0 Present"],
    // bb1[5]: return
    [],
  ]);
  expect(R.get("fields:lookup_bits")).toEqual([["mp1", "mp7", "mp6"], []]);
  expect(R.get("fields:children_matching")).toEqual([mp(7), undefined]);
  // dtor: `drop(_1)` at bb0[9] counts as a move for the drop flags
  const dtor = datas.get("dtor")!;
  const dbody = bodies.get("dtor")!;
  expect(effects((cb) => drop_flag_effects_for_location(dbody, dtor, loc(0, 9), cb))).toEqual(["mp1 Absent"]);
  expect(effects((cb) => drop_flag_effects_for_location(dbody, dtor, loc(0, 2), cb))).toEqual(["mp2 Absent"]);
  // downcast: `Just` is variant 1, its paths are `(_1 as Just)` (mp4) and its field (mp5)
  expect(R.get("downcast:inactive")).toEqual([["mp4", "mp5"], [], ["mp4", "mp5"], []]);
});

test("CopyForDeref temps: UnDerefer chains, lookups through them, no move for their StorageDead", () => {
  // `_2` (DerefTemp) has no own path; after `_2 = deref_copy (*_1)` it maps to `_1`'s; `StorageDead(_2)` moves nothing
  expect(R.get("dd:summary")).toEqual([
    "mp0 = MovePath { place: _0 }",
    "mp1 = MovePath { place: _1 }",
    "in0 = mp1@Argument(_1) (Deep)",
    "in1 = mp0@Statement(bb0[1]) (Deep)",
  ]);
  expect(R.get("dd:locals")).toEqual(["mp0", "mp1", "mp1"]);
  expect(R.get("dd:chain")).toEqual(["(*_1)"]);
  // `(*_2).0` un-derefed: `*_1`, then `*_2`, then `.0`
  expect(R.get("dd:iter")).toEqual(["_1 Deref", "_2 Deref", "(*_2) Field"]);
  // a bare `_2` still walks its chain (upstream's `debug_assert!(deref_chain.is_empty())` is off in release)
  expect(R.get("dd:find")).toEqual(["Parent(mp1)", "Parent(mp1)"]);
  expect(R.get("dd:filtered")).toEqual(["mp0 = MovePath { place: _1 }", "in0 = mp0@Argument(_1) (Deep)"]);
});

test("DenseLocationMap and debuginfo_locals on built MIR", () => {
  // fields: bb0 has 9 statements + a terminator, bb1 5 + 1, bb2 0 + 1
  const m = DenseLocationMap.new(bodies.get("fields")!);
  expect(m.num_points()).toBe(17);
  expect(m.point_from_location(loc(1, 2))).toBe(PointIndex.new(12));
  expect(m.entry_point(BasicBlock.new(2))).toBe(PointIndex.new(16));
  expect(m.to_block_start(PointIndex.new(14))).toBe(PointIndex.new(10));
  const l = m.to_location(PointIndex.new(12));
  expect([l.block, l.statement_index]).toEqual([BasicBlock.new(1), 2]);
  const t = m.to_location(PointIndex.new(9));
  expect([t.block, t.statement_index]).toEqual([BasicBlock.new(0), 9]);
  expect(m.point_in_range(PointIndex.new(16))).toBe(true);
  expect(m.point_in_range(PointIndex.new(17))).toBe(false);
  expect(() => m.to_location(PointIndex.new(17))).toThrow("assertion failed: index.index() < self.num_points");
  // `debug p => _1; debug x => _2; debug y => _3;`
  expect(R.get("fields:debuginfo")).toEqual([1, 2, 3]);
});
