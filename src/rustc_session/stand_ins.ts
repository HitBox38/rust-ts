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
//   rustc_data_structures     TimePassesFormat (profiling.rs)
//   rustc_session::session    EarlyDiagCtxt (session.rs)
//   getopts                   Matches
import type { Diag } from "../rustc_errors/diagnostic.ts";
import { type Debug } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";

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
} as const;

/** rustc_target `TargetTuple` (opaque). */
export type TargetTuple = Unported<"rustc_target::spec::TargetTuple">;

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

/** rustc_structures/src/crate_type.rs:10 (opaque until rustc_structures is ported) */
export type CrateType = Unported<"rustc_structures::CrateType">;

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

// ---- rustc_session::session (session.rs, not ported yet) ----

/** The parts of `EarlyDiagCtxt` (session.rs) that `build_options` uses. */
export interface EarlyDiagCtxt {
  early_warn(msg: string): void;
  early_fatal(msg: string): never;
  early_struct_fatal(msg: string): Diag;
}

// ---- getopts ----

/** The part of `getopts::Matches` that `build_options` uses. */
export interface Matches {
  /// Returns a vector of all values of `nm` and their positions on the command line.
  opt_strs_pos(nm: string): [number, string][];
}

// ---- rustc_session types named by `Options` that are not ported yet ----
// PORT: opaque until the driver lane ports them (config.rs, search_paths.rs, config/print_request.rs).

/** config.rs `OutputTypes(BTreeMap<OutputType, Option<OutFileName>>)` */
export type OutputTypes = Unported<"rustc_session::config::OutputTypes">;
/** search_paths.rs `SearchPath` */
export type SearchPath = Unported<"rustc_session::search_paths::SearchPath">;
/** config.rs `Sysroot` */
export type Sysroot = Unported<"rustc_session::config::Sysroot">;
/** config/print_request.rs `PrintRequest` */
export type PrintRequest = Unported<"rustc_session::config::PrintRequest">;
/** config.rs `Externs(BTreeMap<String, ExternEntry>)` */
export type Externs = Unported<"rustc_session::config::Externs">;
/** config.rs `PpMode` */
export type PpMode = Unported<"rustc_session::config::PpMode">;
/** config.rs `Jobs` */
export type Jobs = Unported<"rustc_session::config::Jobs">;
