//! Contains infrastructure for configuring the compiler, including parsing
//! command-line options.
// Partial port of compiler/rustc_session/src/config.rs: the small types that the `-C`/`-Z` option
// tables (options.rs) and the `Options` struct name, with their inherent fns, `FromStr`/`Default`
// impls and derived Debug. Everything else in config.rs (Options::default, parse_* of the
// top-level CLI, OutputTypes, Externs, PpMode, dep_tracking, ...) is not ported yet; see
// docs/handoff/session-options.md.
//
// PORT: upstream `pub use crate::options::*;` is not mirrored: options.gen.ts reads `Polonius`
// from this module while it is evaluated (POLONIUS_HELP), so this module must not import the
// options modules (ESM cycle). Import the option tables from options.ts.
import type { ColorConfig } from "../rustc_errors/emitter.ts";
import { HumanReadableErrorType, debug_HumanReadableErrorType } from "../rustc_errors/emitter.ts";
import { type Symbol, sym } from "../rustc_span/symbol.ts";
import { type Debug, debug_bool, debug_int, debug_option, debug_str, debug_struct, debug_tuple, debug_vec } from "../std/fmt.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { type LinkSelfContainedComponents, LinkSelfContainedComponents as LSCC, type LinkerFeatures, LinkerFeatures as LF } from "./stand_ins.ts";
import { unported } from "../std/panic.ts";

/// A recommended stack size for worker threads spawned within a session.
export const DEFAULT_STACK_SIZE: number = 17 * 1024 * 1024;

/// Special CPU name requesting the CPU of the current host.
export const NATIVE_CPU: string = "native";

/// The different settings that the `-C strip` flag can have.
export type Strip =
  /// Do not strip at all.
  | "None"
  /// Strip debuginfo.
  | "Debuginfo"
  /// Strip all symbols.
  | "Symbols";
export const Strip = { None: "None", Debuginfo: "Debuginfo", Symbols: "Symbols" } as const;
export const debug_Strip: Debug<Strip> = (v) => v;

/// The different settings that the `-C control-flow-guard` flag can have.
export type CFGuard =
  /// Do not emit Control Flow Guard metadata or checks.
  | "Disabled"
  /// Emit Control Flow Guard metadata but no checks.
  | "NoChecks"
  /// Emit Control Flow Guard metadata and checks.
  | "Checks";
export const CFGuard = { Disabled: "Disabled", NoChecks: "NoChecks", Checks: "Checks" } as const;
export const debug_CFGuard: Debug<CFGuard> = (v) => v;

/// The different settings that the `-Z cf-protection` flag can have.
export type CFProtection =
  /// Do not enable control-flow protection
  | "None"
  /// Emit control-flow protection for branches (enables indirect branch tracking).
  | "Branch"
  /// Emit control-flow protection for returns.
  | "Return"
  /// Emit control-flow protection for both branches and returns.
  | "Full";
export const CFProtection = { None: "None", Branch: "Branch", Return: "Return", Full: "Full" } as const;
export const debug_CFProtection: Debug<CFProtection> = (v) => v;

export type OptLevel =
  /// `-Copt-level=0`
  | "No"
  /// `-Copt-level=1`
  | "Less"
  /// `-Copt-level=2`
  | "More"
  /// `-Copt-level=3` / `-O`
  | "Aggressive"
  /// `-Copt-level=s`
  | "Size"
  /// `-Copt-level=z`
  | "SizeMin";
export const OptLevel = {
  No: "No",
  Less: "Less",
  More: "More",
  Aggressive: "Aggressive",
  Size: "Size",
  SizeMin: "SizeMin",

  /// Infers an MIR opt-level (if not otherwise specified) from general opt-level.
  /// Produces `1` at opt-level 0, and `2` at all other levels.
  // rustc: compiler/rustc_session/src/config.rs:123 mir_opt_level
  mir_opt_level(self: OptLevel): number {
    switch (self) {
      case "No":
        return 1;
      default:
        return 2;
    }
  },
} as const;
export const debug_OptLevel: Debug<OptLevel> = (v) => v;

/// The different settings that the `-C lto` flag can have.
export type LtoCli =
  /// `-C lto=no`
  | "No"
  /// `-C lto=yes`
  | "Yes"
  /// `-C lto`
  | "NoParam"
  /// `-C lto=thin`
  | "Thin"
  /// `-C lto=fat`
  | "Fat"
  /// No `-C lto` flag passed
  | "Unspecified";
export const LtoCli = { No: "No", Yes: "Yes", NoParam: "NoParam", Thin: "Thin", Fat: "Fat", Unspecified: "Unspecified" } as const;
export const debug_LtoCli: Debug<LtoCli> = (v) => v;

/// The different settings that the `-C instrument-coverage` flag can have.
export type InstrumentCoverage =
  /// `-C instrument-coverage=no` (or `off`, `false` etc.)
  | "No"
  /// `-C instrument-coverage` or `-C instrument-coverage=yes`
  | "Yes";
export const InstrumentCoverage = { No: "No", Yes: "Yes" } as const;
export const debug_InstrumentCoverage: Debug<InstrumentCoverage> = (v) => v;

/// Individual flag values controlled by `-Zcoverage-options`.
export interface CoverageOptions {
  level: CoverageLevel;

  /// **(internal test-only flag)**
  /// `-Zcoverage-options=discard-all-spans-in-codegen`: During codegen,
  /// discard all coverage spans as though they were invalid. Needed by
  /// regression tests for #133606, because we don't have an easy way to
  /// reproduce it from actual source code.
  discard_all_spans_in_codegen: boolean;
}
export const CoverageOptions = {
  /** `#[derive(Default)]` */
  default(): CoverageOptions {
    return { level: CoverageLevel.default(), discard_all_spans_in_codegen: false };
  },
} as const;
export const debug_CoverageOptions: Debug<CoverageOptions> = (v, f) =>
  debug_struct(f, "CoverageOptions", [
    ["level", debug_CoverageLevel(v.level, f)],
    ["discard_all_spans_in_codegen", debug_bool(v.discard_all_spans_in_codegen, f)],
  ]);

