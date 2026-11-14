// compiler/rustc_codegen_llvm/src/llvm_util.rs (lane cg-write, plan-m7 wave 42). Ported whole, in upstream order.
//
// src/rust_ts/codegen_backend.ts (the stand-in backend rustc_interface still constructs) holds its own partial copies of
// `global_llvm_features`, `to_llvm_features`, `update_target_reliable_float_cfg` and `target_cpu` (plan-m7 §2e); this file is
// the port those copies stand in for, and nothing here changes the stand-in's path.
//
// The LLVM calls go to the IR model (src/rust_ts/llvm/ffi.ts) under their ffi.rs names. Those the model has no answer for are
// its stops (an `unported` naming `llir: <fn>`; llir-init implemented the init, error-handler, options and subtarget ones):
// `LLVMRustTimeTraceProfiler*`, `LLVMRustPrintPasses`, `LLVMRustGetTargetFeature*`, `LLVMRustPrintTargetCPUs`,
// `LLVMRustGetHostCPUName`, `LLVMGetHostCPUFeatures` and the `LLVMDisposeMessage` after it, `LLVMRustTargetHasMnemonic`
// (docs/handoff/cg-write.md lists them). `LLVMRustDisableSystemDialogsOnCrash`, which `configure_llvm` calls when `CI` is set, is
// a no-op on a Unix host and stops by name only on a Windows host (fixers-57; review root-w56-check 4).
import { type Endian } from "../rustc_abi/lib.ts";
import { versioned_llvm_target } from "../rustc_codegen_ssa/back/mod.ts";
import { wants_wasm_eh } from "../rustc_codegen_ssa/base.ts";
import * as target_features from "../rustc_codegen_ssa/target_features.ts";
import { internal_target_features } from "../rustc_codegen_ssa/target_features.ts";
import type { PathBuf } from "../rustc_error_messages/lib.ts";
import type { TargetConfig } from "../rustc_interface/stand_ins.ts";
import { NATIVE_CPU, std_print } from "../rustc_session/config.ts";
import { debug_PrintRequest, type PrintRequest } from "../rustc_session/config/print_request.ts";
import type { EarlySession, Session } from "../rustc_session/session.ts";
import { bug } from "../rustc_span/macros.ts";
import { sym } from "../rustc_span/symbol.ts";
import { Stability } from "../rustc_target/target_features.ts";
import { Arch, type MergeFunctions, spec_other_eq, type Target } from "../rustc_target/spec/mod.ts";
import { var_os } from "../std/env.ts";
import { format_debug, PLAIN } from "../std/fmt.ts";
import { unwrap_result } from "../std/result.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { assert, panic, unported } from "../std/panic.ts";
import { utf8, utf8_len } from "../std/str.ts";
import { OwnedMCSubtargetInfo } from "./back/owned_mc_subtarget_info.ts";
import { create_informational_target_machine, llvm_err } from "./back/write.ts";
import {
  FixedX18InvalidArch_diagnostic,
  LlvmVersionMismatch_diagnostic,
  UnknownLlvmTargetFeaturePrefix_diagnostic,
} from "./diagnostics.gen.ts";
import * as llvm from "./llvm/mod.ts";
import { initialize_available_targets } from "../rust_ts/llvm/target.ts";

/** `static INIT: Once = Once::new();` (PORTING §5 global state: a module-level value; one thread). */
const INIT: { completed: boolean } = { completed: false };

// rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:31 init
export function init(sess: EarlySession): void {
  // unsafe {
  // Before we touch LLVM, make sure that multithreading is enabled.
  if (!llvm.LLVMIsMultithreaded().is_true()) {
    bug("LLVM compiled without support for threads");
  }
  // INIT.call_once(|| { configure_llvm(sess); });
  if (!INIT.completed) {
    configure_llvm(sess);
    INIT.completed = true;
  }
  // }
}

// rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:43 require_inited
function require_inited(): void {
  if (!INIT.completed) {
    bug("LLVM is not initialized");
  }
}

