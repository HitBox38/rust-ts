//! Oracle probe of old_solve.test.ts (fixer lane merge-w18c): the old trait solver (traits/select, traits/project,
//! traits/fulfill, traits/query) on the small `#![no_core]` crates of ../../solve_test (goals.rs, proj.rs) and old.rs.
//!
//! A rustc-dev program (not a tools/probes probe: lanes may not edit tools/). Run it with `-Znext-solver=coherence`
//! (compiletest's argv), so `next_trait_solver_globally()` is false. In `after_expansion`, for every pair of free fns
//! `env_<name>` / `goals_<name>` (in `hir_crate_items` order):
//! - `infcx = tcx.infer_ctxt().build(TypingMode::non_body_analysis())` (the old solver);
//! - `param_env = ParamEnv::new(tcx, <env_<name>'s clauses_of, identity>)` (not elaborated);
//! - the goal args: `goals_<name>`'s params, with the type params named `I*` replaced by fresh inference variables;
//! - for every clause of `goals_<name>` (instantiated with those args), each in its own `infcx.probe`:
//!   - `eval_root:` `SelectionContext::new(&infcx).evaluate_root_obligation(&obligation)`;
//!   - `evaluate:` `infcx.evaluate_obligation(&obligation)` (the canonical `evaluate_obligation` query);
//!   - `query_normalize:` `infcx.at(&cause, param_env).query_normalize(predicate)`: the value and the obligations'
//!     predicates, or the error;
//!   - trait clauses: `select:` `SelectionContext::new(&infcx).poly_select(&trait_obligation)`;
//!   - projection clauses: `normalize:` `normalize_projection_term(&mut selcx, param_env, projection_term, cause, 0,
//!     &mut obligations)` and the obligations' predicates;
//! - one `FulfillmentEngine<FulfillmentError>` (the old `FulfillmentContext`) with every goal registered: the errors of
//!   `try_evaluate_obligations`, the pending count, the errors of `collect_remaining_errors`, then the goal args
//!   resolved with `deeply_resolve_ignoring_regions`.
//! old_solve_test/run.ts prints the same lines from the port. Returns `Compilation::Stop`.
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
use rustc_infer::infer::{InferCtxt, TyCtxtInferExt};
use rustc_infer::traits::{Obligation, ObligationCause, PolyTraitObligation, PredicateObligation, PredicateObligations, TraitEngine, TraitErrors};
use rustc_interface::interface;
use rustc_middle::ty::{self, GenericArgs, TyCtxt, TypingMode};
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::ErrorOutputType;
use rustc_span::DUMMY_SP;
use rustc_trait_selection::traits::query::evaluate_obligation::InferCtxtExt as _;
use rustc_trait_selection::traits::query::normalize::QueryNormalizeExt as _;
use rustc_trait_selection::traits::{
    FulfillmentEngine, FulfillmentError, FulfillmentErrorCode, SelectionContext, normalize_projection_term,
};

struct Probe;

fn code_str(code: &FulfillmentErrorCode<'_>) -> String {
    match code {
        FulfillmentErrorCode::Cycle(c) => format!("Cycle({})", c.len()),
        FulfillmentErrorCode::Select(e) => format!("Select({e:?})"),
        FulfillmentErrorCode::Project(e) => format!("Project({:?})", e.err),
        FulfillmentErrorCode::Outlives => "Outlives".to_string(),
        FulfillmentErrorCode::Subtype(..) => "Subtype".to_string(),
        FulfillmentErrorCode::ConstEquate(..) => "ConstEquate".to_string(),
        FulfillmentErrorCode::Ambiguity { overflow } => format!("Ambiguity(overflow={overflow:?})"),
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
    let infcx: InferCtxt<'tcx> = tcx.infer_ctxt().build(TypingMode::non_body_analysis());
    assert!(!infcx.next_trait_solver(), "run the probe with -Znext-solver=coherence");
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
        let obligation: PredicateObligation<'tcx> = Obligation::new(tcx, ObligationCause::dummy(), param_env, predicate);
        let r = infcx.probe(|_| SelectionContext::new(&infcx).evaluate_root_obligation(&obligation));
        writeln!(out, "    eval_root: {r:?}").unwrap();
        let r = infcx.probe(|_| infcx.evaluate_obligation(&obligation));
        writeln!(out, "    evaluate: {r:?}").unwrap();
        let r = infcx.probe(|_| {
            infcx.at(&ObligationCause::dummy(), param_env).query_normalize(predicate).map(|n| {
                let preds: Vec<_> = n.obligations.iter().map(|o| o.predicate).collect();
                format!("Ok({:?} {preds:?})", n.value)
            })
        });
        writeln!(out, "    query_normalize: {}", r.unwrap_or_else(|e| format!("Err({e:?})"))).unwrap();
        if let Some(trait_pred) = clause.as_trait_clause() {
            let o: PolyTraitObligation<'tcx> = Obligation::new(tcx, ObligationCause::dummy(), param_env, trait_pred);
            let sel = infcx.probe(|_| SelectionContext::new(&infcx).poly_select(&o));
            writeln!(out, "    select: {sel:?}").unwrap();
        }
        if let Some(proj) = clause.as_projection_clause() {
            let line = infcx.probe(|_| {
                let mut selcx = SelectionContext::new(&infcx);
                let mut obligations = PredicateObligations::new();
                let term = normalize_projection_term(
                    &mut selcx,
                    param_env,
                    proj.skip_binder().projection_term,
                    ObligationCause::dummy(),
                    0,
                    &mut obligations,
                );
                let preds: Vec<_> = obligations.iter().map(|o| o.predicate).collect();
                format!("{term:?} {preds:?}")
            });
            writeln!(out, "    normalize: {line}").unwrap();
        }
    }
    let mut engine = FulfillmentEngine::<FulfillmentError<'tcx>>::new(&infcx);
    for clause in &goals {
        let o: PredicateObligation<'tcx> = Obligation::new(tcx, ObligationCause::dummy(), param_env, clause.as_predicate());
        engine.register_predicate_obligation(&infcx, o);
    }
    errors(out, "try_evaluate", engine.try_evaluate_obligations(&infcx));
    writeln!(out, "  pending: {}", engine.pending_obligations().len()).unwrap();
    errors(out, "remaining", engine.collect_remaining_errors(&infcx));
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
