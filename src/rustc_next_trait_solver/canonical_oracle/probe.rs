//! Oracle probe of canonical.test.ts (lane nts-canonical): the next solver's `Canonicalizer`
//! (rustc_next_trait_solver canonical/canonicalizer.rs) on values with inference variables,
//! placeholders, params and free regions.
//!
//! A rustc-dev program (not a tools/probes probe: lanes may not edit tools/). It runs the pinned rustc on
//! its arguments and, in `after_expansion`, builds a next-solver `InferCtxt` (`TypingMode::Coherence`),
//! wraps it in a minimal `SolverDelegate` (`Probe`, only `build_with_canonical` does anything) and
//! canonicalizes with the real code:
//! - **response mode**: `rustc_next_trait_solver::canonical::make_canonical_state` (public), which runs
//!   `Canonicalizer::canonicalize_response` on `inspect::State { var_values, data }`;
//! - **input mode**: `SolverDelegateEvalExt::evaluate_root_goal` on `WellFormed(<tuple>)` with an empty
//!   `ParamEnv`; it canonicalizes the goal with `canonicalize_goal` (`Canonicalizer::canonicalize_input`)
//!   and reaches `Probe::build_with_canonical`, which records the `CanonicalQueryInput` and unwinds.
//!   The original values come from `evaluate_root_goal_for_proof_tree` (`GoalEvaluation::orig_values`).
//! Each case prints `{:?}` of the pieces. Returns `Compilation::Stop`.
//! Build: rustc +nightly --edition 2024 probe.rs -o probe -C link-arg=-Wl,-rpath,$(rustc +nightly --print sysroot)/lib
#![feature(rustc_private)]
#![allow(deprecated)]
extern crate rustc_driver;
extern crate rustc_infer;
extern crate rustc_interface;
extern crate rustc_middle;
extern crate rustc_next_trait_solver;
extern crate rustc_session;
extern crate rustc_span;
extern crate rustc_type_ir;

use std::cell::RefCell;
use std::io::Write as _;
use std::ops::Deref;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::process::ExitCode;

use rustc_driver::{Callbacks, Compilation};
use rustc_infer::infer::canonical::CanonicalExt as _;
use rustc_infer::infer::{InferCtxt, RegionVariableOrigin, TyCtxtInferExt};
use rustc_interface::interface;
use rustc_middle::ty::{self, GenericArg, Ty, TyCtxt, TypingMode};
use rustc_next_trait_solver::canonical::make_canonical_state;
use rustc_next_trait_solver::delegate::SolverDelegate;
use rustc_next_trait_solver::solve::SolverDelegateEvalExt;
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::ErrorOutputType;
use rustc_span::{DUMMY_SP, Span, Symbol};
use rustc_type_ir::solve::{Certainty, ComputeGoalFastPathOutcome, FetchEligibleAssocItemResponse, Goal, NoSolution, QueryInput, VisibleForLeakCheck};
use rustc_type_ir::{BoundVar, CanonicalQueryInput, CanonicalVarValues, InferCtxtLike, UniverseIndex};

thread_local! {
    static SEEN: RefCell<Option<String>> = const { RefCell::new(None) };
}

struct Probe<'tcx>(InferCtxt<'tcx>);

impl<'tcx> Deref for Probe<'tcx> {
    type Target = InferCtxt<'tcx>;
    fn deref(&self) -> &InferCtxt<'tcx> {
        &self.0
    }
}

impl<'tcx> SolverDelegate for Probe<'tcx> {
    type Infcx = InferCtxt<'tcx>;
    type Interner = TyCtxt<'tcx>;

