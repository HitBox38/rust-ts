// Unit tests of lane hir-types for the hand-written parts of src/rustc_hir/hir.ts (expectations follow the upstream
// code of compiler/rustc_hir/src/hir.rs cited per test; the Debug/StableHash output of whole owners is checked
// against the oracle in hir.oracle.test.ts).
import { expect, test } from "bun:test";
import { HirId_INVALID } from "../rustc_hir_id/lib.ts";
import { create_default_session_globals_then, DUMMY_SP } from "../rustc_span/lib.ts";
import { sym, Symbol } from "../rustc_span/symbol.ts";
import { format_debug, PLAIN, PRETTY } from "../std/fmt.ts";
import {
  BodyOwnerKind,
  CoroutineKind,
  ConstContext,
  Constness,
  debug_DotDotPos,
  debug_FnDeclFlags,
  Defaultness,
  display_Constness,
  display_CoroutineKind,
  display_LoopIdError,
  display_RangeEnd,
  display_Safety,
  DotDotPos,
  Expr,
  FnDecl,
  FnDeclFlags,
  GenericArgs,
  Generics,
  MatchSource,
  OwnerNodes,
  PrimTy,
  Safety,
  Ty,
} from "./hir.ts";

test("FnDeclFlags: default, setters by value, accessors, Debug (hir.rs:3765-3916)", () => {
  const d = FnDeclFlags.default_();
  expect([d.flags, d.splatted]).toEqual([0, 0xff]);
  expect(format_debug(d, debug_FnDeclFlags, PLAIN)).toBe('FnDeclFlags("ImplicitSelfKind(None)", "NoLifetimeElision")');
  const e = d.set_lifetime_elision_allowed(true).set_c_variadic(true).set_implicit_self("RefMut");
  // `mut self` setters work on a copy
  expect(d.flags).toBe(0);
  expect([e.implicit_self(), e.lifetime_elision_allowed(), e.c_variadic(), e.splatted_()]).toEqual(["RefMut", true, true, undefined]);
  const r = e.set_splatted(1, 2);
  if (r.$ !== "Ok") throw new Error("set_splatted failed");
  expect(r._0.splatted_()).toBe(1);
  expect(format_debug(r._0, debug_FnDeclFlags, PLAIN)).toBe('FnDeclFlags("ImplicitSelfKind(RefMut)", "LifetimeElisionAllowed", "CVariadic", "Splatted(1)")');
  expect(e.set_splatted(255, 300)).toEqual({ $: "Err", _0: { $: "InvalidIndex", splatted_arg_index: 255 } });
  expect(e.set_splatted(3, 70000)).toEqual({ $: "Ok", _0: expect.anything() });
  expect(e.set_splatted(3, 3)).toEqual({ $: "Err", _0: { $: "OutOfBounds", splatted_arg_index: 3, args_len: 3 } });
  expect(e.set_splatted(undefined, 0)).toEqual({ $: "Ok", _0: expect.objectContaining({ splatted: 0xff }) });
  expect(e.set_c_variadic(false).c_variadic()).toBe(false);
  expect(e.set_implicit_self("None").implicit_self()).toBe("None");
  const dummy = FnDecl.dummy(DUMMY_SP);
  expect([dummy.lifetime_elision_allowed(), dummy.c_variadic(), dummy.implicit_self(), dummy.splatted()]).toEqual([true, false, "None", undefined]);
});

test("DotDotPos: new / as_opt_usize / Debug as Option<usize> (hir.rs:1707-1726)", () => {
  expect(DotDotPos.new(undefined).as_opt_usize()).toBeUndefined();
  expect(DotDotPos.new(2).as_opt_usize()).toBe(2);
  expect(format_debug(DotDotPos.new(undefined), debug_DotDotPos, PLAIN)).toBe("None");
  expect(format_debug(DotDotPos.new(2), debug_DotDotPos, PLAIN)).toBe("Some(2)");
  expect(format_debug(DotDotPos.new(2), debug_DotDotPos, PRETTY)).toBe("Some(\n    2,\n)");
  expect(() => DotDotPos.new(0xffff_ffff)).toThrow("assertion failed");
});