/** An `unsafe fn`. */
// rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:49 configure_llvm
function configure_llvm(sess: EarlySession): void {
  const n_args = sess.opts.cg.llvm_args.length + sess.target.llvm_args.length;
  // PORT: `Vec::with_capacity(n_args + 1)`: a capacity, no value.
  void n_args;
  /** `Vec<CString>`: owns the strings `llvm_args` points into. */
  const llvm_c_strs: string[] = [];
  /** `Vec<*const c_char>` */
  const llvm_args: string[] = [];

  // Check to ensure we're running against the correct LLVM version.
  {
    const [llvm_major, llvm_minor, llvm_patch] = get_version();
    const expected_version = llvm.LLVMRustVersionMajor();
    if (llvm_major !== expected_version) {
      sess.dcx().emit_fatal(
        LlvmVersionMismatch_diagnostic({
          expected_version,
          llvm_major,
          llvm_minor,
          llvm_patch,
          // &match rustc_session::filesearch::dll_path(llvm::LLVMGetVersion as *mut _) {
          //     Ok(path) => format!(" at {}", path.display()),
          //     Err(_) => String::new(),
          // }
          dll_loc: unported("rustc_session: compiler/rustc_session/src/filesearch.rs dll_path"),
        }),
      );
    }
  }

  llvm.LLVMRustInstallErrorHandlers();
  // On Windows, an LLVM assertion will open an Abort/Retry/Ignore dialog
  // box for the purpose of launching a debugger. However, on CI this will
  // cause it to hang until it times out, which can take several hours.
  if (var_os("CI") !== undefined) {
    llvm.LLVMRustDisableSystemDialogsOnCrash();
  }

  const cg_opts = sess.opts.cg.llvm_args;
  const tg_opts = sess.target.llvm_args;
  // Target-spec args are passed to LLVM before user `-Cllvm-args`. LLVM's
  // `cl::opt` parser is last-wins, so this lets `-Cllvm-args=...` override
  // a value already set in the target spec (e.g. `-wasm-use-legacy-eh`).
  const sess_args: readonly string[] = [...tg_opts, ...cg_opts];

  const user_specified_args: Set<string> = new Set(sess_args.map((s) => llvm_arg_to_arg_name(s)).filter((s) => s !== ""));

  {
    // This adds the given argument to LLVM. Unless `force` is true
    // user specified arguments are *not* overridden.
    const add = (arg: string, force: boolean): void => {
      if (force || !user_specified_args.has(llvm_arg_to_arg_name(arg))) {
        const s = cstring_new_unwrap(arg);
        llvm_args.push(s);
        llvm_c_strs.push(s);
      }
    };
    // Set the llvm "program name" to make usage and invalid argument messages more clear.
    add('rustc -Cllvm-args="..." with', true);
    if (sess.opts.unstable_opts.time_llvm_passes) {
      add("-time-passes", false);
    }
    if (sess.opts.unstable_opts.print_llvm_passes) {
      add("-debug-pass=Structure", false);
    }
    if (sess.target.generate_arange_section && !sess.opts.unstable_opts.no_generate_arange_section) {
      add("-generate-arange-section", false);
    }

    const merge_functions: MergeFunctions = sess.merge_functions();
    switch (merge_functions) {
      case "Disabled":
      case "Trampolines":
        break;
      case "Aliases": {
        add("-mergefunc-use-aliases", false);
        break;
      }
    }

    if (version_lt(get_version(), [24, 0, 0]) && wants_wasm_eh(sess.target)) {
      add("-wasm-enable-eh", false);
    }

    // HACK(eddyb) LLVM inserts `llvm.assume` calls to preserve align attributes
    // during inlining. Unfortunately these may block other optimizations.
    add("-preserve-alignment-assumptions-during-inlining=false", false);

    // Use non-zero `import-instr-limit` multiplier for cold callsites.
    add("-import-cold-multiplier=0.1", false);

    if (sess.print_llvm_stats() || sess.print_llvm_stats_json() !== undefined) {
      add("-stats", false);
    }

    for (const arg of sess_args) {
      add(arg, true);
    }

    const threshold = sess.opts.unstable_opts.small_data_threshold;
    const support = sess.target.small_data_threshold_support_();
    // Set up the small-data optimization limit for architectures that use
    // an LLVM argument to control this.
    if (threshold !== undefined && support.$ === "LlvmArg") {
      const arg = support._0;
      add(`--${arg}=${threshold}`, false);
    } else {
      // _ => (),
    }
  }

  if (sess.opts.unstable_opts.llvm_time_trace) {
    llvm.LLVMRustTimeTraceProfilerInitialize();
  }

  // rustc_llvm::initialize_available_targets();
  // PORT: rustc_llvm's lib.rs registers LLVM's targets through `LLVMInitialize*` C calls; the IR model's target registry
  // holds its port (src/rust_ts/llvm/target.ts, lane llir-init; decision recorded 2026-11-14; root at integ-w56).
  initialize_available_targets();

  llvm.LLVMRustSetLLVMOptions(llvm_args.length, llvm_args);
  void llvm_c_strs;
}

