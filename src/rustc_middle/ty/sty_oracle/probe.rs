//! Oracle probe of sty.test.ts (lane ty-sty): rustc_middle ty/sty.rs on interned types.
//!
//! A rustc-dev program (not a tools/probes probe: lanes may not edit tools/). It runs the pinned rustc on its arguments
//! and, in `after_expansion`, builds types with rustc's own `Ty::new_*` constructors and prints, for each:
//!   <label>: <Display>
//!     is: <the `is_*` / `has_*` predicates of sty.rs that hold>
//!     opt: <the `Option`-returning helpers>
//!     walk: <Display of the types `Ty::walk` reaches>
//! then a few free helpers (`CoroutineArgsExt::variant_name`, `Article`). Returns `Compilation::Stop`.
//! Build: rustc +nightly --edition 2024 probe.rs -o probe -C link-arg=-Wl,-rpath,$(rustc +nightly --print sysroot)/lib
#![feature(rustc_private)]
#![allow(deprecated)]
extern crate rustc_abi;
extern crate rustc_driver;
extern crate rustc_interface;
extern crate rustc_middle;
extern crate rustc_session;
extern crate rustc_span;
extern crate rustc_type_ir;

use std::fmt::Write as _;
use std::io::Write as _;
use std::process::ExitCode;

use rustc_abi::VariantIdx;
use rustc_driver::{Callbacks, Compilation};
use rustc_interface::interface;
use rustc_middle::ty::{
    self, Article, CoroutineArgsExt, FnSigKind, GenericArgKind, ParamTy, Ty, TyCtxt, TyKind,
};
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::ErrorOutputType;
use rustc_span::{ErrorGuaranteed, Symbol, kw};
use rustc_type_ir::solve::SizedTraitKind;

struct Probe;

fn opt<T: std::fmt::Display>(o: Option<T>) -> String {
    match o {
        Some(v) => v.to_string(),
        None => "-".to_string(),
    }
}

