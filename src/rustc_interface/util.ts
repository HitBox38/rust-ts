// Partial port of compiler/rustc_interface/src/util.rs: the session/thread setup and codegen backend
// selection used by `interface::run_compiler`, and `rustc_version_str`.
import "../rustc_session/options.ts"; // LOAD ORDER: see rustc_session/config.ts
import { DEFAULT_STACK_SIZE, type Jobs, type Sysroot } from "../rustc_session/config.ts";
import type { EarlyDiagCtxt } from "../rustc_session/session.ts";
import type { Target } from "../rustc_session/stand_ins.ts";
import type { Edition } from "../rustc_span/edition.ts";
import { create_session_globals_then } from "../rustc_span/lib.ts";
import type { SourceMapInputs } from "../rustc_span/source_map.ts";
import { unported } from "../std/panic.ts";
import { type CodegenBackend, CurrentGcx, LlvmCodegenBackend } from "./stand_ins.ts";

export { DEFAULT_STACK_SIZE };

// `add_configuration` (util.rs:47), `check_abi_required_features` (util.rs:95): not ported (no markers):
// both read the codegen backend's `TargetConfig` and the target spec (rustc_codegen_ssa, rustc_target).
// `interface::run_compiler` defers what they compute.

/** `pub static STACK_SIZE: OnceLock<usize>` */
export const STACK_SIZE: { value: number | undefined } = { value: undefined };

// rustc: compiler/rustc_interface/src/util.rs:147 init_stack_size
function init_stack_size(early_dcx: EarlyDiagCtxt): number {
  // Obey the environment setting or default
  if (STACK_SIZE.value === undefined) {
    let v: number;
    const os_str = process.env.RUST_MIN_STACK;
    // if someone finds out `export RUST_MIN_STACK=640000` isn't enough stack
    // they might try to "unset" it by running `RUST_MIN_STACK=  rustc code.rs`
    // this is wrong, but std would nonetheless "do what they mean", so let's do likewise
    if (os_str !== undefined && os_str.trim().length !== 0) {
      // rustc is a batch program, so error early on inputs which are unlikely to be intended
      // so no one thinks we parsed them setting `RUST_MIN_STACK="64 megabytes"`
      // FIXME: we could accept `RUST_MIN_STACK=64MB`, perhaps?
      const s = os_str.trim();
      // PORT: `s.parse::<usize>()`: ASCII digits with an optional leading `+`, no overflow past usize.
      if (/^\+?[0-9]+$/.test(s) && BigInt(s.replace(/^\+/, "")) <= 0xffff_ffff_ffff_ffffn) {
        v = Number(s.replace(/^\+/, ""));
      } else {
        const err = early_dcx.early_struct_fatal(`\`RUST_MIN_STACK\` should be a number of bytes, but was "${s}"`);
        err.note("you can also unset `RUST_MIN_STACK` to use the default stack size");
        return err.emit_fatal();
      }
    } else {
      // otherwise pick a consistent default
      v = DEFAULT_STACK_SIZE;
    }
    STACK_SIZE.value = v;
  }
  return STACK_SIZE.value;
}

// rustc: compiler/rustc_interface/src/util.rs:175 run_in_thread_with_globals
function run_in_thread_with_globals<R>(
  _thread_stack_size: number,
  edition: Edition,
  sm_inputs: SourceMapInputs,
  extra_symbols: readonly string[],
  f: (current_gcx: CurrentGcx) => R,
): R {
  // The "thread pool" is a single spawned thread in the non-parallel
  // compiler. We run on a spawned thread instead of the main thread (a) to
  // provide control over the stack size, and (b) to increase similarity with
  // the parallel compiler, in particular to ensure there is no accidental
  // sharing of data between the main thread and the compilation thread
  // (which might cause problems for the parallel compiler).
  // PORT: no thread: `f` runs on the JS main thread (the stack size is the host's); a panic on the
  // "thread" propagates as the thrown value, like `resume_unwind(e)` after `join`.

  // We build the session globals and run `f` on the spawned thread, because
  // `SessionGlobals` does not impl `Send` in the non-parallel compiler.
  return create_session_globals_then(edition, extra_symbols, sm_inputs, () => f(CurrentGcx.new()));
}

