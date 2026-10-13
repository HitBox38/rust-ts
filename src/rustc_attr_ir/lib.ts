// Port of compiler/rustc_attr_ir/src/lib.rs
//! Data structures for representing parsed attributes in the Rust compiler.
//!
//! For detailed documentation about attribute processing,
//! see [rustc_attr_parsing](../rustc_attr_parsing/index.html).
//
// PORT: `pub use x::*` -> `export *`; `pub mod x` -> `export * as x`; private `mod x` with a `pub use`
// of some of its items -> named re-exports. The types are generated (tools/codegen/types.ts, set
// `rustc_attr_ir`) into the `.gen.ts` modules next to their hand modules. `include!("attribute_docs.rs")`
// adds only rustdoc items (`#[doc(attribute = ..)] const _: () = ();`), nothing to port.
//
// At the pin `hir::Attribute` *is* this crate's `Attribute` (rustc_hir/src/hir.rs:
// `use rustc_attr_ir::Attribute;`); `AttrItem`, `AttrArgs`, `AttrPath` live in attr.rs here too.

// rustc_ast is loaded first: its extension modules attach the methods this crate calls.
import "../rustc_ast/lib.ts";
import type { AttributeKind } from "./data_structures.ts";
import type { Attribute } from "./attr.ts";

export * from "./attr.ts";
export * from "./data_structures.ts";
export { EncodeCrossCrate } from "./encode_cross_crate.ts";
export * from "./lang_items.ts";
export type { PrintAttribute } from "./pretty_printing.ts";
export * from "./stability.ts";

export * as diagnostic from "./diagnostic.ts";
export * as diagnostic_items from "./diagnostic_items.ts";
export * as lang_items from "./lang_items.ts";
export * as target from "./target.ts";
export * as weak_lang_items from "./weak_lang_items.ts";

/// A trait for types that can provide a list of attributes given a `TyCtxt`.
///
/// It is an implementation detail of the [`find_attr!`] macro to be able to accept either a
/// [`DefId`], [`LocalDefId`], [`OwnerId`], or [`HirId`]. It is defined here with a generic `Tcx`
/// because this crate can't depend on `rustc_middle`. The concrete implementations are in
/// `rustc_middle`.
///
/// Not to be confused with [`rustc_ast::ast_traits::HasAttrs`].
///
/// [`DefId`]: rustc_span::def_id::DefId
/// [`LocalDefId`]: rustc_span::def_id::LocalDefId
/// [`OwnerId`]: ../rustc_hir/struct.OwnerId.html
/// [`HirId`]: ../rustc_hir/struct.HirId.html
// PORT: a trait over the id type: the implementing types pass a table `HasAttrs<Id, Tcx>`.
export interface HasAttrs<Id, Tcx> {
  // rustc: compiler/rustc_attr_ir/src/lib.rs:51 get_attrs
  get_attrs(self: Id, tcx: Tcx): readonly Attribute[];
}

/// Finds attributes by pattern matching.
///
/// A little like `matches` but for attributes.
///
/// PORT: `find_attr!` is a `macro_rules!` over a pattern; its list form
/// (`find_attr!($attributes_list, $pattern $(if $guard)? => $e)`) is this function, with the pattern,
/// guard and `$e` as one callback over the `AttributeKind` of each `Attribute::Parsed` that returns
/// `undefined` when the pattern (or the guard) does not match. The first match wins
/// (`break 'done Some($e)`); `Attribute::Unparsed` is skipped. The `find_attr!(tcx, id, ..)` and
/// `find_attr!(tcx, crate, ..)` forms are `find_attr(HasAttrs.get_attrs(id, tcx), ..)` /
/// `find_attr(tcx.hir_krate_attrs(), ..)` at the call site. The boolean forms
/// (`find_attr!(attrs, Pat)`) are `find_attr(attrs, (k) => (k.$ === "Pat" ? null : undefined)) !== undefined`.
export function find_attr<R>(attributes_list: Iterable<Attribute>, f: (kind: AttributeKind) => R | undefined): R | undefined {
  for (const i of attributes_list) {
    if (i.$ === "Parsed") {
      const r = f(i._0);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}
