//! Oracle probe for src/rustc_monomorphize/partitioning.oracle.test.ts. A rustc-dev program: the pinned nightly's own
//! `rustc_driver`, stopped after `collect_and_partition_mono_items`.
//!
//! `-Zprint-mono-items` shows only an item's CGUs and linkage. This prints what the partitioner decides beyond that and the
//! backend reads later, one line each:
//!     CGU <name> sym=<symbol_name, from mangle_cgu> size=<size_estimate> primary=<is_primary> covdead=<..> n=<items>
//!     IT <item> <linkage> <visibility> inlined=<inlined> size=<size_estimate>     (in `items()` insertion order)
//!     DO <symbol name> <item>                                                     (in `items_in_deterministic_order`)
//!     ALL <number of `all_mono_items`>
//!
//! Built by partitioning_oracle/regen.ts with RUSTC_BOOTSTRAP=1; not in tools/probes, which lanes do not edit.
#![feature(rustc_private)]
extern crate rustc_driver;
extern crate rustc_interface;
extern crate rustc_middle;
extern crate rustc_session;

use std::process::ExitCode;

use rustc_driver::{Callbacks, Compilation};
use rustc_interface::interface;
use rustc_middle::ty::TyCtxt;
use rustc_middle::ty::print::with_no_trimmed_paths;
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::ErrorOutputType;

struct Probe;

impl Callbacks for Probe {
    #[allow(rustc::bad_opt_access)]
    fn config(&mut self, config: &mut interface::Config) {
        // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
        config.opts.trimmed_def_paths = true;
    }

    fn after_analysis<'tcx>(&mut self, _compiler: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        let partitions = tcx.collect_and_partition_mono_items(());
        for cgu in partitions.codegen_units {
            println!(
                "CGU {} sym={} size={} primary={} covdead={} n={}",
                cgu.name(),
                cgu.symbol_name(),
                cgu.size_estimate(),
                cgu.is_primary(),
                cgu.is_code_coverage_dead_code_cgu(),
                cgu.items().len()
            );
            for (item, data) in cgu.items() {
                println!(
                    "IT {} {:?} {:?} inlined={} size={}",
                    with_no_trimmed_paths!(item.to_string()),
                    data.linkage,
                    data.visibility,
                    data.inlined,
                    data.size_estimate
                );
            }
            for (item, _) in cgu.items_in_deterministic_order(tcx) {
                println!("DO {} {}", item.symbol_name(tcx), with_no_trimmed_paths!(item.to_string()));
            }
        }
        println!("ALL {}", partitions.all_mono_items.len());
        Compilation::Stop
    }
}

fn main() -> ExitCode {
    let early_dcx = EarlyDiagCtxt::new(ErrorOutputType::default());
    rustc_driver::init_rustc_env_logger(&early_dcx);
    rustc_driver::install_ice_hook(rustc_driver::DEFAULT_BUG_REPORT_URL, |_| ());
    let mut callbacks = Probe;
    rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&rustc_driver::args::raw_args(&early_dcx), &mut callbacks))
}
