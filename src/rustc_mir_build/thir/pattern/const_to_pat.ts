// Port of compiler/rustc_mir_build/src/thir/pattern/const_to_pat.rs: STUB (lane thir-pattern; "How to fill a stub" in
// pattern/mod.ts). The `impl PatCtxt` block of this file (`const_to_pat`) is declared and stubbed here, on the
// prototype of pattern/mod.ts's `PatCtxt`; lib.ts loads this module after mod.ts.
import type { HirId } from "../../../rustc_hir_id/lib.ts";
import type { FieldPat, Pat } from "../../../rustc_middle/thir.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Value } from "../../../rustc_middle/ty/consts/valtree.ts";
import type { Ty, TypingEnv } from "../../../rustc_middle/ty/mod.ts";
import type { DefId } from "../../../rustc_span/def_id.ts";
import type { Span } from "../../../rustc_span/lib.ts";
import type { AliasConst } from "../../../rustc_middle/ty/consts.gen.ts";
import type { Const } from "../../../rustc_type_ir/sty/consts.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { unported } from "../../../std/panic.ts";
import { PatCtxt } from "./mod.ts";

declare module "./mod.ts" {
  interface PatCtxt {
    /// Converts a constant to a pattern (if possible).
    /// This means aggregate values (like structs and enums) are converted
    /// to a pattern that matches the value (as if you'd compared via structural equality).
    ///
    /// Only type system constants are supported, as we are using valtrees
    /// as an intermediate step. Unfortunately those don't carry a type
    /// so we have to carry one ourselves.
    const_to_pat(c: Const, ty: Ty, id: HirId, span: Span): Pat;
  }
}

unported_methods(PatCtxt.prototype, "rustc_mir_build::thir::pattern::const_to_pat::PatCtxt", ["const_to_pat"]);

// rustc-type: compiler/rustc_mir_build/src/thir/pattern/const_to_pat.rs:60 ConstToPat
export class ConstToPat {
  constructor(
    public tcx: TyCtxt,
    public typing_env: TypingEnv,
    public span: Span,
    public id: HirId,

    public c: Const,
  ) {}

  // (const_to_pat.rs:70 new: stub)
  static new(_pat_ctxt: PatCtxt, _id: HirId, _span: Span, _c: Const): ConstToPat {
    return unported("rustc_mir_build::thir::pattern::const_to_pat::ConstToPat::new (lane thir-pattern)");
  }
}

export interface ConstToPat {
  type_marked_structural(ty: Ty): boolean;
  /// We errored. Signal that in the pattern, so that follow up errors can be silenced.
  // PORT: `err: Diag<'_>` (rustc_errors).
  mk_err(err: unknown, ty: Ty): Pat;
  alias_to_pat(alias_const: AliasConst, ty: Ty): Pat;
  lower_field_values_to_fieldpats(values: Iterable<Value>): FieldPat[];
  // Recursive helper for `to_pat`; invoke that (instead of calling this directly).
  valtree_to_pat(value: Value): Pat;
}

unported_methods(ConstToPat.prototype, "rustc_mir_build::thir::pattern::const_to_pat::ConstToPat", [
  "type_marked_structural",
  "mk_err",
  "alias_to_pat",
  "lower_field_values_to_fieldpats",
  "valtree_to_pat",
]);

// (const_to_pat.rs:493 extend_type_not_partial_eq: stub; its local `UsefulDiag` visitor has `visit_ty` at :517)
export function extend_type_not_partial_eq(_tcx: TyCtxt, _typing_env: TypingEnv, _ty: Ty, _err: unknown): void {
  return unported("rustc_mir_build::thir::pattern::const_to_pat::extend_type_not_partial_eq (lane thir-pattern)");
}

// rustc-type: compiler/rustc_mir_build/src/thir/pattern/const_to_pat.rs:600 PartialEqImplStatus
export interface PartialEqImplStatus {
  /// There is a `PartialEq` impl that applies to the type.
  has_impl: boolean;

  /// The `PartialEq` impl is `#[automatically_derived]`.
  is_derived: boolean;
  /// The `DefId` of the same impl that `is_derived` refers to.
  non_blanket_impl: DefId | undefined;

  /// If true, there is a `StructuralPartialEq` implementation,
  /// but its bounds might not be satisfied.
  possibly_inapplicable_structural_partial_eq: boolean;
  /// If true, there is a derived `PartialEq` implementation for the type,
  /// but its bounds might not be satisfied.
  possibly_inapplicable_derived_partial_eq: boolean;
}

// #[instrument(level = "trace", skip(tcx), ret)]
// (const_to_pat.rs:618 type_has_partial_eq_impl: stub)
export function type_has_partial_eq_impl(_tcx: TyCtxt, _typing_env: TypingEnv, _ty: Ty): PartialEqImplStatus {
  return unported("rustc_mir_build::thir::pattern::const_to_pat::type_has_partial_eq_impl (lane thir-pattern)");
}
