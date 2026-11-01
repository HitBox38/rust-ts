// Port of src/tools/miri/src/bin/miri.rs (crate `miri`, plan-m6 D2): the `miri` driver binary.
// Fill lane: `miri-driver` (plan-m6 wave 36): ported (`MiriDepCompilerCalls` is plan-m6 D4: `unported`).
// Run as `bun src/miri/bin/miri.ts <rustc args>` (the oracle's `miri <rustc args>`); the entry glue is at the end.
//
// PORT (lane miri-driver):
// - The bin crate (decision C1) is not in the codegen set: `MiriCompilerCalls`, `MiriCodegenBackend`, `ManySeedsConfig`
//   are hand-written here. It uses the library as `miri::` = `../lib.ts` (which loads every module and installs the
//   placeholders).
// - `fn exit(code) -> !` (`std::process::exit`) throws `MiriExit`; the entry glue at the end turns it into the process exit
//   status. It is not an unwind (not a `Panic` / `FatalErrorMarker`), so `catch_unwind`-like code in the compiler
//   (`run_compiler`, `catch_fatal_errors`) lets it through without running `finish_diagnostics`, as `process::exit` does.
//   stdout/stderr are written synchronously, so nothing is lost (Rust's `exit` flushes stdout in `rt::cleanup`).
// - Decision C6 (built without `native-lib`): the `#[cfg(all(feature = "native-lib", unix))]` items are not compiled
//   (`register_retcode_sv` in `exit`: a no-op without a supervisor; `init_sv`: stops `unported`). The oracle's
//   `-Zmiri-native-lib=` argument parsing is not cfg-gated and is ported (host file system, D14).
// - Decision C4 amendment: `-Zmiri-track-pointer-tag` values are parsed as `bigint` (`u64`) and never rounded; the
//   nonzero check is on the bigint. A tag above `Number.MAX_SAFE_INTEGER` names a tag no run can reach (tags are handed
//   out sequentially from 1), so it is not inserted into the tracked set (no `BorTag` can equal it): the observable
//   behaviour (the set is only ever queried for membership) is unchanged. `-Zmiri-track-alloc-id` likewise (allocation
//   ids are sequential too; `AllocId` is a branded number).
// - `str::parse` of the flag values: `u32` / `u64` through rustc_session's `u32_from_str` / `u64_from_str` (core's
//   radix-10 rules), `NonZero<u64>` adds the `Zero` error; `f64` through `f64_from_str` below (core's dec2flt grammar).
//   The `ParseIntError` texts are core's `IntErrorKind` descriptions.
import "../lib.ts";
import {
  type BacktraceStyle,
  BorTag,
  type BorrowTrackerMethod,
  GenmcConfig,
  type GenmcCtx,
  MIRI_DEFAULT_ARGS,
  type MiriConfig,
  ProvenanceMode,
  ValidationMode,
  entry_fn,
  eval_entry,
  run_genmc_mode,
} from "../lib.ts";
import { clone_MiriConfig } from "../eval.ts";
import { EXTRA_SYMBOLS } from "../sym.ts";
import { deinit_loggers, init_early_loggers, init_late_loggers } from "./log/setup.ts";
import { TARGET_CONFIGS } from "../../rust_ts/target_config.gen.ts";
import { ensure_stack } from "../../rust_ts/stack.ts";
import type { CompiledModules, CrateInfo } from "../../rustc_codegen_ssa/lib.ts";
import {
  type Callbacks,
  type Compilation,
  DEFAULT_BUG_REPORT_URL,
  EXIT_FAILURE,
  EXIT_SUCCESS,
  catch_with_exit_code,
  compiler_entrypoint,
  init_rustc_env_logger,
  install_ice_hook,
  main as rustc_driver_main,
} from "../../rustc_driver_impl/lib.ts";
import { raw_args } from "../../rustc_driver_impl/args.ts";
import { catch_fatal_errors } from "../../rustc_errors/lib.ts";
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import {
  type CodegenBackend,
  CodegenBackend_provided,
  type IncrCompSession,
  type TargetConfig,
  type WorkProductMap,
} from "../../rustc_interface/stand_ins.ts";
import { DummyCodegenBackend, get_codegen_backend } from "../../rustc_interface/util.ts";
import type { EncodedMetadata } from "../../rustc_metadata/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { AllocId } from "../../rustc_middle/mir/interpret/mod.ts";
import { ErrorOutputType, Input, type OutputFilenames, host_tuple } from "../../rustc_session/config.ts";
import { type IntErrorKind, u32_from_str, u64_from_str } from "../../rustc_session/options.ts";
import { type CodegenBackendInit, EarlyDiagCtxt, type EarlySession, type Session } from "../../rustc_session/session.ts";
import type { MetadataLoaderDyn } from "../../rustc_metadata/creader.ts";
import type { CrateType } from "../../rustc_structures/crate_type.ts";
import { FileName } from "../../rustc_span/lib.ts";
import { FatalErrorMarker } from "../../rustc_span/fatal_error.ts";
import { Panic, Unported, assert, panic, unported } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

/** `std::process::exit(code)` in flight (PORT: header). */
export class MiriExit extends Error {
  constructor(readonly code: number) {
    super(`miri: process::exit(${code})`);
  }
}

class MiriCompilerCalls implements Callbacks {
  constructor(
    public miri_config: MiriConfig | undefined,
    public many_seeds: ManySeedsConfig | undefined,
  ) {}

  // rustc: src/tools/miri/src/bin/miri.rs:72 new
  static new(miri_config: MiriConfig, many_seeds: ManySeedsConfig | undefined): MiriCompilerCalls {
    return new MiriCompilerCalls(miri_config, many_seeds);
  }

