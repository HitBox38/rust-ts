//! langitems: oracle probe for `tcx.lang_items()` (rustc_passes/src/lang_items.rs `get_lang_items`, lane lang-items).
//!
//! A rustc-dev probe: runs the oracle compiler itself with the given rustc arguments and
//! - in `after_expansion` (right after `tcx.resolver_for_lowering()`), calls `tcx.lang_items()`, prints the
//!   dump below to stdout and returns `Compilation::Stop`.
//! So stderr holds the diagnostics up to and including the lang item collection (E0152, E0718, the weak lang
//! item errors), then rustc's `aborting due to ..` summary; the exit code is rustc's.
//!
//! Output (stdout), every value with its upstream `{:?}`:
//!   == items (<n>)      then `<LangItem:?> <DefId:?>` per `LanguageItems::iter()` (LangItem order)
//!   == missing (<n>)    then `<LangItem:?>` per `LanguageItems::missing` (Vec order)
//!   == from_def_id      then `<DefId:?> <Option<LangItem>:?>` for each item above (`tcx.as_lang_item`)
//! The subject side is src/rustc_passes/oracle/run.ts.
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

struct LangItems;

impl Callbacks for LangItems {
    fn after_expansion<'tcx>(&mut self, _compiler: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        let items = tcx.lang_items();
        let mut out = String::new();
        let all: Vec<_> = items.iter().collect();
        writeln!(out, "== items ({})", all.len()).unwrap();
        for (item, def_id) in &all {
            writeln!(out, "{item:?} {def_id:?}").unwrap();
        }
        writeln!(out, "== missing ({})", items.missing.len()).unwrap();
        for item in &items.missing {
            writeln!(out, "{item:?}").unwrap();
        }
        writeln!(out, "== from_def_id").unwrap();
        for (_, def_id) in &all {
            writeln!(out, "{def_id:?} {:?}", tcx.as_lang_item(*def_id)).unwrap();
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
    let mut callbacks = LangItems;
    rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&rustc_driver::args::raw_args(&early_dcx), &mut callbacks))
}