fn line<'tcx>(out: &mut String, tcx: TyCtxt<'tcx>, label: &str, ty: Ty<'tcx>) {
    writeln!(out, "{label}: {ty}").unwrap();
    let preds: [(&str, bool); 44] = [
        ("unit", ty.is_unit()),
        ("usize", ty.is_usize()),
        ("usize_like", ty.is_usize_like()),
        ("never", ty.is_never()),
        ("primitive", ty.is_primitive()),
        ("adt", ty.is_adt()),
        ("self_param", ty.is_self_param()),
        ("ref", ty.is_ref()),
        ("ty_var", ty.is_ty_var()),
        ("ty_or_numeric_infer", ty.is_ty_or_numeric_infer()),
        ("phantom_data", ty.is_phantom_data()),
        ("bool", ty.is_bool()),
        ("str", ty.is_str()),
        ("imm_ref_str", ty.is_imm_ref_str()),
        ("param0", ty.is_param(0)),
        ("slice", ty.is_slice()),
        ("array_slice", ty.is_array_slice()),
        ("array", ty.is_array()),
        ("simd", ty.is_simd()),
        ("mutable_ptr", ty.is_mutable_ptr()),
        ("raw_ptr", ty.is_raw_ptr()),
        ("any_ptr", ty.is_any_ptr()),
        ("box", ty.is_box()),
        ("scalar", ty.is_scalar()),
        ("floating_point", ty.is_floating_point()),
        ("trait", ty.is_trait()),
        ("enum", ty.is_enum()),
        ("closure", ty.is_closure()),
        ("coroutine", ty.is_coroutine()),
        ("integral", ty.is_integral()),
        ("fresh_ty", ty.is_fresh_ty()),
        ("fresh", ty.is_fresh()),
        ("char", ty.is_char()),
        ("numeric", ty.is_numeric()),
        ("signed", ty.is_signed()),
        ("ptr_sized_integral", ty.is_ptr_sized_integral()),
        ("concrete_skeleton", ty.has_concrete_skeleton()),
        ("fn", ty.is_fn()),
        ("fn_ptr", ty.is_fn_ptr()),
        ("opaque", ty.is_opaque()),
        ("known_rigid", ty.is_known_rigid()),
        ("pure_clone_copy", ty.is_trivially_pure_clone_copy()),
        ("trivially_wf", ty.is_trivially_wf(tcx)),
        ("like_maybe_dangling", ty.is_like_maybe_dangling()),
    ];
    let fresh = matches!(ty.kind(), TyKind::Infer(ty::FreshTy(_) | ty::FreshIntTy(_) | ty::FreshFloatTy(_)));
    let mut is: Vec<&str> = preds.iter().filter(|(_, b)| *b).map(|(n, _)| *n).collect();
    if !fresh {
        if ty.has_trivial_sizedness(tcx, SizedTraitKind::Sized) {
            is.push("sized");
        }
        if ty.has_trivial_sizedness(tcx, SizedTraitKind::MetaSized) {
            is.push("meta_sized");
        }
    }
    writeln!(out, "  is: {}", is.join(" ")).unwrap();
    let closure_kind = match ty.kind() {
        TyKind::Int(ty::IntTy::I8 | ty::IntTy::I16 | ty::IntTy::I32)
        | TyKind::Bound(..)
        | TyKind::Placeholder(_)
        | TyKind::Param(_)
        | TyKind::Infer(_)
        | TyKind::Error(_) => match ty.to_opt_closure_kind() {
            Some(k) => format!("{k:?}"),
            None => "-".to_string(),
        },
        _ => "n/a".to_string(),
    };
    let seq = match ty.kind() {
        TyKind::Array(..) | TyKind::Slice(_) | TyKind::Str => ty.sequence_element_type(tcx).to_string(),
        _ => "n/a".to_string(),
    };
    let discr = match ty.kind() {
        TyKind::Param(_)
        | TyKind::Alias(..)
        | TyKind::Infer(ty::TyVar(_) | ty::FreshTy(_) | ty::FreshIntTy(_) | ty::FreshFloatTy(_))
        | TyKind::Adt(..)
        | TyKind::Bound(..)
        | TyKind::Placeholder(_)
        | TyKind::Coroutine(..)
        | TyKind::Pat(..) => "n/a".to_string(),
        _ => ty.discriminant_ty(tcx).to_string(),
    };
    writeln!(
        out,
        "  opt: ty_vid={} float_vid={} ref_mutability={} deref_explicit={} deref={} index={} primitive_symbol={} tuple_len={} closure_kind={closure_kind} seq={seq} discr={discr}",
        opt(ty.ty_vid().map(|v| v.as_u32())),
        opt(ty.float_vid().map(|v| v.as_u32())),
        opt(ty.ref_mutability().map(|m| format!("{m:?}"))),
        opt(ty.builtin_deref(true)),
        opt(ty.builtin_deref(false)),
        opt(ty.builtin_index()),
        opt(ty.primitive_symbol()),
        opt(ty.opt_tuple_fields().map(|l| l.len())),
    )
    .unwrap();
    let walk: Vec<String> = ty
        .walk()
        .filter_map(|a| match a.kind() {
            GenericArgKind::Type(t) => Some(t.to_string()),
            _ => None,
        })
        .collect();
    writeln!(out, "  walk: {}", walk.join(", ")).unwrap();
}

