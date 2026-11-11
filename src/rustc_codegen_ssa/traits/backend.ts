// Port of compiler/rustc_codegen_ssa/src/traits/backend.rs (lane ssa-contract).
//
// PORT (ssa-contract, plan-m6 D3 pattern):
// - `BackendTypes` holds only associated types, so its TS form is the record of those types: a trait
//   `Trait: BackendTypes` is `Trait<B extends BackendTypes>` and `Self::Value` is `B["Value"]`. A backend declares its
//   record (`interface LlvmTypes extends BackendTypes { Value: llvm.Value; ... }`) and `implements Trait<LlvmTypes>`.
// - `CodegenObject` (`Copy + fmt::Debug`, traits/mod.rs) and `PartialEq` bounds: equality of backend objects is `===`
//   (the IR model uniques them; `DIScope: Hash + Eq` keys maps directly). The `Debug` impls are run-time members of
//   `BackendTypesOf<B>` (`debug_Value`, ...), which every trait over `B` extends.
// - `CodegenBackend` and its provided methods moved here from rustc_interface/stand_ins.ts, which re-exports them.
//   Its `print`, `has_zstd`, `has_mnemonic` and `provide` stay `(provided)` placeholders only (no interface member), as
//   in the stand-in: rustc_driver_impl calls `unported` for those requests, and the implementors need no change.
// - `ExtraBackendMethods::Module` is the type parameter `M`. `Send + Sync + DynSend + DynSync` are erased.
import type { AllocatorMethod } from "../../rustc_ast/expand/allocator.gen.ts";
import type { MetadataLoaderDyn } from "../../rustc_metadata/creader.ts";
import type { EncodedMetadata } from "../../rustc_metadata/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Providers } from "../../rustc_middle/util/mod.ts";
import type { OutputFilenames } from "../../rustc_session/config.ts";
import type { PrintRequest } from "../../rustc_session/config/print_request.ts";
import type { CodegenBackendInit, EarlySession, Session } from "../../rustc_session/session.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import type { CrateType } from "../../rustc_structures/crate_type.ts";
import type { Debug } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import type { IncrCompSession, TargetConfig, WorkProductMap } from "../../rustc_interface/stand_ins.ts";
import { ArArchiveBuilderBuilder } from "../back/archive.ts";
import { link_binary } from "../back/link.ts";
import { DefaultMetadataLoader } from "../back/metadata.ts";
import type { CompiledModules, CrateInfo, ModuleCodegen } from "../lib.ts";

// rustc-trait: compiler/rustc_codegen_ssa/src/traits/backend.rs:21 BackendTypes
export interface BackendTypes {
  /** `type Function: CodegenObject;` */
  Function: unknown;
  /** `type BasicBlock: Copy;` */
  BasicBlock: unknown;
  /** `type Funclet;` */
  Funclet: unknown;

  /** `type Value: CodegenObject + PartialEq;` */
  Value: unknown;
  /** `type Type: CodegenObject + PartialEq;` */
  Type: unknown;
  /** `type FunctionSignature: CodegenObject + PartialEq;` */
  FunctionSignature: unknown;

  // FIXME(eddyb) find a common convention for all of the debuginfo-related
  // names (choose between `Dbg`, `Debug`, `DebugInfo`, `DI` etc.).
  /** `type DIScope: Copy + Hash + PartialEq + Eq;` */
  DIScope: unknown;
  /** `type DILocation: Copy;` */
  DILocation: unknown;
  /** `type DIVariable: Copy;` */
  DIVariable: unknown;
}

/** PORT (ssa-contract, plan-m6 D3): what a `Self: BackendTypes` carries at run time: the `fmt::Debug` impls that
 *  `CodegenObject` requires of `Function`, `Value`, `Type` and `FunctionSignature` (for `{:?}` in assertion and bug
 *  messages). Every codegen trait interface over `B` extends it. */
export interface BackendTypesOf<B extends BackendTypes> {
  /** PORT (plan-m6 D3): type-level only (never set): the backend's associated types. */
  readonly __backend_types?: B;
  readonly debug_Function: Debug<B["Function"]>;
  readonly debug_Value: Debug<B["Value"]>;
  readonly debug_Type: Debug<B["Type"]>;
  readonly debug_FunctionSignature: Debug<B["FunctionSignature"]>;
}

/** `rustc_codegen_ssa::traits::CodegenBackend` (traits/backend.rs:37). Provided methods: `CodegenBackend_provided`. */
// rustc-trait: compiler/rustc_codegen_ssa/src/traits/backend.rs:37 CodegenBackend
export interface CodegenBackend {
  // rustc: compiler/rustc_codegen_ssa/src/traits/backend.rs:38 name
  name(): string;

