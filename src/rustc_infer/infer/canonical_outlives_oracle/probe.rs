//! Oracle probe of infer_canonical_outlives.test.ts (lane infer-canonical-outlives): rustc_infer's old-solver
//! canonicalizer (canonical/canonicalizer.rs), `instantiate_canonical` (canonical/mod.rs, instantiate.rs),
//! `TypeOutlives` (outlives/obligations.rs, verify.rs) and `extract_verify_if_eq` (outlives/test_type_match.rs).
//!
//! A rustc-dev program (not a tools/probes probe: lanes may not edit tools/). It runs the pinned rustc on its
//! arguments and, in `after_expansion`, builds `InferCtxt`s (`TypingMode::non_body_analysis()`) holding a fixed set
//! of inference variables (`vars`; the TS test mirrors the vids, universes and unifications) and calls the real
//! public entry points:
//! - `InferCtxt::canonicalize_response` / `canonicalize_user_type_annotation` / `canonicalize_query` (with
//!   `ParamEnv::empty()`), printing the `Canonical` and, for queries, the `OriginalQueryValues`;
//! - `InferCtxt::instantiate_canonical` on a canonical response, in a fresh `InferCtxt`;
//! - `TypeOutlives::type_must_outlive` with a recording `TypeOutlivesDelegate` (empty environment);
//! - `test_type_match::extract_verify_if_eq`.
//! Each case prints `{:?}` of the pieces, or the panic message. Returns `Compilation::Stop`.
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
extern crate rustc_type_ir;

use std::cell::RefCell;
use std::io::Write as _;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::process::ExitCode;

use rustc_driver::{Callbacks, Compilation};
use rustc_infer::infer::canonical::{Canonical, OriginalQueryValues};
use rustc_infer::infer::outlives::env::RegionBoundPairs;
use rustc_infer::infer::outlives::obligations::{TypeOutlives, TypeOutlivesDelegate};
use rustc_infer::infer::outlives::test_type_match::extract_verify_if_eq;
use rustc_infer::infer::region_constraints::{GenericKind, VerifyBound, VerifyIfEq};
use rustc_infer::infer::{InferCtxt, RegionVariableOrigin, SubregionOrigin, TyCtxtInferExt};
use rustc_interface::interface;
use rustc_middle::mir::ConstraintCategory;
use rustc_middle::ty::{self, Ty, TyCtxt, TypingMode};
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::ErrorOutputType;
use rustc_span::{DUMMY_SP, Symbol};
use rustc_type_ir::{BoundVar, InferCtxtLike, UniverseIndex};

/// The variables of every canonicalization case, created in this order in a fresh `InferCtxt`.
struct Vars<'tcx> {
    t0: Ty<'tcx>,
    t1: Ty<'tcx>,
    t2: Ty<'tcx>,
    t3: Ty<'tcx>,
    t4: Ty<'tcx>,
    i0: Ty<'tcx>,
    i1: Ty<'tcx>,
    f0: Ty<'tcx>,
    c0: ty::Const<'tcx>,
    c1: ty::Const<'tcx>,
    r0: ty::Region<'tcx>,
    r1: ty::Region<'tcx>,
    ph_t: Ty<'tcx>,
    ph_r: ty::Region<'tcx>,
    ph_c: ty::Const<'tcx>,
}

