// Tests of lane mir-body-a (rustc_middle mir/{mod, traversal, query, coverage}.rs). Upstream has no unit tests for these
// files; the expected values below are worked out from upstream's semantics (the traversal orders follow the doc comments
// of traversal.rs, whose `traverse_successor` example is checked verbatim).
// The hand-built blocks end in real terminators: `return` (no successor), `goto` (one), `falseEdge` (two, in the
// order real, imaginary: terminator.rs `successors`).
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { dominators } from "../../rustc_data_structures/graph/dominators/mod.ts";
import type { ControlFlowGraph } from "../../rustc_data_structures/graph/mod.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import type { HirId } from "../../rustc_hir_id/lib.ts";
import { BitMatrix } from "../../rustc_index/bit_set.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import { MetadataDecodeContext } from "../../rustc_metadata/rmeta/decoder.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";
import { Panic, Unported } from "../../std/panic.ts";
import "../lib.ts";
import type { TyDecoder } from "../ty/codec.ts";
import type { Instance } from "../ty/decls.ts";
import { Ty } from "../ty/mod.ts";
import { BlockMarkerId, CounterId, CoverageKind, debug_CovTerm, debug_CoverageKind, ExpressionId, Op } from "./coverage.ts";
import {
  BasicBlock,
  BasicBlockData,
  Body,
  ClearCrossCrate,
  CoroutineInfo,
  decode_ClearCrossCrate,
  DefLocation,
  Local,
  LocalDecl,
  type LocalInfo,
  Location,
  MirPhase,
  MirSource,
  OUTERMOST_SOURCE_SCOPE,
  SourceInfo,
  SourceScope,
  SourceScopeData,
  START_BLOCK,
  Terminator,
  TerminatorKind,
  traversal,
} from "./mod.ts";
import { type CoroutineLayout, CoroutineSavedLocal, debug_CoroutineLayout } from "./query.ts";

const bb = (n: number): BasicBlock => BasicBlock.from_u32(n);

/** A block whose terminator's successors are `succs` (see the header). */
function block(succs: number[]): BasicBlockData {
  const kind: TerminatorKind =
    succs.length === 0
      ? TerminatorKind.Return
      : succs.length === 1
        ? TerminatorKind.goto(bb(succs[0]!))
        : { $: "FalseEdge", real_target: bb(succs[0]!), imaginary_target: bb(succs[1]!) };
  if (succs.length > 2) throw new Error("ERROR: test: at most two successors");
  return BasicBlockData.new(new Terminator(SourceInfo.outermost(DUMMY_SP), kind), false);
}
function cfg(succs: number[][]): Body {
  return Body.new_cfg_only(succs.map(block));
}
const ids = (xs: Iterable<BasicBlock>): number[] => [...xs].map(Number);
const firsts = (xs: Iterable<readonly [BasicBlock, BasicBlockData]>): number[] => [...xs].map(([b]) => Number(b));

// A -> {B, C}, B -> D, C -> D (the doc graph of Preorder / Postorder / reverse_postorder)
const DIAMOND = [[1, 2], [3], [3], []];
// traverse_successor's example: A -> {B, C}, B -> E, C -> D, D -> E
const DOC = [[1, 2], [4], [3], [4], []];
// a self loop, and bb3 unreachable (back edge into bb0)
const LOOP = [[1], [2, 1], [], [0]];

