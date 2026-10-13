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

/** rustc_structures/src/sanitizer_set.rs:9 `bitflags! SanitizerSet: u16` (values copied). */
export type SanitizerSet = number;
export const SanitizerSet = {
  ADDRESS: 1 << 0,
  LEAK: 1 << 1,
  MEMORY: 1 << 2,
  THREAD: 1 << 3,
  HWADDRESS: 1 << 4,
  CFI: 1 << 5,
  MEMTAG: 1 << 6,
  SHADOWCALLSTACK: 1 << 7,
  KCFI: 1 << 8,
  KERNELADDRESS: 1 << 9,
  KERNELHWADDRESS: 1 << 10,
  SAFESTACK: 1 << 11,
  DATAFLOW: 1 << 12,
  REALTIME: 1 << 13,
  empty: (): SanitizerSet => 0,
  /** `#[derive(Default)]` of the bitflags newtype: no bits. */
  default: (): SanitizerSet => 0,
  /** bitflags `all()` */
  all: (): SanitizerSet => (1 << 14) - 1,
  /** bitflags `contains` */
  contains: (self: SanitizerSet, other: SanitizerSet): boolean => (self & other) === other,
  /** bitflags `iter()`: the named flags contained in `self`, in definition order (then any unknown bits). */
  iter(self: SanitizerSet): SanitizerSet[] {
    const out: SanitizerSet[] = [];
    let rest = self;
    for (let i = 0; i < 14; i++) {
      const f = 1 << i;
      if ((self & f) === f) {
        out.push(f);
        rest &= ~f;
      }
    }
    if (rest !== 0) out.push(rest);
    return out;
  },

  // PORT: the fns below are copied verbatim from rustc_structures/src/sanitizer_set.rs (no markers:
  // the hir-def lane ports rustc_structures; replace this stand-in by its module then).

  /** `const MUTUALLY_EXCLUSIVE` */
  MUTUALLY_EXCLUSIVE: [
    [1 << 0, 1 << 2],
    [1 << 0, 1 << 3],
    [1 << 0, 1 << 4],
    [1 << 0, 1 << 6],
    [1 << 0, 1 << 9],
    [1 << 0, 1 << 10],
    [1 << 0, 1 << 11],
    [1 << 1, 1 << 2],
    [1 << 1, 1 << 3],
    [1 << 1, 1 << 9],
    [1 << 1, 1 << 10],
    [1 << 1, 1 << 11],
    [1 << 2, 1 << 3],
    [1 << 2, 1 << 4],
    [1 << 2, 1 << 9],
    [1 << 2, 1 << 10],
    [1 << 2, 1 << 11],
    [1 << 3, 1 << 4],
    [1 << 3, 1 << 9],
    [1 << 3, 1 << 10],
    [1 << 3, 1 << 11],
    [1 << 4, 1 << 6],
    [1 << 4, 1 << 9],
    [1 << 4, 1 << 10],
    [1 << 4, 1 << 11],
    [1 << 5, 1 << 8],
    [1 << 6, 1 << 9],
    [1 << 6, 1 << 10],
    [1 << 9, 1 << 10],
    [1 << 9, 1 << 11],
    [1 << 10, 1 << 11],
  ] as readonly (readonly [SanitizerSet, SanitizerSet])[],

  /** sanitizer_set.rs `as_str` */
  as_str(self: SanitizerSet): string | undefined {
    switch (self) {
      case 1 << 0:
        return "address";
      case 1 << 5:
        return "cfi";
      case 1 << 12:
        return "dataflow";
      case 1 << 8:
        return "kcfi";
      case 1 << 9:
        return "kernel-address";
      case 1 << 10:
        return "kernel-hwaddress";
      case 1 << 1:
        return "leak";
      case 1 << 2:
        return "memory";
      case 1 << 6:
        return "memtag";
      case 1 << 11:
        return "safestack";
      case 1 << 7:
        return "shadow-call-stack";
      case 1 << 3:
        return "thread";
      case 1 << 4:
        return "hwaddress";
      case 1 << 13:
        return "realtime";
      default:
        return undefined;
    }
  },

  /** sanitizer_set.rs `combine_with_defaults` */
  combine_with_defaults(self: SanitizerSet, defaults: SanitizerSet): SanitizerSet {
    for (const [a, b] of SanitizerSet.MUTUALLY_EXCLUSIVE) {
      if ((defaults & a) === a && (self & b) === b) {
        defaults &= ~a;
      }
      if ((defaults & b) === b && (self & a) === a) {
        defaults &= ~b;
      }
    }
    return self | defaults;
  },

  /** sanitizer_set.rs `impl Display` (comma separated names) */
  display(self: SanitizerSet): string {
    return SanitizerSet.iter(self)
      .map((s) => SanitizerSet.as_str(s) ?? panic(`unrecognized sanitizer ${s}`))
      .join(", ");
  },
} as const;
// PORT: `external_bitflags_debug!` (rustc_data_structures) is not ported.
export const debug_SanitizerSet: Debug<SanitizerSet> = () => unported("rustc_structures::SanitizerSet Debug");

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
/** search_paths.rs `SearchPath` (opaque: search_paths.rs is not ported; only `-L` creates one) */
export type SearchPath = Unported<"rustc_session::search_paths::SearchPath">;

// ---- rustc_session::filesearch ----

/**
 * PORT: rust-ts has no sysroot of its own yet. Upstream `filesearch::default_sysroot()` derives it from the
 * path of the loaded `librustc_driver` (`current_dll_path`), which has no TS counterpart. The stand-in
 * returns this marker path, which names no directory: every filesystem probe below it fails (as for a
 * sysroot without the `rust-src`/`rustc-dev` components). Nothing on the `-Zunpretty=ast-tree` path reads
 * files from the sysroot; the target and codegen backend that would are stand-ins.
 */
export const DEFAULT_SYSROOT_STANDIN: PathBuf = "<rust-ts: default sysroot unported>";
/** rustc_session/src/filesearch.rs:279 `default_sysroot` (stand-in, see `DEFAULT_SYSROOT_STANDIN`). */
export function default_sysroot(): PathBuf {
  return DEFAULT_SYSROOT_STANDIN;
}

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
