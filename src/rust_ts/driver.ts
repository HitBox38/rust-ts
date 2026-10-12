// Placeholder for the rustc_driver_impl port. Until the parser lands, every
// invocation is unported; the harness records this as UNPORTED, not as a failure.
import type { DiagCtxt } from "../rustc_errors/lib.ts";
import { unported, while_unwinding } from "../std/panic.ts";

export function run_compiler(args: string[]): number {
  const unpretty = args.find((a) => a.startsWith("-Zunpretty="));
  unported(unpretty ? `rustc_driver ${unpretty}` : "rustc_driver");
}

/**
 * Drop hook for the session's `DiagCtxt` (`impl Drop for DiagCtxtInner` plus the `Diag` drop
 * bombs; review w23b errors-core F1/F7). JS has no destructors, so the driver must call this
 * exactly where upstream drops the `Compiler` (and with it `Session` → `DiagCtxt`):
 * `rustc_interface::interface::run_compiler` (interface.rs:507-535 at the pin), after
 * `catch_unwind(f)`, `finish_diagnostics()`, `abort_if_errors()` (Ok path only) and
 * `flush_delayed()`:
 * - `f` returned normally: `drop(compiler)` → `drop_compiler_dcx(dcx, false)`.
 * - `f` panicked (a `Panic`/`FatalError` was thrown): `resume_unwind(err)` drops the compiler
 *   while unwinding → `drop_compiler_dcx(dcx, true)`, then rethrow. `std::thread::panicking()`
 *   is true during that drop, which skips the `must_produce_diag` check and the `Diag` bombs.
 * The driver port (rustc_driver_impl / rustc_interface lane) owns the call; until it lands the
 * driver is unported and nothing calls this.
 */
export function drop_compiler_dcx(dcx: DiagCtxt, unwinding: boolean): void {
  if (unwinding) {
    while_unwinding(() => dcx.inner.drop());
  } else {
    dcx.inner.drop();
  }
}