test("preorder / postorder / reverse_postorder of hand-built bodies", () => {
  const d = cfg(DIAMOND);
  // Preorder pops the last successor first: A C D B (the doc's second order)
  expect(firsts(traversal.preorder(d))).toEqual([0, 2, 3, 1]);
  // Postorder walks the successors from the back: D C B A
  expect(ids(traversal.Postorder.new(d.basic_blocks.deref(), START_BLOCK, undefined))).toEqual([3, 2, 1, 0]);
  expect(firsts(traversal.postorder(d))).toEqual([3, 2, 1, 0]);
  // reverse postorder: A B C D (cached on the blocks)
  expect(firsts(traversal.reverse_postorder(d))).toEqual([0, 1, 2, 3]);
  expect(ids(d.basic_blocks.reverse_postorder())).toEqual([0, 1, 2, 3]);
  expect(d.basic_blocks.reverse_postorder()).toBe(d.basic_blocks.reverse_postorder());

  const doc = cfg(DOC);
  // "for a final traversal of [E, D, C, B, A]"
  expect(ids(traversal.Postorder.new(doc.basic_blocks.deref(), START_BLOCK, undefined))).toEqual([4, 3, 2, 1, 0]);
  expect(firsts(traversal.preorder(doc))).toEqual([0, 2, 3, 4, 1]);
  expect(firsts(traversal.reverse_postorder(doc))).toEqual([0, 1, 2, 3, 4]);

  const l = cfg(LOOP);
  expect(firsts(traversal.preorder(l))).toEqual([0, 1, 2]);
  expect(firsts(traversal.postorder(l))).toEqual([2, 1, 0]);
  expect(ids(traversal.reachable_as_bitset(l).iter())).toEqual([0, 1, 2]);
  expect(firsts(traversal.reachable(l))).toEqual([0, 1, 2]);
  // a non-start root
  expect(firsts(traversal.Preorder.new(l, bb(3)))).toEqual([3, 0, 1, 2]);
  expect(ids(traversal.Postorder.new(l.basic_blocks.deref(), bb(3), undefined))).toEqual([2, 1, 0, 3]);
});

test("size_hint and iterator protocol", () => {
  const l = cfg(LOOP);
  const pre = traversal.preorder(l);
  expect(pre.size_hint()).toEqual([0, 4]);
  const po = traversal.Postorder.new(l.basic_blocks.deref(), START_BLOCK, undefined);
  // the stack holds bb0, bb1, bb2 after the first descent
  expect(po.size_hint()).toEqual([3, 4]);
  expect(po.next()).toEqual({ done: false, value: bb(2) });
  expect(po.size_hint()).toEqual([2, 4]);
  po.next();
  po.next();
  expect(po.next().done).toBe(true);
});

test("mono_reachable (no SwitchInt: every successor) and mono_reachable_reverse_postorder", () => {
  const tcx = null as never;
  const instance = null as never;
  // the worklist is a bit set: lowest index first
  expect(firsts(traversal.mono_reachable(cfg(DIAMOND), tcx, instance))).toEqual([0, 1, 2, 3]);
  expect(firsts(traversal.mono_reachable(cfg(DOC), tcx, instance))).toEqual([0, 1, 2, 3, 4]);
  expect(ids(traversal.mono_reachable_as_bitset(cfg(LOOP), tcx, instance).iter())).toEqual([0, 1, 2]);
  expect(traversal.mono_reachable_reverse_postorder(cfg(DOC), tcx, instance).map(Number)).toEqual([0, 1, 2, 3, 4]);
  expect(traversal.mono_reachable_reverse_postorder(cfg(LOOP), tcx, instance).map(Number)).toEqual([0, 1, 2]);
});

test("Location: successor_within_block, is_predecessor_of, dominates; DefLocation::dominates", () => {
  const d = cfg(DIAMOND);
  const loc = (b: number, i: number): Location => new Location(bb(b), i);
  expect(loc(1, 4).successor_within_block()).toEqual(loc(1, 5));
  expect(BasicBlock.start_location(bb(2))).toEqual(loc(2, 0));
  expect(loc(3, 0).is_predecessor_of(loc(3, 1), d)).toBe(true);
  expect(loc(1, 9).is_predecessor_of(loc(3, 0), d)).toBe(true);
  expect(loc(0, 9).is_predecessor_of(loc(3, 0), d)).toBe(true);
  expect(loc(3, 0).is_predecessor_of(loc(1, 0), d)).toBe(false);
  expect(loc(2, 0).is_predecessor_of(loc(1, 0), d)).toBe(false);
  // bb1 loops on itself: it precedes its own earlier statements
  const l = cfg(LOOP);
  expect(loc(1, 3).is_predecessor_of(loc(1, 0), l)).toBe(true);
  expect(loc(2, 0).is_predecessor_of(loc(1, 0), l)).toBe(false);

  const doms = dominators(d.basic_blocks as unknown as ControlFlowGraph<BasicBlock>);
  expect(loc(0, 5).dominates(loc(3, 0), doms)).toBe(true);
  expect(loc(1, 0).dominates(loc(3, 0), doms)).toBe(false);
  expect(loc(1, 2).dominates(loc(1, 2), doms)).toBe(true);
  expect(loc(1, 3).dominates(loc(1, 2), doms)).toBe(false);
  expect(loc(0, 0).strictly_dominates(loc(3, 0), doms)).toBe(true);
  expect(loc(0, 0).strictly_dominates(loc(0, 1), doms)).toBe(false);

  expect(DefLocation.dominates(DefLocation.Argument, loc(3, 0), doms)).toBe(true);
  expect(DefLocation.dominates({ $: "Assignment", _0: loc(0, 0) }, loc(3, 0), doms)).toBe(true);
  expect(DefLocation.dominates({ $: "Assignment", _0: loc(3, 1) }, loc(3, 1), doms)).toBe(false);
  expect(DefLocation.dominates({ $: "CallReturn", call: bb(0), target: bb(1) }, loc(1, 0), doms)).toBe(true);
  expect(DefLocation.dominates({ $: "CallReturn", call: bb(0), target: bb(1) }, loc(3, 0), doms)).toBe(false);
  expect(DefLocation.dominates({ $: "CallReturn", call: bb(0), target: undefined }, loc(0, 0), doms)).toBe(false);
});