/// Controls whether branch coverage is enabled.
export type CoverageLevel =
  /// Instrument for coverage at the MIR block level.
  | "Block"
  /// Also instrument branch points (includes block coverage).
  | "Branch"
  /// Same as branch coverage, but also adds branch instrumentation for
  /// certain boolean expressions that are not directly used for branching.
  ///
  /// This level is mainly intended to be a stepping-stone towards full MC/DC
  /// instrumentation, so it might be removed in the future when MC/DC is
  /// sufficiently complete, or if it is making MC/DC changes difficult.
  | "Condition";
export const CoverageLevel = {
  Block: "Block",
  Branch: "Branch",
  Condition: "Condition",
  /** `#[derive(Default)]` (`#[default] Block`) */
  default: (): CoverageLevel => "Block",
} as const;
/** `#[derive(PartialOrd, Ord)]` */
export const CoverageLevel_discriminant: Record<CoverageLevel, number> = { Block: 0, Branch: 1, Condition: 2 };
export const debug_CoverageLevel: Debug<CoverageLevel> = (v) => v;

// The different settings that the `-Z offload` flag can have.
export type Offload =
  /// Second step in the offload pipeline, enables kernel compilation for a gpu device
  /// Reads a manifest of required generic kernel instantiations
  /// produced by a previous `HostMetadata` pass. An empty manifest
  /// means there are no generic kernels at all, or that generic kernels are only
  /// called from non-generic device entry points and never from the host, so we
  /// don't need to track their instantiations.
  | { readonly $: "Device"; readonly _0: string }
  /// Third step in the offload pipeline, generates the host code to call kernels.
  | { readonly $: "Host"; readonly _0: string }
  /// Test is similar to Host, but allows testing without a device artifact.
  | { readonly $: "Test" }
  /// First step in the offload pipeline: compile for the host but only emit a manifest of
  /// kernel instantiations required by the host code.
  | { readonly $: "HostMetadata"; readonly _0: string };
export const Offload = { Test: Object.freeze({ $: "Test" }) as Offload } as const;
export const debug_Offload: Debug<Offload> = (v, f) => (v.$ === "Test" ? "Test" : debug_tuple(f, v.$, [debug_str(v._0)]));

/// The different settings that the `-Z codegen-emit-retag` flag can have.
export interface CodegenRetagOptions {
  /// Track interior mutable data on the level of references, instead of on the byte level.
  no_precise_im: boolean;
  /// Track `UnsafePinned` data on the level of references, instead of on the byte level.
  no_precise_pin: boolean;
}
export const debug_CodegenRetagOptions: Debug<CodegenRetagOptions> = (v, f) =>
  debug_struct(f, "CodegenRetagOptions", [
    ["no_precise_im", debug_bool(v.no_precise_im, f)],
    ["no_precise_pin", debug_bool(v.no_precise_pin, f)],
  ]);

/// The different settings that the `-Z autodiff` flag can have.
export type AutoDiff =
  /// Enable the autodiff opt pipeline
  | { readonly $: "Enable" }
  /// Print TypeAnalysis information
  | { readonly $: "PrintTA" }
  /// Print TypeAnalysis information for a specific function
  | { readonly $: "PrintTAFn"; readonly _0: string }
  /// Print ActivityAnalysis Information
  | { readonly $: "PrintAA" }
  /// Print Performance Warnings from Enzyme
  | { readonly $: "PrintPerf" }
  /// Print intermediate IR generation steps
  | { readonly $: "PrintSteps" }
  /// Print the module, before running autodiff.
  | { readonly $: "PrintModBefore" }
  /// Print the module after running autodiff.
  | { readonly $: "PrintModAfter" }
  /// Print the module after running autodiff and optimizations.
  | { readonly $: "PrintModFinal" }
  /// Print all passes scheduled by LLVM
  | { readonly $: "PrintPasses" }
  /// Disable extra opt run after running autodiff
  | { readonly $: "NoPostopt" }
  /// Enzyme's loose type debug helper (can cause incorrect gradients!!)
  /// Usable in cases where Enzyme errors with `can not deduce type of X`.
  | { readonly $: "LooseTypes" }
  /// Runs Enzyme's aggressive inlining
  | { readonly $: "Inline" }
  /// Disable Type Tree
  | { readonly $: "NoTT" };
export const AutoDiff = {
  Enable: Object.freeze({ $: "Enable" }) as AutoDiff,
  PrintTA: Object.freeze({ $: "PrintTA" }) as AutoDiff,
  PrintAA: Object.freeze({ $: "PrintAA" }) as AutoDiff,
  PrintPerf: Object.freeze({ $: "PrintPerf" }) as AutoDiff,
  PrintSteps: Object.freeze({ $: "PrintSteps" }) as AutoDiff,
  PrintModBefore: Object.freeze({ $: "PrintModBefore" }) as AutoDiff,
  PrintModAfter: Object.freeze({ $: "PrintModAfter" }) as AutoDiff,
  PrintModFinal: Object.freeze({ $: "PrintModFinal" }) as AutoDiff,
  PrintPasses: Object.freeze({ $: "PrintPasses" }) as AutoDiff,
  NoPostopt: Object.freeze({ $: "NoPostopt" }) as AutoDiff,
  LooseTypes: Object.freeze({ $: "LooseTypes" }) as AutoDiff,
  Inline: Object.freeze({ $: "Inline" }) as AutoDiff,
  NoTT: Object.freeze({ $: "NoTT" }) as AutoDiff,
} as const;
export const debug_AutoDiff: Debug<AutoDiff> = (v, f) => (v.$ === "PrintTAFn" ? debug_tuple(f, "PrintTAFn", [debug_str(v._0)]) : v.$);

