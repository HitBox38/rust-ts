//! Oracle probe for the `thirdump-*` suites (plan-m3 D1/D1a): runs a compilation with the pinned
//! nightly's own `rustc_driver` (rustc-dev component, `#![feature(rustc_private)]`), stops it
//! after type checking, and prints the THIR of every body, without building MIR.
//!
//!   thirdump <rustc arguments...>
//!
//! Setup as `tydump` (see its header): `rustc_driver_impl::main` with callbacks whose `config`
//! sets `trimmed_def_paths = true` (as `TimePassesCallbacks::config`) and whose `after_expansion`
//! (right after `tcx.resolver_for_lowering()`) runs the steps below, prints stdout and returns
//! `Compilation::Stop`. Nothing is written to disk; the exit code is rustc's.
//!
//! Steps (the `-Zunpretty=thir-flat` / `thir-tree` path of rustc_driver_impl/src/pretty.rs:232
//! `print` with the D1 prefix in place of `analysis`):
//! 1. `prefix::run_required_analyses_prefix` (`../tydump/prefix.rs`, shared with tydump):
//!    `run_required_analyses` up to `definitions.freeze()`, with `rustc_hir_analysis::check_crate`
//!    minus its const-eval arm (D1, D1a; that file's header lists every difference). Upstream's
//!    `print` runs the whole `analysis` here (MIR borrowck etc.: M4) and then `check_crate` once
//!    more (all queries, cached; its `#[rustc_dump_*]` dumps would emit again but only after the
//!    first round's errors stopped `analysis`), so neither is repeated.
//! 2. `tcx.dcx().abort_if_errors()` (pretty.rs:336; :325 for thir-tree): any error so far ends the process with
//!    rustc's `aborting due to ..` and exit code 1, before anything is printed.
//! 3. For every `tcx.hir_body_owners()`, in that order, `"{did:?}:\n{text}\n"` (pretty.rs:339).
//!    `text` is `rustc_mir_build::thir::print::thir_flat(tcx, did)`, i.e. `{:#?}` of the stolen
//!    `thir_body` (`"error"` if `thir_body` fails), as `-Zunpretty=thir-flat` prints. With
//!    `THIRDUMP_FORMAT=tree` in the environment it is `thir_tree(tcx, did)` instead, the
//!    `-Zunpretty=thir-tree` format (pretty.rs:328). Each fn steals the body's THIR, so one process
//!    prints one format. The suites use the default (flat).
//! The whole stdout is written at the end (as `write_or_print`), so a later ICE or fatal error
//! leaves stdout empty, as with rustc.
#![feature(rustc_private)]
extern crate rustc_attr_ir;
extern crate rustc_data_structures;
extern crate rustc_driver;
extern crate rustc_errors;
extern crate rustc_hir;
extern crate rustc_interface;
extern crate rustc_metadata;
extern crate rustc_middle;
extern crate rustc_mir_build;
extern crate rustc_passes;
extern crate rustc_session;
extern crate rustc_span;

#[path = "../tydump/prefix.rs"]
mod prefix;

use std::fmt::Write as _;
use std::io::Write as _;
use std::process::ExitCode;

use rustc_driver::{Callbacks, Compilation};
use rustc_interface::interface;
use rustc_middle::ty::TyCtxt;
use rustc_mir_build::thir::print::{thir_flat, thir_tree};
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::ErrorOutputType;

struct ThirDump {
    tree: bool,
}

impl Callbacks for ThirDump {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
    #[allow(rustc::bad_opt_access)]
    fn config(&mut self, config: &mut interface::Config) {
        config.opts.trimmed_def_paths = true;
    }

    fn after_expansion<'tcx>(&mut self, _compiler: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        let _ = prefix::run_required_analyses_prefix(tcx);
        tcx.dcx().abort_if_errors();
        let mut out = String::new();
        for did in tcx.hir_body_owners() {
            let text = if self.tree { thir_tree(tcx, did) } else { thir_flat(tcx, did) };
            let _ = writeln!(out, "{:?}:\n{}\n", did, text);
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
    let tree = std::env::var_os("THIRDUMP_FORMAT").is_some_and(|v| v == "tree");
    let mut callbacks = ThirDump { tree };
    rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&rustc_driver::args::raw_args(&early_dcx), &mut callbacks))
}
