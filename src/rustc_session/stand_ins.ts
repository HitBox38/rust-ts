// Not an upstream mirror. PORT: stand-ins for types from crates and modules that are not ported yet but
// that the `-C`/`-Z` option tables (options.rs, config.rs) name. Each stand-in carries only what can be
// copied verbatim from upstream (variant names, bitflag values); every piece of logic calls
// `unported(...)`. When the owning crate is ported, replace the stand-in by a re-export and delete it here.
//
//   rustc_target::spec        re-exports of the ported spec types (src/rustc_target/spec/mod.ts)
//   rustc_structures          SanitizerSet, CollapseMacroDebuginfo, CrateType
//   rustc_abi                 Align (re-export of src/rustc_abi)
//   rustc_data_structures     TimePassesFormat, SelfProfilerRef (profiling.rs)
//
// `EarlyDiagCtxt` (session.rs) and `getopts::Matches` are the real types now; the aliases below keep the
// structural subsets that `build_options` (options.ts) uses, so tests can pass small fakes.
import type { PathBuf } from "../rustc_error_messages/lib.ts";
import type { EarlyDiagCtxt as EarlyDiagCtxtReal } from "./session.ts";
import type { Matches as MatchesReal } from "../vendor/getopts/lib.ts";
import { type Debug } from "../std/fmt.ts";
import { panic, unported } from "../std/panic.ts";
import { Ok, type Result } from "../std/result.ts";

/** An opaque stand-in for a type that is not ported yet (named by its upstream path). */
export interface Unported<N extends string> {
  readonly __unported: N;
}

// ---- rustc_target::spec ----
// PORT: rustc_target's spec is ported (src/rustc_target); these re-exports keep the names the option
// tables import from here.
// PORT: `lib.ts` first, so the spec and its `target_features.ts` methods are evaluated (PORTING §8).
import "../rustc_target/lib.ts";
export {
  CodeModel,
  FramePointer,
  LinkerFeatures,
  LinkerFlavorCli,
  LinkSelfContainedComponents,
  MergeFunctions,
  OnBrokenPipe,
  PanicStrategy,
  RelocModel,
  RelroLevel,
  SplitDebuginfo,
  StackProtector,
  SymbolVisibility,
  Target,
  TargetTuple,
  TargetWarnings,
  TlsModel,
} from "../rustc_target/spec/mod.ts";
import type { CodeModel, FramePointer, StackProtector } from "../rustc_target/spec/mod.ts";
/** `#[derive(Debug)]` of the `target_spec_enum!` types (the variant name). */
export const debug_CodeModel: Debug<CodeModel> = (v) => v;
export const debug_FramePointer: Debug<FramePointer> = (v) => v;
export const debug_StackProtector: Debug<StackProtector> = (v) => v;

// ---- rustc_structures ----

export { SanitizerSet, debug_SanitizerSet } from "../rustc_target/stand_ins.ts";

/** rustc_structures/src/collapse_macro_debug_info.rs:13 */
export type CollapseMacroDebuginfo = "No" | "Unspecified" | "External" | "Yes";
export const CollapseMacroDebuginfo = { No: "No", Unspecified: "Unspecified", External: "External", Yes: "Yes" } as const;

/** rustc_structures/src/crate_type.rs:10 `CrateType` (variants copied; `#[default] Rlib`). */
export type CrateType = "Executable" | "Dylib" | "Rlib" | "StaticLib" | "Cdylib" | "ProcMacro" | "Sdylib";
export const CrateType = {
  Executable: "Executable",
  Dylib: "Dylib",
  Rlib: "Rlib",
  StaticLib: "StaticLib",
  Cdylib: "Cdylib",
  ProcMacro: "ProcMacro",
  Sdylib: "Sdylib",
  /** `#[derive(Default)]` with `#[default] Rlib` */
  default: (): CrateType => "Rlib",
} as const;
export const debug_CrateType: Debug<CrateType> = (v) => v;

// ---- rustc_abi ----

