// Port of compiler/rustc_metadata/src/rmeta/decoder.rs.
//
// PORT: contract-first stub (lane creader, wave 11). Only the declared shapes creader.rs and
// rmeta/decoder/cstore_impl.rs use are here: `MetadataBlob`, `CrateNumMap`, `TargetModifiers`,
// `DeniedPartialMitigations`, `CrateMetadata` (the fields cstore_impl.rs touches + the methods both files
// call), and the `impl CrateRoot` / `impl MetadataBlob` methods they call. Every body calls `unported`
// (`unported_methods`, no markers); the rmeta-decoder lane fills them in upstream order.
//
// No `CrateMetadata` / `MetadataBlob` value exists before the locator and decoder are ported: `#![no_core]`
// crates without `extern crate` load no metadata (docs/plan-m2.md, finding A).
import type { AmbigModChild } from "../../rustc_middle/middle/resolve.ts";
import type { CrateDepKind, CrateSource, ExternCrate } from "../../rustc_crate_store/lib.ts";
import type { MacroDef } from "../../rustc_ast/lib.ts";
import type { Attribute } from "../../rustc_attr_ir/lib.ts";
import type { SyntaxExtension } from "../../rustc_expand/base.ts";
import type { CtorKind, DefKind } from "../../rustc_hir/def.ts";
import type { DefKey, DefPath, DefPathHash } from "../../rustc_hir_id/definitions.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { TargetModifier } from "../../rustc_session/options.ts";
import type { DeniedPartialMitigation } from "../../rustc_session/options/mitigation_coverage.ts";
import type { CrateNum, DefId, DefIndex, StableCrateId } from "../../rustc_span/def_id.ts";
import type { ExpnHash, ExpnId } from "../../rustc_span/hygiene.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { Ident, Symbol } from "../../rustc_span/symbol.ts";
import type { PanicStrategy } from "../../rustc_target/spec/mod.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { unported } from "../../std/panic.ts";
import { CrateRoot, type CrateDep, type CrateRootUnhashed } from "./mod.ts";

/**
 * PORT: stand-in for `rustc_data_structures::svh::Svh` (svh.rs is not ported): the hash as its `Display`
 * text (`Fingerprint::to_hex`), so it can key a `Map` (`hash_to_cnum`). The decoder lane replaces it.
 */
export type Svh = string & { readonly __brand: "Svh" };

// pub(crate) struct MetadataBlob(OwnedSlice);
export class MetadataBlob {
  constructor(public _0: Uint8Array) {}
}
export interface MetadataBlob {
  get_root(): CrateRoot;
  get_root_unhashed(): CrateRootUnhashed;
  get_dep_extra_filenames(): string[];
  get_crate_hash(): Svh;
}
unported_methods(MetadataBlob.prototype, "rustc_metadata::rmeta::decoder::MetadataBlob (wave 11 rmeta-decoder)", [
  "get_root",
  "get_root_unhashed",
  "get_dep_extra_filenames",
  "get_crate_hash",
]);

/// A map from external crate numbers (as decoded from some crate file) to
/// local crate numbers (as generated during this session). Each external
/// crate may refer to types in other external crates, and each has their
/// own crate numbers.
export type CrateNumMap = CrateNum[];

/// Target modifiers - abi or exploit mitigations options that may cause unsoundness when mixed or
/// partially enabled.
export type TargetModifiers = TargetModifier[];

/// The set of mitigations that cannot be partially enabled (see
/// [RFC 3855](https://github.com/rust-lang/rfcs/pull/3855)), but are currently enabled for this
/// crate.
export type DeniedPartialMitigations = DeniedPartialMitigation[];

// PORT(stub): the fields cstore_impl.rs touches. `used` is `used_` (the method `used()` has the name).
export class CrateMetadata {
  declare root: CrateRoot;

  // --- Other significant crate properties ---
  /// Maps crate IDs as they are were seen from this crate's compilation sessions into
  /// IDs as they are seen from the current compilation session.
  declare cnum_map: CrateNumMap;
  /// The crate was used non-speculatively.
  declare used_: boolean;

  // --- Data used only for improving diagnostics ---
  /// Information about the `extern crate` item or path that caused this crate to be loaded.
  /// If this is `None`, then the crate was injected (e.g., by the allocator).
  declare extern_crate: ExternCrate | undefined;

