// Port of src/tools/miri/src/bin/log/setup.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-driver` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type LoggerConfig } from "../../../rustc_log/lib.ts";
import { type TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { type EarlyDiagCtxt } from "../../../rustc_session/session.ts";
import { unported } from "../../../std/panic.ts";

// bin/log/setup.rs:94 (pub)
export function init_early_loggers(early_dcx: EarlyDiagCtxt): void {
  return unported("miri(bin)::log::setup::init_early_loggers (src/tools/miri/src/bin/log/setup.rs:94; lane miri-driver)");
}
// bin/log/setup.rs:103 (pub)
export function init_late_loggers(early_dcx: EarlyDiagCtxt, tcx: TyCtxt): void {
  return unported("miri(bin)::log::setup::init_late_loggers (src/tools/miri/src/bin/log/setup.rs:103; lane miri-driver)");
}
// bin/log/setup.rs:121 (pub)
export function deinit_loggers(): void {
  return unported("miri(bin)::log::setup::deinit_loggers (src/tools/miri/src/bin/log/setup.rs:121; lane miri-driver)");
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl Drop for TracingGuard (bin/log/setup.rs:23): drop (:24)
// fn rustc_logger_config (bin/log/setup.rs:27)
// fn init_logger_once (bin/log/setup.rs:57)