  // impl rustc_driver::Callbacks for MiriCompilerCalls
  // rustc: src/tools/miri/src/bin/miri.rs:129 config
  config(config: Config): void {
    // We never reach codegen anyway.
    // PORT(contract): pending rustc_interface: `Config.make_codegen_backend` is typed `undefined` and `run_compiler`
    // does not port its `Some` arm (interface.ts:362); until it does, the field is set here and ignored there, and the
    // default backend (the LLVM stand-in, whose `codegen_crate` stops `unported`) is used instead.
    (config as unknown as { make_codegen_backend: ((sess: EarlySession) => CodegenBackend) | undefined }).make_codegen_backend = (sess) =>
      make_miri_codegen_backend(sess, /* dep */ false);

    // Register our custom extra symbols.
    config.extra_symbols = [...EXTRA_SYMBOLS];
  }

  // rustc: src/tools/miri/src/bin/miri.rs:138 after_analysis
  after_analysis(_: Compiler, tcx: TyCtxt): Compilation {
    // Compilation is done, interpretation is starting. Deal with diagnostics from the
    // compilation part. We cannot call `sess.finish_diagnostics()` as then "aborting due to
    // previous errors" gets printed twice.
    tcx.dcx().emit_stashed_diagnostics();
    tcx.dcx().abort_if_errors();
    tcx.dcx().flush_delayed();

    // Miri is taking over. Start logging.
    init_late_loggers(EarlyDiagCtxt.new(tcx.sess.opts.error_format), tcx);

    // Find the entry point.
    if (!tcx.crate_types().includes("Executable")) {
      tcx.dcx().fatal("miri only makes sense on bin crates");
    }
    const [entry_def_id, entry_type] = entry_fn(tcx);

    // Obtain and complete the Miri configuration.
    const config = this.miri_config;
    this.miri_config = undefined;
    if (config === undefined) return panic("after_analysis must only be called once");
    // Add filename to `miri` arguments.
    const file_name = Input.file_name(tcx.sess.io.input, tcx.sess);
    config.args.splice(0, 0, FileName.prefer_local_unconditionally(file_name).to_string());
    // And configure the executable.
    // PORT (D14): `Path::canonicalize` is `realpathSync` (host file system).
    const local = FileName.into_local_path(file_name);
    config.current_exe = local === undefined ? undefined : canonicalize(local);

    // Adjust working directory for interpretation.
    const cwd = process.env.MIRI_CWD;
    if (cwd !== undefined) {
      // `env::set_current_dir(cwd).unwrap()`
      try {
        process.chdir(cwd);
      } catch (e) {
        return panic(`called \`Result::unwrap()\` on an \`Err\` value: ${String(e)}`);
      }
    }

    // Emit warnings for some unusual configurations.
    if (tcx.sess.opts.optimize !== "No") {
      tcx.dcx().warn(
        "Miri does not support optimizations: the opt-level is ignored. The only effect " +
          "of selecting a Cargo profile that enables optimizations (such as --release) is to apply " +
          "its remaining settings, such as whether debug assertions and overflow checks are enabled.",
      );
    }
    if (tcx.sess.mir_opt_level() > 0) {
      tcx.dcx().warn(
        "You have explicitly enabled MIR optimizations, overriding Miri's default " +
          "which is to completely disable them. Any optimizations may hide UB that Miri would " +
          "otherwise detect, and it is not necessarily possible to predict what kind of UB will " +
          "be missed. If you are enabling optimizations to make Miri run faster, we advise using " +
          "cfg(miri) to shrink your workload instead. The performance benefit of enabling MIR " +
          "optimizations is usually marginal at best.",
      );
    }

    // Invoke the interpreter.
    let res: Result<null, number>;
    if (config.genmc_config !== undefined) {
      assert(this.many_seeds === undefined, "assertion failed: self.many_seeds.is_none()");
      res = as_exit_result(
        run_genmc_mode(tcx, config, (genmc_ctx: GenmcCtx) => eval_entry(tcx, entry_def_id, entry_type, config, genmc_ctx)),
      );
    } else if (this.many_seeds !== undefined) {
      const many_seeds = this.many_seeds;
      this.many_seeds = undefined;
      assert(config.seed === undefined, "assertion failed: config.seed.is_none()");
      res = run_many_seeds(many_seeds, (seed) => {
        const config2 = clone_MiriConfig(config);
        config2.seed = seed;
        eprintln(`Trying seed: ${seed}`);
        return as_exit_result(eval_entry(tcx, entry_def_id, entry_type, config2, /* genmc_ctx */ undefined));
      });
    } else {
      res = as_exit_result(eval_entry(tcx, entry_def_id, entry_type, config, undefined));
    }
    // Process interpreter result.
    if (res.$ === "Err") {
      const return_code = res._0;
      tcx.dcx().abort_if_errors();
      return exit(return_code);
    } else {
      // We want to continue here so rustc can do its usual shutdown and finalize the
      // incremental session. Our custom codegen backend ensures nothing actually happens.
      return "Continue";
    }
  }
}

/** PORT(contract): pending miri-eval: `eval_entry` / `run_genmc_mode` return `Result<(), NonZeroI32>`, declared with
 * `Pending<"NonZeroI32">`; the error is the exit code (a nonzero `i32`, a number). */
function as_exit_result(r: Result<null, unknown>): Result<null, number> {
  return r as Result<null, number>;
}

/** `Path::canonicalize(p).ok()` (PORT: D14, host file system). */
function canonicalize(p: string): string | undefined {
  try {
    return realpathSync(p);
  } catch {
    return undefined;
  }
}

/** `eprintln!` */
function eprintln(s: string): void {
  process.stderr.write(`${s}\n`);
}

class MiriCodegenBackend implements CodegenBackend {
  constructor(
    public native: CodegenBackend,
    public dummy: DummyCodegenBackend,
    /// Whether we are in a dependency or in the to-be-interpreted binary crate
    public dep: boolean,
  ) {}

  // impl CodegenBackend for MiriCodegenBackend
  // rustc: src/tools/miri/src/bin/miri.rs:217 name
  name(): string {
    return "miri";
  }

  init(sess: EarlySession): CodegenBackendInit {
    return CodegenBackend_provided.init(this, sess);
  }

