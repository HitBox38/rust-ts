// Tests of lane dataflow-impls on MIR built by the port (the driver, as rustc_mir_build/builder/contract.test.ts; that
// test checks the built MIR against the pinned rustc's `-Zdump-mir=built`). The bodies of SRC are below each fn as the
// oracle's `-Zdump-mir=built` prints them; the expected states follow from the upstream transfer functions (the
// rustc_peek oracle test, rustc_peek.oracle.test.ts, checks MaybeLiveLocals / Maybe(Un)InitializedPlaces against
// the pinned rustc itself). Covered: MaybeLiveLocals, MaybeTransitiveLiveLocals, MaybeBorrowedLocals /
// borrowed_locals, always_storage_live_locals, MaybeStorageLive / MaybeStorageDead, MaybeRequiresStorage,
// EverInitializedPlaces (+ init_reaches_location), the precise liveness matrix and the `mir_pretty_extra_data` hook.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import "../../rustc_hir_analysis/lib.ts";
import type { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import "../../rustc_middle/lib.ts";
import { BasicBlock, type Body, Location } from "../../rustc_middle/mir/mod.ts";
import { PassWhere } from "../../rustc_middle/mir/pretty.gen.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { VecU8 } from "../../vendor/anstream/stream.ts";
import "../../rustc_mir_build/lib.ts";
import { debuginfo_locals } from "../debuginfo.ts";
import type { ResultsCursor } from "../framework/cursor.ts";
import type { Analysis } from "../framework/mod.ts";
import { MoveData } from "../move_paths/mod.ts";
import { DenseLocationMap } from "../points.ts";
import { mir_pretty_extra_data } from "../pretty.ts";
import { borrowed_locals, MaybeBorrowedLocals } from "./borrowed_locals.ts";
import { EverInitializedPlaces } from "./initialized.ts";
import { MaybeLiveLocals, MaybeTransitiveLiveLocals } from "./liveness.ts";
import { liveness_matrix, SplitPointIndex } from "./precise_liveness.ts";
import { always_storage_live_locals, MaybeRequiresStorage, MaybeStorageDead, MaybeStorageLive } from "./storage_liveness.ts";
import { DenseBitSet as DenseBitSet_ } from "../../rustc_index/bit_set.ts";

const WORK = join(DATA, "tmp", "dataflow-impls", process.env.RUST_TS_AGENT ?? "default");

const SRC = [
  "#![feature(no_core, lang_items, rustc_attrs)]",
  "#![no_core]",
  "#![allow(internal_features, unused)]",
  '#[lang = "pointee_sized"] pub trait PointeeSized {}',
  '#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}',
  '#[lang = "sized"] pub trait Sized: MetaSized {}',
  '#[lang = "copy"] pub trait Copy {}',
  "impl Copy for u8 {}",
  "impl Copy for bool {}",
  "pub fn id(x: u8) -> u8 { x }",
  "#[rustc_mir(rustc_pretty_live_locals, rustc_pretty_transitive_live_locals)]",
  "pub fn dead_store(a: u8, b: u8) -> u8 { let mut x = a; x = b; x }",
  "pub fn dead2(a: u8, b: u8) -> u8 { let mut x: u8; x = a; x = b; x }",
  "pub fn borrow(a: u8) -> u8 { let c = a; let d = &c; *d }",
  "#[rustc_mir(rustc_pretty_precise_liveness)]",
  "pub fn branch(c: bool, a: u8) -> u8 { let x; if c { x = id(a); } else { x = 3; } x }",
].join("\n");

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

/** Runs `f` with the TyCtxt of SRC and its built bodies by fn name. */
function with_bodies(f: (tcx: TyCtxt, bodies: Map<string, Body>) => void): void {
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, "impls.rs");
  writeFileSync(file, SRC);
  let ran = false;
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      const bodies = new Map<string, Body>();
      for (const id of tcx.hir_free_items()) {
        const item = tcx.hir_item(id);
        if (item.kind.$ === "Fn") bodies.set(Symbol.as_str(item.kind.ident.name), tcx.build_mir_inner_impl(item.owner_id.def_id) as Body);
      }
      f(tcx, bodies);
      ran = true;
    });
  });
  expect(ran).toBe(true);
}

const set = (s: DenseBitSet<number>): number[] => [...s.iter()];
const loc = (b: number, i: number) => new Location(BasicBlock.from_u32(b), i);

