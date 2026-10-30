//! Oracle probe for src/rustc_session/dep_tracking.oracle.test.ts (lane passes-reachable): prints the
//! command-line dependency-tracking hash of a rustc argv, the value the crate hash (SVH) is seeded with
//! (rustc_metadata encoder.rs `with_encode_metadata_header`, rustc_middle hir/map.rs `crate_hash`).
//!
//!   optshash <rustc arguments...>
//!
//! Runs the pinned nightly's own `rustc_driver::compiler_entrypoint` with rustc's own `config` callback
//! effect (`TimePassesCallbacks::config` sets `trimmed_def_paths = true`, a tracked option), then, after
//! the crate root is parsed (the session exists), prints
//!
//!   crate_hash <sess.opts.dep_tracking_hash(true) as u64, 16 hex digits>
//!   incr_hash <sess.opts.dep_tracking_hash(false) as u64, 16 hex digits>
//!
//! and stops (`Compilation::Stop`): no expansion, analysis or output files.
#![feature(rustc_private)]
extern crate rustc_ast;
extern crate rustc_driver;
extern crate rustc_interface;
extern crate rustc_session;

use std::process::ExitCode;

use rustc_driver::{Callbacks, Compilation};
use rustc_interface::interface;
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::ErrorOutputType;

struct OptsHash;

impl Callbacks for OptsHash {
    #[allow(rustc::bad_opt_access)]
    fn config(&mut self, config: &mut interface::Config) {
        // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs).
        config.opts.trimmed_def_paths = true;
    }

    fn after_crate_root_parsing(&mut self, compiler: &interface::Compiler, _krate: &mut rustc_ast::Crate) -> Compilation {
        let opts = &compiler.sess.opts;
        println!("crate_hash {:016x}", opts.dep_tracking_hash(true).as_u64());
        println!("incr_hash {:016x}", opts.dep_tracking_hash(false).as_u64());
        Compilation::Stop
    }
}

fn main() -> ExitCode {
    let early_dcx = EarlyDiagCtxt::new(ErrorOutputType::default());
    rustc_driver::init_rustc_env_logger(&early_dcx);
    rustc_driver::install_ice_hook(rustc_driver::DEFAULT_BUG_REPORT_URL, |_| ());
    let mut callbacks = OptsHash;
    rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&rustc_driver::args::raw_args(&early_dcx), &mut callbacks))
}