  // rustc: src/tools/miri/src/bin/miri.rs:221 target_config
  target_config(sess: EarlySession): TargetConfig {
    const native_target_config = this.native.target_config(sess);
    return {
      internal_target_features: native_target_config.internal_target_features,

      // The basic types and ABI always work.
      has_reliable_f16b: true,
      has_reliable_f16: true,
      has_reliable_f128: true,
      // We always provide the f16 intrinsics, but some are provided via the host,
      // so forward its reliability.
      has_reliable_f16_math: cfg_target_has_reliable_f16_math(),
      // Many f128 operations are still missing.
      has_reliable_f128_math: false,
    };
  }

  // rustc: src/tools/miri/src/bin/miri.rs:238 target_cpu
  target_cpu(_sess: Session): string {
    return "";
  }

  // Everything complicated is forwarded to the dummy backend.

  // rustc: src/tools/miri/src/bin/miri.rs:244 supported_crate_types
  supported_crate_types(sess: Session): CrateType[] {
    return this.dummy.supported_crate_types(sess);
  }

  print_passes(): void {
    CodegenBackend_provided.print_passes(this);
  }

  print_version(): void {
    CodegenBackend_provided.print_version(this);
  }

  metadata_loader(): MetadataLoaderDyn {
    return CodegenBackend_provided.metadata_loader(this);
  }

  // rustc: src/tools/miri/src/bin/miri.rs:248 codegen_crate
  codegen_crate(tcx: TyCtxt): unknown {
    return this.dummy.codegen_crate(tcx);
  }

  // rustc: src/tools/miri/src/bin/miri.rs:252 join_codegen
  join_codegen(
    ongoing_codegen: unknown,
    sess: Session,
    incr_comp_session: IncrCompSession | undefined,
    outputs: OutputFilenames,
    crate_info: CrateInfo,
  ): [CompiledModules, WorkProductMap] {
    return this.dummy.join_codegen(ongoing_codegen, sess, incr_comp_session, outputs, crate_info);
  }

  print_pass_timings(): void {
    CodegenBackend_provided.print_pass_timings(this);
  }

  print_statistics(): void {
    CodegenBackend_provided.print_statistics(this);
  }

  print_statistics_json(): string {
    return CodegenBackend_provided.print_statistics_json(this);
  }

  // rustc: src/tools/miri/src/bin/miri.rs:263 link
  link(sess: Session, compiled_modules: CompiledModules, crate_info: CrateInfo, metadata: EncodedMetadata, outputs: OutputFilenames): void {
    // In the binary this should do nothing.
    if (this.dep) {
      this.dummy.link(sess, compiled_modules, crate_info, metadata, outputs);
    }
  }
}

/** `cfg!(target_has_reliable_f16_math)` of the Miri binary: the host's value. PORT: the oracle rustc's `target_config` for
 * the host tuple (src/rust_ts/target_config.gen.ts, the table that stands in for LLVM, plan-m2 D4), which is what the
 * compiler that built the oracle `miri` (same LLVM, default CPU) computed for this cfg. */
function cfg_target_has_reliable_f16_math(): boolean {
  const host = host_tuple();
  const t = TARGET_CONFIGS.get(host);
  if (t === undefined) return unported(`miri(bin)::MiriCodegenBackend::target_config (cfg!(target_has_reliable_f16_math) of host ${host}: no oracle table)`);
  return t.has_reliable_f16_math;
}

interface ManySeedsConfig {
  seeds: { start: number; end: number };
  keep_going: boolean;
}

// PORT: `sync::par_for_each_in` runs the seeds in order on the one thread rust-ts has (the parallel order upstream is
// nondeterministic; `-Zmiri-many-seeds` is outside M6's suites, plan-m6 D13). The "maximum" return code and the failure
// count are order-independent, as upstream intends.
// rustc: src/tools/miri/src/bin/miri.rs:77 run_many_seeds
function run_many_seeds(many_seeds: ManySeedsConfig, eval_entry_once: (seed: bigint) => Result<null, number>): Result<null, number> {
  let exit_code = EXIT_SUCCESS >>> 0;
  let num_failed = 0;
  for (let seed = many_seeds.seeds.start; seed < many_seeds.seeds.end; seed++) {
    const r = eval_entry_once(BigInt(seed));
    if (r.$ === "Err") {
      const return_code = r._0;
      eprintln(`FAILING SEED: ${seed}`);
      if (!many_seeds.keep_going) {
        // `abort_if_errors` would unwind but would not actually stop miri, since
        // `par_for_each` waits for the rest of the threads to finish.
        exit(return_code);
      }
      // Preserve the "maximum" return code (when interpreted as `u32`), to make
      // the result order-independent and to make it 0 only if all executions were 0.
      exit_code = Math.max(exit_code, return_code >>> 0);
      num_failed += 1;
    }
  }
  const exit_code_signed = exit_code | 0;
  if (num_failed > 0) {
    eprintln(`${num_failed}/${Math.max(0, many_seeds.seeds.end - many_seeds.seeds.start)} SEEDS FAILED`);
    // `NonZeroI32::new(exit_code).unwrap()`
    if (exit_code_signed === 0) return panic("called `Option::unwrap()` on a `None` value");
    return Err(exit_code_signed);
  } else {
    assert(exit_code_signed === 0, "assertion failed: exit_code == 0");
    return Ok(null);
  }
}

/// Generates the codegen backend for code that Miri will interpret: we basically
/// use the dummy backend, except that we put the LLVM backend in charge of
/// target features.
// rustc: src/tools/miri/src/bin/miri.rs:112 make_miri_codegen_backend
function make_miri_codegen_backend(sess: EarlySession, dep: boolean): CodegenBackend {
  const early_dcx = EarlyDiagCtxt.new(sess.opts.error_format);

  // Use the target_config method of the default codegen backend (eg LLVM) to ensure the
  // calculated target features match said backend by respecting eg -Ctarget-cpu.
  const native_codegen_backend = get_codegen_backend(early_dcx, sess.opts.sysroot, undefined, sess.target);
  void native_codegen_backend.init(sess);

  return new MiriCodegenBackend(native_codegen_backend, new DummyCodegenBackend(), dep);
}

