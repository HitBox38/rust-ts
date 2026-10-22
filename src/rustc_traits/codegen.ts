// This file contains various trait resolution methods used by codegen.
// They all assume regions can be erased and monomorphic types. It
// seems likely that they should eventually be merged into more
// general routines.
//
// Port of compiler/rustc_traits/src/codegen.rs (lane selcx-contract). Reached from rustc_ty_utils's
// `resolve_associated_item` (lane instance-vtable). `tcx.arena.alloc(x)` is `x`.

import { ImplSource, type CodegenObligationError, type SelectionError } from "../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { PseudoCanonicalInput } from "../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_TraitRef } from "../rustc_middle/ty/predicate.ts";
import { bug } from "../rustc_span/macros.ts";
import type { TraitRef } from "../rustc_type_ir/decls.ts";
import { fold_with_TraitRef, TraitClause, try_fold_with_TraitRef, visit_with_TraitRef } from "../rustc_type_ir/predicate.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { unreachable } from "../std/panic.ts";
import { PLAIN } from "../std/fmt.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { Obligation } from "../rustc_infer/traits/mod.ts";
import { ObligationCause, debug_SelectionError } from "../rustc_middle/traits/mod.ts";
import { TraitErrors } from "../rustc_infer/traits/engine.ts";
import { debug_TraitRef } from "../rustc_type_ir/ir_print.ts";
import { ObligationCtxt, SelectionContext } from "../rustc_trait_selection/traits/mod.ts";
import { type FallibleTypeFolder, type TypeFoldable, type TypeVisitor, fold_with_trivial, try_fold_with_trivial, visit_with_trivial } from "../rustc_type_ir/fold.ts";
import { fold_with_ImplSource, try_fold_with_ImplSource, visit_with_ImplSource } from "../rustc_middle/traits/mod.gen.ts";

const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };

/** `ImplSource<'tcx, ()>: TypeFoldable`: the derive (rustc_middle traits/mod.rs, generated into traits/mod.gen.ts) over
 *  `()`'s trivial traversal (`TrivialTypeTraversalImpls!`). */
function d_ImplSource_unit(): TypeFoldable<ImplSource<null>> {
  return {
    visit_with: <R>(self: ImplSource<null>, visitor: TypeVisitor<R>) => visit_with_ImplSource<null, R>(self, visitor, visit_with_trivial),
    try_fold_with: <E>(self: ImplSource<null>, folder: FallibleTypeFolder<E>) => try_fold_with_ImplSource<null, E>(self, folder, try_fold_with_trivial),
    fold_with: (self, folder) => fold_with_ImplSource<null>(self, folder, fold_with_trivial),
  };
}

/// Attempts to resolve an obligation to an `ImplSource`. The result is
/// a shallow `ImplSource` resolution, meaning that we do not
/// (necessarily) resolve all nested obligations on the impl. Note
/// that type check should guarantee to us that all nested
/// obligations *could be* resolved if we wanted to.
///
/// This also expects that `trait_ref` is fully normalized.
// rustc: compiler/rustc_traits/src/codegen.rs:24 codegen_select_candidate
export function codegen_select_candidate(tcx: TyCtxt, key: PseudoCanonicalInput<TraitRef>): Result<ImplSource<null>, CodegenObligationError> {
  const { typing_env, value: trait_ref } = key;
  // We expect the input to be fully normalized.
  tcx.debug_assert_fully_normalized(typing_env, trait_ref, d_TraitRef);

  // Do the initial selection for the obligation. This yields the
  // shallow result we are looking for -- that is, what specific impl.
  const [infcx, param_env] = tcx.infer_ctxt().ignoring_regions().build_with_typing_env(typing_env);
  const selcx = SelectionContext.new(infcx);

  const obligation_cause = ObligationCause.dummy();
  const obligation = Obligation.new(tcx, obligation_cause, param_env, trait_ref, TraitClause.upcast_from_TraitRef);

  const r = selcx.select(obligation);
  let selection;
  if (r.$ === "Ok") {
    if (r._0 === undefined) return Err({ $: "Ambiguity" });
    selection = r._0;
  } else {
    const e: SelectionError = r._0;
    if (e.$ === "Unimplemented") return Err({ $: "Unimplemented" });
    return bug(`Encountered error \`${debug_SelectionError(e, PLAIN)}\` selecting \`${debug_TraitRef(trait_ref, PLAIN)}\` during codegen`);
  }

  // debug!(?selection);

  // Currently, we use a fulfillment context to completely resolve
  // all nested obligations. This is because they can inform the
  // inference of the impl's type parameters.
  const ocx = ObligationCtxt.new(infcx);
  const impl_source_ = ImplSource.map(selection, (obligation) => {
    ocx.register_obligation(obligation);
    return null;
  });

  // In principle, we only need to do this so long as `impl_source`
  // contains unbound type parameters. It could be a slight
  // optimization to stop iterating early.
  const errors = ocx.evaluate_obligations_error_on_ambiguity();
  if (!TraitErrors.no_errors(errors)) {
    // `rustc_monomorphize::collector` assumes there are no type errors.
    // Cycle errors are the only post-monomorphization errors possible; emit them now so
    // `rustc_ty_utils::resolve_associated_item` doesn't return `None` post-monomorphization.
    for (const err of TraitErrors.into_iter(errors)) {
      if (err.$ === "Cycle") {
        infcx.err_ctxt().report_overflow_obligation_cycle(err._0);
      }
    }
    return Err({ $: "Unimplemented" });
  }

  const d = d_ImplSource_unit();
  const impl_source1 = infcx.deeply_resolve_ignoring_regions(impl_source_, d);
  const impl_source = tcx.erase_and_anonymize_regions(impl_source1, d);
  if (TypeVisitableExt.has_non_region_infer(impl_source, d)) {
    // Unused generic types or consts on an impl get replaced with inference vars,
    // but never resolved, causing the return value of a query to contain inference
    // vars. We do not have a concept for this and will in fact ICE in stable hashing
    // of the return value. So bail out instead.
    let guar;
    if (impl_source.$ === "UserDefined") {
      guar = tcx.dcx().span_delayed_bug(tcx.def_span(impl_source._0.impl_def_id), "this impl has unconstrained generic parameters");
    } else {
      return unreachable();
    }
    return Err({ $: "UnconstrainedParam", _0: guar });
  }

  return Ok(impl_source);
}

/** PORT: names used in type positions only. */
export type CodegenTypes = typeof Predicate_upcast_from_TraitRef;
