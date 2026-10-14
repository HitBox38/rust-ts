// Coherence phase
//
// The job of the coherence phase of typechecking is to ensure that
// each trait has at most one implementation for each type. This is
// done by the orphan and overlap modules. Then we build up various
// mappings. That mapping code resides here.
//
// Port of compiler/rustc_hir_analysis/src/coherence/mod.rs (lane coherence).
//
// PORT notes (file-wide):
// - `Result::and(self, res)` evaluates `res` eagerly (it is an argument), so `a.and(f(..)).and(g(..))` calls `f` then `g`
//   and folds with the local `and` (as impl_wf_check.ts).
// - `debug!` is tracing only and stays as a comment.
// - `crate::check::always_applicable` is lane check-region-intrinsic's (wave 17, parallel); `check_negative_auto_trait_impl`
//   is the local stand-in below, which stops as UNPORTED until that lane merges (root repoints it).
// - The private fns are exported for coherence_test/run.ts (it runs `coherent_trait`'s per-impl checks one by one).
// Init order: top-level code here touches only other crates; this crate's modules are read inside function bodies.
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { E0322, E0328, E0371, E0715, struct_span_code_err } from "../../rustc_errors/lib.ts";
import type { Providers } from "../../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type ImplTraitHeader, RestrictionKind } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import type { TraitDef } from "../../rustc_middle/ty/trait_def.ts";
import { feature_err } from "../../rustc_session/diagnostics.ts";
import { type DefId, DefId_eq, LocalDefId } from "../../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { display_Symbol, sym } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { ImplPolarity, TraitRef } from "../../rustc_type_ir/decls.ts";
import { supertrait_def_ids } from "../../rustc_type_ir/elaborate.ts";
import { fold_with_TraitRef, TraitRef as TraitRefC, try_fold_with_TraitRef, visit_with_TraitRef } from "../../rustc_type_ir/predicate.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { unported } from "../../std/panic.ts";
import { Ok, type Result } from "../../std/result.ts";
import * as diagnostics from "../diagnostics.ts";
import * as builtin from "./builtin.ts";
import * as inherent_impls from "./inherent_impls.ts";
import * as inherent_impls_overlap from "./inherent_impls_overlap.ts";
import * as orphan from "./orphan.ts";
import * as unsafety from "./unsafety.ts";

// mod builtin;
// mod inherent_impls;
// mod inherent_impls_overlap;
// mod orphan;
// mod unsafety;
export { builtin, inherent_impls, inherent_impls_overlap, orphan, unsafety };

const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };

/** `Result::and` (the argument is already evaluated). */
function and(self: Result<null, ErrorGuaranteed>, res: Result<null, ErrorGuaranteed>): Result<null, ErrorGuaranteed> {
  return self.$ === "Ok" ? res : self;
}

/**
 * PORT(stub): `crate::check::always_applicable::check_negative_auto_trait_impl` (check/always_applicable.rs:85), lane
 * check-region-intrinsic (wave 17, parallel). Root repoints this to the real fn when that lane merges.
 */
function check_negative_auto_trait_impl(_tcx: TyCtxt, _impl_def_id: LocalDefId, _impl_trait_ref: TraitRef, _polarity: ImplPolarity): Result<null, ErrorGuaranteed> {
  return unported("rustc_hir_analysis::check::always_applicable::check_negative_auto_trait_impl");
}

// rustc: compiler/rustc_hir_analysis/src/coherence/mod.rs:27 check_impl
export function check_impl(tcx: TyCtxt, impl_def_id: LocalDefId, trait_ref: TraitRef, trait_def: TraitDef, polarity: ImplPolarity): Result<null, ErrorGuaranteed> {
  // debug!(
  //     "(checking implementation) adding impl for trait '{:?}', item '{}'",
  //     trait_ref,
  //     tcx.def_path_str(impl_def_id)
  // );

  // Skip impls where one of the self type is an error type.
  // This occurs with e.g., resolve failures (#30589).
  const r = TypeVisitableExt.error_reported(trait_ref, d_TraitRef);
  if (r.$ === "Err") return r;

  const a = enforce_trait_manually_implementable(tcx, impl_def_id, trait_ref.def_id, trait_def);
  const b = enforce_empty_impls_for_marker_traits(tcx, impl_def_id, trait_ref.def_id, trait_def);
  const c = check_negative_auto_trait_impl(tcx, impl_def_id, trait_ref, polarity);
  return and(and(a, b), c);
}

