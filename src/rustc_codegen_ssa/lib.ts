// Port of compiler/rustc_codegen_ssa/src/lib.rs (the data the driver carries from `start_codegen` to `link_binary`; lane
// ssa-base, plan-m7 wave 41, ports the rest: `ModuleCodegen`'s methods, `CompiledModule::for_each_output`,
// `CachedModuleCodegen`, `CodegenError`, rlink (de)serialization).
// PORT (ssa-contract): `ModuleCodegen`'s fields, `MemFlags`, `RetagInfo` and `RetagFlags` are the type surface the
// traits (traits/*.ts) need.
// PORT (ssa-base):
// - `CompiledModule` stays a data interface (the generated `Decodable` builds it as an object literal); its one method,
//   `for_each_output`, is on the companion const `CompiledModule`.
// - `OutputFilenames::{temp_path_for_cgu, temp_path_dwo_for_cgu}` (rustc_session config.rs) are not on the TS
//   `OutputFilenames` (its header: "codegen ... not ported"); `into_compiled_module` reaches them only for an output it
//   emits, through the typed stubs at the end of this file.
// - `TargetConfig` (lib.rs:272) stays in rustc_interface/stand_ins.ts, where its users import it from.
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
import type { EncodedMetadata } from "../rustc_metadata/rmeta/encoder.ts";
import { decode_EncodedMetadata, encode_EncodedMetadata } from "../rustc_metadata/rmeta/encoder.ts";
import type { WorkProduct } from "./traits/write.ts";
import type { Session } from "../rustc_session/session.ts";
import type { OutputFilenames, OutputType } from "../rustc_session/config.ts";
import { FileEncoder, MemDecoder } from "../rustc_serialize/opaque.ts";
import "../rustc_span/lib.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import type { IoError } from "../std/io.ts";
import { unported } from "../std/panic.ts";
import { decode_CompiledModules, decode_CrateInfo, encode_CompiledModules, encode_CrateInfo } from "./decodable.gen.ts";
import * as symbol_export from "./back/symbol_export.ts";
import * as base from "./base.ts";
import * as codegen_attrs from "./codegen_attrs.ts";
import * as target_features from "./target_features.ts";

export * as codegen_attrs from "./codegen_attrs.ts";
export * as target_features from "./target_features.ts";

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

  // impl<M> ModuleCodegen<M>
  // rustc: compiler/rustc_codegen_ssa/src/lib.rs:73 new_regular
  static new_regular<M>(name: string, module: M): ModuleCodegen<M> {
    return new ModuleCodegen(
      /* name */ name,
      /* module_llvm */ module,
      /* kind */ ModuleKind.Regular,
      /* thin_lto_buffer */ undefined,
    );
  }

  // rustc: compiler/rustc_codegen_ssa/src/lib.rs:82 new_allocator
  static new_allocator<M>(name: string, module: M): ModuleCodegen<M> {
    return new ModuleCodegen(
      /* name */ name,
      /* module_llvm */ module,
      /* kind */ ModuleKind.Allocator,
      /* thin_lto_buffer */ undefined,
    );
  }

  // rustc: compiler/rustc_codegen_ssa/src/lib.rs:91 into_compiled_module
  into_compiled_module(
    emit_obj: boolean,
    emit_dwarf_obj: boolean,
    emit_bc: boolean,
    emit_asm: boolean,
    emit_ir: boolean,
    outputs: OutputFilenames,
  ): CompiledModule {
    const object = emit_obj ? OutputFilenames_temp_path_for_cgu(outputs, "Object", this.name) : undefined;
    const dwarf_object = emit_dwarf_obj ? OutputFilenames_temp_path_dwo_for_cgu(outputs, this.name) : undefined;
    const bytecode = emit_bc ? OutputFilenames_temp_path_for_cgu(outputs, "Bitcode", this.name) : undefined;
    const assembly = emit_asm ? OutputFilenames_temp_path_for_cgu(outputs, "Assembly", this.name) : undefined;
    const llvm_ir = emit_ir ? OutputFilenames_temp_path_for_cgu(outputs, "LlvmAssembly", this.name) : undefined;

    return {
      name: this.name,
      kind: this.kind,
      object,
      global_asm_object: undefined,
      dwarf_object,
      bytecode,
      assembly,
      llvm_ir,
    };
  }
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

// impl CompiledModule (header: the methods of the data interface live on its companion)
export const CompiledModule = {
  /// Call `emit` function with every artifact type currently compiled
  // rustc: compiler/rustc_codegen_ssa/src/lib.rs:135 for_each_output
  for_each_output(self: CompiledModule, emit: (path: PathBuf, output_type: OutputType) => void): void {
    let path: PathBuf | undefined;
    if ((path = self.object) !== undefined) {
      emit(path, "Object");
    }
    if ((path = self.bytecode) !== undefined) {
      emit(path, "Bitcode");
    }
    if ((path = self.llvm_ir) !== undefined) {
      emit(path, "LlvmAssembly");
    }
    if ((path = self.assembly) !== undefined) {
      emit(path, "Assembly");
    }
  },
};

export interface CachedModuleCodegen {
  name: string;
  source: WorkProduct;
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
// backend's `join_codegen`) is an `instanceof` check. Its `impl` (`serialize_rlink`, `deserialize_rlink`) follows
// `provide`, as upstream.
export class CompiledModules {
  constructor(
    public modules: CompiledModule[],
    public allocator_module: CompiledModule | undefined,
  ) {}

