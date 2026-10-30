//! Contains infrastructure for configuring the compiler, including parsing
//! command-line options.
// Partial port of compiler/rustc_session/src/config.rs: the types that the `-C`/`-Z` option tables
// (options.rs) and the `Options` struct name, and the top-level CLI (`rustc_optgroups`,
// `build_session_options` and the `parse_*` fns it calls, `Options::default`, `nightly_options`,
// `PpMode`, `OutputType(s)`, `Input`, `OutFileName`, `OutputFilenames` (partly), `Sysroot`, `Externs`). Not ported:
// `dep_tracking`, `CrateType`/`Cfg` helpers of config/cfg.rs, and every fn that needs
// rustc_target beyond the stand-ins (see `bun scripts/coverage.ts --missing`).
//
// PORT: upstream `pub use crate::options::*;` is not mirrored: options.gen.ts reads `Polonius`
// from this module while it is evaluated (POLONIUS_HELP), so the options modules must be evaluated
// before this one. LOAD ORDER: import `./options.ts` before `./config.ts` (lib.ts and session.ts do);
// importing this module first fails at load with a TDZ error on `Polonius` in options.gen.ts. Use a
// bare `import "./options.ts";` for the ordering: Bun elides imports whose bindings are only used as types.
import { lstatSync, readFileSync, readlinkSync, statSync, writeFileSync, writeSync } from "node:fs";
import { availableParallelism } from "node:os";
import type { PathBuf } from "../rustc_error_messages/lib.ts";
import type { ColorConfig } from "../rustc_errors/emitter.ts";
import { HumanReadableErrorType, debug_HumanReadableErrorType } from "../rustc_errors/emitter.ts";
import type { DiagCtxtFlags } from "../rustc_errors/lib.ts";
import { UnstableFeatures } from "../rustc_feature/lib.ts";
import { Level } from "../rustc_lint_defs/lib.ts";
import {
  DEFAULT_EDITION,
  EDITION_NAME_LIST,
  EDITION_NAME_LIST_STABLE,
  Edition,
  Edition_discriminant,
  LATEST_STABLE_EDITION,
  display_Edition,
} from "../rustc_span/edition.ts";
import { type FileName, RealFileName, RemapPathScopeComponents, SourceFileHashAlgorithm, type SpanEncoder } from "../rustc_span/lib.ts";
import { FilePathMapping } from "../rustc_span/source_map.ts";
import { type Symbol, sym } from "../rustc_span/symbol.ts";
import { type Debug, debug_bool, debug_int, debug_map, debug_option, debug_str, debug_struct, debug_tuple, debug_vec } from "../std/fmt.ts";
import { type IoError, debug_IoError, display_IoError, io_error_from_node } from "../std/io.ts";
import { path_file_name, path_file_stem, path_hash, path_join, path_parent } from "../std/path.ts";
import { assert_eq, panic, unported, unwrap } from "../std/panic.ts";
import type { Decoder } from "../rustc_serialize/serialize.ts";
import { Err, Ok, type Result, unwrap_result } from "../std/result.ts";
import { utf8 as utf8_bytes, utf8_len } from "../std/str.ts";
import * as getopts from "../vendor/getopts/lib.ts";
import type { Session } from "./lib.ts";
import {
  CodegenOptions,
  CollectedOptions,
  Options,
  OptionsTargetModifiers,
  UnstableOptions,
  UnstableOptionsTargetModifiers,
  mitigation_coverage,
  usize_from_str,
  u8_from_str,
} from "./options.ts";
import * as print_request from "./config/print_request.ts";
import { parse_native_libs } from "./config/native_libs.ts";
import { split_extern_opt } from "./config/externs.ts";
import type { EarlyDiagCtxt as EarlyDiagCtxtReal } from "./session.ts";
import {
  type EarlyDiagCtxt,
  type LinkSelfContainedComponents,
  LinkSelfContainedComponents as LSCC,
  type LinkerFeatures,
  LinkerFeatures as LF,
  CrateType,
  type SanitizerSet,
  Target,
  TargetTuple,
  default_sysroot,
} from "./stand_ins.ts";
import type { CanonicalizedPath, NativeLib } from "./utils.ts";
import type { Align } from "../rustc_abi/lib.ts";
import type { RustcVersion } from "../rustc_ast/attr/version.ts";
import { type StableHasher, path_hasher } from "../rustc_data_structures/stable_hash.ts";
import { Hash64 } from "../rustc_hashes/lib.ts";
import { Level_discriminant } from "../rustc_lint_defs/lib.ts";
import { type CollapseMacroDebuginfo, CollapseMacroDebuginfo_discriminant } from "../rustc_structures/collapse_macro_debug_info.gen.ts";
import { CrateType_discriminant } from "../rustc_structures/crate_type.gen.ts";
import type {
  CodeModel,
  FramePointer,
  MergeFunctions,
  OnBrokenPipe,
  PanicStrategy,
  RelocModel,
  RelroLevel,
  SplitDebuginfo,
  StackProtector,
  SymbolVisibility,
  TlsModel,
} from "../rustc_target/spec/mod.ts";

/** `getopts::Matches` (the real type; `stand_ins.Matches` is the subset `build_options` uses). */
type Matches = getopts.Matches;

// pub use cfg::{Cfg, CheckCfg, ExpectedValues};
// PORT: config/cfg.ts imports this module, so only the type is re-exported here; import the classes
// from "./config/cfg.ts".
export type { Cfg, CheckCfg, ExpectedValues } from "./config/cfg.ts";
import type { Cfg } from "./config/cfg.ts";
import * as cfg_mod from "./config/cfg.ts";
import { SearchPath } from "./search_paths.ts";
import { spec as target_spec } from "../rustc_target/lib.ts";
import { edit_distance_with_substrings } from "../rustc_span/edit_distance.ts";

// PORT: `print!`/`eprintln!` -> synchronous writes to fd 1/2 (Rust's `Stdout` is line-buffered and
// `Stderr` unbuffered; the bytes written are the same).
// Root: move to src/std/io.ts.
function write_fd(fd: number, s: string): void {
  const buf = utf8_bytes(s);
  let off = 0;
  while (off < buf.length) {
    try {
      off += writeSync(fd, buf, off);
    } catch (e) {
      if ((e as { code?: string }).code === "EAGAIN") continue;
      throw e;
    }
  }
}
/** `print!("{s}")` */
export function std_print(s: string): void {
  write_fd(1, s);
}
/** `eprintln!("{s}")` */
function eprintln(s: string): void {
  write_fd(2, `${s}\n`);
}