fn vars<'tcx>(tcx: TyCtxt<'tcx>, infcx: &InferCtxt<'tcx>) -> Vars<'tcx> {
    let u1 = infcx.create_next_universe();
    let u2 = infcx.create_next_universe();
    // ?0t (U0), ?1t (U2), ?2t (U1, sub-unified with ?0t), ?3t (U1, equated with ?1t), ?4t := u8
    let t0 = infcx.next_ty_var_in_universe(DUMMY_SP, UniverseIndex::ROOT);
    let t1 = infcx.next_ty_var_in_universe(DUMMY_SP, u2);
    let t2 = infcx.next_ty_var_in_universe(DUMMY_SP, u1);
    let t3 = infcx.next_ty_var_in_universe(DUMMY_SP, u1);
    let t4 = infcx.next_ty_var_in_universe(DUMMY_SP, UniverseIndex::ROOT);
    let vid = |t: Ty<'tcx>| match t.kind() {
        ty::Infer(ty::TyVar(v)) => *v,
        _ => unreachable!(),
    };
    InferCtxtLike::sub_unify_ty_vids_raw(infcx, vid(t2), vid(t0));
    InferCtxtLike::equate_ty_vids_raw(infcx, vid(t3), vid(t1));
    InferCtxtLike::instantiate_ty_var_raw(infcx, vid(t4), tcx.types.u8);
    // ?0i, ?1i := i32, ?0f
    let i0 = infcx.next_int_var();
    let i1 = infcx.next_int_var();
    let ty::Infer(ty::IntVar(iv1)) = *i1.kind() else { unreachable!() };
    InferCtxtLike::instantiate_int_var_raw(infcx, iv1, ty::IntVarValue::IntType(ty::IntTy::I32));
    let f0 = infcx.next_float_var(DUMMY_SP, None);
    // ?0c (U2), ?1c := N
    let c0 = infcx.next_const_var_in_universe(DUMMY_SP, u2);
    let c1 = infcx.next_const_var_in_universe(DUMMY_SP, UniverseIndex::ROOT);
    let ty::ConstKind::Infer(ty::InferConst::Var(cv1)) = c1.kind() else { unreachable!() };
    let n = ty::Const::new_param(tcx, ty::ParamConst::new(0, Symbol::intern("N")));
    InferCtxtLike::instantiate_const_var_raw(infcx, cv1, n);
    // '?0 (U0), '?1 (U2)
    let r0 = infcx.next_region_var_in_universe(RegionVariableOrigin::Misc(DUMMY_SP), UniverseIndex::ROOT);
    let r1 = infcx.next_region_var_in_universe(RegionVariableOrigin::Misc(DUMMY_SP), u2);
    let ph_t = Ty::new_placeholder(tcx, ty::PlaceholderType::new_anon(u2, BoundVar::from_u32(0)));
    let ph_r = ty::Region::new_placeholder(tcx, ty::PlaceholderRegion::new_anon(u1, BoundVar::from_u32(1)));
    let ph_c = ty::Const::new_placeholder(tcx, ty::PlaceholderConst::new_anon(u1, BoundVar::from_u32(2)));
    Vars { t0, t1, t2, t3, t4, i0, i1, f0, c0, c1, r0, r1, ph_t, ph_r, ph_c }
}

fn infcx<'tcx>(tcx: TyCtxt<'tcx>) -> InferCtxt<'tcx> {
    tcx.infer_ctxt().build(TypingMode::non_body_analysis())
}

fn r#ref<'tcx>(tcx: TyCtxt<'tcx>, r: ty::Region<'tcx>, t: Ty<'tcx>) -> Ty<'tcx> {
    Ty::new_ref(tcx, r, t, ty::Mutability::Not)
}

fn arr<'tcx>(tcx: TyCtxt<'tcx>, c: ty::Const<'tcx>) -> Ty<'tcx> {
    Ty::new_array_with_const_len(tcx, tcx.types.u8, c)
}

/// `response mixed`: every kind the query-response mode handles without region variables.
fn mixed<'tcx>(tcx: TyCtxt<'tcx>, v: &Vars<'tcx>) -> Ty<'tcx> {
    let u8_ = tcx.types.u8;
    Ty::new_tup(tcx, &[
        v.t0, v.t1, v.t2, v.t3, v.t4, v.i0, v.i1, v.f0, arr(tcx, v.c0), arr(tcx, v.c1), v.ph_t,
        r#ref(tcx, v.ph_r, u8_), arr(tcx, v.ph_c), r#ref(tcx, tcx.lifetimes.re_static, v.t0),
        r#ref(tcx, tcx.lifetimes.re_erased, u8_), Ty::new_tup(tcx, &[v.t2, v.t0]),
    ])
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

fn response_case<'tcx>(out: &mut String, tcx: TyCtxt<'tcx>, label: &str, build: fn(TyCtxt<'tcx>, &InferCtxt<'tcx>, &Vars<'tcx>) -> Ty<'tcx>) {
    let infcx = infcx(tcx);
    let v = vars(tcx, &infcx);
    let value = build(tcx, &infcx, &v);
    out.push_str(&format!("response {label}\n"));
    match catch_unwind(AssertUnwindSafe(|| infcx.canonicalize_response(value))) {
        Ok(c) => out.push_str(&format!("  {:?}\n", c)),
        Err(e) => out.push_str(&format!("  panic: {}\n", panic_msg(e))),
    }
}

fn user_case<'tcx>(out: &mut String, tcx: TyCtxt<'tcx>, label: &str, build: fn(TyCtxt<'tcx>, &Vars<'tcx>) -> Ty<'tcx>) {
    let infcx = infcx(tcx);
    let v = vars(tcx, &infcx);
    let value = build(tcx, &v);
    out.push_str(&format!("user {label}\n"));
    match catch_unwind(AssertUnwindSafe(|| infcx.canonicalize_user_type_annotation(value))) {
        Ok(c) => out.push_str(&format!("  {:?}\n", c)),
        Err(e) => out.push_str(&format!("  panic: {}\n", panic_msg(e))),
    }
}

