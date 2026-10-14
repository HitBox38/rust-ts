//! tyrepr: throwaway oracle probe for lane repr-options (rustc_abi `ReprOptions`, rustc_middle
//! `TyCtxt::repr_options_of_def`). Not a tools/probes probe (lanes may not edit tools/); its outputs are stored in
//! ./expected.json, whose subject side is ./run.ts.
//!
//! Build (rustc-dev of the pinned nightly):
//!   rustc +nightly --edition 2024 -O probe.rs -o tyrepr -C link-arg=-Wl,-rpath,$(rustc +nightly --print sysroot)/lib
//! Run: `tyrepr <rustc args>`. In `after_expansion` it prints, for every local struct / enum / union in
//! `hir_crate_items(()).definitions()` order:
//!   `<item name> {:?}` of `tcx.repr_options_of_def(def_id)`
//!   `  c simd scalable rust packed transparent linear inhibit_enum_layout_opt inhibit_newtype_abi_optimization
//!      inhibit_struct_field_reordering can_randomize_type_layout inhibits_union_abi_opt` (as `true`/`false`)
//!   `  discr_type {:?}` (enums only)
//! then `== pretty` and the `{:#?}` of the first one, then stops.
#![feature(rustc_private)]
extern crate rustc_driver;
extern crate rustc_hir;
extern crate rustc_interface;
extern crate rustc_middle;
extern crate rustc_session;

use std::fmt::Write as _;
use std::io::Write as _;
use std::process::ExitCode;

use rustc_driver::{Callbacks, Compilation};
use rustc_hir::def::DefKind;
use rustc_interface::interface;
use rustc_middle::ty::TyCtxt;
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::ErrorOutputType;

struct TyRepr;

impl Callbacks for TyRepr {
    fn after_expansion<'tcx>(&mut self, _compiler: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        let mut out = String::new();
        let mut first = None;
        for def_id in tcx.hir_crate_items(()).definitions() {
            let kind = tcx.def_kind(def_id);
            if !matches!(kind, DefKind::Struct | DefKind::Enum | DefKind::Union) {
                continue;
            }
            let r = tcx.repr_options_of_def(def_id);
            writeln!(out, "{} {:?}", tcx.item_name(def_id.to_def_id()), r).unwrap();
            writeln!(
                out,
                "  {} {} {} {} {} {} {} {} {} {} {} {}",
                r.c(),
                r.simd(),
                r.scalable(),
                r.rust(),
                r.packed(),
                r.transparent(),
                r.linear(),
                r.inhibit_enum_layout_opt(),
                r.inhibit_newtype_abi_optimization(),
                r.inhibit_struct_field_reordering(),
                r.can_randomize_type_layout(),
                r.inhibits_union_abi_opt(),
            )
            .unwrap();
            if kind == DefKind::Enum {
                writeln!(out, "  discr_type {:?}", r.discr_type()).unwrap();
            }
            first.get_or_insert(r);
        }
        writeln!(out, "== pretty").unwrap();
        if let Some(r) = first {
            writeln!(out, "{r:#?}").unwrap();
        }
        let mut stdout = std::io::stdout();
        stdout.write_all(out.as_bytes()).unwrap();
        stdout.flush().unwrap();
        Compilation::Stop
    }
}

fn main() -> ExitCode {
    let early_dcx = EarlyDiagCtxt::new(ErrorOutputType::default());
    rustc_driver::install_ice_hook(rustc_driver::DEFAULT_BUG_REPORT_URL, |_| ());
    let mut callbacks = TyRepr;
    rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&rustc_driver::args::raw_args(&early_dcx), &mut callbacks))
}