  static new(
    _tcx: TyCtxt,
    _blob: MetadataBlob,
    _root: CrateRoot,
    _unhashed: CrateRootUnhashed,
    _raw_proc_macros: readonly unknown[] | undefined,
    _cnum: CrateNum,
    _cnum_map: CrateNumMap,
    _dep_kind: CrateDepKind,
    _source: CrateSource,
    _private_dep: boolean,
    _host_hash: Svh | undefined,
  ): CrateMetadata {
    return unported("rustc_metadata::rmeta::decoder::CrateMetadata::new (wave 11 rmeta-decoder)");
  }
}
export interface CrateMetadata {
  // impl CrateMetadata (decoder.rs:1027)
  item_ident(tcx: TyCtxt, item_index: DefIndex): Ident;
  def_kind(item_id: DefIndex): DefKind;
  get_span(tcx: TyCtxt, index: DefIndex): Span;
  load_proc_macro(tcx: TyCtxt, id: DefIndex): SyntaxExtension;
  get_expn_that_defined(tcx: TyCtxt, id: DefIndex): ExpnId;
  get_ambig_module_children(tcx: TyCtxt, id: DefIndex): Iterable<AmbigModChild>;
  get_ctor(tcx: TyCtxt, node_id: DefIndex): [CtorKind, DefId] | undefined;
  get_item_attrs(tcx: TyCtxt, id: DefIndex): Iterable<Attribute>;
  get_proc_macro_quoted_span(tcx: TyCtxt, index: number): Span;
  get_macro(tcx: TyCtxt, id: DefIndex): MacroDef;
  def_key(index: DefIndex): DefKey;
  def_path(id: DefIndex): DefPath;
  def_path_hash(index: DefIndex): DefPathHash;
  def_path_hash_to_def_index(hash: DefPathHash): DefIndex | undefined;
  expn_hash_to_expn_id(tcx: TyCtxt, index_guess: number, hash: ExpnHash): ExpnId;
  imported_source_file(tcx: TyCtxt, source_file_index: number): unknown;
  // impl CrateMetadata (decoder.rs:1976)
  dependencies(): Iterable<CrateNum>;
  target_modifiers(): TargetModifiers;
  enabled_denied_partial_mitigations(): DeniedPartialMitigations;
  update_extern_crate_diagnostics(new_extern_crate: ExternCrate): boolean;
  source(): CrateSource;
  dep_kind(): CrateDepKind;
  set_dep_kind(dep_kind: CrateDepKind): void;
  update_and_private_dep(private_dep: boolean): void;
  used(): boolean;
  required_panic_strategy(): PanicStrategy | undefined;
  needs_panic_runtime(): boolean;
  is_private_dep(): boolean;
  is_panic_runtime(): boolean;
  is_profiler_runtime(): boolean;
  is_compiler_builtins(): boolean;
  needs_allocator(): boolean;
  has_global_allocator(): boolean;
  has_alloc_error_handler(): boolean;
  has_default_lib_allocator(): boolean;
  is_proc_macro_crate(): boolean;
  proc_macros_for_crate(tcx: TyCtxt, krate: CrateNum): Iterable<DefId>;
  name(): Symbol;
  hash(): Svh;
  has_async_drops(): boolean;
  num_def_ids(): number;
}
unported_methods(CrateMetadata.prototype, "rustc_metadata::rmeta::decoder::CrateMetadata (wave 11 rmeta-decoder)", [
  "item_ident",
  "def_kind",
  "get_span",
  "load_proc_macro",
  "get_expn_that_defined",
  "get_ambig_module_children",
  "get_ctor",
  "get_item_attrs",
  "get_proc_macro_quoted_span",
  "get_macro",
  "def_key",
  "def_path",
  "def_path_hash",
  "def_path_hash_to_def_index",
  "expn_hash_to_expn_id",
  "imported_source_file",
  "dependencies",
  "target_modifiers",
  "enabled_denied_partial_mitigations",
  "update_extern_crate_diagnostics",
  "source",
  "dep_kind",
  "set_dep_kind",
  "update_and_private_dep",
  "used",
  "required_panic_strategy",
  "needs_panic_runtime",
  "is_private_dep",
  "is_panic_runtime",
  "is_profiler_runtime",
  "is_compiler_builtins",
  "needs_allocator",
  "has_global_allocator",
  "has_alloc_error_handler",
  "has_default_lib_allocator",
  "is_proc_macro_crate",
  "proc_macros_for_crate",
  "name",
  "hash",
  "has_async_drops",
  "num_def_ids",
]);

// impl CrateRoot (decoder.rs:992)
declare module "./mod.ts" {
  interface CrateRoot {
    is_proc_macro_crate(): boolean;
    name(): Symbol;
    stable_crate_id(): StableCrateId;
    decode_crate_deps(metadata: MetadataBlob): CrateDep[];
    decode_target_modifiers(metadata: MetadataBlob): TargetModifier[];
    decode_denied_partial_mitigations(metadata: MetadataBlob): DeniedPartialMitigation[];
  }
}
unported_methods(CrateRoot.prototype, "rustc_metadata::rmeta::decoder::CrateRoot (wave 11 rmeta-decoder)", [
  "is_proc_macro_crate",
  "name",
  "stable_crate_id",
  "decode_crate_deps",
  "decode_target_modifiers",
  "decode_denied_partial_mitigations",
]);
