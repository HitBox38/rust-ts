//! Oracle probe of solve.test.ts (lane trait-sel-solve): rustc_trait_selection's next-solver glue (`SolverDelegate`,
//! `FulfillmentCtxt`, `inspect::analyse`, `select`) on small `#![no_core]` goals.
//!
//! A rustc-dev program (not a tools/probes probe: lanes may not edit tools/). It runs the pinned rustc on its arguments
//! and, in `after_expansion`, for every pair of free fns `env_<name>` / `goals_<name>` (in `hir_crate_items` order):
//! - builds `infcx = tcx.infer_ctxt().with_next_trait_solver(true).build(TypingMode::non_body_analysis())`;
//! - `param_env = ParamEnv::new(tcx, <env_<name>'s clauses_of, identity>)` (not elaborated);
//! - the goal args: `goals_<name>`'s params, with the type params named `I*` replaced by fresh inference variables;
//! - for every clause of `goals_<name>` (instantiated with those args):
//!   - `visit_proof_tree` with a visitor that prints the root `result()`, every candidate's kind and `result()`, and,
//!     in a probe, the nested goals of the unique applicable candidate;
//!   - for trait clauses, `select_in_new_trait_solver` (in a probe);
//! - one `FulfillmentCtxt<FulfillmentError>` with every goal registered: the errors of `try_evaluate_obligations`, then
//!   of `collect_remaining_errors`, then the goal args resolved with `deeply_resolve_ignoring_regions`.
//! solve_test/run.ts prints the same lines from the port. Returns `Compilation::Stop`.
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
extern crate rustc_type_ir;

use std::fmt::Write as _;
use std::io::Write as _;
use std::process::ExitCode;

use rustc_driver::{Callbacks, Compilation};
use rustc_infer::infer::{InferCtxt, TyCtxtInferExt};
use rustc_infer::traits::{Obligation, ObligationCause, PredicateObligation, TraitEngine, TraitErrors};
use rustc_interface::interface;
use rustc_middle::ty::{self, GenericArgs, TyCtxt, TypingMode};
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::ErrorOutputType;
use rustc_span::DUMMY_SP;
use rustc_trait_selection::solve::inspect::{InferCtxtProofTreeExt, InspectGoal, ProbeKind, ProofTreeVisitor};
use rustc_trait_selection::solve::{FulfillmentCtxt, InferCtxtSelectExt};
use rustc_trait_selection::traits::{FulfillmentError, FulfillmentErrorCode};
use rustc_type_ir::solve::Goal;

struct Probe;

fn kind_str(kind: ProbeKind<TyCtxt<'_>>) -> String {
    match kind {
        ProbeKind::Root { .. } => "Root".to_string(),
        ProbeKind::TraitCandidate { source, .. } => format!("TraitCandidate({source:?})"),
        ProbeKind::OpaqueTypeStorageLookup { .. } => "OpaqueTypeStorageLookup".to_string(),
        ProbeKind::RigidAlias { .. } => "RigidAlias".to_string(),
        ProbeKind::NormalizedSelfTyAssembly => "NormalizedSelfTyAssembly".to_string(),
        ProbeKind::UnsizeAssembly => "UnsizeAssembly".to_string(),
        ProbeKind::ProjectionCompatibility => "ProjectionCompatibility".to_string(),
        ProbeKind::ShadowedEnvProbing => "ShadowedEnvProbing".to_string(),
    }
}

fn code_str(code: &FulfillmentErrorCode<'_>) -> String {
    match code {
        FulfillmentErrorCode::Cycle(_) => "Cycle".to_string(),
        FulfillmentErrorCode::Select(e) => format!("Select({e:?})"),
        FulfillmentErrorCode::Project(_) => "Project".to_string(),
        FulfillmentErrorCode::Outlives => "Outlives".to_string(),
        FulfillmentErrorCode::Subtype(..) => "Subtype".to_string(),
        FulfillmentErrorCode::ConstEquate(..) => "ConstEquate".to_string(),
        FulfillmentErrorCode::Ambiguity { overflow } => format!("Ambiguity(overflow={overflow:?})"),
    }
}

/// Prints the root result, the candidates and the unique candidate's nested goals.
struct Dump {
    out: String,
}

impl<'tcx> ProofTreeVisitor<'tcx> for Dump {
    type Result = ();

    fn span(&self) -> rustc_span::Span {
        DUMMY_SP
    }