/// This compiler produces rlibs that are meant for later consumption by Miri.
// struct MiriDepCompilerCalls;
// impl rustc_driver::Callbacks for MiriDepCompilerCalls: `config` (bin/miri.rs:283) and `after_analysis` (:324).
// PORT: plan-m6 D4: the port-built Miri sysroot (`MIRI_BE_RUSTC=target`) is a later lane (`miri-sysroot`); the two
// callbacks stop `unported` (no markers yet).
class MiriDepCompilerCalls implements Callbacks {
  config(_config: Config): void {
    return unported("miri(bin)::MiriDepCompilerCalls::config (src/tools/miri/src/bin/miri.rs:283; plan-m6 D4, lane miri-sysroot)");
  }

  after_analysis(_: Compiler, _tcx: TyCtxt): Compilation {
    return unported("miri(bin)::MiriDepCompilerCalls::after_analysis (src/tools/miri/src/bin/miri.rs:324; plan-m6 D4, lane miri-sysroot)");
  }
}

// rustc: src/tools/miri/src/bin/miri.rs:339 exit
function exit(exit_code: number): never {
  // Drop the tracing guard before exiting, so tracing calls are flushed correctly.
  deinit_loggers();
  // Make sure the supervisor knows about the exit code.
  // #[cfg(all(feature = "native-lib", unix))]
  // miri::native_lib::register_retcode_sv(exit_code);  (PORT: decision C6, header)
  // Actually exit.
  throw new MiriExit(exit_code);
}

// rustc: src/tools/miri/src/bin/miri.rs:349 fatal_error_
function fatal_error_(msg: string): never {
  eprintln(`fatal error: ${msg}`);
  return exit(1);
}

// macro_rules! fatal_error { ($($tt:tt)*) => { $crate::fatal_error_(&format_args!($($tt)*)) }; }
const fatal_error: (msg: string) => never = fatal_error_;

/// Execute a compiler with the given CLI arguments and callbacks.
// rustc: src/tools/miri/src/bin/miri.rs:361 run_compiler_and_exit
function run_compiler_and_exit(args: readonly string[], callbacks: Callbacks): never {
  // Install the ctrlc handler that sets `rustc_const_eval::CTRL_C_RECEIVED`, even if
  // MIRI_BE_RUSTC is set. We do this late so that when `native_lib::init_sv` is called,
  // there are no other threads.
  // `rustc_driver::install_ctrlc_handler()`: PORT: not ported in the port's rustc_driver_impl (see its `main`).

  // Invoke compiler, catch any unwinding panics and handle return code.
  const exit_code = catch_with_exit_code(() => compiler_entrypoint(args, callbacks));
  return exit(exit_code === EXIT_SUCCESS ? EXIT_SUCCESS : EXIT_FAILURE);
}

/** `core::num::IntErrorKind` as `ParseIntError`'s `Display` (library/core/src/num/error.rs `description`). */
function display_ParseIntError(kind: IntErrorKind): string {
  switch (kind) {
    case "Empty":
      return "cannot parse integer from empty string";
    case "InvalidDigit":
      return "invalid digit found in string";
    case "PosOverflow":
      return "number too large to fit in target type";
    case "NegOverflow":
      return "number too small to fit in target type";
    case "Zero":
      return "number would be zero for non-zero type";
  }
}

/** `<NonZero<u64> as FromStr>::from_str` (`u64::from_str_radix(src, 10)?`, then `Zero` for 0). */
function nonzero_u64_from_str(s: string): Result<bigint, IntErrorKind> {
  const r = u64_from_str(s);
  if (r.$ === "Err") return r;
  if (r._0 === 0n) return Err("Zero");
  return r;
}

/** `<f64 as FromStr>::from_str` (core dec2flt): an optional sign, then `inf` / `infinity` / `nan` (ASCII
 * case-insensitive) or decimal digits with an optional `.` (at least one digit on either side) and an optional exponent
 * `e`/`E` with an optional sign and at least one digit. No whitespace. The value is correctly rounded (as JS `Number`). */
