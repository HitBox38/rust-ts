// Partial port of compiler/rustc_middle/src/ty/mod.rs: `Visibility` (and its impls), the `TyCtxt`
// def-id tree helpers name resolution needs (`opt_parent`, `parent`, `opt_local_parent`, `local_parent`,
// `def_id_partial_cmp`, `is_descendant_of`, `opt_item_name`, `item_name`), and (lane ty-contract, plan-m3
// D2/D3) the hash-consed `Ty` class and the `Term` union. The rest of ty/mod.rs (types, generics, ADTs, ...)
// is M3+: its `TyCtxt` methods are stubs at the end of this file (tyctxt-min decision 6).
//
// PORT (D2): `Ty(Interned<'tcx, WithCachedTypeInfo<TyKind<'tcx>>>)` is the hash-consed object itself: one
// frozen `Ty` per distinct `TyKind`, made only by `CtxtInterners::intern_ty` (context.ts); equality is `===`, a
// `Ty` is its own `Map`/`Set` key. `WithCachedTypeInfo`'s fields are `internee`, `flags_`,
// `outer_exclusive_binder_` (renamed: `impl Flags for Ty` has methods of those names). Its methods are
// declared in decls.ts and filled by the files that define them upstream (sty.ts, util.ts, ...), which are
// extension modules: this file must never import them (they assign to `Ty.prototype` at load).
// PORT (D3): `Term` is `Ty | Const` (upstream a tagged pointer); `Term.kind(t)` dispatches on the class.
//
// PORT: `Visibility<Id>` is generic over `LocalModId` (a number) and `ModId` (a class); conversions
// `Id: Into<ModId>` / `impl Into<DefId>` dispatch on the runtime shape (`into_ModId`,
// `into_query_key_DefId`). `Option<Ordering>` is `Ordering | undefined` with
// `Ordering = "Less" | "Equal" | "Greater"`.
import { type DefPath, debug_DefPath } from "../../rustc_hir_id/definitions.ts";
import { DefId, type DefId as DefIdT, debug_DefId, debug_LocalModId, debug_ModId, type LocalDefId, LocalModId, ModId, ModId_eq } from "../../rustc_span/def_id.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import { type Debug, debug_tuple, PLAIN } from "../../std/fmt.ts";
import { panic } from "../../std/panic.ts";
import { Interned } from "../../rustc_data_structures/intern.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import type { DebruijnIndex, TermKind, TyKind, TypeFlags } from "../../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { Const } from "../../rustc_type_ir/sty/mod.ts";
import { unported } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import { type IntoQueryKey, into_query_key_DefId } from "../query/into_query_key.ts";
import type { TyCtxt } from "./context.ts";
import type { AssocItem, Attribute, Body, BodyId, CoroutineLayout, FieldIdx, FnAbi, FnAbiError, ImplOverlapKind, ImplTraitInTraitData, Instance, InstanceKind, LayoutError, PseudoCanonicalInput, ReprOptions, TypeckResults, VariantDef } from "./decls.ts";
import type { EarlyBinder, ImplPolarity, TraitRef } from "../../rustc_type_ir/decls.ts";
import type { GenericArg, GenericArgs } from "./generic_args.ts";
import type { List } from "./list.ts";

export type Ordering = "Less" | "Equal" | "Greater";

export type Visibility<Id = LocalModId> =
  /// Visible everywhere (including in other crates).
  | { readonly $: "Public" }
  /// Visible only in the given crate-local module.
  | { readonly $: "Restricted"; readonly _0: Id };

/** `Into<ModId>` for the two `Id`s used with `Visibility` (`LocalModId`, `ModId`). */
function into_ModId(id: LocalModId | ModId): ModId {
  return id instanceof ModId ? id : LocalModId.to_mod_id(id);
}

const PUBLIC: { readonly $: "Public" } = Object.freeze({ $: "Public" as const });

