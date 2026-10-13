// Not an upstream mirror. PORT: stand-ins for crates the driver path reaches but that are not ported:
//   rustc_codegen_ssa::traits::CodegenBackend, rustc_codegen_llvm::LlvmCodegenBackend
//   rustc_data_structures::jobserver::initialize
//   rustc_middle::ty::CurrentGcx
// Each keeps only what can be copied verbatim or is observable-free on the `-Zunpretty` path; everything
// else calls `unported(...)`. Replace by the real modules when those crates are ported.
import type { CodegenBackendInit, EarlySession } from "../rustc_session/session.ts";
import { defer_field } from "../rustc_session/stand_ins.ts";
import { std_print } from "../rustc_session/config.ts";
import { TargetTuple } from "../rustc_target/spec/tuple.ts";
import { TARGET_CONFIGS } from "../rust_ts/target_config.gen.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { unported } from "../std/panic.ts";

/// `rustc_codegen_ssa::TargetConfig` (rustc_codegen_ssa/src/lib.rs:309)
export interface TargetConfig {
  /// Options to be set in `sess.internal_target_features`.
  internal_target_features: Set<Symbol>;
  /// Option for `cfg(target_has_reliable_f16)`, true if `f16` basic arithmetic works.
  has_reliable_f16: boolean;
  /// Option for `cfg(target_has_reliable_f16_math)`, true if `f16` math calls work.
  has_reliable_f16_math: boolean;
  /// Option for `cfg(target_has_reliable_f16b)`, presently true if both the ABI
  /// and LLVM version supports `f16b`.
  has_reliable_f16b: boolean;
  /// Option for `cfg(target_has_reliable_f128)`, true if `f128` basic arithmetic works.
  has_reliable_f128: boolean;
  /// Option for `cfg(target_has_reliable_f128_math)`, true if `f128` math calls work.
  has_reliable_f128_math: boolean;
}

/**
 * PORT: the inputs of LLVM's initialisation (`llvm_util::configure_llvm`, `global_llvm_features`,
 * `llvm_features_by_flags`) and of `target_config` that rust-ts only knows the default of. Each
 * non-default one is reported by name; the caller calls `unported` with it. With all of them at their
 * default, `init` reports nothing (LLVM accepts the target's own `llvm_args`) and `target_config` is the
 * oracle table (decision D4).
 */
function non_default_llvm_input(sess: EarlySession): string | undefined {
  const cg = sess.opts.cg;
  const z = sess.opts.unstable_opts;
  if (cg.llvm_args.length !== 0) return "-C llvm-args";
  if (cg.target_cpu !== undefined) return "-C target-cpu";
  if (cg.target_feature !== "") return "-C target-feature";
  if (z.llvm_target_feature !== "") return "-Z llvm-target-feature";
  if (z.llvm_plugins.length !== 0) return "-Z llvm-plugins";
  if (z.time_llvm_passes) return "-Z time-llvm-passes";
  if (z.print_llvm_passes) return "-Z print-llvm-passes";
  if (z.print_codegen_stats || z.print_codegen_stats_json !== undefined) return "-Z print-codegen-stats";
  if (z.autodiff.length !== 0) return "-Z autodiff";
  if (z.small_data_threshold !== undefined) return "-Z small-data-threshold";
  if (z.fixed_x18) return "-Z fixed-x18";
  if (z.retpoline || z.retpoline_external_thunk) return "-Z retpoline";
  if (sess.sanitizers() !== 0) return "-Z sanitizer";
  if (sess.target.is_like_wasm && sess.panic_strategy() !== sess.target.panic_strategy) return "-C panic (wasm exception handling)";
  return undefined;
}

/** `rustc_codegen_ssa::traits::CodegenBackend` (the methods the driver path calls). */
export interface CodegenBackend {
  name(): string;
  init(sess: EarlySession): CodegenBackendInit;
  target_config(sess: EarlySession): TargetConfig;
  print_version(): void;
  print_passes(): void;
  metadata_loader(): never;
}