    fn visit_goal(&mut self, goal: &InspectGoal<'_, 'tcx>) {
        writeln!(self.out, "    result: {:?}", goal.result()).unwrap();
        for cand in goal.candidates() {
            writeln!(self.out, "    candidate: {} {:?} shallow={:?}", kind_str(cand.kind()), cand.result(), cand.shallow_certainty()).unwrap();
        }
        if let Some(cand) = goal.unique_applicable_candidate() {
            goal.infcx().probe(|_| {
                for nested in cand.instantiate_nested_goals(DUMMY_SP) {
                    writeln!(self.out, "    nested: {:?} {:?} {:?}", nested.source(), nested.goal().predicate, nested.result()).unwrap();
                }
            });
        }
    }
}

fn errors<'tcx>(out: &mut String, label: &str, errs: TraitErrors<FulfillmentError<'tcx>>) {
    match errs {
        TraitErrors::NoErrors => writeln!(out, "  {label}: []").unwrap(),
        TraitErrors::HasErrors(errs) => {
            for e in errs {
                writeln!(out, "  {label}: {:?} code={} root={:?}", e.obligation.predicate, code_str(&e.code), e.root_obligation.predicate).unwrap();
            }
        }
    }
}

fn case<'tcx>(out: &mut String, tcx: TyCtxt<'tcx>, name: &str, env_fn: rustc_span::def_id::DefId, goals_fn: rustc_span::def_id::DefId) {
    writeln!(out, "case {name}").unwrap();
    let infcx: InferCtxt<'tcx> = tcx.infer_ctxt().with_next_trait_solver(true).build(TypingMode::non_body_analysis());
    let param_env = ty::ParamEnv::new(
        tcx,
        tcx.clauses_of(env_fn).instantiate_identity(tcx).into_iter().map(|(c, _)| c.skip_norm_wip()),
    );
    writeln!(out, "  env: {:?}", param_env.caller_bounds().collect::<Vec<_>>()).unwrap();
    let args = GenericArgs::for_item(tcx, goals_fn, |param, _| {
        if param.name.as_str().starts_with('I') { infcx.var_for_def(DUMMY_SP, param) } else { tcx.mk_param_from_def(param) }
    });
    writeln!(out, "  args: {args:?}").unwrap();
    let goals: Vec<_> =
        tcx.clauses_of(goals_fn).instantiate(tcx, args).into_iter().map(|(c, _)| c.skip_norm_wip()).collect();
    for (i, clause) in goals.iter().enumerate() {
        let predicate: ty::Predicate<'tcx> = clause.as_predicate();
        writeln!(out, "  goal {i}: {predicate:?}").unwrap();
        let mut dump = Dump { out: String::new() };
        infcx.probe(|_| infcx.visit_proof_tree(Goal::new(tcx, param_env, predicate), &mut dump));
        out.push_str(&dump.out);
        if let Some(trait_pred) = clause.as_trait_clause() {
            let obligation = Obligation::new(tcx, ObligationCause::dummy(), param_env, trait_pred);
            let sel = infcx.probe(|_| infcx.select_in_new_trait_solver(&obligation));
            writeln!(out, "    select: {sel:?}").unwrap();
        }
    }
    let mut fcx = FulfillmentCtxt::<FulfillmentError<'tcx>>::new(&infcx);
    for clause in &goals {
        let o: PredicateObligation<'tcx> = Obligation::new(tcx, ObligationCause::dummy(), param_env, clause.as_predicate());
        fcx.register_predicate_obligation(&infcx, o);
    }
    errors(out, "try_evaluate", fcx.try_evaluate_obligations(&infcx));
    writeln!(out, "  pending: {}", fcx.pending_obligations().len()).unwrap();
    errors(out, "remaining", fcx.collect_remaining_errors(&infcx));
    writeln!(out, "  resolved: {:?}", infcx.deeply_resolve_ignoring_regions(args)).unwrap();
}

impl Callbacks for Probe {
    fn after_expansion<'tcx>(&mut self, _compiler: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        let mut out = String::new();
        // The free fns, by name.
        let items: Vec<_> = tcx
            .hir_crate_items(())
            .free_items()
            .map(|id| id.owner_id.to_def_id())
            .filter(|&d| matches!(tcx.def_kind(d), rustc_hir::def::DefKind::Fn))
            .map(|d| (d, tcx.item_name(d).to_string()))
            .collect();
        for (goals_fn, goals_name) in &items {
            let Some(name) = goals_name.strip_prefix("goals_") else { continue };
            let Some(&(env_fn, _)) = items.iter().find(|(_, n)| *n == format!("env_{name}")) else {
                continue;
            };
            let goals_fn = *goals_fn;
            case(&mut out, tcx, name, env_fn, goals_fn);
        }
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