// rustc: compiler/rustc_hir_analysis/src/coherence/mod.rs:54 enforce_trait_manually_implementable
export function enforce_trait_manually_implementable(tcx: TyCtxt, impl_def_id: LocalDefId, trait_def_id: DefId, trait_def: TraitDef): Result<null, ErrorGuaranteed> {
  const impl_header_span = tcx.def_span(impl_def_id);

  if (tcx.is_lang_item(trait_def_id, LangItem.Freeze) && !tcx.features().freeze_impls()) {
    feature_err(tcx.sess, sym.freeze_impls, impl_header_span, "explicit impls for the `Freeze` trait are not permitted")
      .with_span_label(impl_header_span, `impl of \`Freeze\` not allowed`)
      .emit();
  }

  // Disallow *all* explicit impls of traits marked `#[rustc_deny_explicit_impl]`
  if (trait_def.deny_explicit_impl) {
    const trait_name = tcx.item_name(trait_def_id);
    const err = struct_span_code_err(tcx.dcx(), impl_header_span, E0322, `explicit impls for the \`${display_Symbol(trait_name)}\` trait are not permitted`);
    err.span_label(impl_header_span, `impl of \`${display_Symbol(trait_name)}\` not allowed`);

    // Maintain explicit error code for `Unsize`, since it has a useful
    // explanation about using `CoerceUnsized` instead.
    if (tcx.is_lang_item(trait_def_id, LangItem.Unsize)) {
      err.code(E0328);
    }

    return { $: "Err", _0: err.emit_err() };
  }

  if (trait_def.specialization_kind === "AlwaysApplicable") {
    if (
      !tcx.features().specialization() &&
      !tcx.features().min_specialization() &&
      !Span.allows_unstable(impl_header_span, sym.specialization) &&
      !Span.allows_unstable(impl_header_span, sym.min_specialization)
    ) {
      return { $: "Err", _0: tcx.dcx().emit_err(diagnostics.SpecializationTrait_diagnostic({ span: impl_header_span })) };
    }
  }

  if (!RestrictionKind.is_allowed_in(trait_def.impl_restriction, LocalDefId.to_def_id(impl_def_id), tcx)) {
    return {
      $: "Err",
      _0: tcx.dcx().emit_err(
        diagnostics.ImplOfRestrictedTrait_diagnostic({
          impl_span: impl_header_span,
          restriction_span: RestrictionKind.expect_span(trait_def.impl_restriction),
          restriction_path: RestrictionKind.restriction_path(trait_def.impl_restriction, tcx),
        }),
      ),
    };
  }
  return Ok(null);
}

/// We allow impls of marker traits to overlap, so they can't override impls
/// as that could make it ambiguous which associated item to use.
// rustc: compiler/rustc_hir_analysis/src/coherence/mod.rs:118 enforce_empty_impls_for_marker_traits
export function enforce_empty_impls_for_marker_traits(tcx: TyCtxt, impl_def_id: LocalDefId, trait_def_id: DefId, trait_def: TraitDef): Result<null, ErrorGuaranteed> {
  if (!trait_def.is_marker) {
    return Ok(null);
  }

  if (tcx.associated_item_def_ids(trait_def_id).length === 0) {
    return Ok(null);
  }

  return { $: "Err", _0: struct_span_code_err(tcx.dcx(), tcx.def_span(impl_def_id), E0715, "impls for marker traits cannot contain items").emit_err() };
}

/// Adds query implementations to the [Providers] vtable, see [`rustc_middle::query`].
// rustc: compiler/rustc_hir_analysis/src/coherence/mod.rs:142 provide
export function provide(providers: Providers): void {
  // use self::builtin::coerce_unsized_info;
  // use self::inherent_impls::{
  //     crate_incoherent_impls, crate_inherent_impls, crate_inherent_impls_validity_check,
  //     inherent_impls,
  // };
  // use self::inherent_impls_overlap::crate_inherent_impls_overlap_check;
  // use self::orphan::orphan_check_impl;

  // PORT: the struct update `*providers = Providers { .., ..*providers }` assigns the fields in place.
  // PORT: `crate_inherent_impls` returns `(&CrateInherentImpls, Result)`; its query value is `[unknown, Result]` in
  // queries.gen.ts, so the provider is stored as is (the value is a `CrateInherentImpls`).
  providers.coherent_trait = coherent_trait;
  providers.crate_inherent_impls = inherent_impls.crate_inherent_impls;
  providers.crate_incoherent_impls = inherent_impls.crate_incoherent_impls;
  providers.inherent_impls = inherent_impls.inherent_impls;
  providers.crate_inherent_impls_validity_check = inherent_impls.crate_inherent_impls_validity_check;
  providers.crate_inherent_impls_overlap_check = inherent_impls_overlap.crate_inherent_impls_overlap_check;
  providers.coerce_unsized_info = builtin.coerce_unsized_info;
  providers.orphan_check_impl = orphan.orphan_check_impl;
}