/**
 * `rustc_codegen_llvm::LlvmCodegenBackend` (stand-in). The pinned nightly is built with
 * `CFG_DEFAULT_CODEGEN_BACKEND=llvm`.
 * - `init` (LLVM initialisation): `unported` when an LLVM input is non-default (`non_default_llvm_input`); returns a
 *   `CodegenBackendInit` whose fields are deferred (reading one calls `unported`).
 * - `print_version`: `llvm_util::print_version` prints `LLVM version: {major}.{minor}.{patch}` of the LLVM
 *   the oracle was built with (`LLVM_VERSION`, checked against `rustc -vV` in driver.oracle.test.ts).
 */
export class LlvmCodegenBackend implements CodegenBackend {
  /** `LlvmCodegenBackend::new` */
  static new(): CodegenBackend {
    return new LlvmCodegenBackend();
  }
  name(): string {
    return "llvm";
  }
  init(sess: EarlySession): CodegenBackendInit {
    // `llvm_util::init(sess)`: LLVM's command-line parsing and the target-feature computations.
    const input = non_default_llvm_input(sess);
    if (input !== undefined) {
      unported(`rustc_codegen_llvm::llvm_util::configure_llvm (${input})`);
    }
    const init = {} as CodegenBackendInit;
    for (const key of ["global_backend_features", "replaced_intrinsics", "fallback_intrinsics", "thin_lto_supported"] as const) {
      defer_field(init, key, `rustc_codegen_llvm::LlvmCodegenBackend::init (${key})`);
    }
    return init;
  }
  /** `llvm_util::target_config` (PORT: the oracle table src/rust_ts/target_config.gen.ts, decision D4). */
  target_config(sess: EarlySession): TargetConfig {
    const input = non_default_llvm_input(sess);
    if (input !== undefined) {
      return unported(`rustc_codegen_llvm::llvm_util::target_config (${input})`);
    }
    const tuple = TargetTuple.tuple(sess.opts.target_triple);
    const t = sess.opts.target_triple.$ === "TargetTuple" ? TARGET_CONFIGS.get(tuple) : undefined;
    if (t === undefined) {
      return unported(`rustc_codegen_llvm::llvm_util::target_config (no oracle table for ${tuple})`);
    }
    return {
      internal_target_features: new Set(t.internal_target_features.map((f) => Symbol.intern(f))),
      has_reliable_f16: t.has_reliable_f16,
      has_reliable_f16_math: t.has_reliable_f16_math,
      has_reliable_f16b: t.has_reliable_f16b,
      has_reliable_f128: t.has_reliable_f128,
      has_reliable_f128_math: t.has_reliable_f128_math,
    };
  }
  print_version(): void {
    std_print(`LLVM version: ${LLVM_VERSION}\n`);
  }
  print_passes(): void {
    unported("rustc_codegen_llvm::LlvmCodegenBackend::print_passes (-C passes=list)");
  }
  metadata_loader(): never {
    return unported("rustc_codegen_llvm::LlvmCodegenBackend::metadata_loader");
  }
}

/** PORT: build constant of the oracle (its bundled LLVM), like `CFG_VERSION`; see `LlvmCodegenBackend`. */
export const LLVM_VERSION = "23.1.3";

/**
 * `rustc_data_structures::jobserver::initialize` (stand-in). Upstream inherits a jobserver from
 * `CARGO_MAKEFLAGS`/`MAKEFLAGS`/`MFLAGS` (`Client::from_env_ext`) and reports a malformed one; with none
 * of them set (`FromEnvErrorKind::NoEnvVar`) it silently creates its own client. Only that case is kept.
 */
export function jobserver_initialize(_limit: number, _report: (err: string) => void): void {
  for (const v of ["CARGO_MAKEFLAGS", "MAKEFLAGS", "MFLAGS"]) {
    if (process.env[v] !== undefined) {
      unported(`rustc_data_structures::jobserver::initialize (inherited jobserver: ${v} is set)`);
    }
  }
}

/** `rustc_middle::ty::CurrentGcx` (opaque: no `GlobalCtxt` is ever created). */
export class CurrentGcx {
  static new(): CurrentGcx {
    return new CurrentGcx();
  }
}
