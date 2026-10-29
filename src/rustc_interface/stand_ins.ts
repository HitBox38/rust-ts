// Not an upstream mirror. PORT: stand-ins for crates the driver path reaches but that are not ported:
//   rustc_codegen_ssa::traits::CodegenBackend (the trait and its provided methods; the LLVM backend stand-in is
//   src/rust_ts/codegen_backend.ts), rustc_metadata::EncodedMetadata, rustc_data_structures::jobserver::initialize
// Each keeps only what can be copied verbatim or is observable-free on the paths the port runs; everything
// else calls `unported(...)`. Replace by the real modules when those crates are ported.
import type { CodegenBackendInit, EarlySession, Session } from "../rustc_session/session.ts";
import type { OutputFilenames } from "../rustc_session/config.ts";
import type { CrateType } from "../rustc_structures/crate_type.ts";
import { unported } from "../std/panic.ts";
import type { MetadataLoaderDyn } from "../rustc_metadata/creader.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import { DefaultMetadataLoader } from "../rustc_codegen_ssa/back/metadata.ts";
import { type ArchiveBuilderBuilder, link_binary } from "../rustc_codegen_ssa/back/link.ts";
import type { CompiledModules, CrateInfo } from "../rustc_codegen_ssa/lib.ts";


/// `rustc_codegen_ssa::TargetConfig` (rustc_codegen_ssa/src/lib.rs:309)
export interface TargetConfig {
  /// Options to be set in `sess.internal_target_features`.
  internal_target_features: Set<Symbol>;
  /// Option for `cfg(target_has_reliable_f16)`, true if `f16` basic arithmetic works.
  has_reliable_f16: boolean;
  /// Option for `cfg(target_has_reliable_f16_math)`, true if `f16` math calls work.
  has_reliable_f16_math: boolean;
  /// Option for `cfg(target_has_reliable_f16b)`, presently true if both the ABI
  /// and LLVM version supports `f16b`.
  has_reliable_f16b: boolean;
  /// Option for `cfg(target_has_reliable_f128)`, true if `f128` basic arithmetic works.
  has_reliable_f128: boolean;
  /// Option for `cfg(target_has_reliable_f128_math)`, true if `f128` math calls work.
  has_reliable_f128_math: boolean;
}

/** `rustc_codegen_ssa::traits::CodegenBackend` (traits/backend.rs:37). Provided methods: `CodegenBackend_provided`. */
export interface CodegenBackend {
  name(): string;
  init(sess: EarlySession): CodegenBackendInit;
  // print(req, out, sess) (provided): `--print` of backend-specific requests (rustc_driver_impl calls `unported`)
  target_config(sess: EarlySession): TargetConfig;
  supported_crate_types(sess: Session): CrateType[];
  print_passes(): void;
  print_version(): void;
  // has_zstd() / has_mnemonic(sess, mnemonic) (provided): `--print backend-has-*` (rustc_driver_impl calls `unported`)
  metadata_loader(): MetadataLoaderDyn;
  // provide(providers) (provided, empty for every in-tree backend)
  target_cpu(sess: Session): string;
  /** `-> Box<dyn Any>` */
  codegen_crate(tcx: TyCtxt): unknown;
  join_codegen(
    ongoing_codegen: unknown,
    sess: Session,
    incr_comp_session: IncrCompSession | undefined,
    outputs: OutputFilenames,
    crate_info: CrateInfo,
  ): [CompiledModules, WorkProductMap];
  print_pass_timings(): void;
  print_statistics(): void;
  print_statistics_json(): string;
  link(sess: Session, compiled_modules: CompiledModules, crate_info: CrateInfo, metadata: EncodedMetadata, outputs: OutputFilenames): void;
}

/** The provided methods of `CodegenBackend` (traits/backend.rs), for the backends that do not override them. */
export const CodegenBackend_provided = {
  // rustc: compiler/rustc_codegen_ssa/src/traits/backend.rs:40 init
  init(_self: CodegenBackend, _sess: EarlySession): CodegenBackendInit {
    // Default::default()
    return { global_backend_features: [], replaced_intrinsics: [], fallback_intrinsics: [], thin_lto_supported: false };
  },

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

  /// The metadata loader used to load rlib and dylib metadata.
  ///
  /// Alternative codegen backends may want to use different rlib or dylib formats than the
  /// default native static archives and dynamic libraries.
  // rustc: compiler/rustc_codegen_ssa/src/traits/backend.rs:97 metadata_loader
  metadata_loader(_self: CodegenBackend): MetadataLoaderDyn {
    return DefaultMetadataLoader;
  },

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

/** PORT: `rustc_codegen_ssa::back::archive::ArArchiveBuilderBuilder` (back/archive.rs, M7): opaque, see `ArchiveBuilderBuilder`. */
export const ArArchiveBuilderBuilder: ArchiveBuilderBuilder = { __archive_builder_builder: "ArArchiveBuilderBuilder" };

/**
 * PORT: `rustc_metadata::EncodedMetadata` (rmeta/encoder.rs), made by `encode_and_write_metadata` (rustc_metadata
 * fs.rs, not ported yet); only what the driver path reads of it.
 */
export interface EncodedMetadata {
  path(): string | undefined;
}

/** PORT: `rustc_session::IncrCompSession` (session.rs): no incremental compilation (D3), so never constructed. */
export type IncrCompSession = never;

/** PORT: `rustc_middle::dep_graph::WorkProductMap` (`UnordMap<WorkProductId, WorkProduct>`): no incremental (D3). */
export type WorkProductMap = Map<unknown, unknown>;

/**
 * `rustc_data_structures::jobserver::initialize` (stand-in). Upstream inherits a jobserver from
 * `CARGO_MAKEFLAGS`/`MAKEFLAGS`/`MFLAGS` (`Client::from_env_ext`) and reports a malformed one; with none
 * of them set (`FromEnvErrorKind::NoEnvVar`) it silently creates its own client. Only that case is kept.
 */
export function jobserver_initialize(_limit: number, _report: (err: string) => void): void {
  for (const v of ["CARGO_MAKEFLAGS", "MAKEFLAGS", "MFLAGS"]) {
    if (process.env[v] !== undefined) {
      unported(`rustc_data_structures::jobserver::initialize (inherited jobserver: ${v} is set)`);
    }
  }
}

/** `rustc_middle::ty::CurrentGcx`: the real type (re-exported for the existing imports). */
export { CurrentGcx } from "../rustc_middle/ty/context.ts";
