//! typrint: throwaway oracle probe for lane ty-print-b (rustc_middle ty/print/pretty.rs 1705..end). Not a tools/probes
//! probe (lanes may not edit tools/); its outputs are pasted into ../pretty_b.test.ts, whose subject side is ./run.ts.
//!
//! Build (rustc-dev of the pinned nightly):
//!   rustc +nightly --edition 2024 -O probe.rs -o typrint -C link-arg=-Wl,-rpath,$(rustc +nightly --print sysroot)/lib
//! Run: `typrint <rustc args>`. In `after_expansion` it prints the sections below to stdout and stops.
//!   == regions          `<label> <Display> <should_print_optional_region>` (skipped under -Zverbose-internals)
//!   == highlight        region highlights (`'N`)
//!   == crate_name       `print_crate_name` of LOCAL_CRATE (plain, with_crate_prefix, with_resolve_crate_name, both)
//!                       and of every `tcx.crates(())`
//!   == simple           `<def index> <print_path_with_simple> <same under with_crate_prefix>` per `hir_free_items`
//!   == generic_args     `print_path_with_generic_args` with lifetime args, TypeNS and ValueNS; `typed_value`
//!                       (skipped under -Zverbose-internals)
//!   == display          Display of ParamTy, ParamConst, an empty `&List<Ty>`, a lifetime `GenericArg`, a
//!                       `ClauseKind` / `PredicateKind` (`print`) and a region `OutlivesClause` (skipped under -Zverbose-internals)
//!   == byte_str         `pretty_print_byte_str`, `pretty_print_bound_constness`, `should_print_verbose`
//!   == trimmed (<n>)    `ty::print::trimmed_def_paths(tcx, ())` as `<DefId:?> <Symbol>`, sorted by (krate, index)
#![feature(rustc_private)]
extern crate rustc_driver;
extern crate rustc_hir;
extern crate rustc_interface;
extern crate rustc_middle;
extern crate rustc_session;
extern crate rustc_span;
extern crate rustc_type_ir;

use std::fmt::Write as _;
use std::io::Write as _;
use std::process::ExitCode;

use rustc_driver::{Callbacks, Compilation};
use rustc_hir::def::Namespace;
use rustc_hir::def_id::{CRATE_DEF_ID, LOCAL_CRATE};
use rustc_interface::interface;
use rustc_middle::ty::print::{FmtPrinter, PrettyPrinter, Print, Printer, with_crate_prefix, with_resolve_crate_name};
use rustc_middle::ty::{self, GenericArg, TyCtxt};
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::ErrorOutputType;
use rustc_span::{Symbol, kw};

struct TyPrint;

fn regions<'tcx>(tcx: TyCtxt<'tcx>) -> Vec<(&'static str, ty::Region<'tcx>)> {
    let br = |var: u32, kind| ty::BoundRegion { var: ty::BoundVar::from_u32(var), kind };
    vec![
        ("static", tcx.lifetimes.re_static),
        ("erased", tcx.lifetimes.re_erased),
        ("var3", ty::Region::new_var(tcx, ty::RegionVid::from_u32(3))),
        ("early_a", ty::Region::new_early_param(tcx, ty::EarlyParamRegion { index: 0, name: Symbol::intern("'a") })),
        ("early_anon", ty::Region::new_early_param(tcx, ty::EarlyParamRegion { index: 1, name: kw::UnderscoreLifetime })),
        ("bound_named", ty::Region::new_bound(tcx, ty::INNERMOST, br(0, ty::BoundRegionKind::NamedForPrinting(Symbol::intern("'x"))))),
        ("bound_anon", ty::Region::new_bound(tcx, ty::INNERMOST, br(1, ty::BoundRegionKind::Anon))),
        ("bound_env", ty::Region::new_bound(tcx, ty::INNERMOST, br(2, ty::BoundRegionKind::ClosureEnv))),
        (
            "placeholder_named",
            ty::Region::new_placeholder(
                tcx,
                ty::PlaceholderRegion::new(ty::UniverseIndex::ROOT, br(0, ty::BoundRegionKind::NamedForPrinting(Symbol::intern("'p")))),
            ),
        ),
        ("placeholder_anon", ty::Region::new_placeholder(tcx, ty::PlaceholderRegion::new(ty::UniverseIndex::ROOT, br(1, ty::BoundRegionKind::Anon)))),
        (
            "late_named_anon",
            ty::Region::new_late_param(tcx, CRATE_DEF_ID.to_def_id(), ty::LateParamRegionKind::NamedAnon(0, Symbol::intern("'q"))),
        ),
        ("late_anon", ty::Region::new_late_param(tcx, CRATE_DEF_ID.to_def_id(), ty::LateParamRegionKind::Anon(0))),
    ]
}

impl Callbacks for TyPrint {
    fn after_expansion<'tcx>(&mut self, _compiler: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        let mut out = String::new();
        let rs = regions(tcx);
        let verbose = tcx.sess.verbose_internals();

        writeln!(out, "== regions").unwrap();
        if !verbose {
            for (label, r) in &rs {
                let opt = FmtPrinter::new(tcx, Namespace::TypeNS).should_print_optional_region(*r);
                writeln!(out, "{label} {r} {opt}").unwrap();
            }
        }

