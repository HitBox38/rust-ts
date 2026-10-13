//! Declares Rust's target feature names for each target.
//! Note that these are similar to but not always identical to LLVM's feature names,
//! and Rust adds some features that do not correspond to LLVM features at all.
//!
//! The target features listed here can be used in `#[target_feature]` and `#[cfg(target_feature)]`.
//! They also do not trigger any warnings when used with `-Ctarget-feature`.
//!
//! Note that even unstable (and even entirely unlisted) features can be used with `-Ctarget-feature`
//! on stable. Using a feature not on the list of Rust target features only emits a warning.
//! Only `cfg(target_feature)` and `#[target_feature]` actually do any stability gating.
//! `cfg(target_feature)` for unstable features just works on nightly without any feature gate.
//! `#[target_feature]` requires a feature gate.
//!
//! When adding features to the below lists
//! check whether they're named already elsewhere in rust
//! e.g. in stdarch and whether the given name matches LLVM's
//! if it doesn't, to_llvm_feature in llvm_util in rustc_codegen_llvm needs to be adapted.
//! Additionally, if the feature is not available in older version of LLVM supported by the current
//! rust, the same function must be updated to filter out these features to avoid triggering
//! warnings.
//!
//! Also note that all target features listed here must be purely additive: for target_feature 1.1 to
//! be sound, we can never allow features like `+soft-float` (on x86) to be controlled on a
//! per-function level, since we would then allow safe calls from functions with `+soft-float` to
//! functions without that feature!
//!
//! It is important for soundness to consider the interaction of target features and the function
//! call ABI. For example, disabling the `x87` feature on x86 changes how scalar floats are passed as
//! arguments, so letting people toggle that feature would be unsound. To this end, the
//! [`Target::abi_required_features`] function computes which target features must and must not be
//! enabled for any given target, and individual features can also be marked as [`InternalOnly`].
//! See <https://github.com/rust-lang/rust/issues/116344> for some more context.
//!
//! The one exception to features that change the ABI is features that enable larger vector
//! registers. Those are permitted to be listed here. The `*_FOR_CORRECT_VECTOR_ABI` arrays store
//! information about which target feature is ABI-required for which vector size; this is used to
//! ensure that vectors can only be passed via `extern "C"` when the right feature is enabled. (For
//! the "Rust" ABI we generally pass vectors by-ref exactly to avoid these issues.)
//! Also see <https://github.com/rust-lang/rust/issues/116558>.
//!
import { type Symbol, sym } from "../rustc_span/symbol.ts";
import { panic, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { Target as TargetClass, type Target } from "./spec/mod.ts";

/// Features that control behaviour of rustc, rather than the codegen. Not to be included in
/// `cfg(target_feature)`, `sess.internal_target_features`, or the backend's feature list.
/// These exist globally and are not in the target-specific lists below.
export const RUSTC_SPECIFIC_FEATURES: readonly string[] = ["crt-static"];

/// Stability information for target features.
// #[derive(Debug, Copy, Clone, StableHash)]
export type Stability =
  /// This target feature is stable, it can be used in `#[target_feature]` and
  /// `#[cfg(target_feature)]`.
  | { readonly $: "Stable" }
  /// This target feature is cfg-stable. It can be used for `#[cfg(target_feature)]` on stable,
  /// but using it in `#[target_feature]` requires the given nightly feature.
  | {
      readonly $: "CfgStableToggleUnstable";
      /// This must be a *language* feature, or else rustc will ICE when reporting a missing
      /// feature gate!
      readonly _0: Symbol;
    }
  /// This target feature is unstable. It is only present in `#[cfg(target_feature)]` on
  /// nightly and using it in `#[target_feature]` requires enabling the given nightly feature.
  | {
      readonly $: "Unstable";
      /// This must be a *language* feature, or else rustc will ICE when reporting a missing
      /// feature gate!
      readonly _0: Symbol;
    }
  /// This is not actually something we expose as a "target feature" to our users.
  /// We just manage it internally as a target feature since that's how LLVM represents it.
  /// This feature can not be set via `-Ctarget-feature` or `#[target_feature]`, it can only be
  /// set in the target spec. It is never set in `cfg(target_feature)`. Used in particular for
  /// features are actually ABI configuration flags (such as "soft-float" on many targets).
  ///
  /// However, "internal" target features can still sometimes be enabled or disabled via
  /// `-Ctarget-cpu` or Rust/LLVM target feature implications. Make sure nothing implies this
  /// target feature and nothing is implied by this target feature (except for other internal-only
  /// features). Ideally, ABI-relevant target features are pinned down (marked as required or
  /// incompatible) in [`Target::abi_required_features`].
  | {
      readonly $: "InternalOnly";
      readonly reason: string;
      /// True if this is always an error, false if this can be reported as a warning when set via
      /// `-Ctarget-feature` (and a hard error when set via `#[target_feature]`).
      readonly hard_error: boolean;
    };
// use Stability::*;

export const Stability = {
  Stable: Object.freeze({ $: "Stable" }) as Stability,

  /// Returns whether the feature can be used in `cfg(target_feature)` ever.
  /// (It might still be nightly-only even if this returns `true`, so make sure to also check
  /// `requires_nightly`.)
  // rustc: compiler/rustc_target/src/target_features.rs:97 in_cfg
  in_cfg(self: Stability): boolean {
    return self.$ === "Stable" || self.$ === "CfgStableToggleUnstable" || self.$ === "Unstable";
  },

  /// Returns the nightly feature that is required to toggle this target feature via
  /// `#[target_feature]`/`-Ctarget-feature` or to test it via `cfg(target_feature)`.
  /// (For `cfg` we only care whether the feature is nightly or not, we don't require
  /// the feature gate to actually be enabled when using a nightly compiler.)
  ///
  /// Before calling this, ensure the feature is even permitted for this use:
  /// - for `#[target_feature]`/`-Ctarget-feature`, check `toggle_allowed()`
  /// - for `cfg(target_feature)`, check `in_cfg()`
  ///
  /// The `in_cfg` parameter is used to determine whether it will be used in
  /// `cfg(target_feature)` (true) or `#[target_feature]`/`-Ctarget-feature` (false)
  // rustc: compiler/rustc_target/src/target_features.rs:117 requires_nightly
  requires_nightly(self: Stability, in_cfg: boolean): Symbol | undefined {
    switch (self.$) {
      case "Unstable":
        return self._0;
      case "CfgStableToggleUnstable":
        if (in_cfg) {
          return undefined;
        } else {
          return self._0;
        }
      case "Stable":
        return undefined;
      case "InternalOnly":
        return panic("internal-only features should not reach this far");
    }
  },

  /// Returns whether the feature is cfg-stable but still requires a nightly feature gate to
  /// be used in `#[target_feature]`/`-Ctarget-feature`.
  // rustc: compiler/rustc_target/src/target_features.rs:136 is_cfg_stable_toggle_unstable
  is_cfg_stable_toggle_unstable(self: Stability): boolean {
    return self.$ === "CfgStableToggleUnstable";
  },

  /// Returns whether the feature may be toggled via `#[target_feature]` or `-Ctarget-feature`.
  /// (It might still be nightly-only even if this returns `Ok(())`, so make sure to also check
  /// `requires_nightly`.)
  // rustc: compiler/rustc_target/src/target_features.rs:143 toggle_allowed
  toggle_allowed(self: Stability): Result<null, string> {
    switch (self.$) {
      case "Unstable":
      case "CfgStableToggleUnstable":
      case "Stable":
        return Ok(null);
      case "InternalOnly":
        return Err(self.reason);
    }
  },
} as const;

/// If feature A "implies" feature B, then:
/// - when A gets enabled (via `-Ctarget-feature` or `#[target_feature]`), we also enable B
/// - when B gets disabled (via `-Ctarget-feature`), we also disable A
///
/// Both of these are also applied transitively.
export type ImpliedFeatures = readonly string[];

/** `(&'static str, Stability, ImpliedFeatures)` */
export type TargetFeature = readonly [string, Stability, ImpliedFeatures];

const ARM_FEATURES: readonly TargetFeature[] = [
    // tidy-alphabetical-start
    ["aclass", { $: "Unstable", _0: sym.arm_target_feature }, []],
    ["acquire-release", { $: "Unstable", _0: sym.arm_target_feature }, []],
    ["aes", { $: "Unstable", _0: sym.arm_target_feature }, ["neon"]],
    [
        "atomics-32",
        // Not implied by any CPU model or other feature.
        { $: "InternalOnly",
            reason: "unsound because it changes the ABI of atomic operations",
            hard_error: false,
        },
        [],
    ],
    ["bf16", { $: "Unstable", _0: sym.arm_target_feature }, ["neon"]],
    ["crc", { $: "Unstable", _0: sym.arm_target_feature }, []],
    ["d32", { $: "Unstable", _0: sym.arm_target_feature }, []],
    ["dotprod", { $: "Unstable", _0: sym.arm_target_feature }, ["neon"]],
    ["dsp", { $: "Unstable", _0: sym.arm_target_feature }, []],
    ["fp-armv8", { $: "Unstable", _0: sym.arm_target_feature }, ["vfp4"]],
    ["fp16", { $: "Unstable", _0: sym.arm_target_feature }, ["neon"]],
    ["fp64", { $: "Unstable", _0: sym.arm_target_feature }, []],
    ["fpregs", { $: "Unstable", _0: sym.arm_target_feature }, []],
    ["i8mm", { $: "Unstable", _0: sym.arm_target_feature }, ["neon"]],
    ["mclass", { $: "Unstable", _0: sym.arm_target_feature }, []],
    ["mve", { $: "Unstable", _0: sym.arm_target_feature }, ["v8.1m.main", "dsp", "fpregs"]],
    ["mve.fp", { $: "Unstable", _0: sym.arm_target_feature }, ["mve"]],
    ["neon", { $: "Unstable", _0: sym.arm_target_feature }, ["vfp3"]],
    ["rclass", { $: "Unstable", _0: sym.arm_target_feature }, []],
    ["sha2", { $: "Unstable", _0: sym.arm_target_feature }, ["neon"]],
    // This can be *disabled* on non-`hf` targets to enable the use
    // of hardfloats while keeping the softfloat ABI.
    // FIXME before stabilization: Should we expose this as a `hard-float` target feature instead of
    // matching the odd negative feature LLVM uses?
    ["soft-float", { $: "Unstable", _0: sym.arm_target_feature }, []],
    // This is needed for inline assembly, but shouldn't be stabilized as-is
    // since it should be enabled per-function using #[instruction_set], not
    // #[target_feature].
    ["thumb-mode", { $: "Unstable", _0: sym.arm_target_feature }, []],
    ["thumb2", { $: "Unstable", _0: sym.arm_target_feature }, []],
    ["trustzone", { $: "Unstable", _0: sym.arm_target_feature }, []],
    ["v5te", { $: "Unstable", _0: sym.arm_target_feature }, []],
    ["v6", { $: "Unstable", _0: sym.arm_target_feature }, ["v5te"]],
    ["v6k", { $: "Unstable", _0: sym.arm_target_feature }, ["v6"]],
    ["v6m", { $: "Unstable", _0: sym.arm_target_feature }, ["v6"]],
    ["v6t2", { $: "Unstable", _0: sym.arm_target_feature }, ["v6k", "v8m", "thumb2"]],
    ["v7", { $: "Unstable", _0: sym.arm_target_feature }, ["v6t2"]],
    ["v8", { $: "Unstable", _0: sym.arm_target_feature }, ["v7", "acquire-release"]],
    ["v8.1m.main", { $: "Unstable", _0: sym.arm_target_feature }, ["v8m.main"]],
    ["v8m", { $: "Unstable", _0: sym.arm_target_feature }, ["v6m"]],
    ["v8m.main", { $: "Unstable", _0: sym.arm_target_feature }, ["v7"]],
    ["vfp2", { $: "Unstable", _0: sym.arm_target_feature }, ["vfp2sp", "fp64"]],
    ["vfp2sp", { $: "Unstable", _0: sym.arm_target_feature }, ["fpregs"]],
    ["vfp3", { $: "Unstable", _0: sym.arm_target_feature }, ["vfp2", "d32"]],
    ["vfp4", { $: "Unstable", _0: sym.arm_target_feature }, ["vfp3"]],
    ["virtualization", { $: "Unstable", _0: sym.arm_target_feature }, []],
    // tidy-alphabetical-end
];

const AARCH64_FEATURES: readonly TargetFeature[] = [
    // tidy-alphabetical-start
    // FEAT_AES & FEAT_PMULL
    ["aes", Stability.Stable, ["neon"]],
    // FEAT_BF16
    ["bf16", Stability.Stable, []],
    // FEAT_BTI
    ["bti", Stability.Stable, []],
    // FEAT_CRC
    ["crc", Stability.Stable, []],
    // FEAT_CSSC
    ["cssc", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, []],
    // FEAT_DIT
    ["dit", Stability.Stable, []],
    // FEAT_DotProd
    ["dotprod", Stability.Stable, ["neon"]],
    // FEAT_DPB
    ["dpb", Stability.Stable, []],
    // FEAT_DPB2
    ["dpb2", Stability.Stable, ["dpb"]],
    // FEAT_ECV
    ["ecv", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, []],
    // FEAT_F32MM
    ["f32mm", Stability.Stable, ["sve"]],
    // FEAT_F64MM
    ["f64mm", Stability.Stable, ["sve"]],
    // FEAT_FAMINMAX
    ["faminmax", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, []],
    // FEAT_FCMA
    ["fcma", Stability.Stable, ["neon"]],
    // FEAT_FHM
    ["fhm", Stability.Stable, ["fp16"]],
    // FEAT_FLAGM
    ["flagm", Stability.Stable, []],
    // FEAT_FLAGM2
    ["flagm2", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, []],
    // We forbid directly toggling just `fp-armv8`; it must be toggled with `neon`.
    [
        "fp-armv8",
        // Pinned down by [`Target::abi_required_features`] when needed.
        { $: "InternalOnly", reason: "Rust ties `fp-armv8` to `neon`", hard_error: false },
        [],
    ],
    // FEAT_FP8
    ["fp8", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, ["faminmax", "lut", "bf16"]],
    // FEAT_FP8DOT2
    ["fp8dot2", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, ["fp8dot4"]],
    // FEAT_FP8DOT4
    ["fp8dot4", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, ["fp8fma"]],
    // FEAT_FP8FMA
    ["fp8fma", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, ["fp8"]],
    // FEAT_FP16
    // Rust ties FP and Neon: https://github.com/rust-lang/rust/pull/91608
    ["fp16", Stability.Stable, ["neon"]],
    // FEAT_FRINTTS
    ["frintts", Stability.Stable, []],
    // FEAT_HBC
    ["hbc", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, []],
    // FEAT_I8MM
    ["i8mm", Stability.Stable, []],
    // FEAT_JSCVT
    // Rust ties FP and Neon: https://github.com/rust-lang/rust/pull/91608
    ["jsconv", Stability.Stable, ["neon"]],
    // FEAT_LOR
    ["lor", Stability.Stable, []],
    // FEAT_LSE
    ["lse", Stability.Stable, []],
    // FEAT_LSE2
    ["lse2", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, []],
    // FEAT_LSE128
    ["lse128", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, ["lse"]],
    // FEAT_LUT
    ["lut", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, []],
    // FEAT_MOPS
    ["mops", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, []],
    // FEAT_MTE & FEAT_MTE2
    ["mte", Stability.Stable, []],
    // FEAT_AdvSimd & FEAT_FP
    ["neon", Stability.Stable, []],
    // Backend option to turn atomic operations into an intrinsic call when `lse` is not known to be
    // available, so the intrinsic can do runtime LSE feature detection rather than unconditionally
    // using slower non-LSE operations. Unstable since it doesn't need to user-togglable.
    ["outline-atomics", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, []],
    // FEAT_PAUTH (address authentication)
    ["paca", Stability.Stable, []],
    // FEAT_PAUTH (generic authentication)
    ["pacg", Stability.Stable, []],
    // FEAT_PAN
    ["pan", Stability.Stable, []],
    // FEAT_PAuth_LR
    ["pauth-lr", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, []],
    // FEAT_PMUv3
    ["pmuv3", Stability.Stable, []],
    // FEAT_RNG
    ["rand", Stability.Stable, []],
    // FEAT_RAS & FEAT_RASv1p1
    ["ras", Stability.Stable, []],
    // FEAT_LRCPC
    ["rcpc", Stability.Stable, []],
    // FEAT_LRCPC2
    ["rcpc2", Stability.Stable, ["rcpc"]],
    // FEAT_LRCPC3
    ["rcpc3", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, ["rcpc2"]],
    // FEAT_RDM
    ["rdm", Stability.Stable, ["neon"]],
    [
        "reserve-x18",
        // Not implied by any CPU model or other feature; the compiler flag is a target modifier.
        { $: "InternalOnly", reason: "use `-Zfixed-x18` compiler flag instead", hard_error: false },
        [],
    ],
    // FEAT_SB
    ["sb", Stability.Stable, []],
    // FEAT_SHA1 & FEAT_SHA256
    ["sha2", Stability.Stable, ["neon"]],
    // FEAT_SHA512 & FEAT_SHA3
    ["sha3", Stability.Stable, ["sha2"]],
    // FEAT_SM3 & FEAT_SM4
    ["sm4", Stability.Stable, ["neon"]],
    // FEAT_SME
    ["sme", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, ["bf16"]],
    // FEAT_SME_B16B16
    ["sme-b16b16", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, ["bf16", "sme2", "sve-b16b16"]],
    // FEAT_SME_F8F16
    ["sme-f8f16", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, ["sme-f8f32"]],
    // FEAT_SME_F8F32
    ["sme-f8f32", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, ["sme2", "fp8"]],
    // FEAT_SME_F16F16
    ["sme-f16f16", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, ["sme2"]],
    // FEAT_SME_F64F64
    ["sme-f64f64", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, ["sme"]],
    // FEAT_SME_FA64
    ["sme-fa64", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, ["sme", "sve2"]],
    // FEAT_SME_I16I64
    ["sme-i16i64", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, ["sme"]],
    // FEAT_SME_LUTv2
    ["sme-lutv2", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, []],
    // FEAT_SME2
    ["sme2", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, ["sme"]],
    // FEAT_SME2p1
    ["sme2p1", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, ["sme2"]],
    // FEAT_SPE
    ["spe", Stability.Stable, []],
    // FEAT_SSBS & FEAT_SSBS2
    ["ssbs", Stability.Stable, []],
    // FEAT_SSVE_FP8FDOT2
    ["ssve-fp8dot2", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, ["ssve-fp8dot4"]],
    // FEAT_SSVE_FP8FDOT4
    ["ssve-fp8dot4", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, ["ssve-fp8fma"]],
    // FEAT_SSVE_FP8FMA
    ["ssve-fp8fma", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, ["sme2", "fp8"]],
    // FEAT_SVE
    // It was decided that SVE requires Neon: https://github.com/rust-lang/rust/pull/91608
    //
    // LLVM doesn't enable Neon for SVE. ARM indicates that they're separate, but probably always
    // exist together: https://developer.arm.com/documentation/102340/0100/New-features-in-SVE2
    //
    // "For backwards compatibility, Neon and VFP are required in the latest architectures."
    ["sve", Stability.Stable, ["neon", "fp16"]],
    // FEAT_SVE_B16B16 (SVE or SME Z-targeting instructions)
    ["sve-b16b16", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, ["bf16"]],
    // FEAT_SVE2
    ["sve2", Stability.Stable, ["sve"]],
    // FEAT_SVE_AES & FEAT_SVE_PMULL128
    ["sve2-aes", Stability.Stable, ["sve2", "aes"]],
    // FEAT_SVE2_BitPerm
    ["sve2-bitperm", Stability.Stable, ["sve2"]],
    // FEAT_SVE2_SHA3
    ["sve2-sha3", Stability.Stable, ["sve2", "sha3"]],
    // FEAT_SVE2_SM4
    ["sve2-sm4", Stability.Stable, ["sve2", "sm4"]],
    // FEAT_SVE2p1
    ["sve2p1", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, ["sve2"]],
    // FEAT_TME
    ["tme", Stability.Stable, []],
    [
        "v8.1a",
        { $: "Unstable", _0: sym.aarch64_ver_target_feature },
        ["crc", "lse", "rdm", "pan", "lor", "vh"],
    ],
    ["v8.2a", { $: "Unstable", _0: sym.aarch64_ver_target_feature }, ["v8.1a", "ras", "dpb"]],
    [
        "v8.3a",
        { $: "Unstable", _0: sym.aarch64_ver_target_feature },
        ["v8.2a", "rcpc", "paca", "pacg", "jsconv"],
    ],
    ["v8.4a", { $: "Unstable", _0: sym.aarch64_ver_target_feature }, ["v8.3a", "dotprod", "dit", "flagm"]],
    ["v8.5a", { $: "Unstable", _0: sym.aarch64_ver_target_feature }, ["v8.4a", "ssbs", "sb", "dpb2", "bti"]],
    ["v8.6a", { $: "Unstable", _0: sym.aarch64_ver_target_feature }, ["v8.5a", "bf16", "i8mm"]],
    ["v8.7a", { $: "Unstable", _0: sym.aarch64_ver_target_feature }, ["v8.6a", "wfxt"]],
    ["v8.8a", { $: "Unstable", _0: sym.aarch64_ver_target_feature }, ["v8.7a", "hbc", "mops"]],
    ["v8.9a", { $: "Unstable", _0: sym.aarch64_ver_target_feature }, ["v8.8a", "cssc"]],
    ["v9.1a", { $: "Unstable", _0: sym.aarch64_ver_target_feature }, ["v9a", "v8.6a"]],
    ["v9.2a", { $: "Unstable", _0: sym.aarch64_ver_target_feature }, ["v9.1a", "v8.7a"]],
    ["v9.3a", { $: "Unstable", _0: sym.aarch64_ver_target_feature }, ["v9.2a", "v8.8a"]],
    ["v9.4a", { $: "Unstable", _0: sym.aarch64_ver_target_feature }, ["v9.3a", "v8.9a"]],
    ["v9.5a", { $: "Unstable", _0: sym.aarch64_ver_target_feature }, ["v9.4a"]],
    ["v9a", { $: "Unstable", _0: sym.aarch64_ver_target_feature }, ["v8.5a"]],
    // FEAT_VHE
    ["vh", Stability.Stable, []],
    // FEAT_WFxT
    ["wfxt", { $: "Unstable", _0: sym.aarch64_unstable_target_feature }, []],
    // tidy-alphabetical-end
];

const AARCH64_TIED_FEATURES: readonly (readonly string[])[] = [
    ["paca", "pacg"], // Together these represent `pauth` in LLVM
];

const X86_FEATURES: readonly TargetFeature[] = [
    // tidy-alphabetical-start
    ["adx", Stability.Stable, []],
    ["aes", Stability.Stable, ["sse2"]],
    ["amx-avx512", { $: "Unstable", _0: sym.x86_amx_intrinsics }, ["amx-tile"]],
    ["amx-bf16", { $: "Unstable", _0: sym.x86_amx_intrinsics }, ["amx-tile"]],
    ["amx-complex", { $: "Unstable", _0: sym.x86_amx_intrinsics }, ["amx-tile"]],
    ["amx-fp8", { $: "Unstable", _0: sym.x86_amx_intrinsics }, ["amx-tile"]],
    ["amx-fp16", { $: "Unstable", _0: sym.x86_amx_intrinsics }, ["amx-tile"]],
    ["amx-int8", { $: "Unstable", _0: sym.x86_amx_intrinsics }, ["amx-tile"]],
    ["amx-movrs", { $: "Unstable", _0: sym.x86_amx_intrinsics }, ["amx-tile"]],
    ["amx-tile", { $: "Unstable", _0: sym.x86_amx_intrinsics }, []],
    ["apxf", { $: "Unstable", _0: sym.apx_target_feature }, []],
    ["avx", Stability.Stable, ["sse4.2"]],
    ["avx2", Stability.Stable, ["avx"]],
    [
        "avx10.1",
        { $: "Unstable", _0: sym.avx10_target_feature },
        [
            "avx512bf16",
            "avx512bitalg",
            "avx512bw",
            "avx512cd",
            "avx512dq",
            "avx512f",
            "avx512fp16",
            "avx512ifma",
            "avx512vbmi",
            "avx512vbmi2",
            "avx512vl",
            "avx512vnni",
            "avx512vpopcntdq",
        ],
    ],
    [
        "avx10.2",
        { $: "Unstable", _0: sym.avx10_target_feature },
        ["avx10.1", "avxvnni", "avxvnniint8", "avxvnniint16"],
    ],
    ["avx512bf16", Stability.Stable, ["avx512bw"]],
    ["avx512bitalg", Stability.Stable, ["avx512bw"]],
    ["avx512bw", Stability.Stable, ["avx512f"]],
    ["avx512cd", Stability.Stable, ["avx512f"]],
    ["avx512dq", Stability.Stable, ["avx512f"]],
    ["avx512f", Stability.Stable, ["avx2", "fma", "f16c"]],
    ["avx512fp16", Stability.Stable, ["avx512bw"]],
    ["avx512ifma", Stability.Stable, ["avx512f"]],
    ["avx512vbmi", Stability.Stable, ["avx512bw"]],
    ["avx512vbmi2", Stability.Stable, ["avx512bw"]],
    ["avx512vl", Stability.Stable, ["avx512f"]],
    ["avx512vnni", Stability.Stable, ["avx512f"]],
    ["avx512vp2intersect", Stability.Stable, ["avx512f"]],
    ["avx512vpopcntdq", Stability.Stable, ["avx512f"]],
    ["avxifma", Stability.Stable, ["avx2"]],
    ["avxneconvert", Stability.Stable, ["avx2"]],
    ["avxvnni", Stability.Stable, ["avx2"]],
    ["avxvnniint8", Stability.Stable, ["avx2"]],
    ["avxvnniint16", Stability.Stable, ["avx2"]],
    ["bmi1", Stability.Stable, []],
    ["bmi2", Stability.Stable, []],
    ["clflushopt", { $: "Unstable", _0: sym.clflushopt_target_feature }, []],
    ["cmpxchg16b", Stability.Stable, []],
    ["ermsb", { $: "Unstable", _0: sym.ermsb_target_feature }, []],
    ["f16c", Stability.Stable, ["avx"]],
    ["fma", Stability.Stable, ["avx"]],
    ["fma4", { $: "Unstable", _0: sym.fma4_target_feature }, ["avx", "sse4a"]],
    ["fxsr", Stability.Stable, []],
    ["gfni", Stability.Stable, ["sse2"]],
    ["kl", Stability.Stable, ["sse2"]],
    ["lahfsahf", { $: "Unstable", _0: sym.lahfsahf_target_feature }, []],
    ["lzcnt", Stability.Stable, []],
    ["movbe", Stability.Stable, []],
    ["movdir64b", { $: "Unstable", _0: sym.movdir64b_target_feature }, []],
    ["movdiri", { $: "Unstable", _0: sym.movdiri_target_feature }, []],
    ["movrs", { $: "Unstable", _0: sym.movrs_target_feature }, []],
    ["pclmulqdq", Stability.Stable, ["sse2"]],
    ["popcnt", Stability.Stable, []],
    ["prfchw", { $: "Unstable", _0: sym.prfchw_target_feature }, []],
    ["rdrand", Stability.Stable, []],
    ["rdseed", Stability.Stable, []],
    [
        "retpoline-external-thunk",
        // Not implied by any CPU model or other feature; the compiler flag is a target modifier.
        { $: "InternalOnly",
            reason: "use `-Zretpoline-external-thunk` compiler flag instead",
            hard_error: false,
        },
        [],
    ],
    [
        "retpoline-indirect-branches",
        // Not implied by any CPU model or other feature; the compiler flag is a target modifier.
        { $: "InternalOnly",
            reason: "use `-Zretpoline` compiler flag instead",
            hard_error: false,
        },
        [],
    ],
    [
        "retpoline-indirect-calls",
        // Not implied by any CPU model or other feature; the compiler flag is a target modifier.
        { $: "InternalOnly",
            reason: "use `-Zretpoline` compiler flag instead",
            hard_error: false,
        },
        [],
    ],
    ["rtm", { $: "Unstable", _0: sym.rtm_target_feature }, []],
    ["sha", Stability.Stable, ["sse2"]],
    ["sha512", Stability.Stable, ["avx2"]],
    ["sm3", Stability.Stable, ["avx"]],
    ["sm4", Stability.Stable, ["avx2"]],
    [
        "soft-float",
        // Pinned down by [`Target::abi_required_features`].
        { $: "InternalOnly", reason: "use a soft-float target instead", hard_error: false },
        [],
    ],
    ["sse", Stability.Stable, []],
    ["sse2", Stability.Stable, ["sse"]],
    ["sse3", Stability.Stable, ["sse2"]],
    ["sse4.1", Stability.Stable, ["ssse3"]],
    ["sse4.2", Stability.Stable, ["sse4.1"]],
    ["sse4a", Stability.Stable, ["sse3"]],
    ["ssse3", Stability.Stable, ["sse3"]],
    ["tbm", Stability.Stable, []],
    ["vaes", Stability.Stable, ["avx2", "aes"]],
    ["vpclmulqdq", Stability.Stable, ["avx", "pclmulqdq"]],
    ["widekl", Stability.Stable, ["kl"]],
    ["x87", { $: "Unstable", _0: sym.x87_target_feature }, []],
    ["xop", { $: "Unstable", _0: sym.xop_target_feature }, ["fma4", "avx", "sse4a"]],
    ["xsave", Stability.Stable, []],
    ["xsavec", Stability.Stable, ["xsave"]],
    ["xsaveopt", Stability.Stable, ["xsave"]],
    ["xsaves", Stability.Stable, ["xsave"]],
    // tidy-alphabetical-end
];

const HEXAGON_FEATURES: readonly TargetFeature[] = [
    // tidy-alphabetical-start
    ["audio", { $: "Unstable", _0: sym.hexagon_target_feature }, []],
    ["hvx", { $: "Unstable", _0: sym.hexagon_target_feature }, []],
    ["hvx-ieee-fp", { $: "Unstable", _0: sym.hexagon_target_feature }, ["hvx"]],
    ["hvx-length64b", { $: "Unstable", _0: sym.hexagon_target_feature }, ["hvx"]],
    ["hvx-length128b", { $: "Unstable", _0: sym.hexagon_target_feature }, ["hvx"]],
    ["hvx-qfloat", { $: "Unstable", _0: sym.hexagon_target_feature }, ["hvx"]],
    ["hvxv60", { $: "Unstable", _0: sym.hexagon_target_feature }, ["hvx"]],
    ["hvxv62", { $: "Unstable", _0: sym.hexagon_target_feature }, ["hvxv60"]],
    ["hvxv65", { $: "Unstable", _0: sym.hexagon_target_feature }, ["hvxv62"]],
    ["hvxv66", { $: "Unstable", _0: sym.hexagon_target_feature }, ["hvxv65", "zreg"]],
    ["hvxv67", { $: "Unstable", _0: sym.hexagon_target_feature }, ["hvxv66"]],
    ["hvxv68", { $: "Unstable", _0: sym.hexagon_target_feature }, ["hvxv67"]],
    ["hvxv69", { $: "Unstable", _0: sym.hexagon_target_feature }, ["hvxv68"]],
    ["hvxv71", { $: "Unstable", _0: sym.hexagon_target_feature }, ["hvxv69"]],
    ["hvxv73", { $: "Unstable", _0: sym.hexagon_target_feature }, ["hvxv71"]],
    ["hvxv75", { $: "Unstable", _0: sym.hexagon_target_feature }, ["hvxv73"]],
    ["hvxv79", { $: "Unstable", _0: sym.hexagon_target_feature }, ["hvxv75"]],
    ["v60", { $: "Unstable", _0: sym.hexagon_target_feature }, []],
    ["v62", { $: "Unstable", _0: sym.hexagon_target_feature }, ["v60"]],
    ["v65", { $: "Unstable", _0: sym.hexagon_target_feature }, ["v62"]],
    ["v66", { $: "Unstable", _0: sym.hexagon_target_feature }, ["v65"]],
    ["v67", { $: "Unstable", _0: sym.hexagon_target_feature }, ["v66"]],
    ["v68", { $: "Unstable", _0: sym.hexagon_target_feature }, ["v67"]],
    ["v69", { $: "Unstable", _0: sym.hexagon_target_feature }, ["v68"]],
    ["v71", { $: "Unstable", _0: sym.hexagon_target_feature }, ["v69"]],
    ["v73", { $: "Unstable", _0: sym.hexagon_target_feature }, ["v71"]],
    ["v75", { $: "Unstable", _0: sym.hexagon_target_feature }, ["v73"]],
    ["v79", { $: "Unstable", _0: sym.hexagon_target_feature }, ["v75"]],
    ["zreg", { $: "Unstable", _0: sym.hexagon_target_feature }, []],
    // tidy-alphabetical-end
];

const POWERPC_FEATURES: readonly TargetFeature[] = [
    // If you are thinking of adding "efpu2" here, please double-check that it really does not
    // affect the ABI.
    // tidy-alphabetical-start
    ["altivec", { $: "Unstable", _0: sym.powerpc_target_feature }, []],
    [
        "hard-float",
        // Pinned down by [`Target::abi_required_features`].
        { $: "InternalOnly", reason: "unsupported ABI-configuration feature", hard_error: false },
        [],
    ],
    ["msync", { $: "Unstable", _0: sym.powerpc_target_feature }, []],
    ["partword-atomics", { $: "Unstable", _0: sym.powerpc_target_feature }, []],
    ["power8-altivec", { $: "Unstable", _0: sym.powerpc_target_feature }, ["altivec"]],
    ["power8-crypto", { $: "Unstable", _0: sym.powerpc_target_feature }, ["power8-altivec"]],
    ["power8-vector", { $: "Unstable", _0: sym.powerpc_target_feature }, ["vsx", "power8-altivec"]],
    ["power9-altivec", { $: "Unstable", _0: sym.powerpc_target_feature }, ["power8-altivec"]],
    ["power9-vector", { $: "Unstable", _0: sym.powerpc_target_feature }, ["power8-vector", "power9-altivec"]],
    ["power10-vector", { $: "Unstable", _0: sym.powerpc_target_feature }, ["power9-vector"]],
    ["quadword-atomics", { $: "Unstable", _0: sym.powerpc_target_feature }, []],
    [
        "spe",
        // Pinned down by [`Target::abi_required_features`].
        { $: "InternalOnly", reason: "unsupported ABI-configuration feature", hard_error: false },
        [],
    ],
    ["vsx", { $: "Unstable", _0: sym.powerpc_target_feature }, ["altivec"]],
    // tidy-alphabetical-end
];

const MIPS_FEATURES: readonly TargetFeature[] = [
    // tidy-alphabetical-start
    ["fp64", { $: "Unstable", _0: sym.mips_target_feature }, []],
    // FIXME(#150253): msa requires either fp64 or no hard float support at all: LLVM requires fp64
    // FIXME(#150253): msa requires revision 5 or greater (mips32r5/mips64r5 in LLVM)
    ["msa", { $: "Unstable", _0: sym.mips_target_feature }, []],
    ["virt", { $: "Unstable", _0: sym.mips_target_feature }, []],
    // tidy-alphabetical-end
];

const NVPTX_FEATURES: readonly TargetFeature[] = [
    // tidy-alphabetical-start
    ["sm_70", { $: "Unstable", _0: sym.nvptx_target_feature }, []],
    ["sm_72", { $: "Unstable", _0: sym.nvptx_target_feature }, ["sm_70"]],
    ["sm_75", { $: "Unstable", _0: sym.nvptx_target_feature }, ["sm_72"]],
    ["sm_80", { $: "Unstable", _0: sym.nvptx_target_feature }, ["sm_75"]],
    ["sm_86", { $: "Unstable", _0: sym.nvptx_target_feature }, ["sm_80"]],
    ["sm_87", { $: "Unstable", _0: sym.nvptx_target_feature }, ["sm_86"]],
    ["sm_89", { $: "Unstable", _0: sym.nvptx_target_feature }, ["sm_87"]],
    ["sm_90", { $: "Unstable", _0: sym.nvptx_target_feature }, ["sm_89"]],
    ["sm_90a", { $: "Unstable", _0: sym.nvptx_target_feature }, ["sm_90"]],
    // tidy-alphabetical-end
    // tidy-alphabetical-start
    ["sm_100", { $: "Unstable", _0: sym.nvptx_target_feature }, ["sm_90"]],
    ["sm_100a", { $: "Unstable", _0: sym.nvptx_target_feature }, ["sm_100"]],
    ["sm_101", { $: "Unstable", _0: sym.nvptx_target_feature }, ["sm_100"]],
    ["sm_101a", { $: "Unstable", _0: sym.nvptx_target_feature }, ["sm_101"]],
    ["sm_120", { $: "Unstable", _0: sym.nvptx_target_feature }, ["sm_101"]],
    ["sm_120a", { $: "Unstable", _0: sym.nvptx_target_feature }, ["sm_120"]],
    // tidy-alphabetical-end
    // tidy-alphabetical-start
    ["ptx70", { $: "Unstable", _0: sym.nvptx_target_feature }, []],
    ["ptx71", { $: "Unstable", _0: sym.nvptx_target_feature }, ["ptx70"]],
    ["ptx72", { $: "Unstable", _0: sym.nvptx_target_feature }, ["ptx71"]],
    ["ptx73", { $: "Unstable", _0: sym.nvptx_target_feature }, ["ptx72"]],
    ["ptx74", { $: "Unstable", _0: sym.nvptx_target_feature }, ["ptx73"]],
    ["ptx75", { $: "Unstable", _0: sym.nvptx_target_feature }, ["ptx74"]],
    ["ptx76", { $: "Unstable", _0: sym.nvptx_target_feature }, ["ptx75"]],
    ["ptx77", { $: "Unstable", _0: sym.nvptx_target_feature }, ["ptx76"]],
    ["ptx78", { $: "Unstable", _0: sym.nvptx_target_feature }, ["ptx77"]],
    ["ptx80", { $: "Unstable", _0: sym.nvptx_target_feature }, ["ptx78"]],
    ["ptx81", { $: "Unstable", _0: sym.nvptx_target_feature }, ["ptx80"]],
    ["ptx82", { $: "Unstable", _0: sym.nvptx_target_feature }, ["ptx81"]],
    ["ptx83", { $: "Unstable", _0: sym.nvptx_target_feature }, ["ptx82"]],
    ["ptx84", { $: "Unstable", _0: sym.nvptx_target_feature }, ["ptx83"]],
    ["ptx85", { $: "Unstable", _0: sym.nvptx_target_feature }, ["ptx84"]],
    ["ptx86", { $: "Unstable", _0: sym.nvptx_target_feature }, ["ptx85"]],
    ["ptx87", { $: "Unstable", _0: sym.nvptx_target_feature }, ["ptx86"]],
    // tidy-alphabetical-end
];

const RISCV_FEATURES: readonly TargetFeature[] = [
    // tidy-alphabetical-start
    ["a", Stability.Stable, ["zaamo", "zalrsc"]],
    ["b", Stability.Stable, ["zba", "zbb", "zbs"]],
    ["c", Stability.Stable, ["zca"]],
    ["d", Stability.Stable, ["f"]],
    ["e", { $: "Unstable", _0: sym.riscv_target_feature }, []], // negative feature! needs special care.
    ["f", Stability.Stable, ["zicsr"]],
    [
        "forced-atomics",
        // Not implied by any CPU model or other feature.
        { $: "InternalOnly",
            reason: "unsound because it changes the ABI of atomic operations",
            hard_error: false,
        },
        [],
    ],
    // According to the RISC-V spec, the M ISA extension (integer multiplication/division) is supported only when the M bit
    // of the misa register is 1, while Zmmul means integer multiplication is always supported.
    //
    // The Rust/LLVM "m" target feature means something slightly different: with "m" enabled, it is assumed that integer
    // multiplication and division will always be available (M bit will be 1 in misa), so "m" implies "zmmul".
    //
    // See discussion in the PR adding Zmmul: https://github.com/rust-lang/rust/pull/162552
    ["m", Stability.Stable, ["zmmul"]],
    ["relax", { $: "Unstable", _0: sym.riscv_target_feature }, []],
    [
        "rva23u64",
        { $: "Unstable", _0: sym.riscv_target_feature },
        [
            "m",
            "a",
            "f",
            "d",
            "c",
            "b",
            "v",
            "zicsr",
            "zicntr",
            "zihpm",
            "ziccif",
            "ziccrse",
            "ziccamoa",
            "zicclsm",
            "zic64b",
            "za64rs",
            "zihintpause",
            "zba",
            "zbb",
            "zbs",
            "zicbom",
            "zicbop",
            "zicboz",
            "zfhmin",
            "zkt",
            "zvfhmin",
            "zvbb",
            "zvkt",
            "zihintntl",
            "zicond",
            "zimop",
            "zcmop",
            "zcb",
            "zfa",
            "zawrs",
            "supm",
        ],
    ],
    ["supm", { $: "Unstable", _0: sym.riscv_target_feature }, []],
    ["unaligned-scalar-mem", { $: "Unstable", _0: sym.riscv_target_feature }, []],
    ["unaligned-vector-mem", { $: "Unstable", _0: sym.riscv_target_feature }, []],
    ["v", { $: "Unstable", _0: sym.riscv_target_feature }, ["zvl128b", "zve64d"]],
    ["za64rs", Stability.Stable, ["za128rs"]], // Za64rs ⊃ Za128rs
    ["za128rs", Stability.Stable, []],
    ["zaamo", Stability.Stable, []],
    ["zabha", Stability.Stable, ["zaamo"]],
    ["zacas", Stability.Stable, ["zaamo"]],
    ["zalrsc", Stability.Stable, []],
    ["zama16b", Stability.Stable, []],
    ["zawrs", Stability.Stable, []],
    ["zba", Stability.Stable, []],
    ["zbb", Stability.Stable, []],
    ["zbc", Stability.Stable, ["zbkc"]], // Zbc ⊃ Zbkc
    ["zbkb", Stability.Stable, []],
    ["zbkc", Stability.Stable, []],
    ["zbkx", Stability.Stable, []],
    ["zbs", Stability.Stable, []],
    ["zca", Stability.Stable, []],
    ["zcb", Stability.Stable, ["zca"]],
    ["zcmop", Stability.Stable, ["zca"]],
    ["zdinx", { $: "Unstable", _0: sym.riscv_target_feature }, ["zfinx"]],
    ["zfa", { $: "Unstable", _0: sym.riscv_target_feature }, ["f"]],
    ["zfbfmin", { $: "Unstable", _0: sym.riscv_target_feature }, ["f"]], // and a subset of Zfhmin
    ["zfh", { $: "Unstable", _0: sym.riscv_target_feature }, ["zfhmin"]],
    ["zfhmin", { $: "Unstable", _0: sym.riscv_target_feature }, ["f"]],
    ["zfinx", { $: "Unstable", _0: sym.riscv_target_feature }, ["zicsr"]],
    ["zhinx", { $: "Unstable", _0: sym.riscv_target_feature }, ["zhinxmin"]],
    ["zhinxmin", { $: "Unstable", _0: sym.riscv_target_feature }, ["zfinx"]],
    ["zic64b", Stability.Stable, []],
    ["zicbom", Stability.Stable, []],
    ["zicbop", Stability.Stable, []],
    ["zicboz", Stability.Stable, []],
    ["ziccamoa", Stability.Stable, []],
    ["ziccif", Stability.Stable, []],
    ["zicclsm", Stability.Stable, []],
    ["ziccrse", Stability.Stable, []],
    ["zicntr", Stability.Stable, ["zicsr"]],
    ["zicond", Stability.Stable, []],
    ["zicsr", Stability.Stable, []],
    ["zifencei", Stability.Stable, []],
    ["zihintntl", Stability.Stable, []],
    ["zihintpause", Stability.Stable, []],
    ["zihpm", Stability.Stable, ["zicsr"]],
    ["zimop", Stability.Stable, []],
    ["zk", Stability.Stable, ["zkn", "zkr", "zkt"]],
    ["zkn", Stability.Stable, ["zbkb", "zbkc", "zbkx", "zkne", "zknd", "zknh"]],
    ["zknd", Stability.Stable, ["zkne_or_zknd"]],
    ["zkne", Stability.Stable, ["zkne_or_zknd"]],
    ["zkne_or_zknd", { $: "Unstable", _0: sym.riscv_target_feature }, []], // Not an extension
    ["zknh", Stability.Stable, []],
    ["zkr", Stability.Stable, []],
    ["zks", Stability.Stable, ["zbkb", "zbkc", "zbkx", "zksed", "zksh"]],
    ["zksed", Stability.Stable, []],
    ["zksh", Stability.Stable, []],
    ["zkt", Stability.Stable, []],
    ["zmmul", { $: "Unstable", _0: sym.riscv_target_feature }, []],
    ["ztso", Stability.Stable, []],
    ["zvbb", { $: "Unstable", _0: sym.riscv_target_feature }, ["zvkb"]], // Zvbb ⊃ Zvkb
    ["zvbc", { $: "Unstable", _0: sym.riscv_target_feature }, ["zve64x"]],
    ["zve32f", { $: "Unstable", _0: sym.riscv_target_feature }, ["zve32x", "f"]],
    ["zve32x", { $: "Unstable", _0: sym.riscv_target_feature }, ["zvl32b", "zicsr"]],
    ["zve64d", { $: "Unstable", _0: sym.riscv_target_feature }, ["zve64f", "d"]],
    ["zve64f", { $: "Unstable", _0: sym.riscv_target_feature }, ["zve32f", "zve64x"]],
    ["zve64x", { $: "Unstable", _0: sym.riscv_target_feature }, ["zve32x", "zvl64b"]],
    ["zvfbfmin", { $: "Unstable", _0: sym.riscv_target_feature }, ["zve32f"]],
    ["zvfbfwma", { $: "Unstable", _0: sym.riscv_target_feature }, ["zfbfmin", "zvfbfmin"]],
    ["zvfh", { $: "Unstable", _0: sym.riscv_target_feature }, ["zvfhmin", "zve32f", "zfhmin"]], // Zvfh ⊃ Zvfhmin
    ["zvfhmin", { $: "Unstable", _0: sym.riscv_target_feature }, ["zve32f"]],
    ["zvkb", { $: "Unstable", _0: sym.riscv_target_feature }, ["zve32x"]],
    ["zvkg", { $: "Unstable", _0: sym.riscv_target_feature }, ["zve32x"]],
    ["zvkn", { $: "Unstable", _0: sym.riscv_target_feature }, ["zvkned", "zvknhb", "zvkb", "zvkt"]],
    ["zvknc", { $: "Unstable", _0: sym.riscv_target_feature }, ["zvkn", "zvbc"]],
    ["zvkned", { $: "Unstable", _0: sym.riscv_target_feature }, ["zve32x"]],
    ["zvkng", { $: "Unstable", _0: sym.riscv_target_feature }, ["zvkn", "zvkg"]],
    ["zvknha", { $: "Unstable", _0: sym.riscv_target_feature }, ["zve32x"]],
    ["zvknhb", { $: "Unstable", _0: sym.riscv_target_feature }, ["zvknha", "zve64x"]], // Zvknhb ⊃ Zvknha
    ["zvks", { $: "Unstable", _0: sym.riscv_target_feature }, ["zvksed", "zvksh", "zvkb", "zvkt"]],
    ["zvksc", { $: "Unstable", _0: sym.riscv_target_feature }, ["zvks", "zvbc"]],
    ["zvksed", { $: "Unstable", _0: sym.riscv_target_feature }, ["zve32x"]],
    ["zvksg", { $: "Unstable", _0: sym.riscv_target_feature }, ["zvks", "zvkg"]],
    ["zvksh", { $: "Unstable", _0: sym.riscv_target_feature }, ["zve32x"]],
    ["zvkt", { $: "Unstable", _0: sym.riscv_target_feature }, []],
    ["zvl32b", { $: "Unstable", _0: sym.riscv_target_feature }, []],
    ["zvl64b", { $: "Unstable", _0: sym.riscv_target_feature }, ["zvl32b"]],
    ["zvl128b", { $: "Unstable", _0: sym.riscv_target_feature }, ["zvl64b"]],
    ["zvl256b", { $: "Unstable", _0: sym.riscv_target_feature }, ["zvl128b"]],
    ["zvl512b", { $: "Unstable", _0: sym.riscv_target_feature }, ["zvl256b"]],
    ["zvl1024b", { $: "Unstable", _0: sym.riscv_target_feature }, ["zvl512b"]],
    ["zvl2048b", { $: "Unstable", _0: sym.riscv_target_feature }, ["zvl1024b"]],
    ["zvl4096b", { $: "Unstable", _0: sym.riscv_target_feature }, ["zvl2048b"]],
    ["zvl8192b", { $: "Unstable", _0: sym.riscv_target_feature }, ["zvl4096b"]],
    ["zvl16384b", { $: "Unstable", _0: sym.riscv_target_feature }, ["zvl8192b"]],
    ["zvl32768b", { $: "Unstable", _0: sym.riscv_target_feature }, ["zvl16384b"]],
    ["zvl65536b", { $: "Unstable", _0: sym.riscv_target_feature }, ["zvl32768b"]],
    // tidy-alphabetical-end
];

const WASM_FEATURES: readonly TargetFeature[] = [
    // tidy-alphabetical-start
    ["atomics", { $: "Unstable", _0: sym.wasm_target_feature }, []],
    ["bulk-memory", Stability.Stable, []],
    ["exception-handling", { $: "Unstable", _0: sym.wasm_target_feature }, []],
    ["extended-const", Stability.Stable, []],
    ["gc", { $: "Unstable", _0: sym.wasm_target_feature }, ["reference-types"]],
    ["multivalue", Stability.Stable, []],
    ["mutable-globals", Stability.Stable, []],
    ["nontrapping-fptoint", Stability.Stable, []],
    ["reference-types", Stability.Stable, []],
    ["relaxed-simd", Stability.Stable, ["simd128"]],
    ["sign-ext", Stability.Stable, []],
    ["simd128", Stability.Stable, []],
    ["tail-call", Stability.Stable, []],
    ["wide-arithmetic", Stability.Stable, []],
    // tidy-alphabetical-end
];

const BPF_FEATURES: readonly TargetFeature[] = [
    ["alu32", { $: "Unstable", _0: sym.bpf_target_feature }, []],
    ["allows-misaligned-mem-access", { $: "Unstable", _0: sym.bpf_target_feature }, []],
];

const CSKY_FEATURES: readonly TargetFeature[] = [
    // tidy-alphabetical-start
    ["2e3", { $: "Unstable", _0: sym.csky_target_feature }, ["e2"]],
    ["3e3r1", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["3e3r2", { $: "Unstable", _0: sym.csky_target_feature }, ["3e3r1", "doloop"]],
    ["3e3r3", { $: "Unstable", _0: sym.csky_target_feature }, ["doloop"]],
    ["3e7", { $: "Unstable", _0: sym.csky_target_feature }, ["2e3"]],
    ["7e10", { $: "Unstable", _0: sym.csky_target_feature }, ["3e7"]],
    ["10e60", { $: "Unstable", _0: sym.csky_target_feature }, ["7e10"]],
    ["cache", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["doloop", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["dsp1e2", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["dspe60", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["e1", { $: "Unstable", _0: sym.csky_target_feature }, ["elrw"]],
    ["e2", { $: "Unstable", _0: sym.csky_target_feature }, ["e2"]],
    ["edsp", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["elrw", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["float1e2", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["float1e3", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["float3e4", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["float7e60", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["floate1", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["hard-tp", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["high-registers", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["hwdiv", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["mp", { $: "Unstable", _0: sym.csky_target_feature }, ["2e3"]],
    ["mp1e2", { $: "Unstable", _0: sym.csky_target_feature }, ["3e7"]],
    ["nvic", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["trust", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["vdsp2e60f", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["vdspv1", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["vdspv2", { $: "Unstable", _0: sym.csky_target_feature }, []],
    // tidy-alphabetical-end
    //fpu
    // tidy-alphabetical-start
    ["fdivdu", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["fpuv2_df", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["fpuv2_sf", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["fpuv3_df", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["fpuv3_hf", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["fpuv3_hi", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["fpuv3_sf", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["hard-float", { $: "Unstable", _0: sym.csky_target_feature }, []],
    ["hard-float-abi", { $: "Unstable", _0: sym.csky_target_feature }, []],
    // tidy-alphabetical-end
];

const LOONGARCH_FEATURES: readonly TargetFeature[] = [
    // tidy-alphabetical-start
    ["32s", { $: "Unstable", _0: sym.loongarch_target_feature }, []],
    ["d", Stability.Stable, ["f"]],
    ["div32", Stability.Stable, []],
    ["f", Stability.Stable, []],
    ["frecipe", Stability.Stable, []],
    ["lam-bh", Stability.Stable, []],
    ["lamcas", Stability.Stable, []],
    ["lasx", Stability.Stable, ["lsx"]],
    ["lbt", Stability.Stable, []],
    ["ld-seq-sa", Stability.Stable, []],
    ["lsx", Stability.Stable, ["d"]],
    ["lvz", Stability.Stable, []],
    ["relax", { $: "Unstable", _0: sym.loongarch_target_feature }, []],
    ["scq", Stability.Stable, []],
    ["ual", { $: "Unstable", _0: sym.loongarch_target_feature }, []],
    // tidy-alphabetical-end
];

// #[rustfmt::skip]
const IBMZ_FEATURES: readonly TargetFeature[] = [
    // tidy-alphabetical-start
    // For "backchain", https://github.com/rust-lang/rust/issues/142412 is a stabilization blocker
    ["backchain", { $: "Unstable", _0: sym.s390x_target_feature }, []],
    ["concurrent-functions", { $: "Unstable", _0: sym.s390x_target_feature }, []],
    ["deflate-conversion", { $: "Unstable", _0: sym.s390x_target_feature }, []],
    ["enhanced-sort", { $: "Unstable", _0: sym.s390x_target_feature }, []],
    ["guarded-storage", { $: "Unstable", _0: sym.s390x_target_feature }, []],
    ["high-word", { $: "Unstable", _0: sym.s390x_target_feature }, []],
    // LLVM does not define message-security-assist-extension versions 1, 2, 6, 10 and 11.
    ["message-security-assist-extension3", { $: "Unstable", _0: sym.s390x_target_feature }, []],
    ["message-security-assist-extension4", { $: "Unstable", _0: sym.s390x_target_feature }, []],
    ["message-security-assist-extension5", { $: "Unstable", _0: sym.s390x_target_feature }, []],
    ["message-security-assist-extension8", { $: "Unstable", _0: sym.s390x_target_feature }, ["message-security-assist-extension3"]],
    ["message-security-assist-extension9", { $: "Unstable", _0: sym.s390x_target_feature }, ["message-security-assist-extension3", "message-security-assist-extension4"]],
    ["message-security-assist-extension12", { $: "Unstable", _0: sym.s390x_target_feature }, []],
    ["miscellaneous-extensions-2", Stability.Stable, []],
    ["miscellaneous-extensions-3", Stability.Stable, []],
    ["miscellaneous-extensions-4", Stability.Stable, []],
    ["nnp-assist", Stability.Stable, ["vector"]],
    // Pinned down by [`Target::abi_required_features`].
    ["soft-float", { $: "InternalOnly", reason: "unsupported ABI-configuration feature", hard_error: false }, []],
    ["transactional-execution", { $: "Unstable", _0: sym.s390x_target_feature }, []],
    ["vector", Stability.Stable, []],
    ["vector-enhancements-1", Stability.Stable, ["vector"]],
    ["vector-enhancements-2", Stability.Stable, ["vector-enhancements-1"]],
    ["vector-enhancements-3", Stability.Stable, ["vector-enhancements-2"]],
    ["vector-packed-decimal", Stability.Stable, ["vector"]],
    ["vector-packed-decimal-enhancement", Stability.Stable, ["vector-packed-decimal"]],
    ["vector-packed-decimal-enhancement-2", Stability.Stable, ["vector-packed-decimal-enhancement"]],
    ["vector-packed-decimal-enhancement-3", Stability.Stable, ["vector-packed-decimal-enhancement-2"]],
    // tidy-alphabetical-end
];

const SPARC_FEATURES: readonly TargetFeature[] = [
    // tidy-alphabetical-start
    ["leoncasa", { $: "Unstable", _0: sym.sparc_target_feature }, []],
    [
        "soft-float",
        { $: "InternalOnly", reason: "unsupported ABI-configuration feature", hard_error: false },
        [],
    ],
    ["v8plus", { $: "Unstable", _0: sym.sparc_target_feature }, []],
    // FIXME: It's unclear what this feature means when `v8plus` is disabled on 32-bit SPARC. See
    // the discussion around https://github.com/rust-lang/rust/pull/160949#discussion_r3806194355.
    ["v9", { $: "Unstable", _0: sym.sparc_target_feature }, []],
    // tidy-alphabetical-end
];

const M68K_FEATURES: readonly TargetFeature[] = [
    // tidy-alphabetical-start
    ["isa-68000", { $: "Unstable", _0: sym.m68k_target_feature }, []],
    ["isa-68010", { $: "Unstable", _0: sym.m68k_target_feature }, ["isa-68000"]],
    ["isa-68020", { $: "Unstable", _0: sym.m68k_target_feature }, ["isa-68010"]],
    ["isa-68030", { $: "Unstable", _0: sym.m68k_target_feature }, ["isa-68020"]],
    ["isa-68040", { $: "Unstable", _0: sym.m68k_target_feature }, ["isa-68030", "isa-68882"]],
    ["isa-68060", { $: "Unstable", _0: sym.m68k_target_feature }, ["isa-68040"]],
    // FPU
    ["isa-68881", { $: "Unstable", _0: sym.m68k_target_feature }, []],
    ["isa-68882", { $: "Unstable", _0: sym.m68k_target_feature }, ["isa-68881"]],
    // tidy-alphabetical-end
];

const AVR_FEATURES: readonly TargetFeature[] = [
    // tidy-alphabetical-start
    ["addsubiw", { $: "Unstable", _0: sym.avr_target_feature }, []],
    ["break", { $: "Unstable", _0: sym.avr_target_feature }, []],
    ["eijmpcall", { $: "Unstable", _0: sym.avr_target_feature }, []],
    ["elpm", { $: "Unstable", _0: sym.avr_target_feature }, []],
    ["elpmx", { $: "Unstable", _0: sym.avr_target_feature }, []],
    ["ijmpcall", { $: "Unstable", _0: sym.avr_target_feature }, []],
    ["jmpcall", { $: "Unstable", _0: sym.avr_target_feature }, []],
    ["lowbytefirst", { $: "Unstable", _0: sym.avr_target_feature }, []],
    ["lpm", { $: "Unstable", _0: sym.avr_target_feature }, []],
    ["lpmx", { $: "Unstable", _0: sym.avr_target_feature }, []],
    ["movw", { $: "Unstable", _0: sym.avr_target_feature }, []],
    ["mul", { $: "Unstable", _0: sym.avr_target_feature }, []],
    ["rmw", { $: "Unstable", _0: sym.avr_target_feature }, []],
    ["spm", { $: "Unstable", _0: sym.avr_target_feature }, []],
    ["spmx", { $: "Unstable", _0: sym.avr_target_feature }, []],
    [
        "sram",
        // Pinned down by [`Target::abi_required_features`].
        { $: "InternalOnly", reason: "devices that have no SRAM are unsupported", hard_error: false },
        [],
    ],
    ["tinyencoding", { $: "Unstable", _0: sym.avr_target_feature }, []],
    // tidy-alphabetical-end
];

const XTENSA_FEATURES: readonly TargetFeature[] = [
    ["bool", { $: "Unstable", _0: sym.xtensa_target_feature }, []],
    ["fp", { $: "Unstable", _0: sym.xtensa_target_feature }, ["bool", "coprocessor"]],
    ["coprocessor", { $: "Unstable", _0: sym.xtensa_target_feature }, []],
    ["highpriinterrupts", { $: "Unstable", _0: sym.xtensa_target_feature }, ["interrupt"]],
    ["interrupt", { $: "Unstable", _0: sym.xtensa_target_feature }, ["exception"]],
    [
        "windowed",
        // Pinned down by [`Target::abi_required_features`].
        { $: "InternalOnly",
            reason: "windowed changes the Xtensa calling convention",
            hard_error: false,
        },
        ["exception"],
    ],
    ["loop", { $: "Unstable", _0: sym.xtensa_target_feature }, []],
    ["sext", { $: "Unstable", _0: sym.xtensa_target_feature }, []],
    ["nsa", { $: "Unstable", _0: sym.xtensa_target_feature }, []],
    ["mul32", { $: "Unstable", _0: sym.xtensa_target_feature }, []],
    ["mul32high", { $: "Unstable", _0: sym.xtensa_target_feature }, ["mul32"]],
    ["div32", { $: "Unstable", _0: sym.xtensa_target_feature }, []],
    ["mac16", { $: "Unstable", _0: sym.xtensa_target_feature }, []],
    ["s32c1i", { $: "Unstable", _0: sym.xtensa_target_feature }, []],
    ["threadptr", { $: "Unstable", _0: sym.xtensa_target_feature }, []],
    ["extendedl32r", { $: "Unstable", _0: sym.xtensa_target_feature }, []],
    ["debug", { $: "Unstable", _0: sym.xtensa_target_feature }, ["exception"]],
    ["exception", { $: "Unstable", _0: sym.xtensa_target_feature }, []],
    ["rvector", { $: "Unstable", _0: sym.xtensa_target_feature }, ["exception"]],
    ["prid", { $: "Unstable", _0: sym.xtensa_target_feature }, []],
    ["regprotect", { $: "Unstable", _0: sym.xtensa_target_feature }, []],
    ["miscsr", { $: "Unstable", _0: sym.xtensa_target_feature }, []],
];

/// When rustdoc is running, provide a list of all known features so that all their respective
/// primitives may be documented.
///
/// IMPORTANT: If you're adding another feature list above, make sure to add it to this iterator!
// rustc: compiler/rustc_target/src/target_features.rs:1067 all_rust_features
export function all_rust_features(): [string, Stability][] {
  return [
    ARM_FEATURES,
    AARCH64_FEATURES,
    X86_FEATURES,
    HEXAGON_FEATURES,
    POWERPC_FEATURES,
    MIPS_FEATURES,
    NVPTX_FEATURES,
    RISCV_FEATURES,
    WASM_FEATURES,
    BPF_FEATURES,
    XTENSA_FEATURES,
    CSKY_FEATURES,
    LOONGARCH_FEATURES,
    IBMZ_FEATURES,
    SPARC_FEATURES,
    M68K_FEATURES,
    AVR_FEATURES,
  ]
    .flat()
    .map(([f, s]) => [f, s]);
}

/// Find which target architectures a feature belongs to.
/// Returns arch display names for all targets where this feature name appears.
/// Returns empty vec if feature unknown on any target.
// rustc: compiler/rustc_target/src/target_features.rs:1095 feature_to_arch_names
export function feature_to_arch_names(feature: string): string[] {
  const arches: string[] = [];
  // macro_rules! check_arch_feats
  const check_arch_feats = (arch_name: string, feats: readonly TargetFeature[]): void => {
    if (feats.some(([f]) => f === feature)) {
      arches.push(arch_name);
    }
  };
  check_arch_feats("arm", ARM_FEATURES);
  check_arch_feats("aarch64", AARCH64_FEATURES);
  check_arch_feats("x86", X86_FEATURES);
  check_arch_feats("hexagon", HEXAGON_FEATURES);
  check_arch_feats("mips", MIPS_FEATURES);
  check_arch_feats("nvptx64", NVPTX_FEATURES);
  check_arch_feats("powerpc", POWERPC_FEATURES);
  check_arch_feats("riscv", RISCV_FEATURES);
  check_arch_feats("wasm", WASM_FEATURES);
  check_arch_feats("bpf", BPF_FEATURES);
  check_arch_feats("csky", CSKY_FEATURES);
  check_arch_feats("loongarch", LOONGARCH_FEATURES);
  check_arch_feats("s390x", IBMZ_FEATURES);
  check_arch_feats("sparc", SPARC_FEATURES);
  check_arch_feats("m68k", M68K_FEATURES);
  check_arch_feats("avr", AVR_FEATURES);
  // `sort` + `dedup` (ASCII names: code unit order is byte order)
  arches.sort();
  return arches.filter((a, i) => i === 0 || arches[i - 1] !== a);
}

// These arrays represent the least-constraining feature that is required for vector types up to a
// certain size to have their "proper" ABI on each architecture. An empty feature name means
// that the given length is unconditionally available.
// Note that they must be kept sorted by vector size.
const X86_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI: readonly (readonly [number, string])[] = [
  [128, "sse"],
  [256, "avx"],
  [512, "avx512f"],
]; // FIXME: might need changes for AVX10.
const AARCH64_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI: readonly (readonly [number, string])[] = [[128, "neon"]];

const ARM_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI: readonly (readonly [number, string])[] = [
  [128, "neon"],
  [128, "mve"],
];

const AMDGPU_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI: readonly (readonly [number, string])[] = [[1024, ""]];
const POWERPC_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI: readonly (readonly [number, string])[] = [[128, "altivec"]];
const WASM_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI: readonly (readonly [number, string])[] = [[128, "simd128"]];
const S390X_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI: readonly (readonly [number, string])[] = [[128, "vector"]];
const RISCV_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI: readonly (readonly [number, string])[] = [
  [32, "zvl32b"],
  [64, "zvl64b"],
  [128, "zvl128b"],
  [256, "zvl256b"],
  [512, "zvl512b"],
  [1024, "zvl1024b"],
  [2048, "zvl2048b"],
  [4096, "zvl4096b"],
  [8192, "zvl8192b"],
  [16384, "zvl16384b"],
  [32768, "zvl32768b"],
  [65536, "zvl65536b"],
];
// Always error on SPARC, as the necessary target features cannot be enabled in Rust at the moment.
const SPARC_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI: readonly (readonly [number, string])[] = [
  /*(64, "vis")*/
];

const HEXAGON_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI: readonly (readonly [number, string])[] = [
  [512, "hvx-length64b"], // HvxVector in 64-byte mode
  [1024, "hvx-length128b"], // HvxVector in 128-byte mode, or HvxVectorPair in 64-byte mode
  [2048, "hvx-length128b"], // HvxVectorPair in 128-byte mode
];
const MIPS_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI: readonly (readonly [number, string])[] = [[128, "msa"]];
const CSKY_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI: readonly (readonly [number, string])[] = [[128, "vdspv1"]];
const LOONGARCH_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI: readonly (readonly [number, string])[] = [
  [128, "lsx"],
  [256, "lasx"],
];

// #[derive(Copy, Clone, Debug)]
export interface FeatureConstraints {
  /// Features that must be enabled.
  readonly required: readonly string[];
  /// Features that must be disabled.
  readonly incompatible: readonly string[];
}

// ---- `impl Target` (target_features.rs:1183) ----
declare module "./spec/mod.ts" {
  interface Target {
    rust_target_features(): readonly TargetFeature[];
    rust_target_features_map(): Map<string, [Stability, ImpliedFeatures]>;
    features_for_correct_fixed_length_vector_abi(): readonly (readonly [number, string])[];
    features_for_correct_scalable_vector_abi(): string | undefined;
    tied_target_features(): readonly (readonly string[])[];
    implied_target_features(base_feature: string, target_features_map: ReadonlyMap<string, [Stability, ImpliedFeatures]>): Set<string>;
    abi_required_features(): FeatureConstraints;
  }
}

// rustc: compiler/rustc_target/src/target_features.rs:1184 rust_target_features
TargetClass.prototype.rust_target_features = function (this: Target): readonly TargetFeature[] {
  switch (this.arch.$) {
    case "Arm":
      return ARM_FEATURES;
    case "AArch64":
    case "Arm64EC":
      return AARCH64_FEATURES;
    case "X86":
    case "X86_64":
      return X86_FEATURES;
    case "Hexagon":
      return HEXAGON_FEATURES;
    case "Mips":
    case "Mips32r6":
    case "Mips64":
    case "Mips64r6":
      return MIPS_FEATURES;
    case "Nvptx64":
      return NVPTX_FEATURES;
    case "PowerPC":
    case "PowerPC64":
      return POWERPC_FEATURES;
    case "RiscV32":
    case "RiscV64":
      return RISCV_FEATURES;
    case "Wasm32":
    case "Wasm64":
      return WASM_FEATURES;
    case "Bpf":
      return BPF_FEATURES;
    case "CSky":
      return CSKY_FEATURES;
    case "LoongArch32":
    case "LoongArch64":
      return LOONGARCH_FEATURES;
    case "S390x":
      return IBMZ_FEATURES;
    case "Sparc":
    case "Sparc64":
      return SPARC_FEATURES;
    case "M68k":
      return M68K_FEATURES;
    case "Avr":
      return AVR_FEATURES;
    case "Xtensa":
      return XTENSA_FEATURES;
    case "AmdGpu":
    case "Msp430":
    case "SpirV":
    case "Other":
      return [];
  }
};

/// Computes a map mapping each Rust target feature to the features it implies.
// rustc: compiler/rustc_target/src/target_features.rs:1208 rust_target_features_map
TargetClass.prototype.rust_target_features_map = function (this: Target): Map<string, [Stability, ImpliedFeatures]> {
  return new Map(this.rust_target_features().map(([f, s, i]) => [f, [s, i]]));
};

// rustc: compiler/rustc_target/src/target_features.rs:1217 features_for_correct_fixed_length_vector_abi
TargetClass.prototype.features_for_correct_fixed_length_vector_abi = function (this: Target): readonly (readonly [number, string])[] {
  switch (this.arch.$) {
    case "X86":
    case "X86_64":
      return X86_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI;
    case "AArch64":
    case "Arm64EC":
      return AARCH64_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI;
    case "Arm":
      return ARM_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI;
    case "PowerPC":
    case "PowerPC64":
      return POWERPC_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI;
    case "LoongArch32":
    case "LoongArch64":
      return LOONGARCH_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI;
    case "RiscV32":
    case "RiscV64":
      return RISCV_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI;
    case "Wasm32":
    case "Wasm64":
      return WASM_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI;
    case "S390x":
      return S390X_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI;
    case "Sparc":
    case "Sparc64":
      return SPARC_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI;
    case "Hexagon":
      return HEXAGON_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI;
    case "Mips":
    case "Mips32r6":
    case "Mips64":
    case "Mips64r6":
      return MIPS_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI;
    case "AmdGpu":
      return AMDGPU_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI;
    case "Nvptx64":
    case "Bpf":
    case "M68k":
    case "Avr":
      return []; // no vector ABI
    case "CSky":
      return CSKY_FEATURES_FOR_CORRECT_FIXED_LENGTH_VECTOR_ABI;
    // FIXME: for some tier3 targets, we are overly cautious and always give warnings
    // when passing args in vector registers.
    case "Msp430":
    case "SpirV":
    case "Xtensa":
    case "Other":
      return [];
  }
};

// rustc: compiler/rustc_target/src/target_features.rs:1243 features_for_correct_scalable_vector_abi
TargetClass.prototype.features_for_correct_scalable_vector_abi = function (this: Target): string | undefined {
  switch (this.arch.$) {
    case "AArch64":
    case "Arm64EC":
      return "sve";
    // Other targets have no scalable vectors or they are unimplemented.
    default:
      return undefined;
  }
};

// rustc: compiler/rustc_target/src/target_features.rs:1251 tied_target_features
TargetClass.prototype.tied_target_features = function (this: Target): readonly (readonly string[])[] {
  switch (this.arch.$) {
    case "AArch64":
    case "Arm64EC":
      return AARCH64_TIED_FEATURES;
    default:
      return [];
  }
};

/// Note: the returned set includes `base_feature`.
// #[track_caller]
// rustc: compiler/rustc_target/src/target_features.rs:1260 implied_target_features
TargetClass.prototype.implied_target_features = function (
  this: Target,
  base_feature: string,
  target_features_map: ReadonlyMap<string, [Stability, ImpliedFeatures]>,
): Set<string> {
  // Implied target features have their own implied target features, so we traverse the
  // map until there are no more features to add.
  const features = new Set<string>();
  const new_features = [base_feature];
  let new_feature: string | undefined;
  while ((new_feature = new_features.pop()) !== undefined) {
    if (!features.has(new_feature)) {
      features.add(new_feature);
      const entry = target_features_map.get(new_feature);
      if (entry === undefined) panic(`encountered non-Rust target feature ${new_feature}`);
      const [, implied_features] = entry;
      new_features.push(...implied_features);
    }
  }
  return features;
};

/// Returns two lists of features:
/// the first list contains target features that must be enabled for ABI reasons,
/// and the second list contains target feature that must be disabled for ABI reasons.
///
/// These features are checked against the target features reported by LLVM based on
/// `-Ctarget-cpu` and `-Ctarget-features`. Constraint violations result in a warning.
///
/// We also check features enabled via `#[target_feature(..)]` (and here, constraint violations
/// emit a hard error), including features enabled indirectly via implications -- but if LLVM
/// considers more features to be implied than we do, that could bypass this check!
// rustc: compiler/rustc_target/src/target_features.rs:1290 abi_required_features
TargetClass.prototype.abi_required_features = function (this: Target): FeatureConstraints {
  const NOTHING: FeatureConstraints = { required: [], incompatible: [] };
  // Some architectures don't have a clean explicit ABI designation; instead, the ABI is
  // defined by target features. When that is the case, those target features must be
  // "internal-only" in the list above to ensure that there is a consistent answer to the
  // questions "which ABI is used".
  switch (this.arch.$) {
    case "X86":
      // We use our own ABI indicator here; LLVM does not have anything native.
      // Every case should require or forbid `soft-float`!
      switch (this.rustc_abi) {
        case undefined:
          // Default hardfloat ABI.
          // x87 must be enabled, soft-float must be disabled.
          return { required: ["x87"], incompatible: ["soft-float"] };
        case "X86Sse2":
          // Extended hardfloat ABI. x87 and SSE2 must be enabled, soft-float must be disabled.
          return {
            required: ["x87", "sse2"],
            incompatible: ["soft-float"],
          };
        case "Softfloat":
          // Softfloat ABI, requires corresponding target feature. That feature trumps
          // `x87` and all other FPU features so those do not matter.
          // Note that this one requirement is the entire implementation of the ABI!
          // LLVM handles the rest.
          // We mark "sse" as incompatible since LLVM likes to crash when both
          // "soft-float" and "sse" are enabled.
          return { required: ["soft-float"], incompatible: ["sse"] };
        default:
          return unreachable();
      }
    case "X86_64":
      // We use our own ABI indicator here; LLVM does not have anything native.
      // Every case should require or forbid `soft-float`!
      switch (this.rustc_abi) {
        case undefined:
          // Default hardfloat ABI. On x86-64, this always includes SSE2.
          return {
            required: ["x87", "sse2"],
            incompatible: ["soft-float"],
          };
        case "Softfloat":
          // Softfloat ABI, requires corresponding target feature. That feature trumps
          // `x87` and all other FPU features so those do not matter.
          // Note that this one requirement is the entire implementation of the ABI!
          // LLVM handles the rest.
          // We mark "sse" as incompatible since LLVM likes to crash when both
          // "soft-float" and "sse" are enabled.
          return { required: ["soft-float"], incompatible: ["sse"] };
        default:
          return unreachable();
      }
    case "Arm":
      // On ARM, ABI handling is reasonably sane; we use `llvm_floatabi` to indicate
      // to LLVM which ABI we are going for.
      switch (unwrap(this.llvm_floatabi)) {
        case "Soft":
          // Nothing special required, will use soft-float ABI throughout.
          // We can even allow `-soft-float` here; in fact that is useful as it lets
          // people use FPU instructions with a softfloat ABI (corresponds to
          // `-mfloat-abi=softfp` in GCC/clang).
          return NOTHING;
        case "Hard":
          // Must have `fpregs` and must not have `soft-float`.
          return { required: ["fpregs"], incompatible: ["soft-float"] };
      }
    // falls through (unreachable: the inner match is exhaustive)
    case "AArch64":
    case "Arm64EC":
      // Aarch64 has no sane ABI specifier, and LLVM doesn't even have a way to force
      // the use of soft-float, so all we can do here is some crude hacks.
      switch (this.rustc_abi) {
        case "Softfloat":
          // LLVM will use float registers when `fp-armv8` is available, e.g. for
          // calls to built-ins. The only way to ensure a consistent softfloat ABI
          // on aarch64 is to never enable `fp-armv8`, so we enforce that.
          // In Rust we tie `neon` and `fp-armv8` together, therefore `neon` is also
          // marked as incompatible.
          return { required: [], incompatible: ["neon", "fp-armv8"] };
        case undefined:
          // Everything else is assumed to use a hardfloat ABI. neon and fp-armv8 must be enabled.
          // `FeatureConstraints` uses Rust feature names, hence only "neon" shows up.
          return { required: ["neon"], incompatible: [] };
        default:
          return unreachable();
      }
    case "RiscV32":
    case "RiscV64":
      // RISC-V handles ABI in a very sane way, being fully explicit via `llvm_abiname`
      // about what the intended ABI is.
      switch (this.llvm_abiname.$) {
        case "Ilp32d":
        case "Lp64d":
          // Requires d (which implies f), incompatible with e and zfinx.
          return { required: ["d"], incompatible: ["e", "zfinx"] };
        case "Ilp32f":
        case "Lp64f":
          // Requires f, incompatible with e and zfinx.
          return { required: ["f"], incompatible: ["e", "zfinx"] };
        case "Ilp32":
        case "Lp64":
          // Requires nothing, incompatible with e.
          return { required: [], incompatible: ["e"] };
        case "Ilp32e":
          // ilp32e is documented to be incompatible with features that need aligned
          // load/stores > 32 bits, like `d`. (One could also just generate more
          // complicated code to align the stack when needed, but the RISCV
          // architecture manual just explicitly rules out this combination so we
          // might as well.)
          // Note that the `e` feature is not required: the ABI treats the extra
          // registers as caller-save, so it is safe to use them only in some parts of
          // a program while the rest doesn't know they even exist.
          return { required: [], incompatible: ["d"] };
        case "Lp64e":
          // As above, `e` is not required.
          return NOTHING;
        default:
          return unreachable();
      }
    case "LoongArch32":
    case "LoongArch64":
      // LoongArch handles ABI in a very sane way, being fully explicit via `llvm_abiname`
      // about what the intended ABI is.
      switch (this.llvm_abiname.$) {
        case "Ilp32d":
        case "Lp64d":
          // Requires d (which implies f), incompatible with nothing.
          return { required: ["d"], incompatible: [] };
        case "Ilp32f":
        case "Lp64f":
          // Requires f, incompatible with nothing.
          return { required: ["f"], incompatible: [] };
        case "Ilp32s":
        case "Lp64s":
          // The soft-float ABI does not require any features and is also not
          // incompatible with any features. Rust targets explicitly specify the
          // LLVM ABI names, which allows for enabling hard-float support even on
          // soft-float targets, and ensures that the ABI behavior is as expected.
          return NOTHING;
        default:
          return unreachable();
      }
    case "S390x":
      // Same as x86, We use our own ABI indicator here;
      // LLVM does not have anything native and will switch ABI based
      // on the soft-float target feature.
      // Every case should require or forbid `soft-float`!
      // The "vector" target feature may only be used without soft-float
      // because the float and vector registers overlap and the
      // standard s390x C ABI may pass vectors via these registers.
      switch (this.rustc_abi) {
        case undefined:
          // Default hardfloat ABI.
          return { required: [], incompatible: ["soft-float"] };
        case "Softfloat":
          // Softfloat ABI, requires corresponding target feature.
          // llvm will switch to soft-float ABI just based on this feature.
          return { required: ["soft-float"], incompatible: ["vector"] };
        default:
          return unreachable();
      }
    case "PowerPC":
      // The main ABI-relevant target features are "hard-float" and "spe". We use our own
      // ABI indicator here.
      switch (this.rustc_abi) {
        case undefined:
          // Default hardfloat ABI.
          return { required: ["hard-float"], incompatible: ["spe"] };
        case "PowerPcSpe":
          // "efpu2" (which disables some register use in LLVM) *should* be okay
          // because SPE uses soft-float ABI's parameter passing rules and passes
          // floats via GPRs.
          // <https://github.com/rust-lang/rust/pull/157085#discussion_r3349260222>
          return { required: ["hard-float", "spe"], incompatible: [] };
        default:
          return unreachable();
      }
    case "PowerPC64":
      // There's no SPE for PowerPC64, and we currently don't support any soft-float
      // targets. (If we ever add one, we need to match on `RustcAbi::Softfloat` similar
      // to other targets above.)
      return { required: ["hard-float"], incompatible: ["spe"] };
    case "Sparc":
      // We currently don't have a soft-float target for SPARC.
      // We need to pin down v8plus as it is a separate ABI (indicated in object files so
      // things cannot be linked across ABI boundaries).
      switch (this.rustc_abi) {
        case undefined:
          return {
            required: [],
            incompatible: ["soft-float", "v8plus"],
          };
        case "SparcV8Plus":
          return { required: ["v8plus"], incompatible: ["soft-float"] };
        default:
          return unreachable();
      }
    case "Sparc64":
      // We currently don't have a soft-float target for SPARC64.
      // v8plus is for 32bit SPARC only.
      return { required: [], incompatible: ["soft-float", "v8plus"] };
    case "Avr":
      // We only support one ABI on AVR at the moment.
      // SRAM is minimum requirement for C/C++ in both avr-gcc and Clang,
      // and backends of them only support assembly for devices have no SRAM.
      // See the discussion in https://github.com/rust-lang/rust/pull/146900 for more.
      return { required: ["sram"], incompatible: [] };
    case "Wasm32":
    case "Wasm64":
      // We only support one ABI on wasm at the moment.
      // No ABI-relevant target features have been identified thus far.
      return NOTHING;
    case "Xtensa":
      // All Rust-supported Xtensa targets use the windowed register ABI
      // (esp32 and later). Non-windowed (historical esp8266 / CALL0) is not
      // a supported Rust ABI. Requiring `windowed` here means selecting a
      // -Ctarget-cpu that does not provide windowed produces an ABI mismatch
      // warning rather than silent UB when mixed with windowed code.
      //
      // `windowed` implies `exception` in XTENSA_FEATURES, so exception is
      // always enabled for this ABI; list it explicitly for complete constraints.
      return { required: ["windowed", "exception"], incompatible: [] };
    default:
      return NOTHING;
  }
};