/// The different settings that the `-Z annotate-moves` flag can have.
export type AnnotateMoves =
  /// `-Z annotate-moves=no` (or `off`, `false` etc.)
  | { readonly $: "Disabled" }
  /// `-Z annotate-moves` or `-Z annotate-moves=yes` (use default size limit)
  /// `-Z annotate-moves=SIZE` (use specified size limit)
  // PORT: `Option<u64>` -> `bigint | undefined` (any u64 is accepted).
  | { readonly $: "Enabled"; readonly _0: bigint | undefined };
export const AnnotateMoves = { Disabled: Object.freeze({ $: "Disabled" }) as AnnotateMoves } as const;
export const debug_AnnotateMoves: Debug<AnnotateMoves> = (v, f) =>
  v.$ === "Disabled" ? "Disabled" : debug_tuple(f, "Enabled", [debug_option(v._0, f, debug_int)]);

export interface InstrumentMcountOpts {
  // Insert a nop which could be replaced by an mcount call.
  no_call: boolean;
  // Record the location of the call instrument in a special linker section.
  record: boolean;
}
export const InstrumentMcountOpts = {
  /** `#[derive(Default)]` */
  default(): InstrumentMcountOpts {
    return { no_call: false, record: false };
  },
} as const;
export const debug_InstrumentMcountOpts: Debug<InstrumentMcountOpts> = (v, f) =>
  debug_struct(f, "InstrumentMcountOpts", [
    ["no_call", debug_bool(v.no_call, f)],
    ["record", debug_bool(v.record, f)],
  ]);

/// The different settings that the `-Z Instrument-mcount` flag can have.
export type InstrumentMcount =
  /// `-Z instrument-mcount=no`
  | { readonly $: "Disabled" }
  /// `-Z instrument-mcount=yes`
  | { readonly $: "Mcount"; readonly _0: InstrumentMcountOpts }
  /// `-Z instrument-mcount=fentry`
  | { readonly $: "Fentry"; readonly _0: InstrumentMcountOpts };
export const InstrumentMcount = { Disabled: Object.freeze({ $: "Disabled" }) as InstrumentMcount } as const;
export const debug_InstrumentMcount: Debug<InstrumentMcount> = (v, f) =>
  v.$ === "Disabled" ? "Disabled" : debug_tuple(f, v.$, [debug_InstrumentMcountOpts(v._0, f)]);

/// Settings for `-Z instrument-xray` flag.
export interface InstrumentXRay {
  /// `-Z instrument-xray=always`, force instrumentation
  always: boolean;
  /// `-Z instrument-xray=never`, disable instrumentation
  never: boolean;
  /// `-Z instrument-xray=ignore-loops`, ignore presence of loops,
  /// instrument functions based only on instruction count
  ignore_loops: boolean;
  /// `-Z instrument-xray=instruction-threshold=N`, explicitly set instruction threshold
  /// for instrumentation, or `None` to use compiler's default
  instruction_threshold: number | undefined;
  /// `-Z instrument-xray=skip-entry`, do not instrument function entry
  skip_entry: boolean;
  /// `-Z instrument-xray=skip-exit`, do not instrument function exit
  skip_exit: boolean;
}
export const InstrumentXRay = {
  /** `#[derive(Default)]` */
  default(): InstrumentXRay {
    return { always: false, never: false, ignore_loops: false, instruction_threshold: undefined, skip_entry: false, skip_exit: false };
  },
} as const;
export const debug_InstrumentXRay: Debug<InstrumentXRay> = (v, f) =>
  debug_struct(f, "InstrumentXRay", [
    ["always", debug_bool(v.always, f)],
    ["never", debug_bool(v.never, f)],
    ["ignore_loops", debug_bool(v.ignore_loops, f)],
    ["instruction_threshold", debug_option(v.instruction_threshold, f, debug_int)],
    ["skip_entry", debug_bool(v.skip_entry, f)],
    ["skip_exit", debug_bool(v.skip_exit, f)],
  ]);

export type LinkerPluginLto = { readonly $: "LinkerPlugin"; readonly _0: string } | { readonly $: "LinkerPluginAuto" } | { readonly $: "Disabled" };
export const LinkerPluginLto = {
  LinkerPluginAuto: Object.freeze({ $: "LinkerPluginAuto" }) as LinkerPluginLto,
  Disabled: Object.freeze({ $: "Disabled" }) as LinkerPluginLto,

  // rustc: compiler/rustc_session/src/config.rs:336 enabled
  enabled(self: LinkerPluginLto): boolean {
    switch (self.$) {
      case "LinkerPlugin":
      case "LinkerPluginAuto":
        return true;
      case "Disabled":
        return false;
    }
  },
} as const;
// PORT: `PathBuf` Debug is the `str` Debug of the path.
export const debug_LinkerPluginLto: Debug<LinkerPluginLto> = (v, f) => (v.$ === "LinkerPlugin" ? debug_tuple(f, "LinkerPlugin", [debug_str(v._0)]) : v.$);

/// The different values `-C link-self-contained` can take: a list of individually enabled or
/// disabled components used during linking, coming from the rustc distribution, instead of being
/// found somewhere on the host system.
///
/// They can be set in bulk via `-C link-self-contained=yes|y|on` or `-C
/// link-self-contained=no|n|off`, and those boolean values are the historical defaults.
///
/// But each component is fine-grained, and can be unstably targeted, to use:
/// - some CRT objects
/// - the libc static library
/// - libgcc/libunwind libraries
/// - a linker we distribute
/// - some sanitizer runtime libraries
/// - all other MinGW libraries and Windows import libs
///
export class LinkSelfContained {
  constructor(
    /// Whether the user explicitly set `-C link-self-contained` on or off, the historical values.
    /// Used for compatibility with the existing opt-in and target inference.
    public explicitly_set: boolean | undefined,

    /// The components that are enabled on the CLI, using the `+component` syntax or one of the
    /// `true` shortcuts.
    public enabled_components: LinkSelfContainedComponents,

    /// The components that are disabled on the CLI, using the `-component` syntax or one of the
    /// `false` shortcuts.
    public disabled_components: LinkSelfContainedComponents,
  ) {}