    fn build_with_canonical<V>(
        _cx: TyCtxt<'tcx>,
        canonical: &CanonicalQueryInput<TyCtxt<'tcx>, V>,
    ) -> (Self, V, CanonicalVarValues<TyCtxt<'tcx>>)
    where
        V: rustc_type_ir::TypeFoldable<TyCtxt<'tcx>>,
    {
        type Q<'a> = CanonicalQueryInput<TyCtxt<'a>, QueryInput<TyCtxt<'a>, ty::Predicate<'a>>>;
        assert_eq!(size_of::<V>(), size_of::<QueryInput<TyCtxt<'tcx>, ty::Predicate<'tcx>>>());
        // SAFETY: the only `V` is `QueryInput<I, I::Predicate>` (`EvalCtxt::enter_canonical`).
        let q: &Q<'tcx> = unsafe { &*(canonical as *const CanonicalQueryInput<TyCtxt<'tcx>, V> as *const Q<'tcx>) };
        let c = &q.canonical;
        let term = match c.value.goal.predicate.kind().skip_binder() {
            ty::PredicateKind::Clause(ty::ClauseKind::WellFormed(t)) => format!("{:?}", t),
            k => format!("other {:?}", k),
        };
        let s = format!(
            "  max_universe: {:?}\n  var_kinds: {:?}\n  term: {}\n  opaques: {:?}\n",
            c.max_universe, c.var_kinds, term, c.value.predefined_opaques_in_body
        );
        SEEN.with(|x| *x.borrow_mut() = Some(s));
        panic!("probe: canonical input recorded");
    }
    fn compute_goal_fast_path(&self, _: Goal<TyCtxt<'tcx>, ty::Predicate<'tcx>>, _: Span) -> ComputeGoalFastPathOutcome<TyCtxt<'tcx>> {
        ComputeGoalFastPathOutcome::NoFastPath
    }
    fn fresh_var_for_kind(&self, _: GenericArg<'tcx>, _: Span, _: UniverseIndex) -> GenericArg<'tcx> {
        unimplemented!()
    }
    fn leak_check(&self, _: UniverseIndex) -> Result<(), NoSolution> {
        unimplemented!()
    }
    fn evaluate_const<E: std::fmt::Debug>(
        &self,
        _: ty::ParamEnv<'tcx>,
        _: rustc_type_ir::AliasConst<TyCtxt<'tcx>>,
        _: impl FnOnce(rustc_type_ir::Unnormalized<TyCtxt<'tcx>, Ty<'tcx>>) -> Result<Ty<'tcx>, E>,
    ) -> Result<Option<ty::Const<'tcx>>, E> {
        unimplemented!()
    }
    fn well_formed_goals(&self, _: ty::ParamEnv<'tcx>, _: ty::Term<'tcx>) -> Option<Vec<Goal<TyCtxt<'tcx>, ty::Predicate<'tcx>>>> {
        unimplemented!()
    }
    fn make_deduplicated_region_constraints(&self) -> Vec<(rustc_type_ir::RegionConstraint<TyCtxt<'tcx>>, VisibleForLeakCheck)> {
        unimplemented!()
    }
    // As rustc_trait_selection's delegate (`evaluate_root_goal_for_proof_tree` applies the response).
    fn instantiate_canonical<V>(&self, canonical: rustc_type_ir::Canonical<TyCtxt<'tcx>, V>, values: CanonicalVarValues<TyCtxt<'tcx>>) -> V
    where
        V: rustc_type_ir::TypeFoldable<TyCtxt<'tcx>>,
    {
        canonical.instantiate(self.tcx, &values)
    }
    fn instantiate_canonical_var(
        &self,
        kind: rustc_type_ir::CanonicalVarKind<TyCtxt<'tcx>>,
        span: Span,
        var_values: &[GenericArg<'tcx>],
        universe_map: impl Fn(UniverseIndex) -> UniverseIndex,
    ) -> GenericArg<'tcx> {
        self.0.instantiate_canonical_var(span, kind, var_values, universe_map)
    }
    fn add_item_bounds_for_hidden_type(
        &self,
        _: rustc_span::def_id::DefId,
        _: ty::GenericArgsRef<'tcx>,
        _: ty::ParamEnv<'tcx>,
        _: Ty<'tcx>,
        _: &mut Vec<Goal<TyCtxt<'tcx>, ty::Predicate<'tcx>>>,
    ) {
        unimplemented!()
    }
    fn fetch_eligible_assoc_item(
        &self,
        _: ty::TraitRef<'tcx>,
        _: rustc_span::def_id::DefId,
        _: rustc_span::def_id::DefId,
    ) -> FetchEligibleAssocItemResponse<TyCtxt<'tcx>> {
        unimplemented!()
    }
    fn is_transmutable(&self, _: Ty<'tcx>, _: Ty<'tcx>, _: ty::Const<'tcx>) -> Result<Certainty, NoSolution> {
        unimplemented!()
    }
    fn emit_next_solver_overflow_fcw(&self, _: Goal<TyCtxt<'tcx>, ty::Predicate<'tcx>>, _: Span) {
        unimplemented!()
    }
}