/** `<String as Ord>::cmp`: byte-wise, which for UTF-8 is code point order. */
function str_cmp(a: string, b: string): number {
  const ai = a[globalThis.Symbol.iterator]();
  const bi = b[globalThis.Symbol.iterator]();
  for (;;) {
    const x = ai.next();
    const y = bi.next();
    if (x.done) return y.done ? 0 : -1;
    if (y.done) return 1;
    const cx = x.value.codePointAt(0)!;
    const cy = y.value.codePointAt(0)!;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}

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

/// This is what the `LtoCli` values get mapped to after resolving defaults and
/// and taking other command line options into account.
///
/// Note that linker plugin-based LTO is a different mechanism entirely.
// #[derive(Clone, PartialEq, Encodable, Decodable)]
export type Lto =
  /// Don't do any LTO whatsoever.
  | "No"

  /// Do a full-crate-graph (inter-crate) LTO with ThinLTO.
  | "Thin"

  /// Do a local ThinLTO (intra-crate, over the CodeGen Units of the local crate only). This is
  /// only relevant if multiple CGUs are used.
  | "ThinLocal"

  /// Do a full-crate-graph (inter-crate) LTO with "fat" LTO.
  | "Fat";
export const Lto = { No: "No", Thin: "Thin", ThinLocal: "ThinLocal", Fat: "Fat" } as const;

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
  check_unstable_variants(target_tuple: TargetTuple): Result<undefined, string> {
    if (this.explicitly_set !== undefined) {
      return Ok(undefined);
    }

    // `-C link-self-contained=-linker` is only stable on x64 linux.
    const has_minus_linker = (this.disabled_components & LSCC.LINKER) === LSCC.LINKER;
    if (has_minus_linker && TargetTuple.tuple(target_tuple) !== "x86_64-unknown-linux-gnu") {
      return Err(
        `\`-C link-self-contained=-linker\` is unstable on the \`${TargetTuple.display(target_tuple)}\` target. The \`-Z unstable-options\` flag must also be passed to use it on this target`,
      );
    }

    // Any `+linker` or other component used is unstable, and that's an error.
    const unstable_enabled = this.enabled_components;
    const unstable_disabled = this.disabled_components & ~LSCC.LINKER;
    if ((unstable_enabled | unstable_disabled) !== 0) {
      return Err(
        "only `-C link-self-contained` values `y`/`yes`/`on`/`n`/`no`/`off`/`-linker` are stable, the `-Z unstable-options` flag must also be passed to use the unstable values",
      );
    }

    return Ok(undefined);
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
  check_unstable_variants(target_tuple: TargetTuple): Result<undefined, string> {
    // `-C linker-features=-lld` is only stable on x64 linux.
    const has_minus_lld = LF.is_lld_enabled(this.disabled);
    if (has_minus_lld && TargetTuple.tuple(target_tuple) !== "x86_64-unknown-linux-gnu") {
      return Err(
        `\`-C linker-features=-lld\` is unstable on the \`${TargetTuple.display(target_tuple)}\` target. The \`-Z unstable-options\` flag must also be passed to use it on this target`,
      );
    }

    // Any `+lld` or non-lld feature used is unstable, and that's an error.
    const unstable_enabled = this.enabled;
    const unstable_disabled = this.disabled & ~LF.LLD;
    if ((unstable_enabled | unstable_disabled) !== 0) {
      const unstable_features: string[] = [
        ...LF.iter(unstable_enabled).map((f) => `+${unwrap(LF.as_str(f))}`),
        ...LF.iter(unstable_disabled).map((f) => `-${unwrap(LF.as_str(f))}`),
      ];
      return Err(
        `\`-C linker-features=${unstable_features.join(",")}\` is unstable, and also requires the \`-Z unstable-options\` flag to be used`,
      );
    }

    return Ok(undefined);
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
/**
 * `#[derive(BlobDecodable)]` of `SymbolManglingVersion` (config.rs:607; rustc_macros serialize.rs `decodable_body`:
 * the variant index as `read_u8`). PORT: hand-expanded: syn cannot parse config.rs, so no tools/codegen set can
 * generate it; reached through tools/codegen/serialize.json.
 */
export function decode_SymbolManglingVersion(__decoder: Decoder): SymbolManglingVersion {
  const __tag = __decoder.read_u8();
  switch (__tag) {
    case 0:
      return "Legacy";
    case 1:
      return "V0";
    case 2:
      return "Hashed";
    default:
      return panic(`invalid enum variant tag while decoding \`SymbolManglingVersion\`, expected 0..3, actual ${__tag}`);
  }
}
/**
 * `#[derive(Encodable)]` of `SymbolManglingVersion` (rustc_macros serialize.rs `encodable_body`: the variant index as `emit_u8`).
 * PORT (lane encode-contract): hand-expanded like `decode_SymbolManglingVersion` (syn cannot parse config.rs).
 */
export function encode_SymbolManglingVersion(self: SymbolManglingVersion, __encoder: SpanEncoder): void {
  let disc: number;
  switch (self) {
    case "Legacy":
      disc = 0;
      break;
    case "V0":
      disc = 1;
      break;
    case "Hashed":
      disc = 2;
      break;
  }
  __encoder.emit_u8(disc);
}
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

// macro_rules! define_output_types (config.rs:668), expanded by hand for the table at config.rs:776.
// PORT: the per-variant data is the `OUTPUT_TYPE_TABLE` row; each generated fn reads its column.
// `StableOrd` (config.rs:690) is a marker impl (no fns).
// #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, PartialOrd, Ord, StableHash)]
// #[derive(Encodable, Decodable)]
export type OutputType =
  | "Assembly"
  /// This is the optimized bitcode, which could be either pre-LTO or non-LTO bitcode,
  /// depending on the specific request type.
  | "Bitcode"
  | "DepInfo"
  | "Exe"
  | "LlvmAssembly"
  | "Metadata"
  | "Mir"
  | "Object"
  /// This is the summary or index data part of the ThinLTO bitcode.
  | "ThinLinkBitcode";

interface OutputTypeRow {
  shorthand: string;
  extension: string;
  description: string;
  default_filename: string;
  is_text: boolean;
  compatible_with_cgus_and_single_output: boolean;
}

// The `define_output_types!` invocation (config.rs:776), in declaration order.
const OUTPUT_TYPE_TABLE: ReadonlyMap<OutputType, OutputTypeRow> = new Map<OutputType, OutputTypeRow>([
  ["Assembly", { shorthand: "asm", extension: "s", description: "Generates a file with the crate's assembly code", default_filename: "CRATE_NAME.s", is_text: true, compatible_with_cgus_and_single_output: false }],
  ["Bitcode", { shorthand: "llvm-bc", extension: "bc", description: "Generates a binary file containing the LLVM bitcode", default_filename: "CRATE_NAME.bc", is_text: false, compatible_with_cgus_and_single_output: false }],
  ["DepInfo", { shorthand: "dep-info", extension: "d", description: "Generates a file with Makefile syntax that indicates all the source files that were loaded to generate the crate", default_filename: "CRATE_NAME.d", is_text: true, compatible_with_cgus_and_single_output: true }],
  ["Exe", { shorthand: "link", extension: "", description: "Generates the crates specified by --crate-type. This is the default if --emit is not specified", default_filename: "(platform and crate-type dependent)", is_text: false, compatible_with_cgus_and_single_output: true }],
  ["LlvmAssembly", { shorthand: "llvm-ir", extension: "ll", description: "Generates a file containing LLVM IR", default_filename: "CRATE_NAME.ll", is_text: true, compatible_with_cgus_and_single_output: false }],
  ["Metadata", { shorthand: "metadata", extension: "rmeta", description: "Generates a file containing metadata about the crate", default_filename: "libCRATE_NAME.rmeta", is_text: false, compatible_with_cgus_and_single_output: true }],
  ["Mir", { shorthand: "mir", extension: "mir", description: "Generates a file containing rustc's mid-level intermediate representation", default_filename: "CRATE_NAME.mir", is_text: true, compatible_with_cgus_and_single_output: false }],
  ["Object", { shorthand: "obj", extension: "o", description: "Generates a native object file", default_filename: "CRATE_NAME.o", is_text: false, compatible_with_cgus_and_single_output: false }],
  ["ThinLinkBitcode", { shorthand: "thin-link-bitcode", extension: "indexing.o", description: "Generates the ThinLTO summary as bitcode", default_filename: "CRATE_NAME.indexing.o", is_text: false, compatible_with_cgus_and_single_output: false }],
]);

function output_type_row(self: OutputType): OutputTypeRow {
  return OUTPUT_TYPE_TABLE.get(self)!;
}

export const OutputType = {
  Assembly: "Assembly",
  Bitcode: "Bitcode",
  DepInfo: "DepInfo",
  Exe: "Exe",
  LlvmAssembly: "LlvmAssembly",
  Metadata: "Metadata",
  Mir: "Mir",
  Object: "Object",
  ThinLinkBitcode: "ThinLinkBitcode",

  // rustc: compiler/rustc_session/src/config.rs:699 iter_all
  iter_all(): OutputType[] {
    return [...OUTPUT_TYPE_TABLE.keys()];
  },

  // rustc: compiler/rustc_session/src/config.rs:708 is_compatible_with_codegen_units_and_single_output_file
  is_compatible_with_codegen_units_and_single_output_file(self: OutputType): boolean {
    return output_type_row(self).compatible_with_cgus_and_single_output;
  },

  // rustc: compiler/rustc_session/src/config.rs:716 shorthand
  shorthand(self: OutputType): string {
    return output_type_row(self).shorthand;
  },

  // rustc: compiler/rustc_session/src/config.rs:724 from_shorthand
  from_shorthand(shorthand: string): OutputType | undefined {
    for (const [v, row] of OUTPUT_TYPE_TABLE) {
      if (shorthand === row.shorthand) return v;
    }
    return undefined;
  },

  // rustc: compiler/rustc_session/src/config.rs:733 shorthands_display
  shorthands_display(): string {
    const shorthands = [...OUTPUT_TYPE_TABLE.values()].map((row) => `\`${row.shorthand}\``);
    return shorthands.join(", ");
  },

  // rustc: compiler/rustc_session/src/config.rs:742 extension
  extension(self: OutputType): string {
    return output_type_row(self).extension;
  },

  // rustc: compiler/rustc_session/src/config.rs:750 is_text_output
  is_text_output(self: OutputType): boolean {
    return output_type_row(self).is_text;
  },

  // rustc: compiler/rustc_session/src/config.rs:758 description
  description(self: OutputType): string {
    return output_type_row(self).description;
  },

  // rustc: compiler/rustc_session/src/config.rs:766 default_filename
  default_filename(self: OutputType): string {
    return output_type_row(self).default_filename;
  },
} as const;
/** `#[derive(PartialOrd, Ord)]`: declaration order. */
export const OutputType_discriminant: Record<OutputType, number> = {
  Assembly: 0,
  Bitcode: 1,
  DepInfo: 2,
  Exe: 3,
  LlvmAssembly: 4,
  Metadata: 5,
  Mir: 6,
  Object: 7,
  ThinLinkBitcode: 8,
};
export const debug_OutputType: Debug<OutputType> = (v) => v;

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

/// Use tree-based collections to cheaply get a deterministic `Hash` implementation.
/// *Do not* switch `BTreeMap` out for an unsorted container type! That would break
/// dependency tracking for command-line arguments. Also only hash keys, since tracking
/// should only depend on the output types, not the paths they're written to.
// #[derive(Clone, Debug, Hash, StableHash, Encodable, Decodable)]
// PORT: `BTreeMap<OutputType, Option<OutFileName>>` -> a `Map` kept sorted by `OutputType` order
// (`sorted_output_types`); every insertion goes through `OutputTypes.insert_sorted`.
export class OutputTypes {
  constructor(public _0: Map<OutputType, OutFileName | undefined>) {}

  // rustc: compiler/rustc_session/src/config.rs:897 new
  static new(entries: readonly [OutputType, OutFileName | undefined][]): OutputTypes {
    return new OutputTypes(sorted_output_types(new Map(entries)));
  }

  // rustc: compiler/rustc_session/src/config.rs:901 get
  get(key: OutputType): { $: "Some"; _0: OutFileName | undefined } | undefined {
    // PORT: `Option<&Option<OutFileName>>` -> `{ $: "Some", _0 } | undefined`.
    return this._0.has(key) ? { $: "Some", _0: this._0.get(key) } : undefined;
  }

  // rustc: compiler/rustc_session/src/config.rs:905 contains_key
  contains_key(key: OutputType): boolean {
    return this._0.has(key);
  }

  /// Returns `true` if user specified a name and not just produced type
  // rustc: compiler/rustc_session/src/config.rs:910 contains_explicit_name
  contains_explicit_name(key: OutputType): boolean {
    return this._0.get(key) !== undefined;
  }

  // rustc: compiler/rustc_session/src/config.rs:914 iter
  iter(): IterableIterator<[OutputType, OutFileName | undefined]> {
    return this._0.entries();
  }

  // rustc: compiler/rustc_session/src/config.rs:918 keys
  keys(): IterableIterator<OutputType> {
    return this._0.keys();
  }

  // rustc: compiler/rustc_session/src/config.rs:922 values
  values(): IterableIterator<OutFileName | undefined> {
    return this._0.values();
  }

  // rustc: compiler/rustc_session/src/config.rs:926 len
  len(): number {
    return this._0.size;
  }

  /// Returns `true` if any of the output types require codegen or linking.
  // rustc: compiler/rustc_session/src/config.rs:931 should_codegen
  should_codegen(): boolean {
    return [...this._0.keys()].some((k) => {
      switch (k) {
        case "Bitcode":
        case "ThinLinkBitcode":
        case "Assembly":
        case "LlvmAssembly":
        case "Mir":
        case "Object":
        case "Exe":
          return true;
        case "Metadata":
        case "DepInfo":
          return false;
      }
    });
  }

  /// Returns `true` if any of the output types require linking.
  // rustc: compiler/rustc_session/src/config.rs:945 should_link
  should_link(): boolean {
    return [...this._0.keys()].some((k) => {
      switch (k) {
        case "Bitcode":
        case "ThinLinkBitcode":
        case "Assembly":
        case "LlvmAssembly":
        case "Mir":
        case "Metadata":
        case "Object":
        case "DepInfo":
          return false;
        case "Exe":
          return true;
      }
    });
  }
}

/** `BTreeMap` order of `OutputType` keys (derived `Ord`: declaration order). */
function sorted_output_types<V>(m: Map<OutputType, V>): Map<OutputType, V> {
  return new Map([...m].sort((a, b) => OutputType_discriminant[a[0]] - OutputType_discriminant[b[0]]));
}

export const debug_OutputTypes: Debug<OutputTypes> = (v, f) =>
  debug_tuple(f, "OutputTypes", [
    debug_map(
      f,
      [...v._0].map(([k, p]): [string, string] => [debug_OutputType(k, f), debug_option(p, f, debug_OutFileName)]),
    ),
  ]);

/// Use tree-based collections to cheaply get a deterministic `Hash` implementation.
/// *Do not* switch `BTreeMap` or `BTreeSet` out for an unsorted container type! That
/// would break dependency tracking for command-line arguments.
// #[derive(Clone)]
// PORT: `BTreeMap<String, ExternEntry>` -> `Map` kept sorted by key (code-point order, like `String: Ord`).
export class Externs {
  constructor(public _0: Map<string, ExternEntry>) {}

  /// Used for testing.
  // rustc: compiler/rustc_session/src/config.rs:1010 new
  static new(data: Map<string, ExternEntry>): Externs {
    return new Externs(data);
  }

  // rustc: compiler/rustc_session/src/config.rs:1014 get
  get(key: string): ExternEntry | undefined {
    return this._0.get(key);
  }

  // rustc: compiler/rustc_session/src/config.rs:1018 iter
  iter(): IterableIterator<[string, ExternEntry]> {
    return this._0.entries();
  }
}

// #[derive(Clone, Debug)]
export class ExternEntry {
  constructor(
    public location: ExternLocation,
    /// Indicates this is a "private" dependency for the
    /// `exported_private_dependencies` lint.
    ///
    /// This can be set with the `priv` option like
    /// `--extern priv:name=foo.rlib`.
    public is_private_dep: boolean,
    /// Add the extern entry to the extern prelude.
    ///
    /// This can be disabled with the `noprelude` option like
    /// `--extern noprelude:name`.
    public add_prelude: boolean,
    /// The extern entry shouldn't be considered for unused dependency warnings.
    ///
    /// `--extern nounused:std=/path/to/lib/libstd.rlib`. This is used to
    /// suppress `unused-crate-dependencies` warnings.
    public nounused_dep: boolean,
    /// If the extern entry is not referenced in the crate, force it to be resolved anyway.
    ///
    /// Allows a dependency satisfying, for instance, a missing panic handler to be injected
    /// without modifying source:
    /// `--extern force:extras=/path/to/lib/libstd.rlib`
    public force: boolean,
  ) {}

  // rustc: compiler/rustc_session/src/config.rs:1024 new
  static new(location: ExternLocation): ExternEntry {
    return new ExternEntry(location, false, false, false, false);
  }

  // rustc: compiler/rustc_session/src/config.rs:1034 files
  files(): IterableIterator<CanonicalizedPath> | undefined {
    const location = this.location;
    if (location.$ === "ExactPaths") return location._0.values();
    return undefined;
  }
}

// #[derive(Clone, Debug)]
export type ExternLocation =
  /// Indicates to look for the library in the search paths.
  ///
  /// Added via `--extern name`.
  | { readonly $: "FoundInLibrarySearchDirectories" }
  /// The locations where this extern entry must be found.
  ///
  /// The `CrateLoader` is responsible for loading these and figuring out
  /// which one to use.
  ///
  /// Added via `--extern prelude_name=some_file.rlib`
  // PORT: `BTreeSet<CanonicalizedPath>` -> `Set` (insertion order; `--extern` with paths is unported).
  | { readonly $: "ExactPaths"; readonly _0: Set<CanonicalizedPath> };
export const ExternLocation = {
  FoundInLibrarySearchDirectories: Object.freeze({ $: "FoundInLibrarySearchDirectories" }) as ExternLocation,
} as const;

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

// #[derive(Clone)]
export type Input =
  /// Load source code from a file.
  | { readonly $: "File"; readonly _0: PathBuf }
  /// Load source code from a doctest string.
  | {
      readonly $: "DocTestStr";
      /// The file associated with this input.
      readonly file: PathBuf;
      // Line associated with this input
      readonly line: number;
      /// An anonymous string containing the source code.
      readonly input: string;
    }
  /// Load source code from a string.
  | {
      readonly $: "Str";
      /// A string that is shown in place of a filename.
      readonly name: FileName;
      /// An anonymous string containing the source code.
      readonly input: string;
    };
export const Input = {
  // rustc: compiler/rustc_session/src/config.rs:1084 filestem
  filestem(self: Input): string {
    if (self.$ === "File") {
      // If for some reason getting the file stem as a UTF-8 string fails,
      // then fallback to a fixed name.
      const name = path_file_stem(self._0); // PORT: paths are JS strings, so `to_str` always succeeds.
      if (name !== undefined) {
        return name;
      }
    }
    return "rust_out";
  },

  // rustc: compiler/rustc_session/src/config.rs:1095 file_name
  file_name(self: Input, session: Session): FileName {
    switch (self.$) {
      case "File":
        return {
          $: "Real",
          _0: session.psess.source_map().path_mapping().to_real_filename(session.psess.source_map().working_dir(), self._0),
        };
      case "DocTestStr":
        return {
          $: "DocTest",
          _0: session.psess.source_map().path_mapping().to_real_filename(session.psess.source_map().working_dir(), self.file),
          _1: self.line,
        };
      case "Str":
        return self.name;
    }
  },

  // rustc: compiler/rustc_session/src/config.rs:1116 opt_path
  opt_path(self: Input): PathBuf | undefined {
    switch (self.$) {
      case "File":
        return self._0;
      case "DocTestStr":
        return self.file;
      case "Str": {
        const name = self.name;
        switch (name.$) {
          case "Real":
            return name._0.local_path();
          case "CfgSpec":
            return undefined;
          case "Anon":
            return undefined;
          case "MacroExpansion":
            return undefined;
          case "ProcMacroSourceCode":
            return undefined;
          case "CliCrateAttr":
            return undefined;
          case "Custom":
            return undefined;
          case "DocTest":
            return name._0.local_path();
          case "InlineAsm":
            return undefined;
        }
      }
    }
  },
} as const;

// #[derive(Clone, Hash, Debug, StableHash, PartialEq, Eq, Encodable, Decodable)]
export type OutFileName = { readonly $: "Real"; readonly _0: PathBuf } | { readonly $: "Stdout" };
export const OutFileName = {
  Stdout: Object.freeze({ $: "Stdout" }) as OutFileName,

  // rustc: compiler/rustc_session/src/config.rs:1142 parent
  parent(self: OutFileName): PathBuf | undefined {
    switch (self.$) {
      case "Real":
        return path_parent(self._0);
      case "Stdout":
        return undefined;
    }
  },

  // rustc: compiler/rustc_session/src/config.rs:1149 filestem
  filestem(self: OutFileName): string | undefined {
    switch (self.$) {
      case "Real":
        return path_file_stem(self._0);
      case "Stdout":
        return "stdout";
    }
  },

  // rustc: compiler/rustc_session/src/config.rs:1156 is_stdout
  is_stdout(self: OutFileName): boolean {
    switch (self.$) {
      case "Real":
        return false;
      case "Stdout":
        return true;
    }
  },

  // rustc: compiler/rustc_session/src/config.rs:1163 is_tty
  is_tty(self: OutFileName): boolean {
    switch (self.$) {
      case "Real":
        return false;
      case "Stdout":
        return process.stdout.isTTY === true;
    }
  },

  // rustc: compiler/rustc_session/src/config.rs:1171 as_path
  as_path(self: OutFileName): PathBuf {
    switch (self.$) {
      case "Real":
        return self._0;
      case "Stdout":
        return "stdout";
    }
  },

  /// For a given output filename, return the actual name of the file that
  /// can be used to write codegen data of type `flavor`. For real-path
  /// output filenames, this would be trivial as we can just use the path.
  /// Otherwise for stdout, return a temporary path so that the codegen data
  /// may be later copied to stdout.
  // rustc: compiler/rustc_session/src/config.rs:1183 file_for_writing
  file_for_writing(self: OutFileName, _outputs: unknown, _flavor: OutputType, _codegen_unit_name: string): PathBuf {
    switch (self.$) {
      case "Real":
        return self._0;
      case "Stdout":
        return unported("rustc_session::config::OutputFilenames::temp_path_for_cgu");
    }
  },

  // rustc: compiler/rustc_session/src/config.rs:1195 overwrite
  overwrite(self: OutFileName, content: string, sess: Session): void {
    switch (self.$) {
      case "Stdout":
        // PORT: `print!` -> the driver's buffered stdout (`std_print`), flushed at exit like Rust's `Stdout`.
        std_print(content);
        return;
      case "Real": {
        const path = self._0;
        try {
          writeFileSync(path, content);
        } catch (e) {
          // `sess.dcx().emit_fatal(FileWriteFail { path, err: e.to_string() })`
          return unported(`rustc_session::diagnostics::FileWriteFail (${display_IoError(io_error_from_node(e))})`);
        }
        return;
      }
    }
  },
} as const;
export const debug_OutFileName: Debug<OutFileName> = (v, f) => (v.$ === "Real" ? debug_tuple(f, "Real", [debug_str(v._0)]) : "Stdout");

// #[derive(Clone, Hash, Debug, StableHash, Encodable, Decodable)]
// PORT (driver-m2): `OutputFilenames` and the `impl` fns on the `-Zunpretty`/dep-info path. The codegen-unit
// temp paths (`temp_path_for_cgu`, `temp_path_dwo_for_cgu`, `temp_path_ext_for_cgu`, `maybe_strip_file_name`,
// `split_dwarf_path`) are not ported (codegen).
export class OutputFilenames {
  constructor(
    public out_directory: PathBuf,
    /// Crate name. Never contains '-'.
    public crate_stem: string,
    /// Typically based on `.rs` input file name. Any '-' is preserved.
    public filestem: string,
    public single_output_file: OutFileName | undefined,
    public temps_directory: PathBuf | undefined,
    /// A random string generated per invocation of rustc.
    ///
    /// This is prepended to all temporary files so that they do not collide
    /// during concurrent invocations of rustc, or past invocations that were
    /// preserved with a flag like `-C save-temps`, since these files may be
    /// hard linked.
    // This does not affect incr comp outputs, only where temp files are stored.
    // #[stable_hash(ignore)]
    public invocation_temp: string | undefined,
    public explicit_dwo_out_directory: PathBuf | undefined,
    public outputs: OutputTypes,
  ) {}

  // rustc: compiler/rustc_session/src/config.rs:1263 new
  static new(
    out_directory: PathBuf,
    out_crate_name: string,
    out_filestem: string,
    single_output_file: OutFileName | undefined,
    temps_directory: PathBuf | undefined,
    invocation_temp: string | undefined,
    explicit_dwo_out_directory: PathBuf | undefined,
    extra: string,
    outputs: OutputTypes,
  ): OutputFilenames {
    return new OutputFilenames(
      out_directory,
      `${out_crate_name}${extra}`,
      `${out_filestem}${extra}`,
      single_output_file,
      temps_directory,
      invocation_temp,
      explicit_dwo_out_directory,
      outputs,
    );
  }

  // rustc: compiler/rustc_session/src/config.rs:1286 path
  path(flavor: OutputType): OutFileName {
    const p = this.outputs.get(flavor);
    return (p !== undefined ? p._0 : undefined) ?? this.single_output_file ?? { $: "Real", _0: this.output_path(flavor) };
  }

  // rustc: compiler/rustc_session/src/config.rs:1294 interface_path
  interface_path(): PathBuf {
    // debug!("using crate_name={} for interface_path", self.crate_stem);
    return path_join(this.out_directory, `lib${this.crate_stem}.rs`);
  }

  /// Gets the output path where a compilation artifact of the given type
  /// should be placed on disk.
  // rustc: compiler/rustc_session/src/config.rs:1301 output_path
  output_path(flavor: OutputType): PathBuf {
    const extension = OutputType.extension(flavor);
    switch (flavor) {
      case "Metadata":
        // debug!("using crate_name={} for {extension}", self.crate_stem);
        return path_join(this.out_directory, `lib${this.crate_stem}.${extension}`);
      default:
        return this.with_directory_and_extension(this.out_directory, extension);
    }
  }

  // rustc: compiler/rustc_session/src/config.rs:1356 temp_path_for_diagnostic
  temp_path_for_diagnostic(ext: string): PathBuf {
    const temps_directory = this.temps_directory ?? this.out_directory;
    return this.with_directory_and_extension(temps_directory, ext);
  }

  // rustc: compiler/rustc_session/src/config.rs:1361 with_extension
  with_extension(extension: string): PathBuf {
    return this.with_directory_and_extension(this.out_directory, extension);
  }

  // rustc: compiler/rustc_session/src/config.rs:1365 with_directory_and_extension
  with_directory_and_extension(directory: PathBuf, extension: string): PathBuf {
    // debug!("using filestem={} for {extension}", self.filestem);
    const path = path_join(directory, this.filestem);
    return path_set_extension(path, extension)[0];
  }
}

/**
 * `PathBuf::set_extension` (library/std/src/path.rs `_set_extension`): returns the new path and whether
 * it changed (`false` when there is no file name). PORT (driver-m2): not in src/std/path.ts yet; move it
 * there. `Path::with_extension` is `path_set_extension(p, ext)[0]`.
 */
export function path_set_extension(self_: PathBuf, extension: string): [PathBuf, boolean] {
  const file_stem = path_file_stem(self_);
  if (file_stem === undefined) return [self_, false];
  // truncate until right after the file stem: the file stem is a prefix of the file name, the last
  // normal component (only separators and `.` components can follow it).
  const file_name = path_file_name(self_)!;
  const end_file_stem = self_.lastIndexOf(file_name) + file_stem.length;
  let inner = self_.slice(0, end_file_stem);
  // add the new extension, if any
  if (extension.length !== 0) {
    inner += "." + extension;
  }
  return [inner, true];
}

// pub for rustdoc
// rustc: compiler/rustc_session/src/config.rs:1399 parse_remap_path_scope
export function parse_remap_path_scope(early_dcx: EarlyDiagCtxt, matches: Matches, unstable_opts: UnstableOptions): RemapPathScopeComponents {
  const v = matches.opt_str("remap-path-scope");
  if (v !== undefined) {
    let slot = RemapPathScopeComponents.empty();
    for (const s of v.split(",")) {
      let bits: RemapPathScopeComponents;
      switch (s) {
        case "macro":
          bits = RemapPathScopeComponents.MACRO;
          break;
        case "diagnostics":
          bits = RemapPathScopeComponents.DIAGNOSTICS;
          break;
        case "documentation":
          if (!unstable_opts.unstable_options) {
            early_dcx.early_fatal("remapping `documentation` path scope requested but `-Zunstable-options` not specified");
          }

          bits = RemapPathScopeComponents.DOCUMENTATION;
          break;
        case "debuginfo":
          bits = RemapPathScopeComponents.DEBUGINFO;
          break;
        case "coverage":
          bits = RemapPathScopeComponents.COVERAGE;
          break;
        case "object":
          bits = RemapPathScopeComponents.OBJECT;
          break;
        case "all":
          bits = RemapPathScopeComponents.all();
          break;
        default:
          early_dcx.early_fatal(
            "argument for `--remap-path-scope` must be a comma separated list of scopes: `macro`, `diagnostics`, `documentation`, `debuginfo`, `coverage`, `object`, `all`",
          );
      }
      slot |= bits;
    }
    return slot;
  } else {
    return RemapPathScopeComponents.all();
  }
}

// #[derive(Clone, Debug)]
export class Sysroot {
  constructor(
    public explicit: PathBuf | undefined,
    public default_: PathBuf,
  ) {}

  // rustc: compiler/rustc_session/src/config.rs:1437 new
  static new(explicit: PathBuf | undefined): Sysroot {
    return new Sysroot(explicit, default_sysroot());
  }

  /// Return explicit sysroot if it was passed with `--sysroot`, or default sysroot otherwise.
  // rustc: compiler/rustc_session/src/config.rs:1442 path
  path(): PathBuf {
    return this.explicit ?? this.default_;
  }

  /// Returns both explicit sysroot if it was passed with `--sysroot` and the default sysroot.
  // rustc: compiler/rustc_session/src/config.rs:1447 all_paths
  all_paths(): PathBuf[] {
    return [...(this.explicit !== undefined ? [this.explicit] : []), this.default_];
  }
}
// PORT: the field `default` is `default_` (reserved word as a constructor parameter name).

/// Get the host triple out of the build environment. This ensures that our
/// idea of the host triple is the same as for the set of libraries we've
/// actually built. We can't just take LLVM's host triple because they
/// normalize all ix86 architectures to i386.
// rustc: compiler/rustc_session/src/config.rs:1456 host_tuple
export function host_tuple(): string {
  // Instead of grabbing the host triple (for the current host), we grab (at
  // compile time) the target triple that this rustc is built with and
  // calling that (at runtime) the host triple.
  // `option_env!("CFG_COMPILER_HOST_TRIPLE").expect("CFG_COMPILER_HOST_TRIPLE")`
  return CFG_COMPILER_HOST_TRIPLE ?? unported("CFG_COMPILER_HOST_TRIPLE (set RUST_TS_HOST_TUPLE in .env.local to the oracle's `rustc -vV` host)");
}

/**
 * PORT: `option_env!("CFG_COMPILER_HOST_TRIPLE")` is a build constant of the oracle rustc: the tuple it was
 * built for (its `rustc -vV` `host:` line). rust-ts mirrors the oracle installed on the same machine, so the
 * value is recorded per machine as `RUST_TS_HOST_TUPLE` (the environment, else the repo's `.env.local`)
 * and checked against `rustc -vV` by src/rustc_driver_impl/print.oracle.test.ts. Without it the host
 * tuple is unknown and `host_tuple()` calls `unported`.
 */
const CFG_COMPILER_HOST_TRIPLE: string | undefined = ((): string | undefined => {
  const v = process.env.RUST_TS_HOST_TUPLE;
  if (v !== undefined) return v;
  try {
    const env_local = readFileSync(path_join(import.meta.dir, "../../.env.local"), "utf8");
    for (const line of env_local.split(/\r?\n/)) {
      const m = /^\s*RUST_TS_HOST_TUPLE\s*=\s*(\S+)\s*$/.exec(line);
      if (m) return m[1];
    }
  } catch {
    // no .env.local
  }
  return undefined;
})();

// rustc: compiler/rustc_session/src/config.rs:1463 file_path_mapping
function file_path_mapping(
  remap_path_prefix: [PathBuf, PathBuf][],
  remap_cwd_prefix: PathBuf | undefined,
  remap_path_scope: RemapPathScopeComponents,
): FilePathMapping {
  // Apply `-Zremap-cwd-prefix` here rather than in `parse_remap_path_prefix`, so the
  // absolute cwd is never stored in the tracked `remap_path_prefix` option (#132132).
  let cwd_remap: [PathBuf, PathBuf] | undefined;
  const to = remap_cwd_prefix;
  const cwd = to !== undefined ? env_current_dir() : undefined;
  if (to !== undefined && cwd !== undefined && cwd.$ === "Ok") {
    cwd_remap = [cwd._0, to];
  } else {
    cwd_remap = undefined;
  }
  // The cwd remapping is appended last: `map_prefix` tries entries in reverse order, so this
  // keeps `-Zremap-cwd-prefix` taking precedence over `--remap-path-prefix`, as documented.
  return FilePathMapping.new([...remap_path_prefix, ...(cwd_remap !== undefined ? [cwd_remap] : [])], remap_path_scope);
}

/** `std::env::current_dir()` */
function env_current_dir(): Result<PathBuf, IoError> {
  try {
    return Ok(process.cwd());
  } catch (e) {
    return Err(io_error_from_node(e));
  }
}

/** `impl Default for Options` (PORT: a free fn; the generated `Options` class has no `default`). */
// rustc: compiler/rustc_session/src/config.rs:1483 default
export function Options_default(): Options {
  const unstable_opts = UnstableOptions.default();

  // FIXME(Urgau): This is a hack that ideally shouldn't exist, but rustdoc
  // currently uses this `Default` implementation, so we have no choice but
  // to create a default working directory.
  const working_dir = ((): RealFileName => {
    const working_dir = unwrap_result(env_current_dir(), debug_IoError);
    const file_mapping = file_path_mapping([], undefined, RemapPathScopeComponents.empty());
    return file_mapping.to_real_filename(RealFileName.empty(), working_dir);
  })();

  // PORT: `Options { .. }` -> the generated constructor (field order of `top_level_options!`).
  return new Options(
    /* crate_types */ [],
    /* optimize */ "No",
    /* debug_assertions */ true,
    /* debuginfo */ "None",
    /* lint_opts */ [],
    /* lint_cap */ undefined,
    /* describe_lints */ false,
    /* output_types */ new OutputTypes(new Map()),
    /* search_paths */ [],
    /* libs */ [],
    /* sysroot */ Sysroot.new(undefined),
    /* target_triple */ TargetTuple.from_tuple(host_tuple()),
    /* test */ false,
    /* error_format */ ErrorOutputType.default(),
    /* diagnostic_width */ undefined,
    /* incremental */ undefined,
    /* unstable_opts */ unstable_opts,
    /* prints */ [],
    /* cg */ CodegenOptions.default(),
    /* externs */ new Externs(new Map()),
    /* crate_name */ undefined,
    /* unstable_features */ "Disallow",
    /* actually_rustdoc */ false,
    /* resolve_doc_links */ "None",
    /* trimmed_def_paths */ false,
    /* cli_forced_codegen_units */ undefined,
    /* cli_forced_local_thinlto_off */ false,
    /* remap_path_prefix */ [],
    /* remap_path_scope */ RemapPathScopeComponents.all(),
    /* real_rust_source_base_dir */ undefined,
    /* real_rustc_dev_source_base_dir */ undefined,
    /* edition */ DEFAULT_EDITION,
    /* json_artifact_notifications */ false,
    /* json_timings */ false,
    /* json_unused_externs */ "No",
    /* json_future_incompat */ false,
    /* pretty */ undefined,
    /* working_dir */ working_dir,
    /* color */ "Auto",
    /* verbose */ false,
    /* jobs */ { frontend: undefined, backend: undefined, linker: LinkerJobs.Default },
    /* recommended_stack_size */ DEFAULT_STACK_SIZE,
    /* target_modifiers */ new Map(),
    /* mitigation_coverage_map */ mitigation_coverage.MitigationCoverageMap.default(),
  );
}

// PORT: `impl Options` / `impl UnstableOptions` of this file are companion consts (`Options_impl.f(opts)`,
// `UnstableOptions_impl.f(uo)`), not prototype extensions (so no name clash with option fields): options.gen.ts reads this module while it is
// evaluated, so this module is evaluated before the generated classes exist and cannot touch their
// prototypes at load time.
export const Options_impl = {
  // rustc: compiler/rustc_session/src/config.rs:1547 build_dep_graph
  build_dep_graph(self: Options): boolean {
    return self.incremental !== undefined || self.unstable_opts.dump_dep_graph || self.unstable_opts.query_dep_graph;
  },

  // rustc: compiler/rustc_session/src/config.rs:1553 file_path_mapping
  file_path_mapping(self: Options): FilePathMapping {
    return file_path_mapping([...self.remap_path_prefix], self.unstable_opts.remap_cwd_prefix, self.remap_path_scope);
  },

  /// Returns `true` if there will be an output file generated.
  // rustc: compiler/rustc_session/src/config.rs:1562 will_create_output_file
  will_create_output_file(self: Options): boolean {
    return (
      !self.unstable_opts.parse_crate_root_only && // The file is just being parsed
      self.unstable_opts.ls.length === 0 // The file is just being queried
    );
  },

  // #[inline]
  // rustc: compiler/rustc_session/src/config.rs:1568 share_generics
  share_generics(self: Options): boolean {
    const setting = self.unstable_opts.share_generics;
    if (setting !== undefined) return setting;
    switch (self.optimize) {
      case "No":
      case "Less":
      case "Size":
      case "SizeMin":
        return true;
      case "More":
      case "Aggressive":
        return false;
    }
  },

  // rustc: compiler/rustc_session/src/config.rs:1578 get_symbol_mangling_version
  get_symbol_mangling_version(self: Options): SymbolManglingVersion {
    return self.cg.symbol_mangling_version ?? "V0";
  },

  // #[inline]
  // rustc: compiler/rustc_session/src/config.rs:1583 autodiff_enabled
  autodiff_enabled(self: Options): boolean {
    return self.unstable_opts.autodiff.some((a) => a.$ === "Enable");
  },
} as const;

export const UnstableOptions_impl = {
  // rustc: compiler/rustc_session/src/config.rs:1589 dcx_flags
  dcx_flags(self: UnstableOptions, can_emit_warnings: boolean): DiagCtxtFlags {
    return {
      can_emit_warnings,
      treat_err_as_bug: self.treat_err_as_bug,
      eagerly_emit_delayed_bugs: self.eagerly_emit_delayed_bugs,
      macro_backtrace: self.macro_backtrace,
      deduplicate_diagnostics: self.deduplicate_diagnostics,
      track_diagnostics: self.track_diagnostics,
    };
  },

  // rustc: compiler/rustc_session/src/config.rs:1600 src_hash_algorithm
  src_hash_algorithm(self: UnstableOptions, target: Target): SourceFileHashAlgorithm {
    return (
      self.src_hash_algorithm ??
      (() => {
        if (target.is_like_msvc) {
          return SourceFileHashAlgorithm.Sha256;
        } else {
          return SourceFileHashAlgorithm.Md5;
        }
      })()
    );
  },

  // rustc: compiler/rustc_session/src/config.rs:1610 checksum_hash_algorithm
  checksum_hash_algorithm(self: UnstableOptions): SourceFileHashAlgorithm | undefined {
    return self.checksum_hash_algorithm;
  },
} as const;

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

// #[derive(Clone, Copy)]
export type LinkerJobs =
  /// Do not pass anything to the linker, use it's default behavior.
  | { readonly $: "Default" }
  /// Pass some specific number of jobs to use to the linker.
  | { readonly $: "Explicit"; readonly _0: number };
export const LinkerJobs = {
  Default: Object.freeze({ $: "Default" }) as LinkerJobs,

  // rustc: compiler/rustc_session/src/config.rs:1722 limit
  limit(self: LinkerJobs): number | undefined {
    switch (self.$) {
      case "Default":
        return undefined;
      case "Explicit":
        return self._0;
    }
  },
} as const;

/// `None` for frontend and backend means everything is single-threaded
/// and synchronization can be disabled.
// #[derive(Clone, Copy)]
// PORT: `NonZero<usize>` -> a positive `number`.
export interface Jobs {
  frontend: number | undefined;
  backend: number | undefined;
  linker: LinkerJobs;
}

/** `Option<NonZero<usize>>` ordering (`None < Some(_)`), for `check_upper_limit`. */
function option_gt(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined) return false;
  if (b === undefined) return true;
  return a > b;
}

// rustc: compiler/rustc_session/src/config.rs:1739 parse_jobs_all
function parse_jobs_all(
  early_dcx: EarlyDiagCtxt,
  matches: Matches,
  zthreads: string | undefined,
  zno_parallel_backend: boolean,
  unstable: boolean,
): Jobs {
  if (zno_parallel_backend) {
    early_dcx.early_fatal("`-Zno-parallel-backend` is removed, use `--jobs-backend=1` instead");
  }
  const available: { value: number | undefined } = { value: undefined };
  // PORT: `Option<Option<NonZero<usize>>>` -> `{ $: "Some", _0 } | undefined`.
  const jobs_s = matches.opt_str("jobs");
  const jobs: { $: "Some"; _0: number | undefined } | undefined =
    jobs_s === undefined ? undefined : { $: "Some", _0: parse_jobs_one(early_dcx, "--jobs", jobs_s, unstable, available) };
  const check_upper_limit = (value: number | undefined, opt_name: string): void => {
    if (jobs !== undefined && option_gt(value ?? 1, jobs._0 ?? 1)) {
      early_dcx.early_fatal(`\`${opt_name}\` cannot be larger than \`--jobs\``);
    }
  };
  let frontend: number | undefined;
  const jobs_frontend = matches.opt_str("jobs-frontend");
  if (jobs_frontend !== undefined) {
    const opt_name = "--jobs-frontend";
    frontend = parse_jobs_one(early_dcx, opt_name, jobs_frontend, unstable, available);
    check_upper_limit(frontend, opt_name);
    if (zthreads !== undefined) {
      early_dcx.early_fatal("cannot use both `--jobs-frontend` and `-Zthreads`");
    }
  } else {
    if (zthreads !== undefined) {
      const opt_name = "-Zthreads";
      frontend = parse_jobs_one(early_dcx, opt_name, zthreads, unstable, available);
      check_upper_limit(frontend, opt_name);
    } else {
      frontend = undefined; // default to 1 thread irrespectively of `jobs` for now
    }
  }
  let backend: number | undefined;
  const jobs_backend = matches.opt_str("jobs-backend");
  if (jobs_backend !== undefined) {
    const opt_name = "--jobs-backend";
    backend = parse_jobs_one(early_dcx, opt_name, jobs_backend, unstable, available);
    check_upper_limit(backend, opt_name);
  } else {
    if (jobs !== undefined) {
      backend = jobs._0;
    } else {
      // Use all available parallelism as the default.
      backend = parse_jobs_one(early_dcx, "", "0", unstable, available);
    }
  }
  let linker: LinkerJobs;
  const jobs_linker = matches.opt_str("jobs-linker");
  if (jobs_linker !== undefined) {
    const opt_name = "--jobs-linker";
    const l = parse_jobs_one(early_dcx, opt_name, jobs_linker, unstable, available);
    check_upper_limit(l, opt_name);
    linker = { $: "Explicit", _0: l ?? 1 };
  } else {
    if (jobs !== undefined) {
      linker = { $: "Explicit", _0: jobs._0 ?? 1 };
    } else {
      linker = LinkerJobs.Default; // back compat with lld
    }
  }

  return { frontend, backend, linker };
}

// Parse a string passed to one of the `--jobs` options or `-Zthreads`.
// rustc: compiler/rustc_session/src/config.rs:1814 parse_jobs_one
function parse_jobs_one(
  early_dcx: EarlyDiagCtxt,
  opt_name: string,
  s: string,
  unstable: boolean,
  available: { value: number | undefined },
): number | undefined {
  if (s === "sync") {
    // Enable synchronization overhead for benchmarking despite only using one thread.
    if (!unstable) {
      early_dcx.early_fatal(`\`${opt_name}=sync\` requires \`-Z unstable-options\``);
    }
    return 1;
  }
  // The number of jobs is capped by 255 (`u8::MAX`) to avoid arbitrary large numbers like 999999
  // causing compiler panics (#117638). The limit can be potentially increased, because e.g.
  // rustc thread pool supports up to `u16::MAX` threads in theory.
  let n: number;
  const r = u8_from_str(s);
  if (r.$ === "Ok" && r._0 === 0) {
    // PORT: `thread::available_parallelism()` -> `os.availableParallelism()` (never fails in Node).
    available.value ??= Math.min(availableParallelism(), 255);
    n = available.value;
  } else if (r.$ === "Ok") {
    n = r._0;
  } else {
    early_dcx.early_fatal(`\`${opt_name}\`: expected a number from 0 to 255 or \`sync\``);
  }
  // `Jobs` uses `usize` for more convenient use, even if the actual values are limited to `u8`.
  return n > 1 ? n : undefined;
}

// rustc: compiler/rustc_session/src/config.rs:1844 build_configuration
export function build_configuration(sess: Session, user_cfg: Cfg): Cfg {
  // First disallow some configuration given on the command line
  cfg_mod.disallow_cfgs(sess, user_cfg);

  // Then combine the configuration requested by the session (command line) with
  // some default and generated configuration items.
  user_cfg.extend(cfg_mod.default_configuration(sess));
  return user_cfg;
}

// rustc: compiler/rustc_session/src/config.rs:1854 build_target_config
export function build_target_config(early_dcx: EarlyDiagCtxt, target: TargetTuple, sysroot: PathBuf, unstable_options: boolean): Target {
  const r = Target.search(target, sysroot, unstable_options);
  if (r.$ === "Ok") {
    const [target, warnings] = r._0;
    for (const warning of warnings.warning_messages()) {
      early_dcx.early_warn(warning);
    }

    if (!(target.pointer_width === 16 || target.pointer_width === 32 || target.pointer_width === 64)) {
      early_dcx.early_fatal(`target specification was invalid: unrecognized target-pointer-width ${target.pointer_width}`);
    }
    return target;
  } else {
    const e = r._0;
    const err = early_dcx.early_struct_fatal(`error loading target specification: ${e}`);
    err.help("run `rustc --print target-list` for a list of built-in targets");
    const typed = TargetTuple.tuple(target);
    const limit = Math.floor(utf8_len(typed) / 3) + 1;
    let suggestion: [number, string] | undefined;
    for (const t of target_spec.TARGETS) {
      const d = edit_distance_with_substrings(typed, t, limit);
      // `min_by_key` keeps the first minimum.
      if (d !== undefined && (suggestion === undefined || d < suggestion[0])) suggestion = [d, t];
    }
    if (suggestion !== undefined) {
      err.help(`did you mean \`${suggestion[1]}\`?`);
    }
    return err.emit_fatal();
  }
}

// #[derive(Copy, Clone, PartialEq, Eq, Debug)]
export type OptionStability = "Stable" | "Unstable";
export const OptionStability = { Stable: "Stable", Unstable: "Unstable" } as const;
export const debug_OptionStability: Debug<OptionStability> = (v) => v;

// #[derive(Copy, Clone, PartialEq, Eq, Debug)]
export type OptionKind =
  /// An option that takes a value, and cannot appear more than once (e.g. `--out-dir`).
  ///
  /// Corresponds to [`getopts::Options::optopt`].
  | "Opt"
  /// An option that takes a value, and can appear multiple times (e.g. `--emit`).
  ///
  /// Corresponds to [`getopts::Options::optmulti`].
  | "Multi"
  /// An option that does not take a value, and cannot appear more than once (e.g. `--help`).
  ///
  /// Corresponds to [`getopts::Options::optflag`].
  /// The `hint` string must be empty.
  | "Flag"
  /// An option that does not take a value, and can appear multiple times (e.g. `-O`).
  ///
  /// Corresponds to [`getopts::Options::optflagmulti`].
  /// The `hint` string must be empty.
  | "FlagMulti";
export const OptionKind = { Opt: "Opt", Multi: "Multi", Flag: "Flag", FlagMulti: "FlagMulti" } as const;
export const debug_OptionKind: Debug<OptionKind> = (v) => v;

export class RustcOptGroup {
  constructor(
    /// The "primary" name for this option. Normally equal to `long_name`,
    /// except for options that don't have a long name, in which case
    /// `short_name` is used.
    ///
    /// This is needed when interacting with `getopts` in some situations,
    /// because if an option has both forms, that library treats the long name
    /// as primary and the short name as an alias.
    public name: string,
    public stability: OptionStability,
    public kind: OptionKind,

    public short_name: string,
    public long_name_: string,
    public desc: string,
    public value_hint: string,

    /// If true, this option should not be printed by `rustc --help`, but
    /// should still be printed by `rustc --help -v`.
    public is_verbose_help_only: boolean,
  ) {}
  // PORT: the private field `long_name` is `long_name_` (its accessor `long_name()` keeps the name).

  // rustc: compiler/rustc_session/src/config.rs:1950 is_stable
  is_stable(): boolean {
    return this.stability === "Stable";
  }

  // rustc: compiler/rustc_session/src/config.rs:1954 apply
  apply(options: getopts.Options): void {
    const { short_name, long_name_: long_name, desc, value_hint } = this;
    switch (this.kind) {
      case "Opt":
        options.optopt(short_name, long_name, desc, value_hint);
        break;
      case "Multi":
        options.optmulti(short_name, long_name, desc, value_hint);
        break;
      case "Flag":
        options.optflag(short_name, long_name, desc);
        break;
      case "FlagMulti":
        options.optflagmulti(short_name, long_name, desc);
        break;
    }
  }

  /// This is for diagnostics-only.
  // rustc: compiler/rustc_session/src/config.rs:1965 long_name
  long_name(): string {
    return this.long_name_;
  }
}

// rustc: compiler/rustc_session/src/config.rs:1970 make_opt
export function make_opt(
  stability: OptionStability,
  kind: OptionKind,
  short_name: string,
  long_name: string,
  desc: string,
  value_hint: string,
): RustcOptGroup {
  // "Flag" options don't have a value, and therefore don't have a value hint.
  switch (kind) {
    case "Opt":
    case "Multi":
      break;
    case "Flag":
    case "FlagMulti":
      assert_eq(value_hint, "", debug_str);
      break;
  }
  return new RustcOptGroup(
    // `cmp::max_by_key(short_name, long_name, |s| s.len())`: the second argument on ties.
    utf8_len(short_name) > utf8_len(long_name) ? short_name : long_name,
    stability,
    kind,
    short_name,
    long_name,
    desc,
    value_hint,
    false,
  );
}

// static EDITION_STRING: LazyLock<String>
let EDITION_STRING_: string | undefined;
function EDITION_STRING(): string {
  return (EDITION_STRING_ ??= `Specify which edition of the compiler to use when compiling code. The default is ${display_Edition(DEFAULT_EDITION)} and the latest stable edition is ${display_Edition(LATEST_STABLE_EDITION)}.`);
}

// static EMIT_HELP: LazyLock<String>
let EMIT_HELP_: string | undefined;
function EMIT_HELP(): string {
  if (EMIT_HELP_ === undefined) {
    let result = "Comma separated list of types of output for the compiler to emit.\n";
    result += "Each TYPE has the default FILE name:\n";

    for (const output of OutputType.iter_all()) {
      result += `*  ${OutputType.shorthand(output)} - ${OutputType.default_filename(output)}\n`;
    }

    EMIT_HELP_ = result;
  }
  return EMIT_HELP_;
}

/// Returns all rustc command line options, including metadata for
/// each option, such as whether the option is stable.
///
/// # Option style guidelines
///
/// - `<param>`: Indicates a required parameter
/// - `[param]`: Indicates an optional parameter
/// - `|`: Indicates a mutually exclusive option
/// - `*`: a list element with description
// rustc: compiler/rustc_session/src/config.rs:2023 rustc_optgroups
export function rustc_optgroups(): RustcOptGroup[] {
  const { Flag, FlagMulti, Multi, Opt } = OptionKind;
  const { Stable, Unstable } = OptionStability;

  const opt = make_opt;

  const options = [
    opt(Stable, Flag, "h", "help", "Display this message", ""),
    opt(Stable, Multi, "", "cfg", 'Configure the compilation environment.\nSPEC supports the syntax `<NAME>[="<VALUE>"]`.', "<SPEC>"),
    opt(Stable, Multi, "", "check-cfg", "Provide list of expected cfgs for checking", "<SPEC>"),
    opt(
      Stable,
      Multi,
      "L",
      "",
      "Add a directory to the library search path. The optional KIND can be one of <dependency|crate|native|framework|all> (default: all).",
      "[<KIND>=]<PATH>",
    ),
    opt(
      Stable,
      Multi,
      "l",
      "",
      "Link the generated crate(s) to the specified native\n" +
        "library NAME. The optional KIND can be one of\n" +
        "<static|framework|dylib> (default: dylib).\n" +
        "Optional comma separated MODIFIERS\n" +
        "<bundle|verbatim|whole-archive|as-needed>\n" +
        "may be specified each with a prefix of either '+' to\n" +
        "enable or '-' to disable.",
      "[<KIND>[:<MODIFIERS>]=]<NAME>[:<RENAME>]",
    ),
    make_crate_type_option(),
    opt(Stable, Opt, "", "crate-name", "Specify the name of the crate being built", "<NAME>"),
    opt(Stable, Opt, "", "edition", EDITION_STRING(), EDITION_NAME_LIST),
    opt(Stable, Multi, "", "emit", EMIT_HELP(), "<TYPE>[=<FILE>]"),
    opt(Stable, Multi, "", "print", print_request.PRINT_HELP(), "<INFO>[=<FILE>]"),
    opt(Stable, FlagMulti, "g", "", "Equivalent to -C debuginfo=2", ""),
    opt(Stable, FlagMulti, "O", "", "Equivalent to -C opt-level=3", ""),
    opt(Stable, Opt, "o", "", "Write output to FILENAME", "<FILENAME>"),
    opt(Stable, Opt, "", "out-dir", "Write output to compiler-chosen filename in DIR", "<DIR>"),
    opt(Stable, Opt, "", "explain", "Provide a detailed explanation of an error message", "<OPT>"),
    opt(Stable, Flag, "", "test", "Build a test harness", ""),
    opt(Stable, Opt, "", "target", "Target tuple for which the code is compiled", "<TARGET>"),
    opt(Stable, Multi, "A", "allow", "Set lint allowed", "<LINT>"),
    opt(Stable, Multi, "W", "warn", "Set lint warnings", "<LINT>"),
    opt(Stable, Multi, "", "force-warn", "Set lint force-warn", "<LINT>"),
    opt(Stable, Multi, "D", "deny", "Set lint denied", "<LINT>"),
    opt(Stable, Multi, "F", "forbid", "Set lint forbidden", "<LINT>"),
    opt(Stable, Multi, "", "cap-lints", "Set the most restrictive lint level. More restrictive lints are capped at this level", "<LEVEL>"),
    opt(Stable, Multi, "C", "codegen", "Set a codegen option", "<OPT>[=<VALUE>]"),
    opt(Stable, Flag, "V", "version", "Print version info and exit", ""),
    opt(Stable, Flag, "v", "verbose", "Use verbose output", ""),
  ];

  // Options in this list are hidden from `rustc --help` by default, but are
  // shown by `rustc --help -v`.
  const verbose_only = [
    opt(Stable, Multi, "", "extern", "Specify where an external rust library is located", "<NAME>[=<PATH>]"),
    opt(Stable, Opt, "", "sysroot", "Override the system root", "<PATH>"),
    opt(Unstable, Multi, "Z", "", "Set unstable / perma-unstable options", "<FLAG>"),
    opt(Stable, Opt, "", "error-format", "How errors and other messages are produced", "<human|json|short>"),
    opt(Stable, Multi, "", "json", "Configure the JSON output of the compiler", "<CONFIG>"),
    opt(
      Stable,
      Opt,
      "",
      "color",
      // PORT: a plain (non-`\`-continued) multi-line string literal keeps its newlines and indentation.
      "Configure coloring of output:\n" +
        "                * auto   = colorize, if output goes to a tty (default);\n" +
        "                * always = always colorize output;\n" +
        "                * never  = never colorize output",
      "<auto|always|never>",
    ),
    opt(
      Stable,
      Opt,
      "",
      "diagnostic-width",
      "Inform rustc of the width of the output so that diagnostics can be truncated to fit",
      "<WIDTH>",
    ),
    opt(Stable, Multi, "", "remap-path-prefix", "Remap source names in all output (compiler messages and output files)", "<FROM>=<TO>"),
    opt(
      Stable,
      Opt,
      "",
      "remap-path-scope",
      "Defines which scopes of paths should be remapped by `--remap-path-prefix`",
      "<macro,diagnostics,debuginfo,coverage,object,all>",
    ),
    opt(Unstable, Opt, "j", "jobs", "Limit on the number of used parallel jobs", "<N>"),
    opt(Unstable, Opt, "", "jobs-frontend", "Limit on the number of parallel jobs used by frontend", "<N>"),
    opt(Unstable, Opt, "", "jobs-backend", "Limit on the number of parallel jobs used by backend", "<N>"),
    opt(Unstable, Opt, "", "jobs-linker", "Limit on the number of parallel jobs used by linker", "<N>"),
  ];
  for (const opt of verbose_only) {
    opt.is_verbose_help_only = true;
    options.push(opt);
  }

  return options;
}

// rustc: compiler/rustc_session/src/config.rs:2192 get_cmd_lint_options
export function get_cmd_lint_options(early_dcx: EarlyDiagCtxt, matches: Matches): [[string, Level][], boolean, Level | undefined] {
  const lint_opts_with_position: [number, string, Level][] = [];
  let describe_lints = false;

  for (const level of ["Allow", "Warn", "ForceWarn", "Deny", "Forbid"] as const) {
    for (const [arg_pos, lint_name] of matches.opt_strs_pos(Level.as_str(level))) {
      if (lint_name === "help") {
        describe_lints = true;
      } else {
        lint_opts_with_position.push([arg_pos, lint_name.replaceAll("-", "_"), level]);
      }
    }
  }

  // `sort_by_key` is stable, like `Array.prototype.sort`.
  lint_opts_with_position.sort((a, b) => a[0] - b[0]);
  const lint_opts = lint_opts_with_position.map(([_, lint_name, level]): [string, Level] => [lint_name, level]);

  const cap = matches.opt_str("cap-lints");
  const lint_cap =
    cap === undefined ? undefined : (Level.from_str(cap) ?? early_dcx.early_fatal(`unknown lint level: \`${cap}\``));

  return [lint_opts, describe_lints, lint_cap];
}

/// Parses the `--color` flag.
// rustc: compiler/rustc_session/src/config.rs:2225 parse_color
export function parse_color(early_dcx: EarlyDiagCtxt, matches: Matches): ColorConfig {
  const arg = matches.opt_str("color");
  switch (arg) {
    case "auto":
      return "Auto";
    case "always":
      return "Always";
    case "never":
      return "Never";

    case undefined:
      return "Auto";

    default:
      return early_dcx.early_fatal(`argument for \`--color\` must be auto, always or never (instead was \`${arg}\`)`);
  }
}

/// Possible json config files
export interface JsonConfig {
  json_rendered: HumanReadableErrorType;
  json_color: ColorConfig;
  json_artifact_notifications: boolean;
  /// Output start and end timestamps of several high-level compilation sections
  /// (frontend, backend, linker).
  json_timings: boolean;
  json_unused_externs: JsonUnusedExterns;
  json_future_incompat: boolean;
}

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

/// Parse the `--json` flag.
///
/// The first value returned is how to render JSON diagnostics, and the second
/// is whether or not artifact notifications are enabled.
// rustc: compiler/rustc_session/src/config.rs:2283 parse_json
export function parse_json(early_dcx: EarlyDiagCtxt, matches: Matches): JsonConfig {
  let json_rendered = new HumanReadableErrorType(false, false);
  let json_color: ColorConfig = "Never";
  let json_artifact_notifications = false;
  let json_unused_externs: JsonUnusedExterns = "No";
  let json_future_incompat = false;
  let json_timings = false;
  for (const option of matches.opt_strs("json")) {
    // For now conservatively forbid `--color` with `--json` since `--json`
    // won't actually be emitting any colors and anything colorized is
    // embedded in a diagnostic message anyway.
    if (matches.opt_str("color") !== undefined) {
      early_dcx.early_fatal("cannot specify the `--color` option with `--json`");
    }

    for (const sub_option of option.split(",")) {
      switch (sub_option) {
        case "diagnostic-short":
          json_rendered = new HumanReadableErrorType(true, false);
          break;
        case "diagnostic-unicode":
          json_rendered = new HumanReadableErrorType(false, true);
          break;
        case "diagnostic-rendered-ansi":
          json_color = "Always";
          break;
        case "artifacts":
          json_artifact_notifications = true;
          break;
        case "timings":
          json_timings = true;
          break;
        case "unused-externs":
          json_unused_externs = "Loud";
          break;
        case "unused-externs-silent":
          json_unused_externs = "Silent";
          break;
        case "future-incompat":
          json_future_incompat = true;
          break;
        default:
          early_dcx.early_fatal(`unknown \`--json\` option \`${sub_option}\``);
      }
    }
  }

  return {
    json_rendered,
    json_color,
    json_artifact_notifications,
    json_timings,
    json_unused_externs,
    json_future_incompat,
  };
}

/// Parses the `--error-format` flag.
// rustc: compiler/rustc_session/src/config.rs:2328 parse_error_format
export function parse_error_format(
  early_dcx: EarlyDiagCtxtReal,
  matches: Matches,
  color_config: ColorConfig,
  json_color: ColorConfig,
  json_rendered: HumanReadableErrorType,
): ErrorOutputType {
  const default_kind = new HumanReadableErrorType(false, false);
  // We need the `opts_present` check because the driver will send us Matches
  // with only stable options if no unstable options are used. Since error-format
  // is unstable, it will not be present. We have to use `opts_present` not
  // `opt_present` because the latter will panic.
  let error_format: ErrorOutputType;
  if (matches.opts_present(["error-format"])) {
    const arg = matches.opt_str("error-format");
    switch (arg) {
      case undefined:
      case "human":
        error_format = { $: "HumanReadable", color_config, kind: default_kind };
        break;
      case "json":
        error_format = { $: "Json", pretty: false, json_rendered, color_config: json_color };
        break;
      case "pretty-json":
        error_format = { $: "Json", pretty: true, json_rendered, color_config: json_color };
        break;
      case "short":
        error_format = { $: "HumanReadable", kind: new HumanReadableErrorType(true, false), color_config };
        break;
      case "human-unicode":
        error_format = { $: "HumanReadable", kind: new HumanReadableErrorType(false, true), color_config };
        break;
      default:
        early_dcx.set_error_format({ $: "HumanReadable", color_config, kind: default_kind });
        early_dcx.early_fatal(
          `argument for \`--error-format\` must be \`human\`, \`human-unicode\`, \`json\`, \`pretty-json\` or \`short\` (instead was \`${arg}\`)`,
        );
    }
  } else {
    error_format = { $: "HumanReadable", color_config, kind: default_kind };
  }

  if (error_format.$ === "Json") {
    // nothing
  } else if (matches.opt_strs("json").length !== 0) {
    // Conservatively require that the `--json` argument is coupled with
    // `--error-format=json`. This means that `--json` is specified we
    // should actually be emitting JSON blobs.
    early_dcx.early_fatal("using `--json` requires also using `--error-format=json`");
  }

  return error_format;
}

// rustc: compiler/rustc_session/src/config.rs:2390 parse_crate_edition
export function parse_crate_edition(early_dcx: EarlyDiagCtxt, matches: Matches, has_input: boolean): Edition {
  const is_nightly = nightly_options.match_is_nightly_build(matches);
  const edition_list = is_nightly ? EDITION_NAME_LIST : EDITION_NAME_LIST_STABLE;
  let edition: Edition;
  const arg = matches.opt_str("edition");
  if (arg !== undefined) {
    const r = Edition.from_str(arg);
    edition =
      r.$ === "Ok" ? r._0 : early_dcx.early_fatal(`argument for \`--edition\` must be one of: ${edition_list} (instead was \`${arg}\`)`);
  } else {
    if (has_input) {
      eprintln(
        `\`--edition\` is unspecified, defaulting to \`${display_Edition(DEFAULT_EDITION)}\` while the latest is \`${display_Edition(LATEST_STABLE_EDITION)}\`; it must be one of: ${edition_list}\n`,
      );
    }
    edition = DEFAULT_EDITION;
  }

  if (!Edition.is_stable(edition) && !nightly_options.is_unstable_enabled(matches)) {
    let msg: string;
    if (!is_nightly) {
      msg = `the crate requires edition ${display_Edition(edition)}, but the latest edition supported by this Rust version is ${display_Edition(LATEST_STABLE_EDITION)}`;
    } else {
      msg = `edition ${display_Edition(edition)} is unstable and only available with -Z unstable-options`;
    }
    early_dcx.early_fatal(msg);
  }

  return edition;
}

// rustc: compiler/rustc_session/src/config.rs:2429 check_error_format_stability
function check_error_format_stability(
  early_dcx: EarlyDiagCtxt,
  unstable_opts: UnstableOptions,
  is_nightly_build: boolean,
  format: ErrorOutputType,
): void {
  if (unstable_opts.unstable_options || is_nightly_build) {
    return;
  }
  let format_s: string;
  if (format.$ === "Json" && format.pretty) {
    format_s = "pretty-json";
  } else if (format.$ === "HumanReadable") {
    if (format.kind.unicode) {
      format_s = "human-unicode";
    } else {
      return;
    }
  } else {
    return;
  }
  early_dcx.early_fatal(`\`--error-format=${format_s}\` is unstable`);
}

// rustc: compiler/rustc_session/src/config.rs:2449 parse_output_types
function parse_output_types(early_dcx: EarlyDiagCtxt, unstable_opts: UnstableOptions, matches: Matches): OutputTypes {
  const output_types = new Map<OutputType, OutFileName | undefined>();
  if (!unstable_opts.parse_crate_root_only) {
    for (const list of matches.opt_strs("emit")) {
      for (const output_type_s of list.split(",")) {
        const [shorthand, path] = split_out_file_name(output_type_s);
        const output_type =
          OutputType.from_shorthand(shorthand) ??
          early_dcx.early_fatal(`unknown emission type: \`${shorthand}\` - expected one of: ${OutputType.shorthands_display()}`);
        if (output_type === "ThinLinkBitcode" && !unstable_opts.unstable_options) {
          early_dcx.early_fatal(`${OutputType.shorthand("ThinLinkBitcode")} requested but -Zunstable-options not specified`);
        }
        output_types.set(output_type, path);
      }
    }
  }
  if (output_types.size === 0) {
    output_types.set("Exe", undefined);
  }
  return new OutputTypes(sorted_output_types(output_types));
}

// rustc: compiler/rustc_session/src/config.rs:2481 split_out_file_name
export function split_out_file_name(arg: string): [string, OutFileName | undefined] {
  const i = arg.indexOf("=");
  if (i < 0) return [arg, undefined];
  const kind = arg.slice(0, i);
  const path = arg.slice(i + 1);
  if (path === "-") return [kind, OutFileName.Stdout];
  return [kind, { $: "Real", _0: path }];
}

// rustc: compiler/rustc_session/src/config.rs:2489 should_override_cgus_and_disable_thinlto
function should_override_cgus_and_disable_thinlto(
  early_dcx: EarlyDiagCtxt,
  output_types: OutputTypes,
  matches: Matches,
  codegen_units: number | undefined,
): [boolean, number | undefined] {
  let disable_local_thinlto = false;
  // Issue #30063: if user requests LLVM-related output to one
  // particular path, disable codegen-units.
  const incompatible = [...output_types._0.keys()]
    .filter((ot) => !OutputType.is_compatible_with_codegen_units_and_single_output_file(ot))
    .map((ot) => OutputType.shorthand(ot));
  if (incompatible.length !== 0) {
    if (codegen_units !== undefined && codegen_units > 1) {
      if (matches.opt_present("o")) {
        for (const ot of incompatible) {
          early_dcx.early_warn(`\`--emit=${ot}\` with \`-o\` incompatible with \`-C codegen-units=N\` for N > 1`);
        }
        early_dcx.early_warn("resetting to default -C codegen-units=1");
        codegen_units = 1;
        disable_local_thinlto = true;
      }
    } else {
      codegen_units = 1;
      disable_local_thinlto = true;
    }
  }

  if (codegen_units === 0) {
    early_dcx.early_fatal("value for codegen units must be a positive non-zero integer");
  }

  return [disable_local_thinlto, codegen_units];
}

// rustc: compiler/rustc_session/src/config.rs:2534 parse_target_triple
export function parse_target_triple(early_dcx: EarlyDiagCtxt, matches: Matches): TargetTuple {
  const target = matches.opt_str("target");
  if (target !== undefined && target.endsWith(".json")) {
    const path = target;
    const r = TargetTuple.from_path(path);
    return r.$ === "Ok" ? r._0 : early_dcx.early_fatal(`target file ${debug_str(path)} does not exist`);
  } else if (target !== undefined) {
    return { $: "TargetTuple", _0: target };
  } else {
    return TargetTuple.from_tuple(host_tuple());
  }
}

/** `Iterator::max` over `Option`-wrapped positions compared as `Option<usize>` (`None < Some`). */
function opt_max(xs: number[]): number | undefined {
  let m: number | undefined;
  for (const x of xs) if (m === undefined || x >= m) m = x;
  return m;
}

// rustc: compiler/rustc_session/src/config.rs:2547 parse_opt_level
function parse_opt_level(early_dcx: EarlyDiagCtxt, matches: Matches, cg: CodegenOptions): OptLevel {
  // The `-O` and `-C opt-level` flags specify the same setting, so we want to be able
  // to use them interchangeably. However, because they're technically different flags,
  // we need to work out manually which should take precedence if both are supplied (i.e.
  // the rightmost flag). We do this by finding the (rightmost) position of both flags and
  // comparing them. Note that if a flag is not found, its position will be `None`, which
  // always compared less than `Some(_)`.
  const max_o = opt_max(matches.opt_positions("O"));
  const max_c = opt_max(
    matches.opt_strs_pos("C").flatMap(([i, s]) => {
      // NB: This can match a string without `=`.
      return s.split("=")[0] === "opt-level" ? [i] : [];
    }),
  );
  if (option_gt(max_o, max_c)) {
    return "Aggressive";
  } else {
    switch (cg.opt_level) {
      case "0":
        return "No";
      case "1":
        return "Less";
      case "2":
        return "More";
      case "3":
        return "Aggressive";
      case "s":
        return "Size";
      case "z":
        return "SizeMin";
      default:
        return early_dcx.early_fatal(`optimization level needs to be between 0-3, s or z (instead was \`${cg.opt_level}\`)`);
    }
  }
}

// rustc: compiler/rustc_session/src/config.rs:2587 select_debuginfo
function select_debuginfo(matches: Matches, cg: CodegenOptions): DebugInfo {
  const max_g = opt_max(matches.opt_positions("g"));
  const max_c = opt_max(
    matches.opt_strs_pos("C").flatMap(([i, s]) => {
      // NB: This can match a string without `=`.
      return s.split("=")[0] === "debuginfo" ? [i] : [];
    }),
  );
  return option_gt(max_g, max_c) ? "Full" : cg.debuginfo;
}

/** PORT: `CanonicalizedPath::new` (utils.rs), installed by utils.ts (see `parse_externs`). */
export const CanonicalizedPath_new_hook: { new_: ((path: PathBuf) => CanonicalizedPath) | undefined } = { new_: undefined };

// rustc: compiler/rustc_session/src/config.rs:2600 parse_externs
export function parse_externs(early_dcx: EarlyDiagCtxt, matches: Matches, unstable_opts: UnstableOptions): Externs {
  const is_unstable_enabled = unstable_opts.unstable_options;
  const externs = new Map<string, ExternEntry>();
  for (const arg of matches.opt_strs("extern")) {
    const r = split_extern_opt(early_dcx, unstable_opts, arg);
    if (r.$ === "Err") return r._0.emit_fatal();
    const { crate_name: name, path, options } = r._0;

    let entry: ExternEntry;
    const occupied = externs.get(name);
    if (path !== undefined) {
      // --extern prelude_name=some_file.rlib
      // PORT: utils.ts is not imported at runtime here (it extends `Session`, see lib.ts); it installs
      // `CanonicalizedPath::new` into `CanonicalizedPath_new_hook` when it loads (lane locator).
      const cpath: CanonicalizedPath = unwrap(CanonicalizedPath_new_hook.new_, "rustc_session::utils not loaded")(path);
      if (occupied === undefined) {
        const files = new Set([cpath]);
        entry = ExternEntry.new({ $: "ExactPaths", _0: files });
        externs.set(name, entry);
      } else {
        const ext_ent = occupied;
        const location = ext_ent.location;
        if (location.$ === "ExactPaths") {
          location._0.add(cpath);
        } else {
          // Exact paths take precedence over search directories.
          const files = new Set([cpath]);
          ext_ent.location = { $: "ExactPaths", _0: files };
        }
        entry = ext_ent;
      }
    } else {
      // --extern prelude_name
      if (occupied === undefined) {
        entry = ExternEntry.new(ExternLocation.FoundInLibrarySearchDirectories);
        externs.set(name, entry);
      } else {
        // Ignore if already specified.
        entry = occupied;
      }
    }

    let is_private_dep = false;
    let add_prelude = true;
    let nounused_dep = false;
    let force = false;
    if (options !== undefined) {
      if (!is_unstable_enabled) {
        early_dcx.early_fatal("the `-Z unstable-options` flag must also be passed to enable `--extern` options");
      }
      for (const opt of options.split(",")) {
        switch (opt) {
          case "priv":
            is_private_dep = true;
            break;
          case "noprelude":
            if (entry.location.$ === "ExactPaths") {
              add_prelude = false;
            } else {
              early_dcx.early_fatal("the `noprelude` --extern option requires a file path");
            }
            break;
          case "nounused":
            nounused_dep = true;
            break;
          case "force":
            force = true;
            break;
          default:
            early_dcx.early_fatal(`unknown --extern option \`${opt}\``);
        }
      }
    }

    // Crates start out being not private, and go to being private `priv`
    // is specified.
    entry.is_private_dep ||= is_private_dep;
    // likewise `nounused`
    entry.nounused_dep ||= nounused_dep;
    // and `force`
    entry.force ||= force;
    // If any flag is missing `noprelude`, then add to the prelude.
    entry.add_prelude ||= add_prelude;
  }
  // `BTreeMap<String, _>` order.
  return new Externs(new Map([...externs].sort((a, b) => str_cmp(a[0], b[0]))));
}

// rustc: compiler/rustc_session/src/config.rs:2697 parse_remap_path_prefix
function parse_remap_path_prefix(early_dcx: EarlyDiagCtxt, matches: Matches): [PathBuf, PathBuf][] {
  return matches.opt_strs("remap-path-prefix").map((remap): [PathBuf, PathBuf] => {
    const i = remap.lastIndexOf("=");
    if (i < 0) {
      return early_dcx.early_fatal("--remap-path-prefix must contain '=' between FROM and TO");
    }
    return [remap.slice(0, i), remap.slice(i + 1)];
  });
}

// JUSTIFICATION: before wrapper fn is available
// #[allow(rustc::bad_opt_access)]
// rustc: compiler/rustc_session/src/config.rs:2715 build_session_options
export function build_session_options(early_dcx: EarlyDiagCtxtReal, matches: getopts.Matches, has_input: boolean): Options {
  const color = parse_color(early_dcx, matches);

  const edition = parse_crate_edition(early_dcx, matches, has_input);

  const crate_name = matches.opt_str("crate-name");
  const unstable_features = UnstableFeatures.from_environment(crate_name);
  const { json_rendered, json_color, json_artifact_notifications, json_timings, json_unused_externs, json_future_incompat } = parse_json(
    early_dcx,
    matches,
  );

  const error_format = parse_error_format(early_dcx, matches, color, json_color, json_rendered);

  early_dcx.set_error_format(error_format);

  const dw = matches.opt_get("diagnostic-width", usize_from_str);
  const diagnostic_width = dw.$ === "Ok" ? dw._0 : early_dcx.early_fatal("`--diagnostic-width` must be an positive integer");

  const unparsed_crate_types = matches.opt_strs("crate-type");
  const ct = parse_crate_types_from_list(unparsed_crate_types);
  const crate_types = ct.$ === "Ok" ? ct._0 : early_dcx.early_fatal(ct._0);

  const collected_options = CollectedOptions.default();

  const unstable_opts = UnstableOptions.build(early_dcx, matches, collected_options);

  // `-Zassumptions-on-binders` requires the next trait solver globally. Normalize after
  // parsing so the effective config is independent of flag order and so consumers that
  // read `next_solver` directly (e.g. feature-gate checks) see the right value.
  if (unstable_opts.assumptions_on_binders) {
    // Only warn when the last `-Znext-solver` given has a value that doesn't enable
    // the solver globally, so a later `-Znext-solver=globally` overrides an earlier one.
    const last = matches
      .opt_strs("Z")
      .findLast((arg) => arg.startsWith("next-solver"));
    const no_next_solver = last !== undefined && (last === "next-solver=no" || last === "next-solver=coherence");
    if (no_next_solver) {
      early_dcx.early_warn("-Zassumptions-on-binders unconditionally enables the next trait solver; `-Znext-solver=no` is ignored");
    }
    unstable_opts.next_solver = "Globally";
  }

  if (unstable_opts.staticlib_hide_internal_symbols && !crate_types.includes("StaticLib")) {
    early_dcx.early_warn("-Zstaticlib-hide-internal-symbols has no effect without `--crate-type staticlib`");
  }

  if (unstable_opts.staticlib_rename_internal_symbols && !crate_types.includes("StaticLib")) {
    early_dcx.early_warn("-Zstaticlib-rename-internal-symbols has no effect without `--crate-type staticlib`");
  }

  const [lint_opts, describe_lints, lint_cap] = get_cmd_lint_options(early_dcx, matches);

  if (!unstable_opts.unstable_options && json_timings) {
    early_dcx.early_fatal("--json=timings is unstable and requires using `-Zunstable-options`");
  }

  check_error_format_stability(early_dcx, unstable_opts, UnstableFeatures.is_nightly_build(unstable_features), error_format);

  const output_types = parse_output_types(early_dcx, unstable_opts, matches);

  const cg = CodegenOptions.build(early_dcx, matches, collected_options);
  const [disable_local_thinlto, codegen_units] = should_override_cgus_and_disable_thinlto(
    early_dcx,
    output_types,
    matches,
    cg.codegen_units,
  );

  const incremental = cg.incremental;

  if (SwitchWithOptPath.enabled(cg.profile_generate) && cg.profile_use !== undefined) {
    early_dcx.early_fatal("options `-C profile-generate` and `-C profile-use` are exclusive");
  }

  if (cg.profile_sample_use !== undefined && (SwitchWithOptPath.enabled(cg.profile_generate) || cg.profile_use !== undefined)) {
    early_dcx.early_fatal("option `-C profile-sample-use` cannot be used with `-C profile-generate` or `-C profile-use`");
  }

  // Check for unstable values of `-C symbol-mangling-version`.
  // This is what prevents them from being used on stable compilers.
  switch (cg.symbol_mangling_version) {
    // Stable values:
    case undefined:
    case "V0":
      break;

    // Unstable values:
    case "Legacy":
      if (!unstable_opts.unstable_options) {
        early_dcx.early_fatal("`-C symbol-mangling-version=legacy` requires `-Z unstable-options`");
      }
      break;
    case "Hashed":
      if (!unstable_opts.unstable_options) {
        early_dcx.early_fatal("`-C symbol-mangling-version=hashed` requires `-Z unstable-options`");
      }
      break;
  }

  if (cg.instrument_coverage !== "No") {
    if (SwitchWithOptPath.enabled(cg.profile_generate) || cg.profile_use !== undefined) {
      early_dcx.early_fatal(
        "option `-C instrument-coverage` is not compatible with either `-C profile-use` or `-C profile-generate`",
      );
    }

    // `-C instrument-coverage` implies `-C symbol-mangling-version=v0` - to ensure consistent
    // and reversible name mangling. Note, LLVM coverage tools can analyze coverage over
    // multiple runs, including some changes to source code; so mangled names must be consistent
    // across compilations.
    switch (cg.symbol_mangling_version) {
      case undefined:
        cg.symbol_mangling_version = "V0";
        break;
      case "Legacy":
        early_dcx.early_warn(
          "-C instrument-coverage requires symbol mangling version `v0`, but `-C symbol-mangling-version=legacy` was specified",
        );
        break;
      case "V0":
        break;
      case "Hashed":
        early_dcx.early_warn(
          "-C instrument-coverage requires symbol mangling version `v0`, but `-C symbol-mangling-version=hashed` was specified",
        );
        break;
    }
  }

  const graphviz_font = process.env.RUSTC_GRAPHVIZ_FONT;
  if (graphviz_font !== undefined) {
    // FIXME: this is only mutation of UnstableOptions here, move into
    // UnstableOptions::build?
    unstable_opts.graphviz_font = graphviz_font;
  }

  if (!cg.embed_bitcode) {
    switch (cg.lto) {
      case "No":
      case "Unspecified":
        break;
      case "Yes":
      case "NoParam":
      case "Thin":
      case "Fat":
        early_dcx.early_fatal("options `-C embed-bitcode=no` and `-C lto` are incompatible");
    }
  }

  const unstable_options_enabled = nightly_options.is_unstable_enabled(matches);
  if (!unstable_options_enabled && cg.force_frame_pointers === "NonLeaf") {
    early_dcx.early_fatal("`-Cforce-frame-pointers=non-leaf` or `always` also requires `-Zunstable-options` and a nightly compiler");
  }

  if (!nightly_options.is_unstable_enabled(matches) && unstable_opts.offload.length !== 0) {
    early_dcx.early_fatal("`-Zoffload=Enable` also requires `-Zunstable-options` and a nightly compiler");
  }

  const target_triple = parse_target_triple(early_dcx, matches);

  // Ensure `-Z unstable-options` is required when using the unstable `-C link-self-contained` and
  // `-C linker-flavor` options.
  if (!unstable_options_enabled) {
    const r = cg.link_self_contained.check_unstable_variants(target_triple);
    if (r.$ === "Err") {
      early_dcx.early_fatal(r._0);
    }

    const flavor = cg.linker_flavor;
    if (flavor !== undefined) {
      if (target_spec.LinkerFlavorCli.is_unstable(flavor)) {
        early_dcx.early_fatal(
          `the linker flavor \`${target_spec.LinkerFlavorCli.desc(flavor)}\` is unstable, the \`-Z unstable-options\` flag must also be passed to use the unstable values`,
        );
      }
    }
  }

  // Check `-C link-self-contained` for consistency: individual components cannot be both enabled
  // and disabled at the same time.
  const erroneous_components = cg.link_self_contained.check_consistency();
  if (erroneous_components !== undefined) {
    // PORT: bitflags `into_iter()` yields the named flags in definition order (= `all_components()`).
    const names: string = target_spec.LinkSelfContainedComponents.all_components()
      .filter((c) => target_spec.LinkSelfContainedComponents.contains(erroneous_components, c))
      .map((c) => unwrap(target_spec.LinkSelfContainedComponents.as_str(c)))
      .join(", ");
    early_dcx.early_fatal(`some \`-C link-self-contained\` components were both enabled and disabled: ${names}`);
  }

  const prints = print_request.collect_print_requests(early_dcx, cg, unstable_opts, matches, print_request.PrintCategory.ALL_VARIANTS);

  // -Zretpoline-external-thunk also requires -Zretpoline
  if (unstable_opts.retpoline_external_thunk) {
    unstable_opts.retpoline = true;
    collected_options.target_modifiers.set(
      OptionsTargetModifiers.UnstableOptions(UnstableOptionsTargetModifiers.Retpoline),
      "true",
    );
  }

  // let cg = cg;

  const opt_level = parse_opt_level(early_dcx, matches, cg);
  // The `-g` and `-C debuginfo` flags specify the same setting, so we want to be able
  // to use them interchangeably. See the note above (regarding `-O` and `-C opt-level`)
  // for more details.
  const debug_assertions = cg.debug_assertions ?? opt_level === "No";
  const debuginfo = select_debuginfo(matches, cg);

  if (!unstable_options_enabled) {
    const r = cg.linker_features.check_unstable_variants(target_triple);
    if (r.$ === "Err") {
      early_dcx.early_fatal(r._0);
    }
  }

  if (!unstable_options_enabled && cg.panic === "ImmediateAbort") {
    early_dcx.early_fatal("`-Cpanic=immediate-abort` requires `-Zunstable-options` and a nightly compiler");
  }

  // Parse any `-l` flags, which link to native libraries.
  const libs = parse_native_libs(early_dcx, unstable_opts, unstable_features, matches);

  const test = matches.opt_present("test");

  if (!Passes.is_empty(cg.remark) && debuginfo === "None") {
    early_dcx.early_warn('-C remark requires "-C debuginfo=n" to show source locations');
  }

  if (Passes.is_empty(cg.remark) && unstable_opts.remark_dir !== undefined) {
    early_dcx.early_warn("using -Z remark-dir without enabling remarks using e.g. -C remark=all");
  }

  const externs = parse_externs(early_dcx, matches, unstable_opts);

  const remap_path_prefix = parse_remap_path_prefix(early_dcx, matches);
  const remap_path_scope = parse_remap_path_scope(early_dcx, matches, unstable_opts);

  const pretty = parse_pretty(early_dcx, unstable_opts);

  // query-dep-graph is required if dump-dep-graph is given #106736
  if (unstable_opts.dump_dep_graph && !unstable_opts.query_dep_graph) {
    early_dcx.early_fatal("can't dump dependency graph without `-Z query-dep-graph`");
  }

  const sysroot = Sysroot.new(matches.opt_str("sysroot"));

  const real_source_base_dir = (suffix: string, confirm: string): PathBuf | undefined => {
    let candidate = path_join(sysroot.path(), suffix);
    const metadata = symlink_metadata(candidate);
    if (metadata !== undefined) {
      // Replace the symlink bootstrap creates, with its destination.
      // We could try to use `fs::canonicalize` instead, but that might
      // produce unnecessarily verbose path.
      if (metadata.isSymbolicLink()) {
        const symlink_dest = read_link(candidate);
        if (symlink_dest !== undefined) {
          candidate = symlink_dest;
        }
      }
    }

    // Only use this directory if it has a file we can expect to always find.
    return is_file(path_join(candidate, confirm)) ? candidate : undefined;
  };

  const real_rust_source_base_dir =
    // This is the location used by the `rust-src` `rustup` component.
    real_source_base_dir("lib/rustlib/src/rust", "library/std/src/lib.rs");

  const real_rustc_dev_source_base_dir =
    // This is the location used by the `rustc-dev` `rustup` component.
    real_source_base_dir("lib/rustlib/rustc-src/rust", "compiler/rustc/src/main.rs");

  // We eagerly scan all files in each passed -L path. If the same directory is passed multiple
  // times, and the directory contains a lot of files, this can take a lot of time.
  // So we remove -L paths that were passed multiple times, and keep only the first occurrence.
  // We still have to keep the original order of the -L arguments.
  const search_paths: SearchPath[] = (() => {
    const seen_search_paths = new Set<string>();
    const search_path_matches: string[] = matches.opt_strs("L");
    return search_path_matches
      .filter((p) => {
        if (seen_search_paths.has(p)) return false;
        seen_search_paths.add(p);
        return true;
      })
      .map((path): SearchPath => SearchPath.from_cli_opt(sysroot.path(), target_triple, early_dcx, path, unstable_opts.unstable_options));
  })();

  // Ideally we would use `SourceMap::working_dir` instead, but we don't have access to it
  // so we manually create the potentially-remapped working directory
  const working_dir = (() => {
    const wd = env_current_dir();
    const working_dir = wd.$ === "Ok" ? wd._0 : early_dcx.early_fatal(`Current directory is invalid: ${display_IoError(wd._0)}`);

    const file_mapping = file_path_mapping([...remap_path_prefix], unstable_opts.remap_cwd_prefix, remap_path_scope);
    return file_mapping.to_real_filename(RealFileName.empty(), working_dir);
  })();

  const verbose = matches.opt_present("verbose") || unstable_opts.verbose_internals;

  const jobs = parse_jobs_all(
    early_dcx,
    matches,
    unstable_opts.threads,
    unstable_opts.no_parallel_backend,
    unstable_opts.unstable_options,
  );

  // PORT: `Options { .. }` -> the generated constructor (field order of `top_level_options!`).
  return new Options(
    /* crate_types */ crate_types,
    /* optimize */ opt_level,
    /* debug_assertions */ debug_assertions,
    /* debuginfo */ debuginfo,
    /* lint_opts */ lint_opts,
    /* lint_cap */ lint_cap,
    /* describe_lints */ describe_lints,
    /* output_types */ output_types,
    /* search_paths */ search_paths,
    /* libs */ libs,
    /* sysroot */ sysroot,
    /* target_triple */ target_triple,
    /* test */ test,
    /* error_format */ error_format,
    /* diagnostic_width */ diagnostic_width,
    /* incremental */ incremental,
    /* unstable_opts */ unstable_opts,
    /* prints */ prints,
    /* cg */ cg,
    /* externs */ externs,
    /* crate_name */ crate_name,
    /* unstable_features */ unstable_features,
    /* actually_rustdoc */ false,
    /* resolve_doc_links */ "ExportedMetadata",
    /* trimmed_def_paths */ false,
    /* cli_forced_codegen_units */ codegen_units,
    /* cli_forced_local_thinlto_off */ disable_local_thinlto,
    /* remap_path_prefix */ remap_path_prefix,
    /* remap_path_scope */ remap_path_scope,
    /* real_rust_source_base_dir */ real_rust_source_base_dir,
    /* real_rustc_dev_source_base_dir */ real_rustc_dev_source_base_dir,
    /* edition */ edition,
    /* json_artifact_notifications */ json_artifact_notifications,
    /* json_timings */ json_timings,
    /* json_unused_externs */ json_unused_externs,
    /* json_future_incompat */ json_future_incompat,
    /* pretty */ pretty,
    /* working_dir */ working_dir,
    /* color */ color,
    /* verbose */ verbose,
    /* jobs */ jobs,
    /* recommended_stack_size */ DEFAULT_STACK_SIZE,
    /* target_modifiers */ collected_options.target_modifiers,
    /* mitigation_coverage_map */ collected_options.mitigations,
  );
}

/** `Path::symlink_metadata(..).ok()` */
function symlink_metadata(p: PathBuf): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(p);
  } catch {
    return undefined;
  }
}
/** `std::fs::read_link(..).ok()` */
function read_link(p: PathBuf): PathBuf | undefined {
  try {
    return readlinkSync(p);
  } catch {
    return undefined;
  }
}
/** `Path::is_file` */
function is_file(p: PathBuf): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

