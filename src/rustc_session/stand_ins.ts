// Not an upstream mirror. PORT: stand-ins for types from crates and modules that are not ported yet but
// that the `-C`/`-Z` option tables (options.rs, config.rs) name. Each stand-in carries only what can be
// copied verbatim from upstream (variant names, bitflag values); every piece of logic calls
// `unported(...)`. When the owning crate is ported, replace the stand-in by a re-export and delete it here.
//
//   rustc_target::spec        CodeModel, FramePointer (+ratchet), LinkerFlavorCli, MergeFunctions,
//                             OnBrokenPipe, PanicStrategy, RelocModel, RelroLevel, SplitDebuginfo,
//                             StackProtector, SymbolVisibility, TlsModel, LinkSelfContainedComponents,
//                             LinkerFeatures, TargetTuple
//   rustc_structures          SanitizerSet, CollapseMacroDebuginfo, CrateType
//   rustc_abi                 Align
//   rustc_data_structures     TimePassesFormat, SelfProfilerRef (profiling.rs)
//   rustc_target::spec        Target (driver stand-in: a few fields per built-in host target, see below)
//   rustc_session::filesearch default_sysroot
//   rustc_session::config     externs::split_extern_opt, native_libs::parse_native_lib
//
// `EarlyDiagCtxt` (session.rs) and `getopts::Matches` are the real types now; the aliases below keep the
// structural subsets that `build_options` (options.ts) uses, so tests can pass small fakes.
import type { PathBuf } from "../rustc_error_messages/lib.ts";
import type { EarlyDiagCtxt as EarlyDiagCtxtReal } from "./session.ts";
import type { Matches as MatchesReal } from "../vendor/getopts/lib.ts";
import { type Debug } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import { Ok, type Result } from "../std/result.ts";

/** An opaque stand-in for a type that is not ported yet (named by its upstream path). */
export interface Unported<N extends string> {
  readonly __unported: N;
}

// ---- rustc_target::spec (compiler/rustc_target/src/spec/mod.rs; `target_spec_enum!` types) ----

// PORT: `target_spec_enum!` (rustc_target/src/lib.rs:71) derives `FromStr`, `Debug`, `desc`. Only the
// variants are copied; `from_str` is unported until rustc_target is ported.
function target_spec_from_str<T>(name: string): (s: string) => Result<T, string> {
  return (_s: string) => {
    unported(`rustc_target::spec::${name}::from_str`);
  };
}
function target_spec_debug<T extends string>(): Debug<T> {
  return (v) => v;
}

/** rustc_target/src/spec/mod.rs:974 */
export type CodeModel = "Tiny" | "Small" | "Kernel" | "Medium" | "Large";
export const CodeModel = {
  Tiny: "Tiny",
  Small: "Small",
  Kernel: "Kernel",
  Medium: "Medium",
  Large: "Large",
  from_str: target_spec_from_str<CodeModel>("CodeModel"),
} as const;
export const debug_CodeModel: Debug<CodeModel> = target_spec_debug();

/** rustc_target/src/spec/mod.rs:1171 */
export type FramePointer = "Always" | "NonLeaf" | "MayOmit";
export const FramePointer = {
  Always: "Always",
  NonLeaf: "NonLeaf",
  MayOmit: "MayOmit",
  from_str: target_spec_from_str<FramePointer>("FramePointer"),
  /** rustc_target/src/spec/mod.rs:1190 `ratchet(&mut self, rhs)` */
  ratchet(_self: { value: FramePointer }, _rhs: FramePointer): FramePointer {
    unported("rustc_target::spec::FramePointer::ratchet");
  },
} as const;
export const debug_FramePointer: Debug<FramePointer> = target_spec_debug();

/** rustc_target/src/spec/mod.rs:146 (data variants are opaque here) */
export type LinkerFlavorCli = Unported<"rustc_target::spec::LinkerFlavorCli">;
export const LinkerFlavorCli = {
  from_str(_s: string): Result<LinkerFlavorCli, string> {
    unported("rustc_target::spec::LinkerFlavorCli::from_str");
  },
} as const;

/** rustc_target/src/spec/mod.rs:929 */
export type MergeFunctions = "Disabled" | "Trampolines" | "Aliases";
export const MergeFunctions = {
  Disabled: "Disabled",
  Trampolines: "Trampolines",
  Aliases: "Aliases",
  from_str: target_spec_from_str<MergeFunctions>("MergeFunctions"),
} as const;

/** rustc_target/src/spec/mod.rs:830 */
export type OnBrokenPipe = "Default" | "Kill" | "Error" | "Inherit";
export const OnBrokenPipe = { Default: "Default", Kill: "Kill", Error: "Error", Inherit: "Inherit" } as const;

/** rustc_target/src/spec/mod.rs:820 */
export type PanicStrategy = "Unwind" | "Abort" | "ImmediateAbort";
export const PanicStrategy = {
  Unwind: "Unwind",
  Abort: "Abort",
  ImmediateAbort: "ImmediateAbort",
  from_str: target_spec_from_str<PanicStrategy>("PanicStrategy"),
} as const;