test("Body::new_cfg_only, index / index_mut, stmt_at, terminator_loc, source_info, BasicBlockData", () => {
  const d = cfg(DIAMOND);
  expect(d.phase).toBe(MirPhase.Built);
  expect(d.is_polymorphic).toBe(false);
  expect(d.local_decls).toEqual([]);
  expect(d.index(bb(2))).toBe(d.basic_blocks.deref()[2]!);
  const cache = d.basic_blocks.cache;
  expect(d.index(bb(2))).toBe(d.index_mut(bb(2)));
  expect(d.basic_blocks.cache).not.toBe(cache); // `index_mut` goes through `as_mut()`
  expect(d.terminator_loc(bb(1))).toEqual(new Location(bb(1), 0));
  const at = d.stmt_at(new Location(bb(1), 0));
  expect(at.$).toBe("Right");
  expect(at._0).toBe(d.index(bb(1)).terminator!);
  expect(d.source_info(new Location(bb(1), 0))).toBe(d.index(bb(1)).terminator!.source_info);
  expect(() => d.source_info(new Location(bb(1), 1))).toThrow(Panic);

  const empty = BasicBlockData.new(undefined, true);
  expect(empty.statements).toEqual([]);
  expect(empty.is_cleanup).toBe(true);
  expect(empty.after_last_stmt_debuginfos._0).toBeUndefined();
  expect(() => empty.terminator_()).toThrow("invalid terminator state");
  expect(() => empty.terminator_mut()).toThrow("invalid terminator state");
  expect(BasicBlockData.new(new Terminator(SourceInfo.outermost(DUMMY_SP), { $: "Unreachable" }), false).is_empty_unreachable()).toBe(true);
  expect(BasicBlockData.new(new Terminator(SourceInfo.outermost(DUMMY_SP), { $: "Return" }), false).is_empty_unreachable()).toBe(false);
  // not a `SwitchInt`: no constant to evaluate
  expect(Body.try_const_mono_switchint(null as never, null as never, d.index(bb(0)))).toBeUndefined();
});

test("Body accessors: coroutine fields, injection phase, required consts / mentioned items", () => {
  const d = cfg([[]]);
  expect(d.yield_ty()).toBeUndefined();
  expect(d.coroutine_kind()).toBeUndefined();
  expect(d.coroutine_requires_async_drop()).toBe(false);
  expect(d.should_skip()).toBe(false);
  expect(d.is_custom_mir()).toBe(false);
  const drop_body = cfg([[]]);
  const info = CoroutineInfo.initial({ $: "Coroutine", _0: "Movable" } as never, "Y" as never, "R" as never);
  expect([info.yield_ty, info.resume_ty, info.coroutine_drop, info.coroutine_layout]).toEqual(["Y", "R", undefined, undefined] as never);
  d.coroutine = info;
  expect(d.yield_ty()).toBe("Y" as never);
  expect(d.resume_ty()).toBe("R" as never);
  expect(d.future_drop_poll()).toBeUndefined();
  info.coroutine_drop_proxy_async = drop_body;
  expect(d.future_drop_poll()).toBe(drop_body);
  expect(d.coroutine_requires_async_drop()).toBe(false);
  info.coroutine_drop_async = d;
  expect(d.future_drop_poll()).toBe(d);
  expect(d.coroutine_requires_async_drop()).toBe(true);

  // `injection_phase > phase` (derived PartialOrd: variant, then phase)
  d.injection_phase = { $: "Analysis", _0: "PostCleanup" };
  expect(d.is_custom_mir()).toBe(true);
  expect(d.should_skip()).toBe(true);
  d.phase = { $: "Analysis", _0: "PostCleanup" };
  expect(d.should_skip()).toBe(false);
  d.phase = { $: "Analysis", _0: "Initial" };
  expect(d.should_skip()).toBe(true);
  d.phase = { $: "Runtime", _0: "Initial" };
  expect(d.should_skip()).toBe(false);

  d.set_required_consts([]);
  expect(d.required_consts_()).toEqual([]);
  d.set_mentioned_items([]);
  expect(d.mentioned_items_()).toEqual([]);
});