  // rustc: compiler/rustc_codegen_ssa/src/lib.rs:350 serialize_rlink
  static serialize_rlink(
    sess: Session,
    rlink_file: PathBuf,
    compiled_modules: CompiledModules,
    crate_info: CrateInfo,
    metadata: EncodedMetadata,
    outputs: OutputFilenames,
  ): Result<number, IoError> {
    const r = FileEncoder.new(rlink_file);
    if (r.$ === "Err") return r;
    const encoder = r._0;
    encoder.emit_raw_bytes(RLINK_MAGIC);
    // `emit_raw_bytes` is used to make sure that the version representation does not depend on
    // Encoder's inner representation of `u32`.
    encoder.emit_raw_bytes(u32_to_be_bytes(RLINK_VERSION));
    encoder.emit_str(sess.cfg_version);
    encode_CompiledModules(compiled_modules, encoder);
    encode_CrateInfo(crate_info, encoder);
    encode_EncodedMetadata(metadata, encoder);
    encode_OutputFilenames(outputs, encoder);
    const res = encoder.finish();
    return res.$ === "Ok" ? res : Err(res._0[1]);
  }

  // rustc: compiler/rustc_codegen_ssa/src/lib.rs:371 deserialize_rlink
  static deserialize_rlink(
    sess: Session,
    data_: Uint8Array,
  ): Result<[CompiledModules, CrateInfo, EncodedMetadata, OutputFilenames], CodegenError> {
    // The Decodable machinery is not used here because it panics if the input data is invalid
    // and because its internal representation may change.
    if (!starts_with(data_, RLINK_MAGIC)) {
      return Err(CodegenError.WrongFileType);
    }
    const data = data_.subarray(RLINK_MAGIC.length);
    if (data.length < 4) {
      return Err(CodegenError.EmptyVersionNumber);
    }

    const version_array = new Uint8Array(4);
    version_array.set(data.subarray(0, 4));
    if (u32_from_be_bytes(version_array) !== RLINK_VERSION) {
      return Err({
        $: "EncodingVersionMismatch",
        version_array: new TextDecoder("utf-8", { fatal: false }).decode(version_array),
        rlink_version: RLINK_VERSION,
      });
    }

    const md = MemDecoder.new(data.subarray(4), 0);
    if (md.$ === "Err") {
      return Err(CodegenError.CorruptFile);
    }
    const decoder = md._0;
    const rustc_version = decoder.read_str();
    if (rustc_version !== sess.cfg_version) {
      return Err({
        $: "RustcVersionMismatch",
        rustc_version: rustc_version,
      });
    }

    const compiled_modules = decode_CompiledModules(decoder);
    const crate_info = decode_CrateInfo(decoder);
    const metadata = decode_EncodedMetadata(decoder);
    const outputs = decode_OutputFilenames(decoder);
    return Ok([compiled_modules, crate_info, metadata, outputs]);
  }
}

export type CodegenError =
  | { readonly $: "WrongFileType" }
  | { readonly $: "EmptyVersionNumber" }
  | { readonly $: "EncodingVersionMismatch"; version_array: string; rlink_version: number }
  | { readonly $: "RustcVersionMismatch"; rustc_version: string }
  | { readonly $: "CorruptFile" };
export const CodegenError = {
  WrongFileType: Object.freeze({ $: "WrongFileType" as const }),
  EmptyVersionNumber: Object.freeze({ $: "EmptyVersionNumber" as const }),
  CorruptFile: Object.freeze({ $: "CorruptFile" as const }),
} as const;

// rustc: compiler/rustc_codegen_ssa/src/lib.rs:339 provide
export function provide(providers: Providers): void {
  symbol_export.provide(providers);
  base.provide(providers.queries);
  target_features.provide(providers.queries);
  codegen_attrs.provide(providers.queries);
}

const RLINK_VERSION = 1;
const RLINK_MAGIC: Uint8Array = new TextEncoder().encode("rustlink");

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

// ---- Helpers (not upstream) ------------------------------------------------------------------------------------------

/** `u32::to_be_bytes`. */
function u32_to_be_bytes(v: number): Uint8Array {
  return new Uint8Array([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
}

/** `u32::from_be_bytes`. */
function u32_from_be_bytes(b: Uint8Array): number {
  return ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
}

/** `<[u8]>::starts_with`. */
function starts_with(data: Uint8Array, prefix: Uint8Array): boolean {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (data[i] !== prefix[i]) return false;
  return true;
}

// ---- Foreign stubs (header) ------------------------------------------------------------------------------------------

/** `OutputFilenames::temp_path_for_cgu` (rustc_session config.rs), not on the TS `OutputFilenames` (header). */
function OutputFilenames_temp_path_for_cgu(_outputs: OutputFilenames, _flavor: OutputType, _codegen_unit_name: string): PathBuf {
  return unported("rustc_session::config::OutputFilenames::temp_path_for_cgu (rustc_session, no M7 lane yet)");
}

/** `OutputFilenames::temp_path_dwo_for_cgu` (rustc_session config.rs), not on the TS `OutputFilenames` (header). */
function OutputFilenames_temp_path_dwo_for_cgu(_outputs: OutputFilenames, _codegen_unit_name: string): PathBuf {
  return unported("rustc_session::config::OutputFilenames::temp_path_dwo_for_cgu (rustc_session, no M7 lane yet)");
}

/** `impl Encodable for OutputFilenames` (derived, rustc_session config.rs): not generated (rlink only). */
function encode_OutputFilenames(_outputs: OutputFilenames, _e: FileEncoder): void {
  return unported("rustc_session::config::OutputFilenames: Encodable (-Z no-link rlink)");
}

/** `impl Decodable for OutputFilenames` (derived, rustc_session config.rs): not generated (rlink only). */
function decode_OutputFilenames(_d: MemDecoder): OutputFilenames {
  return unported("rustc_session::config::OutputFilenames: Decodable (-Z link-only rlink)");
}