/// The variables of every case, created in this order in a fresh `InferCtxt` (the TS test mirrors the vids).
struct Vars<'tcx> {
    u1: UniverseIndex,
    u2: UniverseIndex,
    t0: Ty<'tcx>,
    t1: Ty<'tcx>,
    t2: Ty<'tcx>,
    i0: Ty<'tcx>,
    f0: Ty<'tcx>,
    r0: ty::Region<'tcx>,
    r1: ty::Region<'tcx>,
    c0: ty::Const<'tcx>,
    ph_t: Ty<'tcx>,
    ph_r: ty::Region<'tcx>,
    ph_r0: ty::Region<'tcx>,
    ph_c: ty::Const<'tcx>,
}

fn vars<'tcx>(tcx: TyCtxt<'tcx>, infcx: &InferCtxt<'tcx>) -> Vars<'tcx> {
    let u1 = InferCtxtLike::create_next_universe(infcx);
    let u2 = InferCtxtLike::create_next_universe(infcx);
    let t0 = infcx.next_ty_var_in_universe(DUMMY_SP, UniverseIndex::ROOT);
    let t1 = infcx.next_ty_var_in_universe(DUMMY_SP, u2);
    let t2 = infcx.next_ty_var_in_universe(DUMMY_SP, u1);
    let (ty::Infer(ty::TyVar(v0)), ty::Infer(ty::TyVar(v2))) = (t0.kind(), t2.kind()) else { unreachable!() };
    InferCtxtLike::sub_unify_ty_vids_raw(infcx, *v2, *v0);
    let i0 = infcx.next_int_var();
    let f0 = infcx.next_float_var(DUMMY_SP, None);
    let r0 = infcx.next_region_var_in_universe(RegionVariableOrigin::Misc(DUMMY_SP), UniverseIndex::ROOT);
    let r1 = infcx.next_region_var_in_universe(RegionVariableOrigin::Misc(DUMMY_SP), u2);
    let c0 = infcx.next_const_var_in_universe(DUMMY_SP, u2);
    let ph_t = Ty::new_placeholder(tcx, ty::PlaceholderType::new_anon(u2, BoundVar::from_u32(0)));
    let ph_r = ty::Region::new_placeholder(tcx, ty::PlaceholderRegion::new_anon(u2, BoundVar::from_u32(1)));
    let ph_r0 = ty::Region::new_placeholder(tcx, ty::PlaceholderRegion::new_anon(UniverseIndex::ROOT, BoundVar::from_u32(3)));
    let ph_c = ty::Const::new_placeholder(tcx, ty::PlaceholderConst::new_anon(u2, BoundVar::from_u32(2)));
    Vars { u1, u2, t0, t1, t2, i0, f0, r0, r1, c0, ph_t, ph_r, ph_r0, ph_c }
}

fn infcx<'tcx>(tcx: TyCtxt<'tcx>) -> Probe<'tcx> {
    Probe(tcx.infer_ctxt().with_next_trait_solver(true).build(TypingMode::Coherence))
}