test("MirPhase::name / index", () => {
  const phases: MirPhase[] = [
    MirPhase.Built,
    { $: "Analysis", _0: "Initial" },
    { $: "Analysis", _0: "PostCleanup" },
    { $: "Runtime", _0: "Initial" },
    { $: "Runtime", _0: "PostCleanup" },
    { $: "Runtime", _0: "Optimized" },
  ];
  expect(phases.map((p) => MirPhase.name(p))).toEqual(["built", "analysis", "analysis-post-cleanup", "runtime", "runtime-post-cleanup", "runtime-optimized"]);
  expect(phases.map((p) => MirPhase.index(p))).toEqual([[1, 1], [2, 1], [2, 2], [3, 1], [3, 2], [3, 3]]);
});

test("ClearCrossCrate, its Decodable, Local::arg, SourceInfo::outermost, MirSource", () => {
  const set: ClearCrossCrate<number> = { $: "Set", _0: 7 };
  expect(ClearCrossCrate.as_ref(set)).toEqual(set);
  expect(ClearCrossCrate.as_mut(ClearCrossCrate.Clear)).toBe(ClearCrossCrate.Clear);
  expect(ClearCrossCrate.unwrap_crate_local(set)).toBe(7);
  expect(() => ClearCrossCrate.unwrap_crate_local(ClearCrossCrate.Clear)).toThrow();
  // rmeta's decoder clears cross-crate data without reading anything
  const md = Object.create(MetadataDecodeContext.prototype) as TyDecoder;
  expect(decode_ClearCrossCrate(md, () => 1)).toBe(ClearCrossCrate.Clear);
  expect(() => decode_ClearCrossCrate({} as TyDecoder, () => 1)).toThrow(Unported);

  expect(Number(Local.arg(0))).toBe(1);
  expect(Number(Local.arg(2))).toBe(3);
  const si = SourceInfo.outermost(DUMMY_SP);
  expect(si.scope).toBe(OUTERMOST_SOURCE_SCOPE);
  const src = MirSource.item("D" as never);
  expect(src.instance).toEqual({ $: "Item", _0: "D" } as never);
  expect(src.promoted).toBeUndefined();
  expect(MirSource.from_shim("S" as never).instance).toEqual({ $: "Shim", _0: "S" } as never);
});

