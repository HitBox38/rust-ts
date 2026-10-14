//! The analysis prefix shared by the `tydump` and `thirdump` probes (plan-m3 D1/D1a): what
//! `rustc_interface::passes::analysis` runs before MIR, i.e. `run_required_analyses`
//! (rustc_interface/src/passes.rs:1100) from its first line up to and including
//! `tcx.untracked().definitions.freeze()` (:1161), with `rustc_hir_analysis::check_crate`
//! (rustc_hir_analysis/src/lib.rs:145) inlined minus its const-eval arm (D1a).
//! `thirdump` includes this file with `#[path]`; both probes therefore run the same sequence.
//!
//! Line numbers are at the pin (UPSTREAM.json). Every statement below is upstream's, in upstream
//! order, with upstream comments; the differences are listed here and nowhere else:
//! - `#[cfg(all(not(doc), debug_assertions))] rustc_passes::hir_id_validator::check_crate(tcx)`
//!   (passes.rs:1105-1107) is left out: the oracle is a release build without debug assertions, so it
//!   does not run there either.
//! - `check_crate`'s `match def_kind { DefKind::Static { .. } => ..., DefKind::Const if ... => ... }`
//!   (lib.rs:166-184: `eval_static_initializer`, `check::maybe_check_static_with_link_section`,
//!   `eval_to_const_value_raw`) is left out (D1a): it needs CTFE (MIR + the interpreter), which is
//!   M4/M6. The rest of the per-body-owner closure (`typeck`) is kept.
//! - `check_crate`'s `#[rustc_dump_*]` dumps (lib.rs:214-227) call the crate-private
//!   `collect::dump`, `outlives::dump` and `variance::dump` fns, so their bodies are copied below
//!   verbatim (collect/dump.rs, outlives/dump.rs, variance/dump.rs), each with its upstream
//!   location. The one crate-private type they use, `crate::diagnostics::TypeOf`
//!   (`#[diag("{$ty}")]`, primary span, arg `ty`), is built by hand exactly as its derive does:
//!   `Diag::new(dcx, Error, DiagMessage::Inline("{$ty}"))` + `arg("ty", ty)` + `span(span)`.
//!   Under `-Ztrack-diagnostics` the "created at" location of these diagnostics names this file
//!   instead of the upstream one, and so would a `span_delayed_bug` ICE message ("delayed at").
//! - `sess.time`/`tcx.sess.timer` are kept (they print nothing without `-Ztime-passes`).
//! - Everything after `definitions.freeze()` (MIR_borrow_checking, layout/abi tests, the error
//!   abort and misc_checking_3 of `analysis`) is not run.
//! The `par_*` helpers run sequentially in order with the default `-Zthreads=1`, which every
//! suite uses.

use rustc_attr_ir::find_attr;
use rustc_data_structures::sync::par_fns;
use rustc_errors::{Diag, DiagMessage, ErrorGuaranteed, Level};
use rustc_hir as hir;
use rustc_hir::def::DefKind;
use rustc_hir::def_id::{LOCAL_CRATE, LocalDefId};
use rustc_hir::intravisit;
use rustc_metadata::creader::CStore;
use rustc_middle::hir::nested_filter;
use rustc_middle::middle::resolve_bound_vars::ObjectLifetimeDefault;
use rustc_middle::ty::{self, GenericArgs, TyCtxt, TypeVisitableExt, Unnormalized};
use rustc_span::{bug, sym};