export const Visibility = {
  Public: PUBLIC,
  Restricted<Id>(id: Id): Visibility<Id> {
    return { $: "Restricted", _0: id };
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:257 to_string
  to_string(self: Visibility<LocalModId>, def_id: LocalDefId, tcx: TyCtxt): string {
    switch (self.$) {
      case "Restricted": {
        const restricted_id = self._0;
        if (LocalModId.is_top_level_module(restricted_id)) {
          return "pub(crate)";
        } else if (restricted_id === tcx.parent_module_from_def_id(def_id)) {
          return "pub(self)";
        } else {
          const p: DefPath = tcx.def_path(LocalModId.to_def_id(restricted_id));
          return `pub(in crate${p.to_string_no_crate_verbose()})`;
        }
      }
      case "Public":
        return "pub";
    }
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:414 is_public
  is_public<Id>(self: Visibility<Id>): boolean {
    return self.$ === "Public";
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:418 map_id
  map_id<Id, OutId>(self: Visibility<Id>, f: (id: Id) => OutId): Visibility<OutId> {
    switch (self.$) {
      case "Public":
        return PUBLIC;
      case "Restricted":
        return Visibility.Restricted(f(self._0));
    }
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:427 to_mod_id
  to_mod_id(self: Visibility<LocalModId>): Visibility<ModId> {
    return Visibility.map_id(self, LocalModId.to_mod_id);
  },

  /// Returns `true` if an item with this visibility is accessible from the given definition.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:434 is_accessible_from
  is_accessible_from(self: Visibility<LocalModId | ModId>, def_id: IntoQueryKey<DefIdT>, tcx: TyCtxt): boolean {
    switch (self.$) {
      // Public items are visible everywhere.
      case "Public":
        return true;
      case "Restricted":
        return tcx.is_descendant_of(def_id, into_ModId(self._0));
    }
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:442 partial_cmp
  partial_cmp(self: Visibility<LocalModId | ModId>, vis: Visibility<LocalModId | ModId>, tcx: TyCtxt): Ordering | undefined {
    if (self.$ === "Public" && vis.$ === "Public") return "Equal";
    if (self.$ === "Public" && vis.$ === "Restricted") return "Greater";
    if (self.$ === "Restricted" && vis.$ === "Public") return "Less";
    const [lhs_id, rhs_id] = [into_ModId((self as { _0: LocalModId | ModId })._0), into_ModId((vis as { _0: LocalModId | ModId })._0)];
    return tcx.def_id_partial_cmp(lhs_id.to_def_id(), rhs_id.to_def_id());
  },

  /// Returns `true` if this visibility is strictly larger than the given visibility.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:462 greater_than
  greater_than(self: Visibility<LocalModId | ModId>, vis: Visibility<LocalModId | ModId>, tcx: TyCtxt): boolean {
    const ord = Visibility.partial_cmp(self, vis, tcx);
    if (ord !== undefined) {
      return ord === "Greater";
    } else {
      tcx.dcx().delayed_bug(`unordered visibilities: ${debug_Visibility_any(self)} and ${debug_Visibility_any(vis)}`);
      return false;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:478 expect_local
  expect_local(self: Visibility<ModId>): Visibility<LocalModId> {
    return Visibility.map_id(self, (id) => id.expect_local());
  },

  /// Returns `true` if this item is visible anywhere in the local crate.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:483 is_visible_locally
  is_visible_locally(self: Visibility<ModId>): boolean {
    switch (self.$) {
      case "Public":
        return true;
      case "Restricted":
        return self._0.is_local();
    }
  },
};

/** `#[derive(Debug)]` */
export function debug_Visibility<Id>(v: Visibility<Id>, f: Parameters<Debug<Id>>[1], debug_id: Debug<Id>): string {
  switch (v.$) {
    case "Public":
      return "Public";
    case "Restricted":
      return debug_tuple(f, "Restricted", [debug_id(v._0, f)]);
  }
}
function debug_Visibility_any(v: Visibility<LocalModId | ModId>): string {
  return debug_Visibility(v, PLAIN, (id, f) => (id instanceof ModId ? debug_ModId(id, f) : debug_LocalModId(id, f)));
}

/** `#[derive(PartialEq)]` */
export function Visibility_eq<Id>(a: Visibility<Id>, b: Visibility<Id>): boolean {
  if (a.$ !== b.$) return false;
  if (a.$ === "Public") return true;
  const x = a._0;
  const y = (b as { _0: Id })._0;
  return x instanceof ModId ? ModId_eq(x, y as ModId) : x === y;
}

/// Use this rather than `TyKind`, whenever possible.
// rustc-type: compiler/rustc_middle/src/ty/mod.rs:517 Ty
export class Ty extends Interned {
  /** `WithCachedTypeInfo::internee` */
  readonly internee: TyKind;
  /** `WithCachedTypeInfo::flags` (renamed: module comment) */
  readonly flags_: TypeFlags;
  /** `WithCachedTypeInfo::outer_exclusive_binder` (renamed: module comment) */
  readonly outer_exclusive_binder_: DebruijnIndex;

  /** PORT: only `CtxtInterners::intern_ty` constructs (D2); the kind object is frozen with it. */
  constructor(internee: TyKind, flags: TypeFlags, outer_exclusive_binder: DebruijnIndex) {
    super();
    this.internee = Object.freeze(internee);
    this.flags_ = flags;
    this.outer_exclusive_binder_ = outer_exclusive_binder;
    Object.freeze(this);
  }

  // Avoid this in favour of more specific `new_*` methods, where possible.
  // rustc: compiler/rustc_middle/src/ty/sty.rs:368 new
  static new(tcx: TyCtxt, st: TyKind): Ty {
    return tcx.mk_ty_from_kind(st);
  }

  // It would be nicer if this returned the value instead of a reference,
  // like how `Predicate::kind` and `Region::kind` do. (It would result in
  // many fewer subsequent dereferences.) But that gives a small but
  // noticeable performance hit. See #126069 for details.
  // PORT: also `impl IntoKind for Ty` (mod.rs:522, `*self.kind()`): one method.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:522 kind
  // rustc: compiler/rustc_middle/src/ty/sty.rs:1134 kind
  kind(): TyKind {
    return this.internee;
  }

  // rustc: compiler/rustc_middle/src/ty/mod.rs:528 flags
  flags(): TypeFlags {
    return this.flags_;
  }

  // rustc: compiler/rustc_middle/src/ty/mod.rs:532 outer_exclusive_binder
  outer_exclusive_binder(): DebruijnIndex {
    return this.outer_exclusive_binder_;
  }
}

/** PORT (D3): `pub struct Term<'tcx> { ptr: NonNull<()>, .. }` (mod.rs:550) is `Ty | Const`. */
export type Term = Ty | Const;

export const Term = {
  // rustc: compiler/rustc_middle/src/ty/mod.rs:588 from
  /** `impl From<Ty> for Term` */
  from_Ty(ty: Ty): Term {
    return Term.pack({ $: "Ty", _0: ty });
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:594 from
  /** `impl From<Const> for Term` */
  from_Const(c: Const): Term {
    return Term.pack({ $: "Const", _0: c });
  },

  // PORT: also `impl IntoKind for Term` (mod.rs:562, `self.kind()`): one function.
  // PORT: the tag bits of the packed pointer are the class of the object (D3).
  // rustc: compiler/rustc_middle/src/ty/mod.rs:562 kind
  // rustc: compiler/rustc_middle/src/ty/mod.rs:648 kind
  kind(self: Term): TermKind {
    // SAFETY: use of `Interned::new_unchecked` here is ok because these
    // pointers were originally created from `Interned` types in `pack()`,
    // and this is just going in the other direction.
    if (self instanceof Ty) return { $: "Ty", _0: self };
    if (self instanceof Const) return { $: "Const", _0: self };
    return panic("internal error: entered unreachable code");
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:667 as_type
  as_type(self: Term): Ty | undefined {
    const k = Term.kind(self);
    return k.$ === "Ty" ? k._0 : undefined;
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:671 expect_type
  expect_type(self: Term): Ty {
    const t = Term.as_type(self);
    if (t === undefined) panic("expected a type, but found a const");
    return t;
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:675 as_const
  as_const(self: Term): Const | undefined {
    const k = Term.kind(self);
    return k.$ === "Const" ? k._0 : undefined;
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:679 expect_const
  expect_const(self: Term): Const {
    const c = Term.as_const(self);
    if (c === undefined) panic("expected a const, but found a type");
    return c;
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:683 into_arg
  into_arg(self: Term): GenericArg {
    const k = Term.kind(self);
    switch (k.$) {
      case "Ty":
        return k._0;
      case "Const":
        return k._0;
    }
  },

  /** Stub: `Term::to_alias_term` (mod.rs:690). */
  to_alias_term(_self: Term): unknown {
    return unported("rustc_middle::ty::Term::to_alias_term");
  },
  /** Stub: `Term::is_non_rigid_alias` (mod.rs:703). */
  is_non_rigid_alias(_self: Term): boolean {
    return unported("rustc_middle::ty::Term::is_non_rigid_alias");
  },
  /** Stub: `Term::is_infer` (mod.rs:716). */
  is_infer(_self: Term): boolean {
    return unported("rustc_middle::ty::Term::is_infer");
  },
  /** Stub: `Term::is_trivially_wf` (mod.rs:723). */
  is_trivially_wf(_self: Term, _tcx: TyCtxt): boolean {
    return unported("rustc_middle::ty::Term::is_trivially_wf");
  },
  /** Stub: `Term::walk` (mod.rs:740). */
  walk(_self: Term): unknown {
    return unported("rustc_middle::ty::Term::walk");
  },

  // PORT: `TermKindPackExt::pack`: the tagged pointer is the object itself (D3).
  // rustc: compiler/rustc_middle/src/ty/mod.rs:752 pack
  pack(self: TermKind): Term {
    switch (self.$) {
      case "Ty":
        // Ensure we can use the tag bits.
        // PORT: `assert_eq!(align_of_val(..) & TAG_MASK, 0)` has no meaning without pointers.
        return self._0;
      case "Const":
        return self._0;
    }
  },
};

/** Stub: `impl Debug for Term` (mod.rs:579). */
export function debug_Term(_v: Term): string {
  return unported("rustc_middle::ty::Term: Debug");
}

/** Stub D4 descriptor: `impl TypeFoldable for Term` (mod.rs:606, :616) + `TypeVisitable` (:625). */
export const fold_Term: TypeFoldable<Term> = {
  try_fold_with(_self, _folder) {
    return unported("rustc_middle::ty::Term: TypeFoldable::try_fold_with");
  },
  fold_with(_self, _folder) {
    return unported("rustc_middle::ty::Term: TypeFoldable::fold_with");
  },
  visit_with(_self, _visitor) {
    return unported("rustc_middle::ty::Term: TypeVisitable::visit_with");
  },
};

// ---- impl TyCtxt (ty/mod.rs) -------------------------------------------------------------------
// PORT: free functions `TyCtxt_<name>(tcx, ..)`; the `TyCtxt` class (context.ts) declares the methods and
// delegates here (PORTING §8), so context.ts never depends on an extension module at load time.


// rustc: compiler/rustc_middle/src/ty/mod.rs:347 opt_parent
export function TyCtxt_opt_parent(tcx: TyCtxt, id: DefIdT): DefIdT | undefined {
  const index = tcx.def_key(id).parent;
  return index === undefined ? undefined : new DefId(index, id.krate);
}

// rustc: compiler/rustc_middle/src/ty/mod.rs:353 parent
export function TyCtxt_parent(tcx: TyCtxt, id: DefIdT): DefIdT {
  const p = tcx.opt_parent(id);
  if (p !== undefined) {
    return p;
  }
  // not `unwrap_or_else` to avoid breaking caller tracking
  return panic(`${debug_DefId(id, PLAIN)} doesn't have a parent`);
}

// rustc: compiler/rustc_middle/src/ty/mod.rs:363 opt_local_parent
export function TyCtxt_opt_local_parent(tcx: TyCtxt, id: LocalDefId): LocalDefId | undefined {
  return tcx.opt_parent(into_query_key_DefId(id))?.expect_local();
}

// rustc: compiler/rustc_middle/src/ty/mod.rs:369 local_parent
export function TyCtxt_local_parent(tcx: TyCtxt, id: LocalDefId | LocalModId): LocalDefId {
  return tcx.parent(into_query_key_DefId(id)).expect_local();
}

/// Compare def-ids based on their position in def-id tree, ancestor def-ids are considered
/// larger than descendant def-ids, and two different def-ids are considered unordered if
/// neither of them is an ancestor of the other.
// rustc: compiler/rustc_middle/src/ty/mod.rs:376 def_id_partial_cmp
export function TyCtxt_def_id_partial_cmp(tcx: TyCtxt, lhs: DefIdT, rhs: DefIdT): Ordering | undefined {
  // Def-ids from different crates are always unordered.
  if (lhs.krate !== rhs.krate) {
    return undefined;
  }

  // Def-ids of parent nodes are always created before def-ids of child nodes
  // and have a smaller index, so we only need to search in one direction,
  // either from lhs to rhs, or vice versa.
  const search = (start: DefIdT, finish: DefIdT, ord: Ordering): Ordering | undefined => {
    while (start.index !== finish.index) {
      const parent = tcx.opt_parent(start);
      if (parent !== undefined) {
        start = new DefId(parent.index, start.krate);
      } else {
        return undefined;
      }
    }
    return ord;
  };
  if (lhs.index === rhs.index) return "Equal";
  if (lhs.index < rhs.index) return search(rhs, lhs, "Greater");
  return search(lhs, rhs, "Less");
}

// rustc: compiler/rustc_middle/src/ty/mod.rs:401 is_descendant_of
export function TyCtxt_is_descendant_of(tcx: TyCtxt, descendant: IntoQueryKey<DefIdT>, ancestor: IntoQueryKey<DefIdT>): boolean {
  const o = tcx.def_id_partial_cmp(into_query_key_DefId(descendant), into_query_key_DefId(ancestor));
  return o === "Less" || o === "Equal";
}

/// Look up the name of a definition across crates. This does not look at HIR.
// rustc: compiler/rustc_middle/src/ty/mod.rs:1689 opt_item_name
export function TyCtxt_opt_item_name(tcx: TyCtxt, def_id_: IntoQueryKey<DefIdT>): Symbol | undefined {
  const def_id = into_query_key_DefId(def_id_);
  const cnum = def_id.as_crate_root();
  if (cnum !== undefined) {
    return tcx.crate_name(cnum);
  } else {
    const def_key = tcx.def_key(def_id);
    switch (def_key.disambiguated_data.data.$) {
      // The name of a constructor is that of its parent.
      case "Ctor": {
        const parent = def_key.parent;
        if (parent === undefined) panic("called `Option::unwrap()` on a `None` value");
        return tcx.opt_item_name(new DefId(parent, def_id.krate));
      }
      default:
        return def_key.get_opt_name();
    }
  }
}

/// Look up the name of a definition across crates. This does not look at HIR.
///
/// This method will ICE if the corresponding item does not have a name. In these cases, use
/// [`opt_item_name`] instead.
///
/// [`opt_item_name`]: Self::opt_item_name
// rustc: compiler/rustc_middle/src/ty/mod.rs:1710 item_name
export function TyCtxt_item_name(tcx: TyCtxt, id_: IntoQueryKey<DefIdT>): Symbol {
  const id = into_query_key_DefId(id_);
  const n = tcx.opt_item_name(id);
  if (n !== undefined) return n;
  return panic(`item_name: no name for ${debug_DefPath(tcx.def_path(id), PLAIN)}`);
}

// ---- stubs: the rest of `impl TyCtxt` in ty/mod.rs (upstream order) -----------------------------------
// Lane ty-mod-* fills each in place (marker above it, keep the position in upstream order relative to the
// ported fns above when it moves it) and keeps the delegating method in context.ts's `TyCtxt` class.

/** `TyCtxt::typeck_body` (ty/mod.rs:1578). */
export function TyCtxt_typeck_body(_tcx: TyCtxt, _body: BodyId): TypeckResults {
  return unported("rustc_middle::ty::TyCtxt::typeck_body");
}

/** `TyCtxt::provided_trait_methods` (ty/mod.rs:1582). */
export function TyCtxt_provided_trait_methods(_tcx: TyCtxt, _id: DefId): Iterable<AssocItem> {
  return unported("rustc_middle::ty::TyCtxt::provided_trait_methods");
}

/** `TyCtxt::repr_options_of_def` (ty/mod.rs:1588). */
export function TyCtxt_repr_options_of_def(_tcx: TyCtxt, _did: LocalDefId): ReprOptions {
  return unported("rustc_middle::ty::TyCtxt::repr_options_of_def");
}

/** `TyCtxt::opt_item_ident` (ty/mod.rs:1720). */
export function TyCtxt_opt_item_ident(_tcx: TyCtxt, _def_id: IntoQueryKey<DefId>): Ident | undefined {
  return unported("rustc_middle::ty::TyCtxt::opt_item_ident");
}

/** `TyCtxt::item_ident` (ty/mod.rs:1732). */
export function TyCtxt_item_ident(_tcx: TyCtxt, _def_id: IntoQueryKey<DefId>): Ident {
  return unported("rustc_middle::ty::TyCtxt::item_ident");
}

/** `TyCtxt::opt_associated_item` (ty/mod.rs:1739). */
export function TyCtxt_opt_associated_item(_tcx: TyCtxt, _def_id: DefId): AssocItem | undefined {
  return unported("rustc_middle::ty::TyCtxt::opt_associated_item");
}

/** `TyCtxt::opt_rpitit_info` (ty/mod.rs:1750). */
export function TyCtxt_opt_rpitit_info(_tcx: TyCtxt, _def_id: DefId): ImplTraitInTraitData | undefined {
  return unported("rustc_middle::ty::TyCtxt::opt_rpitit_info");
}

/** `TyCtxt::find_field_index` (ty/mod.rs:1761). */
export function TyCtxt_find_field_index(_tcx: TyCtxt, _ident: Ident, _variant: VariantDef): FieldIdx | undefined {
  return unported("rustc_middle::ty::TyCtxt::find_field_index");
}

/** `TyCtxt::impls_are_allowed_to_overlap` (ty/mod.rs:1770). */
export function TyCtxt_impls_are_allowed_to_overlap(_tcx: TyCtxt, _def_id1: DefId, _def_id2: DefId): ImplOverlapKind | undefined {
  return unported("rustc_middle::ty::TyCtxt::impls_are_allowed_to_overlap");
}

/** `TyCtxt::expect_variant_res` (ty/mod.rs:1809). */
export function TyCtxt_expect_variant_res(_tcx: TyCtxt, _res: Res): VariantDef {
  return unported("rustc_middle::ty::TyCtxt::expect_variant_res");
}

/** `TyCtxt::instance_mir` (ty/mod.rs:1831). */
export function TyCtxt_instance_mir(_tcx: TyCtxt, _instance: InstanceKind): Body {
  return unported("rustc_middle::ty::TyCtxt::instance_mir");
}

/** `TyCtxt::get_attrs` (ty/mod.rs:1874). */
export function TyCtxt_get_attrs(_tcx: TyCtxt, _did: DefId, _attr: Symbol): Iterable<Attribute> {
  return unported("rustc_middle::ty::TyCtxt::get_attrs");
}

/** `TyCtxt::get_all_attrs` (ty/mod.rs:1893). */
export function TyCtxt_get_all_attrs(_tcx: TyCtxt, _did: DefId): readonly Attribute[] {
  return unported("rustc_middle::ty::TyCtxt::get_all_attrs");
}

/** `TyCtxt::get_attrs_by_path` (ty/mod.rs:1902). */
export function TyCtxt_get_attrs_by_path(_tcx: TyCtxt, _did: DefId, _attr: readonly Symbol[]): Iterable<Attribute> {
  return unported("rustc_middle::ty::TyCtxt::get_attrs_by_path");
}

/** `TyCtxt::trait_is_auto` (ty/mod.rs:1916). */
export function TyCtxt_trait_is_auto(_tcx: TyCtxt, _trait_def_id: DefId): boolean {
  return unported("rustc_middle::ty::TyCtxt::trait_is_auto");
}

/** `TyCtxt::trait_is_coinductive` (ty/mod.rs:1922). */
export function TyCtxt_trait_is_coinductive(_tcx: TyCtxt, _trait_def_id: DefId): boolean {
  return unported("rustc_middle::ty::TyCtxt::trait_is_coinductive");
}

/** `TyCtxt::trait_is_alias` (ty/mod.rs:1927). */
export function TyCtxt_trait_is_alias(_tcx: TyCtxt, _trait_def_id: DefId): boolean {
  return unported("rustc_middle::ty::TyCtxt::trait_is_alias");
}

/** `TyCtxt::layout_error` (ty/mod.rs:1932). */
export function TyCtxt_layout_error(_tcx: TyCtxt, _err: LayoutError): LayoutError {
  return unported("rustc_middle::ty::TyCtxt::layout_error");
}

/** `TyCtxt::ordinary_coroutine_layout` (ty/mod.rs:1941). */
export function TyCtxt_ordinary_coroutine_layout(_tcx: TyCtxt, _def_id: DefId, _args: GenericArgs): Result<CoroutineLayout, LayoutError> {
  return unported("rustc_middle::ty::TyCtxt::ordinary_coroutine_layout");
}

/** `TyCtxt::async_drop_coroutine_layout` (ty/mod.rs:1982). */
export function TyCtxt_async_drop_coroutine_layout(_tcx: TyCtxt, _def_id: DefId, _args: GenericArgs): Result<CoroutineLayout, LayoutError> {
  return unported("rustc_middle::ty::TyCtxt::async_drop_coroutine_layout");
}

/** `TyCtxt::coroutine_layout` (ty/mod.rs:1999). */
export function TyCtxt_coroutine_layout(_tcx: TyCtxt, _def_id: DefId, _args: GenericArgs): Result<CoroutineLayout, LayoutError> {
  return unported("rustc_middle::ty::TyCtxt::coroutine_layout");
}

/** `TyCtxt::assoc_parent` (ty/mod.rs:2034). */
export function TyCtxt_assoc_parent(_tcx: TyCtxt, _def_id: DefId): [DefId, DefKind] | undefined {
  return unported("rustc_middle::ty::TyCtxt::assoc_parent");
}

/** `TyCtxt::trait_item_of` (ty/mod.rs:2044). */
export function TyCtxt_trait_item_of(_tcx: TyCtxt, _def_id: IntoQueryKey<DefId>): DefId | undefined {
  return unported("rustc_middle::ty::TyCtxt::trait_item_of");
}

/** `TyCtxt::trait_of_assoc` (ty/mod.rs:2051). */
export function TyCtxt_trait_of_assoc(_tcx: TyCtxt, _def_id: DefId): DefId | undefined {
  return unported("rustc_middle::ty::TyCtxt::trait_of_assoc");
}

/** `TyCtxt::impl_is_of_trait` (ty/mod.rs:2058). */
export function TyCtxt_impl_is_of_trait(_tcx: TyCtxt, _def_id: IntoQueryKey<DefId>): boolean {
  return unported("rustc_middle::ty::TyCtxt::impl_is_of_trait");
}

/** `TyCtxt::impl_of_assoc` (ty/mod.rs:2068). */
export function TyCtxt_impl_of_assoc(_tcx: TyCtxt, _def_id: DefId): DefId | undefined {
  return unported("rustc_middle::ty::TyCtxt::impl_of_assoc");
}

/** `TyCtxt::inherent_impl_of_assoc` (ty/mod.rs:2077). */
export function TyCtxt_inherent_impl_of_assoc(_tcx: TyCtxt, _def_id: DefId): DefId | undefined {
  return unported("rustc_middle::ty::TyCtxt::inherent_impl_of_assoc");
}

/** `TyCtxt::trait_impl_of_assoc` (ty/mod.rs:2086). */
export function TyCtxt_trait_impl_of_assoc(_tcx: TyCtxt, _def_id: DefId): DefId | undefined {
  return unported("rustc_middle::ty::TyCtxt::trait_impl_of_assoc");
}

/** `TyCtxt::impl_polarity` (ty/mod.rs:2093). */
export function TyCtxt_impl_polarity(_tcx: TyCtxt, _def_id: IntoQueryKey<DefId>): ImplPolarity {
  return unported("rustc_middle::ty::TyCtxt::impl_polarity");
}

/** `TyCtxt::impl_trait_ref` (ty/mod.rs:2099). */
export function TyCtxt_impl_trait_ref(_tcx: TyCtxt, _def_id: IntoQueryKey<DefId>): EarlyBinder<TraitRef> {
  return unported("rustc_middle::ty::TyCtxt::impl_trait_ref");
}

/** `TyCtxt::impl_opt_trait_ref` (ty/mod.rs:2109). */
export function TyCtxt_impl_opt_trait_ref(_tcx: TyCtxt, _def_id: IntoQueryKey<DefId>): EarlyBinder<TraitRef> | undefined {
  return unported("rustc_middle::ty::TyCtxt::impl_opt_trait_ref");
}

/** `TyCtxt::impl_trait_id` (ty/mod.rs:2118). */
export function TyCtxt_impl_trait_id(_tcx: TyCtxt, _def_id: IntoQueryKey<DefId>): DefId {
  return unported("rustc_middle::ty::TyCtxt::impl_trait_id");
}

/** `TyCtxt::impl_opt_trait_id` (ty/mod.rs:2125). */
export function TyCtxt_impl_opt_trait_id(_tcx: TyCtxt, _def_id: IntoQueryKey<DefId>): DefId | undefined {
  return unported("rustc_middle::ty::TyCtxt::impl_opt_trait_id");
}

/** `TyCtxt::is_exportable` (ty/mod.rs:2130). */
export function TyCtxt_is_exportable(_tcx: TyCtxt, _def_id: DefId): boolean {
  return unported("rustc_middle::ty::TyCtxt::is_exportable");
}

/** `TyCtxt::is_builtin_derived` (ty/mod.rs:2136). */
export function TyCtxt_is_builtin_derived(_tcx: TyCtxt, _def_id: DefId): boolean {
  return unported("rustc_middle::ty::TyCtxt::is_builtin_derived");
}

/** `TyCtxt::is_automatically_derived` (ty/mod.rs:2150). */
export function TyCtxt_is_automatically_derived(_tcx: TyCtxt, _def_id: DefId): boolean {
  return unported("rustc_middle::ty::TyCtxt::is_automatically_derived");
}

/** `TyCtxt::span_of_impl` (ty/mod.rs:2156). */
export function TyCtxt_span_of_impl(_tcx: TyCtxt, _impl_def_id: DefId): Result<Span, Symbol> {
  return unported("rustc_middle::ty::TyCtxt::span_of_impl");
}

/** `TyCtxt::hygienic_eq` (ty/mod.rs:2167). */
export function TyCtxt_hygienic_eq(_tcx: TyCtxt, _use_ident: Ident, _def_ident: Ident, _def_parent_def_id: DefId): boolean {
  return unported("rustc_middle::ty::TyCtxt::hygienic_eq");
}

/** `TyCtxt::adjust_ident` (ty/mod.rs:2178). */
export function TyCtxt_adjust_ident(_tcx: TyCtxt, _ident: Ident, _scope: DefId): Ident {
  return unported("rustc_middle::ty::TyCtxt::adjust_ident");
}

/** `TyCtxt::adjust_ident_and_get_scope` (ty/mod.rs:2183). */
export function TyCtxt_adjust_ident_and_get_scope(_tcx: TyCtxt, _ident: Ident, _scope: DefId, _mod_id: LocalModId): [Ident, ModId] {
  return unported("rustc_middle::ty::TyCtxt::adjust_ident_and_get_scope");
}

/** `TyCtxt::is_const_fn` (ty/mod.rs:2201). */
export function TyCtxt_is_const_fn(_tcx: TyCtxt, _def_id: IntoQueryKey<DefId>): boolean {
  return unported("rustc_middle::ty::TyCtxt::is_const_fn");
}

/** `TyCtxt::is_conditionally_const` (ty/mod.rs:2215). */
export function TyCtxt_is_conditionally_const(_tcx: TyCtxt, _def_id: DefId): boolean {
  return unported("rustc_middle::ty::TyCtxt::is_conditionally_const");
}

/** `TyCtxt::is_const_trait` (ty/mod.rs:2298). */
export function TyCtxt_is_const_trait(_tcx: TyCtxt, _def_id: DefId): boolean {
  return unported("rustc_middle::ty::TyCtxt::is_const_trait");
}

/** `TyCtxt::impl_method_has_trait_impl_trait_tys` (ty/mod.rs:2302). */
export function TyCtxt_impl_method_has_trait_impl_trait_tys(_tcx: TyCtxt, _def_id: DefId): boolean {
  return unported("rustc_middle::ty::TyCtxt::impl_method_has_trait_impl_trait_tys");
}

/** `TyCtxt::fn_abi_of_instance` (ty/mod.rs:2333). */
export function TyCtxt_fn_abi_of_instance(_tcx: TyCtxt, _query: PseudoCanonicalInput<[Instance, List<Ty>]>): Result<FnAbi<Ty>, FnAbiError> {
  return unported("rustc_middle::ty::TyCtxt::fn_abi_of_instance");
}
