// Port of compiler/rustc_hir/src/hir/tests.rs
//
// PORT: the `transmute`s between `TyKind<'_, ()>` / `ConstArgKind<'_, ()>` and their `AmbigArg` forms are casts in
// TS (the `Unambig` parameter is erased), so these check that the casts keep the value (and that `TaggedRef` keeps its
// tag), as the upstream tests check the layouts.
import { expect, test } from "bun:test";
import { TaggedRef } from "../../rustc_data_structures/tagged_ptr.ts";
import { HirId_INVALID } from "../../rustc_hir_id/lib.ts";
import { DefIndex, LocalDefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { create_default_session_globals_then } from "../../rustc_span/lib.ts";
import { Ident, sym } from "../../rustc_span/symbol.ts";
import { panic } from "../../std/panic.ts";
import type { TraitObjectSyntax } from "../../rustc_ast/lib.ts";
import { type AmbigArg, type AnonConst, ConstArg, type ConstArgKind, Lifetime, Ty, type TyKind } from "../hir.ts";

// macro_rules! define_tests: one test per entry; `matches!` is a check of the variant and its fields.
function define_test<K extends { $: string }>(name: string, unambig: K, check: (k: K) => boolean): void {
  test(name, () => {
    const unambig_to_ambig = unambig as unknown as K; // `transmute::<_, $kind<'_, AmbigArg>>`
    expect(check(unambig_to_ambig)).toBe(true);
    const ambig_to_unambig = unambig_to_ambig as unknown as K; // `transmute::<_, $kind<'_, ()>>`
    expect(check(ambig_to_unambig)).toBe(true);
  });
}

const never = (): Ty => new Ty(HirId_INVALID, DUMMY_SP, { $: "Never" });
const anon = (): AnonConst => ({
  hir_id: HirId_INVALID,
  def_id: LocalDefId.of(DefIndex.ZERO),
  body: { hir_id: HirId_INVALID },
  span: DUMMY_SP,
});

define_test<TyKind>("cast_never", { $: "Never" }, (k) => k.$ === "Never");
{
  const tys = [never()];
  define_test<TyKind>("cast_tup", { $: "Tup", _0: tys }, (k) => k.$ === "Tup" && k._0 === tys);
}
{
  const ty = never();
  define_test<TyKind>("cast_ptr", { $: "Ptr", _0: ty, _1: "Not" }, (k) => k.$ === "Ptr" && k._0 === ty && k._1 === "Not");
}
{
  const ty = never();
  const ct = new ConstArg<null>(HirId_INVALID, { $: "Anon", _0: anon() }, DUMMY_SP);
  define_test<TyKind>("cast_array", { $: "Array", _0: ty, _1: ct }, (k) => k.$ === "Array" && k._0 === ty && k._1 === ct);
}
{
  const a = anon();
  define_test<ConstArgKind>("cast_anon", { $: "Anon", _0: a }, (k) => k.$ === "Anon" && k._0 === a);
}

// rustc: compiler/rustc_hir/src/hir/tests.rs:50 trait_object_roundtrips
test("trait_object_roundtrips", () => {
  create_default_session_globals_then(() => {
    trait_object_roundtrips_impl("Dyn");
    trait_object_roundtrips_impl("None");
  });
});

// rustc: compiler/rustc_hir/src/hir/tests.rs:55 trait_object_roundtrips_impl
function trait_object_roundtrips_impl(syntax: TraitObjectSyntax): void {
  const lt = new Lifetime(HirId_INVALID, Ident.new(sym.name, DUMMY_SP), { $: "Static" }, { $: "Other" }, "Implicit");
  const unambig: TyKind = { $: "TraitObject", _0: [], _1: TaggedRef.new(lt, syntax) };
  const unambig_to_ambig = unambig as unknown as TyKind<AmbigArg>;

  switch (unambig_to_ambig.$) {
    case "TraitObject":
      expect(unambig_to_ambig._1.tag() === syntax).toBe(true);
      break;
    default:
      panic("`TyKind::TraitObject` did not roundtrip");
  }

  const ambig_to_unambig = unambig_to_ambig as unknown as TyKind;

  switch (ambig_to_unambig.$) {
    case "TraitObject":
      expect(ambig_to_unambig._1.tag() === syntax).toBe(true);
      break;
    default:
      panic("`TyKind::TraitObject` did not roundtrip");
  }
}