// rustc: compiler/rustc_session/src/config.rs:3124 parse_pretty
function parse_pretty(early_dcx: EarlyDiagCtxt, unstable_opts: UnstableOptions): PpMode | undefined {
  const name = unstable_opts.unpretty;
  if (name === undefined) return undefined;
  let first: PpMode;
  switch (name) {
    case "normal":
      first = { $: "Source", _0: "Normal" };
      break;
    case "expanded":
      first = { $: "Source", _0: "Expanded" };
      break;
    case "expanded,identified":
      first = { $: "Source", _0: "ExpandedIdentified" };
      break;
    case "expanded,hygiene":
      first = { $: "Source", _0: "ExpandedHygiene" };
      break;
    case "ast-tree":
      first = PpMode.AstTree;
      break;
    case "ast-tree,expanded":
      first = PpMode.AstTreeExpanded;
      break;
    case "hir":
      first = { $: "Hir", _0: "Normal" };
      break;
    case "hir,identified":
      first = { $: "Hir", _0: "Identified" };
      break;
    case "hir,typed":
      first = { $: "Hir", _0: "Typed" };
      break;
    case "hir-tree":
      first = PpMode.HirTree;
      break;
    case "thir-tree":
      first = PpMode.ThirTree;
      break;
    case "thir-flat":
      first = PpMode.ThirFlat;
      break;
    case "mir":
      first = PpMode.Mir;
      break;
    case "stable-mir":
      first = PpMode.StableMir;
      break;
    case "mir-cfg":
      first = PpMode.MirCFG;
      break;
    default:
      early_dcx.early_fatal(
        `argument to \`unpretty\` must be one of \`normal\`, \`expanded\`, \`expanded,identified\`, \`expanded,hygiene\`, \`ast-tree\`, \`ast-tree,expanded\`, \`hir\`, \`hir,identified\`, \`hir,typed\`, \`hir-tree\`, \`thir-tree\`, \`thir-flat\`, \`mir\`, \`stable-mir\`, or \`mir-cfg\`; got ${name}`,
      );
  }
  // debug!("got unpretty option: {first:?}");
  return first;
}