  /** `#[derive(Default)]` */
  static default(): LinkSelfContained {
    return new LinkSelfContained(undefined, LSCC.empty(), LSCC.empty());
  }

  /// Incorporates an enabled or disabled component as specified on the CLI, if possible.
  /// For example: `+linker`, and `-crto`.
  // rustc: compiler/rustc_session/src/config.rs:377 handle_cli_component
  handle_cli_component(component: string): undefined | null {
    // PORT: `Option<()>` -> `null` (Some(())) / `undefined` (None).
    // Note that for example `-Cself-contained=y -Cself-contained=-linker` is not an explicit
    // set of all values like `y` or `n` used to be. Therefore, if this flag had previously been
    // set in bulk with its historical values, then manually setting a component clears that
    // `explicitly_set` state.
    if (component.startsWith("+")) {
      const component_to_enable = component.slice(1);
      this.explicitly_set = undefined;
      const c = LSCC.from_str(component_to_enable);
      if (c.$ === "Err") return undefined;
      this.enabled_components |= c._0;
      return null;
    } else if (component.startsWith("-")) {
      const component_to_disable = component.slice(1);
      this.explicitly_set = undefined;
      const c = LSCC.from_str(component_to_disable);
      if (c.$ === "Err") return undefined;
      this.disabled_components |= c._0;
      return null;
    } else {
      return undefined;
    }
  }

  /// Turns all components on or off and records that this was done explicitly for compatibility
  /// purposes.
  // rustc: compiler/rustc_session/src/config.rs:399 set_all_explicitly
  set_all_explicitly(enabled: boolean): void {
    this.explicitly_set = enabled;

    if (enabled) {
      this.enabled_components = LSCC.all();
      this.disabled_components = LSCC.empty();
    } else {
      this.enabled_components = LSCC.empty();
      this.disabled_components = LSCC.all();
    }
  }

  /// Helper creating a fully enabled `LinkSelfContained` instance. Used in tests.
  // rustc: compiler/rustc_session/src/config.rs:412 on
  static on(): LinkSelfContained {
    const on = LinkSelfContained.default();
    on.set_all_explicitly(true);
    return on;
  }

  /// To help checking CLI usage while some of the values are unstable: returns whether one of the
  /// unstable components was set individually, for the given `TargetTuple`. This would also
  /// require the `-Zunstable-options` flag, to be allowed.
  // rustc: compiler/rustc_session/src/config.rs:421 check_unstable_variants
  check_unstable_variants(_target_tuple: unknown): Result<undefined, string> {
    // PORT: needs `TargetTuple::tuple` and its Display (rustc_target).
    unported("rustc_session::config::LinkSelfContained::check_unstable_variants");
  }

  /// Returns whether the self-contained linker component was enabled on the CLI, using the
  /// `-C link-self-contained=+linker` syntax, or one of the `true` shortcuts.
  // rustc: compiler/rustc_session/src/config.rs:451 is_linker_enabled
  is_linker_enabled(): boolean {
    return (this.enabled_components & LSCC.LINKER) === LSCC.LINKER;
  }

  /// Returns whether the self-contained linker component was disabled on the CLI, using the
  /// `-C link-self-contained=-linker` syntax, or one of the `false` shortcuts.
  // rustc: compiler/rustc_session/src/config.rs:457 is_linker_disabled
  is_linker_disabled(): boolean {
    return (this.disabled_components & LSCC.LINKER) === LSCC.LINKER;
  }

  /// Returns CLI inconsistencies to emit errors: individual components were both enabled and
  /// disabled.
  // rustc: compiler/rustc_session/src/config.rs:463 check_consistency
  check_consistency(): LinkSelfContainedComponents | undefined {
    if (this.explicitly_set !== undefined) {
      return undefined;
    } else {
      const common = this.enabled_components & this.disabled_components;
      return common === 0 ? undefined : common;
    }
  }
}
// PORT: the bitflags Debug of `LinkSelfContainedComponents` (external_bitflags_debug!) is not ported.
export const debug_LinkSelfContained: Debug<LinkSelfContained> = () => unported("rustc_session::config::LinkSelfContained Debug");

/// The different values that `-C linker-features` can take on the CLI: a list of individually
/// enabled or disabled features used during linking.
///
/// There is no need to enable or disable them in bulk. Each feature is fine-grained, and can be
/// used to turn `LinkerFeatures` on or off, without needing to change the linker flavor:
/// - using the system lld, or the self-contained `rust-lld` linker
/// - using a C/C++ compiler to drive the linker (not yet exposed on the CLI)
/// - etc.
export class LinkerFeaturesCli {
  constructor(
    /// The linker features that are enabled on the CLI, using the `+feature` syntax.
    public enabled: LinkerFeatures,

    /// The linker features that are disabled on the CLI, using the `-feature` syntax.
    public disabled: LinkerFeatures,
  ) {}

  /** `#[derive(Default)]` */
  static default(): LinkerFeaturesCli {
    return new LinkerFeaturesCli(LF.empty(), LF.empty());
  }

  /// Accumulates an enabled or disabled feature as specified on the CLI, if possible.
  /// For example: `+lld`, and `-lld`.
  // rustc: compiler/rustc_session/src/config.rs:493 handle_cli_feature
  handle_cli_feature(feature: string): undefined | null {
    // PORT: `Option<()>` -> `null` (Some(())) / `undefined` (None).
    // Duplicate flags are reduced as we go, the last occurrence wins:
    // `+feature,-feature,+feature` only enables the feature, and does not record it as both
    // enabled and disabled on the CLI.
    // We also only expose `+/-lld` at the moment, as it's currently the only implemented linker
    // feature and toggling `LinkerFeatures::CC` would be a noop.
    switch (feature) {
      case "+lld": {
        this.enabled |= LF.LLD;
        this.disabled &= ~LF.LLD;
        return null;
      }
      case "-lld": {
        this.disabled |= LF.LLD;
        this.enabled &= ~LF.LLD;
        return null;
      }
      default:
        return undefined;
    }
  }

