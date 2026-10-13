// Port of compiler/rustc_crate_store/src/cstore.rs
//! the rustc crate store interface. This also includes types that
//! are *mostly* used as a part of that interface, but these should
//! probably get a better home if someone can find one.
//
// Types are generated into cstore.gen.ts (tools/codegen/types.ts, set `rustc_crate_store`);
// methods are attached to the generated classes / companions below.
//
// PORT: pending lanes. `rustc_attr_ir::{CfgEntry, PeImportNameType}` (attr-ir-gen),
// `rustc_abi::{ExternAbi, Size}` and `rustc_data_structures::svh::Svh` are `unknown` in the
// generated types until those crates are ported (tools/codegen/typemap.hir.json).
import type { DefKey, DefPath } from "../rustc_hir_id/definitions.ts";
import { type CrateNum, type DefId, type DefPathHash, LOCAL_CRATE, type StableCrateId } from "../rustc_span/def_id.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import { NativeLibKind } from "../rustc_structures/lib.ts";
import type { Debug } from "../std/fmt.ts";
import * as gen from "./cstore.gen.ts";
import { CrateSource, DllImport, ExternCrate, NativeLib, Untracked } from "./cstore.gen.ts";

export * from "./cstore.gen.ts";

/**
 * PORT: pending attr-ir-gen. The shape `rustc_attr_ir::PeImportNameType` gets from the codegen
 * conventions (data_structures.rs:336: `Ordinal(u16)`, `Decorated`, `NoPrefix`, `Undecorated`);
 * the generated field type is `unknown` until that set exists.
 */
type PeImportNameType = { readonly $: "Ordinal"; _0: number } | { readonly $: "Decorated" } | { readonly $: "NoPrefix" } | { readonly $: "Undecorated" };

declare module "./cstore.gen.ts" {
  interface CrateSource {
    paths(): string[];
  }
  interface NativeLib {
    has_modifiers(): boolean;
    wasm_import_module(): Symbol | undefined;
  }
  interface DllImport {
    ordinal(): number | undefined;
    is_missing_decorations(): boolean;
  }
  interface ExternCrate {
    is_direct(): boolean;
    rank(): [boolean, number];
  }
  interface Untracked {
    freeze_cstore(): void;
  }
}

/// Where a crate came from on the local filesystem. One of these three options
/// must be non-None.
// rustc: compiler/rustc_crate_store/src/cstore.rs:33 paths
CrateSource.prototype.paths = function (this: CrateSource): string[] {
  const out: string[] = [];
  if (this.dylib !== undefined) out.push(this.dylib);
  if (this.rlib !== undefined) out.push(this.rlib);
  if (this.rmeta !== undefined) out.push(this.rmeta);
  return out;
};

export type CrateDepKind = gen.CrateDepKind;
export const CrateDepKind = {
  ...gen.CrateDepKind,

  // rustc: compiler/rustc_crate_store/src/cstore.rs:54 macros_only
  macros_only(self: CrateDepKind): boolean {
    switch (self) {
      case "MacrosOnly":
        return true;
      case "Conditional":
      case "Unconditional":
        return false;
    }
  },
};

// rustc: compiler/rustc_crate_store/src/cstore.rs:79 has_modifiers
NativeLib.prototype.has_modifiers = function (this: NativeLib): boolean {
  return this.verbatim !== undefined || NativeLibKind.has_modifiers(this.kind);
};