// rustc: compiler/rustc_session/src/config.rs:3155 make_crate_type_option
export function make_crate_type_option(): RustcOptGroup {
  return make_opt(
    "Stable",
    "Multi",
    "",
    "crate-type",
    "Comma separated list of types of crates\n                                for the compiler to emit",
    "<bin|lib|rlib|dylib|cdylib|staticlib|proc-macro>",
  );
}

// rustc: compiler/rustc_session/src/config.rs:3167 parse_crate_types_from_list
export function parse_crate_types_from_list(list_list: string[]): Result<CrateType[], string> {
  const crate_types: CrateType[] = [];
  for (const unparsed_crate_type of list_list) {
    for (const part of unparsed_crate_type.split(",")) {
      let new_part: CrateType;
      switch (part) {
        case "lib":
          new_part = CrateType.default();
          break;
        case "rlib":
          new_part = "Rlib";
          break;
        case "staticlib":
          new_part = "StaticLib";
          break;
        case "dylib":
          new_part = "Dylib";
          break;
        case "cdylib":
          new_part = "Cdylib";
          break;
        case "bin":
          new_part = "Executable";
          break;
        case "proc-macro":
          new_part = "ProcMacro";
          break;
        case "sdylib":
          new_part = "Sdylib";
          break;
        default:
          return Err(
            `unknown crate type: \`${part}\`, expected one of: \`lib\`, \`rlib\`, \`staticlib\`, \`dylib\`, \`cdylib\`, \`bin\`, \`proc-macro\``,
          );
      }
      if (!crate_types.includes(new_part)) {
        crate_types.push(new_part);
      }
    }
  }

  return Ok(crate_types);
}

