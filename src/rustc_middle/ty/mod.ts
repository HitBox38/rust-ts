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
import type { Ident, Symbol } from "../../rustc_span/symbol.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { DefKind, Res } from "../../rustc_hir/def.ts";
import { type Debug, debug_list, debug_tuple, type Fmt, PLAIN } from "../../std/fmt.ts";
import { panic } from "../../std/panic.ts";
import { Interned } from "../../rustc_data_structures/intern.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import type { DebruijnIndex, TermKind, TyKind, TypeFlags } from "../../rustc_type_ir/decls.ts";
import type { FallibleTypeFolder, TypeFoldable, TypeFolder } from "../../rustc_type_ir/fold.ts";
import type { TypeVisitor } from "../../rustc_type_ir/visit.ts";
import { Const } from "../../rustc_type_ir/sty/mod.ts";
import { unported } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import { type IntoQueryKey, into_query_key_DefId } from "../query/into_query_key.ts";
import type { TyCtxt } from "./context.ts";
import type { AssocItem, Attribute, Body, BodyId, CoroutineLayout, FieldIdx, FnAbi, FnAbiError, Instance, ParamEnv, InstanceKind, LayoutError, ReprOptions, TypeckResults } from "./decls.ts";
import type { EarlyBinder, ImplPolarity, TraitRef } from "../../rustc_type_ir/decls.ts";
import type { GenericArg, GenericArgs } from "./generic_args.ts";
import type { List } from "./list.ts";
// ty-mod-b imports
import type { AdtDef, ImplOverlapKind as ImplOverlapKind_pending, ImplTraitInTraitData as ImplTraitInTraitData_pending, PseudoCanonicalInput as PseudoCanonicalInput_pending, VariantDef as VariantDef_pending, VariantIdx } from "./decls.ts";
import type { AssocItems } from "./assoc.ts";
import { type Attribute as AttrIrAttribute, AttributeExt, find_attr, type HasAttrs } from "../../rustc_attr_ir/lib.ts";
import * as hir_def from "../../rustc_hir/def.ts";
import { type CtorKind, debug_CtorKind, debug_Res } from "../../rustc_hir/def.ts";
import { type Constness, Defaultness, type Defaultness as hir_Defaultness, type OpaqueTyOrigin, Safety as hir_Safety, debug_Safety } from "../../rustc_hir/lib.ts";
import { debug_HirId, type HirId, type OwnerId } from "../../rustc_hir_id/lib.ts";
import { DefId_eq, DefId_key, debug_LocalDefId } from "../../rustc_span/def_id.ts";
import { Ident as Ident_ } from "../../rustc_span/symbol.ts";
import { debug_Symbol } from "../../rustc_span/symbol.ts";
import { debug_ErrorGuaranteed, type ErrorGuaranteed, Span as Span_ } from "../../rustc_span/lib.ts";
import { SyntaxContext } from "../../rustc_span/hygiene.ts";
import { debug_bool, debug_map, debug_option, debug_struct } from "../../std/fmt.ts";
import { assert, unreachable } from "../../std/panic.ts";
import { Err, Ok } from "../../std/result.ts";
import { field_mut } from "../../std/mut_ref.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { flags_companion } from "../../vendor/bitflags/traits.ts";
import { to_writer } from "../../vendor/bitflags/parser.ts";
import type { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import type { TypingMode, TypingModeEqWrapper } from "../../rustc_type_ir/infer_ctxt.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import type { SimplifiedType } from "../../rustc_type_ir/fast_reject.ts";
import type { TypeVisitable } from "../../rustc_type_ir/visit.ts";
import type { PendingEnum } from "../../rustc_type_ir/decls.ts";
import { debug_Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Providers } from "../queries.gen.ts";

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
export function debug_Term(_v: Term, _f: Fmt): string {
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

// ---- tools/codegen's view of the traversal / Debug impls (merge-w13) ----
// PORT: generated code calls `visit_with_<T>` / `try_fold_with_<T>` / `fold_with_<T>` free fns and `debug_<T>`
// (tools/codegen type_fold.json / tyir.typemap.json). For `Term` they are the methods of the D4 descriptor above;
// `Ty`'s impls (structural_impls.rs) are stubs until lane ty-print / tyir-binder ports them (then: a D4 descriptor
// `fold_Ty`, which these wrap). `I::FnInputTys` = `&[Ty]` (rustc_type_ir/interner.ts header).
export type FnInputTys = readonly Ty[];

export function visit_with_Term<R>(self: Term, visitor: TypeVisitor<R>): R {
  return fold_Term.visit_with(self, visitor);
}
export function try_fold_with_Term<E>(self: Term, folder: FallibleTypeFolder<E>): Result<Term, E> {
  return fold_Term.try_fold_with(self, folder);
}
export function fold_with_Term(self: Term, folder: TypeFolder): Term {
  return fold_Term.fold_with(self, folder);
}

/** Stub: `impl fmt::Debug for Ty` (structural_impls.rs:82). */
export function debug_Ty(_v: Ty, _f: Fmt): string {
  return unported("rustc_middle::ty::Ty: Debug (structural_impls.rs:82)");
}
/** Stub: `impl TypeVisitable for Ty` (structural_impls.rs:324). */
export function visit_with_Ty<R>(_self: Ty, _visitor: TypeVisitor<R>): R {
  return unported("rustc_middle::ty::Ty: TypeVisitable::visit_with (structural_impls.rs:324)");
}
/** Stub: `impl TypeFoldable for Ty` (structural_impls.rs:311). */
export function try_fold_with_Ty<E>(_self: Ty, _folder: FallibleTypeFolder<E>): Result<Ty, E> {
  return unported("rustc_middle::ty::Ty: TypeFoldable::try_fold_with (structural_impls.rs:311)");
}
export function fold_with_Ty(_self: Ty, _folder: TypeFolder): Ty {
  return unported("rustc_middle::ty::Ty: TypeFoldable::fold_with (structural_impls.rs:311)");
}
/** `Debug for &[Ty]`: the slice's Debug. */
export function debug_FnInputTys(v: FnInputTys, f: Fmt): string {
  return debug_list(f, v.map((x) => debug_Ty(x, f)));
}

/** Stub: `#[derive(TypeVisitable)]` of `ParamEnv` (mod.rs:1018; not generated yet: ParamEnv is pending). */
export function visit_with_ParamEnv<R>(_self: ParamEnv, _visitor: TypeVisitor<R>): R {
  return unported("rustc_middle::ty::ParamEnv: TypeVisitable::visit_with (mod.rs:1018 derive)");
}
/** Stub: `#[derive(TypeFoldable)]` of `ParamEnv` (mod.rs:1018). */
export function try_fold_with_ParamEnv<E>(_self: ParamEnv, _folder: FallibleTypeFolder<E>): Result<ParamEnv, E> {
  return unported("rustc_middle::ty::ParamEnv: TypeFoldable::try_fold_with (mod.rs:1018 derive)");
}
export function fold_with_ParamEnv(_self: ParamEnv, _folder: TypeFolder): ParamEnv {
  return unported("rustc_middle::ty::ParamEnv: TypeFoldable::fold_with (mod.rs:1018 derive)");
}

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

// ==== lane ty-mod-b: ty/mod.rs:1102 .. end (TypingEnv onward) ==================================================
// PORT(decls): pending root. ty/decls.ts still aliases `VariantDef`, `ImplOverlapKind`, `ImplTraitInTraitData`,
// `PseudoCanonicalInput`, `TypingEnv`, `Destructor`, `AsyncDestructor` and `Attribute` (= rustc_attr_ir's) to
// `Pending<..>`; the `TyCtxt` methods in context.ts are typed with those aliases, so the `TyCtxt_<name>` fns below
// keep them at that boundary (`*_pending`) and convert with `from_pending` / `to_pending`. Once decls.ts re-exports
// the real types from this file, both helpers are identities and can go.
function from_pending<T>(v: unknown): T {
  return v as T;
}
function to_pending<P>(v: unknown): P {
  return v as P;
}

/// The environment in which to do trait solving.
///
/// Most of the time you only need to care about the `ParamEnv`
/// as the `TypingMode` is simply stored in the `InferCtxt`.
///
/// However, there are some places which rely on trait solving
/// without using an `InferCtxt` themselves. For these to be
/// able to use the trait system they have to be able to initialize
/// such an `InferCtxt` with the right `typing_mode`, so they need
/// to track both.
// rustc-type: compiler/rustc_middle/src/ty/mod.rs:1105 TypingEnv
// PORT: the struct (mod.rs:1102) is defined here with its `impl` (lane ty-mod-b). Its field `typing_mode` is
// `typing_mode_`: the method `typing_mode()` takes the name (like `Ty.flags_`). `#[type_foldable(identity)]` /
// `#[type_visitable(ignore)]` on it are for the derives (tools/codegen).
export class TypingEnv {
  constructor(
    readonly typing_mode_: TypingModeEqWrapper,
    readonly param_env: ParamEnv,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/mod.rs:1113 new
  static new(param_env: ParamEnv, typing_mode: TypingMode): TypingEnv {
    return new TypingEnv({ _0: typing_mode }, param_env);
  }

  // rustc: compiler/rustc_middle/src/ty/mod.rs:1117 typing_mode
  typing_mode(): TypingMode {
    return this.typing_mode_._0;
  }

  /// Create a typing environment with no where-clauses in scope
  /// where all opaque types and default associated items are revealed.
  ///
  /// This is only suitable for monomorphized, post-typeck environments.
  /// Do not use this for MIR optimizations, as even though they also
  /// use `TypingMode::PostAnalysis`, they may still have where-clauses
  /// in scope.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1128 fully_monomorphized
  static fully_monomorphized(): TypingEnv {
    return TypingEnv.new(ParamEnv_empty(), infer_ctxt().TypingMode.Codegen);
  }

  /// Create a typing environment for use during analysis outside of a body.
  ///
  /// Using a typing environment inside of bodies is not supported as the body
  /// may define opaque types. In this case the used functions have to be
  /// converted to use proper canonical inputs instead.
  // PORT: the `param_env` query value is `unknown` in queries.gen.ts (ParamEnv pending).
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1137 non_body_analysis
  static non_body_analysis(tcx: TyCtxt, def_id_: IntoQueryKey<DefIdT>): TypingEnv {
    const def_id = into_query_key_DefId(def_id_);
    return TypingEnv.new(tcx.param_env(def_id) as ParamEnv, infer_ctxt().TypingMode.non_body_analysis());
  }

  /// The `TypingEnv` which should be for everything happens after HIR typeck
  /// up-to and including borrowck itself.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1147 post_typeck_until_borrowck
  static post_typeck_until_borrowck(tcx: TyCtxt, def_id: LocalDefId): TypingEnv {
    const param_env = tcx.param_env(into_query_key_DefId(def_id)) as ParamEnv;
    return TypingEnv.new(param_env, infer_ctxt().TypingMode.borrowck(as_interner_(tcx), def_id));
  }

  /// Ideally we just use `TypingMode::post_typeck_until_borrowck`.
  /// But that's not compatible with the old solver yet.
  ///
  /// FIXME: this should not be needed in the long term.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1156 post_typeck_until_borrowck_for_mir_build
  static post_typeck_until_borrowck_for_mir_build(tcx: TyCtxt, def_id: LocalDefId): TypingEnv {
    if (tcx.use_typing_mode_post_typeck_until_borrowck()) {
      return TypingEnv.new(tcx.param_env(into_query_key_DefId(def_id)) as ParamEnv, infer_ctxt().TypingMode.borrowck(as_interner_(tcx), def_id));
    } else {
      // FIXME(#132279): We're in a body, we should use a typing
      // mode which reveals the opaque types defined by that body.
      return TypingEnv.non_body_analysis(tcx, def_id);
    }
  }

  // rustc: compiler/rustc_middle/src/ty/mod.rs:1169 post_analysis
  static post_analysis(tcx: TyCtxt, def_id: IntoQueryKey<DefIdT>): TypingEnv {
    return TypingEnv.new(tcx.param_env_normalized_for_post_analysis(def_id) as ParamEnv, infer_ctxt().TypingMode.PostAnalysis);
  }

  // rustc: compiler/rustc_middle/src/ty/mod.rs:1173 codegen
  static codegen(tcx: TyCtxt, def_id: IntoQueryKey<DefIdT>): TypingEnv {
    return TypingEnv.new(tcx.param_env_normalized_for_post_analysis(def_id) as ParamEnv, infer_ctxt().TypingMode.Codegen);
  }

  /// Modify the `typing_mode` to `PostAnalysis` or `Codegen` and eagerly reveal all opaque types
  /// in the `param_env`.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1179 with_post_analysis_normalized
  with_post_analysis_normalized(tcx: TyCtxt): TypingEnv {
    const { typing_mode_: typing_mode, param_env } = this;
    const m = infer_ctxt().TypingMode.assert_not_erased(typing_mode._0);
    switch (m.$) {
      case "Coherence":
      case "Reflection":
      case "Typeck":
      case "PostTypeckUntilBorrowck":
      case "PostBorrowck":
        break;
      case "PostAnalysis":
      case "Codegen":
        return this;
      // PORT: `TypingMode<CantBeErased>` has no `ErasedNotCoherence` value (`CantBeErased` is uninhabited).
      case "ErasedNotCoherence":
        return unreachable("TypingMode<CantBeErased>::ErasedNotCoherence");
    }

    const param_env_ = ParamEnv_with_normalized(param_env, tcx);
    return TypingEnv.new(param_env_, infer_ctxt().TypingMode.PostAnalysis);
  }

  /// Modify the `typing_mode` to `PostAnalysis` or `Codegen` and eagerly reveal all opaque types
  /// in the `param_env`.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1196 with_codegen_normalized
  with_codegen_normalized(tcx: TyCtxt): TypingEnv {
    const { typing_mode_: typing_mode, param_env } = this;
    const m = infer_ctxt().TypingMode.assert_not_erased(typing_mode._0);
    switch (m.$) {
      case "Coherence":
      case "Reflection":
      case "Typeck":
      case "PostTypeckUntilBorrowck":
      case "PostBorrowck":
      case "PostAnalysis":
        break;
      case "Codegen":
        return this;
      // PORT: `TypingMode<CantBeErased>` has no `ErasedNotCoherence` value (`CantBeErased` is uninhabited).
      case "ErasedNotCoherence":
        return unreachable("TypingMode<CantBeErased>::ErasedNotCoherence");
    }

    const param_env_ = ParamEnv_with_normalized(param_env, tcx);
    return TypingEnv.new(param_env_, infer_ctxt().TypingMode.Codegen);
  }

  /// Combine this typing environment with the given `value` to be used by
  /// not (yet) canonicalized queries. This only works if the value does not
  /// contain anything local to some `InferCtxt`, i.e. inference variables or
  /// placeholders.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1216 as_query_input
  as_query_input<T>(value: T): PseudoCanonicalInput<T> {
    // FIXME(#132279): We should assert that the value does not contain any placeholders
    // as these placeholders are also local to the current inference context. However, we
    // currently use pseudo-canonical queries in the trait solver, which replaces params
    // with placeholders during canonicalization. We should also simply not use pseudo-
    // canonical queries in the trait solver, at which point we can readd this assert.
    //
    // As of writing this comment, this is only used when normalizing consts that mention
    // params.
    /* debug_assert!(
        !value.has_placeholders(),
        "{value:?} which has placeholder shouldn't be pseudo-canonicalized"
    ); */
    return { typing_env: this, value };
  }
}

/** `#[derive(Debug)]` of `TypingEnv` (field `typing_mode`: see the class comment). */
export const debug_TypingEnv: Debug<TypingEnv> = (v, f) =>
  debug_struct(f, "TypingEnv", [
    ["typing_mode", infer_ctxt().debug_TypingModeEqWrapper(v.typing_mode_, f)],
    ["param_env", debug_ParamEnv_(v.param_env, f)],
  ]);

/// Similar to `CanonicalInput`, this carries the `typing_mode` and the environment
/// necessary to do any kind of trait solving inside of nested queries.
///
/// Unlike proper canonicalization, this requires the `param_env` and the `value` to not
/// contain anything local to the `infcx` of the caller, so we don't actually canonicalize
/// anything.
///
/// This should be created by using `infcx.pseudo_canonicalize_query(param_env, value)`
/// or by using `typing_env.as_query_input(value)`.
// rustc-type: compiler/rustc_middle/src/ty/mod.rs:1247 PseudoCanonicalInput
export interface PseudoCanonicalInput<T> {
  typing_env: TypingEnv;
  value: T;
}
/** `#[derive(Debug)]` */
export function debug_PseudoCanonicalInput<T>(v: PseudoCanonicalInput<T>, f: Fmt, debug_T: Debug<T>): string {
  return debug_struct(f, "PseudoCanonicalInput", [
    ["typing_env", debug_TypingEnv(v.typing_env, f)],
    ["value", debug_T(v.value, f)],
  ]);
}

// rustc-type: compiler/rustc_middle/src/ty/mod.rs:1253 Destructor
export interface Destructor {
  /// The `DefId` of the destructor method
  did: DefIdT;
}
/** `#[derive(Debug)]` */
export const debug_Destructor: Debug<Destructor> = (v, f) => debug_struct(f, "Destructor", [["did", debug_DefId(v.did, f)]]);

// FIXME: consider combining this definition with regular `Destructor`
// rustc-type: compiler/rustc_middle/src/ty/mod.rs:1260 AsyncDestructor
export interface AsyncDestructor {
  /// The `DefId` of the `impl AsyncDrop`
  impl_did: DefIdT;
}
/** `#[derive(Debug)]` */
export const debug_AsyncDestructor: Debug<AsyncDestructor> = (v, f) =>
  debug_struct(f, "AsyncDestructor", [["impl_did", debug_DefId(v.impl_did, f)]]);

// rustc-type: compiler/rustc_middle/src/ty/mod.rs:1266 VariantFlags
// PORT: `struct VariantFlags(u8)` + `bitflags!` -> branded number; flags + `Flags` API on the companion
// (the shape tools/codegen emits for `bitflags!`).
export type VariantFlags = number & { readonly __brand: "VariantFlags" };
export const VariantFlags = flags_companion<VariantFlags, {
  NO_VARIANT_FLAGS: VariantFlags;
  /// Indicates whether the field list of this variant is `#[non_exhaustive]`.
  IS_FIELD_LIST_NON_EXHAUSTIVE: VariantFlags;
}>(
  8,
  {
    NO_VARIANT_FLAGS: 0 as VariantFlags,
    IS_FIELD_LIST_NON_EXHAUSTIVE: (1 << 0) as VariantFlags,
  },
  [["NO_VARIANT_FLAGS", 0 as VariantFlags], ["IS_FIELD_LIST_NON_EXHAUSTIVE", (1 << 0) as VariantFlags]],
);
// rustc_data_structures::external_bitflags_debug! { VariantFlags }
// PORT: the macro expands to `impl Debug for VariantFlags { fn fmt(..) { bitflags::parser::to_writer(self, f) } }`
// (compiler/rustc_data_structures/src/lib.rs:147), as for `SanitizerSet`.
export const debug_VariantFlags: Debug<VariantFlags> = (v, _f) => to_writer(VariantFlags.FLAGS_DESC, v);

/// Definition of a variant -- a struct's fields or an enum variant.
// rustc-type: compiler/rustc_middle/src/ty/mod.rs:1278 VariantDef
export class VariantDef {
  constructor(
    /// `DefId` that identifies the variant itself.
    /// If this variant belongs to a struct or union, then this is a copy of its `DefId`.
    readonly def_id: DefIdT,
    /// `DefId` that identifies the variant's constructor.
    /// If this variant is a struct variant, then this is `None`.
    readonly ctor: [CtorKind, DefIdT] | undefined,
    /// Variant or struct name.
    readonly name: Symbol,
    /// Discriminant of this variant.
    readonly discr: VariantDiscr,
    /// Fields of this variant.
    readonly fields: readonly FieldDef[],
    /// The error guarantees from parser, if any.
    readonly tainted: ErrorGuaranteed | undefined,
    /// Flags of the variant (e.g. is field list non-exhaustive)?
    readonly flags: VariantFlags,
  ) {}

  /// Creates a new `VariantDef`.
  ///
  /// `variant_did` is the `DefId` that identifies the enum variant (if this `VariantDef`
  /// represents an enum variant).
  ///
  /// `ctor_did` is the `DefId` that identifies the constructor of unit or
  /// tuple-variants/structs. If this is a `struct`-variant then this should be `None`.
  ///
  /// `parent_did` is the `DefId` of the `AdtDef` representing the enum or struct that
  /// owns this variant. It is used for checking if a struct has `#[non_exhaustive]` w/out having
  /// to go through the redirect of checking the ctor's attributes - but compiling a small crate
  /// requires loading the `AdtDef`s for all the structs in the universe (e.g., coherence for any
  /// built-in trait), and we do not want to load attributes twice.
  ///
  /// If someone speeds up attribute loading to not be a performance concern, they can
  /// remove this hack and use the constructor `DefId` everywhere.
  // PORT: `#[instrument(level = "debug")]` (tracing) is dropped.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1315 new
  static new(
    name: Symbol,
    variant_did: DefIdT | undefined,
    ctor: [CtorKind, DefIdT] | undefined,
    discr: VariantDiscr,
    fields: readonly FieldDef[],
    parent_did: DefIdT,
    recover_tainted: ErrorGuaranteed | undefined,
    is_field_list_non_exhaustive: boolean,
  ): VariantDef {
    let flags = VariantFlags.NO_VARIANT_FLAGS;
    if (is_field_list_non_exhaustive) {
      flags = VariantFlags.union(flags, VariantFlags.IS_FIELD_LIST_NON_EXHAUSTIVE);
    }

    return new VariantDef(variant_did ?? parent_did, ctor, name, discr, fields, recover_tainted, flags);
  }

  /// Returns `true` if the field list of this variant is `#[non_exhaustive]`.
  ///
  /// Note that this function will return `true` even if the type has been
  /// defined in the crate currently being compiled. If that's not what you
  /// want, see [`Self::field_list_has_applicable_non_exhaustive`].
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1347 is_field_list_non_exhaustive
  is_field_list_non_exhaustive(): boolean {
    return VariantFlags.intersects(this.flags, VariantFlags.IS_FIELD_LIST_NON_EXHAUSTIVE);
  }

  /// Returns `true` if the field list of this variant is `#[non_exhaustive]`
  /// and the type has been defined in another crate.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1354 field_list_has_applicable_non_exhaustive
  field_list_has_applicable_non_exhaustive(): boolean {
    return this.is_field_list_non_exhaustive() && !this.def_id.is_local();
  }

  /// Computes the `Ident` of this variant by looking up the `Span`
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1359 ident
  ident(tcx: TyCtxt): Ident {
    return Ident_.new(this.name, unwrap(tcx.def_ident_span(this.def_id)));
  }

  /// Was this variant obtained as part of recovering from a syntactic error?
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1365 has_errors
  has_errors(): Result<null, ErrorGuaranteed> {
    return this.tainted === undefined ? Ok(null) : Err(this.tainted);
  }

  // rustc: compiler/rustc_middle/src/ty/mod.rs:1370 ctor_kind
  ctor_kind(): CtorKind | undefined {
    return this.ctor === undefined ? undefined : this.ctor[0];
  }

  // rustc: compiler/rustc_middle/src/ty/mod.rs:1375 ctor_def_id
  ctor_def_id(): DefIdT | undefined {
    return this.ctor === undefined ? undefined : this.ctor[1];
  }

  /// Returns the one field in this variant.
  ///
  /// `panic!`s if there are no fields or multiple fields.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1383 single_field
  single_field(): FieldDef {
    assert(this.fields.length === 1, "assertion failed: self.fields.len() == 1");

    return this.fields[0 /* FieldIdx::ZERO */]!;
  }

  /// Returns the last field in this variant, if present.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1391 tail_opt
  tail_opt(): FieldDef | undefined {
    return this.fields[this.fields.length - 1];
  }

  /// Returns the last field in this variant.
  ///
  /// # Panics
  ///
  /// Panics, if the variant has no fields.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1401 tail
  tail(): FieldDef {
    return expect(this.tail_opt(), "expected unsized ADT to have a tail field");
  }

  /// Returns whether this variant has unsafe fields.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1406 has_unsafe_fields
  has_unsafe_fields(): boolean {
    return this.fields.some((x) => hir_Safety.is_unsafe(x.safety));
  }
}

/** `#[derive(Debug)]` */
export const debug_VariantDef: Debug<VariantDef> = (v, f) =>
  debug_struct(f, "VariantDef", [
    ["def_id", debug_DefId(v.def_id, f)],
    ["ctor", debug_option(v.ctor, f, (c, f) => debug_tuple(f, "", [debug_CtorKind(c[0], f), debug_DefId(c[1], f)]))],
    ["name", debug_Symbol(v.name, f)],
    ["discr", debug_VariantDiscr(v.discr, f)],
    ["fields", debug_list(f, v.fields.map((x) => debug_FieldDef(x, f)))],
    ["tainted", debug_option(v.tainted, f, debug_ErrorGuaranteed)],
    ["flags", debug_VariantFlags(v.flags, f)],
  ]);

// rustc: compiler/rustc_middle/src/ty/mod.rs:1413 eq
export function VariantDef_eq(self: VariantDef, other: VariantDef): boolean {
  // There should be only one `VariantDef` for each `def_id`, therefore
  // it is fine to implement `PartialEq` only based on `def_id`.
  //
  // Below, we exhaustively destructure `self` and `other` so that if the
  // definition of `VariantDef` changes, a compile-error will be produced,
  // reminding us to revisit this assumption.

  const { def_id: lhs_def_id } = self;
  const { def_id: rhs_def_id } = other;

  const res = DefId_eq(lhs_def_id, rhs_def_id);

  // Double check that implicit assumption detailed above.
  // PORT: `if cfg!(debug_assertions) && res { .. assert!(deep, ..) }`: rustc ships without debug assertions.

  return res;
}

// PORT: `Hash` (with the `Eq` above) is the canonical key of PORTING §5 (`KeyedMap` / intern key): the `def_id`'s.
// rustc: compiler/rustc_middle/src/ty/mod.rs:1460 hash
export function key_VariantDef(self: VariantDef): number {
  // There should be only one `VariantDef` for each `def_id`, therefore
  // it is fine to implement `Hash` only based on `def_id`.
  //
  // Below, we exhaustively destructure `self` so that if the definition
  // of `VariantDef` changes, a compile-error will be produced, reminding
  // us to revisit this assumption.

  const { def_id } = self;
  return DefId_key(def_id);
}

// rustc-type: compiler/rustc_middle/src/ty/mod.rs:1474 VariantDiscr
export type VariantDiscr =
  /// Explicit value for this variant, i.e., `X = 123`.
  /// The `DefId` corresponds to the embedded constant.
  | { readonly $: "Explicit"; readonly _0: DefIdT }
  /// The previous variant's discriminant plus one.
  /// For efficiency reasons, the distance from the
  /// last `Explicit` discriminant is being stored,
  /// or `0` for the first variant, if it has none.
  | { readonly $: "Relative"; readonly _0: number };
/** `#[derive(Debug)]` */
export const debug_VariantDiscr: Debug<VariantDiscr> = (v, f) => {
  switch (v.$) {
    case "Explicit":
      return debug_tuple(f, "Explicit", [debug_DefId(v._0, f)]);
    case "Relative":
      return debug_tuple(f, "Relative", [String(v._0)]);
  }
};
/** `#[derive(PartialEq)]` */
export function VariantDiscr_eq(a: VariantDiscr, b: VariantDiscr): boolean {
  if (a.$ === "Explicit" && b.$ === "Explicit") return DefId_eq(a._0, b._0);
  if (a.$ === "Relative" && b.$ === "Relative") return a._0 === b._0;
  return false;
}

// rustc-type: compiler/rustc_middle/src/ty/mod.rs:1487 FieldDef
export class FieldDef {
  constructor(
    readonly did: DefIdT,
    readonly name: Symbol,
    readonly vis: Visibility<ModId>,
    readonly mut_restriction: RestrictionKind_,
    readonly safety: hir_Safety,
    readonly value: DefIdT | undefined,
  ) {}

  /// Returns the type of this field. The `args` are typically obtained via
  /// the second field of [`TyKind::Adt`].
  // PORT: the `type_of` query value is `unknown` in queries.gen.ts; `Ty`'s fold descriptor is the stand-in
  // `fold().standin_fold_Ty` (merge-w15a decision 3).
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1546 ty
  ty(tcx: TyCtxt, args: GenericArgs): Unnormalized<Ty> {
    return binder().EarlyBinder.instantiate(tcx.type_of(this.did) as EarlyBinder<Ty>, tcx, args, fold().standin_fold_Ty);
  }

  /// Computes the `Ident` of this variant by looking up the `Span`
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1555 ident
  ident(tcx: TyCtxt): Ident {
    return Ident_.new(this.name, unwrap(tcx.def_ident_span(this.did)));
  }
}

/** `#[derive(Debug)]` */
export const debug_FieldDef: Debug<FieldDef> = (v, f) =>
  debug_struct(f, "FieldDef", [
    ["did", debug_DefId(v.did, f)],
    ["name", debug_Symbol(v.name, f)],
    ["vis", debug_Visibility(v.vis, f, debug_ModId)],
    ["mut_restriction", debug_RestrictionKind_(v.mut_restriction, f)],
    ["safety", debug_Safety(v.safety, f)],
    ["value", debug_option(v.value, f, debug_DefId)],
  ]);

// rustc: compiler/rustc_middle/src/ty/mod.rs:1498 eq
export function FieldDef_eq(self: FieldDef, other: FieldDef): boolean {
  // There should be only one `FieldDef` for each `did`, therefore it is
  // fine to implement `PartialEq` only based on `did`.
  //
  // Below, we exhaustively destructure `self` so that if the definition
  // of `FieldDef` changes, a compile-error will be produced, reminding
  // us to revisit this assumption.

  const { did: lhs_did } = self;

  const { did: rhs_did } = other;

  const res = DefId_eq(lhs_did, rhs_did);

  // Double check that implicit assumption detailed above.
  // PORT: `if cfg!(debug_assertions) && res { .. assert!(deep, ..) }`: rustc ships without debug assertions.

  return res;
}

// PORT: `Hash` (with the `Eq` above) is the canonical key of PORTING §5 (`KeyedMap` / intern key): the `did`'s.
// rustc: compiler/rustc_middle/src/ty/mod.rs:1529 hash
export function key_FieldDef(self: FieldDef): number {
  // There should be only one `FieldDef` for each `did`, therefore it is
  // fine to implement `Hash` only based on `did`.
  //
  // Below, we exhaustively destructure `self` so that if the definition
  // of `FieldDef` changes, a compile-error will be produced, reminding
  // us to revisit this assumption.

  const { did } = self;

  return DefId_key(did);
}

// rustc-type: compiler/rustc_middle/src/ty/mod.rs:1561 ImplOverlapKind
export type ImplOverlapKind =
  /// These impls are always allowed to overlap.
  {
    readonly $: "Permitted";
    /// Whether or not the impl is permitted due to the trait being a `#[marker]` trait
    readonly marker: boolean;
  };
/** `#[derive(Debug)]` */
export const debug_ImplOverlapKind: Debug<ImplOverlapKind> = (v, f) =>
  debug_struct(f, "Permitted", [["marker", debug_bool(v.marker, f)]]);

/// Useful source information about where a desugared associated type for an
/// RPITIT originated from.
// rustc-type: compiler/rustc_middle/src/ty/mod.rs:1572 ImplTraitInTraitData
export type ImplTraitInTraitData =
  | { readonly $: "Trait"; readonly fn_def_id: DefIdT; readonly opaque_def_id: DefIdT }
  | { readonly $: "Impl"; readonly fn_def_id: DefIdT };
/** `#[derive(Debug)]` */
export const debug_ImplTraitInTraitData: Debug<ImplTraitInTraitData> = (v, f) => {
  switch (v.$) {
    case "Trait":
      return debug_struct(f, "Trait", [
        ["fn_def_id", debug_DefId(v.fn_def_id, f)],
        ["opaque_def_id", debug_DefId(v.opaque_def_id, f)],
      ]);
    case "Impl":
      return debug_struct(f, "Impl", [["fn_def_id", debug_DefId(v.fn_def_id, f)]]);
  }
};

// ---- impl TyCtxt (ty/mod.rs:1577) ----------------------------------------------------------------------------

// PORT: the `typeck` query value is `unknown` in queries.gen.ts; `hir::BodyId` is `Pending` in decls.ts.
// rustc: compiler/rustc_middle/src/ty/mod.rs:1578 typeck_body
export function TyCtxt_typeck_body(tcx: TyCtxt, body: BodyId): TypeckResults {
  return tcx.typeck(tcx.hir_body_owner_def_id(from_pending<hir_BodyId>(body))) as TypeckResults;
}

// PORT: `impl Iterator` is a generator; the `associated_items` query runs when the fn is called (as upstream),
// `in_definition_order` / the filter as it is consumed. The query value is `unknown` in queries.gen.ts.
// rustc: compiler/rustc_middle/src/ty/mod.rs:1582 provided_trait_methods
export function TyCtxt_provided_trait_methods(tcx: TyCtxt, id: DefIdT): Iterable<AssocItem> {
  const items = tcx.associated_items(id) as AssocItems;
  return (function* () {
    for (const item of AssocItems_in_definition_order(items)) {
      if (AssocItem_is_fn(item) && Defaultness.has_value(AssocItem_defaultness(item, tcx))) yield item;
    }
  })();
}

// PORT: rustc_abi's `ReprOptions` / `ReprFlags` / `IntegerType` / `ScalableElt` are not ported (rustc_abi lib.rs),
// and the very first statement builds a `ReprFlags`: the fn stops UNPORTED before any query runs.
// rustc: compiler/rustc_middle/src/ty/mod.rs:1588 repr_options_of_def
export function TyCtxt_repr_options_of_def(_tcx: TyCtxt, _did: LocalDefId): ReprOptions {
  return unported("rustc_middle::ty::TyCtxt::repr_options_of_def (rustc_abi ReprOptions/ReprFlags/IntegerType/ScalableElt)");
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

/// Look up the name and span of a definition.
///
/// See [`item_name`][Self::item_name] for more information.
// rustc: compiler/rustc_middle/src/ty/mod.rs:1720 opt_item_ident
export function TyCtxt_opt_item_ident(tcx: TyCtxt, def_id_: IntoQueryKey<DefIdT>): Ident | undefined {
  const def_id = into_query_key_DefId(def_id_);
  const def = tcx.opt_item_name(def_id);
  if (def === undefined) return undefined;
  const span = tcx.def_ident_span(def_id);
  if (span === undefined) return panic(`missing ident span for ${debug_DefId(def_id, PLAIN)}`);
  return Ident_.new(def, span);
}

/// Look up the name and span of a definition.
///
/// See [`item_name`][Self::item_name] for more information.
// rustc: compiler/rustc_middle/src/ty/mod.rs:1732 item_ident
export function TyCtxt_item_ident(tcx: TyCtxt, def_id_: IntoQueryKey<DefIdT>): Ident {
  const def_id = into_query_key_DefId(def_id_);
  const ident = tcx.opt_item_ident(def_id);
  if (ident !== undefined) return ident;
  return panic(`item_ident: no name for ${debug_DefPath(tcx.def_path(def_id), PLAIN)}`);
}

// PORT: the `associated_item` query value is `unknown` in queries.gen.ts.
// rustc: compiler/rustc_middle/src/ty/mod.rs:1739 opt_associated_item
export function TyCtxt_opt_associated_item(tcx: TyCtxt, def_id: DefIdT): AssocItem | undefined {
  const k = tcx.def_kind(def_id);
  if (k.$ === "AssocConst" || k.$ === "AssocFn" || k.$ === "AssocTy") {
    return tcx.associated_item(def_id) as AssocItem;
  } else {
    return undefined;
  }
}

/// If the `def_id` is an associated type that was desugared from a
/// return-position `impl Trait` from a trait, then provide the source info
/// about where that RPITIT came from.
// PORT: the `associated_item` query value is `unknown` in queries.gen.ts.
// rustc: compiler/rustc_middle/src/ty/mod.rs:1750 opt_rpitit_info
export function TyCtxt_opt_rpitit_info(tcx: TyCtxt, def_id: DefIdT): ImplTraitInTraitData_pending | undefined {
  if (tcx.def_kind(def_id).$ === "AssocTy") {
    const kind = (tcx.associated_item(def_id) as AssocItem).kind;
    if (kind.$ === "Type" && kind.data.$ === "Rpitit") {
      const rpitit_info = kind.data._0;
      return rpitit_info;
    }
  }
  return undefined;
}

// rustc: compiler/rustc_middle/src/ty/mod.rs:1761 find_field_index
export function TyCtxt_find_field_index(tcx: TyCtxt, ident: Ident, variant_: VariantDef_pending): FieldIdx | undefined {
  const variant = from_pending<VariantDef>(variant_);
  for (let i = 0; i < variant.fields.length; i++) {
    const field = variant.fields[i]!;
    if (tcx.hygienic_eq(ident, field.ident(tcx), variant.def_id)) return i as FieldIdx;
  }
  return undefined;
}

/// Returns `Some` if the impls are the same polarity and the trait either
/// has no items or is annotated `#[marker]` and prevents item overrides.
// PORT: `#[instrument(level = "debug", skip(self), ret)]` (tracing) is dropped. The `impl_trait_header` /
// `trait_def` query values are `unknown` in queries.gen.ts (read through `ImplTraitHeaderFields` / `TraitDefFields`).
// rustc: compiler/rustc_middle/src/ty/mod.rs:1770 impls_are_allowed_to_overlap
export function TyCtxt_impls_are_allowed_to_overlap(tcx: TyCtxt, def_id1: DefIdT, def_id2: DefIdT): ImplOverlapKind_pending | undefined {
  const impl1 = tcx.impl_trait_header(def_id1) as ImplTraitHeaderFields;
  const impl2 = tcx.impl_trait_header(def_id2) as ImplTraitHeaderFields;

  const trait_ref1 = binder().EarlyBinder.skip_binder(impl1.trait_ref);
  const trait_ref2 = binder().EarlyBinder.skip_binder(impl2.trait_ref);

  // If either trait impl references an error, they're allowed to overlap,
  // as one of them essentially doesn't exist.
  if (visit().TypeVisitableExt.references_error(trait_ref1, TraitRef_visitable) || visit().TypeVisitableExt.references_error(trait_ref2, TraitRef_visitable)) {
    return to_pending<ImplOverlapKind_pending>({ $: "Permitted", marker: false } satisfies ImplOverlapKind);
  }

  const p1 = impl1.polarity;
  const p2 = impl2.polarity;
  if ((p1 === "Positive" && p2 === "Negative") || (p1 === "Negative" && p2 === "Positive")) {
    // `impl AutoTrait for Type` + `impl !AutoTrait for Type`
    return undefined;
  } else {
    // (ImplPolarity::Positive, ImplPolarity::Positive) | (ImplPolarity::Negative, ImplPolarity::Negative) => {}
  }

  const is_marker_impl = (trait_ref: TraitRef): boolean => (tcx.trait_def(trait_ref.def_id) as TraitDefFields).is_marker;
  const is_marker_overlap = is_marker_impl(trait_ref1) && is_marker_impl(trait_ref2);

  if (is_marker_overlap) {
    return to_pending<ImplOverlapKind_pending>({ $: "Permitted", marker: true } satisfies ImplOverlapKind);
  }

  return undefined;
}

/// Returns `ty::VariantDef` if `res` refers to a struct,
/// or variant or their constructors, panics otherwise.
// rustc: compiler/rustc_middle/src/ty/mod.rs:1809 expect_variant_res
export function TyCtxt_expect_variant_res(tcx: TyCtxt, res: Res): VariantDef_pending {
  if (res.$ === "Def") {
    const kind = res._0;
    if (kind.$ === "Variant") {
      const did = res._1;
      const enum_did = tcx.parent(did);
      return to_pending(AdtDef_variant_with_id(tcx.adt_def(enum_did) as AdtDef, did));
    }
    if (kind.$ === "Struct" || kind.$ === "Union") {
      const did = res._1;
      return to_pending(AdtDef_non_enum_variant(tcx.adt_def(did) as AdtDef));
    }
    if (kind.$ === "Ctor" && kind._0 === "Variant") {
      const variant_ctor_did = res._1;
      const variant_did = tcx.parent(variant_ctor_did);
      const enum_did = tcx.parent(variant_did);
      return to_pending(AdtDef_variant_with_ctor_id(tcx.adt_def(enum_did) as AdtDef, variant_ctor_did));
    }
    if (kind.$ === "Ctor" && kind._0 === "Struct") {
      const ctor_did = res._1;
      const struct_did = tcx.parent(ctor_did);
      return to_pending(AdtDef_non_enum_variant(tcx.adt_def(struct_did) as AdtDef));
    }
  }
  return panic(`expect_variant_res used with unexpected res ${debug_Res(res, PLAIN, debug_HirId)}`);
}

/// Returns the possibly-auto-generated MIR of a [`ty::InstanceKind`].
// PORT: `#[instrument(skip(self), level = "debug")]` and the `debug!`s (tracing) are dropped. `InstanceKind` and
// `mir::Body` are `Pending` (M4): they are read through `InstanceKindView` / `BodyView`; the MIR query values are
// `unknown` in queries.gen.ts.
// rustc: compiler/rustc_middle/src/ty/mod.rs:1831 instance_mir
export function TyCtxt_instance_mir(tcx: TyCtxt, instance_: InstanceKind): Body {
  const instance = from_pending<InstanceKindView>(instance_);
  let body: BodyView;
  switch (instance.$) {
    case "Item": {
      const def = instance._0;
      const def_kind = tcx.def_kind(def);
      if (
        def_kind.$ === "Const" ||
        def_kind.$ === "Static" ||
        def_kind.$ === "AssocConst" ||
        def_kind.$ === "Ctor" ||
        def_kind.$ === "AnonConst"
      ) {
        body = tcx.mir_for_ctfe(def) as BodyView;
      } else if ((def_kind.$ === "Fn" || def_kind.$ === "AssocFn") && is_const_always(tcx.constness(def) as Constness)) {
        body = tcx.mir_for_ctfe(def) as BodyView;
      } else {
        // If the caller wants `mir_for_ctfe` of a function they should not be using
        // `instance_mir`, so we'll assume const fn also wants the optimized version.
        body = tcx.optimized_mir(def) as BodyView;
      }
      break;
    }
    case "Intrinsic":
    case "LlvmIntrinsic":
      return panic("intrinsics have no instance MIR");
    case "Virtual":
      return panic("virtual dispatches have no instance MIR");
    case "Shim":
      body = tcx.mir_shims(instance._0) as BodyView;
      break;
    default:
      // PORT: the other `InstanceKind` variants are not in `InstanceKindView` (M4); upstream's match has no other arm.
      return unreachable(`InstanceKind::${(instance as { $: string }).$}`);
  }

  if (body.phase.$ !== "Runtime") {
    // PORT: the message formats `{body:?}` / `{instance:?}` (MIR Debug, M4).
    return unported("rustc_middle::ty::TyCtxt::instance_mir: assert! message needs Debug of mir::Body / InstanceKind");
  }

  return to_pending<Body>(body);
}

/** `matches!(c, hir::Constness::Const { always: true })` */
function is_const_always(c: Constness): boolean {
  return c.$ === "Const" && c.always === true;
}

/// Gets all attributes with the given name.
// PORT: `#[deprecated]` is a lint attribute; `did: impl Into<DefId>` takes a `DefId` or `LocalDefId`. The lazy
// filter is a generator over the slice `get_all_attrs` returns when the fn is called.
// rustc: compiler/rustc_middle/src/ty/mod.rs:1874 get_attrs
export function TyCtxt_get_attrs(tcx: TyCtxt, did: DefIdT | LocalDefId, attr: Symbol): Iterable<Attribute> {
  const all = from_pending<readonly AttrIrAttribute[]>(tcx.get_all_attrs(into_query_key_DefId(did)));
  return to_pending<Iterable<Attribute>>(
    (function* () {
      for (const a of all) if (AttributeExt.Attribute.has_name(a, attr)) yield a;
    })(),
  );
}

/// Gets all attributes.
///
/// <div class="warning">
///
/// To see if an item has a specific attribute, you should use
/// [`rustc_attr_ir::find_attr!`] so you can use matching.
///
/// </div>
///
// rustc: compiler/rustc_middle/src/ty/mod.rs:1893 get_all_attrs
export function TyCtxt_get_all_attrs(tcx: TyCtxt, did_: DefIdT | LocalDefId): readonly Attribute[] {
  const did: DefIdT = into_query_key_DefId(did_);
  const local = did.as_local();
  if (local !== undefined) {
    return to_pending<readonly Attribute[]>(tcx.hir_attrs(tcx.local_def_id_to_hir_id(local)));
  } else {
    return to_pending<readonly Attribute[]>(tcx.attrs_for_def(did));
  }
}

// PORT: the lazy filter is a generator over the slice read when the fn is called.
// rustc: compiler/rustc_middle/src/ty/mod.rs:1902 get_attrs_by_path
export function TyCtxt_get_attrs_by_path(tcx: TyCtxt, did: DefIdT, attr: readonly Symbol[]): Iterable<Attribute> {
  const filter_fn = (a: AttrIrAttribute): boolean => AttributeExt.Attribute.path_matches(a, attr);
  const local = did.as_local();
  const attrs: readonly AttrIrAttribute[] = local !== undefined ? tcx.hir_attrs(tcx.local_def_id_to_hir_id(local)) : tcx.attrs_for_def(did);
  return to_pending<Iterable<Attribute>>(
    (function* () {
      for (const a of attrs) if (filter_fn(a)) yield a;
    })(),
  );
}

/// Returns `true` if this is an `auto trait`.
// PORT: the `trait_def` query value is `unknown` in queries.gen.ts (`TraitDefFields`).
// rustc: compiler/rustc_middle/src/ty/mod.rs:1916 trait_is_auto
export function TyCtxt_trait_is_auto(tcx: TyCtxt, trait_def_id: DefIdT): boolean {
  return (tcx.trait_def(trait_def_id) as TraitDefFields).has_auto_impl;
}

/// Returns `true` if this is coinductive, either because it is
/// an auto trait or because it has the `#[rustc_coinductive]` attribute.
// rustc: compiler/rustc_middle/src/ty/mod.rs:1922 trait_is_coinductive
export function TyCtxt_trait_is_coinductive(tcx: TyCtxt, trait_def_id: DefIdT): boolean {
  return (tcx.trait_def(trait_def_id) as TraitDefFields).is_coinductive;
}

/// Returns `true` if this is a trait alias.
// rustc: compiler/rustc_middle/src/ty/mod.rs:1927 trait_is_alias
export function TyCtxt_trait_is_alias(tcx: TyCtxt, trait_def_id: DefIdT): boolean {
  return tcx.def_kind(trait_def_id).$ === "TraitAlias";
}

/// Arena-alloc of LayoutError for coroutine layout
// PORT: `self.arena.alloc(err)` is the value itself.
// rustc: compiler/rustc_middle/src/ty/mod.rs:1932 layout_error
export function TyCtxt_layout_error(_tcx: TyCtxt, err: LayoutError): LayoutError {
  return err;
}

/// Returns layout of a non-async-drop coroutine. Layout might be unavailable if the
/// coroutine is tainted by errors.
///
/// Takes `coroutine_kind` which can be acquired from the `CoroutineArgs::kind_ty`,
/// e.g. `args.as_coroutine().kind_ty()`.
// PORT: MIR (M4): `optimized_mir` / `type_of` values are `unknown` in queries.gen.ts; `Body::coroutine_layout_raw`
// is the stand-in `Body_coroutine_layout_raw`; `LayoutError::Unknown(ty)` is built in its PORTING §5 shape.
// rustc: compiler/rustc_middle/src/ty/mod.rs:1941 ordinary_coroutine_layout
export function TyCtxt_ordinary_coroutine_layout(tcx: TyCtxt, def_id: DefIdT, args: GenericArgs): Result<CoroutineLayout, LayoutError> {
  const coroutine_kind_ty = closure().CoroutineArgs.kind_ty(args.as_coroutine());
  const mir = tcx.optimized_mir(def_id);
  const ty = (): Ty => Ty.new_coroutine(tcx, def_id, args);
  const unknown_layout = (): LayoutError => tcx.layout_error(to_pending<LayoutError>({ $: "Unknown", _0: ty() }));
  // Regular coroutine
  if (coroutine_kind_ty.is_unit()) {
    return ok_or_else(Body_coroutine_layout_raw(mir), unknown_layout);
  } else {
    // If we have a `Coroutine` that comes from an coroutine-closure,
    // then it may be a by-move or by-ref body.
    const k = unnormalized().Unnormalized.skip_norm_wip(binder().EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>)).kind();
    if (k.$ !== "Coroutine") {
      return unreachable("internal error: entered unreachable code");
    }
    const identity_args = k._1;
    const identity_kind_ty = closure().CoroutineArgs.kind_ty(identity_args.as_coroutine());
    // If the types differ, then we must be getting the by-move body of
    // a by-ref coroutine.
    if (identity_kind_ty === coroutine_kind_ty) {
      return ok_or_else(Body_coroutine_layout_raw(mir), unknown_layout);
    } else {
      assert(coroutine_kind_ty.to_opt_closure_kind() === "FnOnce", "assertion failed: `coroutine_kind_ty.to_opt_closure_kind()` matches `Some(ClosureKind::FnOnce)`");
      const k2 = identity_kind_ty.to_opt_closure_kind();
      assert(k2 === "Fn" || k2 === "FnMut", "assertion failed: `identity_kind_ty.to_opt_closure_kind()` matches `Some(ClosureKind::Fn | ClosureKind::FnMut)`");
      return ok_or_else(Body_coroutine_layout_raw(tcx.optimized_mir(tcx.coroutine_by_move_body_def_id(def_id))), unknown_layout);
    }
  }
}

/// Returns layout of a `async_drop_in_place::{closure}` coroutine
///   (returned from `async fn async_drop_in_place<T>(..)`).
/// Layout might be unavailable if the coroutine is tainted by errors.
// PORT: MIR (M4): `ShimKind::AsyncDropGlue` is built in its PORTING §5 shape; the `mir_shims` value is `unknown`.
// rustc: compiler/rustc_middle/src/ty/mod.rs:1982 async_drop_coroutine_layout
export function TyCtxt_async_drop_coroutine_layout(tcx: TyCtxt, def_id: DefIdT, args: GenericArgs): Result<CoroutineLayout, LayoutError> {
  const ty = (): Ty => Ty.new_coroutine(tcx, def_id, args);
  const arg0 = args[0]!;
  if (visit().TypeVisitableExt.has_placeholders(arg0, generic_args().fold_GenericArg) || visit().TypeVisitableExt.has_non_region_param(arg0, generic_args().fold_GenericArg)) {
    return Err(tcx.layout_error(to_pending<LayoutError>({ $: "TooGeneric", _0: ty() })));
  }
  const instance = { $: "AsyncDropGlue", _0: def_id, _1: Ty.new_coroutine(tcx, def_id, args) };
  return ok_or_else(Body_coroutine_layout_raw(tcx.mir_shims(instance)), () =>
    tcx.layout_error(to_pending<LayoutError>({ $: "Unknown", _0: ty() })),
  );
}

/// Returns layout of a coroutine. Layout might be unavailable if the
/// coroutine is tainted by errors.
// rustc: compiler/rustc_middle/src/ty/mod.rs:1999 coroutine_layout
export function TyCtxt_coroutine_layout(tcx: TyCtxt, def_id: DefIdT, args: GenericArgs): Result<CoroutineLayout, LayoutError> {
  if (tcx.is_async_drop_in_place_coroutine(def_id)) {
    // layout of `async_drop_in_place<T>::{closure}` in case,
    // when T is a coroutine, contains this internal coroutine's ptr in upvars
    // and doesn't require any locals. Here is an `empty coroutine's layout`
    const arg_cor_ty = generic_args().GenericArg.expect_ty(unwrap(args[0]));
    if (arg_cor_ty.is_coroutine()) {
      const span = tcx.def_span(def_id);
      // PORT: `SourceInfo::outermost(span)`, `CoroutineLayout`, `CoroutineSavedLocal`, `BitMatrix::new(0, 0)` and
      // `CoroutineArgs::RESERVED_VARIANTS` are MIR (M4); the empty proxy layout is not built yet.
      void span;
      return unported("rustc_middle::ty::TyCtxt::coroutine_layout: empty proxy CoroutineLayout (mir::SourceInfo, CoroutineLayout; M4)");
    } else {
      return tcx.async_drop_coroutine_layout(def_id, args);
    }
  } else {
    return tcx.ordinary_coroutine_layout(def_id, args);
  }
}

/// If the given `DefId` is an associated item, returns the `DefId` and `DefKind` of the parent trait or impl.
// rustc: compiler/rustc_middle/src/ty/mod.rs:2034 assoc_parent
export function TyCtxt_assoc_parent(tcx: TyCtxt, def_id: DefIdT): [DefIdT, DefKind] | undefined {
  if (!hir_def.DefKind.is_assoc(tcx.def_kind(def_id))) {
    return undefined;
  }
  const parent = tcx.parent(def_id);
  const def_kind = tcx.def_kind(parent);
  return [parent, def_kind];
}

/// Returns the trait item that is implemented by the given item `DefId`.
// rustc: compiler/rustc_middle/src/ty/mod.rs:2044 trait_item_of
export function TyCtxt_trait_item_of(tcx: TyCtxt, def_id_: IntoQueryKey<DefIdT>): DefIdT | undefined {
  const def_id = into_query_key_DefId(def_id_);
  const item = tcx.opt_associated_item(def_id);
  if (item === undefined) return undefined;
  return AssocItem_trait_item_def_id(item);
}

/// If the given `DefId` is an associated item of a trait,
/// returns the `DefId` of the trait; otherwise, returns `None`.
// rustc: compiler/rustc_middle/src/ty/mod.rs:2051 trait_of_assoc
export function TyCtxt_trait_of_assoc(tcx: TyCtxt, def_id: DefIdT): DefIdT | undefined {
  const p = tcx.assoc_parent(def_id);
  if (p !== undefined && p[1].$ === "Trait") return p[0];
  return undefined;
}

// rustc: compiler/rustc_middle/src/ty/mod.rs:2058 impl_is_of_trait
export function TyCtxt_impl_is_of_trait(tcx: TyCtxt, def_id_: IntoQueryKey<DefIdT>): boolean {
  const def_id = into_query_key_DefId(def_id_);
  const k = tcx.def_kind(def_id);
  if (k.$ !== "Impl") {
    return panic(`expected Impl for ${debug_DefId(def_id, PLAIN)}`);
  }
  const of_trait = k.of_trait;
  return of_trait;
}

/// If the given `DefId` is an associated item of an impl,
/// returns the `DefId` of the impl; otherwise returns `None`.
// rustc: compiler/rustc_middle/src/ty/mod.rs:2068 impl_of_assoc
export function TyCtxt_impl_of_assoc(tcx: TyCtxt, def_id: DefIdT): DefIdT | undefined {
  const p = tcx.assoc_parent(def_id);
  if (p !== undefined && p[1].$ === "Impl") return p[0];
  return undefined;
}

/// If the given `DefId` is an associated item of an inherent impl,
/// returns the `DefId` of the impl; otherwise, returns `None`.
// rustc: compiler/rustc_middle/src/ty/mod.rs:2077 inherent_impl_of_assoc
export function TyCtxt_inherent_impl_of_assoc(tcx: TyCtxt, def_id: DefIdT): DefIdT | undefined {
  const p = tcx.assoc_parent(def_id);
  if (p !== undefined && p[1].$ === "Impl" && p[1].of_trait === false) return p[0];
  return undefined;
}

/// If the given `DefId` is an associated item of a trait impl,
/// returns the `DefId` of the impl; otherwise, returns `None`.
// rustc: compiler/rustc_middle/src/ty/mod.rs:2086 trait_impl_of_assoc
export function TyCtxt_trait_impl_of_assoc(tcx: TyCtxt, def_id: DefIdT): DefIdT | undefined {
  const p = tcx.assoc_parent(def_id);
  if (p !== undefined && p[1].$ === "Impl" && p[1].of_trait === true) return p[0];
  return undefined;
}

// PORT: the `impl_trait_header` query value is `unknown` in queries.gen.ts (`ImplTraitHeaderFields`).
// rustc: compiler/rustc_middle/src/ty/mod.rs:2093 impl_polarity
export function TyCtxt_impl_polarity(tcx: TyCtxt, def_id_: IntoQueryKey<DefIdT>): ImplPolarity {
  const def_id = into_query_key_DefId(def_id_);
  return (tcx.impl_trait_header(def_id) as ImplTraitHeaderFields).polarity;
}

/// Given an `impl_id`, return the trait it implements.
// rustc: compiler/rustc_middle/src/ty/mod.rs:2099 impl_trait_ref
export function TyCtxt_impl_trait_ref(tcx: TyCtxt, def_id_: IntoQueryKey<DefIdT>): EarlyBinder<TraitRef> {
  const def_id = into_query_key_DefId(def_id_);
  return (tcx.impl_trait_header(def_id) as ImplTraitHeaderFields).trait_ref;
}

/// Given an `impl_id`, return the trait it implements.
/// Returns `None` if it is an inherent impl.
// rustc: compiler/rustc_middle/src/ty/mod.rs:2109 impl_opt_trait_ref
export function TyCtxt_impl_opt_trait_ref(tcx: TyCtxt, def_id_: IntoQueryKey<DefIdT>): EarlyBinder<TraitRef> | undefined {
  const def_id = into_query_key_DefId(def_id_);
  return tcx.impl_is_of_trait(def_id) ? tcx.impl_trait_ref(def_id) : undefined;
}

/// Given the `DefId` of an impl, returns the `DefId` of the trait it implements.
// rustc: compiler/rustc_middle/src/ty/mod.rs:2118 impl_trait_id
export function TyCtxt_impl_trait_id(tcx: TyCtxt, def_id_: IntoQueryKey<DefIdT>): DefIdT {
  const def_id = into_query_key_DefId(def_id_);
  return binder().EarlyBinder.skip_binder(tcx.impl_trait_ref(def_id)).def_id;
}

/// Given the `DefId` of an impl, returns the `DefId` of the trait it implements.
/// Returns `None` if it is an inherent impl.
// rustc: compiler/rustc_middle/src/ty/mod.rs:2125 impl_opt_trait_id
export function TyCtxt_impl_opt_trait_id(tcx: TyCtxt, def_id_: IntoQueryKey<DefIdT>): DefIdT | undefined {
  const def_id = into_query_key_DefId(def_id_);
  return tcx.impl_is_of_trait(def_id) ? tcx.impl_trait_id(def_id) : undefined;
}

// rustc: compiler/rustc_middle/src/ty/mod.rs:2130 is_exportable
export function TyCtxt_is_exportable(tcx: TyCtxt, def_id: DefIdT): boolean {
  return tcx.exportable_items(def_id.krate).some((d) => DefId_eq(d, def_id));
}

/// Check if the given `DefId` is `#\[automatically_derived\]`, *and*
/// whether it was produced by expanding a builtin derive macro.
// rustc: compiler/rustc_middle/src/ty/mod.rs:2136 is_builtin_derived
export function TyCtxt_is_builtin_derived(tcx: TyCtxt, def_id_: DefIdT): boolean {
  if (tcx.is_automatically_derived(def_id_)) {
    const def_id = def_id_.as_local();
    if (def_id !== undefined) {
      const outer = SyntaxContext.outer_expn_data(Span_.ctxt(tcx.def_span(def_id)));
      if (
        outer.kind.$ === "Macro" &&
        outer.kind._0 === "Derive" &&
        find_attr(HasAttrs_DefId.get_attrs(unwrap(outer.macro_def_id), tcx), (k) => (k.$ === "RustcBuiltinMacro" ? null : undefined)) !== undefined
      ) {
        return true;
      }
    }
  }
  return false;
}

/// Check if the given `DefId` is `#\[automatically_derived\]`.
// rustc: compiler/rustc_middle/src/ty/mod.rs:2150 is_automatically_derived
export function TyCtxt_is_automatically_derived(tcx: TyCtxt, def_id: DefIdT): boolean {
  return find_attr(HasAttrs_DefId.get_attrs(def_id, tcx), (k) => (k.$ === "AutomaticallyDerived" ? null : undefined)) !== undefined;
}

/// Looks up the span of `impl_did` if the impl is local; otherwise returns `Err`
/// with the name of the crate containing the impl.
// rustc: compiler/rustc_middle/src/ty/mod.rs:2156 span_of_impl
export function TyCtxt_span_of_impl(tcx: TyCtxt, impl_def_id_: DefIdT): Result<Span, Symbol> {
  const impl_def_id = impl_def_id_.as_local();
  if (impl_def_id !== undefined) {
    return Ok(tcx.def_span(impl_def_id));
  } else {
    return Err(tcx.crate_name(impl_def_id_.krate));
  }
}

/// Hygienically compares a use-site name (`use_name`) for a field or an associated item with
/// its supposed definition name (`def_name`). The method also needs `DefId` of the supposed
/// definition's parent/scope to perform comparison.
// rustc: compiler/rustc_middle/src/ty/mod.rs:2167 hygienic_eq
export function TyCtxt_hygienic_eq(tcx: TyCtxt, use_ident: Ident, def_ident: Ident, def_parent_def_id: DefIdT): boolean {
  // We could use `Ident::eq` here, but we deliberately don't. The identifier
  // comparison fails frequently, and we want to avoid the expensive
  // `normalize_to_macros_2_0()` calls required for the span comparison whenever possible.
  return (
    use_ident.name === def_ident.name &&
    SyntaxContext.hygienic_eq(Span_.ctxt(use_ident.span), Span_.ctxt(def_ident.span), tcx.expn_that_defined(def_parent_def_id))
  );
}

// PORT: `mut ident: Ident` is a copy (PORTING §8): the caller's `Ident` is not changed.
// rustc: compiler/rustc_middle/src/ty/mod.rs:2178 adjust_ident
export function TyCtxt_adjust_ident(tcx: TyCtxt, ident_: Ident, scope: DefIdT): Ident {
  const ident = new Ident_(ident_.name, ident_.span);
  Span_.normalize_to_macros_2_0_and_adjust(field_mut(ident, "span"), tcx.expn_that_defined(scope));
  return ident;
}

// PORT: `mut ident: Ident` is a copy (PORTING §8): the caller's `Ident` is not changed.
// rustc: compiler/rustc_middle/src/ty/mod.rs:2183 adjust_ident_and_get_scope
export function TyCtxt_adjust_ident_and_get_scope(tcx: TyCtxt, ident_: Ident, scope_: DefIdT, mod_id: LocalModId): [Ident, ModId] {
  const ident = new Ident_(ident_.name, ident_.span);
  const actual_expansion = Span_.normalize_to_macros_2_0_and_adjust(field_mut(ident, "span"), tcx.expn_that_defined(scope_));
  const scope = (actual_expansion === undefined ? undefined : actual_expansion.expn_data().parent_module) ?? LocalModId.to_mod_id(mod_id);
  return [ident, scope];
}

/// Checks whether this is a `const fn`. Returns `false` for non-functions.
///
/// Even if this returns `true`, constness may still be unstable!
// PORT: the `constness` query value is `unknown` in queries.gen.ts.
// rustc: compiler/rustc_middle/src/ty/mod.rs:2201 is_const_fn
export function TyCtxt_is_const_fn(tcx: TyCtxt, def_id_: IntoQueryKey<DefIdT>): boolean {
  const def_id = into_query_key_DefId(def_id_);
  const k = tcx.def_kind(def_id);
  return (
    (k.$ === "Fn" || k.$ === "AssocFn" || (k.$ === "Ctor" && k._1 === "Fn") || k.$ === "Closure") &&
    (tcx.constness(def_id) as Constness).$ === "Const"
  );
}

/** `matches!(c, hir::Constness::Const { always: false })` */
function is_const_maybe(c: Constness): boolean {
  return c.$ === "Const" && c.always === false;
}

/// Whether this item is conditionally constant for the purposes of the
/// effects implementation.
///
/// This roughly corresponds to all const functions and other callable
/// items, along with const impls and traits, and associated types within
/// those impls and traits.
// PORT: `def_id: impl Into<DefId>` takes a `DefId` or `LocalDefId`. The `impl_trait_header` / `constness` /
// `opaque_ty_origin` query values are `unknown` in queries.gen.ts.
// rustc: compiler/rustc_middle/src/ty/mod.rs:2215 is_conditionally_const
export function TyCtxt_is_conditionally_const(tcx: TyCtxt, def_id_: DefIdT | LocalDefId): boolean {
  const def_id: DefIdT = into_query_key_DefId(def_id_);
  const k = tcx.def_kind(def_id);
  switch (k.$) {
    case "Impl": {
      if (k.of_trait) {
        const header = tcx.impl_trait_header(def_id) as ImplTraitHeaderFields;
        return is_const_maybe(header.constness) && tcx.is_const_trait(binder().EarlyBinder.skip_binder(header.trait_ref).def_id);
      } else {
        return is_const_maybe(tcx.constness(def_id) as Constness);
      }
    }
    case "Fn":
      return is_const_maybe(tcx.constness(def_id) as Constness);
    case "Ctor":
      if (k._1 === "Fn") {
        return is_const_maybe(tcx.constness(def_id) as Constness);
      }
      // `DefKind::Ctor(_, CtorKind::Const)`
      return false;
    case "TraitAlias":
    case "Trait":
      return tcx.is_const_trait(def_id);
    case "AssocTy": {
      const parent_def_id = tcx.parent(def_id);
      const pk = tcx.def_kind(parent_def_id);
      if (pk.$ === "Impl" && pk.of_trait === false) {
        return false;
      } else if ((pk.$ === "Impl" && pk.of_trait === true) || pk.$ === "Trait") {
        return tcx.is_conditionally_const(parent_def_id);
      } else {
        return panic(`unexpected parent item of associated type: ${debug_DefId(parent_def_id, PLAIN)}`);
      }
    }
    case "AssocFn": {
      const parent_def_id = tcx.parent(def_id);
      const pk = tcx.def_kind(parent_def_id);
      if (pk.$ === "Impl" && pk.of_trait === false) {
        return is_const_maybe(tcx.constness(def_id) as Constness);
      } else if (pk.$ === "Impl" && pk.of_trait === true) {
        const trait_method_did = tcx.trait_item_of(def_id);
        if (trait_method_did === undefined) {
          return false;
        }
        return is_const_maybe(tcx.constness(trait_method_did) as Constness) && tcx.is_conditionally_const(parent_def_id);
      } else if (pk.$ === "Trait") {
        return is_const_maybe(tcx.constness(def_id) as Constness) && tcx.is_conditionally_const(parent_def_id);
      } else {
        return panic(`unexpected parent item of associated fn: ${debug_DefId(parent_def_id, PLAIN)}`);
      }
    }
    case "OpaqueTy": {
      const origin = tcx.opaque_ty_origin(def_id) as OpaqueTyOrigin<DefIdT>;
      switch (origin.$) {
        case "FnReturn":
          return tcx.is_conditionally_const(origin.parent);
        case "AsyncFn":
          return false;
        // FIXME(const_trait_impl): ATPITs could be conditionally const?
        case "TyAlias":
          return false;
      }
    }
    // falls through (unreachable: the switch above returns on every arm)
    case "Closure":
      return is_const_maybe(tcx.constness(def_id) as Constness);
    case "Mod":
    case "Struct":
    case "Union":
    case "Enum":
    case "Variant":
    case "TyAlias":
    case "ForeignTy":
    case "TyParam":
    case "Const":
    case "ConstParam":
    case "Static":
    case "AssocConst":
    case "Macro":
    case "ExternCrate":
    case "Use":
    case "ForeignMod":
    case "AnonConst":
    case "Field":
    case "LifetimeParam":
    case "GlobalAsm":
    case "SyntheticCoroutineBody":
    case "TestBinderConstraints":
      return false;
  }
}

// PORT: the `trait_def` query value is `unknown` in queries.gen.ts (`TraitDefFields`).
// rustc: compiler/rustc_middle/src/ty/mod.rs:2298 is_const_trait
export function TyCtxt_is_const_trait(tcx: TyCtxt, def_id: DefIdT): boolean {
  return (tcx.trait_def(def_id) as TraitDefFields).constness.$ === "Const";
}

// rustc: compiler/rustc_middle/src/ty/mod.rs:2302 impl_method_has_trait_impl_trait_tys
export function TyCtxt_impl_method_has_trait_impl_trait_tys(tcx: TyCtxt, def_id: DefIdT): boolean {
  if (tcx.def_kind(def_id).$ !== "AssocFn") {
    return false;
  }

  const item = tcx.opt_associated_item(def_id);
  if (item === undefined) {
    return false;
  }

  const container = item.container;
  if (!(container.$ === "TraitImpl" && container._0.$ === "Ok")) {
    return false;
  }
  const trait_item_def_id = container._0._0;

  return tcx.associated_types_for_impl_traits_in_associated_fn(trait_item_def_id).length !== 0;
}

/// Compute a `FnAbi` suitable for declaring/defining an `fn` instance, and for direct calls*
/// to an `fn`. Indirectly-passed parameters in the returned ABI will include applicable
/// codegen optimization attributes, including `ReadOnly` and `CapturesNone` -- deduction of
/// which requires inspection of function bodies that can lead to cycles when performed during
/// typeck. During typeck, you should therefore use instead the unoptimized ABI returned by
/// `fn_abi_of_instance_no_deduced_attrs`.
///
/// For performance reasons, you should prefer to call this inherent method rather than invoke
/// the `fn_abi_of_instance_raw` query: it delegates to that query if necessary, but where
/// possible delegates instead to the `fn_abi_of_instance_no_deduced_attrs` query (thus avoiding
/// unnecessary query system overhead).
///
/// * that includes virtual calls, which are represented by "direct calls" to an
///   `InstanceKind::Virtual` instance (of `<dyn Trait as Trait>::fn`).
// PORT: both query values are `Result<unknown, unknown>` in queries.gen.ts (codegen, M4+).
// rustc: compiler/rustc_middle/src/ty/mod.rs:2333 fn_abi_of_instance
export function TyCtxt_fn_abi_of_instance(tcx: TyCtxt, query: PseudoCanonicalInput_pending<[Instance, List<Ty>]>): Result<FnAbi<Ty>, FnAbiError> {
  // Only deduce attrs in full, optimized builds. Otherwise, avoid the query system overhead
  // of ever invoking the `fn_abi_of_instance_raw` query.
  if (tcx.sess.opts.optimize !== "No" && tcx.sess.opts.incremental === undefined) {
    return tcx.fn_abi_of_instance_raw(query) as Result<FnAbi<Ty>, FnAbiError>;
  } else {
    return tcx.fn_abi_of_instance_no_deduced_attrs(query) as Result<FnAbi<Ty>, FnAbiError>;
  }
}

// `HasAttrs` impls: allow `find_attr!(tcx, id, ...)` to work with both DefId-like types and HirId.
// PORT: the trait over the id type is a table per implementing type (rustc_attr_ir lib.ts `HasAttrs`).

export const HasAttrs_DefId: HasAttrs<DefIdT, TyCtxt> = {
  // rustc: compiler/rustc_middle/src/ty/mod.rs:2350 get_attrs
  get_attrs(self: DefIdT, tcx: TyCtxt): readonly AttrIrAttribute[] {
    const did = self.as_local();
    if (did !== undefined) {
      return tcx.hir_attrs(tcx.local_def_id_to_hir_id(did));
    } else {
      return tcx.attrs_for_def(self);
    }
  },
};

export const HasAttrs_LocalDefId: HasAttrs<LocalDefId, TyCtxt> = {
  // rustc: compiler/rustc_middle/src/ty/mod.rs:2360 get_attrs
  get_attrs(self: LocalDefId, tcx: TyCtxt): readonly AttrIrAttribute[] {
    return tcx.hir_attrs(tcx.local_def_id_to_hir_id(self));
  },
};

export const HasAttrs_OwnerId: HasAttrs<OwnerId, TyCtxt> = {
  // rustc: compiler/rustc_middle/src/ty/mod.rs:2366 get_attrs
  get_attrs(self: OwnerId, tcx: TyCtxt): readonly AttrIrAttribute[] {
    return HasAttrs_LocalDefId.get_attrs(self.def_id, tcx);
  },
};

export const HasAttrs_HirId: HasAttrs<HirId, TyCtxt> = {
  // rustc: compiler/rustc_middle/src/ty/mod.rs:2372 get_attrs
  get_attrs(self: HirId, tcx: TyCtxt): readonly AttrIrAttribute[] {
    return tcx.hir_attrs(self);
  },
};

// PORT: the sub-providers live in extension modules (closure.ts, erase_regions.ts, inhabitedness, util.ts, print,
// util/bug.rs, trait_def.ts, vtable.rs) that this defining module must not import (ty-contract "Init order"); those
// not ported yet are the `*_provide` / `*_provider` stand-ins below. `context::provide` is reached through
// `require` when `provide` runs (context.ts imports this module). Not wired yet: rustc_interface/passes.ts calls
// `context::provide` and `print::provide` itself until the stand-ins are repointed.
// rustc: compiler/rustc_middle/src/ty/mod.rs:2377 provide
export function provide(providers: Providers): void {
  closure_provide(providers);
  ty_context().provide(providers);
  erase_regions_provide(providers);
  inhabitedness_provide(providers);
  util_provide(providers);
  print_provide(providers);
  util_bug_provide(providers);
  providers.trait_impls_of = trait_def_trait_impls_of_provider;
  providers.incoherent_impls = trait_def_incoherent_impls_provider;
  providers.trait_impls_in_crate = trait_def_trait_impls_in_crate_provider;
  providers.traits = trait_def_traits_provider;
  providers.vtable_allocation = vtable_vtable_allocation_provider;
}

/** `require` of the defining module context.ts (it imports this module; see `provide`). */
function ty_context(): typeof import("./context.ts") {
  return require("./context.ts") as typeof import("./context.ts");
}

/// A map for the local crate mapping each type to a vector of its
/// inherent impls. This is not meant to be used outside of coherence;
/// rather, you should request the vector for a specific type via
/// `tcx.inherent_impls(def_id)` so as to minimize your dependencies
/// (constructing this map requires touching the entire crate).
// rustc-type: compiler/rustc_middle/src/ty/mod.rs:2401 CrateInherentImpls
// PORT: `FxIndexMap<SimplifiedType, _>` is a `KeyedMap` on the canonical key (PORTING §5).
export interface CrateInherentImpls {
  inherent_impls: Map<LocalDefId, DefIdT[]>;
  incoherent_impls: KeyedMap<SimplifiedType<DefIdT>, LocalDefId[]>;
}
/** `#[derive(Default)]` */
export function CrateInherentImpls_default(): CrateInherentImpls {
  return { inherent_impls: new Map(), incoherent_impls: new KeyedMap((k) => intern_key(k)) };
}
/** `#[derive(Debug)]` */
export const debug_CrateInherentImpls: Debug<CrateInherentImpls> = (v, f) =>
  debug_struct(f, "CrateInherentImpls", [
    ["inherent_impls", debug_map(f, [...v.inherent_impls].map(([k, x]) => [debug_LocalDefId(k, f), debug_list(f, x.map((d) => debug_DefId(d, f)))]))],
    [
      "incoherent_impls",
      debug_map(f, [...v.incoherent_impls].map(([k, x]) => [fast_reject().debug_SimplifiedType(k, f, debug_DefId), debug_list(f, x.map((d) => debug_LocalDefId(d, f)))])),
    ],
  ]);

// rustc-type: compiler/rustc_middle/src/ty/mod.rs:2407 SymbolName
// PORT: `name: &'tcx str` is a JS string; `#[derive(PartialOrd, Ord)]` compares it (`SymbolName_cmp` when needed).
export class SymbolName {
  constructor(
    /// `&str` gives a consistent ordering, which ensures reproducible builds.
    readonly name: string,
  ) {}

  // PORT: `tcx.arena.alloc_str(name)` is the string itself.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:2413 new
  static new(_tcx: TyCtxt, name: string): SymbolName {
    return new SymbolName(name);
  }
}

// PORT: `fmt::Display::fmt(&self.name, fmt)`: `Fmt` carries no width / precision, so it is the string.
// rustc: compiler/rustc_middle/src/ty/mod.rs:2419 fmt
export function display_SymbolName(self: SymbolName): string {
  return self.name;
}

// rustc: compiler/rustc_middle/src/ty/mod.rs:2425 fmt
export const debug_SymbolName: Debug<SymbolName> = (self, _fmt) => display_SymbolName(self);

/// The constituent parts of a type level constant of kind ADT or array.
// rustc-type: compiler/rustc_middle/src/ty/mod.rs:2432 DestructuredAdtConst
export interface DestructuredAdtConst {
  variant: VariantIdx;
  fields: readonly Const[];
}
/** `#[derive(Debug)]` */
export const debug_DestructuredAdtConst: Debug<DestructuredAdtConst> = (v, f) =>
  debug_struct(f, "DestructuredAdtConst", [
    ["variant", String(v.variant)],
    ["fields", debug_list(f, v.fields.map((c) => debug_Const(c, f)))],
  ]);

// ---- ty-mod-b local types and stand-ins (not markers; repoint/delete at merge) ----------------------------------

// PORT (init order, ty-contract "Init order"): these rustc_type_ir / rustc_middle modules import this defining
// module (directly or through rustc_middle's extension modules), so a static value import throws a TDZ
// `ReferenceError` when this module is the first one loaded. They are required lazily, at call time (precedent:
// rustc_type_ir sty/mod.ts `binder()` / `region_kind()`).
function binder(): typeof import("../../rustc_type_ir/binder.ts") {
  return require("../../rustc_type_ir/binder.ts") as typeof import("../../rustc_type_ir/binder.ts");
}
function visit(): typeof import("../../rustc_type_ir/visit.ts") {
  return require("../../rustc_type_ir/visit.ts") as typeof import("../../rustc_type_ir/visit.ts");
}
function fold(): typeof import("../../rustc_type_ir/fold.ts") {
  return require("../../rustc_type_ir/fold.ts") as typeof import("../../rustc_type_ir/fold.ts");
}
function unnormalized(): typeof import("../../rustc_type_ir/unnormalized.ts") {
  return require("../../rustc_type_ir/unnormalized.ts") as typeof import("../../rustc_type_ir/unnormalized.ts");
}
function infer_ctxt(): typeof import("../../rustc_type_ir/infer_ctxt.ts") {
  return require("../../rustc_type_ir/infer_ctxt.ts") as typeof import("../../rustc_type_ir/infer_ctxt.ts");
}
function closure(): typeof import("../../rustc_type_ir/ty_kind/closure.ts") {
  return require("../../rustc_type_ir/ty_kind/closure.ts") as typeof import("../../rustc_type_ir/ty_kind/closure.ts");
}
function fast_reject(): typeof import("../../rustc_type_ir/fast_reject.ts") {
  return require("../../rustc_type_ir/fast_reject.ts") as typeof import("../../rustc_type_ir/fast_reject.ts");
}
function predicate_gen(): typeof import("../../rustc_type_ir/predicate.gen.ts") {
  return require("../../rustc_type_ir/predicate.gen.ts") as typeof import("../../rustc_type_ir/predicate.gen.ts");
}
function generic_args(): typeof import("./generic_args.ts") {
  return require("./generic_args.ts") as typeof import("./generic_args.ts");
}

/** `impl TypeVisitable for TraitRef` (derived; predicate.gen.ts) as a D4 descriptor. */
const TraitRef_visitable: TypeVisitable<TraitRef> = { visit_with: (self, visitor) => predicate_gen().visit_with_TraitRef(self, visitor) };

/** PORT: `Interner` cast of `tcx` (merge-w15a decision 7: some query value types are still `unknown`). */
function as_interner_(tcx: TyCtxt): Interner {
  return tcx as unknown as Interner;
}

/** `Option::unwrap` */
function unwrap<T>(v: T | undefined): T {
  if (v === undefined) return panic("called `Option::unwrap()` on a `None` value");
  return v;
}

/** `Option::expect` */
function expect<T>(v: T | undefined, msg: string): T {
  if (v === undefined) return panic(msg);
  return v;
}

/** `Option::ok_or_else` */
function ok_or_else<T, E>(v: T | undefined, err: () => E): Result<T, E> {
  return v !== undefined ? Ok(v) : Err(err());
}

/** `hir::BodyId` (decls.ts aliases it `Pending`). */
type hir_BodyId = import("../../rustc_hir/hir.gen.ts").BodyId;

/** PORT: the fields of `ty::ImplTraitHeader` (mod.rs:169, lane ty-mod-a) read here; the query value is `unknown`. */
interface ImplTraitHeaderFields {
  trait_ref: EarlyBinder<TraitRef>;
  safety: hir_Safety;
  polarity: ImplPolarity;
  constness: Constness;
}

/** PORT: the fields of `ty::TraitDef` (trait_def.rs:20, lane ty-adt-assoc) read here; the query value is `unknown`. */
interface TraitDefFields {
  has_auto_impl: boolean;
  is_marker: boolean;
  is_coinductive: boolean;
  constness: Constness;
}

/** PORT: `ty::InstanceKind` (instance.rs, M4) in its PORTING §5 shape, as far as `instance_mir` reads it. */
type InstanceKindView =
  | { readonly $: "Item"; readonly _0: DefIdT }
  | { readonly $: "Intrinsic" }
  | { readonly $: "LlvmIntrinsic" }
  | { readonly $: "Virtual" }
  | { readonly $: "Shim"; readonly _0: unknown };

/** PORT: `mir::Body` (M4) as far as `instance_mir` reads it. */
interface BodyView {
  phase: { readonly $: string };
}

/** PORT: stand-in for `ty::RestrictionKind` (mod.rs:277, lane ty-mod-a). DELETE AT MERGE. */
type RestrictionKind_ = PendingEnum<"RestrictionKind">;
/** PORT: stand-in for `#[derive(Debug)]` of `RestrictionKind` (lane ty-mod-a). DELETE AT MERGE. */
function debug_RestrictionKind_(_v: RestrictionKind_, _f: Fmt): string {
  return unported("rustc_middle::ty::RestrictionKind: Debug (lane ty-mod-a)");
}
/** PORT: stand-in for `ParamEnv::empty` (mod.rs:1046, lane ty-mod-a). DELETE AT MERGE. */
function ParamEnv_empty(): ParamEnv {
  return unported("rustc_middle::ty::ParamEnv::empty (lane ty-mod-a)");
}
/** PORT: stand-in for `ParamEnv::with_normalized` (mod.rs:1075, lane ty-mod-a). DELETE AT MERGE. */
function ParamEnv_with_normalized(_self: ParamEnv, _tcx: TyCtxt): ParamEnv {
  return unported("rustc_middle::ty::ParamEnv::with_normalized (lane ty-mod-a)");
}
/** PORT: stand-in for `#[derive(Debug)]` of `ParamEnv` (mod.rs:1016, lane ty-mod-a). DELETE AT MERGE. */
function debug_ParamEnv_(_v: ParamEnv, _f: Fmt): string {
  return unported("rustc_middle::ty::ParamEnv: Debug (lane ty-mod-a)");
}

/** PORT: stand-in for `AssocItem::is_fn` (ty/assoc.rs:152, lane ty-adt-assoc): the upstream body. */
function AssocItem_is_fn(self: AssocItem): boolean {
  return self.kind.$ === "Fn";
}
/** PORT: stand-in for `AssocItem::defaultness` (ty/assoc.rs:54, lane ty-adt-assoc): the upstream body. */
function AssocItem_defaultness(self: AssocItem, tcx: TyCtxt): hir_Defaultness {
  switch (self.container.$) {
    case "InherentImpl":
      return { $: "Final" };
    case "Trait":
    case "TraitImpl":
      return tcx.defaultness(self.def_id) as hir_Defaultness;
  }
}
/** PORT: stand-in for `AssocItem::trait_item_def_id` (ty/assoc.rs:78, lane ty-adt-assoc): the upstream body. */
function AssocItem_trait_item_def_id(self: AssocItem): DefIdT | undefined {
  if (self.container.$ === "TraitImpl" && self.container._0.$ === "Ok") return self.container._0._0;
  return undefined;
}
/** PORT: stand-in for `AssocItems::in_definition_order` (ty/assoc.rs:267, lane ty-adt-assoc; `SortedIndexMultiMap`). */
function AssocItems_in_definition_order(_self: AssocItems): Iterable<AssocItem> {
  return unported("rustc_middle::ty::AssocItems::in_definition_order (lane ty-adt-assoc)");
}
/** PORT: stand-in for `AdtDef::variant_with_id` (ty/adt.rs:582, lane ty-adt-assoc). */
function AdtDef_variant_with_id(_self: AdtDef, _vid: DefIdT): VariantDef {
  return unported("rustc_middle::ty::AdtDef::variant_with_id (lane ty-adt-assoc)");
}
/** PORT: stand-in for `AdtDef::variant_with_ctor_id` (ty/adt.rs:587, lane ty-adt-assoc). */
function AdtDef_variant_with_ctor_id(_self: AdtDef, _cid: DefIdT): VariantDef {
  return unported("rustc_middle::ty::AdtDef::variant_with_ctor_id (lane ty-adt-assoc)");
}
/** PORT: stand-in for `AdtDef::non_enum_variant` (ty/adt.rs:544, lane ty-adt-assoc). */
function AdtDef_non_enum_variant(_self: AdtDef): VariantDef {
  return unported("rustc_middle::ty::AdtDef::non_enum_variant (lane ty-adt-assoc)");
}
/** PORT: stand-in for `mir::Body::coroutine_layout_raw` (mir/mod.rs, M4). */
function Body_coroutine_layout_raw(_self: unknown): CoroutineLayout | undefined {
  return unported("rustc_middle::mir::Body::coroutine_layout_raw (M4)");
}

/** PORT: stand-ins for the sub-providers `ty::provide` calls (see `provide`). */
function closure_provide(_providers: Providers): void {
  unported("rustc_middle::ty::closure::provide (lane ty-adt-assoc)");
}
function erase_regions_provide(_providers: Providers): void {
  unported("rustc_middle::ty::erase_regions::provide (lane ty-results)");
}
function inhabitedness_provide(_providers: Providers): void {
  unported("rustc_middle::ty::inhabitedness::provide");
}
function util_provide(_providers: Providers): void {
  unported("rustc_middle::ty::util::provide (lane ty-util)");
}
function print_provide(providers: Providers): void {
  // PORT: `print::provide` is ported (ty/print/pretty.ts, an extension module): reached through `require`.
  (require("./print/pretty.ts") as typeof import("./print/pretty.ts")).provide(providers);
}
function util_bug_provide(_providers: Providers): void {
  unported("rustc_middle::util::bug::provide");
}
const trait_def_trait_impls_of_provider: Providers["trait_impls_of"] = () => unported("rustc_middle::ty::trait_def::trait_impls_of_provider (lane ty-adt-assoc)");
const trait_def_incoherent_impls_provider: Providers["incoherent_impls"] = () =>
  unported("rustc_middle::ty::trait_def::incoherent_impls_provider (lane ty-adt-assoc)");
const trait_def_trait_impls_in_crate_provider: Providers["trait_impls_in_crate"] = () =>
  unported("rustc_middle::ty::trait_def::trait_impls_in_crate_provider (lane ty-adt-assoc)");
const trait_def_traits_provider: Providers["traits"] = () => unported("rustc_middle::ty::trait_def::traits_provider (lane ty-adt-assoc)");
const vtable_vtable_allocation_provider: Providers["vtable_allocation"] = () => unported("rustc_middle::ty::vtable::vtable_allocation_provider (M4)");
