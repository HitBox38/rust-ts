//! Oracle probe of print.oracle.test.ts (lane ty-print-a): `format!("{}", ty)` for interned types, and def paths.
//!
//! A rustc-dev program (not a tools/probes probe: lanes may not edit tools/). It runs the pinned rustc on its
//! arguments and, in `after_expansion`, prints to stdout:
//!   == types           `<label>: <Display>` for types built with rustc's own constructors (no def paths)
//!   == local           `<DefIndex> <DefKind:?> | <def_path_str> | <with_crate_prefix!> | <with_forced_trimmed_paths!>`
//!                      for every local `DefIndex` but the crate root (`-` where the forced column would need
//!                      the `trimmed_def_paths` query: a variant or an item under one)
//!   == lang            the same three columns for a few std lang items (visible re-export paths)
//! then returns `Compilation::Stop`. `config.opts.trimmed_def_paths` keeps its default (`false`).
//! Build: rustc +nightly --edition 2024 probe.rs -o probe -C link-arg=-Wl,-rpath,$(rustc +nightly --print sysroot)/lib
#![feature(rustc_private)]
extern crate rustc_abi;
extern crate rustc_attr_ir;
extern crate rustc_driver;
extern crate rustc_hir;
extern crate rustc_interface;
extern crate rustc_middle;
extern crate rustc_session;
extern crate rustc_span;

use std::fmt::Write as _;
use std::io::Write as _;
use std::process::ExitCode;

use rustc_abi::ExternAbi;
use rustc_driver::{Callbacks, Compilation};
use rustc_attr_ir::lang_items::LangItem;
use rustc_hir::def::DefKind;
use rustc_interface::interface;
use rustc_middle::ty::print::{with_crate_prefix, with_forced_trimmed_paths};
use rustc_middle::ty::{self, FnSigKind, Ty, TyCtxt};
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::ErrorOutputType;
use rustc_span::def_id::{DefId, LocalDefId};

struct Probe;