/** The state after the primary effect of every location of `bb` (in program order), as local numbers. */
function after_each<A extends Analysis<DenseBitSet<number>, unknown>>(cursor: ResultsCursor<DenseBitSet<number>, A>, body: Body, bb: number): number[][] {
  const out: number[][] = [];
  const n = body.basic_blocks.deref()[bb]!.statements.length;
  for (let i = 0; i <= n; i++) {
    cursor.seek_after_primary_effect(loc(bb, i));
    out.push(set(cursor.get()));
  }
  return out;
}

function block_starts<A extends Analysis<DenseBitSet<number>, unknown>>(cursor: ResultsCursor<DenseBitSet<number>, A>, body: Body): number[][] {
  return body.basic_blocks.deref().map((_, bb) => {
    cursor.seek_to_block_start(BasicBlock.from_u32(bb));
    return set(cursor.get());
  });
}

const DUMP = process.env.DUMP === "1";

test("the analyses on built MIR", () => {
  with_bodies((tcx, bodies) => {
    const out: Record<string, unknown> = {};
    // dead_store (bb0): 0 StorageLive(_3); 1 _3 = copy _1; 2 FakeRead(ForLet(None), _3); 3 StorageLive(_4);
    //   4 _4 = copy _2; 5 _3 = move _4; 6 StorageDead(_4); 7 _0 = copy _3; 8 StorageDead(_3); 9 return
    const ds = bodies.get("dead_store")!;
    const live = (b: Body) => new MaybeLiveLocals().iterate_to_fixpoint(tcx, b, undefined).into_results_cursor(b);
    out.dead_store_live = after_each(live(ds), ds, 0);
    out.dead_store_transitive = after_each(
      MaybeTransitiveLiveLocals.new(borrowed_locals(ds), debuginfo_locals(ds)).iterate_to_fixpoint(tcx, ds, undefined).into_results_cursor(ds),
      ds,
      0,
    );
    const d2 = bodies.get("dead2")!;
    out.dead2_live = after_each(live(d2), d2, 0);
    out.dead2_transitive_no_debuginfo = after_each(
      MaybeTransitiveLiveLocals.new(borrowed_locals(d2), DenseBitSet_.new_empty(d2.local_decls.length)).iterate_to_fixpoint(tcx, d2, undefined).into_results_cursor(d2),
      d2,
      0,
    );
    out.dead2_transitive = after_each(
      MaybeTransitiveLiveLocals.new(borrowed_locals(d2), debuginfo_locals(d2)).iterate_to_fixpoint(tcx, d2, undefined).into_results_cursor(d2),
      d2,
      0,
    );
    // borrow (bb0): 0 StorageLive(_2); 1 _2 = copy _1; 2 FakeRead; 3 StorageLive(_3); 4 _3 = &_2; 5 FakeRead;
    //   6 _0 = copy (*_3); 7 StorageDead(_3); 8 StorageDead(_2); 9 return
    const bo = bodies.get("borrow")!;
    out.borrowed_locals = set(borrowed_locals(bo));
    out.borrow_maybe_borrowed = after_each(new MaybeBorrowedLocals().iterate_to_fixpoint(tcx, bo, undefined).into_results_cursor(bo), bo, 0);
    // branch: see the header of the expectations below
    const br = bodies.get("branch")!;
    const always = always_storage_live_locals(br);
    out.always_storage_live = set(always);
    out.branch_storage_live = block_starts(MaybeStorageLive.new(always).iterate_to_fixpoint(tcx, br, undefined).into_results_cursor(br), br);
    out.branch_storage_dead = block_starts(MaybeStorageDead.new(always).iterate_to_fixpoint(tcx, br, undefined).into_results_cursor(br), br);
    const borrowed = new MaybeBorrowedLocals().iterate_to_fixpoint(tcx, br, undefined);
    out.branch_requires_storage = block_starts(MaybeRequiresStorage.new(br, borrowed).iterate_to_fixpoint(tcx, br, undefined).into_results_cursor(br), br);
    const md = MoveData.gather_moves(br, tcx, () => true);
    out.branch_ever_init = block_starts(EverInitializedPlaces.new(br, md).iterate_to_fixpoint(tcx, br, undefined).into_results_cursor(br), br);
    out.branch_live = block_starts(live(br), br);
    // init_reaches_location: the init of _3 in bb4 (`_3 = const 3_u8`) reaches bb5[2] but not bb3[0]
    const init3 = md.inits.find((i) => i.location.$ === "Statement" && i.location._0.block === 4 && md.move_paths[i.path]!.place.local === 3)!;
    out.init_reaches = [
      EverInitializedPlaces.init_reaches_location(br, 3 as never, init3, loc(5, 2)),
      EverInitializedPlaces.init_reaches_location(br, 3 as never, init3, loc(3, 0)),
      EverInitializedPlaces.init_reaches_location(br, 3 as never, init3, loc(5, 4)),
    ];
    // the precise liveness matrix: the locals live at the early / late point of every location of bb0..bb5
    const points = DenseLocationMap.new(br);
    const m = liveness_matrix(tcx, br, points, undefined);
    out.branch_precise = br.basic_blocks.deref().map((d, bb) => {
      const r: string[] = [];
      for (let i = 0; i <= d.statements.length; i++) {
        const p = points.point_from_location(loc(bb, i));
        const at = (e: "Early" | "Late") => [...m.rows()].filter((row) => m.contains(row, SplitPointIndex.new(p, e)));
        r.push(`${at("Early").join(",")}/${at("Late").join(",")}`);
      }
      return r.join(" ");
    });
    // the hook: annotations per location (dead_store: live + transitive live; branch: precise liveness; id: none)
    const hook = (b: Body): string[] => {
      const extra = mir_pretty_extra_data(tcx, b);
      if (extra === undefined) return [];
      const lines: string[] = [];
      for (let bb = 0; bb < b.basic_blocks.deref().length; bb++) {
        for (let i = 0; i <= b.basic_blocks.deref()[bb]!.statements.length; i++) {
          const w = new VecU8();
          extra({ $: "BeforeLocation", _0: loc(bb, i) }, w);
          const text = new TextDecoder().decode(w.bytes());
          if (text !== "") lines.push(`bb${bb}[${i}]: ${text.trimEnd().split("\n").map((l) => l.trim()).join(" | ")}`);
        }
      }
      const w = new VecU8();
      extra(PassWhere.BeforeCFG, w);
      expect(w.bytes().length).toBe(0);
      return lines;
    };
    out.hook_dead_store = hook(ds);
    out.hook_branch = hook(br);
    out.hook_id = hook(bodies.get("id")!);
    if (DUMP) console.log(JSON.stringify(out));
    expect(out).toEqual(EXPECTED);
  });
});