// rustc: compiler/rustc_crate_store/src/cstore.rs:83 wasm_import_module
NativeLib.prototype.wasm_import_module = function (this: NativeLib): Symbol | undefined {
  if (this.kind.$ === "WasmImportModule") {
    return this.name;
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_crate_store/src/cstore.rs:111 ordinal
DllImport.prototype.ordinal = function (this: DllImport): number | undefined {
  const t = this.import_name_type as PeImportNameType | undefined;
  if (t !== undefined && t.$ === "Ordinal") {
    return t._0;
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_crate_store/src/cstore.rs:119 is_missing_decorations
DllImport.prototype.is_missing_decorations = function (this: DllImport): boolean {
  const t = this.import_name_type as PeImportNameType | undefined;
  return (t !== undefined && t.$ === "Undecorated") || (t !== undefined && t.$ === "NoPrefix");
};

/// If true, then this crate is the crate named by the extern
/// crate referenced above. If false, then this crate is a dep
/// of the crate.
// rustc: compiler/rustc_crate_store/src/cstore.rs:164 is_direct
ExternCrate.prototype.is_direct = function (this: ExternCrate): boolean {
  return this.dependency_of === LOCAL_CRATE;
};

// rustc: compiler/rustc_crate_store/src/cstore.rs:169 rank
ExternCrate.prototype.rank = function (this: ExternCrate): [boolean, number] {
  // Prefer:
  // - direct extern crate to indirect
  // - shorter paths to longer
  // PORT: `impl PartialOrd` = the tuple, compared lexicographically (`false < true`).
  // `!self.path_len` (usize bitwise not) is `usize::MAX - path_len`; with usize::MAX as
  // Number.MAX_SAFE_INTEGER (the repo's sentinel) the order is the same for every real path length.
  return [this.is_direct(), Number.MAX_SAFE_INTEGER - this.path_len];
};

/// A store of Rust crates, through which their metadata can be accessed.
///
/// Note that this trait should probably not be expanding today. All new
/// functionality should be driven through queries instead!
///
/// If you find a method on this trait named `{name}_untracked` it signifies
/// that it's *not* tracked for dependency information throughout compilation
/// (it'd break incremental compilation) and should only be called pre-HIR (e.g.
/// during resolve)
// PORT: `trait CrateStore: std::fmt::Debug` -> interface; `Debug` is the `debug` member.
// `as_any` / `untracked_as_any` return the implementing object (`dyn Any` downcasts are
// `instanceof` checks at the use site).
export interface CrateStore {
  debug: Debug<CrateStore>;

  // rustc: compiler/rustc_crate_store/src/cstore.rs:200 as_any
  as_any(): unknown;
  // rustc: compiler/rustc_crate_store/src/cstore.rs:201 untracked_as_any
  untracked_as_any(): unknown;

  // Foreign definitions.
  // This information is safe to access, since it's hashed as part of the DefPathHash, which incr.
  // comp. uses to identify a DefId.
  // rustc: compiler/rustc_crate_store/src/cstore.rs:206 def_key
  def_key(def: DefId): DefKey;
  // rustc: compiler/rustc_crate_store/src/cstore.rs:207 def_path
  def_path(def: DefId): DefPath;
  // rustc: compiler/rustc_crate_store/src/cstore.rs:208 def_path_hash
  def_path_hash(def: DefId): DefPathHash;

  // This information is safe to access, since it's hashed as part of the StableCrateId, which
  // incr. comp. uses to identify a CrateNum.
  // rustc: compiler/rustc_crate_store/src/cstore.rs:212 crate_name
  crate_name(cnum: CrateNum): Symbol;
  // rustc: compiler/rustc_crate_store/src/cstore.rs:213 stable_crate_id
  stable_crate_id(cnum: CrateNum): StableCrateId;
}

// pub type CrateStoreDyn = dyn CrateStore + sync::DynSync + sync::DynSend;
export type CrateStoreDyn = CrateStore;

/// Freezes the cstore and, with it, the `StableCrateId` map, making reads of
/// both lock-free. The cstore is frozen first so any in-flight crate loading
/// (which writes the map) finishes before the map is frozen.
// rustc: compiler/rustc_crate_store/src/cstore.rs:233 freeze_cstore
Untracked.prototype.freeze_cstore = function (this: Untracked): void {
  // PORT: `FreezeLock<T>` is its inner value (PORTING §5; single-threaded), so `freeze()` has
  // nothing to do: `self.cstore.freeze(); self.stable_crate_ids.freeze();`
};