test("PrimTy: ALL / name_str / name / from_name round trip (hir.rs:3331-3405)", () => {
  create_default_session_globals_then(() => {
    expect(PrimTy.ALL.length).toBe(19);
    for (const p of PrimTy.ALL) {
      expect(PrimTy.from_name(PrimTy.name(p))).toEqual(p);
      expect(Symbol.as_str(PrimTy.name(p))).toBe(PrimTy.name_str(p));
    }
    expect(PrimTy.ALL.map((p) => PrimTy.name_str(p)).join(" ")).toBe(
      "i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f16 f32 f64 f128 bool char str",
    );
    expect(PrimTy.from_name(sym.Option)).toBeUndefined();
  });
});

test("enum helpers and Display impls", () => {
  expect([Safety.prefix_str("Unsafe"), Safety.is_unsafe("Unsafe"), Safety.is_safe("Safe"), display_Safety("Safe")]).toEqual(["unsafe ", true, true, "safe"]);
  expect([display_Constness({ $: "Const", always: true }), display_Constness(Constness.default()), display_Constness({ $: "NotConst" })]).toEqual([
    "comptime",
    "const",
    "non-const",
  ]);
  expect([Defaultness.has_value({ $: "Default", has_value: false }), Defaultness.is_final(Defaultness.default())]).toEqual([false, true]);
  const asyncfn: CoroutineKind = { $: "Desugared", _0: "Async", _1: "Fn" };
  expect([display_CoroutineKind(asyncfn), display_CoroutineKind(asyncfn, true), CoroutineKind.to_plural_string(asyncfn)]).toEqual([
    "async fn body",
    "`async` fn body",
    "`async` fn bodies",
  ]);
  expect([CoroutineKind.movability(asyncfn), CoroutineKind.movability({ $: "Coroutine", _0: "Movable" }), CoroutineKind.is_fn_like(asyncfn)]).toEqual([
    "Static",
    "Movable",
    true,
  ]);
  expect(display_CoroutineKind({ $: "Coroutine", _0: "Static" })).toBe("coroutine");
  expect([ConstContext.keyword_name({ $: "Static", _0: "Mut" }), BodyOwnerKind.is_fn_or_closure({ $: "Const", inline: false })]).toEqual(["static mut", false]);
  expect([MatchSource.name({ $: "TryDesugar", _0: HirId_INVALID }), display_RangeEnd("Included"), display_LoopIdError("UnresolvedLabel")]).toEqual([
    "?",
    "..=",
    "label not found",
  ]);
});

test("statics: GenericArgs::NONE, Generics::empty, OwnerNodes::synthetic (hir.rs:666, :921, :1342)", () => {
  expect([GenericArgs.NONE.args.length, GenericArgs.NONE.parenthesized, GenericArgs.NONE.span_ext_()]).toEqual([0, "No", undefined]);
  expect(Generics.empty()).toBe(Generics.empty());
  const syn = OwnerNodes.synthetic();
  expect(syn.node()).toEqual({ $: "Synthetic" });
  expect(syn.nodes.length).toBe(1);
});

test("Expr: precedence / peel_* / can_have_side_effects (hir.rs:2227-2530)", () => {
  const unit = new Expr(HirId_INVALID, { $: "Tup", _0: [] }, DUMMY_SP);
  const temps = new Expr(HirId_INVALID, { $: "DropTemps", _0: unit }, DUMMY_SP);
  expect(temps.peel_drop_temps()).toBe(unit);
  expect(temps.precedence(() => false)).toBe("Unambiguous");
  expect(temps.precedence(() => true)).toBe("Prefix");
  expect(new Expr(HirId_INVALID, { $: "Ret", _0: undefined }, DUMMY_SP).precedence(() => true)).toBe("Jump");
  expect(unit.can_have_side_effects()).toBe(false);
  expect(new Expr(HirId_INVALID, { $: "Ret", _0: undefined }, DUMMY_SP).can_have_side_effects()).toBe(true);
  const ty = new Ty<null>(HirId_INVALID, DUMMY_SP, { $: "Infer", _0: null });
  expect(ty.try_as_ambig_ty()).toBeUndefined();
  expect(ty.is_suggestable_infer_ty()).toBe(true);
});