/** The nested `fn llvm_arg_to_arg_name(full_arg: &str) -> &str` of `configure_llvm`. */
// rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:85 llvm_arg_to_arg_name
function llvm_arg_to_arg_name(full_arg: string): string {
  // full_arg.trim().split(|c: char| c == '=' || c.is_whitespace()).next().unwrap_or("")
  const trimmed = str_trim(full_arg);
  let end = 0;
  for (const c of trimmed) {
    if (c === "=" || is_whitespace(c.codePointAt(0)!)) break;
    end += c.length;
  }
  return trimmed.slice(0, end);
}

/** `file_name: &Path` */
// rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:171 time_trace_profiler_finish
export function time_trace_profiler_finish(file_name: PathBuf): void {
  // unsafe {
  const file_name_ = path_to_c_string(file_name);
  llvm.LLVMRustTimeTraceProfilerFinish(file_name_);
  // }
}

export type TargetFeatureFoldStrength =
  // The feature is only tied when enabling the feature, disabling
  // this feature shouldn't disable the tied feature.
  | { readonly $: "EnableOnly"; readonly _0: string }
  // The feature is tied for both enabling and disabling this feature.
  | { readonly $: "Both"; readonly _0: string };

export const TargetFeatureFoldStrength = {
  // rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:187 as_str
  as_str(self: TargetFeatureFoldStrength): string {
    switch (self.$) {
      case "EnableOnly":
        return self._0;
      case "Both":
        return self._0;
    }
  },
} as const;

export class LLVMFeature {
  constructor(
    /** private */
    public llvm_feature_name: string,
    /** private. `SmallVec<[TargetFeatureFoldStrength<'a>; 1]>` */
    public dependencies: TargetFeatureFoldStrength[],
  ) {}

  // rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:201 new
  static new(llvm_feature_name: string): LLVMFeature {
    return new LLVMFeature(llvm_feature_name, []);
  }

  // rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:205 with_dependencies
  static with_dependencies(llvm_feature_name: string, dependencies: TargetFeatureFoldStrength[]): LLVMFeature {
    return new LLVMFeature(llvm_feature_name, dependencies);
  }