fn response_case<'tcx>(out: &mut String, tcx: TyCtxt<'tcx>, label: &str, max: fn(&Vars<'tcx>) -> UniverseIndex, build: fn(TyCtxt<'tcx>, &InferCtxt<'tcx>, &Vars<'tcx>) -> (Vec<GenericArg<'tcx>>, Ty<'tcx>)) {
    let d = infcx(tcx);
    let v = vars(tcx, &d);
    let (var_values, data) = build(tcx, &d, &v);
    let r = catch_unwind(AssertUnwindSafe(|| make_canonical_state(&d, &var_values, max(&v), data)));
    match r {
        Ok(c) => out.push_str(&format!("response {label}\n  {:?}\n", c)),
        Err(e) => out.push_str(&format!("response {label}\n  panic: {}\n", panic_msg(e))),
    }
}

fn input_case<'tcx>(out: &mut String, tcx: TyCtxt<'tcx>, label: &str, with_orig_values: bool, build: fn(TyCtxt<'tcx>, &Vars<'tcx>) -> Ty<'tcx>) {
    let pred = |d: &Probe<'tcx>| {
        let v = vars(tcx, d);
        let t = build(tcx, &v);
        let p: ty::Predicate<'tcx> = ty::Binder::dummy(ty::PredicateKind::Clause(ty::ClauseKind::WellFormed(t.into()))).upcast(tcx);
        Goal::new(tcx, ty::ParamEnv::empty(), p)
    };
    out.push_str(&format!("input {label}\n"));
    // canonical input
    let d = infcx(tcx);
    let goal = pred(&d);
    SEEN.with(|x| *x.borrow_mut() = None);
    let r = catch_unwind(AssertUnwindSafe(|| d.evaluate_root_goal(goal, DUMMY_SP, None)));
    match SEEN.with(|x| x.borrow_mut().take()) {
        Some(s) => out.push_str(&s),
        None => out.push_str(&format!("  no canonical input: {}\n", match r { Err(e) => panic_msg(e), Ok(_) => "returned".into() })),
    }
    if !with_orig_values {
        return;
    }
    // original values
    let d = infcx(tcx);
    let goal = pred(&d);
    let r = catch_unwind(AssertUnwindSafe(|| d.evaluate_root_goal_for_proof_tree(goal, DUMMY_SP).1.orig_values));
    match r {
        Ok(v) => out.push_str(&format!("  orig_values: {:?}\n", v)),
        Err(e) => out.push_str(&format!("  orig_values panic: {}\n", panic_msg(e))),
    }
}

fn panic_msg(e: Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = e.downcast_ref::<&str>() {
        s.to_string()
    } else if let Some(s) = e.downcast_ref::<String>() {
        s.clone()
    } else {
        "?".into()
    }
}

use rustc_middle::ty::Upcast as _;

fn r#ref<'tcx>(tcx: TyCtxt<'tcx>, r: ty::Region<'tcx>, t: Ty<'tcx>) -> Ty<'tcx> {
    Ty::new_ref(tcx, r, t, ty::Mutability::Not)
}