function f64_from_str(s: string): Result<number, null> {
  const m = /^([+-]?)(?:(inf|infinity|nan)|((?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?))$/i.exec(s);
  if (m === null) return Err(null);
  const neg = m[1] === "-";
  if (m[2] !== undefined) {
    const w = m[2].toLowerCase();
    if (w === "nan") return Ok(NaN);
    return Ok(neg ? -Infinity : Infinity);
  }
  // The digits part only (the regex excludes `inf`/`nan` there, so `Number` cannot accept JS-only syntax).
  const v = Number(m[3]!);
  return Ok(neg ? -v : v);
}

/// Parses a comma separated list of `T` from the given string:
/// `<value1>,<value2>,<value3>,...`
// rustc: src/tools/miri/src/bin/miri.rs:383 parse_comma_list
function parse_comma_list<T, E>(input: string, from_str: (s: string) => Result<T, E>): Result<T[], E> {
  const out: T[] = [];
  for (const part of input.split(",")) {
    const r = from_str(part);
    if (r.$ === "Err") return r;
    out.push(r._0);
  }
  return Ok(out);
}

/// Parses the input as a float in the range from 0.0 to 1.0 (inclusive).
// rustc: src/tools/miri/src/bin/miri.rs:388 parse_rate
function parse_rate(input: string): Result<number, string> {
  const r = f64_from_str(input);
  if (r.$ === "Ok") {
    const rate = r._0;
    if (rate >= 0.0 && rate <= 1.0) return Ok(rate);
    return Err("must be between `0.0` and `1.0`");
  }
  return Err("requires a `f64` between `0.0` and `1.0`");
}

/// Parses a seed range
///
/// This function is used for the `-Zmiri-many-seeds` flag. It expects the range in the form
/// `<from>..<to>`. `<from>` is inclusive, `<to>` is exclusive. `<from>` can be omitted,
/// in which case it is assumed to be `0`.
// rustc: src/tools/miri/src/bin/miri.rs:401 parse_range
function parse_range(val: string): Result<{ start: number; end: number }, string> {
  const i = val.indexOf("..");
  if (i < 0) return Err("expected `from..to`");
  const [from_s, to_s] = [val.slice(0, i), val.slice(i + 2)];
  let from: number;
  if (from_s.length === 0) {
    from = 0;
  } else {
    const r = u32_from_str(from_s);
    if (r.$ === "Err") return Err("invalid `from`");
    from = r._0;
  }
  const t = u32_from_str(to_s);
  if (t.$ === "Err") return Err("invalid `to`");
  const to = t._0;
  return Ok({ start: from, end: to });
}

/** `MiriConfig::default()` (eval.rs:178, lane miri-eval: `impl Default`, not declared in the skeleton). PORT(contract):
 * pending miri-eval; root replaces the body with a call to that lane's default when it lands. Until then it stops
 * `unported`, unless a test installed the upstream default (`PENDING_MIRI_CONFIG_DEFAULT`, miri.test.ts). */
function MiriConfig_default(): MiriConfig {
  const f = PENDING_MIRI_CONFIG_DEFAULT.f;
  if (f !== undefined) return f();
  return unported("miri::eval::MiriConfig::default (src/tools/miri/src/eval.rs:178; lane miri-eval, not declared)");
}
/** Test hook of the pending `MiriConfig::default()` (removed with it). */
export const PENDING_MIRI_CONFIG_DEFAULT: { f: (() => MiriConfig) | undefined } = { f: undefined };

/** `miri::MAX_CPUS` (shims/cpu_affinity.rs, lane miri-shims-b, wave 37; not yet exported by lib.ts). PORT(contract):
 * pending miri-shims-b; root replaces this with the re-export when it lands. */
function MAX_CPUS(): number {
  return unported("miri::shims::cpu_affinity::MAX_CPUS (src/tools/miri/src/shims/cpu_affinity.rs; lane miri-shims-b, not exported)");
}

/** `env::vars_os().collect::<Vec<_>>()` (PORT: D14 host environment, `OsString` → `string` per the typemap; the order is
 * the runtime's `process.env` order, which follows `environ`). */
function vars_os(): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) out.push([k, v]);
  }
  return out;
}

