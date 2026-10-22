// Tests of lane mb-mod (rustc_mir_build builder/{mod (rest), block, coverageinfo, misc}.rs). Upstream has no unit tests for
// these files and MIR building stops at `scope::Builder::in_scope` (lane mb-scope) end to end, so the methods run on a
// `Builder` made by the ported `Builder::new` for a real fn (`f` below) and on hand-built coverage states; the expected
// values are worked out from upstream's code. Each method that reaches another lane's stub is pinned to that stop.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import type { Steal } from "../../rustc_data_structures/steal.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import "../../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import "../../rustc_middle/lib.ts";
import { Scope as RegionScope, ScopeData } from "../../rustc_middle/middle/region.ts";
import { BlockMarkerId } from "../../rustc_middle/mir/coverage.ts";
import { Local, Place, START_BLOCK } from "../../rustc_middle/mir/mod.ts";
import type { BlockId, Expr, ExprId, Thir } from "../../rustc_middle/thir.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, type ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { Unported } from "../../std/panic.ts";
import "../lib.ts";
import { BlockMarkerGen, CoverageInfoBuilder } from "./coverageinfo.ts";
import { Builder } from "./mod.ts";

const WORK = join(DATA, "tmp", "mb-mod", process.env.RUST_TS_AGENT ?? "default");

function stops(f: () => unknown, what: string): void {
  let err: unknown;
  try {
    f();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Unported);
  expect((err as Unported).what).toBe(what);
}

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

interface Fixture {
  tcx: TyCtxt;
  f: LocalDefId;
  thir: Thir;
  expr: ExprId;
  s_ty: Ty;
  builder(): Builder;
}

/** Runs `body` with the `Builder` that `construct_fn` makes for `f` (a fresh one per `builder()` call). */
function with_fixture(body: (fx: Fixture) => void): void {
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, "mb_mod.rs");
  writeFileSync(
    file,
    "#![feature(no_core, lang_items)]\n#![no_core]\n#![allow(internal_features)]\n" +
      '#[lang = "pointee_sized"] pub trait PointeeSized {}\n#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}\n#[lang = "sized"] pub trait Sized: MetaSized {}\n' +
      '#[lang = "copy"] pub trait Copy {}\n' +
      "pub struct S;\n" +
      "pub fn f(x: u8, y: bool) -> u8 { x }\n",
  );
  let ran = false;
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      let f: LocalDefId | undefined;
      let s: LocalDefId | undefined;
      for (const id of tcx.hir_free_items()) {
        const item = tcx.hir_item(id);
        if (item.kind.$ === "Fn" && Symbol.as_str(item.kind.ident.name) === "f") f = item.owner_id.def_id;
        if (item.kind.$ === "Struct") s = item.owner_id.def_id;
      }
      if (f === undefined || s === undefined) throw new Error("ERROR: no fn f / struct S");
      const s_ty = Unnormalized.skip_normalization(EarlyBinder.instantiate_identity(tcx.type_of(LocalDefId.to_def_id(s)) as EarlyBinder<Ty>));
      const r = tcx.thir_body(f) as { $: "Ok"; _0: [Steal<Thir>, ExprId] } | { $: "Err"; _0: ErrorGuaranteed };
      if (r.$ !== "Ok") throw new Error("ERROR: thir_body failed");
      const [thir_s, expr] = r._0;
      const thir = thir_s.borrow();
      if (thir.body_type.$ !== "Fn") throw new Error("ERROR: not a fn body");
      const sig = thir.body_type._0;
      const fn_def = f;
      const builder = () => {
        const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
        const fn_id = tcx.local_def_id_to_hir_id(fn_def);
        const span = tcx.hir_span_with_body(fn_id);
        return Builder.new(thir, infcx, fn_def, fn_id, span, thir.params.length, FnSig.output(sig), DUMMY_SP, undefined);
      };
      body({ tcx, f, thir, expr, s_ty, builder });
      ran = true;
    });
  });
  expect(ran).toBe(true);
}

