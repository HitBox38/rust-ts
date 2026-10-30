// Not an upstream mirror. PORT (plan-m5 D7): the codegen backend stand-in. The oracle is built with the LLVM backend
// (`CFG_DEFAULT_CODEGEN_BACKEND=llvm`, rustc_interface util.rs `get_codegen_backend`); this class answers what that
// backend (rustc_codegen_llvm back/llvm_backend.rs `impl CodegenBackend for LlvmCodegenBackend`) answers at the
// metadata level: `init` and `target_config` (the oracle table src/rust_ts/target_config.gen.ts, decision D4),
// `supported_crate_types` (the trait default), `target_cpu` (`llvm_util::target_cpu`) and `link` (codegen_ssa
// `link_binary`, as LLVM's `link` does). Codegen itself (`codegen_crate`, `join_codegen`) and LLVM's statistics are
// `unported`: unreachable for `--emit=metadata` (D5).
import type { CodegenBackendInit, EarlySession, Session } from "../rustc_session/session.ts";
import { type OutputFilenames, std_print } from "../rustc_session/config.ts";
import type { CrateType } from "../rustc_structures/crate_type.ts";
import { defer_field } from "../rustc_session/stand_ins.ts";
import { TargetTuple } from "../rustc_target/spec/tuple.ts";
import { TARGET_CONFIGS } from "./target_config.gen.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { unported } from "../std/panic.ts";
import type { MetadataLoaderDyn } from "../rustc_metadata/creader.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { link_binary, type ArchiveBuilderBuilder } from "../rustc_codegen_ssa/back/link.ts";
import type { CompiledModules, CrateInfo } from "../rustc_codegen_ssa/lib.ts";
import type { EncodedMetadata } from "../rustc_metadata/lib.ts";
import {
  type CodegenBackend,
  CodegenBackend_provided,
  type IncrCompSession,
  type TargetConfig,
  type WorkProductMap,
} from "../rustc_interface/stand_ins.ts";

/**
 * PORT: the inputs of LLVM's initialisation (`llvm_util::configure_llvm`, `global_llvm_features`,
 * `llvm_features_by_flags`) and of `target_config` that rust-ts only knows the default of. Each
 * non-default one is reported by name; the caller calls `unported` with it. With all of them at their
 * default, `init` reports nothing (LLVM accepts the target's own `llvm_args`) and `target_config` is the
 * oracle table (decision D4).
 */