  // (provided) traits/backend.rs:40 init -> CodegenBackend_provided.init
  init(sess: EarlySession): CodegenBackendInit;

  // (provided) traits/backend.rs:44 print -> CodegenBackend_provided.print
  //   (no member: `--print` of backend-specific requests; rustc_driver_impl calls `unported`)

  /// Collect target-specific options that should be set in `cfg(...)`, including
  /// `target_feature` and support for unstable float types.
  // (provided) traits/backend.rs:48 target_config -> CodegenBackend_provided.target_config
  target_config(sess: EarlySession): TargetConfig;

  // (provided) traits/backend.rs:61 supported_crate_types -> CodegenBackend_provided.supported_crate_types
  supported_crate_types(sess: Session): CrateType[];

  // (provided) traits/backend.rs:73 print_passes -> CodegenBackend_provided.print_passes
  print_passes(): void;

  // (provided) traits/backend.rs:75 print_version -> CodegenBackend_provided.print_version
  print_version(): void;

  /// Value printed by `--print=backend-has-zstd`.
  ///
  /// Used by compiletest to determine whether tests involving zstd compression
  /// (e.g. `-Zdebuginfo-compression=zstd`) should be executed or skipped.
  // (provided) traits/backend.rs:81 has_zstd -> CodegenBackend_provided.has_zstd
  //   (no member: rustc_driver_impl calls `unported` for `--print backend-has-zstd`)

  /// Value printed by `--print=backend-has-mnemonic:...`.
  ///
  /// Used by compiletest to determine whether tests involving `asm!()` should
  /// be executed or skipped.
  // (provided) traits/backend.rs:89 has_mnemonic -> CodegenBackend_provided.has_mnemonic
  //   (no member: rustc_driver_impl calls `unported` for `--print backend-has-mnemonic`)

  /// The metadata loader used to load rlib and dylib metadata.
  ///
  /// Alternative codegen backends may want to use different rlib or dylib formats than the
  /// default native static archives and dynamic libraries.
  // (provided) traits/backend.rs:97 metadata_loader -> CodegenBackend_provided.metadata_loader
  metadata_loader(): MetadataLoaderDyn;

  /// Allows queries to be overridden. Not used by any in-tree backends, but rustc_codegen_spirv
  /// and rustc_codegen_nvvm use it.
  // (provided) traits/backend.rs:103 provide -> CodegenBackend_provided.provide
  //   (no member: empty for every in-tree backend)

  // rustc: compiler/rustc_codegen_ssa/src/traits/backend.rs:105 target_cpu
  target_cpu(sess: Session): string;

  /** `-> Box<dyn Any>` */
  // rustc: compiler/rustc_codegen_ssa/src/traits/backend.rs:107 codegen_crate
  codegen_crate(tcx: TyCtxt): unknown;

  /// This is called on the returned `Box<dyn Any>` from [`codegen_crate`](Self::codegen_crate)
  ///
  /// # Panics
  ///
  /// Panics when the passed `Box<dyn Any>` was not returned by [`codegen_crate`](Self::codegen_crate).
  // rustc: compiler/rustc_codegen_ssa/src/traits/backend.rs:114 join_codegen
  join_codegen(
    ongoing_codegen: unknown,
    sess: Session,
    incr_comp_session: IncrCompSession | undefined,
    outputs: OutputFilenames,
    crate_info: CrateInfo,
  ): [CompiledModules, WorkProductMap];

  // (provided) traits/backend.rs:123 print_pass_timings -> CodegenBackend_provided.print_pass_timings
  print_pass_timings(): void;

  // (provided) traits/backend.rs:125 print_statistics -> CodegenBackend_provided.print_statistics
  print_statistics(): void;

  // (provided) traits/backend.rs:127 print_statistics_json -> CodegenBackend_provided.print_statistics_json
  print_statistics_json(): string;

  /// This is called on the returned [`CompiledModules`] from [`join_codegen`](Self::join_codegen).
  // (provided) traits/backend.rs:132 link -> CodegenBackend_provided.link
  link(sess: Session, compiled_modules: CompiledModules, crate_info: CrateInfo, metadata: EncodedMetadata, outputs: OutputFilenames): void;
}

