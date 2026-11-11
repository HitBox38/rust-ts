// Partial port of compiler/rustc_codegen_ssa/src/lib.rs: the data the metadata-only driver path carries from
// `start_codegen` to `link_binary` (`CompiledModule(s)`, `NativeLib`, `SymbolExport`, the EII linkage info,
// `CrateInfo`, `CodegenLintLevelSpecs`) and `provide`. Not ported (backend, M7): `ModuleCodegen`'s methods
// (`new_regular`, `new_allocator`, `into_compiled_module`), `CompiledModule::for_each_output`, rlink
// (de)serialization (`serialize_rlink`, `deserialize_rlink`).
// PORT (ssa-contract): `ModuleCodegen`'s fields, `MemFlags`, `RetagInfo` and `RetagFlags` are the type surface the
// traits (traits/*.ts) need, placed here for lane ssa-base, which ports the rest of this file.
import type { CfgEntry } from "../rustc_ast/attr/data_structures.ts";
import type { WindowsSubsystemKind } from "../rustc_attr_ir/data_structures.gen.ts";
import type { CrateSource, DllImport, NativeLib as cstore_NativeLib } from "../rustc_crate_store/cstore.gen.ts";
import type { PathBuf } from "../rustc_error_messages/lib.ts";
import { CRATE_HIR_ID } from "../rustc_hir_id/lib.ts";
import { LINKER_INFO, LINKER_MESSAGES } from "../rustc_lint_defs/builtin.gen.ts";
import type { StableLevelSpec } from "../rustc_middle/lint.ts";
import type { DebuggerVisualizerFile } from "../rustc_middle/middle/debugger_visualizer.ts";
import type { Dependencies } from "../rustc_middle/middle/dependency_format.ts";
import type { SymbolExportKind } from "../rustc_middle/middle/exported_symbols.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Providers } from "../rustc_middle/util/mod.ts";
import type { CrateNum } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import type { CrateType } from "../rustc_structures/crate_type.ts";
import type { NativeLibKind } from "../rustc_structures/native_lib_kind.ts";
import type { Size } from "../rustc_abi/lib.ts";
import * as symbol_export from "./back/symbol_export.ts";
import * as base from "./base.ts";
import * as codegen_attrs from "./codegen_attrs.ts";
import * as target_features from "./target_features.ts";

export * as codegen_attrs from "./codegen_attrs.ts";
export * as target_features from "./target_features.ts";

// PORT (ssa-contract): the struct's fields only; `new_regular` (:73), `new_allocator` (:82) and
// `into_compiled_module` (:91) are lane ssa-base's.
export class ModuleCodegen<M> {
  constructor(
    /// The name of the module. When the crate may be saved between
    /// compilations, incremental compilation requires that name be
    /// unique amongst **all** crates. Therefore, it should contain
    /// something unique to this crate (e.g., a module path) as well
    /// as the crate name and disambiguator.
    /// We currently generate these names via CodegenUnit::build_cgu_name().
    public name: string,
    public module_llvm: M,
    public kind: ModuleKind,
    /// Saving the ThinLTO buffer for embedding in the object file.
    public thin_lto_buffer: Uint8Array | undefined,
  ) {}
}

// #[derive(Debug, Encodable, Decodable)]
export interface CompiledModule {
  name: string;
  kind: ModuleKind;
  object: PathBuf | undefined;
  global_asm_object: PathBuf | undefined;
  dwarf_object: PathBuf | undefined;
  bytecode: PathBuf | undefined;
  assembly: PathBuf | undefined; // --emit=asm
  llvm_ir: PathBuf | undefined; // --emit=llvm-ir, llvm-bc is in bytecode
}

// #[derive(Copy, Clone, Debug, PartialEq, Encodable, Decodable)]
export type ModuleKind = "Regular" | "Allocator";
export const ModuleKind = { Regular: "Regular", Allocator: "Allocator" } as const;

