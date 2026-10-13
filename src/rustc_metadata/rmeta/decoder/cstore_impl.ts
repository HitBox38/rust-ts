// Port of compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs.
//
// PORT: partial (lane creader, wave 11). Ported: the `impl CStore` block (line 629) and `impl CrateStore for
// CStore` (line 737), attached to creader.ts's `CStore.prototype` (PORTING section 5, "Methods defined in
// another file"; loaded by ../../lib.ts after creader.ts). They delegate to the `CrateMetadata` stub
// (rmeta/decoder.ts), so they only run once crates are loaded.
//
// Not ported (cstore lane): `ProcessQueryValue` / `IntoArgs` impls, `provide_one!` / `provide!` (the extern
// providers), `provide` (line 436) and `provide_cstore_hooks` (line 770). The M2 path does not reach them for
// the local crate: their local providers read loaded crates (`crates`, `allocator_kind`, ..), which `#![no_core]`
// crates without `extern crate` do not have. `provide` below is a stub.
import type { CrateNum, DefId, StableCrateId } from "../../../rustc_span/def_id.ts";
import type { CtorKind, DefKind } from "../../../rustc_hir/def.ts";
import type { DefKey, DefPath, DefPathHash } from "../../../rustc_hir_id/definitions.ts";
import type { ExpnId } from "../../../rustc_span/hygiene.ts";
import type { Span } from "../../../rustc_span/lib.ts";
import type { Symbol } from "../../../rustc_span/symbol.ts";
import { clone_ExternCrate, ExternCrate } from "../../../rustc_crate_store/lib.ts";
import type { AmbigModChild } from "../../../rustc_middle/middle/resolve.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Providers } from "../../../rustc_middle/util/mod.ts";
import { unported } from "../../../std/panic.ts";
import { CStore, type LoadedMacro } from "../../creader.ts";

declare module "../../creader.ts" {
  interface CStore {
    // impl CStore (cstore_impl.rs:629)
    ctor_untracked(tcx: TyCtxt, def: DefId): [CtorKind, DefId] | undefined;
    load_macro_untracked(tcx: TyCtxt, id: DefId): LoadedMacro;
    def_span_untracked(tcx: TyCtxt, def_id: DefId): Span;
    def_kind_untracked(def: DefId): DefKind;
    expn_that_defined_untracked(tcx: TyCtxt, def_id: DefId): ExpnId;
    ambig_module_children_untracked(tcx: TyCtxt, def_id: DefId): Iterable<AmbigModChild>;
    num_def_ids_untracked(cnum: CrateNum): number;
    get_proc_macro_quoted_span_untracked(tcx: TyCtxt, cnum: CrateNum, id: number): Span;
    set_used_recursively(cnum: CrateNum): void;
    update_extern_crate(cnum: CrateNum, name: Symbol, extern_crate: ExternCrate): void;
    update_transitive_extern_crate_diagnostics(cnum: CrateNum, extern_crate: ExternCrate): void;
    // impl CrateStore for CStore (cstore_impl.rs:737)
    as_any(): unknown;
    untracked_as_any(): unknown;
    crate_name(cnum: CrateNum): Symbol;
    stable_crate_id(cnum: CrateNum): StableCrateId;
    def_key(def: DefId): DefKey;
    def_path(def: DefId): DefPath;
    def_path_hash(def: DefId): DefPathHash;
  }
}

/** `pub(in crate::rmeta) fn provide(providers: &mut Providers)` (cstore_impl.rs:436). PORT: stub (cstore lane). */
export function provide(_providers: Providers): void {
  unported("rustc_metadata::rmeta::decoder::cstore_impl::provide (wave 11 cstore)");
}

