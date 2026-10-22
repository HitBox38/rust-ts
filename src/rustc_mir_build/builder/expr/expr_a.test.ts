// Lane mb-expr-a: builder/expr/{as_place, as_operand, as_temp, category, as_constant, stmt}.rs on hand-built `Builder`
// states (MIR building does not run end to end yet: `construct_fn` stops at `scope::Builder::in_scope`, lane mb-scope).
// A `Builder` is made with `Builder::new` (ported) over the THIR of a small no_core fn; locals / `var_indices` are filled
// by hand where `args_and_body` (lane mb-mod) would. Paths that reach another lane's stub check the stop.
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
import { type Local, LocalDecl, Place, Place_from_Local, START_BLOCK, type PlaceElem } from "../../../rustc_middle/mir/mod.ts";
import { debug_Statement, debug_Place } from "../../../rustc_middle/mir/pretty.ts";
import type { ExprId, Thir } from "../../../rustc_middle/thir.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { Ty as TyC } from "../../../rustc_middle/ty/mod.ts";
import { LocalDefId } from "../../../rustc_span/def_id.ts";
import { ErrorGuaranteed } from "../../../rustc_span/lib.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import { Unported } from "../../../std/panic.ts";
import { PLAIN } from "../../../std/fmt.ts";
import "../../lib.ts";
import { Builder } from "../mod.ts";
import {
  PlaceBuilder,
  PlaceBuilder_from_Local,
  convert_to_hir_projections_and_truncate_for_capture,
  is_ancestor_or_same_capture,
} from "./as_place.ts";
import { lit_to_mir_constant } from "./as_constant.ts";
import { Category } from "./category.ts";

const WORK = join(DATA, "tmp", "mb-expr-a", process.env.RUST_TS_AGENT ?? "default");

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

/** Runs `f` with a fresh `Builder` for `pub fn g` of a small no_core crate (args `x: u8`, `y: bool`). */
function with_builder(f: (tcx: TyCtxt, b: Builder, thir: Thir, def: LocalDefId) => void): void {
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, "expr_a.rs");
  writeFileSync(
    file,
    "#![feature(no_core, lang_items)]\n#![no_core]\n#![allow(internal_features)]\n" +
      '#[lang = "pointee_sized"] pub trait PointeeSized {}\n#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}\n#[lang = "sized"] pub trait Sized: MetaSized {}\n' +
      "pub fn g(x: u8, y: bool) -> u8 { if y { x } else { 5 } }\n",
  );
  let ran = false;
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      let def: LocalDefId | undefined;
      for (const id of tcx.hir_free_items()) {
        const item = tcx.hir_item(id);
        if (item.kind.$ === "Fn" && Symbol.as_str(item.kind.ident.name) === "g") def = item.owner_id.def_id;
      }
      if (def === undefined) throw new Error("ERROR: no fn g");
      const r = tcx.thir_body(def) as { $: "Ok"; _0: [Steal<Thir>, ExprId] } | { $: "Err"; _0: ErrorGuaranteed };
      if (r.$ !== "Ok") throw new Error("ERROR: thir_body failed");
      const thir = r._0[0].borrow();
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const span = tcx.def_span(LocalDefId.to_def_id(def));
      const hir_id = tcx.local_def_id_to_hir_id(def);
      const b = Builder.new(thir, infcx, def, hir_id, span, 2, tcx.types.u8, span, undefined);
      f(tcx, b, thir, def);
      ran = true;
    });
  });
  expect(ran).toBe(true);
}

/** The ids of the THIR exprs of `kind`. */
function exprs_of(thir: Thir, kind: string): ExprId[] {
  return thir.exprs.flatMap((e, i) => (e.kind.$ === kind ? [i as ExprId] : []));
}

const stmts = (b: Builder) => b.cfg.basic_blocks[START_BLOCK as unknown as number]!.statements.map((s) => debug_Statement(s, PLAIN));

test("Category::of and the HIR-projection helpers of as_place.rs", () => {
  expect(Category.of({ $: "Scope" } as never)).toBeUndefined();
  expect(Category.of({ $: "VarRef" } as never)).toEqual({ $: "Place" });
  expect(Category.of({ $: "Literal" } as never)).toEqual({ $: "Constant" });
  expect(Category.of({ $: "Call" } as never)).toEqual({ $: "Rvalue", _0: "Into" });
  expect(Category.of({ $: "Binary" } as never)).toEqual({ $: "Rvalue", _0: "AsRvalue" });
  expect(Category.of({ $: "Reborrow" } as never)).toEqual({ $: "Rvalue", _0: "AsRvalue" });
  expect(Category.of({ $: "Become" } as never)).toEqual({ $: "Rvalue", _0: "Into" });

  // Downcast feeds the variant of the next Field; PhantomDeref / OpaqueCast are skipped; Index truncates
  const projs = [
    { $: "Deref" },
    { $: "PhantomDeref" },
    { $: "Downcast", _0: undefined, _1: 2 },
    { $: "Field", _0: 1, _1: undefined },
    { $: "Field", _0: 0, _1: undefined },
    { $: "Index", _0: 3 },
    { $: "Deref" },
  ] as unknown as PlaceElem[];
  const hir = convert_to_hir_projections_and_truncate_for_capture(projs);
  expect(hir as unknown).toEqual([{ $: "Deref" }, { $: "Field", _0: 1, _1: 2 }, { $: "Field", _0: 0, _1: 0 }]);
  expect(is_ancestor_or_same_capture(hir.slice(0, 2), hir)).toBe(true);
  expect(is_ancestor_or_same_capture(hir, hir)).toBe(true);
  expect(is_ancestor_or_same_capture(hir, hir.slice(0, 2))).toBe(false);
  expect(is_ancestor_or_same_capture([{ $: "Field", _0: 1, _1: 0 }] as unknown as typeof hir, hir.slice(1))).toBe(false);
});