export const nightly_options = {
  // rustc: compiler/rustc_session/src/config.rs:3202 is_unstable_enabled
  is_unstable_enabled(matches: Matches): boolean {
    return nightly_options.match_is_nightly_build(matches) && matches.opt_strs("Z").some((x) => x === "unstable-options");
  },

  // rustc: compiler/rustc_session/src/config.rs:3207 match_is_nightly_build
  match_is_nightly_build(matches: Matches): boolean {
    return nightly_options_is_nightly_build(matches.opt_str("crate-name"));
  },

  // rustc: compiler/rustc_session/src/config.rs:3215 check_nightly_options
  check_nightly_options(early_dcx: EarlyDiagCtxtReal, matches: Matches, flags: readonly RustcOptGroup[]): void {
    const has_z_unstable_option = matches.opt_strs("Z").some((x) => x === "unstable-options");
    const really_allows_unstable_options = nightly_options.match_is_nightly_build(matches);
    let nightly_options_on_stable = 0;

    for (const opt of flags) {
      if (opt.stability === "Stable") {
        continue;
      }
      if (!matches.opt_present(opt.name)) {
        continue;
      }
      if (opt.name !== "Z" && !has_z_unstable_option) {
        early_dcx.early_fatal(`the \`-Z unstable-options\` flag must also be passed to enable the flag \`${opt.name}\``);
      }
      if (really_allows_unstable_options) {
        continue;
      }

      nightly_options_on_stable += 1;
      const msg = `the option \`${opt.name}\` is only accepted on the nightly compiler`;
      // The non-zero nightly_options_on_stable will force an early_fatal eventually.
      void early_dcx.early_err(msg);
    }

    if (nightly_options_on_stable > 0) {
      const [s, were] = nightly_options_on_stable > 1 ? ["s", "were"] : ["", "was"];
      const err = early_dcx.early_struct_fatal(`${nightly_options_on_stable} nightly option${s} ${were} parsed`);
      err.help("consider switching to a nightly toolchain: `rustup default nightly`");
      err.note(
        "selecting a toolchain with `+toolchain` arguments require a rustup proxy; see <https://rust-lang.github.io/rustup/concepts/index.html>",
      );
      err.note(
        "for more information about Rust's stability policy, see <https://doc.rust-lang.org/book/appendix-07-nightly-rust.html#unstable-features>",
      );
      err.emit();
    }
  },
} as const;