// impl CStore

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:630 ctor_untracked
CStore.prototype.ctor_untracked = function (this: CStore, tcx: TyCtxt, def: DefId): [CtorKind, DefId] | undefined {
  return this.get_crate_data(def.krate).get_ctor(tcx, def.index);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:634 load_macro_untracked
CStore.prototype.load_macro_untracked = function (this: CStore, tcx: TyCtxt, id: DefId): LoadedMacro {
  const sess = tcx.sess;
  const _prof_timer = sess.prof.generic_activity("metadata_load_macro");
  void _prof_timer;

  const cdata = this.get_crate_data(id.krate);
  if (cdata.root.is_proc_macro_crate()) {
    return { $: "ProcMacro", _0: cdata.load_proc_macro(tcx, id.index) };
  } else {
    return {
      $: "MacroDef",
      def: cdata.get_macro(tcx, id.index),
      ident: cdata.item_ident(tcx, id.index),
      attrs: [...cdata.get_item_attrs(tcx, id.index)],
      span: cdata.get_span(tcx, id.index),
      edition: cdata.root.edition,
    };
  }
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:652 def_span_untracked
CStore.prototype.def_span_untracked = function (this: CStore, tcx: TyCtxt, def_id: DefId): Span {
  return this.get_crate_data(def_id.krate).get_span(tcx, def_id.index);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:656 def_kind_untracked
CStore.prototype.def_kind_untracked = function (this: CStore, def: DefId): DefKind {
  return this.get_crate_data(def.krate).def_kind(def.index);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:660 expn_that_defined_untracked
CStore.prototype.expn_that_defined_untracked = function (this: CStore, tcx: TyCtxt, def_id: DefId): ExpnId {
  return this.get_crate_data(def_id.krate).get_expn_that_defined(tcx, def_id.index);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:664 ambig_module_children_untracked
CStore.prototype.ambig_module_children_untracked = function (this: CStore, tcx: TyCtxt, def_id: DefId): Iterable<AmbigModChild> {
  return this.get_crate_data(def_id.krate).get_ambig_module_children(tcx, def_id.index);
};

/// Only public-facing way to traverse all the definitions in a non-local crate.
/// Critically useful for this third-party project: <https://github.com/hacspec/hacspec>.
/// See <https://github.com/rust-lang/rust/pull/85889> for context.
// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:675 num_def_ids_untracked
CStore.prototype.num_def_ids_untracked = function (this: CStore, cnum: CrateNum): number {
  return this.get_crate_data(cnum).num_def_ids();
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:679 get_proc_macro_quoted_span_untracked
CStore.prototype.get_proc_macro_quoted_span_untracked = function (this: CStore, tcx: TyCtxt, cnum: CrateNum, id: number): Span {
  return this.get_crate_data(cnum).get_proc_macro_quoted_span(tcx, id);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:688 set_used_recursively
CStore.prototype.set_used_recursively = function (this: CStore, cnum: CrateNum): void {
  const cdata = this.get_crate_data_mut(cnum);
  if (!cdata.used_) {
    cdata.used_ = true;
    // `mem::take(&mut cdata.cnum_map)`
    const cnum_map = cdata.cnum_map;
    cdata.cnum_map = [];
    for (const dep_cnum of cnum_map) {
      this.set_used_recursively(dep_cnum);
    }
    this.get_crate_data_mut(cnum).cnum_map = cnum_map;
  }
};

/// Track how an extern crate has been loaded. Called after resolving an import in the local crate.
///
/// * the `name` is for [`Self::set_resolved_extern_crate_name`] saving `--extern name=`
/// * `extern_crate` is for diagnostics
// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:704 update_extern_crate
CStore.prototype.update_extern_crate = function (this: CStore, cnum: CrateNum, name: Symbol, extern_crate: ExternCrate): void {
  // debug_assert_eq!(extern_crate.dependency_of, LOCAL_CRATE, "this function should not be called on transitive dependencies");
  this.set_resolved_extern_crate_name(name, cnum);
  this.update_transitive_extern_crate_diagnostics(cnum, extern_crate);
};

/// `CrateMetadata` uses `ExternCrate` only for diagnostics
// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:719 update_transitive_extern_crate_diagnostics
CStore.prototype.update_transitive_extern_crate_diagnostics = function (this: CStore, cnum: CrateNum, extern_crate: ExternCrate): void {
  const cdata = this.get_crate_data_mut(cnum);
  if (cdata.update_extern_crate_diagnostics(extern_crate)) {
    // Propagate the extern crate info to dependencies if it was updated.
    const extern_crate_ = new ExternCrate(extern_crate.src, extern_crate.span, extern_crate.path_len, cnum);
    // `mem::take(&mut cdata.cnum_map)`
    const cnum_map = cdata.cnum_map;
    cdata.cnum_map = [];
    for (const dep_cnum of cnum_map) {
      // PORT: `ExternCrate: Copy` -> a clone per call (PORTING section 8).
      this.update_transitive_extern_crate_diagnostics(dep_cnum, clone_ExternCrate(extern_crate_));
    }
    this.get_crate_data_mut(cnum).cnum_map = cnum_map;
  }
};

// impl CrateStore for CStore

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:738 as_any
CStore.prototype.as_any = function (this: CStore): unknown {
  return this;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:742 untracked_as_any
CStore.prototype.untracked_as_any = function (this: CStore): unknown {
  return this;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:746 crate_name
CStore.prototype.crate_name = function (this: CStore, cnum: CrateNum): Symbol {
  return this.get_crate_data(cnum).root.header.name;
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:750 stable_crate_id
CStore.prototype.stable_crate_id = function (this: CStore, cnum: CrateNum): StableCrateId {
  return this.get_crate_data(cnum).root.stable_crate_id_;
};

/// Returns the `DefKey` for a given `DefId`. This indicates the
/// parent `DefId` as well as some idea of what kind of data the
/// `DefId` refers to.
// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:757 def_key
CStore.prototype.def_key = function (this: CStore, def: DefId): DefKey {
  return this.get_crate_data(def.krate).def_key(def.index);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:761 def_path
CStore.prototype.def_path = function (this: CStore, def: DefId): DefPath {
  return this.get_crate_data(def.krate).def_path(def.index);
};

// rustc: compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs:765 def_path_hash
CStore.prototype.def_path_hash = function (this: CStore, def: DefId): DefPathHash {
  return this.get_crate_data(def.krate).def_path_hash(def.index);
};
