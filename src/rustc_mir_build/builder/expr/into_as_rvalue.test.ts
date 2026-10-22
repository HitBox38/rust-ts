// Unit tests of lane mb-expr-b (builder/expr/{into, as_rvalue}.rs). MIR building is not reachable end to end yet (the
// first stub on every fn body is `scope::Builder::in_scope`, lane mb-scope), so these tests take the real `Builder` that
// `construct_fn` creates (capturing it at its first `in_scope` call) and run the ported fns on it directly:
// - paths that need only ported code run for real (`is_let`, `build_binary_op`'s unchecked arm, `ThreadLocalRef`, the
//   `Let` ICE, `minval_literal` / `neg_1_literal` with `literal_operand`);
// - the overflow-checked arms of `build_binary_op` and the literals run with test stand-ins for the collaborators still
//   stubbed (`misc::{temp, literal_operand, zero_literal}` / `scope::assert`, lanes mb-mod / mb-scope; the misc ones are
//   upstream's bodies), installed only for the test and restored after;
// - the other paths are pinned at the stub they stop at (move the pin when that lane lands).
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
import { type AssertMessage, type BasicBlock, Const, ConstOperand, LocalDecl, type Operand, Place, Place_from_Local, type Local, START_BLOCK } from "../../../rustc_middle/mir/mod.ts";
import type { Expr, ExprId, Thir } from "../../../rustc_middle/thir.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Ty } from "../../../rustc_middle/ty/mod.ts";
import { LocalDefId } from "../../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../../rustc_span/lib.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { Unported } from "../../../std/panic.ts";
import "../../lib.ts";
import { Builder, construct_fn } from "../mod.ts";

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

class CaptureBuilder extends Error {
  constructor(readonly builder: Builder) {
    super("captured");
  }
}

/** Runs `f` with the `Builder` that `construct_fn` creates for the fn `name` of `src` (no_core). */
function with_builder(src: string, name: string, f: (tcx: TyCtxt, builder: Builder, body_expr: ExprId) => void): void {
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, `${name}.rs`);
  writeFileSync(
    file,
    "#![feature(no_core, lang_items)]\n#![no_core]\n#![allow(internal_features)]\n" +
      '#[lang = "pointee_sized"] pub trait PointeeSized {}\n#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}\n#[lang = "sized"] pub trait Sized: MetaSized {}\n' +
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
      // `construct_fn` builds the `Builder`, then calls `in_scope` on it first: capture it there.
      const in_scope = Builder.prototype.in_scope;
      let builder: Builder | undefined;
      Builder.prototype.in_scope = function (this: Builder) {
        throw new CaptureBuilder(this);
      };
      try {
        construct_fn(tcx, def, thir_, expr, sig);
      } catch (e) {
        if (!(e instanceof CaptureBuilder)) throw e;
        builder = e.builder;
      } finally {
        Builder.prototype.in_scope = in_scope;
      }
      if (builder === undefined) throw new Error("ERROR: no builder");
      f(tcx, builder, expr);
      ran = true;
    });
  });
  expect(ran).toBe(true);
}

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

/** Pushes a synthetic THIR expression and returns its id. */
function push_expr(builder: Builder, e: Expr): ExprId {
  builder.thir.exprs.push(e);
  return (builder.thir.exprs.length - 1) as ExprId;
}

/** Runs `f` with `temp` / `assert` / `literal_operand` / `zero_literal` replaced by stand-ins (`assert` records). */
function with_stand_ins(f: (asserts: [BasicBlock, Operand, boolean, AssertMessage, Span][]) => void): void {
  const temp = Builder.prototype.temp;
  const assert = Builder.prototype.assert;
  const literal_operand = Builder.prototype.literal_operand;
  const zero_literal = Builder.prototype.zero_literal;
  Builder.prototype.literal_operand = function (this: Builder, span: Span, const_: Const): Operand {
    return { $: "Constant", _0: new ConstOperand(span, undefined, const_) };
  };
  Builder.prototype.zero_literal = function (this: Builder, span: Span, ty: Ty): Operand {
    return this.literal_operand(span, Const.from_bits(this.tcx, 0n, this.typing_env(), ty));
  };
  const asserts: [BasicBlock, Operand, boolean, AssertMessage, Span][] = [];
  Builder.prototype.temp = function (this: Builder, ty: Ty, span: Span): Place {
    const local = (this.local_decls.push(LocalDecl.new(ty, span)) - 1) as Local;
    return Place_from_Local(local);
  };
  Builder.prototype.assert = function (this: Builder, block: BasicBlock, cond: Operand, expected: boolean, msg: AssertMessage, span: Span): BasicBlock {
    asserts.push([block, cond, expected, msg, span]);
    return this.cfg.start_new_block();
  };
  try {
    f(asserts);
  } finally {
    Builder.prototype.temp = temp;
    Builder.prototype.assert = assert;
    Builder.prototype.literal_operand = literal_operand;
    Builder.prototype.zero_literal = zero_literal;
  }
}