  /// When *not* using `-Z unstable-options` on the CLI, ensure only stable linker features are
  /// used, for the given `TargetTuple`. Returns `Ok` if no unstable variants are used.
  /// The caller should ensure that e.g. `nightly_options::is_unstable_enabled()`
  /// returns false.
  // rustc: compiler/rustc_session/src/config.rs:518 check_unstable_variants
  check_unstable_variants(_target_tuple: unknown): Result<undefined, string> {
    // PORT: needs `TargetTuple::tuple`, `LinkerFeatures::{iter, as_str, is_lld_enabled}` (rustc_target).
    unported("rustc_session::config::LinkerFeaturesCli::check_unstable_variants");
  }
}
export const debug_LinkerFeaturesCli: Debug<LinkerFeaturesCli> = () => unported("rustc_session::config::LinkerFeaturesCli Debug");

/// Used with `-Z assert-incr-state`.
export type IncrementalStateAssertion =
  /// Found and loaded an existing session directory.
  ///
  /// Note that this says nothing about whether any particular query
  /// will be found to be red or green.
  | "Loaded"
  /// Did not load an existing session directory.
  | "NotLoaded";
export const IncrementalStateAssertion = { Loaded: "Loaded", NotLoaded: "NotLoaded" } as const;
export const debug_IncrementalStateAssertion: Debug<IncrementalStateAssertion> = (v) => v;

/// The different settings that can be enabled via the `-Z location-detail` flag.
export class LocationDetail {
  constructor(
    public file: boolean,
    public line: boolean,
    public column: boolean,
  ) {}

  // rustc: compiler/rustc_session/src/config.rs:569 all
  static all(): LocationDetail {
    return new LocationDetail(true, true, true);
  }
}
export const debug_LocationDetail: Debug<LocationDetail> = (v, f) =>
  debug_struct(f, "LocationDetail", [
    ["file", debug_bool(v.file, f)],
    ["line", debug_bool(v.line, f)],
    ["column", debug_bool(v.column, f)],
  ]);

/// Values for the `-Z fmt-debug` flag.
export type FmtDebug =
  /// Derive fully-featured implementation
  | "Full"
  /// Print only type name, without fields
  | "Shallow"
  /// `#[derive(Debug)]` and `{:?}` are no-ops
  | "None";
export const FmtDebug = {
  Full: "Full",
  Shallow: "Shallow",
  None: "None",

  // rustc: compiler/rustc_session/src/config.rs:586 all
  all(): [Symbol, Symbol, Symbol] {
    return [sym.full, sym.none, sym.shallow];
  },
} as const;
export const debug_FmtDebug: Debug<FmtDebug> = (v) => v;

export type SwitchWithOptPath = { readonly $: "Enabled"; readonly _0: string | undefined } | { readonly $: "Disabled" };
export const SwitchWithOptPath = {
  Disabled: Object.freeze({ $: "Disabled" }) as SwitchWithOptPath,

  // rustc: compiler/rustc_session/src/config.rs:598 enabled
  enabled(self: SwitchWithOptPath): boolean {
    switch (self.$) {
      case "Enabled":
        return true;
      case "Disabled":
        return false;
    }
  },
} as const;
export const debug_SwitchWithOptPath: Debug<SwitchWithOptPath> = (v, f) =>
  v.$ === "Disabled" ? "Disabled" : debug_tuple(f, "Enabled", [debug_option(v._0, f, (p) => debug_str(p))]);

export type SymbolManglingVersion = "Legacy" | "V0" | "Hashed";
export const SymbolManglingVersion = { Legacy: "Legacy", V0: "V0", Hashed: "Hashed" } as const;
/** `#[derive(PartialOrd, Ord)]` */
export const SymbolManglingVersion_discriminant: Record<SymbolManglingVersion, number> = { Legacy: 0, V0: 1, Hashed: 2 };
export const debug_SymbolManglingVersion: Debug<SymbolManglingVersion> = (v) => v;

export type DebugInfo = "None" | "LineDirectivesOnly" | "LineTablesOnly" | "Limited" | "Full";
export const DebugInfo = { None: "None", LineDirectivesOnly: "LineDirectivesOnly", LineTablesOnly: "LineTablesOnly", Limited: "Limited", Full: "Full" } as const;
export const debug_DebugInfo: Debug<DebugInfo> = (v) => v;

export type DebugInfoCompression = "None" | "Zlib" | "Zstd";
export const DebugInfoCompression = { None: "None", Zlib: "Zlib", Zstd: "Zstd" } as const;
export const debug_DebugInfoCompression: Debug<DebugInfoCompression> = (v) => v;

export type MirStripDebugInfo = "None" | "LocalsInTinyFunctions" | "AllLocals";
export const MirStripDebugInfo = { None: "None", LocalsInTinyFunctions: "LocalsInTinyFunctions", AllLocals: "AllLocals" } as const;
export const debug_MirStripDebugInfo: Debug<MirStripDebugInfo> = (v) => v;

/// Split debug-information is enabled by `-C split-debuginfo`, this enum is only used if split
/// debug-information is enabled (in either `Packed` or `Unpacked` modes), and the platform
/// uses DWARF for debug-information.
///
/// Some debug-information requires link-time relocation and some does not. LLVM can partition
/// the debuginfo into sections depending on whether or not it requires link-time relocation. Split
/// DWARF provides a mechanism which allows the linker to skip the sections which don't require
/// link-time relocation - either by putting those sections in DWARF object files, or by keeping
/// them in the object file in such a way that the linker will skip them.
export type SplitDwarfKind =
  /// Sections which do not require relocation are written into object file but ignored by the
  /// linker.
  | "Single"
  /// Sections which do not require relocation are written into a DWARF object (`.dwo`) file
  /// which is ignored by the linker.
  | "Split";