/// This previously had an `UNALIGNED` variant, but that should never be done via flags.
/// If you want something to be unaligned, see [`mir::place::PlaceRef::unaligned`].
// #[derive(Debug, Clone, Copy, PartialEq, Eq)]
// PORT (ssa-contract): `bitflags!` struct over u8 -> number + companion (the rustc_span `RemapPathScopeComponents`
// form). Its `Debug` is not here: lane ssa-base adds it with the first `{:?}` that needs it.
export type MemFlags = number;
export const MemFlags = {
  VOLATILE: 1 << 0,
  NONTEMPORAL: 1 << 1,
  /// Indicates that writing through the stored pointer is undefined behavior.
  /// Only valid on stores of pointers, or pairs where the first element is a pointer.
  /// In the latter case, the flag only applies to the first element of the pair.
  CAPTURES_READ_ONLY: 1 << 3,

  empty: (): MemFlags => 0,
  contains: (self: MemFlags, other: MemFlags): boolean => (self & other) === other,
} as const;

// #[derive(Debug, Copy, Clone)]
export interface RetagInfo<V> {
  /// The size of the initial range within the allocation that is
  /// associated with the permission created by the retag.
  size: Size;
  /// Encoded type information used to determine the kind of permission
  /// created by the retag.
  flags: RetagFlags;
  /// A pointer to a constant array of (offset, size) pairs describing
  /// the ranges covered by `UnsafeCell` within the pointee type.
  im_layout: V;
  /// A pointer to a constant array of (offset, size) pairs describing
  /// the ranges covered by `UnsafePinned` within the pointee type.
  pin_layout: V;
}

// #[repr(C)]
// #[derive(Debug, Copy, Clone, PartialEq, Eq, Hash)]
// PORT (ssa-contract): `bitflags!` struct over u8 -> number + companion, as `MemFlags`.
export type RetagFlags = number;
export const RetagFlags = {
  /// If this is a function-entry retag.
  IS_PROTECTED: 1 << 0,
  /// If this is a mutable reference or a `Box`.
  IS_MUTABLE: 1 << 1,
  /// If this is a `Box`.
  IS_BOX: 1 << 2,
  /// If the pointee type is `Freeze`
  IS_FREEZE: 1 << 3,
} as const;

// This is the same as `rustc_crate_store::NativeLib`, except:
// - (important) the `foreign_module` field is missing, because it contains a `DefId`, which can't
//   be encoded with `FileEncoder`.
// - (less important) the `verbatim` field is a `bool` rather than an `Option<bool>`, because here
//   we can treat `false` and `absent` the same.
// #[derive(Clone, Debug, Encodable, Decodable)]
export interface NativeLib {
  kind: NativeLibKind;
  name: Symbol;
  cfg: CfgEntry | undefined;
  verbatim: boolean;
  dll_imports: DllImport[];
}

/** `impl From<&cstore::NativeLib> for NativeLib` */
// rustc: compiler/rustc_codegen_ssa/src/lib.rs:222 from
export function NativeLib_from(lib: cstore_NativeLib): NativeLib {
  return {
    kind: lib.kind,
    name: lib.name,
    // PORT: `lib.cfg.clone()`: `CfgEntry` is not edited in place after metadata decoding, so it is shared.
    cfg: lib.cfg as CfgEntry | undefined,
    verbatim: lib.verbatim ?? false,
    dll_imports: [...lib.dll_imports],
  };
}

/// A symbol to make visible from a linked artifact.
// #[derive(Clone, Debug, Encodable, Decodable)]
export class SymbolExport {
  constructor(
    /// Name to make visible from the linked artifact.
    public name: string,
    /// Kind of symbol, used for target-specific export directives and name decoration.
    public kind: SymbolExportKind,
    /// Name of the symbol as seen by the linker, when it differs from `name`.
    public link_name: string | undefined,
  ) {}

  // rustc: compiler/rustc_codegen_ssa/src/lib.rs:245 new
  static new(name: string, kind: SymbolExportKind): SymbolExport {
    return new SymbolExport(name, kind, undefined);
  }

  // rustc: compiler/rustc_codegen_ssa/src/lib.rs:249 with_link_name
  static with_link_name(name: string, kind: SymbolExportKind, link_name: string): SymbolExport {
    const link_name_ = link_name === name ? undefined : link_name;
    return new SymbolExport(name, kind, link_name_);
  }
}

// #[derive(Clone, Debug, Encodable, Decodable)]
export interface EiiLinkageImplInfo {
  span: Span;
  impl_crate: CrateNum;
}

// #[derive(Clone, Debug, Encodable, Decodable)]
export interface EiiLinkageInfo {
  name: Symbol;
  impls: EiiLinkageImplInfo[];
  default_impl: EiiLinkageImplInfo | undefined;
}