/// rustc_interface/src/passes.rs:1100 `run_required_analyses`, up to and including
/// `definitions.freeze()`, with `rustc_hir_analysis::check_crate` replaced by [`check_crate`].
///
/// Returns (an observation only, it changes nothing) the number of definitions right after
/// `hir_crate_items` (i.e. after AST lowering): every DefId with a higher index was created by a
/// query during the rest of the prefix (RPITIT associated types, coroutine by-move bodies, opaque
/// lifetimes, ...).
pub fn run_required_analyses_prefix(tcx: TyCtxt<'_>) -> usize {
    if tcx.sess.opts.unstable_opts.input_stats {
        rustc_passes::input_stats::print_hir_stats(tcx);
    }
    // (passes.rs:1104-1107 `rustc_passes::hir_id_validator::check_crate(tcx)`: debug assertions
    // only, see the header.)

    // Prefetch this to prevent multiple threads from blocking on it later.
    // This is needed since the `hir_id_validator::check_crate` call above is not guaranteed
    // to use `hir_crate_items`.
    tcx.ensure_done().hir_crate_items(());
    // (Probe observation, not upstream.)
    let num_definitions_after_lowering = tcx.definitions_untracked().num_definitions();

    tcx.untracked().definitions.write().commit_end_of_determinism();

    rustc_passes::delegation::check_glob_and_list_delegations_target_expr(tcx);

    let sess = tcx.sess;
    sess.time("misc_checking_1", || {
        par_fns(&mut [
            &mut || {
                sess.time("looking_for_entry_point", || tcx.ensure_ok().entry_fn(()));
                sess.time("check_externally_implementable_items", || {
                    tcx.ensure_ok().check_externally_implementable_items(())
                });

                sess.time("looking_for_derive_registrar", || {
                    tcx.ensure_ok().proc_macro_decls_static(())
                });

                CStore::from_tcx(tcx).report_unused_deps(tcx);
            },
            &mut || {
                tcx.ensure_ok().exportable_items(LOCAL_CRATE);
                tcx.ensure_ok().stable_order_of_exportable_impls(LOCAL_CRATE);
                tcx.par_hir_for_each_module(|module| {
                    tcx.ensure_ok().check_mod_attrs(module);
                    tcx.ensure_ok().check_mod_unstable_api_usage(module);
                });
            },
            &mut || {
                // We force these queries to run,
                // since they might not otherwise get called.
                // This marks the corresponding crate-level attributes
                // as used, and ensures that their values are valid.
                tcx.ensure_ok().limits(());
            },
        ]);
    });

    sess.time("emit_ast_lowering_delayed_lints", || {
        rustc_interface::passes::emit_delayed_lints(tcx);
    });

    check_crate(tcx);
    // Freeze definitions as we don't add new ones at this point.
    // We need to wait until now since we synthesize a by-move body
    // for all coroutine-closures.
    //
    // This improves performance by allowing lock-free access to them.
    tcx.untracked().definitions.freeze();
    num_definitions_after_lowering
}

