//! Oracle probe for the `borrowck-ui*` suites (plan-m4 D2, M4b): runs a compilation with the
//! pinned nightly's own `rustc_driver` (rustc-dev component, `#![feature(rustc_private)]`) up to
//! and including the real `analysis` query, and stops right after it.
//!
//!   ckdump <rustc arguments...>
//!
//! Setup as `tydump` / `mirdump` (see their headers): `rustc_driver_impl::main`'s
//! `init_rustc_env_logger`, `install_ice_hook(DEFAULT_BUG_REPORT_URL)` and
//! `catch_with_exit_code(|| compiler_entrypoint(&raw_args(..), &mut callbacks))` (at the pin
//! `compiler_entrypoint` is what D2 calls `run_compiler`). The callbacks are rustc's own
//! `TimePassesCallbacks` minus time-passes, plus a stop:
//! - `config`: `trimmed_def_paths = true`, as `TimePassesCallbacks::config` (no time-passes total
//!   is printed, so `-Ztime-passes` output would lack the final `total` line);
//! - `after_analysis` returns `Compilation::Stop`.
//!
//! Nothing else is replaced and no upstream code is copied: `compiler_entrypoint` runs exactly as in
//! `rustc` (option handling, `--print`, `-Zunpretty` / pretty printing, which returns before any
//! callback, parsing, `after_crate_root_parsing`, expansion, `write_dep_info`, `write_interface`,
//! the `-Zno-analysis` / dep-info-only exits), then `tcx.ensure_ok().analysis(())`: the whole of
//! rustc_interface/src/passes.rs:1209 `analysis` (`run_required_analyses` with
//! `rustc_hir_analysis::check_crate` including its const-eval arm, the `MIR_borrow_checking` loop
//! with `mir_borrowck`, `check_transmutes`, `mir_drops_elaborated_and_const_checked` (with
//! `should_codegen()` or in a const context) and the coroutine `layout_of`, `layout_test` /
//! `abi_test`; the error abort `has_errors_excluding_lint_errors` -> `raise_fatal`; then
//! misc_checking_3: effective visibilities, private-in-public, dead code, late lints,
//! clashing extern declarations, privacy, lint expectations, `all_diagnostic_items`,
//! `all_canonical_symbols`; and the `-Zvalidate-mir` final-MIR loop).
//!
//! What the stop leaves out, compared with a real `rustc` run of the same argv: `--emit=mir`
//! (`pretty::emit_mir`), `Linker::codegen_and_build_linker` (with `--emit=metadata`, metadata
//! encoding: plan-m4 section 1e; without it, monomorphization and codegen),
//! `-Zmetrics-dir`, `tcx.report_unused_features()` (the `unused_features` lint) and linking. So
//! the probe writes no output file (a test's own `-Zdump-mir`, `-Zunpretty` or `--emit=dep-info`
//! still write theirs), stdout is empty unless the argv asks for printing (`--print`,
//! `-Zunpretty`, ...), and stderr is every diagnostic up to the end of `analysis`, followed by the
//! usual end-of-session summary (`aborting due to ...`, `N warnings emitted`), as rustc's
//! `interface::run_compiler` prints it. The exit code is rustc's.
#![feature(rustc_private)]
extern crate rustc_driver;
extern crate rustc_interface;
extern crate rustc_middle;
extern crate rustc_session;

use std::process::ExitCode;

use rustc_driver::{Callbacks, Compilation};
use rustc_interface::interface;
use rustc_middle::ty::TyCtxt;
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::ErrorOutputType;

struct CkDump;

impl Callbacks for CkDump {
    #[allow(rustc::bad_opt_access)]
    fn config(&mut self, config: &mut interface::Config) {
        // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
        config.opts.trimmed_def_paths = true;
    }

    fn after_analysis<'tcx>(&mut self, _compiler: &interface::Compiler, _tcx: TyCtxt<'tcx>) -> Compilation {
        Compilation::Stop
    }
}

fn main() -> ExitCode {
    let early_dcx = EarlyDiagCtxt::new(ErrorOutputType::default());
    // As rustc_driver_impl::main: tracing's default filter (`RUSTC_LOG` unset) prints WARN and ERROR events.
    rustc_driver::init_rustc_env_logger(&early_dcx);
    rustc_driver::install_ice_hook(rustc_driver::DEFAULT_BUG_REPORT_URL, |_| ());
    let mut callbacks = CkDump;
    rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&rustc_driver::args::raw_args(&early_dcx), &mut callbacks))
}