const EXPECTED: Record<string, unknown> = {
  // live-in at each location (backward: the state after the primary effect)
  dead_store_live: [[1, 2], [1, 2], [2, 3], [2], [2], [4], [3], [3], [0], [0]],
  // `x` (_3) is in debuginfo: its stores are never removable, so = MaybeLiveLocals
  dead_store_transitive: [[1, 2], [1, 2], [2, 3], [2], [2], [4], [3], [3], [0], [0]],
  // dead2 (bb0): 0 StorageLive(_3); 1 StorageLive(_4); 2 _4 = copy _1; 3 _3 = move _4; 4 StorageDead(_4); 5 StorageLive(_5); 6 _5 = copy _2; 7 _3 = move _5; 8 StorageDead(_5); 9 _0 = copy _3; 10 StorageDead(_3); 11 return
  dead2_live: [[1, 2], [1, 2], [1, 2], [2, 4], [2], [2], [2], [5], [3], [3], [0], [0]],
  // without debuginfo locals `_3 = move _4` is a dead store, so `_4 = copy _1` is too: `_1` is not live
  dead2_transitive_no_debuginfo: [[2], [2], [2], [2], [2], [2], [2], [5], [3], [3], [0], [0]],
  // with `_3` in debuginfo nothing is removable
  dead2_transitive: [[1, 2], [1, 2], [1, 2], [2, 4], [2], [2], [2], [5], [3], [3], [0], [0]],
  borrowed_locals: [2],
  // `_2` borrowed from `_3 = &_2` to its StorageDead
  borrow_maybe_borrowed: [[], [], [], [], [2], [2], [2], [2], [], []],
  // the return place and the arguments have no storage markers
  always_storage_live: [0, 1, 2],
  // branch: bb0 SL3 SL4 SL5 `_5 = copy _1` switchInt(move _5) -> [0: bb2, otherwise: bb1]; bb1 SL6 SL7 `_7 = copy _2` `_6 = id(move _7)` -> [return: bb3, unwind: bb6]; bb2 goto bb4; bb3 SD7 `_3 = move _6` SD6 `_4 = const ()` goto bb5; bb4 `_3 = const 3_u8` `_4 = const ()` goto bb5; bb5 SD5 SD4 `_0 = copy _3` SD3 return; bb6 (cleanup) resume
  branch_storage_live: [[0, 1, 2], [0, 1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5, 6, 7], [0, 1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5, 6, 7]],
  branch_storage_dead: [[3, 4, 5, 6, 7], [6, 7], [6, 7], [], [6, 7], [6, 7], []],
  // moved-from unborrowed locals die after the move; the call destination needs storage on the return edge only
  branch_requires_storage: [[2], [2], [2], [2, 6], [2], [2, 3, 4], [2]],
  // the call destination is initialized on the return edge only (NonPanicPathOnly); StorageDead kills
  branch_ever_init: [[1, 2], [1, 2, 5], [1, 2, 5], [1, 2, 5, 6, 7], [1, 2, 5], [1, 2, 3, 4, 5], [1, 2, 5, 7]],
  branch_live: [[1, 2], [2], [], [6], [], [3], []],
  // init of _3 in bb4: reaches bb5[2], not bb3[0], not past StorageDead(_3) (bb5[4])
  init_reaches: [true, false, false],
  // per block, `early/late` locals at every location
  branch_precise: ["1,2/1,2 1,2/1,2 1,2/1,2 1,2/2,5 2,5/2", "2/2 2/2 2/7 7/6,7", "/", "6/6 6/3 3/3 3/3,4 3/3", "/3 3/3,4 3/3", "3/3 3/3 3/0 0/0 0/", "/"],
  // `rustc_pretty_live_locals` then `rustc_pretty_transitive_live_locals` (one note each per location)
  hook_dead_store: ["bb0[0]: // live: [_1, _2] | // live: [_1, _2]", "bb0[1]: // live: [_1, _2] | // live: [_1, _2]", "bb0[2]: // live: [_2, _3] | // live: [_2, _3]", "bb0[3]: // live: [_2] | // live: [_2]", "bb0[4]: // live: [_2] | // live: [_2]", "bb0[5]: // live: [_4] | // live: [_4]", "bb0[6]: // live: [_3] | // live: [_3]", "bb0[7]: // live: [_3] | // live: [_3]", "bb0[8]: // live: [_0] | // live: [_0]", "bb0[9]: // live: [_0] | // live: [_0]"],
  // `rustc_pretty_precise_liveness`
  hook_branch: ["bb0[0]: // early: [_1, _2] | // late: [_1, _2]", "bb0[1]: // early: [_1, _2] | // late: [_1, _2]", "bb0[2]: // early: [_1, _2] | // late: [_1, _2]", "bb0[3]: // early: [_1, _2] | // late: [_2, _5]", "bb0[4]: // early: [_2, _5] | // late: [_2]", "bb1[0]: // early: [_2] | // late: [_2]", "bb1[1]: // early: [_2] | // late: [_2]", "bb1[2]: // early: [_2] | // late: [_7]", "bb1[3]: // early: [_7] | // late: [_6, _7]", "bb2[0]: // early: [] | // late: []", "bb3[0]: // early: [_6] | // late: [_6]", "bb3[1]: // early: [_6] | // late: [_3]", "bb3[2]: // early: [_3] | // late: [_3]", "bb3[3]: // early: [_3] | // late: [_3, _4]", "bb3[4]: // early: [_3] | // late: [_3]", "bb4[0]: // early: [] | // late: [_3]", "bb4[1]: // early: [_3] | // late: [_3, _4]", "bb4[2]: // early: [_3] | // late: [_3]", "bb5[0]: // early: [_3] | // late: [_3]", "bb5[1]: // early: [_3] | // late: [_3]", "bb5[2]: // early: [_3] | // late: [_0]", "bb5[3]: // early: [_0] | // late: [_0]", "bb5[4]: // early: [_0] | // late: []", "bb6[0]: // early: [] | // late: []"],
  // no `#[rustc_mir]`: no extra data
  hook_id: [],
};
