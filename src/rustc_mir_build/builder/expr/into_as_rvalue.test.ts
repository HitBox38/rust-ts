// Unit tests of lane mb-expr-b (builder/expr/{into, as_rvalue}.rs) on a `Builder` made by `Builder::new` for a small
// no_core fn (end to end, the built MIR is compared with the oracle's in builder/contract.test.ts). Everything runs the
// real code; what needs a scope runs inside `in_scope` of the fn's call-site scope (as `construct_fn` does), and the
// arguments are declared by hand where `args_and_body` would:
// - `is_let`, the `Let` ICE, `as_rvalue(ThreadLocalRef)`, `as_local_rvalue`, `expr_into_dest` of the fn body;
// - `build_binary_op`: the unchecked arm, the overflow-checked `Add`, signed `Div` (zero check, then the `MIN / -1`
//   check), unsigned `Rem`; the literals `minval_literal` / `neg_1_literal`.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../../scripts/lib/common.ts";
import type { Crate } from "../../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../../rustc_driver_impl/lib.ts";
import "../../../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../../rustc_interface/passes.ts";
import type { Steal } from "../../../rustc_data_structures/steal.ts";
import "../../../rustc_middle/lib.ts";
import { type AssertMessage, type BasicBlock, type ConstOperand, LocalDecl, type Operand, Place, Place_from_Local, type Local, START_BLOCK } from "../../../rustc_middle/mir/mod.ts";
import { debug_Statement } from "../../../rustc_middle/mir/pretty.ts";
import { Scope as RegionScope, ScopeData } from "../../../rustc_middle/middle/region.ts";
import type { Expr, ExprId, Thir } from "../../../rustc_middle/thir.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { LocalDefId } from "../../../rustc_span/def_id.ts";
import type { FieldIdx } from "../../../rustc_abi/lib.ts";
import { DUMMY_SP, type ErrorGuaranteed } from "../../../rustc_span/lib.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import { FnSig } from "../../../rustc_type_ir/ty_kind.ts";
import { PLAIN } from "../../../std/fmt.ts";
import "../../lib.ts";
import { BlockAnd, Builder, unit } from "../mod.ts";
import { LintLevel } from "../scope.gen.ts";

const WORK = join(DATA, "tmp", "mb-expr-b", process.env.RUST_TS_AGENT ?? "default");

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

/** Runs `f` with the `Builder` that `construct_fn` creates for the fn `name` of `src` (no_core). */
function with_builder(src: string, name: string, f: (tcx: TyCtxt, builder: Builder, body_expr: ExprId) => void): void {
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, `${name}.rs`);
  writeFileSync(
    file,
    "#![feature(no_core, lang_items)]\n#![no_core]\n#![allow(internal_features)]\n" +
      '#[lang = "pointee_sized"] pub trait PointeeSized {}\n#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}\n#[lang = "sized"] pub trait Sized: MetaSized {}\n' +
      '#[lang = "copy"] pub trait Copy {}\n' +
      src,
  );
  let ran = false;
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      let def: LocalDefId | undefined;
      for (const id of tcx.hir_free_items()) {
        const item = tcx.hir_item(id);
        if (item.kind.$ === "Fn" && Symbol.as_str(item.kind.ident.name) === name) def = item.owner_id.def_id;
      }
      if (def === undefined) throw new Error(`ERROR: no fn ${name}`);
      const r = tcx.thir_body(def) as { $: "Ok"; _0: [Steal<Thir>, ExprId] } | { $: "Err"; _0: ErrorGuaranteed };
      if (r.$ !== "Ok") throw new Error("ERROR: thir_body failed");
      const [thir, expr] = r._0;
      const thir_ = thir.borrow();
      if (thir_.body_type.$ !== "Fn") throw new Error("ERROR: not a fn body");
      const sig = thir_.body_type._0;
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const fn_id = tcx.local_def_id_to_hir_id(def);
      const span = tcx.hir_span_with_body(fn_id);
      const builder = Builder.new(thir_, infcx, def, fn_id, span, thir_.params.length, FnSig.output(sig), DUMMY_SP, undefined);
      // the arguments, as `args_and_body` declares them (`var_indices` of the params' bindings)
      for (const param of thir_.params) builder.local_decls.push(LocalDecl.new(param.ty, span));
      for (const e of thir_.exprs) {
        if (e.kind.$ === "VarRef") builder.var_indices.set(e.kind.id, { $: "One", _0: (thir_.params.findIndex((p) => p.ty === e.ty) + 1) as Local });
      }
      f(tcx, builder, expr);
      ran = true;
    });
  });
  expect(ran).toBe(true);
}

