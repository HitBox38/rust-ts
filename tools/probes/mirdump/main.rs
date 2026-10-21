//! Oracle probe for the `mirdump-*` suites (plan-m4 D2, M4a): runs a compilation with the pinned
//! nightly's own `rustc_driver` (rustc-dev component, `#![feature(rustc_private)]`), stops it after
//! MIR building and promotion (no borrowck, no drop elaboration, no CTFE arm), and prints the MIR
//! of every `mir_keys` item with rustc's own `MirWriter`.
//!
//!   mirdump <rustc arguments...>
//!
//! Setup as `tydump` (see its header): `rustc_driver_impl::main`'s `init_rustc_env_logger`,
//! `install_ice_hook(DEFAULT_BUG_REPORT_URL)` and
//! `catch_with_exit_code(|| compiler_entrypoint(&raw_args(..), &mut callbacks))`, with callbacks
//! whose `after_expansion` (right after `tcx.resolver_for_lowering()`) runs the steps below,
//! prints stdout and returns `Compilation::Stop`. Nothing is written to disk by the probe itself
//! (a test's own `-Zdump-mir` / `-o` flags still apply). The exit code is rustc's.
//!
//! `config` does three things:
//! - `trimmed_def_paths = true`, as rustc's `TimePassesCallbacks::config` (minus time-passes);
//! - `unstable_opts.unpretty = Some("mir")`: the one effect of `-Zunpretty=mir` on the session
//!   that the printing depends on. `MirWriter` prints with trimmed paths, as it does for
//!   `-Zunpretty=mir`; `trimmed_def_paths` (the query) then calls
//!   `Session::record_trimmed_def_paths`, which arms the "`trimmed_def_paths` called, diagnostics
//!   were expected but none were emitted" ICE unless `unstable_opts.unpretty` (or `-Zdump-mir`,
//!   `--emit=mir`, ...) is set. `unstable_opts.unpretty` is `[UNTRACKED]` and read nowhere else at
//!   the pin (`opts.pretty`, which selects the driver's pretty-print path, was computed from the
//!   command line before `config` runs and stays as it was);
//! - `override_queries` wraps the `mir_built` and `mir_promoted` providers (rustc_mir_transform's,
//!   unchanged) so that each records a copy (`Clone`) of the value it returns, before anyone can
//!   steal it (`mir_promoted` steals `mir_built`, `mir_drops_elaborated_and_const_checked` steals
//!   `mir_promoted`'s body, `promoted_mir` its promoteds). Recording runs no query and changes no
//!   value. A `mir_built` value that is fed instead of provided (the coroutine-closure by-move
//!   bodies of `coroutine_by_move_body_def_id`) is read from the query itself.
//!
//! Steps:
//! 1. `prefix::run_required_analyses_prefix` (`../tydump/prefix.rs`, as tydump/thirdump): the
//!    analysis up to `definitions.freeze()`, `check_crate` without its const-eval arm (plan-m3 D1a).
//! 2. The `MIR_borrow_checking` loop of `run_required_analyses` (rustc_interface/src/passes.rs:1163),
//!    verbatim except that `mir_borrowck`, `check_transmutes`,
//!    `mir_drops_elaborated_and_const_checked` and the coroutine `layout_of` are left out (plan-m4 D2).
//!    `check_unsafety`, `is_trivial_const`, `check_offloads` (with `-Zoffload`),
//!    `has_ffi_unwind_calls` and `check_liveness` run as upstream (`check_liveness` is what computes
//!    `mir_promoted` of most bodies here).
//! 3. The dump (D2 prints where `mir_borrowck` was; this probe prints after the loop, in `mir_keys`
//!    order, from the copies above, which are exactly what `mir_built(def).borrow()` /
//!    `mir_promoted(def)` gave before they were stolen). For every `tcx.mir_keys(())` item, in order,
//!    items separated by one empty line (as `write_mir_pretty`), `writer = MirWriter::new(tcx)`:
//!    - a trivial const (`tcx.trivial_const(def)` is `Some((val, ty))`): `write_mir_pretty`'s
//!      one-liner, `const <def_path_str>: <ty> = const <Const::Val(val, ty)>;`;
//!    - a constructor (`tcx.is_constructor`; they have no `mir_built`): `// mir_for_ctfe`, then
//!      `writer.write_mir_fn(tcx.mir_for_ctfe(def))` (`shim::build_adt_ctor`, what `-Zunpretty=mir`
//!      prints for them);
//!    - otherwise: `// mir_built`, then `write_mir_fn` of the `mir_built` copy (calling
//!      `tcx.mir_built(def)` first if nothing computed it yet); an empty line; `// mir_promoted`,
//!      then `write_mir_fn` of the `mir_promoted` body copy (calling `tcx.mir_promoted(def)` first
//!      if needed), then for each promoted fragment an empty line and its `write_mir_fn`
//!      (`render_body`'s layout).
//!    `write_mir_fn` is upstream's (`write_mir_intro`, the blocks, `}`, `write_allocations`), with the
//!    CLI's `PrettyPrintMirOptions` and no extra data (no `mir_pretty_extra_data` hook).
//!    The dump is printed whether or not there were errors (as tydump; `-Zunpretty=mir` would stop
//!    at the error abort of `analysis`). Queries the dump forces (constructors' `mir_for_ctfe`, the
//!    `mir_built` / `mir_promoted` of bodies the loop did not reach) emit their diagnostics in dump
//!    order.
//! The whole stdout is written at the end, so a later ICE or fatal error leaves stdout empty.
//! The `par_*` helpers run sequentially in order with the default `-Zthreads=1`.
#![feature(rustc_private)]
extern crate rustc_attr_ir;
extern crate rustc_data_structures;
extern crate rustc_driver;
extern crate rustc_errors;
extern crate rustc_hir;
extern crate rustc_index;
extern crate rustc_interface;
extern crate rustc_metadata;
extern crate rustc_middle;
extern crate rustc_passes;
extern crate rustc_session;
extern crate rustc_span;

