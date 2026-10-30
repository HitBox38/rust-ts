// Not an upstream mirror. PORT (plan-m5 D7): the codegen backend stand-in. The oracle is built with the LLVM backend
// (`CFG_DEFAULT_CODEGEN_BACKEND=llvm`, rustc_interface util.rs `get_codegen_backend`); this class answers what that
// backend (rustc_codegen_llvm back/llvm_backend.rs `impl CodegenBackend for LlvmCodegenBackend`) answers at the
// metadata level: `init` (its `global_backend_features` from `llvm_util::global_llvm_features`) and `target_config`
// (the oracle table src/rust_ts/target_config.gen.ts, decision D4), `supported_crate_types` (the trait default),
// `target_cpu` (`llvm_util::target_cpu`) and `link` (codegen_ssa `link_binary`, as LLVM's `link` does). Codegen
// itself (`codegen_crate`, `join_codegen`) and LLVM's statistics are `unported`: unreachable for `--emit=metadata`
// (D5).
import type { CodegenBackendInit, EarlySession, Session } from "../rustc_session/session.ts";
import { type OutputFilenames, std_print } from "../rustc_session/config.ts";
import type { CrateType } from "../rustc_structures/crate_type.ts";
import { TargetTuple } from "../rustc_target/spec/tuple.ts";
import { TARGET_CONFIGS } from "./target_config.gen.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { unported } from "../std/panic.ts";
import type { MetadataLoaderDyn } from "../rustc_metadata/creader.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { link_binary, type ArchiveBuilderBuilder } from "../rustc_codegen_ssa/back/link.ts";
import { wants_wasm_eh } from "../rustc_codegen_ssa/base.ts";
import * as target_features from "../rustc_codegen_ssa/target_features.ts";
import type { Target } from "../rustc_target/spec/mod.ts";
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
 *   `CodegenBackendInit` as back/llvm_backend.rs builds it (`global_backend_features` from `global_llvm_features`).
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
    // The rest is copied from back/llvm_backend.rs `init`.
    const global_backend_features = global_llvm_features(sess, /* for_cfg */ false);
    const init = {} as CodegenBackendInit;
    init.global_backend_features = global_backend_features;

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

// PORT: `rustc_codegen_llvm` is excluded from the port (harness/scope.json), so the functions below carry no
// `// rustc:` markers; each names its llvm_util.rs fn and line. They are what `LlvmCodegenBackend::init` needs for
// `global_backend_features` (lane crateinfo-symbols).

/** `llvm_util::TargetFeatureFoldStrength` (llvm_util.rs:178). */
type TargetFeatureFoldStrength =
  // The feature is only tied when enabling the feature, disabling
  // this feature shouldn't disable the tied feature.
  | { readonly $: "EnableOnly"; readonly _0: string }
  // The feature is tied for both enabling and disabling this feature.
  | { readonly $: "Both"; readonly _0: string };

/** `llvm_util::LLVMFeature` (llvm_util.rs:195) with `new` (:201) and `with_dependencies` (:205). */
interface LLVMFeature {
  llvm_feature_name: string;
  dependencies: TargetFeatureFoldStrength[];
}
const LLVMFeature = {
  new(llvm_feature_name: string): LLVMFeature {
    return { llvm_feature_name, dependencies: [] };
  },
  with_dependencies(llvm_feature_name: string, dependencies: TargetFeatureFoldStrength[]): LLVMFeature {
    return { llvm_feature_name, dependencies };
  },
};

/**
 * `llvm_util::get_version` (llvm_util.rs:469). PORT: `LLVMGetVersion` of the oracle's bundled LLVM, i.e.
 * `LLVM_VERSION`.
 */
function get_version(): [number, number, number] {
  const [major, minor, patch] = LLVM_VERSION.split(".").map(Number);
  return [major, minor, patch];
}

