// rust-ts driver glue (not an upstream mirror): `run_compiler(args)` runs the rustc_driver_impl port
// (`rustc_driver::main`, the `rustc` binary's `main`) on `args` (without the program name), and the
// `DiagCtxt` drop hook the ported `rustc_interface::interface::run_compiler` calls.
import type { DiagCtxt } from "../rustc_errors/lib.ts";
import { while_unwinding } from "../std/panic.ts";
import { main } from "../rustc_driver_impl/lib.ts";
import { set_args_os } from "../std/env.ts";

/** `rustc <args>`: returns the process exit code. */
export function run_compiler(args: string[]): number {
  const enc = new TextEncoder();
  set_args_os(["rustc", ...args].map((a) => enc.encode(a)));
  return main();
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
 * Called by src/rustc_interface/interface.ts `run_compiler`.
 */
export function drop_compiler_dcx(dcx: DiagCtxt, unwinding: boolean): void {
  if (unwinding) {
    while_unwinding(() => dcx.inner.drop());
  } else {
    dcx.inner.drop();
  }
}