// `nightly_options::is_nightly_build` is private to the module.
// rustc: compiler/rustc_session/src/config.rs:3211 is_nightly_build
function nightly_options_is_nightly_build(krate: string | undefined): boolean {
  return UnstableFeatures.is_nightly_build(UnstableFeatures.from_environment(krate));
}

// #[derive(Copy, Clone, PartialEq, Debug)]
export type PpSourceMode =
  /// `-Zunpretty=normal`
  | "Normal"
  /// `-Zunpretty=expanded`
  | "Expanded"
  /// `-Zunpretty=expanded,identified`
  | "ExpandedIdentified"
  /// `-Zunpretty=expanded,hygiene`
  | "ExpandedHygiene";
export const PpSourceMode = { Normal: "Normal", Expanded: "Expanded", ExpandedIdentified: "ExpandedIdentified", ExpandedHygiene: "ExpandedHygiene" } as const;
export const debug_PpSourceMode: Debug<PpSourceMode> = (v) => v;

// #[derive(Copy, Clone, PartialEq, Debug)]
export type PpHirMode =
  /// `-Zunpretty=hir`
  | "Normal"
  /// `-Zunpretty=hir,identified`
  | "Identified"
  /// `-Zunpretty=hir,typed`
  | "Typed";
export const PpHirMode = { Normal: "Normal", Identified: "Identified", Typed: "Typed" } as const;
export const debug_PpHirMode: Debug<PpHirMode> = (v) => v;

// #[derive(Copy, Clone, PartialEq, Debug)]
/// Pretty print mode
export type PpMode =
  /// Options that print the source code, i.e.
  /// `-Zunpretty=normal` and `-Zunpretty=expanded`
  | { readonly $: "Source"; readonly _0: PpSourceMode }
  /// `-Zunpretty=ast-tree`
  | { readonly $: "AstTree" }
  /// `-Zunpretty=ast-tree,expanded`
  | { readonly $: "AstTreeExpanded" }
  /// Options that print the HIR, i.e. `-Zunpretty=hir`
  | { readonly $: "Hir"; readonly _0: PpHirMode }
  /// `-Zunpretty=hir-tree`
  | { readonly $: "HirTree" }
  /// `-Zunpretty=thir-tree`
  | { readonly $: "ThirTree" }
  /// `-Zunpretty=thir-flat`
  | { readonly $: "ThirFlat" }
  /// `-Zunpretty=mir`
  | { readonly $: "Mir" }
  /// `-Zunpretty=mir-cfg`
  | { readonly $: "MirCFG" }
  /// `-Zunpretty=stable-mir`
  | { readonly $: "StableMir" };