/// Convert a Rust feature name to an LLVM feature name. Returning `None` means the
/// feature should be skipped, usually because it is not supported by the current
/// LLVM version.
///
/// WARNING: the features after applying `to_llvm_features` must be known
/// to LLVM or the feature detection code will walk past the end of the feature
/// array, leading to crashes.
///
/// To find a list of LLVM's names, see llvm-project/llvm/lib/Target/{ARCH}/*.td
/// where `{ARCH}` is the architecture name. Look for instances of `SubtargetFeature`.
///
/// Check the current rustc fork of LLVM in the repo at
/// <https://github.com/rust-lang/llvm-project/>. The commit in use can be found via the
/// `llvm-project` submodule in <https://github.com/rust-lang/rust/tree/HEAD/src> Though note that
/// Rust can also be build with an external precompiled version of LLVM which might lead to failures
/// if the oldest tested / supported LLVM version doesn't yet support the relevant intrinsics.
/** `llvm_util::to_llvm_features` (llvm_util.rs:239). */
function to_llvm_features(target: Target, s: string): LLVMFeature | undefined {
  const [major] = get_version();
  switch (target.arch.$) {
    case "AArch64":
    case "Arm64EC": {
      switch (s) {
        case "rcpc2":
          return LLVMFeature.new("rcpc-immo");
        case "dpb":
          return LLVMFeature.new("ccpp");
        case "dpb2":
          return LLVMFeature.new("ccdp");
        case "frintts":
          return LLVMFeature.new("fptoint");
        case "fcma":
          return LLVMFeature.new("complxnum");
        case "pmuv3":
          return LLVMFeature.new("perfmon");
        case "paca":
          return LLVMFeature.new("pauth");
        case "pacg":
          return LLVMFeature.new("pauth");
        case "flagm2":
          return LLVMFeature.new("altnzcv");
        // Rust ties fp and neon together.
        case "neon":
          return LLVMFeature.with_dependencies("neon", [{ $: "Both", _0: "fp-armv8" }]);
        // In LLVM neon implicitly enables fp, but we manually enable
        // neon when a feature only implicitly enables fp
        case "fhm":
          return LLVMFeature.new("fp16fml");
        case "fp16":
          return LLVMFeature.new("fullfp16");
        // Filter out features that are not supported by the current LLVM version
        case "fpmr":
          return undefined; // only existed in 18
        // Withdrawn by ARM; removed from LLVM in 22
        case "tme":
          return undefined;
        default:
          return LLVMFeature.new(s);
      }
    }
    case "Arm":
      switch (s) {
        case "fp16":
          return LLVMFeature.new("fullfp16");
        default:
          return LLVMFeature.new(s);
      }
    case "Nvptx64":
      if (s === "sm_101" && major >= 24) return LLVMFeature.new("sm_110");
      if (s === "sm_101a" && major >= 24) return LLVMFeature.new("sm_110a");
      if (s === "sm_101f" && major >= 24) return LLVMFeature.new("sm_110f");
      return LLVMFeature.new(s);
    // Filter out features that are not supported by the current LLVM version
    case "PowerPC":
    case "PowerPC64":
      switch (s) {
        case "power8-crypto":
          return LLVMFeature.new("crypto");
        default:
          return LLVMFeature.new(s);
      }
    case "RiscV32":
    case "RiscV64":
      switch (s) {
        // Filter out Rust-specific *virtual* target feature
        case "zkne_or_zknd":
          return undefined;
        default:
          return LLVMFeature.new(s);
      }
    case "Sparc":
    case "Sparc64":
      switch (s) {
        case "leoncasa":
          return LLVMFeature.new("hasleoncasa");
        default:
          return LLVMFeature.new(s);
      }
    case "X86":
    case "X86_64":
      switch (s) {
        case "sse4.2":
          return LLVMFeature.with_dependencies("sse4.2", [{ $: "EnableOnly", _0: "crc32" }]);
        case "pclmulqdq":
          return LLVMFeature.new("pclmul");
        case "rdrand":
          return LLVMFeature.new("rdrnd");
        case "bmi1":
          return LLVMFeature.new("bmi");
        case "cmpxchg16b":
          return LLVMFeature.new("cx16");
        case "lahfsahf":
          return LLVMFeature.new("sahf");
        case "apxf":
          return LLVMFeature.with_dependencies("egpr", [
            { $: "Both", _0: "push2pop2" },
            { $: "Both", _0: "ppx" },
            { $: "Both", _0: "ndd" },
            { $: "Both", _0: "ccmp" },
            { $: "Both", _0: "cf" },
            { $: "Both", _0: "nf" },
            { $: "Both", _0: "zu" },
          ]);
        default:
          return LLVMFeature.new(s);
      }
    default:
      return LLVMFeature.new(s);
  }
}

/** `llvm_util::llvm_features_by_flags` (llvm_util.rs:663). */
function llvm_features_by_flags(sess: EarlySession, features: string[]): void {
  if (wants_wasm_eh(sess.target) && sess.panic_strategy() === "Unwind") {
    features.push("+exception-handling");
  }

  target_features.retpoline_features_by_flags(sess, features);
  target_features.sanitizer_features_by_flags(sess, features);

  // -Zfixed-x18
  if (sess.opts.unstable_opts.fixed_x18) {
    if (sess.target.arch.$ !== "AArch64") {
      // sess.dcx().emit_fatal(diagnostics::FixedX18InvalidArch { arch: sess.target.arch.desc() });
      unported("rustc_codegen_llvm::diagnostics::FixedX18InvalidArch (-Z fixed-x18)");
    } else {
      features.push("+reserve-x18");
    }
  }
}