struct Cb;
impl Callbacks for Cb {
    fn after_expansion<'tcx>(&mut self, _c: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        std::panic::set_hook(Box::new(|_| {}));
        let mut out = String::new();
        // ---- response mode (`make_canonical_state`)
        response_case(&mut out, tcx, "all-u1", |v| v.u1, |tcx, _, v| {
            let u8_ = tcx.types.u8;
            let arr = Ty::new_array_with_const_len(tcx, u8_, v.c0);
            let carr = Ty::new_array_with_const_len(tcx, u8_, v.ph_c);
            let data = Ty::new_tup(tcx, &[
                v.t0, r#ref(tcx, v.r0, v.t1), v.t2, v.i0, v.f0, arr, r#ref(tcx, v.r1, v.ph_t),
                r#ref(tcx, tcx.lifetimes.re_static, u8_), r#ref(tcx, tcx.lifetimes.re_erased, u8_),
                r#ref(tcx, v.ph_r, u8_), r#ref(tcx, v.ph_r0, u8_), carr, Ty::new_tup(tcx, &[v.t0, u8_]),
                Ty::new_tup(tcx, &[v.t0, u8_]), v.t1, r#ref(tcx, v.r0, u8_),
            ]);
            (vec![v.t1.into(), v.r1.into()], data)
        });
        response_case(&mut out, tcx, "all-u2", |v| v.u2, |tcx, _, v| {
            let data = Ty::new_tup(tcx, &[v.t0, v.t1, v.t2, r#ref(tcx, v.r1, v.t0), Ty::new_array_with_const_len(tcx, tcx.types.u8, v.c0)]);
            (vec![], data)
        });
        response_case(&mut out, tcx, "root", |_| UniverseIndex::ROOT, |tcx, _, v| {
            let data = Ty::new_tup(tcx, &[v.t1, v.t2, v.t0, r#ref(tcx, v.r1, v.ph_t), v.i0]);
            (vec![v.t0.into()], data)
        });
        response_case(&mut out, tcx, "placeholder-in-input-universe", |v| v.u2, |tcx, _, v| {
            (vec![], r#ref(tcx, v.ph_r, tcx.types.u8))
        });
        response_case(&mut out, tcx, "many", |v| v.u1, |tcx, infcx, v| {
            // More than 16 variables: `get_or_insert_bound_var` switches to `variable_lookup_table`.
            let fresh: Vec<Ty<'_>> = (0..18).map(|_| infcx.next_ty_var(DUMMY_SP)).collect();
            let mut tys = vec![v.t0, v.t2];
            tys.extend(fresh.iter().copied());
            tys.push(v.t0);
            tys.push(fresh[17]);
            tys.push(fresh[3]);
            tys.push(r#ref(tcx, v.r0, fresh[0]));
            (vec![fresh[5].into()], Ty::new_tup(tcx, &tys))
        });
        // ---- input mode (`canonicalize_goal` on `WellFormed(tuple)`)
        input_case(&mut out, tcx, "all", true, |tcx, v| {
            let u8_ = tcx.types.u8;
            Ty::new_tup(tcx, &[
                v.t0, r#ref(tcx, v.r0, v.t1), v.t2, v.i0, v.f0, Ty::new_array_with_const_len(tcx, u8_, v.c0),
                r#ref(tcx, v.r1, v.ph_t), r#ref(tcx, tcx.lifetimes.re_static, u8_), r#ref(tcx, tcx.lifetimes.re_erased, u8_),
                r#ref(tcx, v.ph_r, u8_), Ty::new_tup(tcx, &[v.t0, u8_]),
                Ty::new_tup(tcx, &[v.t0, u8_]), v.t1, r#ref(tcx, v.r0, v.ph_t), r#ref(tcx, tcx.lifetimes.re_static, v.t2),
                r#ref(tcx, v.ph_r0, u8_),
            ])
        });
        // Params and placeholder consts become placeholders; the solver itself rejects them in `WellFormed`
        // ("cannot find .. in param-env"), so no original values here.
        input_case(&mut out, tcx, "params", false, |tcx, v| {
            let u8_ = tcx.types.u8;
            let p_t = Ty::new_param(tcx, 0, Symbol::intern("T"));
            let p_n = ty::Const::new_param(tcx, ty::ParamConst::new(1, Symbol::intern("N")));
            Ty::new_tup(tcx, &[p_t, v.t0, Ty::new_array_with_const_len(tcx, u8_, p_n), r#ref(tcx, v.r0, p_t), p_t, Ty::new_array_with_const_len(tcx, u8_, v.ph_c)])
        });
        std::io::stdout().write_all(out.as_bytes()).unwrap();
        Compilation::Stop
    }
}

fn main() -> ExitCode {
    let early_dcx = EarlyDiagCtxt::new(ErrorOutputType::default());
    rustc_driver::install_ice_hook(rustc_driver::DEFAULT_BUG_REPORT_URL, |_| ());
    let mut callbacks = Cb;
    rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&rustc_driver::args::raw_args(&early_dcx), &mut callbacks))
}