const SRC = "pub fn f(x: u8, y: bool) -> u8 { x }\npub fn g(a: i8, b: i8) -> i8 { a }\n";

test("is_let, as_rvalue(ThreadLocalRef), the Let ICE, and the stubs the other paths stop at", () => {
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

    // the fn body (`Scope`) stops at `in_scope` (lane mb-scope), in both modes
    builder.block_context._0.length = 0;
    stops(() => builder.expr_into_dest(Place.return_place(), START_BLOCK, body_expr), "rustc_mir_build::builder::scope::Builder::in_scope");
    stops(() => builder.as_rvalue(START_BLOCK, scope, body_expr), "rustc_mir_build::builder::scope::Builder::in_scope");
    // `as_local_rvalue` stops at `local_scope` (lane mb-scope)
    stops(() => builder.as_local_rvalue(START_BLOCK, tlr), "rustc_mir_build::builder::scope::Builder::local_scope");
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

    with_stand_ins((asserts) => {
      // `Add` with overflow checks: `tmp = AddWithOverflow(lhs, rhs); assert(!move tmp.1, Overflow); move tmp.0`
      builder.check_overflow = true;
      const n_locals = builder.local_decls.length;
      const start_stmts = builder.cfg.basic_blocks[START_BLOCK]!.statements.length;
      const [block, rvalue] = builder.build_binary_op(START_BLOCK, "Add", span, i8, lhs, rhs);
      expect(builder.local_decls.length).toBe(n_locals + 1);
      expect(builder.local_decls[n_locals]!.ty).toBe(tcx.mk_ty_from_kind({ $: "Tuple", _0: tcx.mk_type_list([i8, tcx.types.bool]) }));
      const stmt = builder.cfg.basic_blocks[START_BLOCK]!.statements[start_stmts]!;
      expect(stmt.kind.$).toBe("Assign");
      const [dest, rv] = (stmt.kind as { _0: [Place, { $: string; _0: string }] })._0;
      expect(dest.local).toBe(n_locals as Local);
      expect([rv.$, rv._0]).toEqual(["BinaryOp", "AddWithOverflow"]);
      expect(asserts.length).toBe(1);
      const [ablock, cond, expected, msg] = asserts[0]!;
      expect(ablock).toBe(START_BLOCK);
      expect(expected).toBe(false);
      expect(msg).toEqual({ $: "Overflow", _0: "Add", _1: lhs, _2: rhs });
      expect(cond.$).toBe("Move");
      expect(block).not.toBe(START_BLOCK);
      expect(rvalue.$).toBe("Use");

      // signed `Div`: `rhs == 0` check, then `(rhs == -1) & (lhs == MIN)` check
      asserts.length = 0;
      const [, div] = builder.build_binary_op(START_BLOCK, "Div", span, i8, lhs, rhs);
      expect(div).toEqual({ $: "BinaryOp", _0: "Div", _1: [lhs, rhs] });
      expect(asserts.map(([, , expected, msg]) => [expected, msg.$])).toEqual([
        [false, "DivisionByZero"],
        [false, "Overflow"],
      ]);
      const after_zero = asserts[1]![0];
      const ops = builder.cfg.basic_blocks[after_zero]!.statements.map((s) => (s.kind as { _0: [Place, { _0: string }] })._0[1]._0);
      expect(ops).toEqual(["Eq", "Eq", "BitAnd"]);
      // unsigned `Rem`: only the `rhs == 0` check
      asserts.length = 0;
      builder.build_binary_op(START_BLOCK, "Rem", span, tcx.types.u8, lhs, rhs);
      expect(asserts.map(([, , , msg]) => msg.$)).toEqual(["RemainderByZero"]);

      // `minval_literal` / `neg_1_literal` of `i8`: bits 0x80 / 0xff
      const bits = (op: Operand) => {
        const c = (op as { _0: ConstOperand })._0.const_ as { $: "Val"; _0: { $: "Scalar"; _0: { $: "Int"; _0: { data: bigint } } } };
        return c._0._0._0.data;
      };
      expect(bits(builder.minval_literal(span, i8))).toBe(0x80n);
      expect(bits(builder.neg_1_literal(span, i8))).toBe(0xffn);
    });
    builder.check_overflow = check_overflow;

    // without the stand-ins, the literals stop at `literal_operand` (lane mb-mod)
    stops(() => builder.minval_literal(span, i8), "rustc_mir_build::builder::misc::Builder::literal_operand");
  });
});