test("PlaceBuilder, to_place / try_to_place, unresolvable upvars", () => {
  with_builder((tcx, b, _thir, def) => {
    const local = 1 as Local;
    const pb = PlaceBuilder_from_Local(local).deref().field(0 as never, tcx.types.u8);
    const cl = pb.clone_project({ $: "Index", _0: 2 as Local });
    expect(pb.projection.length).toBe(2);
    expect(cl.projection.length).toBe(3);
    const p = pb.to_place(b);
    expect(p.local).toBe(local);
    expect(p.projection).toBe(tcx.mk_place_elems(pb.projection)); // interned
    expect(debug_Place(cl.to_place(b), PLAIN)).toBe("((*_1).0: u8)[_2]");
    // an upvar with no capture (edition 2024: precise capture) does not resolve
    const up = new PlaceBuilder({ $: "Upvar", var_hir_id: { _0: tcx.local_def_id_to_hir_id(def) }, closure_def_id: def }, []);
    expect(up.try_to_place(b)).toBeUndefined();
    expect(() => up.to_place(b)).toThrow("could not resolve upvar");
  });
});

test("lit_to_mir_constant, as_constant / as_operand of literals", () => {
  with_builder((tcx, b, thir) => {
    const c = lit_to_mir_constant(tcx, { lit: { $: "Int", _0: 300n, _1: { $: "Unsuffixed" } } as never, ty: tcx.types.u8, neg: false });
    expect(c.$).toBe("Val");
    const v = (c as { _0: { $: string; _0: { $: string; _0: unknown } } })._0;
    expect(v.$).toBe("Scalar");
    expect(String((v._0._0 as { to_bits_unchecked(): bigint }).to_bits_unchecked())).toBe("44"); // truncated to u8
    const n = lit_to_mir_constant(tcx, { lit: { $: "Int", _0: 1n, _1: { $: "Unsuffixed" } } as never, ty: tcx.types.i32, neg: true });
    expect(String(((n as { _0: { _0: { _0: { to_bits_unchecked(): bigint } } } })._0._0._0).to_bits_unchecked())).toBe(String(0xffffffffn));
    expect(() => lit_to_mir_constant(tcx, { lit: { $: "Bool", _0: true } as never, ty: tcx.types.u8, neg: false })).toThrow(
      "invalid lit/ty combination in `lit_to_mir_constant`",
    );
    const err = lit_to_mir_constant(tcx, { lit: { $: "Bool", _0: true } as never, ty: TyC.new_error(tcx, ErrorGuaranteed.unchecked_error_guaranteed()), neg: false });
    expect(err.$).toBe("Ty");

    // the `5` of `else { 5 }`: a constant operand without a temporary (u8 needs no drop), no statements
    const [lit] = exprs_of(thir, "Literal");
    const op = b.as_operand(START_BLOCK, { temp_lifetime: undefined, backwards_incompatible: undefined }, lit!, { $: "Boring" }, "Maybe");
    expect(op[0]).toBe(START_BLOCK);
    expect(op[1].$).toBe("Constant");
    expect((op[1] as { _0: { span: unknown; user_ty: unknown; const_: { $: string; _1: unknown } } })._0.const_._1).toBe(tcx.types.u8);
    expect(stmts(b)).toEqual([]);
    // a Scope around it goes through `in_scope` (lane mb-scope)
    const scope = thir.exprs.findIndex((e) => e.kind.$ === "Scope" && (e.kind as { value: ExprId }).value === lit) as ExprId;
    stops(() => b.as_operand(START_BLOCK, { temp_lifetime: undefined, backwards_incompatible: undefined }, scope, { $: "Boring" }, "Maybe"), "rustc_mir_build::builder::scope::Builder::in_scope");
    // `as_local_operand` asks for the local scope first (lane mb-scope)
    stops(() => b.as_local_operand(START_BLOCK, lit!), "rustc_mir_build::builder::scope::Builder::local_scope");
  });
});