// rustc: compiler/rustc_hir_analysis/src/coherence/mod.rs:164 coherent_trait
export function coherent_trait(tcx: TyCtxt, def_id: DefId): Result<null, ErrorGuaranteed> {
  const impls = tcx.local_trait_impls(def_id);
  // If there are no impls for the trait, then "all impls" are trivially coherent and we won't check anything
  // anyway. Thus we bail out even before the specialization graph, avoiding the dep_graph edge.
  if (impls.length === 0) {
    return Ok(null);
  }
  // Trigger building the specialization graph for the trait. This will detect and report any
  // overlap errors.
  let res = tcx.ensure_result().specialization_graph_of(def_id);

  for (const impl_def_id of impls) {
    // PORT: the `impl_trait_header` / `trait_def` query values are `unknown` in queries.gen.ts.
    const impl_header = tcx.impl_trait_header(impl_def_id) as ImplTraitHeader;
    const trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(impl_header.trait_ref));
    const trait_def = tcx.trait_def(trait_ref.def_id) as TraitDef;

    res = and(res, check_impl(tcx, impl_def_id, trait_ref, trait_def, impl_header.polarity));
    res = and(res, check_object_overlap(tcx, impl_def_id, trait_ref));
    res = and(res, unsafety.check_item(tcx, impl_def_id, impl_header, trait_def));
    res = and(res, tcx.ensure_result().orphan_check_impl(impl_def_id));
    res = and(res, builtin.check_trait(tcx, def_id, impl_def_id, impl_header));
  }

  return res;
}

/// Checks whether an impl overlaps with the automatic `impl Trait for dyn Trait`.
// rustc: compiler/rustc_hir_analysis/src/coherence/mod.rs:192 check_object_overlap
export function check_object_overlap(tcx: TyCtxt, impl_def_id: LocalDefId, trait_ref: TraitRef): Result<null, ErrorGuaranteed> {
  const trait_def_id = trait_ref.def_id;

  const r = TypeVisitableExt.error_reported(trait_ref, d_TraitRef);
  if (r.$ === "Err") {
    // debug!("coherence: skipping impl {:?} with error {:?}", impl_def_id, trait_ref);
    return r;
  }

  // check for overlap with the automatic `impl Trait for dyn Trait`
  const k = TraitRefC.self_ty(trait_ref).kind();
  if (k.$ === "Dynamic") {
    const data = k._0;
    // This is something like `impl Trait1 for Trait2`. Illegal if
    // Trait1 is a supertrait of Trait2 or Trait2 is not dyn compatible.

    const component_def_ids: DefId[] = [];
    for (const predicate of data) {
      const p = Binder.skip_binder(predicate);
      switch (p.$) {
        case "Trait":
          component_def_ids.push(p._0.def_id);
          break;
        case "AutoTrait":
          component_def_ids.push(p._0);
          break;
        // An associated type projection necessarily comes with
        // an additional `Trait` requirement.
        case "Projection":
          break;
      }
    }

    for (const component_def_id of component_def_ids) {
      if (!tcx.is_dyn_compatible(component_def_id)) {
        // This is a WF error tested by `coherence-impl-trait-for-trait-dyn-compatible.rs`.
      } else {
        let any = false;
        for (const d of supertrait_def_ids(tcx, component_def_id)) {
          if (DefId_eq(d, trait_def_id)) {
            any = true;
            break;
          }
        }
        if (any) {
          const span = tcx.def_span(impl_def_id);
          const self_ty = TraitRefC.self_ty(trait_ref);
          return {
            $: "Err",
            _0: struct_span_code_err(
              tcx.dcx(),
              span,
              E0371,
              `the object type \`${display_Ty(self_ty)}\` automatically implements the trait \`${tcx.def_path_str(trait_def_id)}\``,
            )
              .with_span_label(span, `\`${display_Ty(self_ty)}\` automatically implements trait \`${tcx.def_path_str(trait_def_id)}\``)
              .emit_err(),
          };
        }
      }
    }
  }
  return Ok(null);
}