        writeln!(out, "== highlight").unwrap();
        if !verbose {
            let r = |l: &str| rs.iter().find(|(x, _)| *x == l).unwrap().1;
            let mut p = FmtPrinter::new(tcx, Namespace::TypeNS);
            p.region_highlight_mode.highlighting_region(r("var3"), 7);
            r("var3").print(&mut p).unwrap();
            p.write_str(" ").unwrap();
            r("early_a").print(&mut p).unwrap();
            p.write_str(" ").unwrap();
            p.region_highlight_mode.highlighting_bound_region(ty::BoundRegionKind::Anon, 4);
            r("bound_anon").print(&mut p).unwrap();
            p.write_str(" ").unwrap();
            r("placeholder_anon").print(&mut p).unwrap();
            p.write_str(" ").unwrap();
            r("bound_env").print(&mut p).unwrap();
            let o1 = p.should_print_optional_region(r("bound_anon"));
            let o2 = p.should_print_optional_region(r("var3"));
            let o3 = p.should_print_optional_region(r("erased"));
            writeln!(out, "{} {o1} {o2} {o3}", p.into_buffer()).unwrap();
        }

        writeln!(out, "== crate_name").unwrap();
        let cn = |cnum| FmtPrinter::print_string(tcx, Namespace::TypeNS, |p| p.print_crate_name(cnum)).unwrap();
        writeln!(out, "local [{}]", cn(LOCAL_CRATE)).unwrap();
        writeln!(out, "local+crate_prefix [{}]", with_crate_prefix!(cn(LOCAL_CRATE))).unwrap();
        writeln!(out, "local+resolve_crate_name [{}]", with_resolve_crate_name!(cn(LOCAL_CRATE))).unwrap();
        writeln!(out, "local+both [{}]", with_crate_prefix!(with_resolve_crate_name!(cn(LOCAL_CRATE)))).unwrap();
        for &cnum in tcx.crates(()) {
            writeln!(out, "{} [{}]", cnum.as_u32(), cn(cnum)).unwrap();
        }

        writeln!(out, "== simple").unwrap();
        for id in tcx.hir_free_items() {
            let def_id = id.owner_id.to_def_id();
            let key = tcx.def_key(def_id);
            let simple = |ns| {
                FmtPrinter::print_string(tcx, ns, |p| p.print_path_with_simple(|p| p.print_crate_name(LOCAL_CRATE), &key.disambiguated_data))
                    .unwrap()
            };
            let a = simple(Namespace::TypeNS);
            let b = with_crate_prefix!(simple(Namespace::ValueNS));
            writeln!(out, "{} [{a}] [{b}]", def_id.index.as_u32()).unwrap();
        }

        writeln!(out, "== generic_args").unwrap();
        // (skipped under -Zverbose-internals, where regions print with `{:?}`)
        let args: [GenericArg<'tcx>; 2] = [tcx.lifetimes.re_static.into(), tcx.lifetimes.re_erased.into()];
        for ns in if verbose { vec![] } else { vec![Namespace::TypeNS, Namespace::ValueNS] } {
            let s = FmtPrinter::print_string(tcx, ns, |p| p.print_path_with_generic_args(|p| p.write_str("Foo"), &args)).unwrap();
            let e = FmtPrinter::print_string(tcx, ns, |p| p.print_path_with_generic_args(|p| p.write_str("Foo"), &[])).unwrap();
            let t = FmtPrinter::print_string(tcx, ns, |p| {
                p.typed_value(|p| p.write_str("a"), |p| p.print_path_with_generic_args(|p| p.write_str("T"), &args[..1]), ": ")
            })
            .unwrap();
            writeln!(out, "{ns:?} {s} {e} {t}").unwrap();
        }

        writeln!(out, "== display").unwrap();
        if !verbose {
            let pt = ty::ParamTy::new(0, Symbol::intern("T"));
            let pc = ty::ParamConst::new(1, Symbol::intern("N"));
            let empty = tcx.mk_type_list(&[]);
            let ga: GenericArg<'tcx> = tcx.lifetimes.re_static.into();
            // (no Display: printed with `FmtPrinter::print_string(tcx, TypeNS, |p| x.print(p))`)
            let ck = ty::ClauseKind::UnstableFeature(Symbol::intern("foo"));
            let ck = FmtPrinter::print_string(tcx, Namespace::TypeNS, |p| ck.print(p)).unwrap();
            let pk = ty::PredicateKind::Ambiguous;
            let pk = FmtPrinter::print_string(tcx, Namespace::TypeNS, |p| pk.print(p)).unwrap();
            let oc = ty::OutlivesClause::<TyCtxt<'tcx>, _>(tcx.lifetimes.re_static, tcx.lifetimes.re_erased);
            writeln!(out, "{pt} {pc} {empty} {ga} [{ck}] [{pk}] [{oc}]").unwrap();
        }

        writeln!(out, "== byte_str").unwrap();
        let mut p = FmtPrinter::new(tcx, Namespace::ValueNS);
        p.pretty_print_byte_str(b"a\x00\t\n\r\\'\"\x7f\xff ~Z").unwrap();
        p.write_str(" ").unwrap();
        p.pretty_print_bound_constness(ty::BoundConstness::Const).unwrap();
        p.pretty_print_bound_constness(ty::BoundConstness::Maybe).unwrap();
        let v = p.should_print_verbose();
        writeln!(out, "{} {v}", p.into_buffer()).unwrap();

        // The provider itself (its `DefIdMap` can be iterated; the query value is an `UnordMap`).
        let map = rustc_middle::ty::print::trimmed_def_paths(tcx, ());
        let entries = map.items().map(|(d, s)| ((d.krate.as_u32(), d.index.as_u32()), *d, *s)).into_sorted_stable_ord_by_key(|e| &e.0);
        writeln!(out, "== trimmed ({})", entries.len()).unwrap();
        for (_, d, s) in entries {
            writeln!(out, "{d:?} {s}").unwrap();
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
    let mut callbacks = TyPrint;
    rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&rustc_driver::args::raw_args(&early_dcx), &mut callbacks))
}