test("expr_as_place of a VarRef; as_temp; stmt_expr without a statement scope", () => {
  with_builder((tcx, b, thir) => {
    // args_and_body (lane mb-mod) would declare the argument locals and fill var_indices
    b.local_decls.push(LocalDecl.new(tcx.types.u8, b.fn_span), LocalDecl.new(tcx.types.bool, b.fn_span));
    const refs = exprs_of(thir, "VarRef");
    for (const r of refs) {
      const id = (thir.exprs[r]!.kind as { id: { _0: unknown } }).id;
      const local = (thir.exprs[r]!.ty === tcx.types.u8 ? 1 : 2) as Local;
      b.var_indices.set(id as never, { $: "One", _0: local });
    }
    const x = refs.find((r) => thir.exprs[r]!.ty === tcx.types.u8)!;
    const [blk, place] = b.as_place(START_BLOCK, x);
    expect(blk).toBe(START_BLOCK);
    expect(debug_Place(place, PLAIN)).toBe("_1");
    const [, ro] = b.as_read_only_place(START_BLOCK, x);
    expect(debug_Place(ro, PLAIN)).toBe("_1");

    // as_temp of the literal: a fresh immutable temp, `StorageLive`, then `expr_into_dest` (lane mb-expr-b)
    const [lit] = exprs_of(thir, "Literal");
    const n = b.local_decls.length;
    stops(() => b.as_temp(START_BLOCK, { temp_lifetime: undefined, backwards_incompatible: undefined }, lit!, "Not"), "rustc_mir_build::builder::expr::into::Builder::expr_into_dest");
    expect(b.local_decls.length).toBe(n + 1);
    expect(b.local_decls[n]!.mutability).toBe("Not");
    expect(b.local_decls[n]!.local_info).toEqual({ $: "Set", _0: { $: "Boring" } });
    expect(stmts(b)).toEqual([`StorageLive(_${n})`]);

    // a non-place expression in place context goes through a temp too (its temporary scope is the enclosing one, so
    // the temp's storage is scheduled for drop: lane mb-scope)
    stops(() => b.as_place(START_BLOCK, lit!), "rustc_mir_build::builder::scope::Builder::schedule_drop_storage");

    // the general case of stmt_expr requires a statement scope
    expect(() => b.stmt_expr(START_BLOCK, lit!, undefined)).toThrow("Should not be calling `stmt_expr` on a general expression without a statement scope");
  });
});

test("len_of_slice_or_array, add_fake_borrows_of_base, read_fake_borrows", () => {
  with_builder((tcx, b) => {
    const span = b.fn_span;
    const si = b.source_info(span);
    const arr = b.local_decls.push(LocalDecl.new(TyC.new_array(tcx, tcx.types.u8, 3), span)) - 1;
    const sref = b.local_decls.push(LocalDecl.new(TyC.new_imm_ref(tcx, tcx.lifetimes.re_erased, TyC.new_slice(tcx, tcx.types.u8)), span)) - 1;

    // arrays: the length is the constant of the type, after a `FakeRead(ForIndex, ..)`
    const len = b.len_of_slice_or_array(START_BLOCK, Place_from_Local(arr as Local), span, si);
    expect(len.$).toBe("Constant");
    const k = TyC.new_array(tcx, tcx.types.u8, 3).kind() as { _1: unknown };
    expect((len as { _0: { const_: { $: string; _0: unknown; _1: unknown } } })._0.const_).toEqual({ $: "Ty", _0: tcx.types.usize, _1: k._1 });
    expect(stmts(b)).toEqual([`FakeRead(ForIndex, _${arr})`]);

    // slices behind a `&` (Copy): `PtrMetadata(copy _s)` into a fresh temp (`Builder::temp`, lane mb-mod)
    const deref = new Place(sref as Local, tcx.mk_place_elems([{ $: "Deref" }]));
    stops(() => b.len_of_slice_or_array(START_BLOCK, deref, span, si), "rustc_mir_build::builder::misc::Builder::temp");

    // `*_s` is a slice: one shallow fake borrow of the pointer `_s` (the base of the `Deref`)
    const temps: Local[] = [];
    b.add_fake_borrows_of_base(deref, START_BLOCK, temps, span, si);
    expect(temps).toEqual([(sref + 1) as Local]);
    expect(b.local_decls[sref + 1]!.ty).toBe(TyC.new_imm_ref(tcx, tcx.lifetimes.re_erased, b.local_decls[sref]!.ty));
    // an array base needs none
    b.add_fake_borrows_of_base(Place_from_Local(arr as Local), START_BLOCK, temps, span, si);
    expect(temps.length).toBe(1);
    b.read_fake_borrows(START_BLOCK, temps, si);
    expect(stmts(b)).toEqual([`FakeRead(ForIndex, _${arr})`, `_${sref + 1} = &fake shallow _${sref}`, `FakeRead(ForIndex, _${sref + 1})`]);
  });
});
