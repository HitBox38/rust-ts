//! Oracle probe of infer_core.test.ts (lane infer-core): rustc_infer infer/mod.rs, at.rs, resolve.rs and freshen.rs
//! on a real `InferCtxt`.
//!
//! A rustc-dev program (not a tools/probes probe: lanes may not edit tools/). It runs the pinned rustc on its arguments
//! and, in `after_expansion`, builds `tcx.infer_ctxt().build(TypingMode::non_body_analysis())`, then runs one script:
//! create type / int / float / const variables, unify them with the raw `InferCtxtLike` ops, resolve (shallow, deep,
//! numeric-literal default, via the region graph), freshen, `probe` (snapshot rollback), `fork` and
//! `instantiate_binder_with_fresh_vars`. Each step prints one `label: value` line with rustc's `Debug` / `Display`.
//! infer_core.test.ts runs the same script on the port. Returns `Compilation::Stop`.
//! Build: rustc +nightly --edition 2024 probe.rs -o probe -C link-arg=-Wl,-rpath,$(rustc +nightly --print sysroot)/lib
#![feature(rustc_private)]
#![allow(deprecated)]
extern crate rustc_driver;
extern crate rustc_infer;
extern crate rustc_interface;
extern crate rustc_middle;
extern crate rustc_session;
extern crate rustc_span;
extern crate rustc_type_ir;

use std::fmt::Write as _;
use std::io::Write as _;
use std::process::ExitCode;

use rustc_driver::{Callbacks, Compilation};
use rustc_infer::infer::{BoundRegionConversionTime, InferCtxt, TyCtxtInferExt, TypeFreshener};
use rustc_interface::interface;
use rustc_middle::ty::{self, Ty, TyCtxt, TypeFoldable, TypingMode};
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::ErrorOutputType;
use rustc_span::{DUMMY_SP, Symbol};
use rustc_type_ir::InferCtxtLike;
use rustc_type_ir::solve::TyOrConstInferVar;

struct Probe;

fn res<T: std::fmt::Debug, E: std::fmt::Debug>(r: Result<T, E>) -> String {
    match r {
        Ok(v) => format!("Ok({v:?})"),
        Err(e) => format!("Err({e:?})"),
    }
}

fn tv(ty: Ty<'_>) -> ty::TyVid {
    ty.ty_vid().unwrap()
}
fn iv(ty: Ty<'_>) -> ty::IntVid {
    match *ty.kind() {
        ty::Infer(ty::IntVar(v)) => v,
        _ => unreachable!(),
    }
}
fn fv(ty: Ty<'_>) -> ty::FloatVid {
    match *ty.kind() {
        ty::Infer(ty::FloatVar(v)) => v,
        _ => unreachable!(),
    }
}
fn cv(ct: ty::Const<'_>) -> ty::ConstVid {
    match ct.kind() {
        ty::ConstKind::Infer(ty::InferConst::Var(v)) => v,
        _ => unreachable!(),
    }
}

/// The resolution steps of the script on one value.
fn resolve_all<'tcx>(out: &mut String, infcx: &InferCtxt<'tcx>, n: u32, value: Ty<'tcx>) {
    writeln!(out, "freshen{n}: {:?}", value.fold_with(&mut TypeFreshener::new(infcx))).unwrap();
    writeln!(out, "deep{n}: {:?}", infcx.deeply_resolve_ignoring_regions(value)).unwrap();
    writeln!(out, "unification_table{n}: {:?}", infcx.deeply_resolve_via_unification_table(value)).unwrap();
    writeln!(out, "literals{n}: {:?}", infcx.resolve_numeric_literals_with_default(value)).unwrap();
    match infcx.deeply_resolve_via_region_graph(value) {
        Ok(v) => writeln!(out, "region_graph{n}: Ok({v:?})").unwrap(),
        Err(e) => writeln!(out, "region_graph{n}: Err({e:?}) {e}").unwrap(),
    }
    writeln!(out, "ty_to_string{n}: {}", infcx.ty_to_string(value)).unwrap();
}