test("LocalDecl predicates", () => {
  const with_info = (info: LocalInfo): LocalDecl => {
    const decl = LocalDecl.new("T" as never, DUMMY_SP);
    decl.local_info = { $: "Set", _0: info };
    return decl;
  };
  const decl = LocalDecl.new("T" as never, DUMMY_SP);
  expect(decl.mutability).toBe("Mut");
  expect(decl.local_info_().$).toBe("Boring");
  expect(decl.source_info.scope).toBe(OUTERMOST_SOURCE_SCOPE);
  expect(decl.user_ty).toBeUndefined();
  expect(decl.is_user_variable()).toBe(false);
  expect(decl.immutable()).toBe(decl);
  expect(decl.mutability).toBe("Not");

  const var_ = (by_ref: "No" | "Yes"): LocalInfo => ({
    $: "User",
    _0: {
      $: "Var",
      _0: {
        binding_mode: { _0: by_ref === "No" ? { $: "No" } : { $: "Yes", _0: "Not", _1: "Not" }, _1: "Not" } as never,
        opt_ty_info: undefined,
        opt_match_place: undefined,
        pat_span: DUMMY_SP,
        introductions: [],
      },
    },
  });
  expect(with_info(var_("No")).can_be_made_mutable()).toBe(true);
  expect(with_info(var_("No")).is_nonref_binding()).toBe(true);
  expect(with_info(var_("Yes")).can_be_made_mutable()).toBe(false);
  expect(with_info(var_("Yes")).is_nonref_binding()).toBe(false);
  expect(with_info(var_("Yes")).is_user_variable()).toBe(true);
  expect(with_info({ $: "User", _0: { $: "ImplicitSelf", _0: "Imm" } }).can_be_made_mutable()).toBe(true);
  expect(with_info({ $: "User", _0: { $: "ImplicitSelf", _0: "RefImm" } }).can_be_made_mutable()).toBe(false);
  expect(with_info({ $: "User", _0: { $: "ImplicitSelf", _0: "RefImm" } }).is_nonref_binding()).toBe(true);
  expect(with_info({ $: "User", _0: { $: "RefForGuard", _0: Local.from_u32(1) } }).is_ref_for_guard()).toBe(true);
  const st = with_info({ $: "StaticRef", def_id: "D" as never, is_thread_local: true });
  expect([st.is_ref_to_static(), st.is_ref_to_thread_local(), st.is_deref_temp()]).toEqual([true, true, false]);
  expect(with_info({ $: "DerefTemp" }).is_deref_temp()).toBe(true);
  expect(with_info({ $: "DerefTemp" }).is_ref_to_thread_local()).toBe(false);
  const cleared = LocalDecl.new("T" as never, DUMMY_SP);
  cleared.local_info = ClearCrossCrate.Clear;
  expect(() => cleared.local_info_()).toThrow();
});

test("SourceScope::lint_root / inlined_instance", () => {
  const h0 = { owner: 0, local_id: 0 } as unknown as HirId;
  const inst = { def: "I" } as unknown as Instance;
  const scope = (parent: number | undefined, inlined: boolean, inlined_parent: number | undefined, lint: HirId | undefined): SourceScopeData =>
    new SourceScopeData(
      DUMMY_SP,
      parent === undefined ? undefined : SourceScope.from_u32(parent),
      inlined ? [inst, DUMMY_SP] : undefined,
      inlined_parent === undefined ? undefined : SourceScope.from_u32(inlined_parent),
      lint === undefined ? ClearCrossCrate.Clear : { $: "Set", _0: { lint_root: lint } },
    );
  // scope[0] root, scope[1] inlined into 0, scope[2] child of 1 (not inlined itself), scope[3] cross-crate
  const scopes = [scope(undefined, false, undefined, h0), scope(0, true, undefined, undefined), scope(1, false, 1, undefined), scope(undefined, false, undefined, undefined)];
  const s = SourceScope.from_u32;
  expect(SourceScope.lint_root(s(0), scopes)).toBe(h0);
  expect(SourceScope.lint_root(s(1), scopes)).toBe(h0);
  expect(SourceScope.lint_root(s(3), scopes)).toBeUndefined();
  expect(SourceScope.inlined_instance(s(0), scopes)).toBeUndefined();
  expect(SourceScope.inlined_instance(s(1), scopes)).toBe(inst);
  expect(SourceScope.inlined_instance(s(2), scopes)).toBe(inst);
});

test("query.rs: CoroutineLayout Debug", () => {
  const layout: CoroutineLayout = {
    field_tys: [],
    variant_fields: [[], [], [], [CoroutineSavedLocal.from_u32(0)], [CoroutineSavedLocal.from_u32(0), CoroutineSavedLocal.from_u32(1)]],
    variant_source_info: [],
    storage_conflicts: BitMatrix.new(0, 0),
  };
  expect(debug_CoroutineLayout(layout, PLAIN)).toBe(
    "CoroutineLayout { field_tys: {}, variant_fields: {Unresumed: [], Returned: [], Panicked: [], Suspend0: [_s0], Suspend1: [_s0, _s1]}, storage_conflicts: BitMatrix(0x0) {} }",
  );
  // the shape of the `coroutine_layout` comments of upstream's mir-opt outputs (padded names, one-line fields)
  expect(format_debug(layout, debug_CoroutineLayout, PRETTY)).toBe(
    [
      "CoroutineLayout {",
      "    field_tys: {},",
      "    variant_fields: {",
      "        Unresumed(0): [],",
      "        Returned (1): [],",
      "        Panicked (2): [],",
      "        Suspend0 (3): [_s0],",
      "        Suspend1 (4): [_s0, _s1],",
      "    },",
      "    storage_conflicts: BitMatrix(0x0) {},",
      "}",
    ].join("\n"),
  );
});