#[path = "../tydump/prefix.rs"]
mod prefix;

use std::collections::HashMap;
use std::io::Write as _;
use std::process::ExitCode;
use std::sync::{Mutex, OnceLock};

use rustc_data_structures::steal::Steal;
use rustc_driver::{Callbacks, Compilation};
use rustc_hir::def_id::LocalDefId;
use rustc_index::IndexVec;
use rustc_interface::interface;
use rustc_middle::mir::pretty::MirWriter;
use rustc_middle::mir::{Body, Const, Promoted};
use rustc_middle::ty::print::with_forced_impl_filename_line;
use rustc_middle::ty::TyCtxt;
use rustc_middle::util::Providers;
use rustc_session::EarlyDiagCtxt;
use rustc_session::Session;
use rustc_session::config::ErrorOutputType;

type MirBuiltFn = for<'tcx> fn(TyCtxt<'tcx>, LocalDefId) -> &'tcx Steal<Body<'tcx>>;
type MirPromotedFn = for<'tcx> fn(
    TyCtxt<'tcx>,
    LocalDefId,
) -> (&'tcx Steal<Body<'tcx>>, &'tcx Steal<IndexVec<Promoted, Body<'tcx>>>);

/// rustc_mir_transform's providers, saved by `override_queries`.
static MIR_BUILT: OnceLock<MirBuiltFn> = OnceLock::new();
static MIR_PROMOTED: OnceLock<MirPromotedFn> = OnceLock::new();