export const PpMode = {
  AstTree: Object.freeze({ $: "AstTree" }) as PpMode,
  AstTreeExpanded: Object.freeze({ $: "AstTreeExpanded" }) as PpMode,
  HirTree: Object.freeze({ $: "HirTree" }) as PpMode,
  ThirTree: Object.freeze({ $: "ThirTree" }) as PpMode,
  ThirFlat: Object.freeze({ $: "ThirFlat" }) as PpMode,
  Mir: Object.freeze({ $: "Mir" }) as PpMode,
  MirCFG: Object.freeze({ $: "MirCFG" }) as PpMode,
  StableMir: Object.freeze({ $: "StableMir" }) as PpMode,

  // rustc: compiler/rustc_session/src/config.rs:3316 needs_ast_map
  needs_ast_map(self: PpMode): boolean {
    switch (self.$) {
      case "Source":
        if (self._0 === "Normal") return false;
        return true;
      case "AstTree":
        return false;

      case "AstTreeExpanded":
      case "Hir":
      case "HirTree":
      case "ThirTree":
      case "ThirFlat":
      case "Mir":
      case "MirCFG":
      case "StableMir":
        return true;
    }
  },

  // rustc: compiler/rustc_session/src/config.rs:3334 needs_analysis
  needs_analysis(self: PpMode): boolean {
    return (
      (self.$ === "Hir" && self._0 === "Typed") ||
      self.$ === "Mir" ||
      self.$ === "StableMir" ||
      self.$ === "MirCFG" ||
      self.$ === "ThirTree" ||
      self.$ === "ThirFlat"
    );
  },
} as const;
export const debug_PpMode: Debug<PpMode> = (v, f) => {
  switch (v.$) {
    case "Source":
      return debug_tuple(f, "Source", [debug_PpSourceMode(v._0, f)]);
    case "Hir":
      return debug_tuple(f, "Hir", [debug_PpHirMode(v._0, f)]);
    default:
      return v.$;
  }
};

export type WasiExecModel = "Command" | "Reactor";
export const WasiExecModel = { Command: "Command", Reactor: "Reactor" } as const;
export const debug_WasiExecModel: Debug<WasiExecModel> = (v) => v;

/// Command-line arguments passed to the compiler have to be incorporated with
/// the dependency tracking system for incremental compilation. This module
/// provides some utilities to make this more convenient.
///
/// The values of all command-line arguments that are relevant for dependency
/// tracking are hashed into a single value that determines whether the
/// incremental compilation cache can be re-used or not. This hashing is done
/// via the `DepTrackingHash` trait defined below, since the standard `Hash`
/// implementation might not be suitable (e.g., arguments are stored in a `Vec`,
/// the hash of which is order dependent, but we might not want the order of
/// arguments to make a difference for the hash).
///
/// However, since the value provided by `Hash::hash` often *is* suitable,
/// especially for primitive types, there is the
/// `impl_dep_tracking_hash_via_hash!()` macro that allows to simply reuse the
/// `Hash` implementation for `DepTrackingHash`. It's important though that
/// we have an opt-in scheme here, so one is hopefully forced to think about
/// how the hash should be calculated when adding a new command-line argument.
// PORT: `pub(crate) mod dep_tracking` is the `dep_tracking` namespace object below (options.gen.ts reaches it as
// `dep_tracking.*`, as options.rs does through `crate::config::*`). A `DepTrackingHash` impl for `T` is a
// `DepTrackingHash<T>` function; `&dyn DepTrackingHash` is a `DynDepTrackingHash` (the value bound to its impl). The
// hasher is always rustc_data_structures' `StableHasher` (the only one the trait is used with).
// rustc: compiler/rustc_session/src/config.rs:3400 hash
export type DepTrackingHash<T> = (self: T, hasher: StableHasher, error_format: ErrorOutputType, for_crate_hash: boolean) => void;
/** `&dyn DepTrackingHash`: a value with its `DepTrackingHash` impl. */
export interface DynDepTrackingHash {
  hash(hasher: StableHasher, error_format: ErrorOutputType, for_crate_hash: boolean): void;
}

// -- The std `Hash::hash` impls `impl_dep_tracking_hash_via_hash!` reuses --
// PORT: there is no derive(Hash) codegen; the derived (and the few hand-written) `Hash` impls of the types in the
// via-hash list are spelled out here, as rustc_span does for `InnerRealFileName`. The derived `Hash` of an enum with
// two or more variants hashes its `isize` discriminant (`write_isize`) then the fields of the variant; a struct hashes
// its fields in order. Fieldless enums without a `_discriminant` table get their variant order from the upstream
// definition (cited at each table).
type HashFn<T> = (self: T, state: StableHasher) => void;
/** `impl Hash for bool`: `write_u8(*self as u8)`. */
const hash_bool: HashFn<boolean> = (self, state) => state.write_u8(self ? 1 : 0);
/** `impl Hash for u8` */
const hash_u8: HashFn<number> = (self, state) => state.write_u8(self);
/** `impl Hash for u16` */
const hash_u16: HashFn<number> = (self, state) => state.write_u16(self);
/** `impl Hash for u32` */
const hash_u32: HashFn<number> = (self, state) => state.write_u32(self);
/** `impl Hash for u64` */
const hash_u64: HashFn<bigint> = (self, state) => state.write_u64(self);
/** `impl Hash for usize` (and `NonZero<usize>`, whose `Hash` is its value's) */
const hash_usize: HashFn<number> = (self, state) => state.write_usize(self);
/** `impl Hash for str` / `String`: `state.write_str(self)`. */
const hash_str: HashFn<string> = (self, state) => state.write_str(utf8_bytes(self));
/** `impl Hash for PathBuf`: `self.as_path().hash(h)` (std's `impl Hash for Path`, src/std/path.ts). */
const hash_PathBuf: HashFn<PathBuf> = (self, state) => path_hash(self, path_hasher(state));
/** The derived `Hash` of `Option<T>`: the `isize` discriminant (`None` 0, `Some` 1), then the value. */
function hash_Option<T>(hash_T: HashFn<T>): HashFn<T | undefined> {
  return (self, state) => {
    if (self === undefined) state.write_isize(0);
    else {
      state.write_isize(1);
      hash_T(self, state);
    }
  };
}
/** The derived `Hash` of a fieldless enum: its `isize` discriminant. */
function hash_fieldless<T extends string>(discriminant: Record<T, number>): HashFn<T> {
  return (self, state) => state.write_isize(discriminant[self]);
}
// compiler/rustc_session/src/config.rs:3341 `enum WasiExecModel`
const WasiExecModel_discriminant: Record<WasiExecModel, number> = { Command: 0, Reactor: 1 };
// compiler/rustc_session/src/config.rs:3677 `enum Polonius`
const Polonius_discriminant: Record<Polonius, number> = { Off: 0, Legacy: 1, Next: 2 };
// compiler/rustc_session/src/config.rs:3724 `enum FunctionReturn`
const FunctionReturn_discriminant: Record<FunctionReturn, number> = { Keep: 0, ThunkExtern: 1 };
// compiler/rustc_session/src/config.rs:1044 `enum NextSolverConfig`
const NextSolverConfig_discriminant: Record<NextSolverConfig, number> = { Coherence: 0, Globally: 1 };
// compiler/rustc_session/src/config.rs:631 `enum MirStripDebugInfo`
const MirStripDebugInfo_discriminant: Record<MirStripDebugInfo, number> = { None: 0, LocalsInTinyFunctions: 1, AllLocals: 2 };
// compiler/rustc_session/src/config.rs:153 `enum LtoCli`
const LtoCli_discriminant: Record<LtoCli, number> = { No: 0, Yes: 1, NoParam: 2, Thin: 3, Fat: 4, Unspecified: 5 };
// compiler/rustc_session/src/config.rs:170 `enum InstrumentCoverage`
const InstrumentCoverage_discriminant: Record<InstrumentCoverage, number> = { No: 0, Yes: 1 };
// compiler/rustc_session/src/config.rs:576 `enum FmtDebug`
const FmtDebug_discriminant: Record<FmtDebug, number> = { Full: 0, Shallow: 1, None: 2 };
// compiler/rustc_session/src/config.rs:615 `enum DebugInfo`
const DebugInfo_discriminant: Record<DebugInfo, number> = { None: 0, LineDirectivesOnly: 1, LineTablesOnly: 2, Limited: 3, Full: 4 };
// compiler/rustc_session/src/config.rs:624 `enum DebugInfoCompression`
const DebugInfoCompression_discriminant: Record<DebugInfoCompression, number> = { None: 0, Zlib: 1, Zstd: 2 };
// compiler/rustc_session/src/config.rs:647 `enum SplitDwarfKind`
const SplitDwarfKind_discriminant: Record<SplitDwarfKind, number> = { Single: 0, Split: 1 };
// compiler/rustc_session/src/config.rs:77 `enum CFGuard`
const CFGuard_discriminant: Record<CFGuard, number> = { Disabled: 0, NoChecks: 1, Checks: 2 };
// compiler/rustc_session/src/config.rs:90 `enum CFProtection`
const CFProtection_discriminant: Record<CFProtection, number> = { None: 0, Branch: 1, Return: 2, Full: 3 };
// compiler/rustc_session/src/config.rs:105 `enum OptLevel`
const OptLevel_discriminant: Record<OptLevel, number> = { No: 0, Less: 1, More: 2, Aggressive: 3, Size: 4, SizeMin: 5 };
// compiler/rustc_session/src/config.rs:878 `enum ResolveDocLinks`
const ResolveDocLinks_discriminant: Record<ResolveDocLinks, number> = { None: 0, ExportedMetadata: 1, Exported: 2, All: 3 };
// compiler/rustc_session/src/config.rs:1652 `enum PAuthKey`
const PAuthKey_discriminant: Record<PAuthKey, number> = { A: 0, B: 1 };
// compiler/rustc_feature/src/lib.rs:38 `enum UnstableFeatures`
const UnstableFeatures_discriminant: Record<UnstableFeatures, number> = { Disallow: 0, Allow: 1, Cheat: 2 };
// compiler/rustc_span/src/lib.rs:1726 `enum SourceFileHashAlgorithm`
const SourceFileHashAlgorithm_discriminant: Record<SourceFileHashAlgorithm, number> = { Md5: 0, Sha1: 1, Sha256: 2, Blake3: 3 };
// `crate::target_spec_enum!` enums of compiler/rustc_target/src/spec/mod.rs (`#[derive(.., Hash, ..)]`, rustc_target lib.rs:83)
// spec/mod.rs:820 `enum PanicStrategy`
const PanicStrategy_discriminant: Record<PanicStrategy, number> = { Unwind: 0, Abort: 1, ImmediateAbort: 2 };
// spec/mod.rs:830 `enum OnBrokenPipe` (a plain `#[derive(Hash)]` enum)
const OnBrokenPipe_discriminant: Record<OnBrokenPipe, number> = { Default: 0, Kill: 1, Error: 2, Inherit: 3 };
// spec/mod.rs:852 `enum RelroLevel`
const RelroLevel_discriminant: Record<RelroLevel, number> = { Full: 0, Partial: 1, Off: 2, None: 3 };
// spec/mod.rs:869 `enum SymbolVisibility`
const SymbolVisibility_discriminant: Record<SymbolVisibility, number> = { Hidden: 0, Protected: 1, Interposable: 2 };
// spec/mod.rs:929 `enum MergeFunctions`
const MergeFunctions_discriminant: Record<MergeFunctions, number> = { Disabled: 0, Trampolines: 1, Aliases: 2 };
// spec/mod.rs:946 `enum RelocModel`
const RelocModel_discriminant: Record<RelocModel, number> = { Static: 0, Pic: 1, Pie: 2, DynamicNoPic: 3, Ropi: 4, Rwpi: 5, RopiRwpi: 6 };
// spec/mod.rs:974 `enum CodeModel`
const CodeModel_discriminant: Record<CodeModel, number> = { Tiny: 0, Small: 1, Kernel: 2, Medium: 3, Large: 4 };
// spec/mod.rs:1012 `enum TlsModel`
const TlsModel_discriminant: Record<TlsModel, number> = { GeneralDynamic: 0, LocalDynamic: 1, InitialExec: 2, LocalExec: 3, Emulated: 4 };
// spec/mod.rs:1082 `enum SplitDebuginfo`
const SplitDebuginfo_discriminant: Record<SplitDebuginfo, number> = { Off: 0, Packed: 1, Unpacked: 2 };
// spec/mod.rs:1171 `enum FramePointer`
const FramePointer_discriminant: Record<FramePointer, number> = { Always: 0, NonLeaf: 1, MayOmit: 2 };
// spec/mod.rs:1203 `enum StackProtector`
const StackProtector_discriminant: Record<StackProtector, number> = { None: 0, Basic: 1, Strong: 2, All: 3 };
/** `#[derive(Hash)] enum AnnotateMoves { Disabled, Enabled(Option<u64>) }` (config.rs:282) */
const hash_AnnotateMoves: HashFn<AnnotateMoves> = (self, state) => {
  switch (self.$) {
    case "Disabled":
      state.write_isize(0);
      return;
    case "Enabled":
      state.write_isize(1);
      hash_Option(hash_u64)(self._0, state);
      return;
  }
};
// compiler/rustc_session/src/config.rs:246 `enum AutoDiff`
const AutoDiff_discriminant: Record<AutoDiff["$"], number> = {
  Enable: 0,
  PrintTA: 1,
  PrintTAFn: 2,
  PrintAA: 3,
  PrintPerf: 4,
  PrintSteps: 5,
  PrintModBefore: 6,
  PrintModAfter: 7,
  PrintModFinal: 8,
  PrintPasses: 9,
  NoPostopt: 10,
  LooseTypes: 11,
  Inline: 12,
  NoTT: 13,
};
/** `#[derive(Hash)] enum AutoDiff` (config.rs:246): `PrintTAFn(String)` is the one variant with a field. */
const hash_AutoDiff: HashFn<AutoDiff> = (self, state) => {
  state.write_isize(AutoDiff_discriminant[self.$]);
  if (self.$ === "PrintTAFn") hash_str(self._0, state);
};
// compiler/rustc_session/src/config.rs:218 `enum Offload`
const Offload_discriminant: Record<Offload["$"], number> = { Device: 0, Host: 1, Test: 2, HostMetadata: 3 };
/** `#[derive(Hash)] enum Offload { Device(String), Host(String), Test, HostMetadata(String) }` (config.rs:218) */
const hash_Offload: HashFn<Offload> = (self, state) => {
  state.write_isize(Offload_discriminant[self.$]);
  if (self.$ !== "Test") hash_str(self._0, state);
};
/** `#[derive(Hash)] struct CoverageOptions { level: CoverageLevel, discard_all_spans_in_codegen: bool }` (config.rs:179) */
const hash_CoverageOptions: HashFn<CoverageOptions> = (self, state) => {
  hash_fieldless(CoverageLevel_discriminant)(self.level, state);
  hash_bool(self.discard_all_spans_in_codegen, state);
};
/** `#[derive(Hash)] struct InstrumentMcountOpts { no_call: bool, record: bool }` (config.rs:291) */
const hash_InstrumentMcountOpts: HashFn<InstrumentMcountOpts> = (self, state) => {
  hash_bool(self.no_call, state);
  hash_bool(self.record, state);
};
/** `#[derive(Hash)] enum InstrumentMcount { Disabled, Mcount(InstrumentMcountOpts), Fentry(InstrumentMcountOpts) }` (config.rs:300) */
const hash_InstrumentMcount: HashFn<InstrumentMcount> = (self, state) => {
  switch (self.$) {
    case "Disabled":
      state.write_isize(0);
      return;
    case "Mcount":
      state.write_isize(1);
      hash_InstrumentMcountOpts(self._0, state);
      return;
    case "Fentry":
      state.write_isize(2);
      hash_InstrumentMcountOpts(self._0, state);
      return;
  }
};
/** `#[derive(Hash)] struct InstrumentXRay` (config.rs:311), fields in declaration order. */
const hash_InstrumentXRay: HashFn<InstrumentXRay> = (self, state) => {
  hash_bool(self.always, state);
  hash_bool(self.never, state);
  hash_bool(self.ignore_loops, state);
  hash_Option(hash_usize)(self.instruction_threshold, state);
  hash_bool(self.skip_entry, state);
  hash_bool(self.skip_exit, state);
};
/** `#[derive(Hash)] struct NativeLib { name, new_name, kind, verbatim }` (compiler/rustc_session/src/utils.rs:23) */
const hash_NativeLib: HashFn<NativeLib> = (self, state) => {
  hash_str(self.name, state);
  hash_Option(hash_str)(self.new_name, state);
  // `kind: NativeLibKind` (compiler/rustc_structures/src/native_lib_kind.rs:6)
  // PORT: `NativeLib.kind` is an opaque stand-in (utils.ts); only reached with `-l`.
  void self.kind;
  unported("Hash for rustc_structures::NativeLibKind (stand-in in rustc_session/utils.ts)");
  hash_Option(hash_bool)(self.verbatim, state);
};
/** `#[derive(Hash)] enum LinkerPluginLto { LinkerPlugin(PathBuf), LinkerPluginAuto, Disabled }` (config.rs:329) */
const hash_LinkerPluginLto: HashFn<LinkerPluginLto> = (self, state) => {
  switch (self.$) {
    case "LinkerPlugin":
      state.write_isize(0);
      hash_PathBuf(self._0, state);
      return;
    case "LinkerPluginAuto":
      state.write_isize(1);
      return;
    case "Disabled":
      state.write_isize(2);
      return;
  }
};
/** `impl Hash for TargetTuple` (compiler/rustc_target/src/spec/tuple.rs:37): a `u8` tag, then the tuple (and the
 * contents of a target JSON; `path_for_rustdoc` is not hashed). */