fn query_case<'tcx>(out: &mut String, tcx: TyCtxt<'tcx>, label: &str, build: fn(TyCtxt<'tcx>, &InferCtxt<'tcx>, &Vars<'tcx>) -> Ty<'tcx>) {
    let infcx = infcx(tcx);
    let v = vars(tcx, &infcx);
    let value = build(tcx, &infcx, &v);
    out.push_str(&format!("query {label}\n"));
    let mut state = OriginalQueryValues::default();
    match catch_unwind(AssertUnwindSafe(|| infcx.canonicalize_query(ty::ParamEnv::empty().and(value), &mut state))) {
        Ok(q) => {
            let c = q.canonical;
            out.push_str(&format!("  max_universe: {:?}\n", c.max_universe));
            out.push_str(&format!("  var_kinds: {:?}\n", c.var_kinds));
            out.push_str(&format!("  value: {:?}\n", c.value.value));
            out.push_str(&format!("  query_state: {:?}\n", state));
        }
        Err(e) => out.push_str(&format!("  panic: {}\n", panic_msg(e))),
    }
}

/// Canonicalizes `mixed` (as `response mixed`), then instantiates it in a fresh `InferCtxt` (no variables).
fn instantiate_case<'tcx>(out: &mut String, tcx: TyCtxt<'tcx>) {
    let infcx1 = infcx(tcx);
    let v = vars(tcx, &infcx1);
    let c: Canonical<'tcx, Ty<'tcx>> = infcx1.canonicalize_response(mixed(tcx, &v));
    let infcx2 = infcx(tcx);
    let (value, var_values) = infcx2.instantiate_canonical(DUMMY_SP, &c);
    out.push_str("instantiate mixed\n");
    out.push_str(&format!("  value: {:?}\n", value));
    out.push_str(&format!("  var_values: {:?}\n", var_values.var_values));
    out.push_str(&format!("  universe: {:?}\n", infcx2.universe()));
    let roots: Vec<_> = var_values
        .var_values
        .iter()
        .filter_map(|a| match a.as_type().map(|t| *t.kind()) {
            Some(ty::Infer(ty::TyVar(v))) => Some(format!("?{}t sub_root ?{}t", v.as_u32(), infcx2.sub_unification_table_root_var(v).as_u32())),
            _ => None,
        })
        .collect();
    out.push_str(&format!("  sub_roots: {:?}\n", roots));
}

/// Records the calls of `TypeOutlives` on its delegate.
struct Rec<'a>(&'a RefCell<String>);

impl<'tcx> TypeOutlivesDelegate<'tcx> for Rec<'_> {
    fn push_sub_region_constraint(&mut self, _origin: SubregionOrigin<'tcx>, a: ty::Region<'tcx>, b: ty::Region<'tcx>, _c: ConstraintCategory<'tcx>) {
        self.0.borrow_mut().push_str(&format!("  push_sub_region_constraint({a:?}, {b:?})\n"));
    }
    fn push_verify(&mut self, _origin: SubregionOrigin<'tcx>, kind: GenericKind<'tcx>, a: ty::Region<'tcx>, bound: VerifyBound<'tcx>) {
        self.0.borrow_mut().push_str(&format!("  push_verify({kind:?}, {a:?}, {bound:?})\n"));
    }
}

