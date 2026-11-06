// Port of src/tools/miri/src/bin/log/setup.rs (crate `miri`, plan-m6 D2, D10).
// Fill lane: `miri-driver` (plan-m6 wave 36); ported by lane miri-log (D10), which owns it this wave.
// PORT: Miri is built without its `tracing` cargo feature (the release oracle, D2: tracing_chrome.rs is excluded), so
// the `#[cfg(feature = "tracing")]` parts are left out: `TracingGuard` has only `_no_construct`, and `MIRI_TRACING`
// takes the `#[cfg(not(feature = "tracing"))]` branch (a fatal error).
import * as rustc_driver from "../../../rustc_driver_impl/lib.ts";
import { LoggerConfig } from "../../../rustc_log/lib.ts";
import { type TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { type CtfeBacktrace, type EarlyDiagCtxt } from "../../../rustc_session/session.ts";
import { Level_from_str } from "../../../rust_ts/tracing.ts";
import { var_ as env_var } from "../../../std/env.ts";
import { Ok } from "../../../std/result.ts";
// PORT: `crate::fatal_error!` is the binary crate's macro (bin/miri.rs). This import is a cycle (miri.ts imports this
// module); `fatal_error` is only read when `MIRI_TRACING` is set, long after both modules are evaluated.
import { fatal_error } from "../miri.ts";

/// The tracing layer from `tracing-chrome` starts a thread in the background that saves data to
/// file and closes the file when stopped. If the thread is not stopped properly, the file will be
/// missing end terminators (`]` for JSON arrays) and other data may also not be flushed. Therefore
/// we need to keep a guard that, when [Drop]ped, will send a signal to stop the thread. Make sure
/// to manually drop this guard using [deinit_loggers], if you are exiting the program with
/// [std::process::exit]!
// #[must_use]
interface TracingGuard {
  // #[cfg(feature = "tracing")]
  // _chrome: super::tracing_chrome::FlushGuard,
  readonly _no_construct: null;
}

// This ensures TracingGuard is always a drop-type, even when the `_chrome` field is disabled.
// impl Drop for TracingGuard
// rustc: src/tools/miri/src/bin/log/setup.rs:24 drop
function TracingGuard_drop(_self: TracingGuard): void {}

// rustc: src/tools/miri/src/bin/log/setup.rs:27 rustc_logger_config
function rustc_logger_config(): LoggerConfig {
  // Start with the usual env vars.
  const cfg = LoggerConfig.from_env("RUSTC_LOG");

  // Overwrite if MIRI_LOG is set.
  const v = env_var("MIRI_LOG");
  if (v.$ === "Ok") {
    const var_ = v._0;
    // MIRI_LOG serves as default for RUSTC_LOG, if that is not set.
    if (cfg.filter.$ === "Err" && cfg.filter._0.$ === "NotPresent") {
      // We try to be a bit clever here: if `MIRI_LOG` is just a single level
      // used for everything, we only apply it to the parts of rustc that are
      // CTFE-related. Otherwise, we use it verbatim for `RUSTC_LOG`.
      // This way, if you set `MIRI_LOG=trace`, you get only the right parts of
      // rustc traced, but you can also do `MIRI_LOG=miri=trace,rustc_const_eval::interpret=debug`.
      if (Level_from_str(var_).$ === "Ok") {
        cfg.filter = Ok(`rustc_middle::mir::interpret=${var_},rustc_const_eval::interpret=${var_},miri=${var_}`);
      } else {
        cfg.filter = Ok(var_);
      }
    }
  }

  return cfg;
}

/// The global logger can only be set once per process, so track whether that already happened and
/// keep a [TracingGuard] so it can be [Drop]ped later using [deinit_loggers].
/** `static LOGGER_INITED: OnceLock<Mutex<Option<TracingGuard>>>`: `undefined` until initialized. */
let LOGGER_INITED: { value: TracingGuard | undefined } | undefined;

// rustc: src/tools/miri/src/bin/log/setup.rs:57 init_logger_once
function init_logger_once(early_dcx: EarlyDiagCtxt): void {
  // If the logger is not yet initialized, initialize it.
  if (LOGGER_INITED === undefined) {
    let guard: TracingGuard | undefined;
    if (process.env["MIRI_TRACING"] !== undefined) {
      // #[cfg(not(feature = "tracing"))]
      fatal_error('Cannot enable MIRI_TRACING since Miri was not built with the "tracing" feature');
    } else {
      // initialize the logger without any tracing enabled
      rustc_driver.init_logger(early_dcx, rustc_logger_config());
      guard = undefined;
    }
    LOGGER_INITED = { value: guard };
  }
}

// rustc: src/tools/miri/src/bin/log/setup.rs:94 init_early_loggers
export function init_early_loggers(early_dcx: EarlyDiagCtxt): void {
  // We only initialize `rustc` if the env var is set (so the user asked for it).
  // If it is not set, we avoid initializing now so that we can initialize later with our custom
  // settings, and *not* log anything for what happens before `miri` starts interpreting.
  if (process.env["RUSTC_LOG"] !== undefined) {
    init_logger_once(early_dcx);
  }
}

// rustc: src/tools/miri/src/bin/log/setup.rs:103 init_late_loggers
export function init_late_loggers(early_dcx: EarlyDiagCtxt, tcx: TyCtxt): void {
  // If the logger is not yet initialized, initialize it.
  init_logger_once(early_dcx);

  // If `MIRI_BACKTRACE` is set and `RUSTC_CTFE_BACKTRACE` is not, set `RUSTC_CTFE_BACKTRACE`.
  // Do this late, so we ideally only apply this to Miri's errors.
  const val = process.env["MIRI_BACKTRACE"];
  if (val !== undefined) {
    // PORT: `val.to_string_lossy()`: `process.env` values are already strings.
    let ctfe_backtrace: CtfeBacktrace;
    switch (val) {
      case "immediate":
        ctfe_backtrace = "Immediate";
        break;
      case "0":
        ctfe_backtrace = "Disabled";
        break;
      default:
        ctfe_backtrace = "Capture";
        break;
    }
    tcx.sess.ctfe_backtrace = ctfe_backtrace;
  }
}

/// Must be called before the program terminates to ensure the trace file is closed correctly. Not
/// doing so will result in invalid trace files. Also see [TracingGuard].
// rustc: src/tools/miri/src/bin/log/setup.rs:121 deinit_loggers
export function deinit_loggers(): void {
  const guard = LOGGER_INITED;
  if (guard !== undefined) {
    // `std::mem::drop(guard.take())`
    const g = guard.value;
    guard.value = undefined;
    if (g !== undefined) TracingGuard_drop(g);
  }
}