fn fn_ptr<'tcx>(tcx: TyCtxt<'tcx>, inputs: &[Ty<'tcx>], output: Ty<'tcx>, kind: FnSigKind<'tcx>) -> Ty<'tcx> {
    let sig = tcx.mk_fn_sig(inputs.iter().copied(), output, kind);
    Ty::new_fn_ptr(tcx, ty::Binder::dummy(sig))
}

fn paths(out: &mut String, tcx: TyCtxt<'_>, label: &str, def_id: DefId) {
    let kind = tcx.def_kind(def_id);
    let plain = tcx.def_path_str(def_id);
    let prefix = with_crate_prefix!(tcx.def_path_str(def_id));
    // `with_forced_trimmed_paths` prints variants through the `trimmed_def_paths` query (lane ty-print-b).
    let mut through_variant = false;
    let mut cur = Some(def_id);
    while let Some(d) = cur {
        through_variant |= matches!(tcx.def_kind(d), DefKind::Variant);
        cur = tcx.opt_parent(d);
    }
    let forced = if through_variant {
        "-".to_string()
    } else {
        with_forced_trimmed_paths!(tcx.def_path_str(def_id))
    };
    writeln!(out, "{label} {kind:?} | {plain} | {prefix} | {forced}").unwrap();
}

impl Callbacks for Probe {
    fn after_expansion<'tcx>(&mut self, _compiler: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        let mut out = String::new();
        let t = &tcx.types;
        let re_static = tcx.lifetimes.re_static;
        let re_erased = tcx.lifetimes.re_erased;
        let rust = FnSigKind::dummy();
        let unsafe_c = FnSigKind::new(ExternAbi::C { unwind: false }, rustc_hir::Safety::Unsafe, true, None, 1).unwrap();
        let system = FnSigKind::new(ExternAbi::System { unwind: true }, rustc_hir::Safety::Safe, false, None, 0).unwrap();
        let types: Vec<(&str, Ty<'tcx>)> = vec![
            ("bool", t.bool),
            ("char", t.char),
            ("i8", t.i8),
            ("isize", t.isize),
            ("u128", t.u128),
            ("usize", t.usize),
            ("f16", t.f16),
            ("f32", t.f32),
            ("f64", t.f64),
            ("f128", t.f128),
            ("str", t.str_),
            ("never", t.never),
            ("unit", t.unit),
            ("tuple1", Ty::new_tup(tcx, &[t.u8])),
            ("tuple2", Ty::new_tup(tcx, &[t.i32, t.bool])),
            ("tuple_nested", Ty::new_tup(tcx, &[t.unit, Ty::new_tup(tcx, &[t.char]), t.never])),
            ("ref_erased", Ty::new_imm_ref(tcx, re_erased, t.i32)),
            ("ref_static", Ty::new_imm_ref(tcx, re_static, t.str_)),
            ("mut_ref_static", Ty::new_mut_ref(tcx, re_static, t.u8)),
            ("mut_ref_erased", Ty::new_mut_ref(tcx, re_erased, Ty::new_tup(tcx, &[t.u8, t.u16]))),
            ("ptr_const", Ty::new_imm_ptr(tcx, t.u8)),
            ("ptr_mut", Ty::new_mut_ptr(tcx, t.unit)),
            ("slice", Ty::new_slice(tcx, t.u8)),
            ("slice_of_refs", Ty::new_slice(tcx, Ty::new_imm_ref(tcx, re_static, t.str_))),
            ("fn_unit", fn_ptr(tcx, &[], t.unit, rust)),
            ("fn_i32_bool", fn_ptr(tcx, &[t.i32], t.bool, rust)),
            ("fn_two", fn_ptr(tcx, &[t.i32, Ty::new_imm_ref(tcx, re_static, t.str_)], Ty::new_tup(tcx, &[t.u8]), rust)),
            ("fn_unsafe_c_variadic", fn_ptr(tcx, &[t.u8], t.never, unsafe_c)),
            ("fn_system_unwind", fn_ptr(tcx, &[], t.unit, system)),
            ("fn_returning_fn", fn_ptr(tcx, &[t.char], fn_ptr(tcx, &[], t.i64, rust), rust)),
            ("ty_var", Ty::new_var(tcx, ty::TyVid::from_u32(3))),
            ("int_var", Ty::new_int_var(tcx, ty::IntVid::from_u32(0))),
            ("float_var", Ty::new_float_var(tcx, ty::FloatVid::from_u32(0))),
            ("fresh", Ty::new_fresh(tcx, 1)),
            ("fresh_int", Ty::new_fresh_int(tcx, 2)),
            ("fresh_float", Ty::new_fresh_float(tcx, 0)),
            ("error", Ty::new_error(tcx, rustc_span::ErrorGuaranteed::unchecked_error_guaranteed())),
        ];
        writeln!(out, "== types").unwrap();
        for (label, ty) in types {
            writeln!(out, "{label}: {ty}").unwrap();
        }
        writeln!(out, "== local").unwrap();
        let n = tcx.definitions_untracked().num_definitions();
        for i in 1..n {
            let def_id = LocalDefId { local_def_index: i.into() }.to_def_id();
            paths(&mut out, tcx, &i.to_string(), def_id);
        }
        writeln!(out, "== lang").unwrap();
        for item in [LangItem::OwnedBox, LangItem::Option, LangItem::OptionSome, LangItem::String, LangItem::Sized, LangItem::Iterator, LangItem::FnOnce, LangItem::FnOnceOutput] {
            if let Some(def_id) = tcx.lang_items().get(item) {
                paths(&mut out, tcx, &format!("{item:?}"), def_id);
            }
        }
        let mut stdout = std::io::stdout().lock();
        stdout.write_all(out.as_bytes()).unwrap();
        stdout.flush().unwrap();
        Compilation::Stop
    }
}

fn main() -> ExitCode {
    let early_dcx = EarlyDiagCtxt::new(ErrorOutputType::default());
    rustc_driver::install_ice_hook(rustc_driver::DEFAULT_BUG_REPORT_URL, |_| ());
    let mut callbacks = Probe;
    rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&rustc_driver::args::raw_args(&early_dcx), &mut callbacks))
}