/// Misc info we load from metadata to persist beyond the tcx.
///
/// Note: though `CrateNum` is only meaningful within the same tcx, information within `CrateInfo`
/// is self-contained. `CrateNum` can be viewed as a unique identifier within a `CrateInfo`, where
/// `used_crate_source` contains all `CrateSource` of the dependents, and maintains a mapping from
/// identifiers (`CrateNum`) to `CrateSource`. The other fields map `CrateNum` to the crate's own
/// additional properties, so that effectively we can retrieve each dependent crate's `CrateSource`
/// and the corresponding properties without referencing information outside of a `CrateInfo`.
// rustc_codegen_cranelift needs a Clone impl for its jit mode, which isn't tested in rust CI
// #[derive(Clone, Debug, Encodable, Decodable)]
// PORT: a data interface; `CrateInfo::new` (base.rs) is `CrateInfo_new` in base.ts, because base.ts is imported by
// this module (for `provide`) and could not attach a static to a class defined here at load time.
export interface CrateInfo {
  target_cpu: string;
  target_features: string[];
  crate_types: CrateType[];
  exported_symbols: Map<CrateType, SymbolExport[]>;
  linked_symbols: Map<CrateType, [string, SymbolExportKind][]>;
  local_crate_name: Symbol;
  compiler_builtins: CrateNum | undefined;
  profiler_runtime: CrateNum | undefined;
  is_no_builtins: Set<CrateNum>;
  native_libraries: Map<CrateNum, NativeLib[]>;
  crate_name: Map<CrateNum, Symbol>;
  used_libraries: NativeLib[];
  used_crate_source: Map<CrateNum, CrateSource>;
  used_crates: CrateNum[];
  dependency_formats: Dependencies;
  /// EII implementations used by the link-time duplicate check, so `-Zno-link` can serialize the data needed by a
  /// later `-Zlink-only` invocation.
  eii_linkage: EiiLinkageInfo[];
  windows_subsystem: WindowsSubsystemKind | undefined;
  // PORT: `BTreeSet<DebuggerVisualizerFile>`: filled only on MSVC targets (`collect_debugger_visualizers_transitive`).
  natvis_debugger_visualizers: DebuggerVisualizerFile[];
  lint_level_specs: CodegenLintLevelSpecs;
  metadata_symbol: string;
  symbol_rename_suffix: string;
  each_linked_rlib_file_for_lto: PathBuf[];
  exported_symbols_for_lto: string[];
}

// #[derive(Encodable, Decodable)]
// PORT: a class so that `Box<dyn Any>::downcast::<CompiledModules>()` (rustc_interface `Linker::link`, the dummy
// backend's `join_codegen`) is an `instanceof` check. `serialize_rlink` (:350) / `deserialize_rlink` (:371) are
// not ported (`-Zno-link` / `-Zlink-only`).
export class CompiledModules {
  constructor(
    public modules: CompiledModule[],
    public allocator_module: CompiledModule | undefined,
  ) {}
}

// rustc: compiler/rustc_codegen_ssa/src/lib.rs:339 provide
export function provide(providers: Providers): void {
  symbol_export.provide(providers);
  base.provide(providers.queries);
  target_features.provide(providers.queries);
  codegen_attrs.provide(providers.queries);
}

/// A list of lint levels used in codegen.
///
/// When using `-Z link-only`, we don't have access to the tcx and must work
/// solely from the `.rlink` file. `Lint`s are defined too early to be encodeable.
/// Instead, encode exactly the information we need.
// #[derive(Copy, Clone, Debug, Encodable, Decodable)]
export class CodegenLintLevelSpecs {
  constructor(
    public linker_messages: StableLevelSpec,
    public linker_info: StableLevelSpec,
  ) {}

  // rustc: compiler/rustc_codegen_ssa/src/lib.rs:424 from_tcx
  static from_tcx(tcx: TyCtxt): CodegenLintLevelSpecs {
    return new CodegenLintLevelSpecs(
      /* linker_messages */ tcx.lint_level_spec_at_node(LINKER_MESSAGES, CRATE_HIR_ID),
      /* linker_info */ tcx.lint_level_spec_at_node(LINKER_INFO, CRATE_HIR_ID),
    );
  }
}