fn outlives_case<'tcx>(out: &mut String, tcx: TyCtxt<'tcx>, label: &str, implicit: Option<ty::Region<'tcx>>, ty: Ty<'tcx>, region: ty::Region<'tcx>) {
    let rec = RefCell::new(String::new());
    let rbp = RegionBoundPairs::default();
    let r = catch_unwind(AssertUnwindSafe(|| {
        let mut o = TypeOutlives::new(Rec(&rec), tcx, &rbp, implicit, &[]);
        o.type_must_outlive(SubregionOrigin::RelateParamBound(DUMMY_SP, ty, None), ty, region, ConstraintCategory::BoringNoLocation);
    }));
    out.push_str(&format!("outlives {label}\n"));
    out.push_str(&rec.borrow());
    if let Err(e) = r {
        out.push_str(&format!("  panic: {}\n", panic_msg(e)));
    }
}

fn verify_if_eq_case<'tcx>(out: &mut String, tcx: TyCtxt<'tcx>, label: &str, pattern: ty::Binder<'tcx, VerifyIfEq<'tcx>>, test_ty: Ty<'tcx>) {
    let r = catch_unwind(AssertUnwindSafe(|| extract_verify_if_eq(tcx, &pattern, test_ty)));
    match r {
        Ok(r) => out.push_str(&format!("verify_if_eq {label}\n  {:?}\n", r)),
        Err(e) => out.push_str(&format!("verify_if_eq {label}\n  panic: {}\n", panic_msg(e))),
    }
}

struct Cb;
impl Callbacks for Cb {
    fn after_expansion<'tcx>(&mut self, _c: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        std::panic::set_hook(Box::new(|_| {}));
        let mut out = String::new();

        // ---- canonicalize_response (`CanonicalizeQueryResponse`, universes preserved)
        response_case(&mut out, tcx, "mixed", |tcx, _, v| mixed(tcx, v));
        response_case(&mut out, tcx, "root-only", |tcx, _, v| Ty::new_tup(tcx, &[v.t0, v.i0, v.t4, v.f0, v.t0]));
        response_case(&mut out, tcx, "many", |tcx, infcx, v| {
            // More than 8 variables: `query_state.var_values` spills and `indices` takes over.
            let fresh: Vec<Ty<'_>> = (0..10).map(|_| infcx.next_ty_var(DUMMY_SP)).collect();
            let mut tys = vec![v.t1, v.t0];
            tys.extend(fresh.iter().copied());
            tys.push(v.t1);
            tys.push(fresh[9]);
            tys.push(fresh[2]);
            tys.push(v.ph_t);
            tys.push(v.t3);
            Ty::new_tup(tcx, &tys)
        });

        // ---- canonicalize_user_type_annotation (`CanonicalizeUserTypeAnnotation`)
        user_case(&mut out, tcx, "vars", |tcx, v| {
            let u8_ = tcx.types.u8;
            Ty::new_tup(tcx, &[
                v.t1, r#ref(tcx, v.r1, u8_), r#ref(tcx, tcx.lifetimes.re_static, v.t2), v.i0, v.f0, arr(tcx, v.c0),
                v.ph_t, r#ref(tcx, v.r0, v.t3), r#ref(tcx, v.r1, u8_), r#ref(tcx, tcx.lifetimes.re_erased, u8_),
            ])
        });
        user_case(&mut out, tcx, "placeholder-const", |tcx, v| arr(tcx, v.ph_c));

        // ---- canonicalize_query (`ParamEnv::empty()`, then `CanonicalizeAllFreeRegions` for the value)
        query_case(&mut out, tcx, "all", |tcx, _, v| {
            let u8_ = tcx.types.u8;
            Ty::new_tup(tcx, &[
                v.t0, v.t1, r#ref(tcx, v.r0, v.t2), r#ref(tcx, v.r1, u8_), r#ref(tcx, tcx.lifetimes.re_static, u8_),
                r#ref(tcx, tcx.lifetimes.re_erased, u8_), v.ph_t, r#ref(tcx, v.ph_r, u8_), arr(tcx, v.c0), v.i0, v.f0,
                r#ref(tcx, v.r0, u8_), v.t3, arr(tcx, v.c1),
            ])
        });
        query_case(&mut out, tcx, "placeholder-const", |tcx, _, v| arr(tcx, v.ph_c));

        // ---- instantiate_canonical
        instantiate_case(&mut out, tcx);