test("misc.rs: temp, literal_operand, zero_literal, push_usize, consume_by_copy_or_move; mod.rs get_unit_temp", () => {
  with_fixture(({ tcx, s_ty, builder }) => {
    const b = builder();
    expect(b.local_decls.length).toBe(1);

    // temp: a fresh `LocalDecl` (mutable, outermost scope), `Place::from(local)` without projections
    const t = b.temp(tcx.types.u8, DUMMY_SP);
    expect(t.local).toBe(Local.from_usize(1));
    expect(t.projection.length).toBe(0);
    expect(b.local_decls[1]!.ty).toBe(tcx.types.u8);
    expect(b.local_decls[1]!.mutability).toBe("Mut");

    // literal_operand: `Operand::Constant` without a user type
    const lit = b.literal_operand(DUMMY_SP, { $: "Val", _0: { $: "ZeroSized" }, _1: tcx.types.unit });
    expect(lit.$).toBe("Constant");
    if (lit.$ !== "Constant") throw new Error("unreachable");
    expect(lit._0.user_ty).toBeUndefined();
    expect(lit._0.const_._1).toBe(tcx.types.unit);

    // zero_literal: `Const::from_bits(0)` of the type (a scalar of the type's size)
    const z = b.zero_literal(DUMMY_SP, tcx.types.u8);
    if (z.$ !== "Constant" || z._0.const_.$ !== "Val" || z._0.const_._0.$ !== "Scalar") throw new Error("ERROR: zero_literal shape");
    expect(z._0.const_._1).toBe(tcx.types.u8);

    // push_usize: a usize temp assigned `const value_usize` in `block`
    const p = b.push_usize(START_BLOCK, b.source_info(DUMMY_SP), 7);
    expect(p.local).toBe(Local.from_usize(2));
    expect(b.local_decls[2]!.ty).toBe(tcx.types.usize);
    const stmts = b.cfg.basic_blocks[START_BLOCK]!.statements;
    expect(stmts.length).toBe(1);
    const k = stmts[0]!.kind;
    if (k.$ !== "Assign") throw new Error("ERROR: push_usize did not assign");
    expect(k._0[0]).toBe(p);
    const rv = k._0[1];
    if (rv.$ !== "Use" || rv._0.$ !== "Constant") throw new Error("ERROR: push_usize rvalue shape");
    expect(rv._0._0.const_._1).toBe(tcx.types.usize);

    // consume_by_copy_or_move: `u8` is `Copy` (builtin), `S` is not
    expect(b.consume_by_copy_or_move(t).$).toBe("Copy");
    const s = b.temp(s_ty, DUMMY_SP);
    expect(b.consume_by_copy_or_move(s).$).toBe("Move");

    // get_unit_temp: one `()` temp, created on first use and cached
    const n = b.local_decls.length;
    const u = b.get_unit_temp();
    expect(b.local_decls.length).toBe(n + 1);
    expect(b.local_decls[n]!.ty).toBe(tcx.types.unit);
    expect(b.get_unit_temp()).toBe(u);
    expect(b.local_decls.length).toBe(n + 1);
  });
});

test("mod.rs: args_and_body allocates the arg locals and debuginfo, then stops at schedule_drop_value; insert_upvar_arg on a fn", () => {
  with_fixture(({ tcx, thir, expr, builder }) => {
    // not a closure: no capture-struct local / not a closure type -> no upvars
    const b0 = builder();
    b0.insert_upvar_arg();
    expect(b0.upvars.len()).toBe(0);
    expect(b0.var_debug_info.length).toBe(0);

    const b = builder();
    stops(
      () => b.args_and_body(START_BLOCK, thir.params, new RegionScope(tcx.hir_body_owned_by(b.def_id).id().hir_id.local_id, ScopeData.Arguments), expr),
      "rustc_mir_build::builder::scope::Builder::schedule_drop_value",
    );
    expect(b.local_decls.map((d) => d.ty)).toEqual([tcx.types.u8, tcx.types.u8, tcx.types.bool]);
    expect(b.var_debug_info.map((v) => [Symbol.as_str(v.name), v.argument_index, v.value.$])).toEqual([
      ["x", 1, "Place"],
      ["y", 2, "Place"],
    ]);
    const v0 = b.var_debug_info[0]!.value;
    if (v0.$ !== "Place") throw new Error("unreachable");
    expect(v0._0.local).toBe(Local.arg(0));
    // the debuginfo's `SourceInfo` is a copy, not the `LocalDecl`'s (which args_and_body later re-scopes in place)
    expect(b.var_debug_info[0]!.source_info).not.toBe(b.local_decls[1]!.source_info);
    expect(b.var_debug_info[0]!.source_info.span).toBe(b.local_decls[1]!.source_info.span);

    // set_correct_source_scope_for_arg: reads the lint root of the scope, then `maybe_new_source_scope` (mb-scope)
    const b2 = builder();
    stops(() => b2.set_correct_source_scope_for_arg(tcx.local_def_id_to_hir_id(b2.def_id), b2.source_scope, DUMMY_SP), "rustc_mir_build::builder::scope::Builder::maybe_new_source_scope");
  });
});

