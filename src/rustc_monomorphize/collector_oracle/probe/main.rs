//! Oracle probe for src/rustc_monomorphize/collector.oracle.test.ts (lane mono-collector). A rustc-dev program: the pinned
//! nightly's own `rustc_driver`, stopped after `collect_and_partition_mono_items`.
//!
//! `collect_crate_mono_items` is `pub(crate)` and its sorted `Vec` is not observable from outside (`-Zprint-mono-items`
//! sorts again, by text), so this prints what that order is made of, for every item in a codegen unit:
//!     FP <fingerprint as 32 hex digits> <item, with_no_trimmed_paths>
//! `MonoItem::to_stable_hash_key`, the sort key of `into_sorted(hcx, true)`, is public. An item that no CGU holds has no
//! line here (the test reports how many of the `MONO_ITEM` lines were covered).
//!
//! Built by collector_oracle/regen.ts with RUSTC_BOOTSTRAP=1; not in tools/probes, which lanes do not edit.
#![feature(rustc_private)]
extern crate rustc_data_structures;
extern crate rustc_driver;
extern crate rustc_interface;
extern crate rustc_middle;
extern crate rustc_session;

use std::collections::BTreeMap;
use std::process::ExitCode;

use rustc_data_structures::fingerprint::Fingerprint;
use rustc_data_structures::stable_hash::ToStableHashKey;
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
        let mut out: BTreeMap<Fingerprint, String> = BTreeMap::new();
        tcx.with_stable_hashing_context(|mut hcx| {
            for cgu in partitions.codegen_units {
                for (item, _) in cgu.items() {
                    let fp: Fingerprint = item.to_stable_hash_key(&mut hcx);
                    out.insert(fp, with_no_trimmed_paths!(item.to_string()));
                }
            }
        });
        for (fp, item) in out {
            let (a, b) = fp.split();
            println!("FP {:016x}{:016x} {item}", a.as_u64(), b.as_u64());
        }
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