/** rustc_target/src/spec/mod.rs:946 */
export type RelocModel = "Static" | "Pic" | "Pie" | "DynamicNoPic" | "Ropi" | "Rwpi" | "RopiRwpi";
export const RelocModel = {
  Static: "Static",
  Pic: "Pic",
  Pie: "Pie",
  DynamicNoPic: "DynamicNoPic",
  Ropi: "Ropi",
  Rwpi: "Rwpi",
  RopiRwpi: "RopiRwpi",
  from_str: target_spec_from_str<RelocModel>("RelocModel"),
} as const;

/** rustc_target/src/spec/mod.rs:852 */
export type RelroLevel = "Full" | "Partial" | "Off" | "None";
export const RelroLevel = {
  Full: "Full",
  Partial: "Partial",
  Off: "Off",
  None: "None",
  from_str: target_spec_from_str<RelroLevel>("RelroLevel"),
} as const;

/** rustc_target/src/spec/mod.rs:1082 */
export type SplitDebuginfo = "Off" | "Packed" | "Unpacked";
export const SplitDebuginfo = {
  Off: "Off",
  Packed: "Packed",
  Unpacked: "Unpacked",
  from_str: target_spec_from_str<SplitDebuginfo>("SplitDebuginfo"),
} as const;

/** rustc_target/src/spec/mod.rs:1203 */
export type StackProtector = "None" | "Basic" | "Strong" | "All";
export const StackProtector = {
  None: "None",
  Basic: "Basic",
  Strong: "Strong",
  All: "All",
  from_str: target_spec_from_str<StackProtector>("StackProtector"),
} as const;
export const debug_StackProtector: Debug<StackProtector> = target_spec_debug();

/** rustc_target/src/spec/mod.rs:869 */
export type SymbolVisibility = "Hidden" | "Protected" | "Interposable";
export const SymbolVisibility = {
  Hidden: "Hidden",
  Protected: "Protected",
  Interposable: "Interposable",
  from_str: target_spec_from_str<SymbolVisibility>("SymbolVisibility"),
} as const;

/** rustc_target/src/spec/mod.rs:1012 */
export type TlsModel = "GeneralDynamic" | "LocalDynamic" | "InitialExec" | "LocalExec" | "Emulated";
export const TlsModel = {
  GeneralDynamic: "GeneralDynamic",
  LocalDynamic: "LocalDynamic",
  InitialExec: "InitialExec",
  LocalExec: "LocalExec",
  Emulated: "Emulated",
  from_str: target_spec_from_str<TlsModel>("TlsModel"),
} as const;

/** rustc_target/src/spec/mod.rs:642 `bitflags! struct LinkSelfContainedComponents: u8` (values copied). */
export type LinkSelfContainedComponents = number;
export const LinkSelfContainedComponents = {
  CRT_OBJECTS: 1 << 0,
  LIBC: 1 << 1,
  UNWIND: 1 << 2,
  LINKER: 1 << 3,
  SANITIZERS: 1 << 4,
  MINGW: 1 << 5,
  empty: (): LinkSelfContainedComponents => 0,
  all: (): LinkSelfContainedComponents => 0b111111,
  from_str(_s: string): Result<LinkSelfContainedComponents, undefined> {
    unported("rustc_target::spec::LinkSelfContainedComponents::from_str");
  },
} as const;

/** rustc_target/src/spec/mod.rs:777 `bitflags! struct LinkerFeatures: u8` (values copied). */
export type LinkerFeatures = number;
export const LinkerFeatures = {
  CC: 1 << 0,
  LLD: 1 << 1,
  empty: (): LinkerFeatures => 0,
  /** rustc_target/src/spec/mod.rs:799 `as_str` (verbatim) */
  as_str(self: LinkerFeatures): string | undefined {
    switch (self) {
      case 1 << 0:
        return "cc";
      case 1 << 1:
        return "lld";
      default:
        return undefined;
    }
  },
  /** rustc_target/src/spec/mod.rs:808 `is_lld_enabled` (verbatim: `self.contains(LinkerFeatures::LLD)`) */
  is_lld_enabled(self: LinkerFeatures): boolean {
    return (self & (1 << 1)) === 1 << 1;
  },
  /** bitflags `iter()`: each defined flag contained in `self`, in definition order. */
  iter(self: LinkerFeatures): LinkerFeatures[] {
    return [1 << 0, 1 << 1].filter((f) => (self & f) === f);
  },
} as const;

/**
 * rustc_target/src/spec/tuple.rs:11 `TargetTuple` (variants copied).
 * PORT: `TargetJson` (a `--target <path>.json`) is never constructed: `from_path` is unported.
 */
export type TargetTuple =
  | { readonly $: "TargetTuple"; readonly _0: string }
  | { readonly $: "TargetJson"; readonly path_for_rustdoc: PathBuf; readonly tuple: string; readonly contents: string };