/// rustc_hir_analysis/src/lib.rs:145 `check_crate` without the const-eval arm (D1a, see the
/// header).
pub fn check_crate(tcx: TyCtxt<'_>) {
    let _prof_timer = tcx.sess.timer("type_check_crate");

    tcx.sess.time("coherence_checking", || {
        // When discarding query call results, use an explicit type to indicate
        // what we are intending to discard, to help future type-based refactoring.
        type R = Result<(), ErrorGuaranteed>;

        let _: R = tcx.ensure_result().check_type_wf(());

        for &trait_def_id in tcx.all_local_trait_impls(()).keys() {
            let _: R = tcx.ensure_result().coherent_trait(trait_def_id);
        }
        // these queries are executed for side-effects (error reporting):
        let _: R = tcx.ensure_result().crate_inherent_impls_validity_check(());
        let _: R = tcx.ensure_result().crate_inherent_impls_overlap_check(());
    });

    tcx.par_hir_body_owners(|item_def_id| {
        let def_kind = tcx.def_kind(item_def_id);
        // (lib.rs:166-184: the `DefKind::Static` / `DefKind::Const` const-eval arm is left out, D1a.)
        // Skip `AnonConst`s and type system `InlineConst`s because we feed their `type_of` in
        // `feed_anon_const_type`.
        // Also skip items for which typeck forwards to parent typeck.
        if !(def_kind == DefKind::AnonConst
            && tcx.anon_const_kind(item_def_id) != ty::AnonConstKind::NonTypeSystemInline
            || tcx.is_typeck_child(item_def_id.to_def_id()))
        {
            tcx.ensure_ok().typeck(item_def_id);
        }
    });

    // This has to be a second pass over the body owners, after every body has been
    // type-checked above. `needs_coroutine_by_move_body_def_id` asks for `type_of`, and for a
    // body owner nested inside a const argument's anon const that goes through `typeck` of the
    // anon const, which needs the anon const's own type. That type is never computed, only fed
    // while the enclosing body is type-checked. Doing this in the pass above lets the parallel
    // front end reach the nested body owner first, computing (and caching) an error type for
    // the anon const that then conflicts with the type fed later on.
    //
    // This must not be parallelized since `coroutine_by_move_body_def_id` creates new `DefId`-s
    // inside, which must be done in deterministic order to have reproducible binaries.
    tcx.hir_body_owners().for_each(|item_def_id| {
        // Ensure we generate the new `DefId` before finishing `check_crate`.
        // Afterwards we freeze the list of `DefId`s.
        if tcx.needs_coroutine_by_move_body_def_id(item_def_id.to_def_id()) {
            tcx.ensure_done().coroutine_by_move_body_def_id(item_def_id);
        }
    });

    if tcx.features().rustc_attrs() {
        tcx.sess.time("dumping_rustc_attr_data", || {
            // tidy-alphabetical-start
            collect_dump::clauses_and_item_bounds(tcx);
            collect_dump::def_parents(tcx);
            collect_dump::generics(tcx);
            collect_dump::object_lifetime_defaults(tcx);
            collect_dump::opaque_hidden_types(tcx);
            collect_dump::vtables(tcx);
            outlives_dump::inferred_outlives(tcx);
            variance_dump::variances(tcx);
            // tidy-alphabetical-end
        });
    }

    tcx.ensure_ok().check_unused_traits(());
}

/// Whether `check_crate` above type-checks `def_id` (one of `hir_body_owners`): the condition
/// around its `tcx.ensure_ok().typeck(item_def_id)`, unchanged.
pub fn check_crate_typecks(tcx: TyCtxt<'_>, item_def_id: LocalDefId) -> bool {
    let def_kind = tcx.def_kind(item_def_id);
    !(def_kind == DefKind::AnonConst
        && tcx.anon_const_kind(item_def_id) != ty::AnonConstKind::NonTypeSystemInline
        || tcx.is_typeck_child(item_def_id.to_def_id()))
}

/// rustc_hir_analysis/src/collect/dump.rs (crate-private upstream), verbatim except
/// `crate::diagnostics::TypeOf` (see the module header).
mod collect_dump {
    use super::*;

    // upstream: compiler/rustc_hir_analysis/src/collect/dump.rs:11 generics
    pub(crate) fn generics(tcx: TyCtxt<'_>) {
        for did in tcx.hir_crate_items(()).definitions() {
            if did == hir::def_id::CRATE_DEF_ID {
                continue;
            }

            if find_attr!(tcx, did, RustcDumpGenerics) {
                let span = tcx.def_span(did);

                let mut diag =
                    tcx.dcx().struct_span_err(span, format!("{}: {did:?}", sym::rustc_dump_generics));

                let generics = tcx.generics_of(did);
                diag.span_note(tcx.def_span(did), format!("{generics:#?}"));
                diag.emit();
            }
        }
    }

    // upstream: compiler/rustc_hir_analysis/src/collect/dump.rs:30 object_lifetime_defaults
    pub(crate) fn object_lifetime_defaults(tcx: TyCtxt<'_>) {
        for def_id in tcx.hir_crate_items(()).definitions() {
            if def_id == hir::def_id::CRATE_DEF_ID {
                continue;
            }

            if !find_attr!(tcx, def_id, RustcDumpObjectLifetimeDefaults) {
                continue;
            }

            for param in &tcx.generics_of(def_id).own_params {
                let ty::GenericParamDefKind::Type { .. } = param.kind else { continue };
                let default = tcx.object_lifetime_default(param.def_id);
                let repr = match default {
                    ObjectLifetimeDefault::Empty => "Empty".to_owned(),
                    ObjectLifetimeDefault::Static => "'static".to_owned(),
                    ObjectLifetimeDefault::Param(def_id) => tcx.item_name(def_id).to_string(),
                    ObjectLifetimeDefault::Ambiguous => "Ambiguous".to_owned(),
                };
                tcx.dcx().span_err(tcx.def_span(param.def_id), repr);
            }
        }
    }