// rustc: src/tools/miri/src/bin/miri.rs:408 main
export function main(): number {
  const early_dcx = EarlyDiagCtxt.new(ErrorOutputType.default());

  // Snapshot a copy of the environment before `rustc` starts messing with it.
  // (`install_ice_hook` might change `RUST_BACKTRACE`.)
  const env_snapshot = vars_os();

  const a = catch_fatal_errors(() => raw_args(early_dcx));
  if (a.$ === "Err") throw new MiriExit(EXIT_FAILURE); // `.unwrap_or_else(|_| std::process::exit(EXIT_FAILURE))`
  const args = a._0;

  // If the environment asks us to actually be rustc, then do that.
  const crate_kind = process.env.MIRI_BE_RUSTC;
  if (crate_kind !== undefined) {
    if (crate_kind === "host") {
      // For host crates like proc macros and build scripts, we are an entirely normal rustc.
      // These eventually produce actual binaries and never run in Miri.
      return rustc_driver_main();
    } else if (crate_kind !== "target") {
      return panic(`invalid \`MIRI_BE_RUSTC\` value: ${JSON.stringify(crate_kind)}`);
    }

    // Earliest rustc setup.
    install_ice_hook(DEFAULT_BUG_REPORT_URL, () => {});
    init_rustc_env_logger(early_dcx);

    const args2 = [...args];
    // Splice in the default arguments after the program name.
    // Some options have different defaults in Miri than in plain rustc; apply those by making
    // them the first arguments after the binary name (but later arguments can overwrite them).
    args2.splice(1, 0, ...MIRI_DEFAULT_ARGS_());

    // We cannot use `rustc_driver::main` as we want it to use `args` as the CLI arguments.
    return run_compiler_and_exit(args2, new MiriDepCompilerCalls());
  }

  // Add an ICE bug report hook.
  install_ice_hook("https://github.com/rust-lang/miri/issues/new", () => {});

  // Init loggers the Miri way.
  init_early_loggers(early_dcx);

  // Parse our arguments and split them across `rustc` and `miri`.
  let many_seeds: { start: number; end: number } | undefined = undefined;
  let many_seeds_keep_going = false;
  const miri_config = MiriConfig_default();
  miri_config.env = env_snapshot;

  const rustc_args: string[] = [];
  let after_dashdash = false;

  // Note that we require values to be given with `=`, not with a space.
  // This matches how rustc parses `-Z`.
  // However, unlike rustc we do not accept a space after `-Z`.
  for (const arg of args) {
    let param: string | undefined;
    if (rustc_args.length === 0) {
      // Very first arg: binary name.
      rustc_args.push(arg);
      // Also add the default arguments.
      rustc_args.push(...MIRI_DEFAULT_ARGS_());
    } else if (after_dashdash) {
      // Everything that comes after `--` is forwarded to the interpreted crate.
      miri_config.args.push(arg);
    } else if (arg === "--") {
      after_dashdash = true;
    } else if (arg === "-Zmiri-disable-validation") {
      miri_config.validation = ValidationMode.No;
    } else if (arg === "-Zmiri-recursive-validation") {
      miri_config.validation = ValidationMode.Deep;
    } else if (arg === "-Zmiri-disable-stacked-borrows") {
      miri_config.borrow_tracker = undefined;
    } else if (arg === "-Zmiri-tree-borrows") {
      miri_config.borrow_tracker = {
        $: "TreeBorrows",
        _0: {
          precise_interior_mut: true,
          implicit_writes: false,
        },
      } satisfies BorrowTrackerMethod;
    } else if (arg === "-Zmiri-tree-borrows-no-precise-interior-mut") {
      const bt = miri_config.borrow_tracker;
      if (bt !== undefined && bt.$ === "TreeBorrows") {
        const params = bt._0;
        params.precise_interior_mut = false;
      } else {
        fatal_error("`-Zmiri-tree-borrows` is required before `-Zmiri-tree-borrows-no-precise-interior-mut`");
      }
    } else if (arg === "-Zmiri-tree-borrows-implicit-writes") {
      const bt = miri_config.borrow_tracker;
      if (bt !== undefined && bt.$ === "TreeBorrows") {
        const params = bt._0;
        params.implicit_writes = true;
      } else {
        fatal_error("`-Zmiri-tree-borrows` is required before `-Zmiri-tree-borrows-implicit-writes`");
      }
    } else if (arg === "-Zmiri-disable-data-race-detector") {
      miri_config.data_race_detector = false;
      miri_config.weak_memory_emulation = false;
    } else if (arg === "-Zmiri-disable-alignment-check") {
      miri_config.check_alignment = "None";
    } else if (arg === "-Zmiri-symbolic-alignment-check") {
      miri_config.check_alignment = "Symbolic";
    } else if (arg === "-Zmiri-disable-isolation") {
      miri_config.isolated_op = { $: "Allow" };
    } else if (arg === "-Zmiri-disable-leak-backtraces") {
      miri_config.collect_leak_backtraces = false;
    } else if (arg === "-Zmiri-disable-weak-memory-emulation") {
      miri_config.weak_memory_emulation = false;
    } else if (arg === "-Zmiri-track-weak-memory-loads") {
      miri_config.track_outdated_loads = true;
    } else if ((param = strip_prefix(arg, "-Zmiri-isolation-error=")) !== undefined) {
      switch (param) {
        case "abort":
          miri_config.isolated_op = { $: "Reject", _0: "Abort" };
          break;
        case "hide":
          miri_config.isolated_op = { $: "Reject", _0: "NoWarning" };
          break;
        case "warn":
          miri_config.isolated_op = { $: "Reject", _0: "Warning" };
          break;
        case "warn-nobacktrace":
          miri_config.isolated_op = { $: "Reject", _0: "WarningWithoutBacktrace" };
          break;
        default:
          fatal_error("-Zmiri-isolation-error must be `abort`, `hide`, `warn`, or `warn-nobacktrace`");
      }
    } else if (arg === "-Zmiri-ignore-leaks") {
      miri_config.ignore_leaks = true;
      miri_config.collect_leak_backtraces = false;
    } else if (arg === "-Zmiri-deterministic-floats") {
      miri_config.float_nondet = false;
    } else if (arg === "-Zmiri-no-extra-rounding-error") {
      miri_config.float_rounding_error = "None";
    } else if (arg === "-Zmiri-max-extra-rounding-error") {
      miri_config.float_rounding_error = "Max";
    } else if (arg === "-Zmiri-no-short-fd-operations") {
      miri_config.short_fd_operations = false;
    } else if (arg === "-Zmiri-strict-provenance") {
      miri_config.provenance_mode = ProvenanceMode.Strict;
    } else if (arg === "-Zmiri-permissive-provenance") {
      miri_config.provenance_mode = ProvenanceMode.Permissive;
    } else if (arg === "-Zmiri-mute-stdout-stderr") {
      miri_config.mute_stdout_stderr = true;
    } else if (arg === "-Zmiri-retag-fields") {
      eprintln(
        "warning: `-Zmiri-retag-fields` is a NOP and will be removed in a future version of Miri.\n" +
          "Field retagging has been on-by-default for a long time.",
      );
    } else if (arg === "-Zmiri-fixed-schedule") {
      miri_config.fixed_scheduling = true;
    } else if (arg === "-Zmiri-deterministic-concurrency") {
      miri_config.fixed_scheduling = true;
      miri_config.address_reuse_cross_thread_rate = 0.0;
      miri_config.cmpxchg_weak_failure_rate = 0.0;
      miri_config.weak_memory_emulation = false;
    } else if ((param = strip_prefix(arg, "-Zmiri-seed=")) !== undefined) {
      const r = u64_from_str(param);
      if (r.$ === "Err") fatal_error("-Zmiri-seed must be an integer that fits into u64");
      const seed = r._0;
      miri_config.seed = seed;
    } else if ((param = strip_prefix(arg, "-Zmiri-many-seeds=")) !== undefined) {
      const r = parse_range(param);
      if (r.$ === "Err") {
        const err = r._0;
        fatal_error(`-Zmiri-many-seeds requires a range in the form \`from..to\` or \`..to\`: ${err}`);
      }
      many_seeds = r._0;
    } else if (arg === "-Zmiri-many-seeds") {
      many_seeds = { start: 0, end: 64 };
    } else if (arg === "-Zmiri-many-seeds-keep-going") {
      many_seeds_keep_going = true;
    } else if ((param = strip_prefix(arg, "-Zmiri-genmc")) !== undefined) {
      // `&mut miri_config.genmc_config` (PORTING §8 `MutRef`; genmc/dummy.ts, lane miri-threads)
      const genmc_config = { value: miri_config.genmc_config };
      const r = GenmcConfig.parse_arg(genmc_config, param);
      miri_config.genmc_config = genmc_config.value;
      if (r.$ === "Err") {
        const msg = r._0;
        fatal_error(`${msg}`);
      }
    } else if ((param = strip_prefix(arg, "-Zmiri-env-forward=")) !== undefined) {
      miri_config.forwarded_env_vars.push(param);
    } else if ((param = strip_prefix(arg, "-Zmiri-env-set=")) !== undefined) {
      const i = param.indexOf("=");
      if (i < 0) {
        fatal_error("-Zmiri-env-set requires an argument of the form <name>=<value>");
      }
      const [name, value] = [param.slice(0, i), param.slice(i + 1)];
      miri_config.set_env_vars.set(name, value);
    } else if ((param = strip_prefix(arg, "-Zmiri-track-pointer-tag=")) !== undefined) {
      const r = parse_comma_list(param, u64_from_str);
      if (r.$ === "Err") {
        const err = display_ParseIntError(r._0);
        fatal_error(`-Zmiri-track-pointer-tag requires a comma separated list of valid \`u64\` arguments: ${err}`);
      }
      const ids = r._0;
      for (const id_ of ids) {
        // `.map(miri::BorTag::new)`: `None` for 0 (checked on the u64, decision C4 amendment).
        if (id_ !== 0n) {
          // PORT (C4 amendment, header): a tag above 2^53 - 1 is never created; it is not inserted.
          if (id_ <= BigInt(Number.MAX_SAFE_INTEGER)) {
            const id = BorTag.new(Number(id_));
            if (id === undefined) return panic("unreachable: BorTag::new of a nonzero value");
            miri_config.tracked_pointer_tags.add(id);
          }
        } else {
          fatal_error("-Zmiri-track-pointer-tag requires nonzero arguments");
        }
      }
    } else if ((param = strip_prefix(arg, "-Zmiri-track-alloc-id=")) !== undefined) {
      const r = parse_comma_list(param, nonzero_u64_from_str);
      if (r.$ === "Err") {
        const err = display_ParseIntError(r._0);
        fatal_error(`-Zmiri-track-alloc-id requires a comma separated list of valid non-zero \`u64\` arguments: ${err}`);
      }
      const ids = r._0;
      for (const id of ids) {
        // `.map(miri::AllocId)`. PORT (header): an id above 2^53 - 1 is never created; it is not inserted.
        if (id <= BigInt(Number.MAX_SAFE_INTEGER)) miri_config.tracked_alloc_ids.add(Number(id) as AllocId);
      }
    } else if (arg === "-Zmiri-track-alloc-accesses") {
      miri_config.track_alloc_accesses = true;
    } else if ((param = strip_prefix(arg, "-Zmiri-address-reuse-rate=")) !== undefined) {
      const r = parse_rate(param);
      if (r.$ === "Err") fatal_error(`-Zmiri-address-reuse-rate ${r._0}`);
      miri_config.address_reuse_rate = r._0;
    } else if ((param = strip_prefix(arg, "-Zmiri-address-reuse-cross-thread-rate=")) !== undefined) {
      const r = parse_rate(param);
      if (r.$ === "Err") fatal_error(`-Zmiri-address-reuse-cross-thread-rate ${r._0}`);
      miri_config.address_reuse_cross_thread_rate = r._0;
    } else if ((param = strip_prefix(arg, "-Zmiri-compare-exchange-weak-failure-rate=")) !== undefined) {
      const r = parse_rate(param);
      if (r.$ === "Err") {
        fatal_error(`-Zmiri-compare-exchange-weak-failure-rate ${r._0}`);
      }
      miri_config.cmpxchg_weak_failure_rate = r._0;
    } else if ((param = strip_prefix(arg, "-Zmiri-preemption-rate=")) !== undefined) {
      const r = parse_rate(param);
      if (r.$ === "Err") fatal_error(`-Zmiri-preemption-rate ${r._0}`);
      miri_config.preemption_rate = r._0;
    } else if (arg === "-Zmiri-report-progress") {
      // This makes it take a few seconds between progress reports on my laptop.
      miri_config.report_progress = 1_000_000;
    } else if ((param = strip_prefix(arg, "-Zmiri-report-progress=")) !== undefined) {
      const r = u32_from_str(param);
      if (r.$ === "Err") {
        fatal_error(`-Zmiri-report-progress requires a \`u32\`: ${display_ParseIntError(r._0)}`);
      }
      const interval = r._0;
      miri_config.report_progress = interval;
    } else if ((param = strip_prefix(arg, "-Zmiri-provenance-gc=")) !== undefined) {
      const r = u32_from_str(param);
      if (r.$ === "Err") {
        fatal_error(`-Zmiri-provenance-gc requires a \`u32\`: ${display_ParseIntError(r._0)}`);
      }
      const interval = r._0;
      miri_config.gc_interval = interval;
    } else if ((param = strip_prefix(arg, "-Zmiri-measureme=")) !== undefined) {
      miri_config.measureme_out = param;
    } else if ((param = strip_prefix(arg, "-Zmiri-backtrace=")) !== undefined) {
      let style: BacktraceStyle;
      switch (param) {
        case "0":
          style = "Off";
          break;
        case "1":
          style = "Short";
          break;
        case "full":
          style = "Full";
          break;
        default:
          return fatal_error("-Zmiri-backtrace may only be 0, 1, or full");
      }
      miri_config.backtrace_style = style;
    } else if ((param = strip_prefix(arg, "-Zmiri-native-lib=")) !== undefined) {
      const filename = param;
      const file_path = filename;
      // PORT (D14): `Path::exists` / `read_dir` / `file_type().is_file()` on the host file system.
      if (existsSync(file_path)) {
        // For directories, nonrecursively add all normal files inside
        const dir = read_dir(file_path);
        if (dir !== undefined) {
          for (const lib of dir) {
            if (lib.is_file) {
              miri_config.native_lib.push(lib.path);
            }
          }
        } else {
          miri_config.native_lib.push(filename);
        }
      } else {
        fatal_error(`-Zmiri-native-lib \`${filename}\` does not exist`);
      }
    } else if (arg === "-Zmiri-native-lib-enable-tracing") {
      miri_config.native_lib_enable_tracing = true;
    } else if ((param = strip_prefix(arg, "-Zmiri-num-cpus=")) !== undefined) {
      const r = u32_from_str(param);
      if (r.$ === "Err") fatal_error(`-Zmiri-num-cpus requires a \`u32\`: ${display_ParseIntError(r._0)}`);
      const num_cpus = r._0;
      if (!(1 <= num_cpus && num_cpus <= MAX_CPUS())) {
        fatal_error(`-Zmiri-num-cpus must be in the range 1..=${MAX_CPUS()}`);
      }
      miri_config.num_cpus = num_cpus;
    } else if ((param = strip_prefix(arg, "-Zmiri-force-page-size=")) !== undefined) {
      const r = u64_from_str(param);
      if (r.$ === "Err") {
        fatal_error(`-Zmiri-force-page-size requires a \`u64\`: ${display_ParseIntError(r._0)}`);
      }
      const page_size0 = r._0;
      // Convert from kilobytes to bytes.
      let page_size: bigint;
      if (page_size0 !== 0n && (page_size0 & (page_size0 - 1n)) === 0n) {
        // PORT: `u64 * 1024` wraps on overflow (the release Miri has no overflow checks).
        page_size = BigInt.asUintN(64, page_size0 * 1024n);
      } else {
        return fatal_error(`-Zmiri-force-page-size requires a power of 2: ${page_size0}`);
      }
      miri_config.page_size = page_size;
    } else if ((param = strip_prefix(arg, "-Zmiri-user-relevant-crates=")) !== undefined) {
      miri_config.user_relevant_crates.push(...param.split(","));
    } else {
      // Forward to rustc.
      rustc_args.push(arg);
    }
  }

  // Disabling validation also disables aliasing checks (as retags are done during validation).
  if (miri_config.validation === ValidationMode.No) {
    miri_config.borrow_tracker = undefined;
  }

  // Native calls and strict provenance are not compatible.
  if (miri_config.native_lib.length !== 0 && miri_config.provenance_mode === ProvenanceMode.Strict) {
    fatal_error("strict provenance is not compatible with calling native functions");
  }
  // Native calls and many-seeds are an "interesting" combination.
  if (miri_config.native_lib.length !== 0 && many_seeds !== undefined) {
    eprintln(
      "warning: `-Zmiri-many-seeds` runs multiple instances of the program in the same address space, " +
        "so if the native library has global state, it will leak across execution bundaries",
    );
  }
  // You can set either one seed or many.
  if (many_seeds !== undefined && miri_config.seed !== undefined) {
    fatal_error("Only one of `-Zmiri-seed` and `-Zmiri-many-seeds can be set");
  }
  // We cannot emulate weak memory without the data race detector.
  if (miri_config.weak_memory_emulation && !miri_config.data_race_detector) {
    fatal_error("Weak memory emulation cannot be enabled when the data race detector is disabled");
  }

  // Validate GenMC settings.
  if (miri_config.genmc_config !== undefined) {
    const r = GenmcConfig.validate(miri_config);
    if (r.$ === "Err") {
      const err = r._0;
      fatal_error(`Invalid settings: ${err}`);
    }
  }

  // Ensure we have parallelism for many-seeds mode.
  if (many_seeds !== undefined && !rustc_args.some((arg) => arg.startsWith("-Zthreads="))) {
    // Clamp to 20 threads; things get a less efficient beyond that due to lock contention.
    // PORT (D14): `std::thread::available_parallelism()` of the host.
    const threads = Math.min(available_parallelism(), 20);
    rustc_args.push(`-Zthreads=${threads}`);
  }
  const many_seeds_ = many_seeds === undefined ? undefined : { seeds: many_seeds, keep_going: many_seeds_keep_going };

  // debug!("rustc arguments: {:?}", rustc_args);
  // debug!("crate arguments: {:?}", miri_config.args);
  if (miri_config.native_lib.length !== 0 && miri_config.native_lib_enable_tracing) {
    // SAFETY: No other threads are running
    // #[cfg(all(feature = "native-lib", unix))]
    // if unsafe { miri::native_lib::init_sv() }.is_err() { eprintln!("warning: The native-lib tracer could not be started. ..") }
    // PORT (decision C6): the native-lib tracer is not ported.
    unported("miri::native_lib::init_sv (-Zmiri-native-lib-enable-tracing; native-lib is out of scope, decision C6)");
  }
  return run_compiler_and_exit(rustc_args, MiriCompilerCalls.new(miri_config, many_seeds_));
  // Note that we *cannot* just return here, in native-lib mode we have to coordinate
  // with the supervisor process!
}