impl Callbacks for Probe {
    fn after_expansion<'tcx>(&mut self, _compiler: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        let mut out = String::new();
        let t = &tcx.types;
        let sp = DUMMY_SP;
        let infcx = tcx.infer_ctxt().build(TypingMode::non_body_analysis());

        // == variables
        let t0 = infcx.next_ty_var(sp);
        let t1 = infcx.next_ty_var(sp);
        let t2 = infcx.next_ty_var(sp);
        let u1 = infcx.create_next_universe();
        let t3 = infcx.next_ty_var_in_universe(sp, ty::UniverseIndex::ROOT);
        let t4 = infcx.next_ty_var(sp);
        let i0 = infcx.next_int_var();
        let i1 = infcx.next_int_var();
        let i2 = infcx.next_int_var();
        let f0 = infcx.next_float_var(sp, None);
        let f1 = infcx.next_float_var(sp, None);
        let c0 = infcx.next_const_var(sp);
        let c1 = infcx.next_const_var_in_universe(sp, ty::UniverseIndex::ROOT);
        writeln!(out, "vars: {t0:?} {t1:?} {t2:?} {t3:?} {t4:?} {i0:?} {i1:?} {i2:?} {f0:?} {f1:?} {c0:?} {c1:?}").unwrap();
        writeln!(out, "universe: {u1:?} {:?} num_ty_vars: {}", infcx.universe(), infcx.num_ty_vars()).unwrap();
        for (l, ty) in [("t0", t0), ("t1", t1), ("t2", t2), ("t3", t3), ("t4", t4)] {
            writeln!(out, "try_resolve_ty_var {l}: {}", res(infcx.try_resolve_ty_var(tv(ty)))).unwrap();
        }
        writeln!(out, "try_resolve_const_var c0: {}", res(infcx.try_resolve_const_var(cv(c0)))).unwrap();
        writeln!(out, "try_resolve_const_var c1: {}", res(infcx.try_resolve_const_var(cv(c1)))).unwrap();
        writeln!(out, "unresolved: {:?}", infcx.unresolved_root_variables()).unwrap();

        // == unification
        infcx.equate_ty_vids_raw(tv(t2), tv(t1));
        infcx.equate_ty_vids_raw(tv(t4), tv(t3));
        infcx.sub_unify_ty_vids_raw(tv(t0), tv(t3));
        infcx.equate_int_vids_raw(iv(i1), iv(i2));
        infcx.equate_float_vids_raw(fv(f1), fv(f0));
        infcx.equate_const_vids_raw(cv(c1), cv(c0));
        writeln!(out, "root_var t2: {:?} t4: {:?}", infcx.root_var(tv(t2)), infcx.root_var(tv(t4))).unwrap();
        writeln!(out, "root_vid t2: {:?} i0: {:?}", infcx.root_vid(t2), infcx.root_vid(i0)).unwrap();
        writeln!(out, "shallow t1: {:?} t2: {:?} t4: {:?}", infcx.shallow_resolve(t1), infcx.shallow_resolve(t2), infcx.shallow_resolve(t4)).unwrap();
        writeln!(out, "shallow_ty_var t2: {:?}", infcx.shallow_resolve_ty_var(tv(t2))).unwrap();
        writeln!(out, "shallow_or_root t2: {}", res(infcx.shallow_resolve_ty_var_or_get_root(tv(t2)))).unwrap();
        writeln!(out, "try_resolve_ty_var t4: {}", res(infcx.try_resolve_ty_var(tv(t4)))).unwrap();
        writeln!(
            out,
            "sub_root t0: {:?} t3: {:?} t4: {:?}",
            infcx.sub_unification_table_root_var(tv(t0)),
            infcx.sub_unification_table_root_var(tv(t3)),
            infcx.sub_unification_table_root_var(tv(t4))
        )
        .unwrap();
        writeln!(out, "shallow i1: {:?} i2: {:?} int_var i2: {:?}", infcx.shallow_resolve(i1), infcx.shallow_resolve(i2), infcx.shallow_resolve_int_var(iv(i2))).unwrap();
        writeln!(out, "root_float f1: {:?} shallow f0: {:?} float_var f0: {:?}", infcx.root_float_var(fv(f1)), infcx.shallow_resolve(f0), infcx.shallow_resolve_float_var(fv(f0))).unwrap();
        writeln!(out, "root_const c0: {:?} shallow c0: {:?} const_var c0: {:?}", infcx.root_const_var(cv(c0)), infcx.shallow_resolve_const(c0), infcx.shallow_resolve_const_var(cv(c0))).unwrap();
        writeln!(out, "shallow_term t2: {:?} c0: {:?}", infcx.shallow_resolve_term(t2.into()), infcx.shallow_resolve_term(c0.into())).unwrap();
        writeln!(out, "unresolved: {:?}", infcx.unresolved_root_variables()).unwrap();