impl Callbacks for Probe {
    fn after_expansion<'tcx>(&mut self, _compiler: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        let mut out = String::new();
        let t = &tcx.types;
        let re_static = tcx.lifetimes.re_static;
        let re_erased = tcx.lifetimes.re_erased;
        let sym_t = Symbol::intern("T");
        let sym_n = Symbol::intern("N");
        let guar = ErrorGuaranteed::unchecked_error_guaranteed();
        let fn_ptr = |inputs: &[Ty<'tcx>], output: Ty<'tcx>| {
            Ty::new_fn_ptr(tcx, ty::Binder::dummy(tcx.mk_fn_sig(inputs.iter().copied(), output, FnSigKind::dummy())))
        };
        let n_param = ty::Const::new_param(tcx, ty::ParamConst::new(1, sym_n));
        let ct_var = ty::Const::new_var(tcx, ty::ConstVid::from_u32(0));
        let types: Vec<(&str, Ty<'tcx>)> = vec![
            ("new_bool", <Ty<'tcx> as rustc_type_ir::inherent::Ty<_>>::new_bool(tcx)),
            ("new_u8", <Ty<'tcx> as rustc_type_ir::inherent::Ty<_>>::new_u8(tcx)),
            ("new_unit", <Ty<'tcx> as rustc_type_ir::inherent::Ty<_>>::new_unit(tcx)),
            ("new_usize", <Ty<'tcx> as rustc_type_ir::inherent::Ty<_>>::new_usize(tcx)),
            ("char", t.char),
            ("str", t.str_),
            ("never", t.never),
            ("new_int_i8", Ty::new_int(tcx, ty::IntTy::I8)),
            ("new_int_i16", Ty::new_int(tcx, ty::IntTy::I16)),
            ("new_int_i32", Ty::new_int(tcx, ty::IntTy::I32)),
            ("new_int_i64", Ty::new_int(tcx, ty::IntTy::I64)),
            ("new_int_i128", Ty::new_int(tcx, ty::IntTy::I128)),
            ("new_int_isize", Ty::new_int(tcx, ty::IntTy::Isize)),
            ("new_uint_u32", Ty::new_uint(tcx, ty::UintTy::U32)),
            ("new_uint_usize", Ty::new_uint(tcx, ty::UintTy::Usize)),
            ("new_float_f16", Ty::new_float(tcx, ty::FloatTy::F16)),
            ("new_float_f64", Ty::new_float(tcx, ty::FloatTy::F64)),
            ("new_tup_empty", Ty::new_tup(tcx, &[])),
            ("new_tup", Ty::new_tup(tcx, &[t.i32, t.bool])),
            ("new_tup_unsized_tail", Ty::new_tup(tcx, &[t.u8, t.str_])),
            ("new_tup_from_iter", Ty::new_tup_from_iter(tcx, [t.u8, t.char, t.unit].into_iter())),
            ("new_tup_four", Ty::new_tup(tcx, &[t.u8, t.u8, t.u8, t.u8])),
            ("new_static_str", Ty::new_static_str(tcx)),
            ("new_imm_ref", Ty::new_imm_ref(tcx, re_erased, t.i32)),
            ("new_mut_ref", Ty::new_mut_ref(tcx, re_static, Ty::new_slice(tcx, t.u8))),
            ("new_ref_param", Ty::new_ref(tcx, re_static, Ty::new_param(tcx, 1, sym_t), ty::Mutability::Not)),
            ("new_imm_ptr", Ty::new_imm_ptr(tcx, t.u8)),
            ("new_mut_ptr", Ty::new_mut_ptr(tcx, Ty::new_slice(tcx, t.u8))),
            ("new_ptr_str", Ty::new_ptr(tcx, t.str_, ty::Mutability::Mut)),
            ("new_slice", Ty::new_slice(tcx, t.u16)),
            ("new_slice_str", Ty::new_slice(tcx, t.str_)),
            ("new_array_with_const_len", Ty::new_array_with_const_len(tcx, t.u8, n_param)),
            ("new_array_var", Ty::new_array_with_const_len(tcx, t.never, ct_var)),
            ("new_fn_ptr", fn_ptr(&[t.i32], t.bool)),
            ("new_fn_ptr_unit", fn_ptr(&[], t.unit)),
            ("new_param_self", Ty::new_param(tcx, 0, kw::SelfUpper)),
            ("new_param_t", Ty::new_param(tcx, 1, sym_t)),
            ("param_ty_to_ty", ParamTy::new(2, sym_t).to_ty(tcx)),
            ("ir_new_param", <Ty<'tcx> as rustc_type_ir::inherent::Ty<_>>::new_param(tcx, ParamTy::new(0, sym_t))),
            ("new_var", Ty::new_var(tcx, ty::TyVid::from_u32(3))),
            ("new_var_big", Ty::new_var(tcx, ty::TyVid::from_u32(500))),
            ("new_int_var", Ty::new_int_var(tcx, ty::IntVid::from_u32(0))),
            ("new_float_var", Ty::new_float_var(tcx, ty::FloatVid::from_u32(4))),
            ("new_infer", Ty::new_infer(tcx, ty::TyVar(ty::TyVid::from_u32(7)))),
            ("new_fresh", Ty::new_fresh(tcx, 1)),
            ("new_fresh_big", Ty::new_fresh(tcx, 50)),
            ("new_fresh_int", Ty::new_fresh_int(tcx, 2)),
            ("new_fresh_float", Ty::new_fresh_float(tcx, 0)),
            ("new_canonical_bound", Ty::new_canonical_bound(tcx, ty::BoundVar::from_u32(0))),
            ("new_anon_bound", <Ty<'tcx> as rustc_type_ir::inherent::Ty<_>>::new_anon_bound(tcx, ty::INNERMOST, ty::BoundVar::from_u32(1))),
            ("new_bound_shifted", Ty::new_bound(tcx, ty::DebruijnIndex::from_u32(1), ty::BoundTy { var: ty::BoundVar::from_u32(0), kind: ty::BoundTyKind::Anon })),
            ("new_placeholder", Ty::new_placeholder(tcx, ty::PlaceholderType::new_anon(ty::UniverseIndex::from_u32(1), ty::BoundVar::from_u32(2)))),
            ("new_error", Ty::new_error(tcx, guar)),
            ("new_unsafe_binder", Ty::new_unsafe_binder(tcx, ty::Binder::dummy(t.i32))),
            ("from_closure_kind_fn", Ty::from_closure_kind(tcx, ty::ClosureKind::Fn)),
            ("from_closure_kind_fn_mut", Ty::from_closure_kind(tcx, ty::ClosureKind::FnMut)),
            ("from_closure_kind_fn_once", Ty::from_closure_kind(tcx, ty::ClosureKind::FnOnce)),
            ("from_coroutine_closure_kind_fn", Ty::from_coroutine_closure_kind(tcx, ty::ClosureKind::Fn)),
            ("from_coroutine_closure_kind_fn_once", Ty::from_coroutine_closure_kind(tcx, ty::ClosureKind::FnOnce)),
        ];
        out.push_str("== types\n");
        for (label, ty) in &types {
            line(&mut out, tcx, label, *ty);
        }
        out.push_str("== identities\n");
        writeln!(out, "new_var_preinterned: {}", Ty::new_var(tcx, ty::TyVid::from_u32(3)) == t.ty_vars[3]).unwrap();
        writeln!(out, "new_tup_empty_is_unit: {}", Ty::new_tup(tcx, &[]) == t.unit).unwrap();
        writeln!(out, "new_static_str_is_imm_ref: {}", Ty::new_static_str(tcx) == Ty::new_imm_ref(tcx, re_static, t.str_)).unwrap();
        writeln!(out, "tuple_fields: {:?}", Ty::new_tup(tcx, &[t.i32, t.bool]).tuple_fields()).unwrap();
        let sig_tys = tcx.mk_type_list(&[t.i32, t.u8, t.bool]);
        writeln!(out, "inputs: {:?}", rustc_type_ir::inherent::Tys::inputs(sig_tys)).unwrap();
        writeln!(out, "output: {:?}", rustc_type_ir::inherent::Tys::output(sig_tys)).unwrap();
        writeln!(out, "contains_self: {}", t.i32.contains(t.i32)).unwrap();
        writeln!(out, "contains_closure_leaf: {}", t.i32.contains_closure()).unwrap();
        out.push_str("== variant_name\n");
        for i in 0..6 {
            writeln!(out, "{i}: {}", ty::CoroutineArgs::<TyCtxt<'tcx>>::variant_name(VariantIdx::from_usize(i))).unwrap();
        }
        out.push_str("== article\n");
        for (label, ty) in &types[..20] {
            writeln!(out, "{label}: {}", ty.kind().article()).unwrap();
        }
        writeln!(out, "new_array_var: {}", Ty::new_array_with_const_len(tcx, t.never, ct_var).kind().article()).unwrap();
        writeln!(out, "new_error: {}", Ty::new_error(tcx, guar).kind().article()).unwrap();
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
