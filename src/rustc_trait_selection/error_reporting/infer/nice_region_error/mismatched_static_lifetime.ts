// Port of compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/mismatched_static_lifetime.rs (lane errrep-nice-region).
//
//! Error Reporting for when the lifetime for a type doesn't match the `impl` selected for a predicate
//! to hold.
//
// `impl NiceRegionError` methods are assigned onto `NiceRegionError.prototype` (declared in the crate decls.ts).
// Init order: top-level code here touches only ./mod.ts (`NiceRegionError`) and other crates; the crate's other
// modules (diagnostics, ./static_impl_trait.ts) are read inside function bodies only.
import { MultiSpan } from "../../../../rustc_error_messages/lib.ts";
import { EarlyBinder } from "../../../../rustc_type_ir/binder.ts";
import type { Ty } from "../../../../rustc_middle/ty/mod.ts";
import { DefIdSet } from "../../../../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../../../../rustc_span/lib.ts";
import { bug } from "../../../../rustc_span/macros.ts";
import { Unnormalized } from "../../../../rustc_type_ir/unnormalized.ts";
import type { ImplicitStaticLifetimeSubdiag, IntroducesStaticBecauseUnmetLifetimeReq } from "../../../diagnostics.gen.ts";
import { NiceRegionError } from "./mod.ts";

/** The crate's diagnostics.gen.ts (read lazily, init order). */
function diagnostics_gen(): typeof import("../../../diagnostics.gen.ts") {
  return (diagnostics_gen__m ??= require("../../../diagnostics.gen.ts") as typeof import("../../../diagnostics.gen.ts"));
}
var diagnostics_gen__m: typeof import("../../../diagnostics.gen.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)

/** The crate's diagnostics/note_and_explain.ts (read lazily, init order). */
function note_and_explain(): typeof import("../../../diagnostics/note_and_explain.ts") {
  return (note_and_explain__m ??= require("../../../diagnostics/note_and_explain.ts") as typeof import("../../../diagnostics/note_and_explain.ts"));
}
var note_and_explain__m: typeof import("../../../diagnostics/note_and_explain.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)

/** ./static_impl_trait.ts (`super::static_impl_trait`, read lazily, init order). */
function static_impl_trait(): typeof import("./static_impl_trait.ts") {
  return (static_impl_trait__m ??= require("./static_impl_trait.ts") as typeof import("./static_impl_trait.ts"));
}
var static_impl_trait__m: typeof import("./static_impl_trait.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)

// impl<'a, 'tcx> NiceRegionError<'a, 'tcx> {
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/mismatched_static_lifetime.rs:21 try_report_mismatched_static_lifetime
NiceRegionError.prototype.try_report_mismatched_static_lifetime = function (this: NiceRegionError): ErrorGuaranteed | undefined {
  const error = this.error;
  if (error === undefined) return undefined;
  // debug!("try_report_mismatched_static_lifetime {:?}", error);

  // PORT: `error.clone()` only moves the matched fields out; nothing is mutated, so they are read in place.
  const e = error;
  if (e.$ !== "ConcreteFailure") {
    return undefined;
  }
  const [origin, sub, sup] = [e._0, e._1, e._2];
  if (!sub.is_static()) {
    return undefined;
  }
  if (origin.$ !== "Subtype") {
    return undefined;
  }
  const cause = origin._0.cause;
  // If we added a "points at argument expression" obligation, we remove it here, we care
  // about the original obligation only.
  const code = cause.code_();
  if (code.$ !== "MatchImpl") {
    return undefined;
  }
  const [parent, impl_def_id] = [code._0, code._1];
  const parent_code = parent.code_();
  if (!(parent_code.$ === "WhereClause" || parent_code.$ === "WhereClauseInExpr")) {
    return undefined;
  }
  const binding_span = parent_code._1;
  if (Span.is_dummy(binding_span)) {
    return undefined;
  }

  // FIXME: we should point at the lifetime
  const multi_span: MultiSpan = MultiSpan.from_spans([binding_span]);
  const multispan_subdiag: IntroducesStaticBecauseUnmetLifetimeReq = {
    unmet_requirements: multi_span,
    binding_span,
  };

  const expl = note_and_explain().RegionExplanation.new(this.tcx(), this.generic_param_scope, sup, binding_span, "Empty", "Continues");
  let impl_span: Span | undefined = undefined;
  const implicit_static_lifetimes: ImplicitStaticLifetimeSubdiag[] = [];
  const impl_node = this.tcx().hir_get_if_local(impl_def_id);
  if (impl_node !== undefined) {
    // If an impl is local, then maybe this isn't what they want. Try to
    // be as helpful as possible with implicit lifetimes.

    // First, let's get the hir self type of the impl
    if (!(impl_node.$ === "Item" && impl_node._0.kind.$ === "Impl")) {
      return bug("Node not an impl.");
    }
    const impl_self_ty = impl_node._0.kind._0.self_ty;

    // Next, let's figure out the set of trait objects with implicit static bounds
    const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx().type_of(impl_def_id) as EarlyBinder<Ty>));
    const v = new (static_impl_trait().TraitObjectVisitor)(new DefIdSet());
    v.visit_ty(ty);
    const traits: Span[] = [];
    for (const matching_def_id of v._0) {
      const hir_v = new (static_impl_trait().HirTraitObjectVisitor)(traits, matching_def_id);
      hir_v.visit_ty_unambig(impl_self_ty);
    }

    if (traits.length === 0) {
      // If there are no trait object traits to point at, either because
      // there aren't trait objects or because none are implicit, then just
      // write a single note on the impl itself.

      impl_span = this.tcx().def_span(impl_def_id);
    } else {
      // Otherwise, point at all implicit static lifetimes

      for (const span of traits) {
        implicit_static_lifetimes.push({ $: "Note", span });
        // It would be nice to put this immediately under the above note, but they get
        // pushed to the end.
        implicit_static_lifetimes.push({ $: "Sugg", span: Span.shrink_to_hi(span) });
      }
    }
  } else {
    // Otherwise just point out the impl.

    impl_span = this.tcx().def_span(impl_def_id);
  }
  const d = diagnostics_gen();
  const err = d.MismatchedStaticLifetime_diagnostic({
    cause_span: cause.span,
    unmet_lifetime_reqs: multispan_subdiag,
    expl,
    does_not_outlive_static_from_impl: impl_span !== undefined ? { $: "Spanned", span: impl_span } : d.DoesNotOutliveStaticFromImpl.Unspanned,
    implicit_static_lifetimes,
  });
  const reported = this.tcx().dcx().emit_err(err);
  return reported;
};
// }