/** The provided methods of `CodegenBackend` (PORTING §8; `self` first). */
export const CodegenBackend_provided = {
  // rustc: compiler/rustc_codegen_ssa/src/traits/backend.rs:40 init
  init(_self: CodegenBackend, _sess: EarlySession): CodegenBackendInit {
    // Default::default()
    return { global_backend_features: [], replaced_intrinsics: [], fallback_intrinsics: [], thin_lto_supported: true };
  },

  // rustc: compiler/rustc_codegen_ssa/src/traits/backend.rs:44 print
  print(_self: CodegenBackend, _req: PrintRequest, _out: MutRef<string>, _sess: Session): void {},

  /// Collect target-specific options that should be set in `cfg(...)`, including
  /// `target_feature` and support for unstable float types.
  // rustc: compiler/rustc_codegen_ssa/src/traits/backend.rs:48 target_config
  target_config(_self: CodegenBackend, _sess: EarlySession): TargetConfig {
    return {
      internal_target_features: new Set(),
      // `true` is used as a default so backends need to acknowledge when they do not
      // support the float types, rather than accidentally quietly skipping all tests.
      has_reliable_f16: true,
      has_reliable_f16_math: true,
      has_reliable_f16b: true,
      has_reliable_f128: true,
      has_reliable_f128_math: true,
    };
  },

  // rustc: compiler/rustc_codegen_ssa/src/traits/backend.rs:61 supported_crate_types
  supported_crate_types(_self: CodegenBackend, _sess: Session): CrateType[] {
    return ["Executable", "Dylib", "Rlib", "StaticLib", "Cdylib", "ProcMacro", "Sdylib"];
  },

  // rustc: compiler/rustc_codegen_ssa/src/traits/backend.rs:73 print_passes
  print_passes(_self: CodegenBackend): void {},

  // rustc: compiler/rustc_codegen_ssa/src/traits/backend.rs:75 print_version
  print_version(_self: CodegenBackend): void {},

  /// Value printed by `--print=backend-has-zstd`.
  ///
  /// Used by compiletest to determine whether tests involving zstd compression
  /// (e.g. `-Zdebuginfo-compression=zstd`) should be executed or skipped.
  // rustc: compiler/rustc_codegen_ssa/src/traits/backend.rs:81 has_zstd
  has_zstd(_self: CodegenBackend): boolean {
    return false;
  },

  /// Value printed by `--print=backend-has-mnemonic:...`.
  ///
  /// Used by compiletest to determine whether tests involving `asm!()` should
  /// be executed or skipped.
  // rustc: compiler/rustc_codegen_ssa/src/traits/backend.rs:89 has_mnemonic
  has_mnemonic(_self: CodegenBackend, _sess: Session, _mnemonic: string): boolean {
    return false;
  },

  /// The metadata loader used to load rlib and dylib metadata.
  ///
  /// Alternative codegen backends may want to use different rlib or dylib formats than the
  /// default native static archives and dynamic libraries.
  // rustc: compiler/rustc_codegen_ssa/src/traits/backend.rs:97 metadata_loader
  metadata_loader(_self: CodegenBackend): MetadataLoaderDyn {
    return DefaultMetadataLoader;
  },

  /// Allows queries to be overridden. Not used by any in-tree backends, but rustc_codegen_spirv
  /// and rustc_codegen_nvvm use it.
  // rustc: compiler/rustc_codegen_ssa/src/traits/backend.rs:103 provide
  provide(_self: CodegenBackend, _providers: Providers): void {},

  // rustc: compiler/rustc_codegen_ssa/src/traits/backend.rs:123 print_pass_timings
  print_pass_timings(_self: CodegenBackend): void {},

  // rustc: compiler/rustc_codegen_ssa/src/traits/backend.rs:125 print_statistics
  print_statistics(_self: CodegenBackend): void {},

  // rustc: compiler/rustc_codegen_ssa/src/traits/backend.rs:127 print_statistics_json
  print_statistics_json(_self: CodegenBackend): string {
    return "";
  },

  /// This is called on the returned [`CompiledModules`] from [`join_codegen`](Self::join_codegen).
  // rustc: compiler/rustc_codegen_ssa/src/traits/backend.rs:132 link
  link(self: CodegenBackend, sess: Session, compiled_modules: CompiledModules, crate_info: CrateInfo, metadata: EncodedMetadata, outputs: OutputFilenames): void {
    link_binary(sess, ArArchiveBuilderBuilder, compiled_modules, crate_info, metadata, outputs, self.name());
  },
};

// rustc-trait: compiler/rustc_codegen_ssa/src/traits/backend.rs:152 ExtraBackendMethods
export interface ExtraBackendMethods<M> {
  // type Module; (the type parameter `M`)

  // rustc: compiler/rustc_codegen_ssa/src/traits/backend.rs:155 codegen_allocator
  codegen_allocator(tcx: TyCtxt, module_name: string, methods: readonly AllocatorMethod[]): M;

  /// This generates the codegen unit and returns it along with
  /// a `u64` giving an estimate of the unit's processing cost.
  // rustc: compiler/rustc_codegen_ssa/src/traits/backend.rs:164 compile_codegen_unit
  compile_codegen_unit(tcx: TyCtxt, cgu_name: Symbol, bitcode_needed: boolean): [ModuleCodegen<M>, number];
}