/// The list of LLVM features computed from CLI flags (`-Ctarget-cpu`, `-Ctarget-feature`,
/// `--target` and similar).
///
/// If `for_cfg` is `true` then we are assembling the feature list for the purpose of populating
/// [`rustc_codegen_ssa::TargetConfig`] based on what LLVM actually enables in this configuration.
/// `-Ctarget-feature` should be ignored in that case since it is already processed separately.
/** `llvm_util::global_llvm_features` (llvm_util.rs:688). */
function global_llvm_features(sess: EarlySession, for_cfg: boolean): string[] {
  // Features that come earlier are overridden by conflicting features later in the string.
  // Typically we'll want more explicit settings to override the implicit ones, so:
  //
  // * Features from -Ctarget-cpu=*; are overridden by [^1]
  // * Features implied by --target; are overridden by
  // * Features from -Ctarget-feature; are overridden by
  // * function specific features.
  //
  // [^1]: target-cpu=native is handled here, other target-cpu values are handled implicitly
  // through LLVM TargetMachine implementation.
  //
  // FIXME(nagisa): it isn't clear what's the best interaction between features implied by
  // `-Ctarget-cpu` and `--target` are. On one hand, you'd expect CLI arguments to always
  // override anything that's implicit, so e.g. when there's no `--target` flag, features implied
  // the host target are overridden by `-Ctarget-cpu=*`. On the other hand, what about when both
  // `--target` and `-Ctarget-cpu=*` are specified? Both then imply some target features and both
  // flags are specified by the user on the CLI. It isn't as clear-cut which order of precedence
  // should be taken in cases like these.
  const features: string[] = [];

  // -Ctarget-cpu=native
  if (sess.opts.cg.target_cpu === NATIVE_CPU) {
    // We have already figured out the actual CPU name with `LLVMRustGetHostCPUName` and set
    // that for LLVM, so the features implied by that CPU name will be available everywhere.
    // However, that is not sufficient: e.g. `skylake` alone is not sufficient to tell if
    // some of the instructions are available or not. So we have to also explicitly ask for
    // the exact set of features available on the host, and enable all of them.
    return unported("rustc_codegen_llvm::llvm::LLVMGetHostCPUFeatures (-C target-cpu=native)");
  }

  const extend_backend_features = (feature: string, enable: boolean): void => {
    const enable_disable = enable ? "+" : "-";
    // We run through `to_llvm_features` when
    // passing requests down to LLVM. This means that all in-language
    // features also work on the command line instead of having two
    // different names when the LLVM name and the Rust name differ.
    const llvm_feature = to_llvm_features(sess.target, feature);
    if (llvm_feature === undefined) return;

    features.push(`${enable_disable}${llvm_feature.llvm_feature_name}`);
    for (const feat of llvm_feature.dependencies) {
      if (feat.$ === "Both" || (enable && feat.$ === "EnableOnly")) {
        features.push(`${enable_disable}${feat._0}`);
      }
    }
  };

  // Features implied by an implicit or explicit `--target`.
  target_features.target_spec_to_backend_features(sess, extend_backend_features);

  // -Ctarget-features. Skipped for `cfg` as there we parse -Ctarget-features directly instead of
  // going via an LLVM target machine (which avoids accidentally picking up LLVM-level target
  // feature implications that we do not want).
  if (!for_cfg) {
    target_features.flag_to_backend_features(sess, extend_backend_features);
  }

  // `-C` flags that map to LLVM target features.
  // We need to include them even with `only_base_features` as this is used to populate
  // `sess.internal_target_features` where we very much want them to be present (e.g. the inline
  // asm logic uses that to check which registers may be used).
  llvm_features_by_flags(sess, features);

  // `-Zllvm-target-features`, all the way at the end to overwrite everything.
  // Should be picked up by `cfg` (e.g. if someone enables AVX this way).
  for (const feature of sess.opts.unstable_opts.llvm_target_feature.split(",")) {
    if (feature === "") {
      continue;
    }
    if (feature.startsWith("+") || feature.startsWith("-")) {
      features.push(feature);
    } else {
      // LLVM seems to silently ignore entries without leading `+`/`-`. Let's emit a warning
      // to avoid confusion. But only emit this warning once, under `for_cfg`.
      if (for_cfg) {
        // sess.dcx().emit_warn(diagnostics::UnknownLlvmTargetFeaturePrefix { feature });
        unported("rustc_codegen_llvm::diagnostics::UnknownLlvmTargetFeaturePrefix (-Z llvm-target-feature)");
      }
    }
  }

  return features;
}

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