        let re_static = tcx.lifetimes.re_static;
        let tup = Ty::new_tup(
            tcx,
            &[t0, t1, t2, t0, i0, i2, f0, f1, Ty::new_imm_ref(tcx, re_static, t2), Ty::new_array_with_const_len(tcx, t.u8, c0), t3],
        );
        resolve_all(&mut out, &infcx, 1, tup);

        // == instantiation
        infcx.instantiate_ty_var_raw(tv(t1), Ty::new_tup(tcx, &[t.u8, i0]));
        infcx.instantiate_ty_var_raw(tv(t3), t.bool);
        infcx.instantiate_int_var_raw(iv(i2), ty::IntVarValue::UintType(ty::UintTy::U16));
        infcx.instantiate_float_var_raw(fv(f0), ty::FloatVarValue::Known(ty::FloatTy::F32));
        infcx.instantiate_const_var_raw(cv(c1), ty::Const::new_param(tcx, ty::ParamConst::new(0, Symbol::intern("N"))));
        writeln!(out, "shallow t2: {:?} t4: {:?} i1: {:?} f1: {:?}", infcx.shallow_resolve(t2), infcx.shallow_resolve(t4), infcx.shallow_resolve(i1), infcx.shallow_resolve(f1)).unwrap();
        writeln!(out, "shallow c0: {:?} try c0: {}", infcx.shallow_resolve_const(c0), res(infcx.try_resolve_const_var(cv(c0)))).unwrap();
        writeln!(out, "root_vid t2: {:?} t0: {:?}", infcx.root_vid(t2), infcx.root_vid(t0)).unwrap();
        writeln!(out, "unresolved: {:?}", infcx.unresolved_root_variables()).unwrap();
        resolve_all(&mut out, &infcx, 2, tup);
        resolve_all(&mut out, &infcx, 3, Ty::new_tup(tcx, &[t2, i1, f1, Ty::new_array_with_const_len(tcx, t.u8, c0)]));
        resolve_all(&mut out, &infcx, 4, Ty::new_tup(tcx, &[i1, f1, Ty::new_array_with_const_len(tcx, t.u8, c0)]));
        let changed = |v: TyOrConstInferVar| infcx.ty_or_const_infer_var_changed(v);
        writeln!(
            out,
            "changed: t0 {} t1 {} t2 {} i0 {} i1 {} i2 {} f0 {} f1 {} c0 {} c1 {}",
            changed(TyOrConstInferVar::Ty(tv(t0))),
            changed(TyOrConstInferVar::Ty(tv(t1))),
            changed(TyOrConstInferVar::Ty(tv(t2))),
            changed(TyOrConstInferVar::TyInt(iv(i0))),
            changed(TyOrConstInferVar::TyInt(iv(i1))),
            changed(TyOrConstInferVar::TyInt(iv(i2))),
            changed(TyOrConstInferVar::TyFloat(fv(f0))),
            changed(TyOrConstInferVar::TyFloat(fv(f1))),
            changed(TyOrConstInferVar::Const(cv(c0))),
            changed(TyOrConstInferVar::Const(cv(c1))),
        )
        .unwrap();
        {
        // The returned closure holds a borrow of `infcx.inner` until it is dropped.
        let unchanged = infcx.is_ty_infer_var_definitely_unchanged();
        writeln!(
            out,
            "unchanged: t0 {} t1 {} t2 {} i0 {}",
            unchanged(TyOrConstInferVar::Ty(tv(t0))),
            unchanged(TyOrConstInferVar::Ty(tv(t1))),
            unchanged(TyOrConstInferVar::Ty(tv(t2))),
            unchanged(TyOrConstInferVar::TyInt(iv(i0))),
        )
        .unwrap();
        }