export const SplitDwarfKind = {
  Single: "Single",
  Split: "Split",

  // rustc: compiler/rustc_session/src/config.rs:659 from_str
  from_str(s: string): Result<SplitDwarfKind, undefined> {
    switch (s) {
      case "single":
        return Ok("Single");
      case "split":
        return Ok("Split");
      default:
        return Err(undefined);
    }
  },
} as const;
export const debug_SplitDwarfKind: Debug<SplitDwarfKind> = (v) => v;

/// The type of diagnostics output to generate.
export type ErrorOutputType =
  /// Output meant for the consumption of humans.
  | { readonly $: "HumanReadable"; readonly kind: HumanReadableErrorType; readonly color_config: ColorConfig }
  /// Output that's consumed by other tools such as `rustfix` or the `RLS`.
  | {
      readonly $: "Json";
      /// Render the JSON in a human readable way (with indents and newlines).
      readonly pretty: boolean;
      /// The JSON output includes a `rendered` field that includes the rendered
      /// human output.
      readonly json_rendered: HumanReadableErrorType;
      readonly color_config: ColorConfig;
    };
export const ErrorOutputType = {
  /** `#[derive(Default)]`: `#[default] HumanReadable` with its default field values. */
  default(): ErrorOutputType {
    return { $: "HumanReadable", kind: new HumanReadableErrorType(false, false), color_config: "Auto" };
  },
} as const;
export const debug_ErrorOutputType: Debug<ErrorOutputType> = (v, f) => {
  switch (v.$) {
    case "HumanReadable":
      return debug_struct(f, "HumanReadable", [
        ["kind", debug_HumanReadableErrorType(v.kind, f)],
        ["color_config", v.color_config],
      ]);
    case "Json":
      return debug_struct(f, "Json", [
        ["pretty", debug_bool(v.pretty, f)],
        ["json_rendered", debug_HumanReadableErrorType(v.json_rendered, f)],
        ["color_config", v.color_config],
      ]);
  }
};

export type ResolveDocLinks =
  /// Do not resolve doc links.
  | "None"
  /// Resolve doc links on exported items only for crate types that have metadata.
  | "ExportedMetadata"
  /// Resolve doc links on exported items.
  | "Exported"
  /// Resolve doc links on all items.
  | "All";
export const ResolveDocLinks = { None: "None", ExportedMetadata: "ExportedMetadata", Exported: "Exported", All: "All" } as const;
export const debug_ResolveDocLinks: Debug<ResolveDocLinks> = (v) => v;

/// Where the new trait solver should be enabled only in coherence or everywhere.
export type NextSolverConfig = "Coherence" | "Globally";

// PORT: `option_env!("CFG_DEFAULT_NEXT_SOLVER_GLOBALLY")` is read when rustc is built. Oracle evidence
// (options.oracle.test.ts): the pinned nightly type-checks tests/ui/type-alias-impl-trait/type_of_a_let.rs
// exactly like `-Znext-solver=globally` and differently from `-Znext-solver=coherence`, so it is set.
const CFG_DEFAULT_NEXT_SOLVER_GLOBALLY: string | undefined = "1";

export const NextSolverConfig = {
  Coherence: "Coherence",
  Globally: "Globally",

  // FIXME(#160895): Using -Znext-solver as default on nightly
  // See https://github.com/rust-lang/compiler-team/issues/1014
  // rustc: compiler/rustc_session/src/config.rs:1052 default
  default(): NextSolverConfig {
    if (CFG_DEFAULT_NEXT_SOLVER_GLOBALLY !== undefined) {
      return "Globally";
    } else {
      return "Coherence";
    }
  },
} as const;
export const debug_NextSolverConfig: Debug<NextSolverConfig> = (v) => v;

export type Passes = { readonly $: "Some"; readonly _0: string[] } | { readonly $: "All" };
export const Passes = {
  All: Object.freeze({ $: "All" }) as Passes,

  // rustc: compiler/rustc_session/src/config.rs:1636 is_empty
  is_empty(self: Passes): boolean {
    switch (self.$) {
      case "Some":
        return self._0.length === 0;
      case "All":
        return false;
    }
  },

  // rustc: compiler/rustc_session/src/config.rs:1643 extend
  extend(self: Passes, passes: Iterable<string>): void {
    switch (self.$) {
      case "Some":
        self._0.push(...passes);
        break;
      case "All":
        break;
    }
  },
} as const;
export const debug_Passes: Debug<Passes> = (v, f) => (v.$ === "All" ? "All" : debug_tuple(f, "Some", [debug_vec(v._0, f, (s) => debug_str(s))]));

export type PAuthKey = "A" | "B";
export const PAuthKey = { A: "A", B: "B" } as const;
export const debug_PAuthKey: Debug<PAuthKey> = (v) => v;

export interface PacRet {
  leaf: boolean;
  pc: boolean;
  key: PAuthKey;
}
export const debug_PacRet: Debug<PacRet> = (v, f) =>
  debug_struct(f, "PacRet", [
    ["leaf", debug_bool(v.leaf, f)],
    ["pc", debug_bool(v.pc, f)],
    ["key", debug_PAuthKey(v.key, f)],
  ]);
/** `#[derive(PartialEq)]` */
export function PacRet_eq(a: PacRet, b: PacRet): boolean {
  return a.leaf === b.leaf && a.pc === b.pc && a.key === b.key;
}

export interface BranchProtection {
  bti: boolean;
  pac_ret: PacRet | undefined;
  gcs: boolean;
}
export const BranchProtection = {
  /** `#[derive(Default)]` */
  default(): BranchProtection {
    return { bti: false, pac_ret: undefined, gcs: false };
  },
} as const;
export const debug_BranchProtection: Debug<BranchProtection> = (v, f) =>
  debug_struct(f, "BranchProtection", [
    ["bti", debug_bool(v.bti, f)],
    ["pac_ret", debug_option(v.pac_ret, f, debug_PacRet)],
    ["gcs", debug_bool(v.gcs, f)],
  ]);