/// The recorded copies: leaked `Box<Body<'tcx>>` / `Box<IndexVec<Promoted, Body<'tcx>>>` as
/// addresses (the `'tcx` values outlive the dump, which runs inside the same `TyCtxt`).
#[derive(Default)]
struct Recorded {
    built: HashMap<LocalDefId, usize>,
    promoted: HashMap<LocalDefId, (usize, usize)>,
}
static RECORDED: Mutex<Option<Recorded>> = Mutex::new(None);

fn record(f: impl FnOnce(&mut Recorded)) {
    f(RECORDED.lock().unwrap().get_or_insert_with(Default::default));
}

fn leak<T>(v: T) -> usize {
    Box::into_raw(Box::new(v)) as usize
}

/// The recorded copy of `mir_built(def)`, if its provider ran.
fn recorded_built<'tcx>(def: LocalDefId) -> Option<&'tcx Body<'tcx>> {
    let r = RECORDED.lock().unwrap();
    let a = *r.as_ref()?.built.get(&def)?;
    // SAFETY: recorded by `mir_built_recording` as a leaked `Body<'tcx>` of this compilation's `TyCtxt`.
    Some(unsafe { &*(a as *const Body<'tcx>) })
}

/// The recorded copy of `mir_promoted(def)`, if its provider ran.
fn recorded_promoted<'tcx>(def: LocalDefId) -> Option<(&'tcx Body<'tcx>, &'tcx IndexVec<Promoted, Body<'tcx>>)> {
    let r = RECORDED.lock().unwrap();
    let (a, b) = *r.as_ref()?.promoted.get(&def)?;
    // SAFETY: recorded by `mir_promoted_recording`, as above.
    Some(unsafe { (&*(a as *const Body<'tcx>), &*(b as *const IndexVec<Promoted, Body<'tcx>>)) })
}

/// rustc_mir_transform's `mir_built`, recording a copy of its value.
fn mir_built_recording<'tcx>(tcx: TyCtxt<'tcx>, def: LocalDefId) -> &'tcx Steal<Body<'tcx>> {
    let r = (MIR_BUILT.get().unwrap())(tcx, def);
    let copy = leak(r.borrow().clone());
    record(|rec| {
        rec.built.insert(def, copy);
    });
    r
}

/// rustc_mir_transform's `mir_promoted`, recording a copy of its value.
fn mir_promoted_recording<'tcx>(
    tcx: TyCtxt<'tcx>,
    def: LocalDefId,
) -> (&'tcx Steal<Body<'tcx>>, &'tcx Steal<IndexVec<Promoted, Body<'tcx>>>) {
    let r = (MIR_PROMOTED.get().unwrap())(tcx, def);
    let body = leak(r.0.borrow().clone());
    let promoted = leak(r.1.borrow().clone());
    record(|rec| {
        rec.promoted.insert(def, (body, promoted));
    });
    r
}

fn override_queries(_sess: &Session, providers: &mut Providers) {
    let _ = MIR_BUILT.set(providers.queries.mir_built);
    let _ = MIR_PROMOTED.set(providers.queries.mir_promoted);
    providers.queries.mir_built = mir_built_recording;
    providers.queries.mir_promoted = mir_promoted_recording;
}

struct MirDump;

impl Callbacks for MirDump {
    #[allow(rustc::bad_opt_access)]
    fn config(&mut self, config: &mut interface::Config) {
        // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
        config.opts.trimmed_def_paths = true;
        // `-Zunpretty=mir`'s effect on `record_trimmed_def_paths` (see the header).
        config.opts.unstable_opts.unpretty = Some("mir".to_string());
        config.override_queries = Some(override_queries);
    }

    fn after_expansion<'tcx>(&mut self, _compiler: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        let _ = prefix::run_required_analyses_prefix(tcx);
        mir_borrow_checking(tcx);
        let mut out = Vec::new();
        dump(tcx, &mut out).unwrap();
        let mut stdout = std::io::stdout().lock();
        stdout.write_all(&out).unwrap();
        stdout.flush().unwrap();
        Compilation::Stop
    }
}