/** Runs `f` inside `in_scope` of the fn's call-site scope (as `construct_fn`), returning its block. */
function in_fn_scope(tcx: TyCtxt, builder: Builder, f: () => BasicBlock): BasicBlock {
  const body = tcx.hir_body_owned_by(builder.def_id);
  const call_site_scope = new RegionScope(body.id().hir_id.local_id, ScopeData.CallSite);
  const [block] = builder.in_scope([call_site_scope, builder.source_info(builder.fn_span)], LintLevel.Inherited, () => unit(f()));
  return block;
}

/** The `Assert` terminators of the blocks, in block order: `[block, expected, msg, target]`. */
function asserts(builder: Builder): [BasicBlock, boolean, AssertMessage, BasicBlock][] {
  const out: [BasicBlock, boolean, AssertMessage, BasicBlock][] = [];
  builder.cfg.basic_blocks.forEach((bb, i) => {
    const k = bb.terminator?.kind;
    if (k?.$ === "Assert") out.push([i as BasicBlock, k.expected, k.msg, k.target]);
  });
  return out;
}

/** Pushes a synthetic THIR expression and returns its id. */
function push_expr(builder: Builder, e: Expr): ExprId {
  builder.thir.exprs.push(e);
  return (builder.thir.exprs.length - 1) as ExprId;
}

const SRC = "pub fn f(x: u8, y: bool) -> u8 { x }\npub fn g(a: i8, b: i8) -> i8 { a }\n";

test("is_let, the Let ICE, as_rvalue / as_local_rvalue(ThreadLocalRef), expr_into_dest of the fn body", () => {
  with_builder(SRC, "f", (tcx, builder, body_expr) => {
    const body = builder.thir.index_ExprId(body_expr);
    expect(body.kind.$).toBe("Scope");
    expect(builder.is_let(body_expr)).toBe(false);

    // `Scope { Let }` is a `let` (looked through the scope)
    const span = body.span;
    const let_ = push_expr(builder, { kind: { $: "Let", expr: body_expr, pat: undefined as never }, ty: tcx.types.bool, temp_scope_id: body.temp_scope_id, span });
    const scope_kind = body.kind as Extract<Expr["kind"], { $: "Scope" }>;
    const scoped = push_expr(builder, { kind: { ...scope_kind, value: let_ }, ty: tcx.types.bool, temp_scope_id: body.temp_scope_id, span });
    expect(builder.is_let(let_)).toBe(true);
    expect(builder.is_let(scoped)).toBe(true);

    // a `let` outside `if` / match guard is an ICE (span_bug)
    expect(() => builder.expr_into_dest(Place.return_place(), START_BLOCK, let_)).toThrow("unexpected let expression outside of if or match-guard");

    // `ThreadLocalRef` becomes `Rvalue::ThreadLocalRef` without new blocks
    const did = LocalDefId.to_def_id(builder.def_id);
    const tlr = push_expr(builder, { kind: { $: "ThreadLocalRef", _0: did }, ty: tcx.types.u8, temp_scope_id: body.temp_scope_id, span });
    const scope = { temp_lifetime: undefined, backwards_incompatible: undefined };
    expect(builder.as_rvalue(START_BLOCK, scope, tlr)).toEqual([START_BLOCK, { $: "ThreadLocalRef", _0: did }]);

    // `as_local_rvalue` (needs the local scope): `ThreadLocalRef` is local, so the same rvalue
    in_fn_scope(tcx, builder, () => {
      expect(builder.as_local_rvalue(START_BLOCK, tlr)).toEqual([START_BLOCK, { $: "ThreadLocalRef", _0: did }]);
      return START_BLOCK;
    });

    // the fn body `{ x }` into the return place: `_0 = copy _1`, in the start block
    builder.block_context._0.length = 0;
    const end = in_fn_scope(tcx, builder, () => BlockAnd.into_block(builder.expr_into_dest(Place.return_place(), START_BLOCK, body_expr)));
    expect(end).toBe(START_BLOCK);
    const st = builder.cfg.basic_blocks[START_BLOCK]!.statements.map((s) => debug_Statement(s, PLAIN));
    expect(st).toEqual(["_0 = copy _1"]);
  });
});

