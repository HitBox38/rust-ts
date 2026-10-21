// Port of compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs (lane errrep-traits-a; contract stub of lane errctxt-contract).
//
// How to fill this stub (docs/handoff/errctxt-contract.md "How to fill a stub"):
// - Every fn of this file is declared in src/rustc_trait_selection/decls.ts under `// error_reporting/traits/mod.rs:<line>`:
//   `interface TypeErrCtxt` (methods), `NiceRegionError` (methods / statics), `Fns_<module>` (free fns) or a comment-only
//   declaration (trait impls, helper types: pick the TS form). Do not change a real signature; write a needed change in
//   your handoff (or a local `declare module` marked `// PORT(decls): pending root`).
// - Methods: in upstream order, `TypeErrCtxt.prototype.<name> = function (this: TypeErrCtxt, ..): R { .. };` with
//   `// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:<line> <name>` directly above, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty). In a split file edit only your lane's list.
// - Free fns: replace `export const f = ((): never => unported(..)) as Fns_..["f"]` by `export function f(..)` with the
//   declared signature and the marker. `self.tcx` / `self.infcx` / InferCtxt methods are read through the Deref forwarders
//   (`this.tcx`, `this.next_ty_var(..)`); a `&TypeErrCtxt` passed as `&InferCtxt` is `this.infcx`.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other
// crates; other rustc_trait_selection modules are read inside function bodies only.
//
// Ported here by lane errctxt-contract (small foundational items used by other files and crates): `FindExprBySpan`
// (hand class: an intravisit `Visitor`, with `new`) and the `impl ArgKind` companion.
export * from "./mod.gen.ts";
import * as hir from "../../../rustc_hir/lib.ts";
import type { HirTyCtxt } from "../../../rustc_hir/intravisit.ts";
import { TyCtxt_as_HirTyCtxt } from "../../../rustc_middle/hir/map.ts";
import { OnlyBodies } from "../../../rustc_middle/hir/nested_filter.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Ty } from "../../../rustc_middle/ty/decls.ts";
import { display_Ty } from "../../../rustc_middle/ty/print/pretty.ts";
import { Span } from "../../../rustc_span/lib.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { unported } from "../../../std/panic.ts";
import { TypeErrCtxt } from "../../decls.ts";
import type { Fns_error_reporting_traits_mod } from "../../decls.ts";
import type { ArgKind as ArgKindT } from "./mod.gen.ts";

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:58 FindExprBySpan
/// Crude way of getting back an `Expr` from a `Span`.
export class FindExprBySpan extends hir.intravisit.Visitor {
  // impl<'v> Visitor<'v> for FindExprBySpan<'v>
  // type NestedFilter = rustc_middle::hir::nested_filter::OnlyBodies;
  override NestedFilter = OnlyBodies;

  constructor(
    public span: Span,
    public result: hir.Expr | undefined,
    public ty_result: hir.Ty | undefined,
    public include_closures: boolean,
    public tcx: TyCtxt,
  ) {
    super();
  }

  // impl<'hir> FindExprBySpan<'hir>

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:67 new
  static new(span: Span, tcx: TyCtxt): FindExprBySpan {
    return new FindExprBySpan(span, undefined, undefined, false, tcx);
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:75 maybe_tcx
  override maybe_tcx(): HirTyCtxt {
    return TyCtxt_as_HirTyCtxt(this.tcx);
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:79 visit_expr
  override visit_expr(ex: hir.Expr): undefined {
    if (this.span === ex.span) {
      this.result = ex;
    } else {
      let closure_header_sp: Span;
      if (
        ex.kind.$ === "Closure" &&
        this.include_closures &&
        ((closure_header_sp = Span.with_hi(this.span, Span.hi(ex.span))), true) &&
        closure_header_sp === ex.span
      ) {
        this.result = ex;
      }
      hir.intravisit.walk_expr(this, ex);
    }
    return undefined;
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:94 visit_ty
  override visit_ty(ty: hir.Ty<hir.AmbigArg>): undefined {
    if (this.span === ty.span) {
      this.ty_result = ty.as_unambig_ty();
    } else {
      hir.intravisit.walk_ty(this, ty);
    }
    return undefined;
  }
}

export type ArgKind = ArgKindT;
/** `impl ArgKind` (PORTING §8: enum methods on the companion). */
export const ArgKind = {
  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:117 empty
  empty(): ArgKindT {
    return { $: "Arg", _0: "_", _1: "_" };
  },

  /// Creates an `ArgKind` from the expected type of an
  /// argument. It has no name (`_`) and an optional source span.
  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:123 from_expected_ty
  from_expected_ty(t: Ty, span: Span | undefined): ArgKindT {
    const kind = t.kind();
    switch (kind.$) {
      case "Tuple":
        return { $: "Tuple", _0: span, _1: kind._0.map((ty): [string, string] => ["_", display_Ty(ty)]) };
      default:
        return { $: "Arg", _0: "_", _1: display_Ty(t) };
    }
  },
};

// error_reporting/traits/mod.rs:569 (stub; lane errrep-traits-a)
export const to_pretty_impl_header = ((): never => unported("rustc_trait_selection::error_reporting::traits::to_pretty_impl_header")) as Fns_error_reporting_traits_mod["to_pretty_impl_header"];
// error_reporting/traits/mod.rs:684 (stub; lane errrep-traits-a)
export const report_dyn_incompatibility = ((): never => unported("rustc_trait_selection::error_reporting::traits::report_dyn_incompatibility")) as Fns_error_reporting_traits_mod["report_dyn_incompatibility"];
// error_reporting/traits/mod.rs:775 (stub; lane errrep-traits-a)
export const attempt_dyn_to_enum_suggestion = ((): never => unported("rustc_trait_selection::error_reporting::traits::attempt_dyn_to_enum_suggestion")) as Fns_error_reporting_traits_mod["attempt_dyn_to_enum_suggestion"];
// error_reporting/traits/mod.rs:856 (stub; lane errrep-traits-a)
export const attempt_dyn_to_impl_suggestion = ((): never => unported("rustc_trait_selection::error_reporting::traits::attempt_dyn_to_impl_suggestion")) as Fns_error_reporting_traits_mod["attempt_dyn_to_impl_suggestion"];

unported_methods(TypeErrCtxt.prototype, "rustc_trait_selection::error_reporting::traits::TypeErrCtxt", [
  "report_fulfillment_errors", "report_fulfillment_error", "extern_crates_with_the_same_name", "check_same_definition_different_crate", "report_extra_impl_obligation",
]);