const hash_TargetTuple: HashFn<TargetTuple> = (self, state) => {
  switch (self.$) {
    case "TargetTuple":
      hash_u8(0, state);
      hash_str(self._0, state);
      return;
    case "TargetJson":
      hash_u8(1, state);
      hash_str(self.tuple, state);
      hash_str(self.contents, state);
      return;
  }
};
/** `#[derive(Hash)] enum SwitchWithOptPath { Enabled(Option<PathBuf>), Disabled }` (config.rs:592) */
const hash_SwitchWithOptPath: HashFn<SwitchWithOptPath> = (self, state) => {
  switch (self.$) {
    case "Enabled":
      state.write_isize(0);
      hash_Option(hash_PathBuf)(self._0, state);
      return;
    case "Disabled":
      state.write_isize(1);
      return;
  }
};
/** `#[derive(Hash)] enum OutFileName { Real(PathBuf), Stdout }` (config.rs:1136) */
const hash_OutFileName: HashFn<OutFileName> = (self, state) => {
  switch (self.$) {
    case "Real":
      state.write_isize(0);
      hash_PathBuf(self._0, state);
      return;
    case "Stdout":
      state.write_isize(1);
      return;
  }
};
/** `#[derive(Hash)] struct LocationDetail { file, line, column }` (config.rs:562) */
const hash_LocationDetail: HashFn<LocationDetail> = (self, state) => {
  hash_bool(self.file, state);
  hash_bool(self.line, state);
  hash_bool(self.column, state);
};
/** `#[derive(Hash)] struct PacRet { leaf: bool, pc: bool, key: PAuthKey }` (config.rs:1658) */
const hash_PacRet: HashFn<PacRet> = (self, state) => {
  hash_bool(self.leaf, state);
  hash_bool(self.pc, state);
  hash_fieldless(PAuthKey_discriminant)(self.key, state);
};
/** `#[derive(Hash)] struct BranchProtection { bti: bool, pac_ret: Option<PacRet>, gcs: bool }` (config.rs:1665) */
const hash_BranchProtection: HashFn<BranchProtection> = (self, state) => {
  hash_bool(self.bti, state);
  hash_Option(hash_PacRet)(self.pac_ret, state);
  hash_bool(self.gcs, state);
};
/** `#[derive(Hash)] struct PatchableFunctionEntry { prefix: u8, entry: u8, section: Option<String> }` (config.rs:3639) */
const hash_PatchableFunctionEntry: HashFn<PatchableFunctionEntry> = (self, state) => {
  hash_u8(self.prefix_, state);
  hash_u8(self.entry_, state);
  hash_Option(hash_str)(self.section_, state);
};
/** `#[derive(Hash)] enum InliningThreshold { Always, Sometimes(usize), Never }` (config.rs:3710) */
const hash_InliningThreshold: HashFn<InliningThreshold> = (self, state) => {
  switch (self.$) {
    case "Always":
      state.write_isize(0);
      return;
    case "Sometimes":
      state.write_isize(1);
      hash_usize(self._0, state);
      return;
    case "Never":
      state.write_isize(2);
      return;
  }
};
/** `#[derive(Hash)] struct CodegenRetagOptions { no_precise_im: bool, no_precise_pin: bool }` (config.rs:237) */
const hash_CodegenRetagOptions: HashFn<CodegenRetagOptions> = (self, state) => {
  hash_bool(self.no_precise_im, state);
  hash_bool(self.no_precise_pin, state);
};
/** `#[derive(Hash)] struct RustcVersion { major: u16, minor: u16, patch: u16 }` (compiler/rustc_ast/src/attr/version.rs:8) */
const hash_RustcVersion: HashFn<RustcVersion> = (self, state) => {
  hash_u16(self.major, state);
  hash_u16(self.minor, state);
  hash_u16(self.patch, state);
};

// rustc: compiler/rustc_session/src/config.rs:3411 hash
/** `macro_rules! impl_dep_tracking_hash_via_hash`: `DepTrackingHash` through `Hash::hash(self, hasher)`. */
function impl_dep_tracking_hash_via_hash<T>(hash: HashFn<T>): DepTrackingHash<T> {
  return (self, hasher, _, _for_crate_hash) => {
    hash(self, hasher);
  };
}

// rustc: compiler/rustc_session/src/config.rs:3419 hash
/** `impl<T: DepTrackingHash> DepTrackingHash for Option<T>` */
function DepTrackingHash_Option<T>(T_: DepTrackingHash<T>): DepTrackingHash<T | undefined> {
  return (self, hasher, error_format, for_crate_hash) => {
    if (self !== undefined) {
      // `Hash::hash(&1, hasher)`: an `i32` literal
      hasher.write_i32(1);
      T_(self, hasher, error_format, for_crate_hash);
    } else {
      hasher.write_i32(0);
    }
  };
}

/** `impl_dep_tracking_hash_via_hash!(...)` (config.rs:3436), keyed by the Rust type (`()` is `unit`,
 * `NonZero<usize>` is `NonZero_usize`, `lint::Level` is `Level`). */
const via_hash = {
  unit: impl_dep_tracking_hash_via_hash<undefined>(() => {}),
  AnnotateMoves: impl_dep_tracking_hash_via_hash(hash_AnnotateMoves),
  AutoDiff: impl_dep_tracking_hash_via_hash(hash_AutoDiff),
  Offload: impl_dep_tracking_hash_via_hash(hash_Offload),
  bool: impl_dep_tracking_hash_via_hash(hash_bool),
  usize: impl_dep_tracking_hash_via_hash(hash_usize),
  NonZero_usize: impl_dep_tracking_hash_via_hash(hash_usize),
  u64: impl_dep_tracking_hash_via_hash(hash_u64),
  Hash64: impl_dep_tracking_hash_via_hash<Hash64>((self, state) => Hash64.hash(self, state)),
  String: impl_dep_tracking_hash_via_hash(hash_str),
  PathBuf: impl_dep_tracking_hash_via_hash(hash_PathBuf),
  Level: impl_dep_tracking_hash_via_hash(hash_fieldless(Level_discriminant)),
  WasiExecModel: impl_dep_tracking_hash_via_hash(hash_fieldless(WasiExecModel_discriminant)),
  u32: impl_dep_tracking_hash_via_hash(hash_u32),
  FramePointer: impl_dep_tracking_hash_via_hash(hash_fieldless(FramePointer_discriminant)),
  RelocModel: impl_dep_tracking_hash_via_hash(hash_fieldless(RelocModel_discriminant)),
  CodeModel: impl_dep_tracking_hash_via_hash(hash_fieldless(CodeModel_discriminant)),
  TlsModel: impl_dep_tracking_hash_via_hash(hash_fieldless(TlsModel_discriminant)),
  InstrumentCoverage: impl_dep_tracking_hash_via_hash(hash_fieldless(InstrumentCoverage_discriminant)),
  CoverageOptions: impl_dep_tracking_hash_via_hash(hash_CoverageOptions),
  InstrumentMcount: impl_dep_tracking_hash_via_hash(hash_InstrumentMcount),
  InstrumentMcountOpts: impl_dep_tracking_hash_via_hash(hash_InstrumentMcountOpts),
  InstrumentXRay: impl_dep_tracking_hash_via_hash(hash_InstrumentXRay),
  CrateType: impl_dep_tracking_hash_via_hash<CrateType>(hash_fieldless(CrateType_discriminant)),
  MergeFunctions: impl_dep_tracking_hash_via_hash(hash_fieldless(MergeFunctions_discriminant)),
  OnBrokenPipe: impl_dep_tracking_hash_via_hash(hash_fieldless(OnBrokenPipe_discriminant)),
  PanicStrategy: impl_dep_tracking_hash_via_hash(hash_fieldless(PanicStrategy_discriminant)),
  RelroLevel: impl_dep_tracking_hash_via_hash(hash_fieldless(RelroLevel_discriminant)),
  OptLevel: impl_dep_tracking_hash_via_hash(hash_fieldless(OptLevel_discriminant)),
  LtoCli: impl_dep_tracking_hash_via_hash(hash_fieldless(LtoCli_discriminant)),
  DebugInfo: impl_dep_tracking_hash_via_hash(hash_fieldless(DebugInfo_discriminant)),
  DebugInfoCompression: impl_dep_tracking_hash_via_hash(hash_fieldless(DebugInfoCompression_discriminant)),
  MirStripDebugInfo: impl_dep_tracking_hash_via_hash(hash_fieldless(MirStripDebugInfo_discriminant)),
  // `#[derive(Hash)]` with explicit discriminants `No = 0` .. `Yes = 3` (rustc_structures collapse_macro_debug_info.rs:13)
  CollapseMacroDebuginfo: impl_dep_tracking_hash_via_hash<CollapseMacroDebuginfo>(hash_fieldless(CollapseMacroDebuginfo_discriminant)),
  UnstableFeatures: impl_dep_tracking_hash_via_hash(hash_fieldless(UnstableFeatures_discriminant)),
  NativeLib: impl_dep_tracking_hash_via_hash(hash_NativeLib),
  // `#[derive(Hash)] struct SanitizerSet(u16)` (rustc_structures sanitizer_set.rs:9): its bits.
  SanitizerSet: impl_dep_tracking_hash_via_hash<SanitizerSet>(hash_u16),
  CFGuard: impl_dep_tracking_hash_via_hash(hash_fieldless(CFGuard_discriminant)),
  CFProtection: impl_dep_tracking_hash_via_hash(hash_fieldless(CFProtection_discriminant)),
  TargetTuple: impl_dep_tracking_hash_via_hash(hash_TargetTuple),
  Edition: impl_dep_tracking_hash_via_hash(hash_fieldless(Edition_discriminant)),
  LinkerPluginLto: impl_dep_tracking_hash_via_hash(hash_LinkerPluginLto),
  ResolveDocLinks: impl_dep_tracking_hash_via_hash(hash_fieldless(ResolveDocLinks_discriminant)),
  SplitDebuginfo: impl_dep_tracking_hash_via_hash(hash_fieldless(SplitDebuginfo_discriminant)),
  SplitDwarfKind: impl_dep_tracking_hash_via_hash(hash_fieldless(SplitDwarfKind_discriminant)),
  StackProtector: impl_dep_tracking_hash_via_hash(hash_fieldless(StackProtector_discriminant)),
  SwitchWithOptPath: impl_dep_tracking_hash_via_hash(hash_SwitchWithOptPath),
  SymbolManglingVersion: impl_dep_tracking_hash_via_hash(hash_fieldless(SymbolManglingVersion_discriminant)),
  SymbolVisibility: impl_dep_tracking_hash_via_hash(hash_fieldless(SymbolVisibility_discriminant)),
  // `#[derive(Hash)]` of a `bitflags!` `u8` struct: its bits (rustc_span lib.rs:241).
  RemapPathScopeComponents: impl_dep_tracking_hash_via_hash<RemapPathScopeComponents>(hash_u8),
  SourceFileHashAlgorithm: impl_dep_tracking_hash_via_hash(hash_fieldless(SourceFileHashAlgorithm_discriminant)),
  OutFileName: impl_dep_tracking_hash_via_hash(hash_OutFileName),
  OutputType: impl_dep_tracking_hash_via_hash(hash_fieldless(OutputType_discriminant)),
  // `impl Hash for RealFileName` (rustc_span lib.rs:330)
  RealFileName: impl_dep_tracking_hash_via_hash<RealFileName>((self, state) => self.hash(state)),
  LocationDetail: impl_dep_tracking_hash_via_hash(hash_LocationDetail),
  FmtDebug: impl_dep_tracking_hash_via_hash(hash_fieldless(FmtDebug_discriminant)),
  BranchProtection: impl_dep_tracking_hash_via_hash(hash_BranchProtection),
  // PORT: `unic_langid::LanguageIdentifier` (`-Ztranslate-lang`, an untracked option) is not ported.
  LanguageIdentifier: impl_dep_tracking_hash_via_hash<unknown>(() => unported("Hash for unic_langid::LanguageIdentifier")),
  NextSolverConfig: impl_dep_tracking_hash_via_hash(hash_fieldless(NextSolverConfig_discriminant)),
  PatchableFunctionEntry: impl_dep_tracking_hash_via_hash(hash_PatchableFunctionEntry),
  Polonius: impl_dep_tracking_hash_via_hash(hash_fieldless(Polonius_discriminant)),
  InliningThreshold: impl_dep_tracking_hash_via_hash(hash_InliningThreshold),
  FunctionReturn: impl_dep_tracking_hash_via_hash(hash_fieldless(FunctionReturn_discriminant)),
  // `#[derive(Hash)] struct Align { pow2: u8 }` (rustc_abi lib.rs:1102)
  Align: impl_dep_tracking_hash_via_hash<Align>((self, state) => hash_u8(self.pow2, state)),
  CodegenRetagOptions: impl_dep_tracking_hash_via_hash(hash_CodegenRetagOptions),
  RustcVersion: impl_dep_tracking_hash_via_hash(hash_RustcVersion),
  PointerAuthOption: impl_dep_tracking_hash_via_hash(hash_fieldless(PointerAuthOption_discriminant)),
} as const;

// rustc: compiler/rustc_session/src/config.rs:3510 hash
/** `impl<T1: DepTrackingHash, T2: DepTrackingHash> DepTrackingHash for (T1, T2)` */
function DepTrackingHash_tuple2<T1, T2>(T1_: DepTrackingHash<T1>, T2_: DepTrackingHash<T2>): DepTrackingHash<readonly [T1, T2]> {
  return (self, hasher, error_format, for_crate_hash) => {
    // `Hash::hash(&0, hasher)` etc.: `i32` literals
    hasher.write_i32(0);
    T1_(self[0], hasher, error_format, for_crate_hash);
    hasher.write_i32(1);
    T2_(self[1], hasher, error_format, for_crate_hash);
  };
}

// rustc: compiler/rustc_session/src/config.rs:3529 hash
/** `impl<T1, T2, T3> DepTrackingHash for (T1, T2, T3)` */
function DepTrackingHash_tuple3<T1, T2, T3>(
  T1_: DepTrackingHash<T1>,
  T2_: DepTrackingHash<T2>,
  T3_: DepTrackingHash<T3>,
): DepTrackingHash<readonly [T1, T2, T3]> {
  return (self, hasher, error_format, for_crate_hash) => {
    hasher.write_i32(0);
    T1_(self[0], hasher, error_format, for_crate_hash);
    hasher.write_i32(1);
    T2_(self[1], hasher, error_format, for_crate_hash);
    hasher.write_i32(2);
    T3_(self[2], hasher, error_format, for_crate_hash);
  };
}

// rustc: compiler/rustc_session/src/config.rs:3545 hash
/** `impl<T: DepTrackingHash> DepTrackingHash for Vec<T>` */
function DepTrackingHash_Vec<T>(T_: DepTrackingHash<T>): DepTrackingHash<readonly T[]> {
  return (self, hasher, error_format, for_crate_hash) => {
    hasher.write_usize(self.length);
    for (let index = 0; index < self.length; index++) {
      hasher.write_usize(index);
      T_(self[index]!, hasher, error_format, for_crate_hash);
    }
  };
}

// rustc: compiler/rustc_session/src/config.rs:3560 hash
/** `impl<T: DepTrackingHash, V: DepTrackingHash> DepTrackingHash for FxIndexMap<T, V>` (`FxIndexMap` is a `Map`,
 * iterated in insertion order). */
function DepTrackingHash_FxIndexMap<T, V>(T_: DepTrackingHash<T>, V_: DepTrackingHash<V>): DepTrackingHash<ReadonlyMap<T, V>> {
  return (self, hasher, error_format, for_crate_hash) => {
    hasher.write_usize(self.size);
    for (const [key, value] of self) {
      T_(key, hasher, error_format, for_crate_hash);
      V_(value, hasher, error_format, for_crate_hash);
    }
  };
}

// rustc: compiler/rustc_session/src/config.rs:3575 hash
/** `impl DepTrackingHash for OutputTypes`. PORT: `OutputTypes.0` is a `Map` kept in key order (`sorted_output_types`),
 * so iterating it is the `BTreeMap`'s order. */
const DepTrackingHash_OutputTypes: DepTrackingHash<OutputTypes> = (self, hasher, error_format, for_crate_hash) => {
  hasher.write_usize(self._0.size);
  for (const [key, val] of self._0) {
    via_hash.OutputType(key, hasher, error_format, for_crate_hash);
    if (!for_crate_hash) {
      DepTrackingHash_Option(via_hash.OutFileName)(val, hasher, error_format, for_crate_hash);
    }
  }
};

// This is a stable hash because BTreeMap is a sorted container
// rustc: compiler/rustc_session/src/config.rs:3592 stable_hash
/** PORT: the `BTreeMap<&'static str, &dyn DepTrackingHash>` is a `Map` iterated in key order (the keys are ASCII
 * option names, so JS string order is byte order). */
function stable_hash(
  sub_hashes: ReadonlyMap<string, DynDepTrackingHash>,
  hasher: StableHasher,
  error_format: ErrorOutputType,
  for_crate_hash: boolean,
): void {
  for (const key of [...sub_hashes.keys()].sort()) {
    const sub_hash = sub_hashes.get(key)!;
    // Using Hash::hash() instead of DepTrackingHash::hash() is fine for
    // the keys, as they are just plain strings
    hasher.write_usize(utf8_len(key));
    hash_str(key, hasher);
    sub_hash.hash(hasher, error_format, for_crate_hash);
  }
}

/** `$opt_expr as &dyn dep_tracking::DepTrackingHash` (options.rs `insert!`). */
function dyn_DepTrackingHash<T>(self: T, T_: DepTrackingHash<T>): DynDepTrackingHash {
  return { hash: (hasher, error_format, for_crate_hash) => T_(self, hasher, error_format, for_crate_hash) };
}

/** `pub(crate) mod dep_tracking` */
export const dep_tracking = {
  via_hash,
  Option: DepTrackingHash_Option,
  tuple2: DepTrackingHash_tuple2,
  tuple3: DepTrackingHash_tuple3,
  Vec: DepTrackingHash_Vec,
  FxIndexMap: DepTrackingHash_FxIndexMap,
  OutputTypes: DepTrackingHash_OutputTypes,
  stable_hash,
  dyn: dyn_DepTrackingHash,
} as const;

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