export { Align } from "../rustc_abi/lib.ts";

// ---- rustc_data_structures::profiling ----

/** rustc_data_structures/src/profiling.rs:162 */
export type TimePassesFormat = "Text" | "Json";
export const TimePassesFormat = { Text: "Text", Json: "Json" } as const;

/**
 * rustc_data_structures/src/profiling.rs `SelfProfilerRef` (stand-in).
 * PORT: only the "no self-profiler, no `-Z time-passes`" behaviour is kept, as upstream computes it:
 * with `profiler: None` the event filter mask is empty, so every `exec` returns `TimingGuard::none()`,
 * and with `print_verbose_generic_activities: None` a `VerboseTimingGuard` prints nothing on drop.
 * A self-profiler (`-Z self-profile`) or time-passes printing is unported.
 */
export class SelfProfilerRef {
  constructor(
    readonly profiler: undefined,
    readonly print_verbose_generic_activities: TimePassesFormat | undefined,
  ) {}

  /** profiling.rs `SelfProfilerRef::new` */
  static new(profiler: unknown, print_verbose_generic_activities: TimePassesFormat | undefined): SelfProfilerRef {
    if (profiler !== undefined) unported("rustc_data_structures::profiling::SelfProfiler (-Z self-profile)");
    return new SelfProfilerRef(undefined, print_verbose_generic_activities);
  }

  /** profiling.rs `SelfProfilerRef::verbose_generic_activity` */
  verbose_generic_activity(_event_label: string): VerboseTimingGuard {
    if (this.print_verbose_generic_activities !== undefined) {
      unported("rustc_data_structures::profiling::VerboseTimingGuard (-Z time-passes)");
    }
    return VERBOSE_TIMING_GUARD_NONE;
  }

  /** profiling.rs `SelfProfilerRef::generic_activity` (empty event filter mask: `TimingGuard::none()`) */
  generic_activity(_event_label: string): VerboseTimingGuard {
    return VERBOSE_TIMING_GUARD_NONE;
  }

  /** profiling.rs `SelfProfilerRef::is_args_recording_enabled` (empty event filter mask: false) */
  is_args_recording_enabled(): boolean {
    return false;
  }
}

/** profiling.rs `VerboseTimingGuard` / `TimingGuard` without a message or profiler: `run` just calls `f`. */
export interface VerboseTimingGuard {
  run<R>(f: () => R): R;
}
const VERBOSE_TIMING_GUARD_NONE: VerboseTimingGuard = { run: (f) => f() };

// ---- rustc_session::session ----

/** The parts of `EarlyDiagCtxt` (session.rs) that `build_options` uses (structural subset of the real type). */
export type EarlyDiagCtxt = Pick<EarlyDiagCtxtReal, "early_warn" | "early_fatal" | "early_struct_fatal">;

// ---- getopts ----

/** The part of `getopts::Matches` that `build_options` uses (structural subset of the real type). */
export type Matches = Pick<MatchesReal, "opt_strs_pos">;

// ---- rustc_session types named by `Options` ----

export type { Externs, Jobs, OutputTypes, PpMode, Sysroot } from "./config.ts";
export type { PrintRequest } from "./config/print_request.ts";
export type { SearchPath } from "./search_paths.ts";

// ---- rustc_session::filesearch ----

export { DEFAULT_SYSROOT_STANDIN, default_sysroot } from "./filesearch.ts";

// ---- deferred values ----

/**
 * PORT: a field whose upstream value is computed by crates that are not ported (rustc_target,
 * rustc_codegen_*, rustc_lint, filesearch, ...) and that nothing on the ported path reads. The field becomes
 * a getter that calls `unported(what)` when it is read (or written), so a later use fails loudly instead of
 * seeing a made-up value.
 */
export function defer_field<T extends object>(obj: T, key: keyof T & string, what: string): void {
  Object.defineProperty(obj, key, {
    configurable: true,
    enumerable: true,
    get: () => unported(what),
    set: () => unported(what),
  });
}