export const TargetTuple = {
  /** rustc_target/src/spec/tuple.rs:88 `from_tuple` (verbatim: `TargetTuple::TargetTuple(tuple.into())`) */
  from_tuple(tuple: string): TargetTuple {
    return { $: "TargetTuple", _0: tuple };
  },
  /** rustc_target/src/spec/tuple.rs:93 `from_path` */
  from_path(_path: PathBuf): Result<TargetTuple, unknown> {
    unported("rustc_target::spec::TargetTuple::from_path");
  },
  /** rustc_target/src/spec/tuple.rs:113 `tuple` (verbatim) */
  tuple(self: TargetTuple): string {
    switch (self.$) {
      case "TargetTuple":
        return self._0;
      case "TargetJson":
        return self.tuple;
    }
  },
  /** rustc_target/src/spec/tuple.rs:125 `debug_tuple` (the `TargetJson` arm hashes the contents: unported) */
  debug_tuple(self: TargetTuple): string {
    switch (self.$) {
      case "TargetTuple":
        return self._0;
      case "TargetJson":
        return unported("rustc_target::spec::TargetTuple::debug_tuple (TargetJson)");
    }
  },
  /** rustc_target/src/spec/tuple.rs:140 `impl Display` (`self.debug_tuple()`) */
  display(self: TargetTuple): string {
    return TargetTuple.debug_tuple(self);
  },
} as const;

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

/** rustc_abi/src/lib.rs:1102 `Align { pow2: u8 }` (opaque) */
export type Align = Unported<"rustc_abi::Align">;
export const Align = {
  from_bytes(_align: bigint): Result<Align, unknown> {
    unported("rustc_abi::Align::from_bytes");
  },
} as const;

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

// ---- rustc_target::spec::Target ----

/**
 * rustc_target `Target` stand-in. PORT: `rustc_target` is not ported. A built-in target spec is a fixed
 * table; the stand-in carries only the fields the driver path reads before parsing, with the values of the
 * pinned upstream specs (checked against `rustc --print target-spec-json` in
 * src/rustc_driver_impl/driver.oracle.test.ts). Reading any other field calls `unported`.
 */
export interface Target {
  /** The tuple the spec was loaded for (not an upstream field: identifies the built-in spec). */
  readonly __tuple: string;
  /** `Target::pointer_width` */
  readonly pointer_width: number;
  /** `TargetOptions::is_like_msvc` */
  readonly is_like_msvc: boolean;
  /** `TargetOptions::default_codegen_backend` */
  readonly default_codegen_backend: string | undefined;
}

/** The built-in specs the stand-in knows (hosts rust-ts runs on, plus the wasm proc-macro target). */
export const TARGET_STANDIN_SPECS: ReadonlyMap<string, Omit<Target, "__tuple">> = new Map([
  ["aarch64-apple-darwin", { pointer_width: 64, is_like_msvc: false, default_codegen_backend: undefined }],
  ["x86_64-apple-darwin", { pointer_width: 64, is_like_msvc: false, default_codegen_backend: undefined }],
  ["x86_64-unknown-linux-gnu", { pointer_width: 64, is_like_msvc: false, default_codegen_backend: undefined }],
  ["aarch64-unknown-linux-gnu", { pointer_width: 64, is_like_msvc: false, default_codegen_backend: undefined }],
  ["x86_64-pc-windows-msvc", { pointer_width: 64, is_like_msvc: true, default_codegen_backend: undefined }],
  ["wasm32-wasip2", { pointer_width: 32, is_like_msvc: false, default_codegen_backend: undefined }],
]);

/** rustc_target `TargetWarnings`: built-in specs load with `TargetWarnings::empty()`. */
export interface TargetWarnings {
  warning_messages(): string[];
}

export const Target = {
  /**
   * rustc_target/src/spec/mod.rs `Target::search` (stand-in): a built-in tuple from `TARGET_STANDIN_SPECS`
   * loads with no warnings, like upstream's `load_builtin`. Anything else (other built-ins, JSON specs,
   * `RUST_TARGET_PATH`, errors) is unported.
   */
  search(target_tuple: TargetTuple, _sysroot: PathBuf, _unstable_options: boolean): Result<[Target, TargetWarnings], string> {
    if (target_tuple.$ === "TargetTuple") {
      const spec = TARGET_STANDIN_SPECS.get(target_tuple._0);
      if (spec !== undefined) {
        const target = new Proxy({ __tuple: target_tuple._0, ...spec } as Target, {
          get(t, p, r) {
            if (typeof p !== "string" || p in t) return Reflect.get(t, p, r);
            return unported(`rustc_target::spec::Target::${p} (target stand-in, ${t.__tuple})`);
          },
        });
        return Ok([target, { warning_messages: () => [] }]);
      }
    }
    return unported(`rustc_target::spec::Target::search (${TargetTuple.tuple(target_tuple)})`);
  },
  /** `impl PartialEq for Target`: two stand-ins are equal when they are the same built-in spec. */
  eq(a: Target, b: Target): boolean {
    return a.__tuple === b.__tuple;
  },
} as const;

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