/** `miri::MIRI_DEFAULT_ARGS.iter().map(ToString::to_string)` */
function MIRI_DEFAULT_ARGS_(): string[] {
  return [...MIRI_DEFAULT_ARGS];
}

/** `str::strip_prefix` */
function strip_prefix(s: string, prefix: string): string | undefined {
  return s.startsWith(prefix) ? s.slice(prefix.length) : undefined;
}

/** `Path::read_dir` (`Ok` only for a directory), each entry's path and `file_type().is_file()` (PORT: D14). */
function read_dir(p: string): { path: string; is_file: boolean }[] | undefined {
  try {
    if (!statSync(p).isDirectory()) return undefined;
    return readdirSync(p, { withFileTypes: true }).map((e) => ({ path: join(p, e.name), is_file: e.isFile() }));
  } catch {
    return undefined;
  }
}

/** `std::thread::available_parallelism().map_or(1, |n| n.get())` (PORT: D14). */
function available_parallelism(): number {
  const n = navigator.hardwareConcurrency;
  return typeof n === "number" && n > 0 ? n : 1;
}

// ---- entry glue (rust-ts, not upstream): `fn main() -> ExitCode` as a process, like src/rust_ts/main.ts ----
// Exit codes: Miri's own (`exit(code)`, `ExitCode`), 101 for an ICE, 70 = reached unported code (never a Miri status).
if (import.meta.main) {
  ensure_stack();
  try {
    process.exitCode = main();
  } catch (e) {
    if (e instanceof MiriExit) {
      process.exitCode = e.code;
    } else if (e instanceof Unported) {
      process.stderr.write(`rust-ts: unported: ${e.what}\n`);
      process.exitCode = 70;
    } else if (e instanceof FatalErrorMarker) {
      process.exitCode = 101;
    } else {
      const msg = e instanceof Panic ? e.message : String(e);
      process.stderr.write(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
      process.exitCode = 101;
    }
  }
}