function non_default_llvm_input(sess: EarlySession, for_target_config: boolean): string | undefined {
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
  if (z.small_data_threshold !== undefined && sess.target.small_data_threshold_support_().$ === "LlvmArg") return "-Z small-data-threshold";
  if (z.fixed_x18) return "-Z fixed-x18";
  if (z.retpoline || z.retpoline_external_thunk) return "-Z retpoline";
  // `sanitizer_features_by_flags` only adds features (no diagnostics): it changes `target_config`, not `init`.
  if (for_target_config && sess.sanitizers() !== 0) return "-Z sanitizer";
  if (sess.target.is_like_wasm && sess.panic_strategy() !== sess.target.panic_strategy) return "-C panic (wasm exception handling)";
  return undefined;
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
    const input = non_default_llvm_input(sess, false);
    if (input !== undefined) {
      unported(`rustc_codegen_llvm::llvm_util::configure_llvm (${input})`);
    }
    // PORT: `global_backend_features` (`llvm_util::global_llvm_features`, LLVM feature names) is deferred;
    // the rest is copied from back/llvm_backend.rs `init`.
    const init = {} as CodegenBackendInit;
    defer_field(init, "global_backend_features", "rustc_codegen_llvm::llvm_util::global_llvm_features (CodegenBackendInit::global_backend_features)");

    // Intrinsics whose fallback body will not be used by the LLVM backend.
    // #[rustfmt::skip]
    const will_not_use_fallback = [
      // These are mapped to LLVM intrinsics instead.
      sym.unchecked_funnel_shl,
      sym.unchecked_funnel_shr,
      sym.carrying_mul_add,
      sym.carryless_mul,
      sym.integer_max,
      sym.integer_min,

      // Fallback via libm, but the LLVM intrinsic is used instead.
      sym.sin,
      sym.cos,
      sym.powf16, sym.powf32, sym.powf64,
      sym.exp,
      sym.exp2,
      sym.log,
      sym.log10,
      sym.log2,

      // Fallback via f32 or f64, but the LLVM intrinsic is used instead.
      sym.floorf16, sym.ceilf16, sym.truncf16,
      sym.round_ties_even_f16, sym.roundf16,
      sym.sqrtf16, sym.powif16,
      sym.fmaf16,

      sym.copysignf16, sym.copysignf32, sym.copysignf64, sym.copysignf128,
    ];
    init.replaced_intrinsics = will_not_use_fallback;

    // `type_id_eq` is a safe choice since *all* backends use the fallback body for that. When
    // adding more intrinsics, keep in mind that the distributed standard library is compiled
    // with the LLVM backend but might later be included in a project built with cranelift or
    // GCC. Adding an intrinsic here can therefore mean the fallback body is used with
    // cranelift/GCC even if they have dedicated implementations.
    init.fallback_intrinsics = [sym.type_id_eq];
    init.thin_lto_supported = true;
    return init;
  }
  /** `llvm_util::target_config` (PORT: the oracle table src/rust_ts/target_config.gen.ts, decision D4). */
  target_config(sess: EarlySession): TargetConfig {
    const input = non_default_llvm_input(sess, true);
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
  // PORT: the LLVM backend does not override the provided trait method.
  metadata_loader(): MetadataLoaderDyn {
    return CodegenBackend_provided.metadata_loader(this);
  }
  // PORT: the LLVM backend does not override the provided trait method.
  supported_crate_types(sess: Session): CrateType[] {
    return CodegenBackend_provided.supported_crate_types(this, sess);
  }
  /** `crate::llvm_util::target_cpu(sess).to_string()` */
  target_cpu(sess: Session): string {
    return llvm_util_target_cpu(sess.early_sess);
  }
  codegen_crate(_tcx: TyCtxt): unknown {
    // `rustc_codegen_ssa::base::codegen_crate(LlvmCodegenBackend(()), tcx, crate::llvm_util::target_cpu(tcx.sess)
    // .to_string())` and the offload/autodiff steps: unreachable without `should_codegen()` (D5).
    return unported("rustc_codegen_llvm::LlvmCodegenBackend::codegen_crate (codegen; M7)");
  }
  join_codegen(
    _ongoing_codegen: unknown,
    _sess: Session,
    _incr_comp_session: IncrCompSession | undefined,
    _outputs: OutputFilenames,
    _crate_info: CrateInfo,
  ): [CompiledModules, WorkProductMap] {
    return unported("rustc_codegen_llvm::LlvmCodegenBackend::join_codegen (codegen; M7)");
  }
  print_pass_timings(): void {
    unported("rustc_codegen_llvm::LlvmCodegenBackend::print_pass_timings (-Z time-llvm-passes)");
  }
  print_statistics(): void {
    unported("rustc_codegen_llvm::LlvmCodegenBackend::print_statistics (-Z print-codegen-stats)");
  }
  print_statistics_json(): string {
    return unported("rustc_codegen_llvm::LlvmCodegenBackend::print_statistics_json (-Z print-codegen-stats-json)");
  }
  link(sess: Session, compiled_modules: CompiledModules, crate_info: CrateInfo, metadata: EncodedMetadata, outputs: OutputFilenames): void {
    // use rustc_codegen_ssa::back::link::link_binary;
    //
    // use crate::back::archive::LlvmArchiveBuilderBuilder;

    // Run the linker on any artifacts that resulted from the LLVM run.
    // This should produce either a finished executable or library.
    link_binary(sess, LlvmArchiveBuilderBuilder, compiled_modules, crate_info, metadata, outputs, this.name());
  }
}

/** PORT: build constant of the oracle (its bundled LLVM), like `CFG_VERSION`; see `LlvmCodegenBackend`. */
export const LLVM_VERSION = "23.1.3";

/** `NATIVE_CPU` (rustc_codegen_llvm llvm_util.rs). */
const NATIVE_CPU = "native";

/** `llvm_util::target_cpu` (llvm_util.rs:657) with `handle_native` (:650). */
function llvm_util_target_cpu(sess: EarlySession): string {
  const cpu_name = sess.opts.cg.target_cpu ?? sess.target.cpu;
  // handle_native(cpu_name)
  if (cpu_name === NATIVE_CPU) {
    return unported("rustc_codegen_llvm::llvm_util::get_host_cpu_name (-C target-cpu=native)");
  }
  return cpu_name;
}

/** PORT: `rustc_codegen_llvm::back::archive::LlvmArchiveBuilderBuilder` (M7): opaque, see `ArchiveBuilderBuilder`. */
const LlvmArchiveBuilderBuilder: ArchiveBuilderBuilder = { __archive_builder_builder: "LlvmArchiveBuilderBuilder" };
