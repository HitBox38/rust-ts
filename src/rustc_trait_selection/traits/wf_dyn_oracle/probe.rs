//! Oracle probe of wf_dyn.test.ts (lane trait-sel-traits-b): rustc_trait_selection traits/wf.rs and
//! traits/dyn_compatibility.rs on the items of a crate.
//!
//! A rustc-dev program (not a tools/probes probe: lanes may not edit tools/). It runs the pinned rustc on its arguments
//! and, in `after_expansion`, prints for every local item in `DefIndex` order (under `with_no_trimmed_paths!`):
//! - a trait: `generics_require_sized_self`, `dyn_compatibility_violations`, `is_dyn_compatible`,
//!   `hir_ty_lowering_dyn_compatibility_violations`, `object_region_bounds` of `dyn Trait` (traits whose only generic
//!   parameter is `Self`), and per associated item `dyn_compatibility_violations_for_assoc_item` (+ `is_vtable_safe_method`
//!   for fns);
//! - a type alias: `wf::obligations` and `wf::unnormalized_obligations` of its type;
//! - a trait impl: `wf::trait_obligations` of its trait ref (`ClausePolarity` from the impl's polarity);
//! - a fn: `wf::clause_obligations` of each of its own clauses.
//! - `== hand-built`: `wf::obligations` / `wf::unnormalized_obligations` on types with inference variables.
//! WF obligations are computed in a next-solver `InferCtxt` (`wf::normalize` keeps them unnormalized) with an empty
//! `ParamEnv`; each obligation prints as `<predicate:?> | <cause code:?> | depth <n>`.
//! wf_dyn_oracle/run.ts prints the same lines from the port. Returns `Compilation::Stop`.
//! Build: rustc +nightly --edition 2024 probe.rs -o probe -C link-arg=-Wl,-rpath,$(rustc +nightly --print sysroot)/lib
#![feature(rustc_private)]
#![allow(deprecated)]
extern crate rustc_driver;
extern crate rustc_hir;
extern crate rustc_infer;
extern crate rustc_interface;
extern crate rustc_middle;
extern crate rustc_session;
extern crate rustc_span;
extern crate rustc_trait_selection;

use std::fmt::Write as _;
use std::io::Write as _;
use std::process::ExitCode;

use rustc_driver::{Callbacks, Compilation};
use rustc_hir::def::DefKind;
use rustc_infer::infer::TyCtxtInferExt;
use rustc_infer::traits::PredicateObligations;
use rustc_interface::interface;
use rustc_middle::ty::print::with_no_trimmed_paths;
use rustc_middle::ty::{self, TyCtxt, TypingMode};
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::ErrorOutputType;
use rustc_span::DUMMY_SP;
use rustc_trait_selection::traits::{self, wf};

struct Probe;

fn obls(out: &mut String, name: &str, o: Option<PredicateObligations<'_>>) {
    match o {
        None => writeln!(out, "  {name} None").unwrap(),
        Some(o) => {
            writeln!(out, "  {name} ({})", o.len()).unwrap();
            for ob in o {
                writeln!(out, "    {:?} | {:?} | depth {}", ob.predicate, ob.cause.code(), ob.recursion_depth).unwrap();
            }
        }
    }
}