test("block.rs: ast_block enters the block's scope (in_scope, lane mb-scope)", () => {
  with_fixture(({ builder }) => {
    const b = builder();
    stops(() => b.ast_block(Place.return_place(), START_BLOCK, 0 as BlockId, b.source_info(DUMMY_SP)), "rustc_mir_build::builder::scope::Builder::in_scope");
  });
});

test("coverageinfo.rs: markers, `!` info, two-way branches, done infos; Builder hooks without coverage", () => {
  with_fixture(({ tcx, builder }) => {
    // BlockMarkerGen: sequential ids; inject_block_marker pushes a `Coverage(BlockMarker)` statement
    const b = builder();
    const gen = new BlockMarkerGen(0);
    expect(gen.next_block_marker_id()).toBe(BlockMarkerId.from_usize(0));
    const id = gen.inject_block_marker(b.cfg, b.source_info(DUMMY_SP), START_BLOCK);
    expect(id).toBe(BlockMarkerId.from_usize(1));
    expect(gen.num_block_markers).toBe(2);
    const st = b.cfg.basic_blocks[START_BLOCK]!.statements[0]!.kind;
    expect(st).toEqual({ $: "Coverage", _0: { $: "BlockMarker", id } });

    // a hand-built THIR: e0 = !e1, e1 = Scope(e2), e2 = !e3, e3 = a `&&` (not visited further)
    const thir = { exprs: [] as Expr[], index_ExprId: (i: ExprId) => thir.exprs[i]! } as unknown as Thir;
    const mk = (kind: unknown) => thir.exprs.push({ kind, ty: tcx.types.bool, temp_scope_id: 0, span: DUMMY_SP } as unknown as Expr);
    mk({ $: "Unary", op: "Not", arg: 1 });
    mk({ $: "Scope", region_scope: new RegionScope(0 as never, ScopeData.Node), hir_id: tcx.local_def_id_to_hir_id(b.def_id), value: 2 });
    mk({ $: "Unary", op: "Not", arg: 3 });
    mk({ $: "LogicalOp", op: "And", lhs: 0, rhs: 0 });

    // without branch coverage, visit_unary_not records nothing
    const cov0 = new CoverageInfoBuilder(new Map(), new BlockMarkerGen(0), undefined);
    cov0.visit_unary_not(thir, 0 as ExprId);
    expect(cov0.nots.size).toBe(0);
    cov0.register_two_way_branch(b.cfg, b.source_info(DUMMY_SP), START_BLOCK, START_BLOCK);
    expect(cov0.into_done()).toEqual({ num_block_markers: 0, branch_spans: [] });

    // with branch coverage: the flip flag alternates under each `!`
    const cov = new CoverageInfoBuilder(new Map(), new BlockMarkerGen(0), { branch_spans: [] });
    cov.visit_unary_not(thir, 0 as ExprId);
    expect([...cov.nots].map(([e, n]): unknown[] => [e, n.enclosing_not, n.is_flipped])).toEqual([
      [0, 0, false],
      [1, 0, true],
      [2, 0, true],
      [3, 0, false],
    ]);
    // an expression already marked by an enclosing `!` keeps its info
    cov.visit_unary_not(thir, 2 as ExprId);
    expect(cov.nots.get(2 as ExprId)).toEqual({ enclosing_not: 0 as ExprId, is_flipped: true });
    // visit_unary_not asserts its argument is a `!`
    expect(() => cov.visit_unary_not(thir, 1 as ExprId)).toThrow("assertion `left matches right` failed");

    // register_two_way_branch: two markers (true, false) and a branch span
    const bb1 = b.cfg.start_new_block();
    const bb2 = b.cfg.start_new_block();
    cov.register_two_way_branch(b.cfg, b.source_info(DUMMY_SP), bb1, bb2);
    expect(b.cfg.basic_blocks[bb1]!.statements[0]!.kind).toEqual({ $: "Coverage", _0: { $: "BlockMarker", id: BlockMarkerId.from_usize(0) } });
    expect(b.cfg.basic_blocks[bb2]!.statements[0]!.kind).toEqual({ $: "Coverage", _0: { $: "BlockMarker", id: BlockMarkerId.from_usize(1) } });
    const done = cov.as_done();
    expect(done.num_block_markers).toBe(2);
    expect(done.branch_spans).toEqual([{ span: DUMMY_SP, true_marker: BlockMarkerId.from_usize(0), false_marker: BlockMarkerId.from_usize(1) }]);
    // as_done copies the spans; into_done moves them
    expect(done.branch_spans[0]).not.toBe(cov.branch_info!.branch_spans[0]);
    expect(cov.into_done().branch_spans[0]).toBe(cov.branch_info!.branch_spans[0]);

    // the Builder hooks do nothing without `-Cinstrument-coverage` / a coverage builder
    const b2 = builder();
    expect(b2.coverage_info).toBeUndefined();
    const n_blocks = b2.cfg.basic_blocks.length;
    const hir_id = tcx.local_def_id_to_hir_id(b2.def_id);
    b2.push_coverage_point_for_expr(START_BLOCK, b2.source_info(DUMMY_SP), hir_id);
    b2.push_coverage_point_for_fn_end(START_BLOCK, b2.source_info(DUMMY_SP), hir_id);
    b2.push_coverage_point_for_implicit_else(START_BLOCK, b2.source_info(DUMMY_SP), thir.exprs[0]!);
    const block = { value: START_BLOCK };
    b2.visit_coverage_standalone_condition(0 as ExprId, Place.return_place(), block);
    b2.visit_coverage_branch_condition(0 as ExprId, START_BLOCK, START_BLOCK);
    expect(block.value).toBe(START_BLOCK);
    expect(b2.cfg.basic_blocks.length).toBe(n_blocks);
    expect(b2.cfg.basic_blocks[START_BLOCK]!.statements.length).toBe(0);
    // push_coverage_point_inner asserts coverage is on
    expect(() => b2.push_coverage_point_inner(START_BLOCK, b2.source_info(DUMMY_SP), "Expr", hir_id)).toThrow("assertion failed: self.tcx.sess.instrument_coverage()");

    // visit_coverage_branch_condition with a coverage builder: the enclosing `!` (flipped: the arms swap)
    b2.coverage_info = new CoverageInfoBuilder(new Map(), new BlockMarkerGen(0), { branch_spans: [] });
    b2.coverage_info.visit_unary_not(thir, 0 as ExprId);
    const t = b2.cfg.start_new_block();
    const f = b2.cfg.start_new_block();
    b2.visit_coverage_branch_condition(1 as ExprId, t, f);
    // flipped: the true marker went to `f`
    expect(b2.cfg.basic_blocks[f]!.statements[0]!.kind).toEqual({ $: "Coverage", _0: { $: "BlockMarker", id: BlockMarkerId.from_usize(0) } });
    expect(b2.cfg.basic_blocks[t]!.statements[0]!.kind).toEqual({ $: "Coverage", _0: { $: "BlockMarker", id: BlockMarkerId.from_usize(1) } });
    // the condition-coverage path needs `Session::instrument_coverage_condition` (rustc_session, not ported)
    stops(() => b2.visit_coverage_standalone_condition(0 as ExprId, Place.return_place(), block), "rustc_session::session::Session::instrument_coverage_condition");
  });
});