/// The `MIR_borrow_checking` loop of rustc_interface/src/passes.rs:1163 `run_required_analyses`, with
/// `mir_borrowck`, `check_transmutes`, `mir_drops_elaborated_and_const_checked` and the coroutine
/// `layout_of` left out (plan-m4 D2); everything else verbatim.
fn mir_borrow_checking(tcx: TyCtxt<'_>) {
    let sess = tcx.sess;
    sess.time("MIR_borrow_checking", || {
        tcx.par_hir_body_owners(|def_id| {
            let not_typeck_child = !tcx.is_typeck_child(def_id.to_def_id());
            if not_typeck_child {
                // Child unsafety and borrowck happens together with the parent
                tcx.ensure_ok().check_unsafety(def_id);
            }
            if tcx.is_trivial_const(def_id) {
                return;
            }
            if not_typeck_child {
                // (D2: `tcx.ensure_ok().mir_borrowck(def_id)` and
                // `tcx.ensure_ok().check_transmutes(def_id)` are left out.)
                if !tcx.sess.opts.unstable_opts.offload.is_empty() {
                    tcx.ensure_ok().check_offloads(def_id);
                }
            }
            tcx.ensure_ok().has_ffi_unwind_calls(def_id);
            tcx.ensure_ok().check_liveness(def_id);

            // (D2: the `mir_drops_elaborated_and_const_checked` arm (`should_codegen()` or a const
            // context) and the coroutine `layout_of` cycle check are left out.)
        });
    });
}

/// The dump (step 3 of the header).
fn dump<'tcx>(tcx: TyCtxt<'tcx>, w: &mut dyn std::io::Write) -> std::io::Result<()> {
    let writer = MirWriter::new(tcx);
    let mut first = true;
    for &def_id in tcx.mir_keys(()) {
        if first {
            first = false;
        } else {
            // Put empty lines between all items
            writeln!(w)?;
        }

        // As `write_mir_pretty` (rustc_middle/src/mir/pretty.rs:318) prints a trivial const.
        if let Some((val, ty)) = tcx.trivial_const(def_id) {
            with_forced_impl_filename_line! {
                // see notes on #41697 elsewhere
                write!(w, "const {}", tcx.def_path_str(def_id))?
            }
            writeln!(w, ": {} = const {};", ty, Const::Val(val, ty))?;
            continue;
        }

        if tcx.is_constructor(def_id.to_def_id()) {
            writeln!(w, "// mir_for_ctfe")?;
            writer.write_mir_fn(tcx.mir_for_ctfe(def_id), w)?;
            continue;
        }

        writeln!(w, "// mir_built")?;
        let steal = tcx.mir_built(def_id);
        match recorded_built(def_id) {
            Some(body) => writer.write_mir_fn(body, w)?,
            // Fed, not provided (coroutine-closure by-move bodies): nothing has stolen it.
            None => writer.write_mir_fn(&steal.borrow(), w)?,
        }

        writeln!(w)?;
        writeln!(w, "// mir_promoted")?;
        let _ = tcx.mir_promoted(def_id);
        let (body, promoted) = recorded_promoted(def_id).expect("mir_promoted is provided, never fed");
        writer.write_mir_fn(body, w)?;
        for body in promoted {
            writeln!(w)?;
            writer.write_mir_fn(body, w)?;
        }
    }
    Ok(())
}

fn main() -> ExitCode {
    let early_dcx = EarlyDiagCtxt::new(ErrorOutputType::default());
    // As rustc_driver_impl::main: tracing's default filter (`RUSTC_LOG` unset) prints WARN and ERROR events.
    rustc_driver::init_rustc_env_logger(&early_dcx);
    rustc_driver::install_ice_hook(rustc_driver::DEFAULT_BUG_REPORT_URL, |_| ());
    let mut callbacks = MirDump;
    rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&rustc_driver::args::raw_args(&early_dcx), &mut callbacks))
}