fn dump(tcx: TyCtxt<'_>) -> String {
    let mut out = String::new();
    for local_id in tcx.hir_crate_items(()).definitions() {
        let def_id = local_id.to_def_id();
        let kind = tcx.def_kind(def_id);
        match kind {
            DefKind::Trait => {
                writeln!(out, "== {:?} {:?}", def_id, kind).unwrap();
                writeln!(out, "  generics_require_sized_self {}", tcx.generics_require_sized_self(def_id)).unwrap();
                writeln!(out, "  dyn_compatibility_violations {:?}", tcx.dyn_compatibility_violations(def_id)).unwrap();
                writeln!(out, "  is_dyn_compatible {}", tcx.is_dyn_compatible(def_id)).unwrap();
                writeln!(
                    out,
                    "  hir_ty_lowering_dyn_compatibility_violations {:?}",
                    traits::hir_ty_lowering_dyn_compatibility_violations(tcx, def_id)
                )
                .unwrap();
                if tcx.generics_of(def_id).count() == 1 {
                    let pred = ty::Binder::dummy(ty::ExistentialPredicate::Trait(ty::ExistentialTraitRef::new(
                        tcx,
                        def_id,
                        [] as [ty::GenericArg<'_>; 0],
                    )));
                    let list = tcx.mk_poly_existential_predicates(&[pred]);
                    writeln!(out, "  object_region_bounds {:?}", wf::object_region_bounds(tcx, list)).unwrap();
                }
                for item in tcx.associated_items(def_id).in_definition_order() {
                    let name = item.name();
                    writeln!(
                        out,
                        "  assoc {name} dyn_compatibility_violations_for_assoc_item {:?}",
                        traits::dyn_compatibility_violations_for_assoc_item(tcx, def_id, *item)
                    )
                    .unwrap();
                    if item.is_fn() {
                        writeln!(out, "  assoc {name} is_vtable_safe_method {}", traits::is_vtable_safe_method(tcx, def_id, *item)).unwrap();
                    }
                }
            }
            DefKind::TyAlias => {
                writeln!(out, "== {:?} {:?}", def_id, kind).unwrap();
                let ty = tcx.type_of(def_id).instantiate_identity().skip_norm_wip();
                let infcx = tcx.infer_ctxt().with_next_trait_solver(true).build(TypingMode::non_body_analysis());
                let pe = ty::ParamEnv::empty();
                obls(&mut out, "obligations", wf::obligations(&infcx, pe, local_id, 0, ty.into(), DUMMY_SP));
                obls(&mut out, "unnormalized_obligations", wf::unnormalized_obligations(&infcx, pe, ty.into(), DUMMY_SP, local_id));
            }
            DefKind::Impl { of_trait: true } => {
                writeln!(out, "== {:?} {:?}", def_id, kind).unwrap();
                let trait_ref = tcx.impl_trait_ref(def_id).instantiate_identity().skip_norm_wip();
                let polarity = match tcx.impl_polarity(def_id) {
                    ty::ImplPolarity::Negative => ty::ClausePolarity::Negative,
                    _ => ty::ClausePolarity::Positive,
                };
                let trait_pred = ty::TraitClause { trait_ref, polarity };
                let infcx = tcx.infer_ctxt().with_next_trait_solver(true).build(TypingMode::non_body_analysis());
                let pe = ty::ParamEnv::empty();
                let item = tcx.hir_expect_item(local_id);
                obls(&mut out, "trait_obligations", Some(wf::trait_obligations(&infcx, pe, local_id, trait_pred, DUMMY_SP, item)));
            }
            DefKind::Fn => {
                writeln!(out, "== {:?} {:?}", def_id, kind).unwrap();
                let infcx = tcx.infer_ctxt().with_next_trait_solver(true).build(TypingMode::non_body_analysis());
                let pe = ty::ParamEnv::empty();
                for &(clause, span) in tcx.clauses_of(def_id).clauses {
                    writeln!(out, "  clause {:?}", clause).unwrap();
                    obls(&mut out, "clause_obligations", Some(wf::clause_obligations(&infcx, pe, local_id, clause, span)));
                }
            }
            _ => {}
        }
    }
    hand_built(tcx, &mut out);
    out
}

/// `wf::obligations` / `wf::unnormalized_obligations` on types built by hand in a fresh next-solver `InferCtxt`
/// (inference variables: the cycle cases of `obligations`, the `Infer` arms of `visit_ty` / `visit_const`).
fn hand_built(tcx: TyCtxt<'_>, out: &mut String) {
    writeln!(out, "== hand-built").unwrap();
    let infcx = tcx.infer_ctxt().with_next_trait_solver(true).build(TypingMode::non_body_analysis());
    let pe = ty::ParamEnv::empty();
    let body = rustc_span::def_id::CRATE_DEF_ID;
    let v = infcx.next_ty_var(DUMMY_SP);
    let i = infcx.next_int_var();
    let c = infcx.next_const_var(DUMMY_SP);
    let r = ty::Ty::new_imm_ref(tcx, tcx.lifetimes.re_static, v);
    let t = ty::Ty::new_tup(tcx, &[i, r, tcx.types.bool]);
    obls(out, "obligations ?0", wf::obligations(&infcx, pe, body, 0, v.into(), DUMMY_SP));
    obls(out, "obligations ?c", wf::obligations(&infcx, pe, body, 0, c.into(), DUMMY_SP));
    obls(out, "obligations ?int", wf::obligations(&infcx, pe, body, 0, i.into(), DUMMY_SP));
    obls(out, "obligations &'static ?0", wf::obligations(&infcx, pe, body, 0, r.into(), DUMMY_SP));
    obls(out, "obligations (?int, &'static ?0, bool) depth 3", wf::obligations(&infcx, pe, body, 3, t.into(), DUMMY_SP));
    obls(out, "unnormalized_obligations ?0", wf::unnormalized_obligations(&infcx, pe, v.into(), DUMMY_SP, body));
    obls(out, "unnormalized_obligations &'static ?0", wf::unnormalized_obligations(&infcx, pe, r.into(), DUMMY_SP, body));
}

impl Callbacks for Probe {
    fn after_expansion<'tcx>(&mut self, _compiler: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        let out = with_no_trimmed_paths!(dump(tcx));
        std::io::stdout().write_all(out.as_bytes()).unwrap();
        Compilation::Stop
    }
}

fn main() -> ExitCode {
    let early_dcx = EarlyDiagCtxt::new(ErrorOutputType::default());
    rustc_driver::install_ice_hook(rustc_driver::DEFAULT_BUG_REPORT_URL, |_| ());
    let mut callbacks = Probe;
    rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&rustc_driver::args::raw_args(&early_dcx), &mut callbacks))
}