// rustc: compiler/rustc_interface/src/util.rs:214 run_in_thread_pool_with_globals
export function run_in_thread_pool_with_globals<R>(
  thread_builder_diag: EarlyDiagCtxt,
  edition: Edition,
  jobs: Jobs,
  extra_symbols: readonly string[],
  sm_inputs: SourceMapInputs,
  f: (current_gcx: CurrentGcx) => R,
): R {
  const thread_stack_size = init_stack_size(thread_builder_diag);

  const jobs_frontend = jobs.frontend ?? 1;
  // `let registry = sync::Registry::new(jobs_frontend);`

  // `let Some(proof) = sync::check_dyn_thread_safe() else { .. }`: dyn-thread-safe mode is on only with a
  // parallel frontend (`set_dyn_thread_safe_mode(jobs.frontend.is_some())` in run_compiler).
  if (jobs.frontend === undefined) {
    // assert_eq!(jobs_frontend.get(), 1);
    return run_in_thread_with_globals(thread_stack_size, edition, sm_inputs, extra_symbols, (current_gcx) => {
      // Register the thread for use with the `WorkerLocal` type.
      // `registry.register();`

      return f(current_gcx);
    });
  }

  return unported(`rustc_thread_pool (parallel frontend, ${jobs_frontend} threads)`);
}

/// Get the codegen backend based on the name and specified sysroot.
///
/// A name of `None` indicates that the default backend should be used.
// rustc: compiler/rustc_interface/src/util.rs:369 get_codegen_backend
export function get_codegen_backend(
  early_dcx: EarlyDiagCtxt,
  sysroot: Sysroot,
  backend_name: string | undefined,
  target: Target,
): CodegenBackend {
  // static LOAD: OnceLock<unsafe fn() -> Box<dyn CodegenBackend>> = OnceLock::new();
  if (LOAD === undefined) {
    const backend = backend_name ?? target.default_codegen_backend ?? CFG_DEFAULT_CODEGEN_BACKEND ?? "dummy";

    if (backend.includes(".")) {
      void early_dcx;
      LOAD = () => unported(`rustc_interface::util::load_backend_from_dylib (${backend})`);
    } else if (backend === "dummy") {
      LOAD = () => unported("rustc_interface::util::DummyCodegenBackend");
    } else if (backend === "llvm") {
      LOAD = LlvmCodegenBackend.new;
    } else {
      LOAD = () => unported(`rustc_interface::util::get_codegen_sysroot (${backend}; sysroot ${sysroot.path()})`);
    }
  }

  // SAFETY: In case of a builtin codegen backend this is safe. In case of an external codegen
  // backend we hope that the backend links against the same rustc_driver version. If this is not
  // the case, we get UB.
  return LOAD();
}
let LOAD: (() => CodegenBackend) | undefined;

/** PORT: `option_env!("CFG_DEFAULT_CODEGEN_BACKEND")` of the oracle build (official nightlies: `llvm`). */
const CFG_DEFAULT_CODEGEN_BACKEND: string | undefined = "llvm";

/// Returns a version string such as "1.46.0 (04488afe3 2020-08-24)" when invoked by an in-tree tool.
// `pub macro version_str() { option_env!("CFG_VERSION") }`
export function version_str(): string | undefined {
  return CFG_VERSION;
}

/**
 * PORT: `option_env!("CFG_VERSION")` of the oracle build: `{release} ({short commit hash} {commit date})`
 * from UPSTREAM.json (`rust.release`, `rust.commit`[..9], `rust.commitDate`); checked against
 * `rustc -V` in src/rustc_driver_impl/driver.oracle.test.ts.
 */
export const CFG_VERSION: string = "1.101.0-nightly (6f5da406b 2026-10-10)";

/// Returns the version string for `rustc` itself (which may be different from a tool version).
// rustc: compiler/rustc_interface/src/util.rs:722 rustc_version_str
export function rustc_version_str(): string | undefined {
  return version_str();
}