test("coverage.rs: CovTerm / CoverageKind Debug, is_removed_after_analysis, Op", () => {
  expect(debug_CovTerm({ $: "Zero" }, PLAIN)).toBe("Zero");
  expect(debug_CovTerm({ $: "Counter", _0: CounterId.from_u32(3) }, PLAIN)).toBe("Counter(3)");
  expect(debug_CovTerm({ $: "Expression", _0: ExpressionId.from_u32(4) }, PRETTY)).toBe("Expression(\n    4,\n)");
  const marker: CoverageKind = { $: "BlockMarker", id: BlockMarkerId.from_u32(2) };
  expect(debug_CoverageKind(marker, PRETTY)).toBe("BlockMarker(2)");
  expect(debug_CoverageKind({ $: "VirtualCounter", bcb: 5 as never }, PLAIN)).toBe("VirtualCounter(bcb5)");
  expect(CoverageKind.is_removed_after_analysis(marker)).toBe(true);
  expect(CoverageKind.is_removed_after_analysis({ $: "VirtualCounter", bcb: 5 as never })).toBe(false);
  expect([Op.is_add("Add"), Op.is_subtract("Add"), Op.is_add("Subtract"), Op.is_subtract("Subtract")]).toEqual([true, false, false, true]);
});

// ---- with a real TyCtxt (types for LocalDecls) ----
const WORK = join(DATA, "tmp", "mir-body-a", process.env.RUST_TS_AGENT ?? "default");
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

test("Body::new: locals, args, return type, is_polymorphic", () => {
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, "mir_body_a.rs");
  writeFileSync(file, "#![feature(no_core)]\n#![no_core]\npub fn f() {}\n");
  let ran = false;
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      const t = tcx.types;
      const blocks = (): BasicBlockData[] => [block([])];
      const user_var = (ty: Ty): LocalDecl => {
        const decl = LocalDecl.new(ty, DUMMY_SP);
        decl.local_info = { $: "Set", _0: { $: "User", _0: { $: "ImplicitSelf", _0: "Imm" } } };
        return decl;
      };
      // _0: return, _1 _2: args (_2 a mutable user binding), _3: immutable user var, _4: mutable user var, _5: temp
      const decls = [LocalDecl.new(t.unit, DUMMY_SP), LocalDecl.new(t.i32, DUMMY_SP), user_var(t.bool), user_var(t.u8).immutable(), user_var(t.u8), LocalDecl.new(t.i32, DUMMY_SP)];
      const body = Body.new(MirSource.item("D" as never), blocks(), [], decls, [], 2, [], DUMMY_SP, undefined, undefined);
      expect(body.is_polymorphic).toBe(false);
      expect(body.phase).toBe(MirPhase.Built);
      expect(body.spread_arg).toBeUndefined();
      expect(body.return_ty()).toBe(t.unit);
      expect(body.bound_return_ty(tcx).value).toBe(t.unit);
      expect([0, 1, 2, 3, 5].map((i) => body.local_kind(Local.from_u32(i)))).toEqual(["ReturnPointer", "Arg", "Arg", "Temp", "Temp"]);
      expect(body.args_iter().map(Number)).toEqual([1, 2]);
      expect(body.vars_and_temps_iter().map(Number)).toEqual([3, 4, 5]);
      expect([...body.mut_vars_iter()].map(Number)).toEqual([4]);
      expect([...body.mut_vars_and_args_iter()].map(Number)).toEqual([1, 2, 4]);
      expect([...body.drain_vars_and_temps()].map((d) => d.ty)).toEqual([t.u8, t.u8, t.i32]);
      expect(body.local_decls.length).toBe(3);

      // a type parameter makes the body polymorphic
      const param = Ty.new_param(tcx, 0, Symbol.intern("T"));
      const poly = Body.new(MirSource.item("D" as never), blocks(), [], [LocalDecl.new(param, DUMMY_SP)], [], 0, [], DUMMY_SP, undefined, undefined);
      expect(poly.is_polymorphic).toBe(true);
      expect(() => Body.new(MirSource.item("D" as never), blocks(), [], [LocalDecl.new(t.unit, DUMMY_SP)], [], 1, [], DUMMY_SP, undefined, undefined)).toThrow(
        "expected at least 2 locals, got 1",
      );
      ran = true;
    });
  });
  expect(ran).toBe(true);
}, 120000);