/** `#[derive(PartialEq)]` */
export function BranchProtection_eq(a: BranchProtection, b: BranchProtection): boolean {
  return a.bti === b.bti && (a.pac_ret === undefined || b.pac_ret === undefined ? a.pac_ret === b.pac_ret : PacRet_eq(a.pac_ret, b.pac_ret)) && a.gcs === b.gcs;
}

export type PointerAuthOption =
  // See <compiler/rustc_session/src/options.rs> and Clang's command line reference:
  // <https://clang.llvm.org/docs/ClangCommandLineReference.html#cmdoption-clang-fptrauth-auth-traps>
  // for the origin and meaning of the enum values.
  // tidy-alphabetical-start
  | "Aarch64JumpTableHardening"
  | "AuthTraps"
  | "Calls"
  | "ElfGot"
  | "FunctionPointerTypeDiscrimination"
  | "IndirectGotos"
  | "InitFini"
  | "InitFiniAddressDiscrimination"
  | "Intrinsics"
  | "ReturnAddresses"
  | "TypeInfoVTPtrDisc"
  | "VTPtrAddrDisc"
  | "VTPtrTypeDisc";
// tidy-alphabetical-end
export const PointerAuthOption = {
  Aarch64JumpTableHardening: "Aarch64JumpTableHardening",
  AuthTraps: "AuthTraps",
  Calls: "Calls",
  ElfGot: "ElfGot",
  FunctionPointerTypeDiscrimination: "FunctionPointerTypeDiscrimination",
  IndirectGotos: "IndirectGotos",
  InitFini: "InitFini",
  InitFiniAddressDiscrimination: "InitFiniAddressDiscrimination",
  Intrinsics: "Intrinsics",
  ReturnAddresses: "ReturnAddresses",
  TypeInfoVTPtrDisc: "TypeInfoVTPtrDisc",
  VTPtrAddrDisc: "VTPtrAddrDisc",
  VTPtrTypeDisc: "VTPtrTypeDisc",

  // rustc: compiler/rustc_session/src/config.rs:1693 parse
  parse(s: string): PointerAuthOption | undefined {
    switch (s) {
      case "aarch64-jump-table-hardening":
        return "Aarch64JumpTableHardening";
      case "auth-traps":
        return "AuthTraps";
      case "calls":
        return "Calls";
      case "elf-got":
        return "ElfGot";
      case "function-pointer-type-discrimination":
        return "FunctionPointerTypeDiscrimination";
      case "indirect-gotos":
        return "IndirectGotos";
      case "init-fini":
        return "InitFini";
      case "init-fini-address-discrimination":
        return "InitFiniAddressDiscrimination";
      case "intrinsics":
        return "Intrinsics";
      case "return-addresses":
        return "ReturnAddresses";
      case "typeinfo-vt-ptr-discrimination":
        return "TypeInfoVTPtrDisc";
      case "vt-ptr-addr-discrimination":
        return "VTPtrAddrDisc";
      case "vt-ptr-type-discrimination":
        return "VTPtrTypeDisc";
      default:
        return undefined;
    }
  },
} as const;
/** `#[derive(PartialOrd, Ord)]` */
export const PointerAuthOption_discriminant: Record<PointerAuthOption, number> = {
  Aarch64JumpTableHardening: 0,
  AuthTraps: 1,
  Calls: 2,
  ElfGot: 3,
  FunctionPointerTypeDiscrimination: 4,
  IndirectGotos: 5,
  InitFini: 6,
  InitFiniAddressDiscrimination: 7,
  Intrinsics: 8,
  ReturnAddresses: 9,
  TypeInfoVTPtrDisc: 10,
  VTPtrAddrDisc: 11,
  VTPtrTypeDisc: 12,
};
export const debug_PointerAuthOption: Debug<PointerAuthOption> = (v) => v;

/// Report unused externs in event stream
export type JsonUnusedExterns =
  /// Do not
  | "No"
  /// Report, but do not exit with failure status for deny/forbid
  | "Silent"
  /// Report, and also exit with failure status for deny/forbid
  | "Loud";
export const JsonUnusedExterns = {
  No: "No",
  Silent: "Silent",
  Loud: "Loud",

  // rustc: compiler/rustc_session/src/config.rs:2264 is_enabled
  is_enabled(self: JsonUnusedExterns): boolean {
    switch (self) {
      case "No":
        return false;
      case "Loud":
      case "Silent":
        return true;
    }
  },

  // rustc: compiler/rustc_session/src/config.rs:2271 is_loud
  is_loud(self: JsonUnusedExterns): boolean {
    switch (self) {
      case "No":
      case "Silent":
        return false;
      case "Loud":
        return true;
    }
  },
} as const;

export type WasiExecModel = "Command" | "Reactor";
export const WasiExecModel = { Command: "Command", Reactor: "Reactor" } as const;
export const debug_WasiExecModel: Debug<WasiExecModel> = (v) => v;

/// How to run proc-macro code when building this crate
export type ProcMacroExecutionStrategy =
  /// Run the proc-macro code on the same thread as the server.
  | "SameThread"
  /// Run the proc-macro code on a different thread.
  | "CrossThread";
export const ProcMacroExecutionStrategy = { SameThread: "SameThread", CrossThread: "CrossThread" } as const;
export const debug_ProcMacroExecutionStrategy: Debug<ProcMacroExecutionStrategy> = (v) => v;

/// Which format to use for `-Z dump-mono-stats`
export type DumpMonoStatsFormat =
  /// Pretty-print a markdown table
  | "Markdown"
  /// Emit structured JSON
  | "Json";
export const DumpMonoStatsFormat = {
  Markdown: "Markdown",
  Json: "Json",

  // rustc: compiler/rustc_session/src/config.rs:3628 extension
  extension(self: DumpMonoStatsFormat): string {
    switch (self) {
      case "Markdown":
        return "md";
      case "Json":
        return "json";
    }
  },
} as const;
export const debug_DumpMonoStatsFormat: Debug<DumpMonoStatsFormat> = (v) => v;