test("build_binary_op: unchecked arm, overflow-checked Add, Div / Rem checks; minval / neg_1 literals", () => {
  with_builder(SRC, "g", (tcx, builder) => {
    const span = builder.fn_span;
    const a = Place_from_Local(1 as Local);
    const b = Place_from_Local(2 as Local);
    const lhs: Operand = { $: "Copy", _0: a };
    const rhs: Operand = { $: "Copy", _0: b };
    const i8 = tcx.types.i8;

    // an operator without checks is a plain `BinaryOp`
    expect(builder.build_binary_op(START_BLOCK, "BitAnd", span, i8, lhs, rhs)).toEqual([START_BLOCK, { $: "BinaryOp", _0: "BitAnd", _1: [lhs, rhs] }]);
    // `Add` without overflow checks too
    const check_overflow = builder.check_overflow;
    builder.check_overflow = false;
    expect(builder.build_binary_op(START_BLOCK, "Add", span, i8, lhs, rhs)).toEqual([START_BLOCK, { $: "BinaryOp", _0: "Add", _1: [lhs, rhs] }]);

    in_fn_scope(tcx, builder, () => {
      // `Add` with overflow checks: `tmp = AddWithOverflow(lhs, rhs); assert(!move tmp.1, Overflow); move tmp.0`
      builder.check_overflow = true;
      const n_locals = builder.local_decls.length;
      const start_stmts = builder.cfg.basic_blocks[START_BLOCK]!.statements.length;
      const [block, rvalue] = builder.build_binary_op(START_BLOCK, "Add", span, i8, lhs, rhs);
      expect(builder.local_decls.length).toBe(n_locals + 1);
      expect(builder.local_decls[n_locals]!.ty).toBe(tcx.mk_ty_from_kind({ $: "Tuple", _0: tcx.mk_type_list([i8, tcx.types.bool]) }));
      const stmt = builder.cfg.basic_blocks[START_BLOCK]!.statements[start_stmts]!;
      expect(debug_Statement(stmt, PLAIN)).toBe(`_${n_locals} = AddWithOverflow(copy _1, copy _2)`);
      const [a0] = asserts(builder);
      expect(asserts(builder).length).toBe(1);
      const [ablock, expected, msg, target] = a0!;
      expect(ablock).toBe(START_BLOCK);
      expect(expected).toBe(false);
      expect(msg).toEqual({ $: "Overflow", _0: "Add", _1: lhs, _2: rhs });
      const k = builder.cfg.basic_blocks[START_BLOCK]!.terminator!.kind;
      if (k.$ !== "Assert") throw new Error("ERROR: no Assert");
      expect(k.cond).toEqual({ $: "Move", _0: new Place(n_locals as Local, tcx.mk_place_elems([{ $: "Field", _0: 1 as FieldIdx, _1: tcx.types.bool }])) });
      expect(block).toBe(target);
      expect(rvalue).toEqual({ $: "Use", _0: { $: "Move", _0: new Place(n_locals as Local, tcx.mk_place_elems([{ $: "Field", _0: 0 as FieldIdx, _1: i8 }])) }, _1: "Yes" });

      // signed `Div`: `rhs == 0` check, then `(rhs == -1) & (lhs == MIN)` check
      const before = asserts(builder).length;
      const [, div] = builder.build_binary_op(block, "Div", span, i8, lhs, rhs);
      expect(div).toEqual({ $: "BinaryOp", _0: "Div", _1: [lhs, rhs] });
      const divs = asserts(builder).slice(before);
      expect(divs.map(([, expected, msg]) => [expected, msg.$])).toEqual([
        [false, "DivisionByZero"],
        [false, "Overflow"],
      ]);
      const after_zero = divs[1]![0];
      const ops = builder.cfg.basic_blocks[after_zero]!.statements.map((s) => (s.kind as { _0: [Place, { _0: string }] })._0[1]._0);
      expect(ops).toEqual(["Eq", "Eq", "BitAnd"]);
      // unsigned `Rem`: only the `rhs == 0` check
      const before_rem = asserts(builder).length;
      const [rem_end] = builder.build_binary_op(divs[1]![3], "Rem", span, tcx.types.u8, lhs, rhs);
      expect(asserts(builder).slice(before_rem).map(([, , msg]) => msg.$)).toEqual(["RemainderByZero"]);

      // `minval_literal` / `neg_1_literal` of `i8`: bits 0x80 / 0xff
      const bits = (op: Operand) => {
        const c = (op as { _0: ConstOperand })._0.const_ as { $: "Val"; _0: { $: "Scalar"; _0: { $: "Int"; _0: { data: bigint } } } };
        return c._0._0._0.data;
      };
      expect(bits(builder.minval_literal(span, i8))).toBe(0x80n);
      expect(bits(builder.neg_1_literal(span, i8))).toBe(0xffn);
      return rem_end;
    });
    builder.check_overflow = check_overflow;
  });
});