        // ---- TypeOutlives::type_must_outlive (no environment bounds)
        let p_t = Ty::new_param(tcx, 0, Symbol::intern("T"));
        let p_u = Ty::new_param(tcx, 1, Symbol::intern("U"));
        let re = |i: u32| ty::Region::new_placeholder(tcx, ty::PlaceholderRegion::new_anon(UniverseIndex::ROOT, BoundVar::from_u32(i)));
        let u8_ = tcx.types.u8;
        let ph_t = Ty::new_placeholder(tcx, ty::PlaceholderType::new_anon(UniverseIndex::from_u32(1), BoundVar::from_u32(7)));
        outlives_case(&mut out, tcx, "ref-param", None, r#ref(tcx, re(0), Ty::new_tup(tcx, &[p_t, r#ref(tcx, re(1), p_u)])), re(2));
        outlives_case(&mut out, tcx, "implicit", Some(tcx.lifetimes.re_static), Ty::new_tup(tcx, &[p_t, u8_]), re(2));
        outlives_case(&mut out, tcx, "placeholder", None, Ty::new_tup(tcx, &[ph_t, r#ref(tcx, tcx.lifetimes.re_static, ph_t)]), re(3));
        outlives_case(&mut out, tcx, "static-only", None, r#ref(tcx, tcx.lifetimes.re_static, Ty::new_tup(tcx, &[u8_, p_t])), tcx.lifetimes.re_static);
        let fn_ptr = {
            let br = ty::BoundRegion { var: BoundVar::from_u32(0), kind: ty::BoundRegionKind::Anon };
            let late = ty::Region::new_bound(tcx, ty::INNERMOST, br);
            let sig = tcx.mk_fn_sig_rust_abi([r#ref(tcx, late, p_t), r#ref(tcx, re(4), u8_)], p_u, rustc_hir::Safety::Safe);
            let bv = tcx.mk_bound_variable_kinds(&[ty::BoundVariableKind::Region(ty::BoundRegionKind::Anon)]);
            Ty::new_fn_ptr(tcx, ty::Binder::bind_with_vars(sig, bv))
        };
        outlives_case(&mut out, tcx, "fn-ptr", None, fn_ptr, re(2));

        // ---- extract_verify_if_eq
        let br0 = ty::BoundRegion { var: BoundVar::from_u32(0), kind: ty::BoundRegionKind::Anon };
        let b0 = ty::Region::new_bound(tcx, ty::INNERMOST, br0);
        let bv1 = tcx.mk_bound_variable_kinds(&[ty::BoundVariableKind::Region(ty::BoundRegionKind::Anon)]);
        let pat = |ty: Ty<'tcx>, bound: ty::Region<'tcx>| ty::Binder::bind_with_vars(VerifyIfEq { ty, bound }, bv1);
        let pat_ty = Ty::new_tup(tcx, &[r#ref(tcx, b0, p_t), u8_]);
        verify_if_eq_case(&mut out, tcx, "bound-static", pat(pat_ty, b0), Ty::new_tup(tcx, &[r#ref(tcx, tcx.lifetimes.re_static, p_t), u8_]));
        verify_if_eq_case(&mut out, tcx, "bound-placeholder", pat(pat_ty, b0), Ty::new_tup(tcx, &[r#ref(tcx, re(5), p_t), u8_]));
        verify_if_eq_case(&mut out, tcx, "mismatch", pat(pat_ty, b0), Ty::new_tup(tcx, &[r#ref(tcx, re(5), p_t), tcx.types.u16]));
        verify_if_eq_case(&mut out, tcx, "free-bound", pat(pat_ty, re(6)), Ty::new_tup(tcx, &[r#ref(tcx, re(5), p_t), u8_]));
        verify_if_eq_case(&mut out, tcx, "unconstrained", pat(Ty::new_tup(tcx, &[p_t, u8_]), b0), Ty::new_tup(tcx, &[p_t, u8_]));
        let twice = Ty::new_tup(tcx, &[r#ref(tcx, b0, p_t), r#ref(tcx, b0, u8_)]);
        verify_if_eq_case(&mut out, tcx, "twice-same", pat(twice, b0), Ty::new_tup(tcx, &[r#ref(tcx, re(5), p_t), r#ref(tcx, re(5), u8_)]));
        verify_if_eq_case(&mut out, tcx, "twice-different", pat(twice, b0), Ty::new_tup(tcx, &[r#ref(tcx, re(5), p_t), r#ref(tcx, re(6), u8_)]));

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