    // upstream: compiler/rustc_hir_analysis/src/collect/dump.rs:54 opaque_hidden_types
    pub(crate) fn opaque_hidden_types(tcx: TyCtxt<'_>) {
        if !find_attr!(tcx, crate, RustcDumpHiddenTypeOfOpaques) {
            return;
        }
        for id in tcx.hir_crate_items(()).opaques() {
            if let hir::OpaqueTyOrigin::FnReturn { parent: fn_def_id, .. }
            | hir::OpaqueTyOrigin::AsyncFn { parent: fn_def_id, .. } =
                tcx.hir_expect_opaque_ty(id).origin
                && let hir::Node::TraitItem(trait_item) = tcx.hir_node_by_def_id(fn_def_id)
                && let (_, hir::TraitFn::Required(..)) = trait_item.expect_fn()
            {
                continue;
            }

            let ty = tcx.type_of(id).instantiate_identity().skip_norm_wip();
            let span = tcx.def_span(id);
            // Upstream: `tcx.dcx().emit_err(crate::diagnostics::TypeOf { span, ty });`, i.e. what
            // `#[derive(Diagnostic)] #[diag("{$ty}")]` builds for it:
            let mut diag = Diag::new(
                tcx.dcx(),
                Level::Error,
                DiagMessage::Inline(std::borrow::Cow::Borrowed("{$ty}")),
            );
            diag.arg("ty", ty);
            diag.span(span);
            diag.emit();
        }
    }

    // upstream: compiler/rustc_hir_analysis/src/collect/dump.rs:74 clauses_and_item_bounds
    pub(crate) fn clauses_and_item_bounds(tcx: TyCtxt<'_>) {
        for id in tcx.hir_crate_items(()).owners() {
            #[expect(deprecated)] // we don't want to unnecessarily retrieve the attrs twice in a row.
            let attrs = tcx.get_all_attrs(id);

            if find_attr!(attrs, RustcDumpClauses) {
                let clauses = tcx
                    .clauses_of(id)
                    .instantiate_identity(tcx)
                    .clauses
                    .into_iter()
                    .map(Unnormalized::skip_norm_wip);
                let span = tcx.def_span(id);

                let mut diag = tcx.dcx().struct_span_err(span, sym::rustc_dump_clauses.as_str());
                for clause in clauses {
                    diag.note(format!("{clause:?}"));
                }
                diag.emit();
            }

            if find_attr!(attrs, RustcDumpItemBounds) {
                let name = sym::rustc_dump_item_bounds.as_str();

                match tcx.def_kind(id) {
                    DefKind::AssocTy => {
                        let bounds = tcx.item_bounds(id).instantiate_identity().skip_norm_wip();
                        let span = tcx.def_span(id);

                        let mut diag = tcx.dcx().struct_span_err(span, name);
                        for bound in bounds {
                            diag.note(format!("{bound:?}"));
                        }
                        diag.emit_err()
                    }
                    kind => tcx.dcx().span_delayed_bug(
                        tcx.def_span(id),
                        format!("attr parsing didn't report an error for `#[{name}]` on {kind:?}"),
                    ),
                };
            }
        }
    }