        // == probe (snapshot rollback)
        let r = infcx.probe(|_| {
            let t5 = infcx.next_ty_var(sp);
            let u2 = infcx.create_next_universe();
            infcx.instantiate_ty_var_raw(tv(t0), t.char);
            infcx.instantiate_int_var_raw(iv(i0), ty::IntVarValue::IntType(ty::IntTy::I8));
            infcx.equate_ty_vids_raw(tv(t5), tv(t0));
            format!(
                "{t5:?} {u2:?} {:?} {:?} {:?} {} {:?}",
                infcx.shallow_resolve(t0),
                infcx.shallow_resolve(i0),
                infcx.deeply_resolve_ignoring_regions(tup),
                infcx.num_ty_vars(),
                infcx.unresolved_root_variables()
            )
        });
        writeln!(out, "in probe: {r}").unwrap();
        writeln!(
            out,
            "after probe: {:?} {:?} {} {:?} {:?}",
            infcx.shallow_resolve(t0),
            infcx.shallow_resolve(i0),
            infcx.num_ty_vars(),
            infcx.universe(),
            infcx.unresolved_root_variables()
        )
        .unwrap();

        // == fork
        let forked = infcx.fork();
        forked.instantiate_ty_var_raw(tv(t0), t.str_);
        let t6 = forked.next_ty_var(sp);
        writeln!(out, "fork: {t6:?} {:?} {} | {:?} {}", forked.shallow_resolve(t0), forked.num_ty_vars(), infcx.shallow_resolve(t0), infcx.num_ty_vars()).unwrap();
        writeln!(out, "fork deep: {:?}", forked.deeply_resolve_ignoring_regions(tup)).unwrap();
        let forked2 = infcx.fork_with_typing_mode(TypingMode::Coherence);
        writeln!(out, "fork_with_typing_mode: {:?} {:?}", forked2.typing_mode_raw(), forked2.shallow_resolve(t2)).unwrap();

        // == instantiate_binder_with_fresh_vars
        let bound_vars = tcx.mk_bound_variable_kinds(&[ty::BoundVariableKind::Ty(ty::BoundTyKind::Anon), ty::BoundVariableKind::Const]);
        let value = Ty::new_tup(
            tcx,
            &[
                Ty::new_bound(tcx, ty::INNERMOST, ty::BoundTy { var: ty::BoundVar::from_u32(0), kind: ty::BoundTyKind::Anon }),
                Ty::new_array_with_const_len(tcx, t.u8, ty::Const::new_bound(tcx, ty::INNERMOST, ty::BoundConst::new(ty::BoundVar::from_u32(1)))),
                t2,
            ],
        );
        let binder = ty::Binder::bind_with_vars(value, bound_vars);
        let inst = infcx.instantiate_binder_with_fresh_vars(sp, BoundRegionConversionTime::FnCall, binder);
        writeln!(out, "instantiated: {inst:?} {}", infcx.num_ty_vars()).unwrap();
        let dummy = ty::Binder::dummy(Ty::new_tup(tcx, &[t.u8, t2]));
        writeln!(out, "instantiated dummy: {:?}", infcx.instantiate_binder_with_fresh_vars(sp, BoundRegionConversionTime::FnCall, dummy)).unwrap();

        // == typing_env / tainted / closure-free odds and ends
        writeln!(out, "typing_env: {:?}", infcx.typing_env(ty::ParamEnv::empty()).typing_mode()).unwrap();
        writeln!(out, "tainted: {:?} next_trait_solver: {}", infcx.tainted_by_errors(), infcx.next_trait_solver()).unwrap();

        print!("{out}");
        std::io::stdout().flush().unwrap();
        Compilation::Stop
    }
}

fn main() -> ExitCode {
    let early_dcx = EarlyDiagCtxt::new(ErrorOutputType::default());
    rustc_driver::install_ice_hook(rustc_driver::DEFAULT_BUG_REPORT_URL, |_| ());
    let mut callbacks = Probe;
    rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&rustc_driver::args::raw_args(&early_dcx), &mut callbacks))
}
