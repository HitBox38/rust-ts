// Port of compiler/rustc_middle/src/middle/lang_items.rs
//! Detecting lang items.
//!
//! Language items are items that represent concepts intrinsic to the language
//! itself. Examples are:
//!
//! * Traits that specify "kinds"; e.g., `Sync`, `Send`.
//! * Traits that represent operators; e.g., `Add`, `Sub`, `Index`.
//! * Functions called by the compiler itself.
//
// PORT: `impl<'tcx> TyCtxt<'tcx>` -> methods put on `TyCtxt.prototype` (PORTING §5 "Methods defined in another
// file"); rustc_middle/lib.ts loads this module after ty/context.ts.
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { type DefId, DefId_eq } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { ClosureKind } from "../../rustc_type_ir/decls.ts";
import { RequiresLangItem_diagnostic } from "../diagnostics.ts";
import { TyCtxt } from "../ty/context.ts";

declare module "../ty/context.ts" {
  interface TyCtxt {
    require_lang_item(lang_item: LangItem, span: Span): DefId;
    is_lang_item(def_id: DefId, lang_item: LangItem): boolean;
    as_lang_item(def_id: DefId): LangItem | undefined;
    fn_trait_kind_from_def_id(id: DefId): ClosureKind | undefined;
    async_fn_trait_kind_from_def_id(id: DefId): ClosureKind | undefined;
    is_callable_trait(id: DefId): boolean;
    fn_trait_kind_to_def_id(kind: ClosureKind): DefId | undefined;
    async_fn_trait_kind_to_def_id(kind: ClosureKind): DefId | undefined;
    is_fn_trait(id: DefId): boolean;
  }
}

/// Returns the `DefId` for a given `LangItem`.
/// If not found, fatally aborts compilation.
// rustc: compiler/rustc_middle/src/middle/lang_items.rs:20 require_lang_item
TyCtxt.prototype.require_lang_item = function (this: TyCtxt, lang_item: LangItem, span: Span): DefId {
  const def_id = this.lang_items().get(lang_item);
  if (def_id !== undefined) return def_id;
  return this.dcx().emit_fatal(RequiresLangItem_diagnostic({ span, name: LangItem.name(lang_item) }));
};

// rustc: compiler/rustc_middle/src/middle/lang_items.rs:27 is_lang_item
TyCtxt.prototype.is_lang_item = function (this: TyCtxt, def_id: DefId, lang_item: LangItem): boolean {
  // `Option<DefId> == Some(def_id)`: `DefId` compares by value.
  const item = this.lang_items().get(lang_item);
  return item !== undefined && DefId_eq(item, def_id);
};

// rustc: compiler/rustc_middle/src/middle/lang_items.rs:31 as_lang_item
TyCtxt.prototype.as_lang_item = function (this: TyCtxt, def_id: DefId): LangItem | undefined {
  return this.lang_items().from_def_id(def_id);
};

/// Given a [`DefId`] of one of the [`Fn`], [`FnMut`] or [`FnOnce`] traits,
/// returns a corresponding [`ty::ClosureKind`].
/// For any other [`DefId`] return `None`.
// rustc: compiler/rustc_middle/src/middle/lang_items.rs:38 fn_trait_kind_from_def_id
TyCtxt.prototype.fn_trait_kind_from_def_id = function (this: TyCtxt, id: DefId): ClosureKind | undefined {
  const item = this.as_lang_item(id);
  if (item === undefined) return undefined;
  switch (item) {
    case "Fn":
      return "Fn";
    case "FnMut":
      return "FnMut";
    case "FnOnce":
      return "FnOnce";
    default:
      return undefined;
  }
};

/// Given a [`DefId`] of one of the `AsyncFn`, `AsyncFnMut` or `AsyncFnOnce` traits,
/// returns a corresponding [`ty::ClosureKind`].
/// For any other [`DefId`] return `None`.
// rustc: compiler/rustc_middle/src/middle/lang_items.rs:50 async_fn_trait_kind_from_def_id
TyCtxt.prototype.async_fn_trait_kind_from_def_id = function (this: TyCtxt, id: DefId): ClosureKind | undefined {
  const item = this.as_lang_item(id);
  if (item === undefined) return undefined;
  switch (item) {
    case "AsyncFn":
      return "Fn";
    case "AsyncFnMut":
      return "FnMut";
    case "AsyncFnOnce":
      return "FnOnce";
    default:
      return undefined;
  }
};

/// Given a [`DefId`], returns whether it is one of the built-in callable
/// traits: `Fn`/`FnMut`/`FnOnce` or `AsyncFn`/`AsyncFnMut`/`AsyncFnOnce`.
///
/// These built-in callable traits all model their inputs using the
/// `rust-call` ABI, which is tupled at the type level.
// rustc: compiler/rustc_middle/src/middle/lang_items.rs:64 is_callable_trait
TyCtxt.prototype.is_callable_trait = function (this: TyCtxt, id: DefId): boolean {
  const item = this.as_lang_item(id);
  return (
    item === "Fn" || item === "FnMut" || item === "FnOnce" || item === "AsyncFn" || item === "AsyncFnMut" || item === "AsyncFnOnce"
  );
};

/// Given a [`ty::ClosureKind`], get the [`DefId`] of its corresponding `Fn`-family
/// trait, if it is defined.
// rustc: compiler/rustc_middle/src/middle/lang_items.rs:80 fn_trait_kind_to_def_id
TyCtxt.prototype.fn_trait_kind_to_def_id = function (this: TyCtxt, kind: ClosureKind): DefId | undefined {
  const items = this.lang_items();
  switch (kind) {
    case "Fn":
      return items.fn_trait();
    case "FnMut":
      return items.fn_mut_trait();
    case "FnOnce":
      return items.fn_once_trait();
  }
};

/// Given a [`ty::ClosureKind`], get the [`DefId`] of its corresponding `Fn`-family
/// trait, if it is defined.
// rustc: compiler/rustc_middle/src/middle/lang_items.rs:91 async_fn_trait_kind_to_def_id
TyCtxt.prototype.async_fn_trait_kind_to_def_id = function (this: TyCtxt, kind: ClosureKind): DefId | undefined {
  const items = this.lang_items();
  switch (kind) {
    case "Fn":
      return items.async_fn_trait();
    case "FnMut":
      return items.async_fn_mut_trait();
    case "FnOnce":
      return items.async_fn_once_trait();
  }
};

/// Returns `true` if `id` is a `DefId` of [`Fn`], [`FnMut`] or [`FnOnce`] traits.
// rustc: compiler/rustc_middle/src/middle/lang_items.rs:101 is_fn_trait
TyCtxt.prototype.is_fn_trait = function (this: TyCtxt, id: DefId): boolean {
  return this.fn_trait_kind_from_def_id(id) !== undefined;
};

/// Returns `true` if the specified `lang_item` must be present for this
/// compilation.
///
/// Not all lang items are always required for each compilation, particularly in
/// the case of panic=abort. In these situations some lang items are injected by
/// crates and don't actually need to be defined in libstd.
// rustc: compiler/rustc_middle/src/middle/lang_items.rs:112 required
export function required(tcx: TyCtxt, lang_item: LangItem): boolean {
  // If we're not compiling with unwinding, we won't actually need this
  // symbol. Other panic runtimes ensure that the relevant symbols are
  // available to link things together, but they're never exercised.
  switch (tcx.sess.panic_strategy()) {
    case "Abort":
      return lang_item !== LangItem.EhPersonality;
    case "Unwind":
      return true;
    case "ImmediateAbort":
      return false;
  }
}