    // upstream: compiler/rustc_hir_analysis/src/collect/dump.rs:118 def_parents
    pub(crate) fn def_parents(tcx: TyCtxt<'_>) {
        for iid in tcx.hir_free_items() {
            let did = iid.owner_id.def_id;
            if find_attr!(tcx, did, RustcDumpDefParents) {
                struct AnonConstFinder<'tcx> {
                    tcx: TyCtxt<'tcx>,
                    anon_consts: Vec<LocalDefId>,
                }

                impl<'tcx> intravisit::Visitor<'tcx> for AnonConstFinder<'tcx> {
                    type NestedFilter = nested_filter::All;

                    fn maybe_tcx(&mut self) -> Self::MaybeTyCtxt {
                        self.tcx
                    }

                    fn visit_anon_const(&mut self, c: &'tcx rustc_hir::AnonConst) {
                        self.anon_consts.push(c.def_id);
                        intravisit::walk_anon_const(self, c)
                    }
                }

                // Look for any anon consts inside of this item as there is no way to apply
                // the `rustc_dump_def_parents` attribute to the anon const so it would not be possible
                // to see what its def parent is.
                let mut anon_ct_finder = AnonConstFinder { tcx, anon_consts: vec![] };
                intravisit::walk_item(&mut anon_ct_finder, tcx.hir_item(iid));

                for did in [did].into_iter().chain(anon_ct_finder.anon_consts) {
                    let span = tcx.def_span(did);

                    let mut diag = tcx
                        .dcx()
                        .struct_span_err(span, format!("{}: {did:?}", sym::rustc_dump_def_parents));

                    let mut current_did = did.to_def_id();
                    while let Some(parent_did) = tcx.opt_parent(current_did) {
                        current_did = parent_did;
                        diag.span_note(tcx.def_span(parent_did), format!("{parent_did:?}"));
                    }
                    diag.emit();
                }
            }
        }
    }

    // upstream: compiler/rustc_hir_analysis/src/collect/dump.rs:164 vtables
    pub(crate) fn vtables<'tcx>(tcx: TyCtxt<'tcx>) {
        for id in tcx.hir_free_items() {
            let def_id = id.owner_id.def_id;

            let Some(&attr_span) = find_attr!(tcx, def_id, RustcDumpVtable(span) => span) else {
                continue;
            };

            let vtable_entries = match tcx.hir_item(id).kind {
                hir::ItemKind::Impl(hir::Impl { of_trait: Some(_), .. }) => {
                    let trait_ref = tcx.impl_trait_ref(def_id).instantiate_identity();
                    if trait_ref.skip_normalization().has_non_region_param() {
                        tcx.dcx().span_err(
                            attr_span,
                            "`rustc_dump_vtable` must be applied to non-generic impl",
                        );
                        continue;
                    }
                    if !tcx.is_dyn_compatible(trait_ref.skip_normalization().def_id) {
                        tcx.dcx().span_err(
                            attr_span,
                            "`rustc_dump_vtable` must be applied to dyn-compatible trait",
                        );
                        continue;
                    }
                    let Ok(trait_ref) = tcx
                        .try_normalize_erasing_regions(ty::TypingEnv::fully_monomorphized(), trait_ref)
                    else {
                        tcx.dcx().span_err(
                            attr_span,
                            "`rustc_dump_vtable` applied to impl header that cannot be normalized",
                        );
                        continue;
                    };
                    tcx.vtable_entries(trait_ref)
                }
                hir::ItemKind::TyAlias(..) => {
                    let ty = tcx.type_of(def_id).instantiate_identity();
                    if ty.has_non_region_param() {
                        tcx.dcx().span_err(
                            attr_span,
                            "`rustc_dump_vtable` must be applied to non-generic type",
                        );
                        continue;
                    }
                    let Ok(ty) =
                        tcx.try_normalize_erasing_regions(ty::TypingEnv::fully_monomorphized(), ty)
                    else {
                        tcx.dcx().span_err(
                            attr_span,
                            "`rustc_dump_vtable` applied to type alias that cannot be normalized",
                        );
                        continue;
                    };
                    let ty::Dynamic(data, _) = *ty.kind() else {
                        tcx.dcx().span_err(attr_span, "`rustc_dump_vtable` to type alias of dyn type");
                        continue;
                    };
                    if let Some(principal) = data.principal() {
                        tcx.vtable_entries(
                            tcx.instantiate_bound_regions_with_erased(principal).with_self_ty(tcx, ty),
                        )
                    } else {
                        TyCtxt::COMMON_VTABLE_ENTRIES
                    }
                }
                _ => {
                    tcx.dcx().span_err(
                        attr_span,
                        "`rustc_dump_vtable` only applies to impl, or type alias of dyn type",
                    );
                    continue;
                }
            };

            tcx.dcx().span_err(tcx.def_span(def_id), format!("vtable entries: {vtable_entries:#?}"));
        }
    }
}