  /** `impl<'a> IntoIterator for LLVMFeature<'a>` (`type IntoIter = impl Iterator<Item = &'a str>`): the names, eagerly. */
  // rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:217 into_iter
  into_iter(): string[] {
    const dependencies = this.dependencies.map((feat) => TargetFeatureFoldStrength.as_str(feat));
    return [this.llvm_feature_name, ...dependencies];
  }
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
// rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:239 to_llvm_features
export function to_llvm_features(target: Target, s: string): LLVMFeature | undefined {
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

/// Used to generate cfg variables and apply features.
/// Must express features in the way Rust understands them.
///
/// We do not have to worry about RUSTC_SPECIFIC_FEATURES here, those are handled outside codegen.
// rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:325 target_config
export function target_config(sess: EarlySession): TargetConfig {
  require_inited();
  const target_features = global_llvm_features(sess, /* for_cfg */ true);

  // let triple = SmallCStr::new(&versioned_llvm_target(sess));
  // let cpu = SmallCStr::new(target_cpu(sess));
  // PORT: the `SmallCStr`s are the text, and `SmallCStr::new`'s interior-NUL panic ("The string \"..\" cannot be converted into a
  // CStr: ..") is dropped: a NUL cannot come from argv itself (`-C target-cpu`), but it can from an `@argfile` line
  // (rustc_driver_impl/src/args.rs:26-27 reads the file and splits it with `lines()`, which keeps a U+0000, so
  // `-Ctarget-cpu=a<NUL>b` reaches here) or from a target-spec JSON's `\u0000`, and no suite has either. The same drop as
  // `target_machine_factory`'s (back/write.ts) and `create_module`'s (context.ts).
  const triple = versioned_llvm_target(sess);
  const cpu = target_cpu(sess);
  const features = cstring_new_unwrap(target_features.join(","));
  const r = OwnedMCSubtargetInfo.new(triple, cpu, features);
  const mc_subtarget_info = r.$ === "Ok" ? r._0 : llvm_err(sess.dcx(), r._0);

  const internal_target_features_ = internal_target_features(
    sess,
    (feature) => {
      // to_llvm_features(&sess.target, feature).map(|f| SmallVec::<[&str; 2]>::from_iter(f.into_iter())).unwrap_or_default()
      const f = to_llvm_features(sess.target, feature);
      return f !== undefined ? f.into_iter() : [];
    },
    (feature) => {
      // This closure determines whether the target CPU has the feature according to LLVM. We
      // do *not* consider the `-Ctarget-feature`s here (that's why we passed `for_cfg: true`
      // to `global_llvm_features` above) because that will be handled later in
      // `internal_target_features`.
      const feat = to_llvm_features(sess.target, feature);
      if (feat !== undefined && mc_subtarget_info.has_features(feat)) {
        return true;
      } else {
        return false;
      }
    },
  );

  const cfg: TargetConfig = {
    internal_target_features: internal_target_features_,
    has_reliable_f16: true,
    has_reliable_f16_math: true,
    has_reliable_f16b: true,
    has_reliable_f128: true,
    has_reliable_f128_math: true,
  };

  update_target_reliable_float_cfg(sess.target, cfg);
  // `mc_subtarget_info` drops at the end of the scope (normal path only, as in `print`).
  mc_subtarget_info.drop();
  return cfg;
}

/// Determine whether or not experimental float types are reliable based on known bugs.
// rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:371 update_target_reliable_float_cfg
export function update_target_reliable_float_cfg(target: Target, cfg: TargetConfig): void {
  const target_arch = target.arch.$;
  const target_os = target.options.os.$;
  const target_endian: Endian = target.options.endian;
  const target_env = target.options.env.$;
  const target_abi = target.options.cfg_abi.$;
  const target_pointer_width = target.pointer_width;
  const version = get_version();
  const [major] = version;

  // cfg.has_reliable_f16 = match (target_arch, target_os) {
  if (target_arch === "X86_64" && target_os === "Windows" && target_env === "Gnu" && target_abi !== "Llvm") {
    // MinGW ABI bugs <https://gcc.gnu.org/bugzilla/show_bug.cgi?id=115054> resolved in GCC 16
    // but our toolchain hasn't been updated.
    cfg.has_reliable_f16 = false;
  } else {
    // `f16` support only requires that symbols converting to and from `f32` are available. We
    // provide these in `compiler-builtins`, so `f16` should be available on all platforms that
    // do not have other ABI issues or LLVM crashes.
    cfg.has_reliable_f16 = true;
  }

  // The heuristic for evaluating to true is twofold, namely;
  //
  // 1. Can LLVM compile an IR snippet containing `fpext bfloat %<var> to float`
  // 2. Does the documentation indicate `bf16` support, can be seen in the
  //    tracking issue; <https://github.com/rust-lang/rust/issues/160630>
  // cfg.has_reliable_f16b = match (target_arch, target_os) {
  if (target_arch === "Arm64EC") {
    // This is similar to <https://github.com/llvm/llvm-project/issues/94434>, however
    // does not work until LLVM 23 on Windows.
    cfg.has_reliable_f16b = major >= 23;
  } else if (target_arch === "AArch64" || target_arch === "Arm") {
    cfg.has_reliable_f16b = true;
  } else if (target_arch === "X86_64" || target_arch === "RiscV64" || target_arch === "LoongArch64") {
    // FIXME(f16b) until <https://github.com/llvm/llvm-project/issues/97896>
    // is resolved the below do not have a reliable `f16b`, on a widening
    // path a call to `__truncsfbf2` is emitted. Or when using architectural
    // extensions a non-portable narrowing instruction is emitted.
    cfg.has_reliable_f16b = false;
  } else {
    cfg.has_reliable_f16b = false;
  }

  // cfg.has_reliable_f128 = match (target_arch, target_os) {
  if (target_arch === "AmdGpu") {
    // Unsupported https://github.com/llvm/llvm-project/issues/121122
    cfg.has_reliable_f128 = false;
  } else if (target_arch === "Arm64EC" && major < 23) {
    cfg.has_reliable_f128 = false; // (fixed in llvm23)
  } else if (target_arch === "Nvptx64") {
    // Selection bug <https://github.com/llvm/llvm-project/issues/95471>. This issue is closed
    // but basic math still does not work.
    cfg.has_reliable_f128 = false;
  } else if (target_arch === "PowerPC") {
    // ABI/LLVM bugs:
    // - with +vsx <https://github.com/llvm/llvm-project/pull/216613>
    // - without +vsx <https://github.com/rust-lang/rust/issues/125109>
    cfg.has_reliable_f128 = false;
  } else if (target_arch === "PowerPC64" && target_os === "Aix") {
    // AIX does not support f128.
    cfg.has_reliable_f128 = false;
  } else if (target_arch === "PowerPC64") {
    // ABI bugs on BE without +vsx <https://github.com/rust-lang/rust/issues/125109>.
    cfg.has_reliable_f128 = cfg.internal_target_features.has(sym.vsx);
  } else if (target_arch === "X86_64" && target_os === "Windows" && target_env === "Gnu" && target_abi !== "Llvm" && major < 23) {
    // MinGW ABI bugs <https://gcc.gnu.org/bugzilla/show_bug.cgi?id=115054> (fixed in llvm23)
    cfg.has_reliable_f128 = false;
  } else {
    // There are no known problems on other platforms, so the only requirement is that symbols
    // are available. `compiler-builtins` provides all symbols required for core `f128`
    // support, so this should work for everything else.
    cfg.has_reliable_f128 = true;
  }

  // Assume that working `f16` means working `f16` math for most platforms, since
  // operations just go through `f32`.
  cfg.has_reliable_f16_math = cfg.has_reliable_f16;

  // cfg.has_reliable_f128_math = match (target_arch, target_os) { ... } && cfg.has_reliable_f128;
  let f128_math: boolean;
  // LLVM lowers `fp128` math to `long double` symbols even on platforms where
  // `long double` is not IEEE binary128. See
  // <https://github.com/llvm/llvm-project/issues/44744>.
  //
  // This rules out anything that doesn't have `long double` = `binary128`; <= 32 bits
  // (ld is `f64`), anything other than Linux (Windows and MacOS use `f64`), and `x86`
  // (ld is 80-bit extended precision).
  //
  // On big-endian powerpc the symbol selection is correct, despite __ibmf128 being
  // long double on the target, but the f128 symbols are not defined.
  //
  // musl does not implement the symbols required for f128 math at all.
  if (target_env === "Musl") {
    f128_math = false;
  } else if (target_arch === "X86_64") {
    f128_math = false;
  } else if ((target_arch === "PowerPC" || target_arch === "PowerPC64") && target_endian === "Big") {
    f128_math = false;
  } else if (target_os === "Linux" && target_pointer_width === 64) {
    f128_math = true;
  } else {
    f128_math = false;
  }
  cfg.has_reliable_f128_math = f128_math && cfg.has_reliable_f128;
}

// rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:463 print_version
export function print_version(): void {
  const [major, minor, patch] = get_version();
  std_print(`LLVM version: ${major}.${minor}.${patch}\n`);
}

/// Returns the version of LLVM that we are actually linked to at runtime.
// rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:469 get_version
export function get_version(): [number, number, number] {
  const llvm_major = { value: 0 };
  const llvm_minor = { value: 0 };
  const llvm_patch = { value: 0 };
  llvm.LLVMGetVersion(llvm_major, llvm_minor, llvm_patch);
  return [llvm_major.value, llvm_minor.value, llvm_patch.value];
}

// rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:477 print_passes
export function print_passes(): void {
  // Can be called without initializing LLVM
  // unsafe {
  llvm.LLVMRustPrintPasses();
  // }
}

/** `-> Vec<(&str, &str)>` */
// rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:484 llvm_target_features
function llvm_target_features(tm: llvm.TargetMachine): [string, string][] {
  const len = llvm.LLVMRustGetTargetFeaturesCount(tm);
  const ret: [string, string][] = [];
  for (let i = 0; i < len; i++) {
    // unsafe {
    const feature: MutRef<string | undefined> = { value: undefined };
    const desc: MutRef<string | undefined> = { value: undefined };
    llvm.LLVMRustGetTargetFeature(tm, i, feature, desc);
    if (feature.value === undefined || desc.value === undefined) {
      bug("LLVM returned a `null` target feature string");
    }
    // PORT: `CStr::from_ptr(..).to_str()`: the model's strings are JS strings, which are always valid UTF-8 text, so the
    // `bug!("LLVM returned a non-utf8 feature string: {}", e)` arms cannot be reached.
    const feature_ = feature.value;
    const desc_ = desc.value;
    ret.push([feature_, desc_]);
    // }
  }
  return ret;
}

/** `out: &mut String` */
// rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:507 print
export function print(req: PrintRequest, out: MutRef<string>, sess: Session): void {
  require_inited();
  const tm = create_informational_target_machine(sess);
  switch (req.kind) {
    case "TargetCPUs":
      print_target_cpus(sess, tm.raw(), out);
      break;
    case "TargetFeatures":
      print_target_features(sess, tm.raw(), out);
      break;
    default:
      bug(`rustc_codegen_llvm can't handle print request: ${format_debug(req, debug_PrintRequest, PLAIN)}`);
  }
  // `tm` drops at the end of the scope. PORT: on the normal path only, so that a stop above stays the one reported.
  tm.drop();
}

/** `out: &mut String` */
// rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:517 print_target_cpus
function print_target_cpus(sess: Session, tm: llvm.TargetMachine, out: MutRef<string>): void {
  const cpu_names = unwrap_result(
    llvm.build_string((s) => {
      llvm.LLVMRustPrintTargetCPUs(tm, s);
    }),
    llvm.debug_FromUtf8Error,
  );

  interface Cpu {
    cpu_name: string;
    remark: string;
  }
  // Compare CPU against current target to label the default. Do not print it if
  // `need_explicit_cpu` is set, because in that case the concept of default makes less sense.
  const target_cpu_ = handle_native(sess.target.cpu);
  const make_remark = (cpu_name: string): string => {
    if (cpu_name === target_cpu_ && !sess.target.need_explicit_cpu) {
      // FIXME(#132514): This prints the LLVM target string, which can be
      // different from the Rust target string. Is that intended?
      const target = sess.target.llvm_target;
      return ` - This is the default target CPU for the current build target (currently ${target}).`;
    } else {
      return "";
    }
  };
  const cpus: Cpu[] = str_lines(cpu_names)
    .filter((cpu_name) => !sess.target.unsupported_cpus.includes(cpu_name))
    .map((cpu_name) => ({ cpu_name, remark: make_remark(cpu_name) }));

  // Only print the "native" entry when host and target are the same arch,
  // since otherwise it could be wrong or misleading.
  // Also do not print it if `requires_consistent_cpu` is set, because in this case
  // "native" would be rejected.
  if (spec_other_eq(sess.host.arch, sess.target.arch) && !sess.target.requires_consistent_cpu) {
    const host = get_host_cpu_name();
    cpus.unshift({
      cpu_name: NATIVE_CPU,
      remark: ` - Select the CPU of the current host (currently ${host}).`,
    });
  }

  const max_name_width = cpus.reduce((m, cpu) => Math.max(m, utf8_len(cpu.cpu_name)), 0);
  out.value += "Available CPUs for this target:\n";
  for (const { cpu_name, remark } of cpus) {
    // Only pad the CPU name if there's a remark to print after it.
    const width = remark === "" ? 0 : max_name_width;
    out.value += `    ${pad_right(cpu_name, width)}${remark}\n`;
  }
}

/** `out: &mut String` */
// rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:571 print_target_features
function print_target_features(sess: Session, tm: llvm.TargetMachine, out: MutRef<string>): void {
  let llvm_target_features_ = llvm_target_features(tm);
  const known_llvm_target_features: Set<string> = new Set();
  const rustc_target_features: [string, string][] = [];
  for (const [feature, gate, _implied] of sess.target.rust_target_features()) {
    if (!Stability.in_cfg(gate)) {
      // Only list (experimentally) supported features.
      continue;
    }
    // LLVM asserts that these are sorted. LLVM and Rust both use byte comparison for these
    // strings.
    const f = to_llvm_features(sess.target, feature);
    if (f === undefined) continue;
    const llvm_feature = f.llvm_feature_name;
    let desc: string;
    const index = binary_search_by_key(llvm_target_features_, llvm_feature);
    if (index !== undefined) {
      known_llvm_target_features.add(llvm_feature);
      desc = llvm_target_features_[index]![1];
    } else {
      desc = "";
    }

    rustc_target_features.push([feature, desc]);
  }

  // Since we add this at the end ...
  rustc_target_features.push(["crt-static", "Enables C Run-time Libraries to be statically linked"]);
  // ... we need to sort the list again.
  rustc_target_features.sort((a, b) => cmp_str(a[0], b[0]) || cmp_str(a[1], b[1]));

  llvm_target_features_ = llvm_target_features_.filter(([f, _d]) => !known_llvm_target_features.has(f));

  const max_feature_len = [...llvm_target_features_, ...rustc_target_features].reduce((m, [feature]) => Math.max(m, utf8_len(feature)), 0);

  out.value += "Features supported by rustc for this target:\n";
  for (const [feature, desc] of rustc_target_features) {
    out.value += `    ${pad_right(feature, max_feature_len)} - ${desc}.\n`;
  }
  out.value += "\nCode-generation features supported by LLVM for this target:\n";
  for (const [feature, desc] of llvm_target_features_) {
    out.value += `    ${pad_right(feature, max_feature_len)} - ${desc}.\n`;
  }
  if (llvm_target_features_.length === 0) {
    out.value += "    Target features listing is not supported by this LLVM version.\n";
  }
  out.value += "\nUse +feature to enable a feature, or -feature to disable it.\n";
  out.value += "For example, rustc -C target-cpu=mycpu -C target-feature=+feature1,-feature2\n\n";
  out.value += "Code-generation features cannot be used in cfg or #[target_feature],\n";
  out.value += "and may be renamed or removed in a future version of LLVM or rustc.\n\n";
}

/// Returns the host CPU name, according to LLVM.
// rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:636 get_host_cpu_name
function get_host_cpu_name(): string {
  const len = { value: 0 };
  // SAFETY: The underlying C++ global function returns a `StringRef` that
  // isn't tied to any particular backing buffer, so it must be 'static.
  const ptr = llvm.LLVMRustGetHostCPUName(len);
  assert(ptr !== undefined, "assertion failed: !ptr.is_null()");
  const slice = ptr.subarray(0, len.value);
  const s = from_utf8(slice);
  if (s === undefined) panic("host CPU name should be UTF-8");
  return s;
}

/// If the given string is `"native"`, returns the host CPU name according to
/// LLVM. Otherwise, the string is returned as-is.
// rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:650 handle_native
function handle_native(cpu_name: string): string {
  switch (cpu_name) {
    case NATIVE_CPU:
      return get_host_cpu_name();
    default:
      return cpu_name;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:657 target_cpu
export function target_cpu(sess: EarlySession): string {
  const cpu_name = sess.opts.cg.target_cpu ?? sess.target.cpu;
  return handle_native(cpu_name);
}

/// The target features for compiler flags other than `-Ctarget-features`.
// rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:663 llvm_features_by_flags
function llvm_features_by_flags(sess: EarlySession, features: string[]): void {
  if (wants_wasm_eh(sess.target) && sess.panic_strategy() === "Unwind") {
    features.push("+exception-handling");
  }

  target_features.retpoline_features_by_flags(sess, features);
  target_features.sanitizer_features_by_flags(sess, features);

  // -Zfixed-x18
  if (sess.opts.unstable_opts.fixed_x18) {
    if (sess.target.arch.$ !== "AArch64") {
      sess.dcx().emit_fatal(FixedX18InvalidArch_diagnostic({ arch: Arch.desc(sess.target.arch) }));
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
// rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:688 global_llvm_features
export function global_llvm_features(sess: EarlySession, for_cfg: boolean): string[] {
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
  const target_cpu_opt = sess.opts.cg.target_cpu;
  if (target_cpu_opt !== undefined && target_cpu_opt === NATIVE_CPU) {
    // We have already figured out the actual CPU name with `LLVMRustGetHostCPUName` and set
    // that for LLVM, so the features implied by that CPU name will be available everywhere.
    // However, that is not sufficient: e.g. `skylake` alone is not sufficient to tell if
    // some of the instructions are available or not. So we have to also explicitly ask for
    // the exact set of features available on the host, and enable all of them.
    // unsafe {
    const ptr = llvm.LLVMGetHostCPUFeatures();
    let features_string: string;
    if (ptr !== undefined) {
      // PORT: `CStr::from_ptr(ptr).to_str()`: a JS string, always valid text (the non-utf8 `bug!` cannot be reached).
      features_string = ptr;
    } else {
      bug("could not allocate host CPU features, LLVM returned a `null` string");
    }

    llvm.LLVMDisposeMessage(ptr);
    // }
    if (features_string !== "") {
      features.push(...features_string.split(","));
    }
  } else {
    // Some(_) | None => {}
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
      // match (enable, feat) { (_, Both(f)) | (true, EnableOnly(f)) => Some(format!("{enable_disable}{f}")), _ => None }
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
        sess.dcx().emit_warn(UnknownLlvmTargetFeaturePrefix_diagnostic({ feature }));
      }
    }
  }

  return features;
}

// rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:800 tune_cpu
export function tune_cpu(sess: Session): string | undefined {
  const name = sess.opts.unstable_opts.tune_cpu;
  if (name === undefined) return undefined;
  return handle_native(name);
}

// rustc: compiler/rustc_codegen_llvm/src/llvm_util.rs:805 target_has_mnemonic
export function target_has_mnemonic(sess: Session, mnemonic: string): boolean {
  require_inited();
  const tm = create_informational_target_machine(sess);
  // let cstr = SmallCStr::new(mnemonic);
  const r = llvm.LLVMRustTargetHasMnemonic(tm.raw(), mnemonic);
  // `tm` drops at the end of the scope (normal path only, as in `print`).
  tm.drop();
  return r;
}

// ---- helpers for std forms (not upstream fns) ----

/** `(u32, u32, u32) < (u32, u32, u32)`, lexicographic. */
function version_lt(a: readonly [number, number, number], b: readonly [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
}

/** `char::is_whitespace` (Unicode `White_Space`). */
function is_whitespace(c: number): boolean {
  return (
    (c >= 0x09 && c <= 0x0d) ||
    c === 0x20 ||
    c === 0x85 ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000
  );
}

/** `str::trim`: strips `char::is_whitespace` from both ends. */
function str_trim(s: string): string {
  const cps = Array.from(s);
  let a = 0;
  let b = cps.length;
  while (a < b && is_whitespace(cps[a]!.codePointAt(0)!)) a++;
  while (b > a && is_whitespace(cps[b - 1]!.codePointAt(0)!)) b--;
  return cps.slice(a, b).join("");
}

/** `str::lines`: splits on `\n`, drops one `\r` before it, and yields no empty last line. */
function str_lines(s: string): string[] {
  if (s === "") return [];
  const parts = s.split("\n");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
}

/** `{s:<width$}`: pads with spaces to `width` chars. */
function pad_right(s: string, width: number): string {
  const n = Array.from(s).length;
  return n >= width ? s : s + " ".repeat(width - n);
}

/** `str`'s `Ord`: byte order of the UTF-8 encodings. */
function cmp_str(a: string, b: string): number {
  const x = utf8(a);
  const y = utf8(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
}

/** `slice::binary_search_by_key(&key, |(f, _d)| f).ok()`: the index of an equal key in a sorted slice, as Rust's search finds it. */
function binary_search_by_key(v: readonly (readonly [string, string])[], key: string): number | undefined {
  // core's `binary_search_by`: `size`/`base` halving, the same probes as Rust's.
  let size = v.length;
  if (size === 0) return undefined;
  let base = 0;
  while (size > 1) {
    const half = Math.floor(size / 2);
    const mid = base + half;
    const cmp = cmp_str(v[mid]![0], key);
    base = cmp > 0 ? base : mid;
    size -= half;
  }
  const cmp = cmp_str(v[base]![0], key);
  return cmp === 0 ? base : undefined;
}

/** `str::from_utf8`: the text, or `undefined` for invalid UTF-8. */
function from_utf8(b: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return undefined;
  }
}

/** `CString::new(s).unwrap()`: panics on an interior NUL byte. */
function cstring_new_unwrap(s: string): string {
  const bytes = utf8(s);
  const pos = bytes.indexOf(0);
  if (pos >= 0) panic(`called \`Result::unwrap()\` on an \`Err\` value: NulError(${pos}, [${Array.from(bytes).join(", ")}])`);
  return s;
}

/** `rustc_fs_util::path_to_c_string` (Unix: the path's bytes, `CString::new(..).unwrap()`). */
function path_to_c_string(p: PathBuf): string {
  return cstring_new_unwrap(p);
}