/// `-Z patchable-function-entry` representation - how many nops to put before and after function
/// entry.
export class PatchableFunctionEntry {
  constructor(
    /// Nops before the entry
    public prefix_: number,
    /// Nops after the entry
    public entry_: number,
    /// An optional section name to record the entry location
    public section_: string | undefined,
  ) {}
  // PORT: the private fields `prefix`/`entry`/`section` are `prefix_`/`entry_`/`section_`: the
  // accessor methods of the same names would clash with them on the class.

  /** `#[derive(Default)]` */
  static default(): PatchableFunctionEntry {
    return new PatchableFunctionEntry(0, 0, undefined);
  }

  // rustc: compiler/rustc_session/src/config.rs:3649 from_parts
  static from_parts(total_nops: number, prefix_nops: number, section: string | undefined): PatchableFunctionEntry | undefined {
    if (total_nops < prefix_nops) {
      return undefined;
      // Section name cannot contain null characters.
    } else if (section !== undefined ? section.includes("\0") || section.length === 0 : false) {
      return undefined;
    } else {
      return new PatchableFunctionEntry(prefix_nops, total_nops - prefix_nops, section);
    }
  }
  // rustc: compiler/rustc_session/src/config.rs:3663 prefix
  prefix(): number {
    return this.prefix_;
  }
  // rustc: compiler/rustc_session/src/config.rs:3666 entry
  entry(): number {
    return this.entry_;
  }
  // rustc: compiler/rustc_session/src/config.rs:3669 section
  section(): string | undefined {
    return this.section_;
  }
}
export const debug_PatchableFunctionEntry: Debug<PatchableFunctionEntry> = (v, f) =>
  debug_struct(f, "PatchableFunctionEntry", [
    ["prefix", debug_int(v.prefix_, f)],
    ["entry", debug_int(v.entry_, f)],
    ["section", debug_option(v.section_, f, (s) => debug_str(s))],
  ]);

/// `-Zpolonius` values, enabling the borrow checker polonius analysis, and which version: legacy,
/// or future prototype.
export type Polonius =
  /// Polonius is disabled, only use NLL.
  | "Off"
  /// Legacy version, using datalog and the `polonius-engine` crate. Historical value for `-Zpolonius`.
  | "Legacy"
  /// In-tree prototype, extending the NLL infrastructure.
  | "Next";

// PORT: `option_env!("CFG_DEFAULT_POLONIUS_NEXT")` is read when rustc is built. Oracle evidence: the
// pinned nightly's `-Z help` describes `polonius` as "(default: next)" (POLONIUS_HELP with
// `Polonius::DEFAULT == Next`), so it is set; options.oracle.test.ts compares that listing.
const CFG_DEFAULT_POLONIUS_NEXT: string | undefined = "1";

export const Polonius = {
  Off: "Off",
  Legacy: "Legacy",
  Next: "Next",

  // rustc: compiler/rustc_session/src/config.rs:3689 default
  default(): Polonius {
    return Polonius.DEFAULT;
  },

  DEFAULT: (CFG_DEFAULT_POLONIUS_NEXT !== undefined ? "Next" : "Off") as Polonius,

  /// Returns whether the legacy version of polonius is enabled
  // rustc: compiler/rustc_session/src/config.rs:3699 is_legacy_enabled
  is_legacy_enabled(self: Polonius): boolean {
    return self === "Legacy";
  },

  /// Returns whether the "next" version of polonius is enabled
  // rustc: compiler/rustc_session/src/config.rs:3704 is_next_enabled
  is_next_enabled(self: Polonius): boolean {
    return self === "Next";
  },
} as const;
export const debug_Polonius: Debug<Polonius> = (v) => v;

export type InliningThreshold = { readonly $: "Always" } | { readonly $: "Sometimes"; readonly _0: number } | { readonly $: "Never" };
export const InliningThreshold = {
  Always: Object.freeze({ $: "Always" }) as InliningThreshold,
  Never: Object.freeze({ $: "Never" }) as InliningThreshold,

  // rustc: compiler/rustc_session/src/config.rs:3717 default
  default(): InliningThreshold {
    return { $: "Sometimes", _0: 100 };
  },
} as const;
export const debug_InliningThreshold: Debug<InliningThreshold> = (v, f) => (v.$ === "Sometimes" ? debug_tuple(f, "Sometimes", [debug_int(v._0, f)]) : v.$);

/// The different settings that the `-Zfunction-return` flag can have.
export type FunctionReturn =
  /// Keep the function return unmodified.
  | "Keep"
  /// Replace returns with jumps to thunk, without emitting the thunk.
  | "ThunkExtern";
export const FunctionReturn = {
  Keep: "Keep",
  ThunkExtern: "ThunkExtern",
  /** `#[derive(Default)]` (`#[default] Keep`) */
  default: (): FunctionReturn => "Keep",
} as const;
export const debug_FunctionReturn: Debug<FunctionReturn> = (v) => v;

/// Whether extra span comments are included when dumping MIR, via the `-Z mir-include-spans` flag.
/// By default, only enabled in the NLL MIR dumps, and disabled in all other passes.
export type MirIncludeSpans =
  | "Off"
  | "On"
  /// Default: include extra comments in NLL MIR dumps only. Can be ignored and considered as
  /// `Off` in all other cases.
  | "Nll";
export const MirIncludeSpans = {
  Off: "Off",
  On: "On",
  Nll: "Nll",
  /** `#[derive(Default)]` (`#[default] Nll`) */
  default: (): MirIncludeSpans => "Nll",

  /// Unless opting into extra comments for all passes, they can be considered disabled.
  /// The cases where a distinction between on/off and a per-pass value can exist will be handled
  /// in the passes themselves: i.e. the `Nll` value is considered off for all intents and
  /// purposes, except for the NLL MIR dump pass.
  // rustc: compiler/rustc_session/src/config.rs:3750 is_enabled
  is_enabled(self: MirIncludeSpans): boolean {
    return self === "On";
  },
} as const;
export const debug_MirIncludeSpans: Debug<MirIncludeSpans> = (v) => v;