/// rustc_hir_analysis/src/outlives/dump.rs (crate-private upstream), verbatim.
mod outlives_dump {
    use super::*;

    // upstream: compiler/rustc_hir_analysis/src/outlives/dump.rs:5 inferred_outlives
    pub(crate) fn inferred_outlives(tcx: TyCtxt<'_>) {
        for id in tcx.hir_free_items() {
            if !find_attr!(tcx, id.owner_id, RustcDumpInferredOutlives) {
                continue;
            }

            let preds = tcx.inferred_outlives_of(id.owner_id);
            let mut preds: Vec<_> = preds
                .iter()
                .map(|(pred, _)| match pred.kind().skip_binder() {
                    ty::ClauseKind::RegionOutlives(p) => p.to_string(),
                    ty::ClauseKind::TypeOutlives(p) => p.to_string(),
                    err => bug!("unexpected clause {:?}", err),
                })
                .collect();
            preds.sort();

            let span = tcx.def_span(id.owner_id);
            let mut err = tcx.dcx().struct_span_err(span, sym::rustc_dump_inferred_outlives.as_str());
            for pred in preds {
                err.note(pred);
            }
            err.emit();
        }
    }
}

/// rustc_hir_analysis/src/variance/dump.rs (crate-private upstream), verbatim.
mod variance_dump {
    use std::fmt::Write;

    use super::*;

    // upstream: compiler/rustc_hir_analysis/src/variance/dump.rs:8 format_variances
    fn format_variances(tcx: TyCtxt<'_>, def_id: LocalDefId) -> String {
        let variances = tcx.variances_of(def_id);
        let generics = GenericArgs::identity_for_item(tcx, def_id);
        // 7 = 2-letter parameter + ": " + 1-letter variance + ", "
        let mut ret = String::with_capacity(2 + 7 * variances.len());
        ret.push('[');
        for (arg, variance) in generics.iter().zip(variances.iter()) {
            write!(ret, "{arg}: {variance:?}, ").unwrap();
        }
        // Remove trailing `, `.
        if !variances.is_empty() {
            ret.pop();
            ret.pop();
        }
        ret.push(']');
        ret
    }

    // upstream: compiler/rustc_hir_analysis/src/variance/dump.rs:26 variances
    pub(crate) fn variances(tcx: TyCtxt<'_>) {
        let crate_items = tcx.hir_crate_items(());

        if find_attr!(tcx, crate, RustcDumpVariancesOfOpaques) {
            for id in crate_items.opaques() {
                tcx.dcx().span_err(tcx.def_span(id), format_variances(tcx, id));
            }
        }

        for id in crate_items.owners() {
            if !find_attr!(tcx, id, RustcDumpVariances) {
                continue;
            }

            match tcx.def_kind(id) {
                DefKind::AssocFn | DefKind::Fn | DefKind::Enum | DefKind::Struct | DefKind::Union => {
                    tcx.dcx().span_err(tcx.def_span(id), format_variances(tcx, id.def_id));
                }
                kind => {
                    let message = format!(
                        "attr parsing didn't report an error for `#[{}]` on {kind:?}",
                        rustc_span::sym::rustc_dump_variances,
                    );
                    tcx.dcx().span_delayed_bug(tcx.def_span(id), message);
                }
            }
        }
    }
}
