//! Oracle probe for lane check-region-intrinsic: prints the `region_scope_tree` of every body.
//!
//!   scopedump <rustc arguments...>
//!
//! Runs the compilation with the pinned nightly's own `rustc_driver` (as tools/probes/thirdump) and, in
//! `after_expansion` (right after `tcx.resolver_for_lowering()`), prints for every `tcx.hir_body_owners()`, in that
//! order, `"{did:?}:\n{tree:#?}\n"` with `tree = tcx.region_scope_tree(did)` (closures and inline consts print
//! their typeck root's tree, as the query redirects them), then returns `Compilation::Stop`. Nothing else runs, so
//! a crate with type errors still prints. The whole stdout is written at the end; the exit code is rustc's.
#![feature(rustc_private)]
extern crate rustc_driver;
extern crate rustc_interface;
extern crate rustc_middle;
extern crate rustc_session;

use std::fmt::Write as _;
use std::io::Write as _;
use std::process::ExitCode;

use rustc_driver::{Callbacks, Compilation};
use rustc_interface::interface;
use rustc_middle::ty::TyCtxt;
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::ErrorOutputType;

struct ScopeDump;

impl Callbacks for ScopeDump {
    fn after_expansion<'tcx>(&mut self, _compiler: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        let mut out = String::new();
        for did in tcx.hir_body_owners() {
            let tree = tcx.region_scope_tree(did);
            let _ = writeln!(out, "{:?}:\n{:#?}\n", did, tree);
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
    let mut callbacks = ScopeDump;
    rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&rustc_driver::args::raw_args(&early_dcx), &mut callbacks))
}
