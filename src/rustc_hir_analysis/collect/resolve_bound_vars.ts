// Port of compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs (lane collect-rbv)
//! Resolution of early vs late bound lifetimes.
//!
//! Name resolution for lifetimes is performed on the AST and embedded into HIR. From this
//! information, typechecking needs to transform the lifetime parameters into bound lifetimes.
//! Lifetimes can be early-bound or late-bound. Construction of typechecking terms needs to visit
//! the types in HIR to identify late-bound lifetimes and assign their Debruijn indices. This file
//! is also responsible for assigning their semantics to implicit lifetimes in trait objects.
//
// PORT: the types of this file are hand-written (the codegen typedefs probe cannot parse its `gen` block,
// types.sets.json `files_note`), in the generator's shape:
// - `#[extension(trait ResolvedArgExt)] impl ResolvedArg` -> the companion `ResolvedArgExt` (`ResolvedArgExt.late(..)`,
//   `ResolvedArgExt.shifted(arg, n)`), as rustc_hir_id's `PerParentDisambiguatorsMap`.
// - `enum Scope<'a, 'tcx>` -> a `$`-tagged union; `ScopeRef<'a, 'tcx> = &'a Scope` is the object itself. The
//   `captures: &'a RefCell<FxIndexMap<ResolvedArg, LocalDefId>>` of `Scope::Opaque` is a `KeyedMap` keyed by
//   `key_ResolvedArg` (shared by reference, like the `&RefCell`).
// - `BoundVarContext` is a class extending rustc_hir intravisit's `Visitor` (`type NestedFilter = OnlyBodies`):
//   `rbv: &mut ResolveBoundVars` and `disambiguators: &mut LocalDefIdMap<_>` are shared objects; the
//   `RefCell<Option<OpaqueHigherRankedLifetimeCaptureErrors>>` is a mutable field. The methods of the second
//   `impl<'a, 'tcx> BoundVarContext` block (after `object_lifetime_default`) are prototype assignments in upstream order.
// - `debug!` / `debug_span!` / `#[instrument]` (tracing) are comments.
// Init order: top-level code here touches only other crates; rustc_hir_analysis exports (../diagnostics.ts) are read
// inside function bodies only.
import { ControlFlow, VisitorResult } from "../../rustc_ast_ir/visit.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import { DefKind, debug_DefKind, debug_Res, type Res, Res_eq } from "../../rustc_hir/def.ts";
import {
  type FnKind,
  type InferKind,
  Visitor,
  walk_anon_const,
  walk_expr,
  walk_fn_kind,
  walk_fn_ret_ty,
  walk_foreign_item,
  walk_impl_item,
  walk_item,
  walk_opaque_ty,
  walk_test_binder_bound_type_constraint,
  walk_trait_item,
  walk_ty,
  walk_ty_pat,
} from "../../rustc_hir/intravisit.ts";
import type { HirTyCtxt } from "../../rustc_hir/intravisit.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import { debug_BodyId, debug_Lifetime, debug_PredicateOrigin, Node } from "../../rustc_hir/hir.ts";
import { debug_HirId, HirId_eq, HirId_from_OwnerId, type HirId } from "../../rustc_hir_id/lib.ts";
import { PerParentDisambiguatorsMap, type PerParentDisambiguatorState } from "../../rustc_hir_id/definitions.ts";
import { Applicability } from "../../rustc_lint_defs/lib.ts";
import { TyCtxt_as_HirTyCtxt } from "../../rustc_middle/hir/map.ts";
import { OnlyBodies } from "../../rustc_middle/hir/nested_filter.ts";
import {
  debug_ResolvedArg,
  default_ResolveBoundVars,
  key_ResolvedArg,
  ObjectLifetimeDefault,
  type ResolveBoundVars,
  ResolvedArg,
  Set1,
} from "../../rustc_middle/middle/resolve_bound_vars.ts";
import type { Providers } from "../../rustc_middle/queries.gen.ts";
import { AssocItems, type AssocItem, type AssocTag } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { GenericParamDef, Generics } from "../../rustc_middle/ty/generics.ts";
import { Asyncness, type Ty } from "../../rustc_middle/ty/mod.ts";
import type { Clause } from "../../rustc_middle/ty/predicate.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { feature_err } from "../../rustc_session/diagnostics.ts";
import { DefIdSet, DefId_eq, debug_DefId, debug_LocalDefId, LocalDefId, type DefId } from "../../rustc_span/def_id.ts";
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import { Span } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { Ident, sym } from "../../rustc_span/symbol.ts";
import { Binder, type BoundVariableKind, debug_BoundVariableKind, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { DebruijnIndex, INNERMOST } from "../../rustc_type_ir/lib.ts";
import type { Const, Region } from "../../rustc_middle/ty/decls.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import type { Span as SpanT } from "../../rustc_span/lib.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { type Debug, debug_map, debug_option, debug_str, debug_struct, debug_vec, type Fmt, PLAIN, PRETTY } from "../../std/fmt.ts";
import { assert, unported, unwrap } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import { Err, Ok } from "../../std/result.ts";
import type * as diagnostics_mod from "../diagnostics.ts";

/** `crate::diagnostics`, read inside function bodies only (init order, header). */
function diagnostics(): typeof diagnostics_mod {
  return require("../diagnostics.ts") as typeof diagnostics_mod;
}

// #[extension(trait ResolvedArgExt)]
// impl ResolvedArg
export const ResolvedArgExt = {
  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:37 early
  early(param: hir.GenericParam): ResolvedArg {
    return { $: "EarlyBound", _0: param.def_id };
  },

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:41 late
  late(idx: number, param: hir.GenericParam): ResolvedArg {
    return { $: "LateBound", _0: INNERMOST, _1: idx, _2: param.def_id };
  },

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:45 id
  id(self: ResolvedArg): LocalDefId | undefined {
    switch (self.$) {
      case "StaticLifetime":
      case "Error":
        return undefined;

      case "EarlyBound":
        return self._0;
      case "LateBound":
        return self._2;
      case "Free":
        return self._1;
    }
  },

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:55 shifted
  shifted(self: ResolvedArg, amount: number): ResolvedArg {
    switch (self.$) {
      case "LateBound": {
        const debruijn = self._0;
        const idx = self._1;
        const id = self._2;
        return { $: "LateBound", _0: DebruijnIndex.shifted_in(debruijn, amount), _1: idx, _2: id };
      }
      default:
        return self;
    }
  },
};

// rustc-type: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:65 BoundVarContext
// (the class is declared after `Scope`, below: it extends `Visitor`)

// rustc-type: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:73 OpaqueHigherRankedLifetimeCaptureErrors
interface OpaqueHigherRankedLifetimeCaptureErrors {
  bad_place: string;
  capture_spans: SpanT[];
  decl_spans: SpanT[];
}

// rustc-type: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:80 Scope
// #[derive(Debug)]
type Scope =
  /// Declares lifetimes, and each can be early-bound or late-bound.
  /// The `DebruijnIndex` of late-bound lifetimes starts at `1` and
  /// it should be shifted by the number of `Binder`s in between the
  /// declaration `Binder` and the location it's referenced from.
  | {
      readonly $: "Binder";
      /// We use an IndexMap here because we want these lifetimes in order
      /// for diagnostics.
      bound_vars: Map<LocalDefId, ResolvedArg>;

      scope_type: BinderScopeType;

      /// The late bound vars for a given item are stored by `HirId` to be
      /// queried later. However, if we enter an elision scope, we have to
      /// later append the elided bound vars to the list and need to know what
      /// to append to.
      hir_id: HirId;

      s: ScopeRef;

      /// If this binder comes from a where clause, specify how it was created.
      /// This is used to diagnose inaccessible lifetimes in APIT:
      /// ```ignore (illustrative)
      /// fn foo(x: impl for<'a> Trait<'a, Assoc = impl Copy + 'a>) {}
      /// ```
      where_bound_origin: hir.PredicateOrigin | undefined;
    }

  /// Lifetimes introduced by a fn are scoped to the call-site for that fn,
  /// if this is a fn body, otherwise the original definitions are used.
  /// Unspecified lifetimes are inferred, unless an elision scope is nested,
  /// e.g., `(&T, fn(&T) -> &T);` becomes `(&'_ T, for<'a> fn(&'a T) -> &'a T)`.
  | {
      readonly $: "Body";
      id: hir.BodyId;
      s: ScopeRef;
    }

  /// Use a specific lifetime (if `Some`) or leave it unset (to be
  /// inferred in a function body or potentially error outside one),
  /// for the default choice of lifetime in a trait object type.
  | {
      readonly $: "ObjectLifetimeDefault";
      lifetime: ResolvedArg | undefined;
      s: ScopeRef;
    }

  /// When we have nested trait refs, we concatenate late bound vars for inner
  /// trait refs from outer ones. But we also need to include any HRTB
  /// lifetimes encountered when identifying the trait that an associated type
  /// is declared on.
  | {
      readonly $: "Supertrait";
      bound_vars: BoundVariableKind[];
      s: ScopeRef;
    }

  | {
      readonly $: "TraitRefBoundary";
      s: ScopeRef;
    }

  /// Remap lifetimes that appear in opaque types to fresh lifetime parameters. Given:
  /// `fn foo<'a>() -> impl MyTrait<'a> { ... }`
  ///
  /// HIR tells us that `'a` refer to the lifetime bound on `foo`.
  /// However, typeck and borrowck for opaques work based on using a new generic type.
  /// `type MyAnonTy<'b> = impl MyTrait<'b>;`
  ///
  /// This scope collects the mapping `'a -> 'b`.
  | {
      readonly $: "Opaque";
      /// The opaque type we are traversing.
      def_id: LocalDefId;
      /// Mapping from each captured lifetime `'a` to the duplicate generic parameter `'b`.
      captures: KeyedMap<ResolvedArg, LocalDefId>;

      s: ScopeRef;
    }

  /// Disallows capturing late-bound vars from parent scopes.
  ///
  /// This is necessary for something like `for<T> [(); { /* references T */ }]:`,
  /// since we don't do something more correct like replacing any captured
  /// late-bound vars with early-bound params in the const's own generics.
  | {
      readonly $: "LateBoundary";
      s: ScopeRef;
      what: string;
      deny_late_regions: boolean;
    }

  | {
      readonly $: "Root";
      opt_parent_item: LocalDefId | undefined;
    };

/** `RefCell<FxIndexMap<ResolvedArg, LocalDefId>>`'s derived Debug (`RefCell { value: {..} }`). */
function debug_captures(v: KeyedMap<ResolvedArg, LocalDefId>, f: Fmt): string {
  return debug_struct(f, "RefCell", [["value", debug_map(f, [...v].map(([k, x]) => [debug_ResolvedArg(k, f), debug_LocalDefId(x, f)]))]]);
}
function debug_bound_vars_map(v: Map<LocalDefId, ResolvedArg>, f: Fmt): string {
  return debug_map(f, [...v].map(([k, x]) => [debug_LocalDefId(k, f), debug_ResolvedArg(x, f)]));
}

/** `#[derive(Debug)]` of `Scope` (every field, in declaration order, the parent scopes included). */
const debug_Scope: Debug<Scope> = (v, f) => {
  switch (v.$) {
    case "Binder":
      return debug_struct(f, "Binder", [
        ["bound_vars", debug_bound_vars_map(v.bound_vars, f)],
        ["scope_type", debug_BinderScopeType(v.scope_type, f)],
        ["hir_id", debug_HirId(v.hir_id, f)],
        ["s", debug_Scope(v.s, f)],
        ["where_bound_origin", debug_option(v.where_bound_origin, f, debug_PredicateOrigin)],
      ]);
    case "Body":
      return debug_struct(f, "Body", [
        ["id", debug_BodyId(v.id, f)],
        ["s", debug_Scope(v.s, f)],
      ]);
    case "ObjectLifetimeDefault":
      return debug_struct(f, "ObjectLifetimeDefault", [
        ["lifetime", debug_option(v.lifetime, f, debug_ResolvedArg)],
        ["s", debug_Scope(v.s, f)],
      ]);
    case "Supertrait":
      return debug_struct(f, "Supertrait", [
        ["bound_vars", debug_vec(v.bound_vars, f, debug_BoundVariableKind)],
        ["s", debug_Scope(v.s, f)],
      ]);
    case "TraitRefBoundary":
      return debug_struct(f, "TraitRefBoundary", [["s", debug_Scope(v.s, f)]]);
    case "Opaque":
      return debug_struct(f, "Opaque", [
        ["def_id", debug_LocalDefId(v.def_id, f)],
        ["captures", debug_captures(v.captures, f)],
        ["s", debug_Scope(v.s, f)],
      ]);
    case "LateBoundary":
      return debug_struct(f, "LateBoundary", [
        ["s", debug_Scope(v.s, f)],
        ["what", debug_str(v.what)],
        ["deny_late_regions", String(v.deny_late_regions)],
      ]);
    case "Root":
      return debug_struct(f, "Root", [["opt_parent_item", debug_option(v.opt_parent_item, f, debug_LocalDefId)]]);
  }
};

// impl<'a, 'tcx> Scope<'a, 'tcx>
const Scope = {
  // A helper for debugging scopes without printing parent scopes
  // PORT: `impl fmt::Debug` (`fmt::from_fn`) -> a `Debug`-shaped closure over `f`.
  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:173 debug_truncated
  debug_truncated(self: Scope): (f: Fmt) => string {
    return (f) => {
      switch (self.$) {
        case "Binder":
          return debug_struct(f, "Binder", [
            ["bound_vars", debug_bound_vars_map(self.bound_vars, f)],
            ["scope_type", debug_BinderScopeType(self.scope_type, f)],
            ["hir_id", debug_HirId(self.hir_id, f)],
            ["where_bound_origin", debug_option(self.where_bound_origin, f, debug_PredicateOrigin)],
            ["s", debug_str("..")],
          ]);
        case "Opaque":
          return debug_struct(f, "Opaque", [
            ["def_id", debug_LocalDefId(self.def_id, f)],
            // `&captures.borrow()`: a `Ref` prints its target
            ["captures", debug_map(f, [...self.captures].map(([k, x]) => [debug_ResolvedArg(k, f), debug_LocalDefId(x, f)]))],
            ["s", debug_str("..")],
          ]);
        case "Body":
          return debug_struct(f, "Body", [
            ["id", debug_BodyId(self.id, f)],
            ["s", debug_str("..")],
          ]);
        case "ObjectLifetimeDefault":
          return debug_struct(f, "ObjectLifetimeDefault", [
            ["lifetime", debug_option(self.lifetime, f, debug_ResolvedArg)],
            ["s", debug_str("..")],
          ]);
        case "Supertrait":
          return debug_struct(f, "Supertrait", [
            ["bound_vars", debug_vec(self.bound_vars, f, debug_BoundVariableKind)],
            ["s", debug_str("..")],
          ]);
        case "TraitRefBoundary":
          return debug_struct(f, "TraitRefBoundary", []);
        case "LateBoundary":
          return debug_struct(f, "LateBoundary", [
            ["what", debug_str(self.what)],
            ["deny_late_regions", String(self.deny_late_regions)],
          ]);
        case "Root":
          return debug_struct(f, "Root", [["opt_parent_item", debug_option(self.opt_parent_item, f, debug_LocalDefId)]]);
      }
    };
  },
};

// rustc-type: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:216 BinderScopeType
// #[derive(Copy, Clone, Debug)]
type BinderScopeType =
  /// Any non-concatenating binder scopes.
  | "Normal"
  /// Within a syntactic trait ref, there may be multiple poly trait refs that
  /// are nested (under the `associated_type_bounds` feature). The binders of
  /// the inner poly trait refs are extended from the outer poly trait refs
  /// and don't increase the late bound depth. If you had
  /// `T: for<'a>  Foo<Bar: for<'b> Baz<'a, 'b>>`, then the `for<'b>` scope
  /// would be `Concatenating`. This also used in trait refs in where clauses
  /// where we have two binders `for<> T: for<> Foo` (I've intentionally left
  /// out any lifetimes because they aren't needed to show the two scopes).
  /// The inner `for<>` has a scope of `Concatenating`.
  | "Concatenating";
const debug_BinderScopeType: Debug<BinderScopeType> = (v) => v;

type ScopeRef = Scope;

/// Adds query implementations to the [Providers] vtable, see [`rustc_middle::query`]
// PORT: the query values are typed `unknown` in queries.gen.ts (no typemap entries for middle/resolve_bound_vars.rs yet):
// the closures cast `tcx.resolve_bound_vars(..)` to `ResolveBoundVars`.
// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:234 provide
export function provide(providers: Providers): void {
  // `*providers = Providers { .., ..*providers }`
  providers.resolve_bound_vars = resolve_bound_vars;

  providers.named_variable_map = (tcx, id) => (tcx.resolve_bound_vars(id) as ResolveBoundVars).defs;
  providers.is_late_bound_map = is_late_bound_map;
  providers.object_lifetime_default = object_lifetime_default;
  providers.late_bound_vars_map = (tcx, id) => (tcx.resolve_bound_vars(id) as ResolveBoundVars).late_bound_vars;
  providers.opaque_captured_lifetimes = (tcx, id) => {
    const x = (tcx.resolve_bound_vars(tcx.local_def_id_to_hir_id(id).owner) as ResolveBoundVars).opaque_captured_lifetimes.get(id);
    return x === undefined ? [] : x;
  };
}

/// Computes the `ResolveBoundVars` map that contains data for an entire `Item`.
/// You should not read the result of this query directly, but rather use
/// `named_variable_map`, `late_bound_vars_map`, etc.
// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:257 resolve_bound_vars
export function resolve_bound_vars(tcx: TyCtxt, local_def_id: hir.OwnerId): ResolveBoundVars {
  const rbv = default_ResolveBoundVars();
  const visitor = new BoundVarContext(tcx, rbv, new Map(), { $: "Root", opt_parent_item: undefined }, undefined);
  const node = tcx.hir_owner_node(local_def_id);
  switch (node.$) {
    case "Item":
      visitor.visit_item(node._0);
      break;
    case "ForeignItem":
      visitor.visit_foreign_item(node._0);
      break;
    case "TraitItem": {
      const item = node._0;
      const scope: Scope = { $: "Root", opt_parent_item: tcx.local_parent(item.owner_id.def_id) };
      visitor.scope = scope;
      visitor.visit_trait_item(item);
      break;
    }
    case "ImplItem": {
      const item = node._0;
      const scope: Scope = { $: "Root", opt_parent_item: tcx.local_parent(item.owner_id.def_id) };
      visitor.scope = scope;
      visitor.visit_impl_item(item);
      break;
    }
    case "Crate":
      break;
    case "Synthetic":
      return unreachable_();
  }

  // debug!(?rbv.defs);
  // debug!(?rbv.late_bound_vars);
  // debug!(?rbv.opaque_captured_lifetimes);
  return rbv;
}

/** `unreachable!()` */
function unreachable_(): never {
  return bug("internal error: entered unreachable code");
}

// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:291 late_arg_as_bound_arg
export function late_arg_as_bound_arg(param: hir.GenericParam): BoundVariableKind {
  const def_id = LocalDefId.to_def_id(param.def_id);
  switch (param.kind.$) {
    case "Lifetime":
      return { $: "Region", _0: { $: "Named", _0: def_id } };
    case "Type":
      return { $: "Ty", _0: { $: "Param", _0: def_id } };
    case "Const":
      return { $: "Const" };
  }
}

/// Turn a [`ty::GenericParamDef`] into a bound arg. Generally, this should only
/// be used when turning early-bound vars into late-bound vars when lowering
/// return type notation.
// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:305 generic_param_def_as_bound_arg
export function generic_param_def_as_bound_arg(param: GenericParamDef): BoundVariableKind {
  switch (param.kind.$) {
    case "Lifetime":
      return { $: "Region", _0: { $: "Named", _0: param.def_id } };
    case "Type":
      return { $: "Ty", _0: { $: "Param", _0: param.def_id } };
    case "Const":
      return { $: "Const" };
  }
}

/// Whether this opaque always captures lifetimes in scope.
/// Right now, this is all RPITIT and TAITs, and when the opaque
/// is coming from a span corresponding to edition 2024.
// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:322 opaque_captures_all_in_scope_lifetimes
export function opaque_captures_all_in_scope_lifetimes(opaque: hir.OpaqueTy): boolean {
  const origin = opaque.origin;
  // if the opaque has the `use<...>` syntax, the user is telling us that they only want
  // to account for those lifetimes, so do not try to be clever.
  if (opaque.bounds.some((bound) => bound.$ === "Use")) {
    return false;
  } else if (origin.$ === "AsyncFn" || origin.$ === "TyAlias") {
    return true;
  } else if (Span.at_least_rust_2024(opaque.span)) {
    return true;
  } else {
    // hir::OpaqueTyOrigin::FnReturn { in_trait_or_impl, .. }
    return origin.in_trait_or_impl !== undefined;
  }
}

// rustc-type: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:425 NonLifetimeBinderAllowed
type NonLifetimeBinderAllowed = { readonly $: "Deny"; _0: string } | { readonly $: "Allow" };
const NonLifetimeBinderAllowed = {
  Allow: Object.freeze({ $: "Allow" as const }),
};

class BoundVarContext extends Visitor {
  // impl<'a, 'tcx> Visitor<'tcx> for BoundVarContext<'a, 'tcx>
  // type NestedFilter = nested_filter::OnlyBodies;
  override NestedFilter = OnlyBodies;

  constructor(
    public tcx: TyCtxt,
    public rbv: ResolveBoundVars,
    public disambiguators: Map<LocalDefId, PerParentDisambiguatorState>,
    public scope: ScopeRef,
    // `RefCell<Option<OpaqueHigherRankedLifetimeCaptureErrors>>`
    public opaque_capture_errors: OpaqueHigherRankedLifetimeCaptureErrors | undefined,
  ) {
    super();
  }

  // impl<'a, 'tcx> BoundVarContext<'a, 'tcx>

  /// Returns the binders in scope and the type of `Binder` that should be created for a poly trait ref.
  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:335 poly_trait_ref_binder_info
  poly_trait_ref_binder_info(): [BoundVariableKind[], BinderScopeType] {
    let scope = this.scope;
    let supertrait_bound_vars: BoundVariableKind[] = [];
    for (;;) {
      switch (scope.$) {
        case "Body":
        case "Root": {
          return [[], "Normal"];
        }

        case "Opaque":
        case "ObjectLifetimeDefault":
        case "LateBoundary": {
          scope = scope.s;
          break;
        }

        case "Supertrait": {
          supertrait_bound_vars = [...scope.bound_vars];
          scope = scope.s;
          break;
        }

        case "TraitRefBoundary": {
          // We should only see super trait lifetimes if there is a `Binder` above
          // though this may happen when we call `poly_trait_ref_binder_info` with
          // an (erroneous, #113423) associated return type bound in an impl header.
          if (supertrait_bound_vars.length !== 0) {
            this.tcx
              .dcx()
              .delayed_bug(`found supertrait lifetimes without a binder to append them to: ${debug_vec(supertrait_bound_vars, PLAIN, debug_BoundVariableKind)}`);
          }
          return [[], "Normal"];
        }

        case "Binder": {
          const hir_id = scope.hir_id;
          // Nested poly trait refs have the binders concatenated
          // PORT: `SortedMap::get_mut_or_insert_default` (not ported in sorted_map.ts) inlined.
          let entry = this.rbv.late_bound_vars.get(hir_id.local_id);
          if (entry === undefined) {
            entry = [];
            this.rbv.late_bound_vars.insert(hir_id.local_id, entry);
          }
          const full_binders: BoundVariableKind[] = [...entry];
          full_binders.push(...supertrait_bound_vars);
          return [full_binders, "Concatenating"];
        }
      }
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:381 visit_poly_trait_ref_inner
  visit_poly_trait_ref_inner(trait_ref: hir.PolyTraitRef, non_lifetime_binder_allowed: NonLifetimeBinderAllowed): void {
    // debug!("visit_poly_trait_ref(trait_ref={:?})", trait_ref);

    const [binders, scope_type] = this.poly_trait_ref_binder_info();

    const initial_bound_vars = binders.length;
    const bound_vars = new Map<LocalDefId, ResolvedArg>();
    trait_ref.bound_generic_params.forEach((param, late_bound_idx) => {
      const arg = ResolvedArgExt.late(initial_bound_vars + late_bound_idx, param);
      bound_vars.set(param.def_id, arg);
      binders.push(late_arg_as_bound_arg(param));
    });

    if (non_lifetime_binder_allowed.$ === "Deny") {
      const where_ = non_lifetime_binder_allowed._0;
      deny_non_region_late_bound(this.tcx, bound_vars, where_);
    }

    // debug!(?binders);
    this.record_late_bound_vars(trait_ref.trait_ref.hir_ref_id, binders);

    // Always introduce a scope here, even if this is in a where clause and
    // we introduced the binders around the bounded Ty. In that case, we
    // just reuse the concatenation functionality also present in nested trait
    // refs.
    const scope: Scope = {
      $: "Binder",
      hir_id: trait_ref.trait_ref.hir_ref_id,
      bound_vars,
      s: this.scope,
      scope_type,
      where_bound_origin: undefined,
    };
    this.with(scope, (this_) => {
      for (const p of trait_ref.bound_generic_params) this_.visit_generic_param(p);
      this_.visit_trait_ref(trait_ref.trait_ref);
    });
  }

  // impl<'a, 'tcx> Visitor<'tcx> for BoundVarContext<'a, 'tcx>

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:433 maybe_tcx
  override maybe_tcx(): HirTyCtxt {
    return TyCtxt_as_HirTyCtxt(this.tcx);
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:437 visit_nested_body
  override visit_nested_body(body_id: hir.BodyId): undefined {
    const body = this.tcx.hir_body(body_id);
    this.with({ $: "Body", id: body.id(), s: this.scope }, (this_) => {
      this_.visit_body(body);
    });
    return undefined;
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:444 visit_expr
  override visit_expr(e: hir.Expr): undefined {
    if (e.kind.$ === "Closure") {
      const { binder, bound_generic_params, fn_decl } = e.kind._0;
      if (binder.$ === "For") {
        const for_sp = binder.span;
        // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:450 span_of_infer
        const span_of_infer = (ty: hir.Ty): SpanT | undefined => {
          /// Look for `_` anywhere in the signature of a `for<> ||` closure.
          /// This is currently disallowed.
          class FindInferInClosureWithBinder extends Visitor<ControlFlow<SpanT>> {
            // type Result = ControlFlow<Span>;
            override Result = VisitorResult.ControlFlow<SpanT>();

            // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:457 visit_infer
            override visit_infer(_inf_id: HirId, inf_span: SpanT, _kind: InferKind): ControlFlow<SpanT> {
              return ControlFlow.Break(inf_span);
            }
          }
          // `.break_value()`
          const r = new FindInferInClosureWithBinder().visit_ty_unambig(ty);
          return r.$ === "Break" ? r._0 : undefined;
        };

        let infer_in_rt_sp: SpanT | undefined;
        switch (fn_decl.output.$) {
          case "DefaultReturn":
            infer_in_rt_sp = fn_decl.output._0;
            break;
          case "Return":
            infer_in_rt_sp = span_of_infer(fn_decl.output._0);
            break;
        }

        const infer_spans: SpanT[] = [];
        for (const input of fn_decl.inputs) {
          const sp = span_of_infer(input);
          if (sp !== undefined) infer_spans.push(sp);
        }
        if (infer_in_rt_sp !== undefined) infer_spans.push(infer_in_rt_sp);

        if (infer_spans.length !== 0) {
          this.tcx.dcx().emit_err(diagnostics().ClosureImplicitHrtb_diagnostic({ spans: infer_spans, for_sp }));
        }
      }

      const bound_vars = new Map<LocalDefId, ResolvedArg>();
      const binders: BoundVariableKind[] = [];
      bound_generic_params.forEach((param, late_bound_idx) => {
        bound_vars.set(param.def_id, ResolvedArgExt.late(late_bound_idx, param));
        binders.push(late_arg_as_bound_arg(param));
      });

      deny_non_region_late_bound(this.tcx, bound_vars, "closures");

      this.record_late_bound_vars(e.hir_id, binders);
      const scope: Scope = {
        $: "Binder",
        hir_id: e.hir_id,
        bound_vars,
        s: this.scope,
        scope_type: "Normal",
        where_bound_origin: undefined,
      };

      this.with(scope, (this_) => {
        // a closure has no bounds, so everything
        // contained within is scoped within its binder.
        walk_expr(this_, e);
      });
    } else {
      walk_expr(this, e);
    }
    return undefined;
  }

  /// Resolve the lifetimes inside the opaque type, and save them into
  /// `opaque_captured_lifetimes`.
  ///
  /// This method has special handling for opaques that capture all lifetimes,
  /// like async desugaring.
  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:527 visit_opaque_ty
  override visit_opaque_ty(opaque: hir.OpaqueTy): undefined {
    const captures = new KeyedMap<ResolvedArg, LocalDefId>(key_ResolvedArg);

    const capture_all_in_scope_lifetimes = opaque_captures_all_in_scope_lifetimes(opaque);
    if (capture_all_in_scope_lifetimes) {
      const tcx = this.tcx;
      const lifetime_ident = (def_id: LocalDefId): Ident => {
        const name = tcx.item_name(LocalDefId.to_def_id(def_id));
        const span = tcx.def_span(def_id);
        return Ident.new(name, span);
      };

      // We list scopes outwards, this causes us to see lifetime parameters in reverse
      // declaration order. In order to make it consistent with what `generics_of` might
      // give, we will reverse the IndexMap after early captures.
      let late_depth = 0;
      let scope = this.scope;
      const opaque_capture_scopes: [LocalDefId, KeyedMap<ResolvedArg, LocalDefId>][] = [[opaque.def_id, captures]];
      loop: for (;;) {
        switch (scope.$) {
          case "Binder": {
            const { bound_vars, scope_type, s } = scope;
            for (const [original_lifetime, def_] of [...bound_vars].reverse()) {
              if (this.tcx.def_kind(original_lifetime).$ === "LifetimeParam") {
                const def = ResolvedArgExt.shifted(def_, late_depth);
                const ident = lifetime_ident(original_lifetime);
                this.remap_opaque_captures(opaque_capture_scopes, def, ident);
              }
            }
            switch (scope_type) {
              case "Normal":
                late_depth += 1;
                break;
              case "Concatenating":
                break;
            }
            scope = s;
            break;
          }

          case "Root": {
            let opt_parent_item = scope.opt_parent_item;
            while (opt_parent_item !== undefined) {
              const parent_item = opt_parent_item;
              const parent_generics = this.tcx.generics_of(parent_item) as Generics;
              for (const param of [...parent_generics.own_params].reverse()) {
                if (param.kind.$ === "Lifetime") {
                  const def: ResolvedArg = { $: "EarlyBound", _0: param.def_id.expect_local() };
                  const ident = lifetime_ident(param.def_id.expect_local());
                  this.remap_opaque_captures(opaque_capture_scopes, def, ident);
                }
              }
              opt_parent_item = parent_generics.parent?.as_local();
            }
            break loop;
          }

          case "Opaque": {
            const { captures, def_id, s } = scope;
            opaque_capture_scopes.push([def_id, captures]);
            late_depth = 0;
            scope = s;
            break;
          }

          case "Body": {
            return bug(debug_Scope(scope, PLAIN));
          }

          case "ObjectLifetimeDefault":
          case "Supertrait":
          case "TraitRefBoundary":
          case "LateBoundary": {
            scope = scope.s;
            break;
          }
        }
      }
      // `captures.borrow_mut().reverse()` (IndexMap::reverse)
      const reversed = [...captures].reverse();
      captures.clear();
      for (const [k, v] of reversed) captures.set(k, v);
    }

    const scope: Scope = { $: "Opaque", captures, def_id: opaque.def_id, s: this.scope };
    this.with(scope, (this_) => {
      const scope: Scope = { $: "TraitRefBoundary", s: this_.scope };
      this_.with(scope, (this_) => {
        const scope: Scope = {
          $: "LateBoundary",
          s: this_.scope,
          what: "nested `impl Trait`",
          // We can capture late-bound regions; we just don't duplicate
          // lifetime or const params, so we can't allow those.
          deny_late_regions: false,
        };
        this_.with(scope, (this_) => walk_opaque_ty(this_, opaque));
      });
    });

    this.emit_opaque_capture_errors();

    const captures_: [ResolvedArg, LocalDefId][] = [...captures];
    // debug!(?captures);
    this.rbv.opaque_captured_lifetimes.set(opaque.def_id, captures_);
    return undefined;
  }

  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:621 visit_item
  override visit_item(item: hir.Item): undefined {
    if (item.kind.$ === "Impl" && item.kind._0.of_trait !== undefined) {
      const of_trait = item.kind._0.of_trait;
      this.record_late_bound_vars(of_trait.trait_ref.hir_ref_id, []);
    }
    const kind = item.kind;
    switch (kind.$) {
      case "Fn": {
        const generics = kind.generics;
        this.visit_early_late(item.hir_id(), generics, (this_) => {
          walk_item(this_, item);
        });
        break;
      }

      case "ExternCrate":
      case "Use":
      case "Macro":
      case "Mod":
      case "ForeignMod":
      case "Static":
      case "GlobalAsm": {
        // These sorts of items have no lifetime parameters at all.
        walk_item(this, item);
        break;
      }
      case "TyAlias":
      case "Const":
      case "Enum":
      case "Struct":
      case "Union":
      case "Trait":
      case "TraitAlias":
      case "Impl":
      case "TestBinderConstraints": {
        let generics: hir.Generics;
        switch (kind.$) {
          case "TyAlias":
          case "Const":
          case "Enum":
          case "Struct":
          case "Union":
            generics = kind._1;
            break;
          case "Trait":
          case "TestBinderConstraints":
            generics = kind.generics;
            break;
          case "TraitAlias":
            generics = kind._2;
            break;
          case "Impl":
            generics = kind._0.generics;
            break;
        }
        // These kinds of items have only early-bound lifetime parameters.
        this.visit_early(item.hir_id(), generics, (this_) => walk_item(this_, item));
        break;
      }
    }
    return undefined;
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:659 visit_precise_capturing_arg
  override visit_precise_capturing_arg(arg: hir.PreciseCapturingArg): undefined {
    switch (arg.$) {
      case "Lifetime": {
        const lt = arg._0;
        switch (lt.kind.$) {
          case "Param": {
            const def_id = lt.kind._0;
            this.resolve_lifetime_ref(def_id, lt);
            break;
          }
          case "Error":
            break;
          case "ImplicitObjectLifetimeDefault":
          case "Infer":
          case "Static": {
            // PORT: `diagnostics::BadPreciseCapture` is in diagnostics/precise_captures.rs, which is in no codegen set.
            // `emit_err(BadPreciseCapture { span: lt.ident.span, kind: "lifetime", found: format!("`{}`", lt.ident.name) })`
            return unported("rustc_hir_analysis::diagnostics::precise_captures::BadPreciseCapture");
          }
        }
        break;
      }
      case "Param": {
        const param = arg._0;
        const res = param.res;
        if (res.$ === "Def" && (res._0.$ === "TyParam" || res._0.$ === "ConstParam")) {
          const def_id = res._1;
          this.resolve_type_ref(def_id.expect_local(), param.hir_id);
        } else if (res.$ === "SelfTyParam") {
          const def_id = res.trait_;
          this.resolve_type_ref(def_id.expect_local(), param.hir_id);
        } else if (res.$ === "SelfTyAlias") {
          // PORT: `diagnostics::PreciseCaptureSelfAlias` is in diagnostics/precise_captures.rs, which is in no codegen
          // set.
          return unported("rustc_hir_analysis::diagnostics::precise_captures::PreciseCaptureSelfAlias");
        } else {
          this.tcx.dcx().span_delayed_bug(param.ident.span, `expected type or const param, found ${debug_Res(res, PLAIN, debug_HirId)}`);
        }
        break;
      }
    }
    return undefined;
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:701 visit_foreign_item
  override visit_foreign_item(item: hir.ForeignItem): undefined {
    switch (item.kind.$) {
      case "Fn": {
        const generics = item.kind._2;
        this.visit_early_late(item.hir_id(), generics, (this_) => {
          walk_foreign_item(this_, item);
        });
        break;
      }
      case "Static": {
        walk_foreign_item(this, item);
        break;
      }
      case "Type": {
        walk_foreign_item(this, item);
        break;
      }
    }
    return undefined;
  }

  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:718 visit_ty
  override visit_ty(ty: hir.Ty<hir.AmbigArg>): undefined {
    const kind = ty.kind;
    switch (kind.$) {
      case "FnPtr": {
        const c = kind._0;
        const bound_vars = new Map<LocalDefId, ResolvedArg>();
        const binders: BoundVariableKind[] = [];
        c.generic_params.forEach((param, late_bound_idx) => {
          bound_vars.set(param.def_id, ResolvedArgExt.late(late_bound_idx, param));
          binders.push(late_arg_as_bound_arg(param));
        });

        deny_non_region_late_bound(this.tcx, bound_vars, "function pointer types");

        this.record_late_bound_vars(ty.hir_id, binders);
        const scope: Scope = {
          $: "Binder",
          hir_id: ty.hir_id,
          bound_vars,
          s: this.scope,
          scope_type: "Normal",
          where_bound_origin: undefined,
        };
        this.with(scope, (this_) => {
          // a FnPtr has no bounds, so everything within is scoped within its binder
          walk_ty(this_, ty);
        });
        break;
      }
      case "UnsafeBinder": {
        const binder = kind._0;
        const bound_vars = new Map<LocalDefId, ResolvedArg>();
        const binders: BoundVariableKind[] = [];
        binder.generic_params.forEach((param, late_bound_idx) => {
          bound_vars.set(param.def_id, ResolvedArgExt.late(late_bound_idx, param));
          binders.push(late_arg_as_bound_arg(param));
        });

        deny_non_region_late_bound(this.tcx, bound_vars, "function pointer types");

        this.record_late_bound_vars(ty.hir_id, binders);
        const scope: Scope = {
          $: "Binder",
          hir_id: ty.hir_id,
          bound_vars,
          s: this.scope,
          scope_type: "Normal",
          where_bound_origin: undefined,
        };
        this.with(scope, (this_) => {
          // everything within is scoped within its binder
          walk_ty(this_, ty);
        });
        break;
      }
      case "TraitObject": {
        const bounds = kind._0;
        const lifetime = kind._1.pointer();

        // debug!(?bounds, ?lifetime, "TraitObject");
        const scope: Scope = { $: "TraitRefBoundary", s: this.scope };
        this.with(scope, (this_) => {
          for (const bound of bounds) {
            this_.visit_poly_trait_ref_inner(bound, { $: "Deny", _0: "trait object types" });
          }
        });
        switch (lifetime.kind.$) {
          case "ImplicitObjectLifetimeDefault": {
            // If the user doesn't write *anything*, we apply the
            // trait object lifetime defaulting rules.
            // E.g., `Box<dyn Debug>` becomes `Box<dyn Debug + 'static>`.
            this.resolve_object_lifetime_default(lifetime);
            break;
          }
          case "Infer": {
            // If the user writes `'_`, we use the *ordinary* elision
            // rules. So the `'_` in e.g., `Box<dyn Debug + '_>` will be
            // resolved the same as the `'_` in `&'_ Foo`.
            //
            // cc #48468
            break;
          }
          case "Param":
          case "Static": {
            // If the user wrote an explicit name, use that.
            this.visit_lifetime(lifetime);
            break;
          }
          case "Error":
            break;
        }
        break;
      }
      case "Ref": {
        const lifetime_ref = kind._0;
        const inner_ty = kind._1;
        this.visit_lifetime(lifetime_ref);
        const scope: Scope = {
          $: "ObjectLifetimeDefault",
          lifetime: this.rbv.defs.get(lifetime_ref.hir_id.local_id),
          s: this.scope,
        };
        this.with(scope, (this_) => this_.visit_ty_unambig(inner_ty));
        break;
      }
      case "TraitAscription": {
        const bounds = kind._0;
        const scope: Scope = { $: "TraitRefBoundary", s: this.scope };
        this.with(scope, (this_) => {
          const scope: Scope = {
            $: "LateBoundary",
            s: this_.scope,
            what: "`impl Trait` in binding",
            deny_late_regions: true,
          };
          this_.with(scope, (this_) => {
            for (const bound of bounds) {
              this_.visit_param_bound(bound);
            }
          });
        });
        break;
      }
      default:
        walk_ty(this, ty);
    }
    return undefined;
  }

  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:839 visit_pattern_type_pattern
  override visit_pattern_type_pattern(p: hir.TyPat): undefined {
    return walk_ty_pat(this, p);
  }

  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:844 visit_trait_item
  override visit_trait_item(trait_item: hir.TraitItem): undefined {
    // use self::hir::TraitItemKind::*;
    const kind = trait_item.kind;
    switch (kind.$) {
      case "Fn": {
        this.visit_early_late(trait_item.hir_id(), trait_item.generics, (this_) => {
          walk_trait_item(this_, trait_item);
        });
        break;
      }
      case "Type": {
        const bounds = kind._0;
        const ty = kind._1;
        this.visit_early(trait_item.hir_id(), trait_item.generics, (this_) => {
          this_.visit_generics(trait_item.generics);
          for (const bound of bounds) {
            this_.visit_param_bound(bound);
          }
          if (ty !== undefined) {
            this_.visit_ty_unambig(ty);
          }
        });
        break;
      }
      case "Const":
        this.visit_early(trait_item.hir_id(), trait_item.generics, (this_) => {
          walk_trait_item(this_, trait_item);
        });
        break;
    }
    return undefined;
  }

  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:870 visit_impl_item
  override visit_impl_item(impl_item: hir.ImplItem): undefined {
    // use self::hir::ImplItemKind::*;
    const kind = impl_item.kind;
    switch (kind.$) {
      case "Fn":
        this.visit_early_late(impl_item.hir_id(), impl_item.generics, (this_) => {
          walk_impl_item(this_, impl_item);
        });
        break;
      case "Type": {
        const ty = kind._0;
        this.visit_early(impl_item.hir_id(), impl_item.generics, (this_) => {
          this_.visit_generics(impl_item.generics);
          this_.visit_ty_unambig(ty);
        });
        break;
      }
      case "Const":
        this.visit_early(impl_item.hir_id(), impl_item.generics, (this_) => {
          walk_impl_item(this_, impl_item);
        });
        break;
    }
    return undefined;
  }

  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:887 visit_lifetime
  override visit_lifetime(lifetime_ref: hir.Lifetime): undefined {
    const kind = lifetime_ref.kind;
    switch (kind.$) {
      case "Static":
        this.insert_lifetime(lifetime_ref, ResolvedArg.StaticLifetime);
        break;
      case "Param": {
        const param_def_id = kind._0;
        this.resolve_lifetime_ref(param_def_id, lifetime_ref);
        break;
      }
      // Keep track of lifetimes about which errors have already been reported
      case "Error": {
        const guar = kind._0;
        this.insert_lifetime(lifetime_ref, { $: "Error", _0: guar });
        break;
      }
      // Those will be resolved by typechecking.
      case "ImplicitObjectLifetimeDefault":
      case "Infer":
        break;
    }
    return undefined;
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:904 visit_qpath
  override visit_qpath(qpath: hir.QPath, id: HirId, _: SpanT): undefined {
    switch (qpath.$) {
      case "Resolved": {
        const maybe_qself = qpath._0;
        const path = qpath._1;
        // Visit the path before the self type since computing the trait object lifetime
        // default for the latter requires all lifetime arguments of the trait ref to be
        // already resolved.
        this.visit_path(path, id);
        if (maybe_qself !== undefined) {
          const qself = maybe_qself;
          const container = this.eligible_container(path, new RevSegIdx(1).reverse(path.segments));

          const object_lifetime_defaults =
            container === undefined
              ? []
              : ((): (ResolvedArg | undefined)[] => {
                  const [def_id, segs] = container;
                  const generics = this.tcx.generics_of(def_id) as Generics;
                  return this.compute_object_lifetime_defaults(generics, segs);
                })();

          if (object_lifetime_defaults.length > 0) {
            const lt = object_lifetime_defaults[0];
            const scope: Scope = { $: "ObjectLifetimeDefault", lifetime: lt, s: this.scope };
            this.with(scope, (this_) => this_.visit_ty_unambig(qself));
          } else {
            this.visit_ty_unambig(qself);
          }
        }
        break;
      }
      case "TypeRelative": {
        const qself = qpath._0;
        const segment = qpath._1;
        // Computing the trait object lifetime defaults that are induced by type-relative
        // paths would require full type-dependent resolution as performed by HIR ty
        // lowering whose results we don't have access to here (esp. in ItemCtxts which
        // don't "persist" any resolutions during lowering).
        // For maximum forward compatibility, in ItemCtxts we make HIR ty lowering reject
        // implicit trait object lifetime bounds inside such paths on grounds of
        // the default being *indeterminate*.
        // FIXME: Figure out if there's a feasible way to obtain the map of type-dependent
        //        definitions here / interleave RBV and HIR ty lowering.
        const scope: Scope = { $: "ObjectLifetimeDefault", lifetime: undefined, s: this.scope };
        this.with(scope, (this_) => {
          this_.visit_ty_unambig(qself);
          this_.visit_path_segment(segment);
        });
        break;
      }
    }
    return undefined;
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:948 visit_path
  override visit_path(path: hir.Path, hir_id: HirId): undefined {
    path.segments.forEach((segment, index) => {
      if (segment.args !== undefined) {
        const args = segment.args;
        this.visit_path_segment_args(args, new SegIdx(index), path);
      }
    });
    const res = path.res;
    if (res.$ === "Def" && (res._0.$ === "TyParam" || res._0.$ === "ConstParam")) {
      const param_def_id = res._1;
      this.resolve_type_ref(param_def_id.expect_local(), hir_id);
    }
    return undefined;
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:959 visit_fn
  override visit_fn(fk: FnKind, fd: hir.FnDecl, body_id: hir.BodyId, _: SpanT, def_id: LocalDefId): undefined {
    let output: hir.Ty | undefined;
    switch (fd.output.$) {
      case "DefaultReturn":
        output = undefined;
        break;
      case "Return":
        output = fd.output._0;
        break;
    }
    if (output !== undefined && output.kind.$ === "InferDelegation" && output.kind._0.$ === "Sig") {
      const sig_id = output.kind._0._0;
      // PORT: the `fn_sig` query's value is typed `unknown` in queries.gen.ts; it is `EarlyBinder<PolyFnSig>`.
      const bound_vars: BoundVariableKind[] = [...Binder.bound_vars(EarlyBinder.skip_binder(this.tcx.fn_sig(sig_id) as EarlyBinder<Binder<unknown>>))];
      const hir_id = this.tcx.local_def_id_to_hir_id(def_id);
      this.rbv.late_bound_vars.insert(hir_id.local_id, bound_vars);
    }
    this.visit_fn_like_elision(fd.inputs, output, fk.$ === "Closure");
    walk_fn_kind(this, fk);
    return this.visit_nested_body(body_id);
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:984 visit_generics
  override visit_generics(generics: hir.Generics): undefined {
    const scope: Scope = { $: "TraitRefBoundary", s: this.scope };
    this.with(scope, (this_) => {
      for (const p of generics.params) this_.visit_generic_param(p);
      for (const p of generics.predicates) this_.visit_where_predicate(p);
    });
    return undefined;
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:992 visit_where_predicate
  override visit_where_predicate(predicate: hir.WherePredicate): undefined {
    const hir_id = predicate.hir_id;
    const kind = predicate.kind;
    switch (kind.$) {
      case "BoundPredicate": {
        const { bounded_ty, bounds, bound_generic_params, origin } = kind._0;
        const bound_vars = new Map<LocalDefId, ResolvedArg>();
        const binders: BoundVariableKind[] = [];
        bound_generic_params.forEach((param, late_bound_idx) => {
          bound_vars.set(param.def_id, ResolvedArgExt.late(late_bound_idx, param));
          binders.push(late_arg_as_bound_arg(param));
        });

        this.record_late_bound_vars(hir_id, binders);

        // If this is an RTN type in the self type, then append those to the binder.
        this.try_append_return_type_notation_params(hir_id, bounded_ty);

        // Even if there are no lifetimes defined here, we still wrap it in a binder
        // scope. If there happens to be a nested poly trait ref (an error), that
        // will be `Concatenating` anyways, so we don't have to worry about the depth
        // being wrong.
        const scope: Scope = {
          $: "Binder",
          hir_id,
          bound_vars,
          s: this.scope,
          scope_type: "Normal",
          where_bound_origin: origin,
        };
        this.with(scope, (this_) => {
          for (const p of bound_generic_params) this_.visit_generic_param(p);
          this_.visit_ty_unambig(bounded_ty);
          for (const b of bounds) this_.visit_param_bound(b);
        });
        break;
      }
      case "RegionPredicate": {
        const { lifetime, bounds } = kind._0;
        this.visit_lifetime(lifetime);
        for (const b of bounds) this.visit_param_bound(b);
        break;
      }
    }
    return undefined;
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:1047 visit_poly_trait_ref
  override visit_poly_trait_ref(trait_ref: hir.PolyTraitRef): undefined {
    this.visit_poly_trait_ref_inner(trait_ref, NonLifetimeBinderAllowed.Allow);
    return undefined;
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:1051 visit_anon_const
  override visit_anon_const(c: hir.AnonConst): undefined {
    this.with({ $: "LateBoundary", s: this.scope, what: "constant", deny_late_regions: true }, (this_) => {
      walk_anon_const(this_, c);
    });
    return undefined;
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:1060 visit_generic_param
  override visit_generic_param(p: hir.GenericParam): undefined {
    switch (p.kind.$) {
      case "Type":
      case "Const": {
        this.resolve_type_ref(p.def_id, p.hir_id);
        break;
      }
      case "Lifetime": {
        // No need to resolve lifetime params, we don't use them for things
        // like implicit `?Sized` or const-param-has-ty predicates.
        break;
      }
    }

    const kind = p.kind;
    switch (kind.$) {
      case "Lifetime":
        break;
      case "Type": {
        const default_ = kind.default;
        if (default_ !== undefined) {
          const ty = default_;
          this.visit_ty_unambig(ty);
        }
        break;
      }
      case "Const": {
        const { ty, default: default_ } = kind;
        this.visit_ty_unambig(ty);
        if (default_ !== undefined) {
          this.visit_const_arg_unambig(default_);
        }
        break;
      }
    }
    return undefined;
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:1087 visit_test_binder_forall
  override visit_test_binder_forall(forall: hir.TestBinderForall): undefined {
    const bound_vars = new Map<LocalDefId, ResolvedArg>();
    const binders: BoundVariableKind[] = [];
    forall.generics.params.forEach((param, late_bound_idx) => {
      bound_vars.set(param.def_id, ResolvedArgExt.late(late_bound_idx, param));
      binders.push(late_arg_as_bound_arg(param));
    });
    this.record_late_bound_vars(forall.hir_id, binders);
    const scope: Scope = {
      $: "Binder",
      hir_id: forall.hir_id,
      bound_vars,
      s: this.scope,
      scope_type: "Normal",
      where_bound_origin: undefined,
    };
    this.with(scope, (this_) => {
      this_.visit_generics(forall.generics);
      this_.visit_test_binder_body(forall.body);
    });
    // exit assertions don't have the bound vars in scope
    if (forall.assert_on_exit !== undefined) {
      const assert_on_exit = forall.assert_on_exit;
      this.visit_test_binder_constraint(assert_on_exit);
    }
    return undefined;
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:1121 visit_test_binder_exists
  override visit_test_binder_exists(exists: hir.TestBinderExists): undefined {
    const bound_vars = new Map<LocalDefId, ResolvedArg>();
    const binders: BoundVariableKind[] = [];
    exists.params.forEach((param, late_bound_idx) => {
      bound_vars.set(param.def_id, ResolvedArgExt.late(late_bound_idx, param));
      binders.push(late_arg_as_bound_arg(param));
    });
    this.record_late_bound_vars(exists.hir_id, binders);
    const scope: Scope = {
      $: "Binder",
      hir_id: exists.hir_id,
      bound_vars,
      s: this.scope,
      scope_type: "Normal",
      where_bound_origin: undefined,
    };
    this.with(scope, (this_) => {
      for (const param of exists.params) {
        this_.visit_generic_param(param);
      }
      this_.visit_test_binder_body(exists.body);
    });
    return undefined;
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:1152 visit_test_binder_bound_type_constraint
  override visit_test_binder_bound_type_constraint(bound_type: hir.TestBinderBoundTypeConstraint): undefined {
    const bound_vars = new Map<LocalDefId, ResolvedArg>();
    const binders: BoundVariableKind[] = [];
    bound_type.params.forEach((param, late_bound_idx) => {
      bound_vars.set(param.def_id, ResolvedArgExt.late(late_bound_idx, param));
      binders.push(late_arg_as_bound_arg(param));
    });
    this.record_late_bound_vars(bound_type.hir_id, binders);
    const scope: Scope = {
      $: "Binder",
      hir_id: bound_type.hir_id,
      bound_vars,
      s: this.scope,
      scope_type: "Normal",
      where_bound_origin: undefined,
    };
    this.with(scope, (this_) => {
      walk_test_binder_bound_type_constraint(this_, bound_type);
    });
    return undefined;
  }
}

/** `LifetimeKind`'s derived `PartialEq` (`ErrorGuaranteed` is zero-sized, PORTING §8). */
function LifetimeKind_eq(a: hir.LifetimeKind, b: hir.LifetimeKind): boolean {
  if (a.$ !== b.$) return false;
  return a.$ !== "Param" || a._0 === (b as typeof a)._0;
}

// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:1181 object_lifetime_default
export function object_lifetime_default(tcx: TyCtxt, param_def_id: LocalDefId): ObjectLifetimeDefault {
  // Scan the bounds and where-clauses on parameters to extract bounds of the form `T: 'a`
  // so as to determine the `ObjectLifetimeDefault` for each type parameter.

  let r: Result<[hir.Generics, readonly hir.GenericBound[]], null>;
  const node = tcx.hir_node_by_def_id(param_def_id);
  if (node.$ === "GenericParam") {
    const param = node._0;
    switch (param.source) {
      case "Generics":
        if (param.kind.$ === "Type") {
          r = Ok([unwrap(tcx.hir_get_generics(tcx.local_parent(param_def_id))), []]);
        } else {
          r = Err(null);
        }
        break;
      case "Binder":
        return ObjectLifetimeDefault.Empty;
    }
  } else if (node.$ === "Item" && node._0.kind.$ === "Trait") {
    // For `Self` type parameters
    const { generics, bounds } = node._0.kind;
    r = Ok([generics, bounds]);
  } else {
    r = Err(null);
  }
  if (r.$ !== "Ok") {
    return bug("`object_lifetime_default` must only be called on type parameters");
  }
  const [generics, bounds] = r._0;

  const set = { value: Set1.Empty as Set1<hir.LifetimeKind> };

  const add_outlives_bounds = (bounds: readonly hir.GenericBound[]): void => {
    for (const bound of bounds) {
      if (bound.$ === "Outlives") {
        const lifetime = bound._0;
        Set1.insert(set, lifetime.kind, LifetimeKind_eq);
      }
    }
  };

  add_outlives_bounds(bounds);

  // Look for `Type: ...` where clauses.
  for (const bound of generics.bounds_for_param(param_def_id)) {
    // Ignore `for<'a> Type: ...` as they can change what
    // lifetimes mean (although we could "just" handle it).
    if (bound.bound_generic_params.length === 0) {
      add_outlives_bounds(bound.bounds);
    }
  }

  const s = set.value;
  if (s.$ === "Empty") {
    return ObjectLifetimeDefault.Empty;
  } else if (s.$ === "One" && s._0.$ === "Static") {
    return ObjectLifetimeDefault.Static;
  } else if (s.$ === "One" && s._0.$ === "Param") {
    const param_def_id = s._0._0;
    return { $: "Param", _0: LocalDefId.to_def_id(param_def_id) };
  } else {
    return ObjectLifetimeDefault.Ambiguous;
  }
}

// impl<'a, 'tcx> BoundVarContext<'a, 'tcx>
interface BoundVarContext {
  with(wrap_scope: Scope, f: (this_: BoundVarContext) => void): void;
  record_late_bound_vars(hir_id: HirId, binder: BoundVariableKind[]): void;
  visit_early_late(hir_id: HirId, generics: hir.Generics, walk: (this_: BoundVarContext) => void): void;
  visit_early(hir_id: HirId, generics: hir.Generics, walk: (this_: BoundVarContext) => void): void;
  resolve_lifetime_ref(region_def_id: LocalDefId, lifetime_ref: hir.Lifetime): void;
  check_lifetime_is_capturable(opaque_def_id: LocalDefId, lifetime: ResolvedArg, capture_span: SpanT): Result<undefined, ErrorGuaranteedT>;
  emit_opaque_capture_errors(): ErrorGuaranteedT | undefined;
  remap_opaque_captures(opaque_capture_scopes: readonly [LocalDefId, KeyedMap<ResolvedArg, LocalDefId>][], lifetime: ResolvedArg, ident: Ident): ResolvedArg;
  resolve_type_ref(param_def_id: LocalDefId, hir_id: HirId): void;
  visit_path_segment_args(generic_args: hir.GenericArgs, seg_idx: SegIdx, path: hir.Path): void;
  eligible_container(path: hir.Path, seg_idx: SegIdx): [DefId, readonly hir.PathSegment[]] | undefined;
  compute_object_lifetime_defaults(generics: Generics, segments: readonly hir.PathSegment[]): (ResolvedArg | undefined)[];
  visit_fn_like_elision(inputs: readonly hir.Ty[], output: hir.Ty | undefined, in_closure: boolean): void;
  resolve_object_lifetime_default(lifetime_ref: hir.Lifetime): void;
  insert_lifetime(lifetime_ref: hir.Lifetime, def: ResolvedArg): void;
  try_append_return_type_notation_params(hir_id: HirId, hir_ty: hir.Ty): void;
  for_each_trait_bound_on_res(expected_res: Res): Iterable<DefId>;
}
type ErrorGuaranteedT = import("../../rustc_span/lib.ts").ErrorGuaranteed;

// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:1236 with
BoundVarContext.prototype.with = function (this: BoundVarContext, wrap_scope: Scope, f: (this_: BoundVarContext) => void): void {
  const { tcx, rbv, disambiguators } = this;
  // `RefCell::new(self.opaque_capture_errors.borrow_mut().take())`
  const nested_errors = this.opaque_capture_errors;
  this.opaque_capture_errors = undefined;
  const this_ = new BoundVarContext(tcx, rbv, disambiguators, wrap_scope, nested_errors);
  // let span = debug_span!("scope", scope = ?this.scope.debug_truncated());
  {
    // let _enter = span.enter();
    f(this_);
  }
  this.opaque_capture_errors = this_.opaque_capture_errors;
};

// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:1257 record_late_bound_vars
BoundVarContext.prototype.record_late_bound_vars = function (this: BoundVarContext, hir_id: HirId, binder: BoundVariableKind[]): void {
  const old = this.rbv.late_bound_vars.insert(hir_id.local_id, binder);
  if (old !== undefined) {
    bug(
      `overwrote bound vars for ${debug_HirId(hir_id, PLAIN)}:\nold=${debug_vec(old, PLAIN, debug_BoundVariableKind)}\nnew=${debug_vec(
        unwrap(this.rbv.late_bound_vars.get(hir_id.local_id)),
        PLAIN,
        debug_BoundVariableKind,
      )}`,
    );
  }
};

/// Visits self by adding a scope and handling recursive walk over the contents with `walk`.
///
/// Handles visiting fns and methods. These are a bit complicated because we must distinguish
/// early- vs late-bound lifetime parameters. We do this by checking which lifetimes appear
/// within type bounds; those are early bound lifetimes, and the rest are late bound.
///
/// For example:
///
///    fn foo<'a,'b,'c,T:Trait<'b>>(...)
///
/// Here `'a` and `'c` are late bound but `'b` is early bound. Note that early- and late-bound
/// lifetimes may be interspersed together.
///
/// If early bound lifetimes are present, we separate them into their own list (and likewise
/// for late bound). They will be numbered sequentially, starting from the lowest index that is
/// already in scope (for a fn item, that will be 0, but for a method it might not be). Late
/// bound lifetimes are resolved by name and associated with a binder ID (`binder_id`), so the
/// ordering is not important there.
// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:1284 visit_early_late
BoundVarContext.prototype.visit_early_late = function (
  this: BoundVarContext,
  hir_id: HirId,
  generics: hir.Generics,
  walk: (this_: BoundVarContext) => void,
): void {
  let named_late_bound_vars = 0;
  const bound_vars = new Map<LocalDefId, ResolvedArg>();
  for (const param of generics.params) {
    let arg: ResolvedArg;
    switch (param.kind.$) {
      case "Lifetime": {
        if (this.tcx.is_late_bound(param.hir_id)) {
          const late_bound_idx = named_late_bound_vars;
          named_late_bound_vars += 1;
          arg = ResolvedArgExt.late(late_bound_idx, param);
        } else {
          arg = ResolvedArgExt.early(param);
        }
        break;
      }
      case "Type":
      case "Const": {
        arg = ResolvedArgExt.early(param);
        break;
      }
    }
    bound_vars.set(param.def_id, arg);
  }

  const binders: BoundVariableKind[] = generics.params
    .filter((param) => param.kind.$ === "Lifetime" && this.tcx.is_late_bound(param.hir_id))
    .map((param) => late_arg_as_bound_arg(param));
  this.record_late_bound_vars(hir_id, binders);
  const scope: Scope = {
    $: "Binder",
    hir_id,
    bound_vars,
    s: this.scope,
    scope_type: "Normal",
    where_bound_origin: undefined,
  };
  this.with(scope, walk);
};

// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:1333 visit_early
BoundVarContext.prototype.visit_early = function (
  this: BoundVarContext,
  hir_id: HirId,
  generics: hir.Generics,
  walk: (this_: BoundVarContext) => void,
): void {
  const bound_vars = new Map<LocalDefId, ResolvedArg>(generics.params.map((param) => [param.def_id, ResolvedArgExt.early(param)]));
  this.record_late_bound_vars(hir_id, []);
  const scope: Scope = {
    $: "Binder",
    hir_id,
    bound_vars,
    s: this.scope,
    scope_type: "Normal",
    where_bound_origin: undefined,
  };
  this.with(scope, (this_) => {
    const scope: Scope = { $: "TraitRefBoundary", s: this_.scope };
    this_.with(scope, walk);
  });
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:1354 resolve_lifetime_ref
BoundVarContext.prototype.resolve_lifetime_ref = function (this: BoundVarContext, region_def_id: LocalDefId, lifetime_ref: hir.Lifetime): void {
  // Walk up the scope chain, tracking the number of fn scopes
  // that we pass through, until we find a lifetime with the
  // given name or we run out of scopes.
  // search.
  let late_depth = 0;
  let scope = this.scope;
  let outermost_body: hir.BodyId | undefined = undefined;
  let crossed_late_boundary: string | undefined = undefined;
  const opaque_capture_scopes: [LocalDefId, KeyedMap<ResolvedArg, LocalDefId>][] = [];
  let result: ResolvedArg | undefined;
  loop: for (;;) {
    switch (scope.$) {
      case "Body": {
        const { id, s } = scope;
        outermost_body = id;
        scope = s;
        break;
      }

      case "Root": {
        const opt_parent_item = scope.opt_parent_item;
        if (opt_parent_item !== undefined) {
          const parent_item = opt_parent_item;
          const parent_generics = this.tcx.generics_of(parent_item) as Generics;
          if (parent_generics.param_def_id_to_index_(this.tcx, LocalDefId.to_def_id(region_def_id)) !== undefined) {
            result = { $: "EarlyBound", _0: region_def_id };
            break loop;
          }
        }
        result = undefined;
        break loop;
      }

      case "Binder": {
        const { bound_vars, scope_type, s, where_bound_origin } = scope;
        const def = bound_vars.get(region_def_id);
        if (def !== undefined) {
          result = ResolvedArgExt.shifted(def, late_depth);
          break loop;
        }
        switch (scope_type) {
          case "Normal":
            late_depth += 1;
            break;
          case "Concatenating":
            break;
        }
        // Fresh lifetimes in APIT used to be allowed in async fns and forbidden in
        // regular fns.
        if (where_bound_origin === "ImplTrait" && lifetime_ref.kind.$ === "Param") {
          const param_id = lifetime_ref.kind._0;
          const generics = this.tcx.hir_get_generics(this.tcx.local_parent(param_id));
          if (generics !== undefined) {
            const param = generics.params.find((p) => p.def_id === param_id);
            if (
              param !== undefined &&
              param.is_elided_lifetime() &&
              !Asyncness.is_async(this.tcx.asyncness(lifetime_ref.hir_id.owner.def_id) as Asyncness) &&
              !this.tcx.features().anonymous_lifetime_in_impl_trait()
            ) {
              const diag: Diag = feature_err(
                this.tcx.sess,
                sym.anonymous_lifetime_in_impl_trait,
                lifetime_ref.ident.span,
                "anonymous lifetimes in `impl Trait` are unstable",
              );

              const generics = this.tcx.hir_get_generics(lifetime_ref.hir_id.owner.def_id);
              if (generics !== undefined) {
                const span = generics.span_for_lifetime_suggestion();
                const new_param_sugg: [SpanT, string] = span !== undefined ? [span, "'a, "] : [generics.span, "<'a>"];

                const lifetime_sugg = lifetime_ref.suggestion("'a");
                const suggestions: [SpanT, string][] = [lifetime_sugg, new_param_sugg];

                diag.span_label(lifetime_ref.ident.span, "expected named lifetime parameter");
                diag.multipart_suggestion("consider introducing a named lifetime parameter", suggestions, Applicability.MaybeIncorrect);
              }

              diag.emit();
              return;
            }
          }
        }
        scope = s;
        break;
      }

      case "Opaque": {
        const { captures, def_id, s } = scope;
        opaque_capture_scopes.push([def_id, captures]);
        late_depth = 0;
        scope = s;
        break;
      }

      case "ObjectLifetimeDefault":
      case "Supertrait":
      case "TraitRefBoundary": {
        scope = scope.s;
        break;
      }

      case "LateBoundary": {
        const { s, what, deny_late_regions } = scope;
        if (deny_late_regions) {
          crossed_late_boundary = what;
        }
        scope = s;
        break;
      }
    }
  }

  if (result !== undefined) {
    let def = result;
    def = this.remap_opaque_captures(opaque_capture_scopes, def, lifetime_ref.ident);

    if (def.$ === "EarlyBound") {
      // Do not free early-bound regions, only late-bound ones.
    } else if (def.$ === "LateBound" && crossed_late_boundary !== undefined) {
      const param_def_id = def._2;
      const what = crossed_late_boundary;
      const use_span = lifetime_ref.ident.span;
      const def_span = this.tcx.def_span(param_def_id);
      const kind = this.tcx.def_kind(param_def_id);
      let guar: ErrorGuaranteedT;
      switch (kind.$) {
        case "LifetimeParam":
          guar = this.tcx.dcx().emit_err(diagnostics().CannotCaptureLateBound_diagnostic({ $: "Lifetime", use_span, def_span, what }));
          break;
        default:
          return span_bug(use_span, `did not expect to resolve lifetime to ${DefKind.descr(kind, LocalDefId.to_def_id(param_def_id))}`);
      }
      def = { $: "Error", _0: guar };
    } else if (outermost_body !== undefined) {
      const body_id = outermost_body;
      const fn_id = this.tcx.hir_body_owner(body_id);
      const node = this.tcx.hir_node(fn_id);
      if (
        (node.$ === "Item" && node._0.kind.$ === "Fn") ||
        (node.$ === "TraitItem" && node._0.kind.$ === "Fn") ||
        (node.$ === "ImplItem" && node._0.kind.$ === "Fn")
      ) {
        const owner_id = node._0.owner_id;
        def = { $: "Free", _0: owner_id.def_id, _1: unwrap(ResolvedArgExt.id(def)) };
      } else if (node.$ === "Expr" && node._0.kind.$ === "Closure") {
        const closure = node._0.kind._0;
        def = { $: "Free", _0: closure.def_id, _1: unwrap(ResolvedArgExt.id(def)) };
      } else {
        // _ => {}
      }
    }

    this.insert_lifetime(lifetime_ref, def);
    return;
  }

  // We may fail to resolve higher-ranked lifetimes that are mentioned by APIT.
  // AST-based resolution does not care for impl-trait desugaring, which are the
  // responsibility of lowering. This may create a mismatch between the resolution
  // AST found (`region_def_id`) which points to HRTB, and what HIR allows.
  // ```
  // fn foo(x: impl for<'a> Trait<'a, Assoc = impl Copy + 'a>) {}
  // ```
  //
  // In such case, walk back the binders to diagnose it properly.
  let scope2 = this.scope;
  loop2: for (;;) {
    if (scope2.$ === "Binder" && scope2.where_bound_origin === "ImplTrait") {
      this.tcx.dcx().emit_err(
        diagnostics().LateBoundInApit_diagnostic({
          $: "Lifetime",
          span: lifetime_ref.ident.span,
          param_span: this.tcx.def_span(region_def_id),
        }),
      );
      return;
    }
    switch (scope2.$) {
      case "Root":
        break loop2;
      case "Binder":
      case "Body":
      case "Opaque":
      case "ObjectLifetimeDefault":
      case "Supertrait":
      case "TraitRefBoundary":
      case "LateBoundary": {
        scope2 = scope2.s;
        break;
      }
    }
  }

  this.tcx.dcx().span_delayed_bug(lifetime_ref.ident.span, `Could not resolve ${debug_Lifetime(lifetime_ref, PLAIN)} in scope ${debug_Scope(this.scope, PRETTY)}`);
};

/// Check for predicates like `impl for<'a> Trait<impl OtherTrait<'a>>`
/// and ban them. Type variables instantiated inside binders aren't
/// well-supported at the moment, so this doesn't work.
/// In the future, this should be fixed and this error should be removed.
// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:1561 check_lifetime_is_capturable
BoundVarContext.prototype.check_lifetime_is_capturable = function (
  this: BoundVarContext,
  opaque_def_id: LocalDefId,
  lifetime: ResolvedArg,
  capture_span: SpanT,
): Result<undefined, ErrorGuaranteedT> {
  if (lifetime.$ !== "LateBound") return Ok(undefined);
  const lifetime_def_id = lifetime._2;
  const lifetime_hir_id = this.tcx.local_def_id_to_hir_id(lifetime_def_id);
  const node = this.tcx.hir_node(this.tcx.parent_hir_id(lifetime_hir_id));
  let bad_place: string;
  if (node.$ === "OpaqueTy") {
    // Opaques do not declare their own lifetimes, so if a lifetime comes from an opaque
    // it must be a reified late-bound lifetime from a trait goal.
    bad_place = "higher-ranked lifetime from outer `impl Trait`";
  } else if (node.$ === "Item" || node.$ === "TraitItem" || node.$ === "ImplItem") {
    // Other items are fine.
    return Ok(undefined);
  } else if (node.$ === "Ty" && node._0.kind.$ === "FnPtr") {
    bad_place = "higher-ranked lifetime from function pointer";
  } else if (node.$ === "Ty" && node._0.kind.$ === "TraitObject") {
    bad_place = "higher-ranked lifetime from `dyn` type";
  } else {
    bad_place = "higher-ranked lifetime";
  }

  const decl_span = this.tcx.def_span(lifetime_def_id);
  const opaque_span = this.tcx.def_span(opaque_def_id);

  // `errors.get_or_insert_with(..)`
  if (this.opaque_capture_errors === undefined) {
    this.opaque_capture_errors = {
      bad_place,
      capture_spans: [],
      decl_spans: [],
    };
  }
  const error_info = this.opaque_capture_errors;

  if (error_info.capture_spans.length === 0) {
    error_info.capture_spans.push(opaque_span);
  }

  if (capture_span !== decl_span && capture_span !== opaque_span) {
    error_info.capture_spans.push(capture_span);
  }

  if (!error_info.decl_spans.includes(decl_span)) {
    error_info.decl_spans.push(decl_span);
  }

  // Errors should be emitted by `emit_opaque_capture_errors`.
  return Err(this.tcx.dcx().span_delayed_bug(capture_span, "opaque capture error not emitted"));
};

// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:1610 emit_opaque_capture_errors
BoundVarContext.prototype.emit_opaque_capture_errors = function (this: BoundVarContext): ErrorGuaranteedT | undefined {
  const errors = this.opaque_capture_errors;
  this.opaque_capture_errors = undefined;
  if (errors === undefined) return undefined;
  if (errors.capture_spans.length === 0) {
    return undefined;
  }

  const span = MultiSpan.from_span(errors.capture_spans[0]!);
  for (const capture_span of errors.capture_spans.slice(1)) {
    span.push_span_label(capture_span, "");
  }
  const decl_span = MultiSpan.from_spans(errors.decl_spans);

  // Ensure that the parent of the def is an item, not HRTB
  const guar = this.tcx.dcx().emit_err(
    diagnostics().OpaqueCapturesHigherRankedLifetime_diagnostic({
      span,
      label: errors.capture_spans[0],
      decl_span,
      bad_place: errors.bad_place,
    }),
  );

  return guar;
};

// #[instrument(level = "trace", skip(self, opaque_capture_scopes), ret)]
// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:1634 remap_opaque_captures
BoundVarContext.prototype.remap_opaque_captures = function (
  this: BoundVarContext,
  opaque_capture_scopes: readonly [LocalDefId, KeyedMap<ResolvedArg, LocalDefId>][],
  lifetime: ResolvedArg,
  ident: Ident,
): ResolvedArg {
  const last = opaque_capture_scopes[opaque_capture_scopes.length - 1];
  if (last !== undefined) {
    const opaque_def_id = last[0];
    const r = this.check_lifetime_is_capturable(opaque_def_id, lifetime, ident.span);
    if (r.$ === "Err") {
      const guar = r._0;
      lifetime = { $: "Error", _0: guar };
    }
  }

  for (const [opaque_def_id, captures] of [...opaque_capture_scopes].reverse()) {
    // `*captures.entry(lifetime).or_insert_with(..)`
    let remapped = captures.get(lifetime);
    if (remapped === undefined) {
      // `opaque_def_id` is unique to the `BoundVarContext` pass which is executed once
      // per `resolve_bound_vars` query. This is the only location that creates
      // `OpaqueLifetime` paths. `<opaque_def_id>::OpaqueLifetime(..)` is thus unique
      // to this query and duplicates within the query are handled by `self.disambiguator`.
      const feed = this.tcx.create_def(
        opaque_def_id,
        undefined,
        DefKind.LifetimeParam,
        { $: "OpaqueLifetime", _0: ident.name },
        PerParentDisambiguatorsMap.get_or_create(this.disambiguators, opaque_def_id),
      );
      feed.def_span(ident.span);
      feed.def_ident_span(ident.span);
      remapped = feed.def_id();
      captures.set(lifetime, remapped);
    }
    lifetime = { $: "EarlyBound", _0: remapped };
  }
  return lifetime;
};

// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:1671 resolve_type_ref
BoundVarContext.prototype.resolve_type_ref = function (this: BoundVarContext, param_def_id: LocalDefId, hir_id: HirId): void {
  // Walk up the scope chain, tracking the number of fn scopes
  // that we pass through, until we find a lifetime with the
  // given name or we run out of scopes.
  // search.
  let late_depth = 0;
  let scope = this.scope;
  let crossed_late_boundary: string | undefined = undefined;

  let result: ResolvedArg | undefined;
  loop: for (;;) {
    switch (scope.$) {
      case "Body": {
        scope = scope.s;
        break;
      }

      case "Root": {
        const opt_parent_item = scope.opt_parent_item;
        if (opt_parent_item !== undefined) {
          const parent_item = opt_parent_item;
          const parent_generics = this.tcx.generics_of(parent_item) as Generics;
          if (parent_generics.param_def_id_to_index_(this.tcx, LocalDefId.to_def_id(param_def_id)) !== undefined) {
            result = { $: "EarlyBound", _0: param_def_id };
            break loop;
          }
        }
        result = undefined;
        break loop;
      }

      case "Binder": {
        const { bound_vars, scope_type, s } = scope;
        const def = bound_vars.get(param_def_id);
        if (def !== undefined) {
          result = ResolvedArgExt.shifted(def, late_depth);
          break loop;
        }
        switch (scope_type) {
          case "Normal":
            late_depth += 1;
            break;
          case "Concatenating":
            break;
        }
        scope = s;
        break;
      }

      case "ObjectLifetimeDefault":
      case "Opaque":
      case "Supertrait":
      case "TraitRefBoundary": {
        scope = scope.s;
        break;
      }

      case "LateBoundary": {
        const { s, what } = scope;
        crossed_late_boundary = what;
        scope = s;
        break;
      }
    }
  }

  if (result !== undefined) {
    const def = result;
    if (def.$ === "LateBound" && crossed_late_boundary !== undefined) {
      const what = crossed_late_boundary;
      const use_span = this.tcx.hir_span(hir_id);
      const def_span = this.tcx.def_span(param_def_id);
      const kind = this.tcx.def_kind(param_def_id);
      let guar: ErrorGuaranteedT;
      switch (kind.$) {
        case "ConstParam":
          guar = this.tcx.dcx().emit_err(diagnostics().CannotCaptureLateBound_diagnostic({ $: "Const", use_span, def_span, what }));
          break;
        case "TyParam":
          guar = this.tcx.dcx().emit_err(diagnostics().CannotCaptureLateBound_diagnostic({ $: "Type", use_span, def_span, what }));
          break;
        default:
          return span_bug(use_span, `did not expect to resolve non-lifetime param to ${DefKind.descr(kind, LocalDefId.to_def_id(param_def_id))}`);
      }
      this.rbv.defs.insert(hir_id.local_id, { $: "Error", _0: guar });
    } else {
      this.rbv.defs.insert(hir_id.local_id, def);
    }
    return;
  }

  // We may fail to resolve higher-ranked ty/const vars that are mentioned by APIT.
  // AST-based resolution does not care for impl-trait desugaring, which are the
  // responsibility of lowering. This may create a mismatch between the resolution
  // AST found (`param_def_id`) which points to HRTB, and what HIR allows.
  // ```
  // fn foo(x: impl for<T> Trait<Assoc = impl Trait2<T>>) {}
  // ```
  //
  // In such case, walk back the binders to diagnose it properly.
  let scope2 = this.scope;
  loop2: for (;;) {
    if (scope2.$ === "Binder" && scope2.where_bound_origin === "ImplTrait") {
      const kind = this.tcx.def_kind(param_def_id);
      let err: diagnostics_mod.LateBoundInApit;
      switch (kind.$) {
        case "TyParam":
          err = { $: "Type", span: this.tcx.hir_span(hir_id), param_span: this.tcx.def_span(param_def_id) };
          break;
        case "ConstParam":
          err = { $: "Const", span: this.tcx.hir_span(hir_id), param_span: this.tcx.def_span(param_def_id) };
          break;
        default:
          return bug(`unexpected def-kind: ${DefKind.descr(kind, LocalDefId.to_def_id(param_def_id))}`);
      }
      const guar = this.tcx.dcx().emit_err(diagnostics().LateBoundInApit_diagnostic(err));
      this.rbv.defs.insert(hir_id.local_id, { $: "Error", _0: guar });
      return;
    }
    switch (scope2.$) {
      case "Root":
        break loop2;
      case "Binder":
      case "Body":
      case "Opaque":
      case "ObjectLifetimeDefault":
      case "Supertrait":
      case "TraitRefBoundary":
      case "LateBoundary": {
        scope2 = scope2.s;
        break;
      }
    }
  }

  this.tcx.dcx().span_bug(this.tcx.hir_span(hir_id), `could not resolve ${debug_LocalDefId(param_def_id, PLAIN)}`);
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:1807 visit_path_segment_args
BoundVarContext.prototype.visit_path_segment_args = function (
  this: BoundVarContext,
  generic_args: hir.GenericArgs,
  seg_idx: SegIdx,
  path: hir.Path,
): void {
  const paren = generic_args.paren_sugar_inputs_output();
  if (paren !== undefined) {
    const [inputs, output] = paren;
    this.visit_fn_like_elision(inputs, output, false);
    return;
  }

  // Let's first resolve all lifetime arguments because we need their
  // resolution for computing the trait object lifetime defaults.
  for (const arg of generic_args.args) {
    if (arg.$ === "Lifetime") {
      const lt = arg._0;
      this.visit_lifetime(lt);
    }
  }

  const container = this.eligible_container(path, seg_idx);
  // debug!(?container);

  let has_self = false;
  let object_lifetime_defaults: (ResolvedArg | undefined)[] = [];
  if (container !== undefined) {
    const [def_id, segs] = container;
    const generics = this.tcx.generics_of(def_id) as Generics;
    const defaults = this.compute_object_lifetime_defaults(generics, segs);
    has_self = generics.has_own_self();
    object_lifetime_defaults = defaults;
  }

  // debug!(?object_lifetime_defaults);

  let i = has_self ? 1 : 0;
  for (const arg of generic_args.args) {
    switch (arg.$) {
      // We've already visited all lifetime arguments at the start.
      case "Lifetime":
        break;
      case "Type": {
        const ty = arg._0;
        if (i < object_lifetime_defaults.length) {
          const lt = object_lifetime_defaults[i];
          const scope: Scope = { $: "ObjectLifetimeDefault", lifetime: lt, s: this.scope };
          this.with(scope, (this_) => this_.visit_ty(ty));
        } else {
          this.visit_ty(ty);
        }
        i += 1;
        break;
      }
      case "Const": {
        const ct = arg._0;
        this.visit_const_arg(ct);
        i += 1;
        break;
      }
      case "Infer": {
        const inf = arg._0;
        this.visit_id(inf.hir_id);
        i += 1;
        break;
      }
    }
  }

  const has_lifetime_args = generic_args.has_lifetime_args();

  for (const constraint of generic_args.constraints) {
    const scope: Scope = {
      $: "ObjectLifetimeDefault",
      // FIXME: Ideally we would consider the *item bounds* of assoc types when deducing
      //        the trait object lifetime default for the RHS of assoc type bindings.
      //        For example, given
      //
      //            trait TraitA<'a> { type AssocTy: ?Sized + 'a; }
      //            trait TraitB { type AssocTy<'a>: ?Sized + 'a; }
      //
      //        we would elaborate the `dyn Bound` in `TraitA<'r, AssocTy = dyn Bound>`
      //        and `TraitB<AssocTy<'r> = dyn Bound>` to `dyn Bound + 'r`.
      //
      // FIXME: Moreover, ideally GAT args in bindings could induce
      //        trait object lifetime defaults. For example, given
      //
      //           trait TraitA<'a> { type AssocTy<T: ?Sized + 'a>; }
      //           trait TraitB { type AssocTy<'a, T: ?Sized + 'a>; }
      //
      //        we would elab the `dyn Bound` in `TraitA<'r, AssocTy<dyn Bound> = ()>`
      //        and `TraitB<AssocTy<'r, dyn Bound> = ()>` to `dyn Bound + 'r`.
      //
      // HACK: For now however, if the user passes any lifetime arguments to the trait or
      //       the (generic) assoc type, we will treat the trait object lifetime default
      //       as indeterminate thus forcing the user to explicitly specify the lifetime.
      //
      //       If the trait or the assoc type have lifetime parameters, it's *possible*
      //       that they occur in the predicates or item bounds of the assoc type, so we
      //       conservatively reject such cases to allow us to implement the correct
      //       behavior in the future (here we assume that the number of arguments equals
      //       the number of parameters which is fine since a mismatch would get rejected
      //       later anyway).
      //
      //       If the items don't have any lifetime parameters we can safely use `'static`
      //       since there is no other possibility.
      lifetime: has_lifetime_args || constraint.gen_args.has_lifetime_args() ? undefined : ResolvedArg.StaticLifetime,
      s: this.scope,
    };
    // If the args are parenthesized, then this must be `feature(return_type_notation)`.
    // In that case, introduce a binder over all of the function's early and late bound vars.
    //
    // For example, given
    // ```
    // trait Foo {
    //     async fn x<'r, T>();
    // }
    // ```
    // and a bound that looks like:
    //    `for<'a> T::Trait<'a, x(..): for<'b> Other<'b>>`
    // this is going to expand to something like:
    //    `for<'a> for<'r> <T as Trait<'a>>::x::<'r, T>::{opaque#0}: for<'b> Other<'b>`.
    if (constraint.gen_args.parenthesized === "ReturnTypeNotation") {
      let bound_vars: BoundVariableKind[];
      let found: [BoundVariableKind[], AssocItem] | undefined;
      if (container !== undefined) {
        const container_def_id = container[0];
        const k = this.tcx.def_kind(container_def_id);
        if (k.$ === "Trait" || k.$ === "TraitAlias") {
          found = BoundVarContext.supertrait_hrtb_vars(this.tcx, container_def_id, constraint.ident, "Fn");
        }
      }
      if (found !== undefined) {
        const [bound_vars_, assoc_fn] = found;
        bound_vars = bound_vars_;
        bound_vars.push(...(this.tcx.generics_of(assoc_fn.def_id) as Generics).own_params.map((param) => generic_param_def_as_bound_arg(param)));
        // `resolve_bound_vars` is computed per HIR owner. `visit_early_late`
        // records this associated function's binder before walking its signature,
        // so reuse that in-progress binder instead of recursively querying `fn_sig`.
        let fn_bound_vars: BoundVariableKind[];
        if (DefId_eq(assoc_fn.def_id, constraint.hir_id.owner.to_def_id())) {
          const fn_hir_id = this.tcx.local_def_id_to_hir_id(assoc_fn.def_id.expect_local());
          fn_bound_vars = [...unwrap(this.rbv.late_bound_vars.get(fn_hir_id.local_id), "late-bound vars for the current function were not recorded")];
        } else {
          // PORT: the `fn_sig` query's value is typed `unknown` in queries.gen.ts; it is `EarlyBinder<PolyFnSig>`.
          fn_bound_vars = [
            ...Binder.bound_vars(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.fn_sig(assoc_fn.def_id) as EarlyBinder<Binder<unknown>>))),
          ];
        }
        bound_vars.push(...fn_bound_vars);
      } else {
        this.tcx.dcx().span_delayed_bug(constraint.ident.span, "bad return type notation here");
        bound_vars = [];
      }
      this.with(scope, (this_) => {
        const scope: Scope = { $: "Supertrait", bound_vars, s: this_.scope };
        this_.with(scope, (this_) => {
          const [bound_vars] = this_.poly_trait_ref_binder_info();
          this_.record_late_bound_vars(constraint.hir_id, bound_vars);
          this_.visit_assoc_item_constraint(constraint);
        });
      });
    } else if (container !== undefined) {
      const container_def_id = container[0];
      const r = BoundVarContext.supertrait_hrtb_vars(this.tcx, container_def_id, constraint.ident, "Type");
      const bound_vars = r === undefined ? undefined : r[0];
      this.with(scope, (this_) => {
        const scope: Scope = {
          $: "Supertrait",
          bound_vars: bound_vars ?? [],
          s: this_.scope,
        };
        this_.with(scope, (this_) => this_.visit_assoc_item_constraint(constraint));
      });
    } else {
      this.with(scope, (this_) => this_.visit_assoc_item_constraint(constraint));
    }
  }
};

/// Return the eligible container for the path segment given by the index if applicable.
///
/// Such a container induces lifetime defaults for trait object types contained
/// in any of the type arguments passed to it (any inner containers will of course
/// end up shadowing that default).
// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:1999 eligible_container
BoundVarContext.prototype.eligible_container = function (
  this: BoundVarContext,
  path: hir.Path,
  seg_idx_: SegIdx,
): [DefId, readonly hir.PathSegment[]] | undefined {
  const rev_seg_idx = seg_idx_.reverse(path.segments)._0;
  const seg_idx = seg_idx_._0;

  // NOTE: We don't need to care about definition kinds that may have generics if they
  // can only ever appear in positions where we can perform type inference (i.e., bodies).

  // FIXME(mgca, #151649): Type-level free/assoc consts, const&fn ctors should also qualify.
  // FIXME(return_type_notation, #151662): Assoc fns should also qualify.

  const res = path.res;
  let kind: DefKind;
  let def_id: DefId;
  switch (res.$) {
    case "Def":
      kind = res._0;
      def_id = res._1;
      break;
    case "PrimTy":
    case "SelfTyParam":
    case "SelfTyAlias":
    case "SelfCtor":
    case "Local":
    case "ToolMod":
    case "OpenMod":
    case "NonMacroAttr":
    case "Err":
      return undefined; // see NOTE above!
  }

  switch (kind.$) {
    case "AssocTy":
      switch (rev_seg_idx) {
        case 0:
          return [def_id, path.segments];
        // We're looking at the trait ref of an assoc type projection.
        // E.g., the `TraitRef<…>` in `<… as path::to::TraitRef<…>>::AssocTy<…>`.
        case 1:
          return [this.tcx.parent(def_id), path.segments.slice(0, seg_idx + 1)];
        default:
          return undefined;
      }
    case "Variant":
      switch (rev_seg_idx) {
        // We're looking at the `Variant::<…>` in `path::to::Variant::<…> { … }`.
        // Even if it's the variant segment that has the generic args and not the
        // enum segment, it's the enum that has the corresponding generic params.
        case 0:
          return [this.tcx.parent(def_id), path.segments];
        // We're looking at the `Enum::<…>` in `path::to::Enum::<…>::Variant { … }`.
        case 1:
          return [this.tcx.parent(def_id), path.segments.slice(0, seg_idx + 1)];
        default:
          return undefined;
      }
    case "Enum":
    case "Struct":
    case "Trait":
    case "TraitAlias":
    case "TyAlias":
    case "Union":
      switch (rev_seg_idx) {
        case 0:
          return [def_id, path.segments];
        default:
          return undefined;
      }
    case "AnonConst":
    case "AssocConst":
    case "AssocFn":
    case "Closure":
    case "Const":
    case "ConstParam":
    case "Ctor":
    case "ExternCrate":
    case "Field":
    case "Fn":
    case "ForeignMod":
    case "ForeignTy":
    case "GlobalAsm":
    case "Impl":
    case "LifetimeParam":
    case "Macro":
    case "Mod":
    case "OpaqueTy":
    case "Static":
    case "SyntheticCoroutineBody":
    case "TyParam":
    case "Use":
    case "TestBinderConstraints":
      return undefined; // see NOTE above!
  }
};

/// Compute a list of trait object lifetime defaults, one for each type parameter,
/// per the rules initially given in RFCs [599] and [1156]. Example:
///
/// ```
/// struct Foo<'a, T: 'a + ?Sized, U: ?Sized>(&'a T, &'a U);
/// ```
///
/// If you have `Foo<'x, dyn Bar, dyn Baz>`, we want to elaborate
/// * `dyn Bar` to `dyn Bar + 'x` (because of the `T: 'a` bound) and
/// * `dyn Baz` to `dyn Baz + 'static` (because there is no such bound).
///
/// Therefore, we would compute a list like `['x, 'static]`. Note that the list only
/// includes entries for type and const parameters, not for lifetime parameters.
///
/// [599]: https://rust-lang.github.io/rfcs/0599-default-object-bound.html
/// [1156]: https://rust-lang.github.io/rfcs/1156-adjust-default-object-bounds.html
// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2094 compute_object_lifetime_defaults
BoundVarContext.prototype.compute_object_lifetime_defaults = function (
  this: BoundVarContext,
  generics: Generics,
  segments: readonly hir.PathSegment[],
): (ResolvedArg | undefined)[] {
  const in_body = ((): boolean => {
    let scope = this.scope;
    for (;;) {
      switch (scope.$) {
        case "Root":
          return false;

        case "Body":
          return true;

        case "Binder":
        case "ObjectLifetimeDefault":
        case "Opaque":
        case "Supertrait":
        case "TraitRefBoundary":
        case "LateBoundary": {
          scope = scope.s;
          break;
        }
      }
    }
  })();

  const set_to_region = (set: ObjectLifetimeDefault): ResolvedArg | undefined => {
    switch (set.$) {
      case "Empty": {
        if (in_body) {
          return undefined;
        } else {
          return ResolvedArg.StaticLifetime;
        }
      }
      case "Static":
        return ResolvedArg.StaticLifetime;
      case "Param": {
        const param_def_id = set._0;
        // struct ArgIdx(usize);

        // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2131 resolve_param
        const resolve_param = (param_def_id: DefId, generics: Generics, tcx: TyCtxt): [RevSegIdx, number] => {
          const index = generics.param_def_id_to_index.get(param_def_id);
          if (index !== undefined) {
            const has_self = generics.has_own_self();
            const index_ = index - generics.parent_count - (has_self ? 1 : 0);
            return [new RevSegIdx(0), index_];
          } else if (generics.parent !== undefined) {
            const parent = generics.parent;
            const parent_generics = tcx.generics_of(parent) as Generics;
            const [rev, arg_idx] = resolve_param(param_def_id, parent_generics, tcx);
            return [new RevSegIdx(rev._0 + 1), arg_idx];
          } else {
            return unreachable_();
          }
        };

        const [rev_seg_idx, arg_idx] = resolve_param(param_def_id, generics, this.tcx);

        const seg_idx = rev_seg_idx.reverse(segments)._0;

        const args = segments[seg_idx]!.args;
        const arg = args === undefined ? undefined : args.args[arg_idx];
        if (arg === undefined) return undefined;
        switch (arg.$) {
          case "Lifetime": {
            const lt = arg._0;
            return this.rbv.defs.get(lt.hir_id.local_id);
          }
          default:
            return undefined;
        }
      }
      case "Ambiguous":
        return undefined;
    }
  };
  const out: (ResolvedArg | undefined)[] = [];
  for (const param of generics.own_params) {
    // NB: `Self` type params share the `DefId` with the corresponding trait (alias).
    //
    // Since trait aliases can't be used as the qself of fully qualified paths, the
    // trait object lifetime default for their `Self` type param is never needed.
    // Thus, we don't even try to compute it.
    //
    // We still need to map const params & trait aliases to *some* default to make it
    // easy & predictable for the caller how to map the defaults back to generic args.
    // As they can't tell if a given inferred arg refers to a type or a const at this
    // stage of analysis, they can't skip it and thus we need to provide (dummy)
    // defaults for const args. Otherwise, they wouldn't properly align.

    let set: ObjectLifetimeDefault | undefined;
    const kind = this.tcx.def_kind(param.def_id);
    switch (kind.$) {
      case "TyParam":
      case "Trait":
        set = this.tcx.object_lifetime_default(param.def_id) as ObjectLifetimeDefault;
        break;
      case "ConstParam":
      case "TraitAlias":
        set = ObjectLifetimeDefault.Empty;
        break;
      case "LifetimeParam":
        set = undefined;
        break;
      default:
        return bug(`unexpected def kind ${debug_DefKind(kind, PLAIN)}`);
    }
    if (set !== undefined) out.push(set_to_region(set));
  }
  return out;
};

/** `Vec<BoundVariableKind>`'s derived `PartialEq` (structural, rust_ts/intern_key.ts). */
function bound_vars_eq(a: readonly BoundVariableKind[], b: readonly BoundVariableKind[]): boolean {
  return intern_key(a) === intern_key(b);
}

// PORT: an associated fn without `self` -> a static on the class.
declare namespace BoundVarContext {
  let supertrait_hrtb_vars: (tcx: TyCtxt, def_id: DefId, assoc_ident: Ident, assoc_tag: AssocTag) => [BoundVariableKind[], AssocItem] | undefined;
}

/// Returns all the late-bound vars that come into scope from supertrait HRTBs, based on the
/// associated type name and starting trait.
/// For example, imagine we have
/// ```ignore (illustrative)
/// trait Foo<'a, 'b> {
///   type As;
/// }
/// trait Bar<'b>: for<'a> Foo<'a, 'b> {}
/// trait Bar: for<'b> Bar<'b> {}
/// ```
/// In this case, if we wanted to the supertrait HRTB lifetimes for `As` on
/// the starting trait `Bar`, we would return `Some(['b, 'a])`.
// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2205 supertrait_hrtb_vars
BoundVarContext.supertrait_hrtb_vars = function (
  tcx: TyCtxt,
  def_id: DefId,
  assoc_ident: Ident,
  assoc_tag: AssocTag,
): [BoundVariableKind[], AssocItem] | undefined {
  const trait_defines_associated_item_named = (trait_def_id: DefId): AssocItem | undefined =>
    AssocItems.find_by_ident_and_kind(tcx.associated_items(trait_def_id) as AssocItems, tcx, assoc_ident, assoc_tag, trait_def_id);

  // use smallvec::{SmallVec, smallvec};
  const stack: [DefId, BoundVariableKind[]][] = [[def_id, []]];
  const visited = new DefIdSet();
  for (;;) {
    const top = stack.pop();
    if (top === undefined) {
      return undefined;
    }
    const [def_id, bound_vars] = top;
    // See issue #83753. If someone writes an associated type on a non-trait, just treat it
    // as there being no supertrait HRTBs.
    const k = tcx.def_kind(def_id);
    switch (k.$) {
      case "Trait":
      case "TraitAlias":
      case "Impl":
        break;
      default:
        return undefined;
    }

    const assoc_item = trait_defines_associated_item_named(def_id);
    if (assoc_item !== undefined) {
      return [[...bound_vars], assoc_item];
    }
    // PORT: the query's value is typed `unknown` in queries.gen.ts; it is `EarlyBinder<&[(Clause, Span)]>`.
    const predicates = tcx.explicit_supertraits_containing_assoc_item([def_id, assoc_ident]) as EarlyBinder<readonly [Clause, SpanT][]>;
    for (const u of EarlyBinder.iter_identity_copied(predicates)) {
      const [pred] = Unnormalized.skip_norm_wip(u);
      const bound_predicate = pred.kind();
      const skipped = Binder.skip_binder(bound_predicate);
      let o: [DefId, BoundVariableKind[]] | undefined;
      switch (skipped.$) {
        case "Trait": {
          const data = skipped._0;
          // The order here needs to match what we would get from
          // `rustc_middle::ty::predicate::Clause::instantiate_supertrait`
          const pred_bound_vars = Binder.bound_vars(bound_predicate);
          const all_bound_vars = [...bound_vars];
          all_bound_vars.push(...pred_bound_vars);
          const super_def_id = data.trait_ref.def_id;
          o = [super_def_id, all_bound_vars];
          break;
        }
        default:
          o = undefined;
      }
      if (o === undefined) continue;

      // `obligations.filter(|o| visited.insert(o.0))`
      if (visited.has(o[0])) continue;
      visited.add(o[0]);
      stack.push(o);
    }
  }
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2264 visit_fn_like_elision
BoundVarContext.prototype.visit_fn_like_elision = function (
  this: BoundVarContext,
  inputs: readonly hir.Ty[],
  output: hir.Ty | undefined,
  in_closure: boolean,
): void {
  this.with(
    {
      $: "ObjectLifetimeDefault",
      lifetime: ResolvedArg.StaticLifetime,
      s: this.scope,
    },
    (this_) => {
      for (const input of inputs) {
        this_.visit_ty_unambig(input);
      }
      if (!in_closure && output !== undefined) {
        this_.visit_ty_unambig(output);
      }
    },
  );
  if (in_closure && output !== undefined) {
    this.visit_ty_unambig(output);
  }
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2290 resolve_object_lifetime_default
BoundVarContext.prototype.resolve_object_lifetime_default = function (this: BoundVarContext, lifetime_ref: hir.Lifetime): void {
  let late_depth = 0;
  let scope = this.scope;
  const opaque_capture_scopes: [LocalDefId, KeyedMap<ResolvedArg, LocalDefId>][] = [];
  let lifetime: ResolvedArg;
  loop: for (;;) {
    switch (scope.$) {
      case "Binder": {
        const { s, scope_type } = scope;
        switch (scope_type) {
          case "Normal":
            late_depth += 1;
            break;
          case "Concatenating":
            break;
        }
        scope = s;
        break;
      }

      case "Root":
        lifetime = ResolvedArg.StaticLifetime;
        break loop;

      case "Body":
        return;

      case "ObjectLifetimeDefault": {
        if (scope.lifetime === undefined) return;
        const l = scope.lifetime;
        lifetime = ResolvedArgExt.shifted(l, late_depth);
        break loop;
      }

      case "Opaque": {
        const { captures, def_id, s } = scope;
        opaque_capture_scopes.push([def_id, captures]);
        late_depth = 0;
        scope = s;
        break;
      }

      case "Supertrait":
      case "TraitRefBoundary":
      case "LateBoundary": {
        scope = scope.s;
        break;
      }
    }
  }

  lifetime = this.remap_opaque_captures(opaque_capture_scopes, lifetime, lifetime_ref.ident);

  this.insert_lifetime(lifetime_ref, lifetime);
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2332 insert_lifetime
BoundVarContext.prototype.insert_lifetime = function (this: BoundVarContext, lifetime_ref: hir.Lifetime, def: ResolvedArg): void {
  // debug!(span = ?lifetime_ref.ident.span);
  this.rbv.defs.insert(lifetime_ref.hir_id.local_id, def);
};

// When we have a return type notation type in a where clause, like
// `where <T as Trait>::method(..): Send`, we need to introduce new bound
// vars to the existing where clause's binder, to represent the lifetimes
// elided by the return-type-notation syntax.
//
// For example, given
// ```
// trait Foo {
//     async fn x<'r>();
// }
// ```
// and a bound that looks like:
//    `for<'a, 'b> <T as Trait<'a>>::x(): Other<'b>`
// this is going to expand to something like:
//    `for<'a, 'b, 'r> <T as Trait<'a>>::x::<'r, T>::{opaque#0}: Other<'b>`.
//
// We handle this similarly for associated-type-bound style return-type-notation
// in `visit_path_segment_args`.
// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2355 try_append_return_type_notation_params
BoundVarContext.prototype.try_append_return_type_notation_params = function (this: BoundVarContext, hir_id: HirId, hir_ty: hir.Ty): void {
  if (hir_ty.kind.$ !== "Path") {
    // We only care about path types here. All other self types
    // (including nesting the RTN type in another type) don't do
    // anything.
    return;
  }
  const qpath = hir_ty.kind._0;

  let bound_vars: BoundVariableKind[];
  let item_def_id: DefId;
  let item_segment: hir.PathSegment;
  const is_rtn = (seg: hir.PathSegment): boolean => seg.args !== undefined && seg.args.parenthesized === "ReturnTypeNotation";
  if (qpath.$ === "Resolved" && qpath._1.segments.length > 0 && is_rtn(qpath._1.segments[qpath._1.segments.length - 1]!)) {
    // If we have a fully qualified method, then we don't need to do any special lookup.
    const path = qpath._1;
    const item_segment_ = path.segments[path.segments.length - 1]!;
    const res = path.res;
    if (res.$ === "Err") {
      return;
    } else if (res.$ === "Def" && res._0.$ === "AssocFn") {
      bound_vars = [];
      item_def_id = res._1;
      item_segment = item_segment_;
    } else {
      return bug("only expected method resolution for fully qualified RTN");
    }
  } else if (qpath.$ === "TypeRelative" && is_rtn(qpath._1)) {
    // If we have a type-dependent path, then we do need to do some lookup.
    const qself = qpath._0;
    const item_segment_ = qpath._1;
    // First, ignore a qself that isn't a type or `Self` param. Those are the
    // only ones that support `T::Assoc` anyways in HIR lowering.
    if (!(qself.kind.$ === "Path" && qself.kind._0.$ === "Resolved" && qself.kind._0._0 === undefined)) {
      return;
    }
    const path = qself.kind._0._1;
    const res = path.res;
    if ((res.$ === "Def" && res._0.$ === "TyParam") || res.$ === "SelfTyParam") {
      const tcx = this.tcx;
      const trait_bounds = this.for_each_trait_bound_on_res(path.res);
      const bounds = (function* (): Generator<[BoundVariableKind[], AssocItem]> {
        for (const trait_def_id of trait_bounds) {
          const r = BoundVarContext.supertrait_hrtb_vars(tcx, trait_def_id, item_segment_.ident, "Fn");
          if (r !== undefined) yield r;
        }
      })();

      const first = bounds.next();
      if (first.done === true) {
        // This will error in HIR lowering.
        this.tcx.dcx().span_delayed_bug(path.span, "no resolution for RTN path");
        return;
      }
      const [bound_vars_, assoc_item] = first.value;

      // Don't bail if we have identical bounds, which may be collected from
      // something like `T: Bound + Bound`, or via elaborating supertraits.
      for (const [second_vars, second_assoc_item] of bounds) {
        // PORT: `AssocItem`'s derived `PartialEq` compares by value (rust_ts/intern_key.ts).
        if (!bound_vars_eq(second_vars, bound_vars_) || intern_key(second_assoc_item) !== intern_key(assoc_item)) {
          // This will error in HIR lowering.
          this.tcx.dcx().span_delayed_bug(path.span, "ambiguous resolution for RTN path");
          return;
        }
      }

      bound_vars = bound_vars_;
      item_def_id = assoc_item.def_id;
      item_segment = item_segment_;
    } else if (res.$ === "SelfTyAlias" && res.is_trait_impl) {
      // If we have a self type alias (in an impl), try to resolve an
      // associated item from one of the supertraits of the impl's trait.
      const impl_def_id = res.alias_to;
      const ikind = Node.expect_item(this.tcx.hir_node_by_def_id(impl_def_id.expect_local())).kind;
      if (!(ikind.$ === "Impl" && ikind._0.of_trait !== undefined)) {
        return;
      }
      const of_trait = ikind._0.of_trait;
      const trait_def_id = of_trait.trait_ref.trait_def_id();
      if (trait_def_id === undefined) {
        return;
      }
      const r = BoundVarContext.supertrait_hrtb_vars(this.tcx, trait_def_id, item_segment_.ident, "Fn");
      if (r === undefined) {
        return;
      }
      const [bound_vars_, assoc_item] = r;
      bound_vars = bound_vars_;
      item_def_id = assoc_item.def_id;
      item_segment = item_segment_;
    } else {
      return;
    }
  } else {
    return;
  }

  // Append the early-bound vars on the function, and then the late-bound ones.
  // We actually turn type parameters into higher-ranked types here, but we
  // deny them later in HIR lowering.
  bound_vars.push(...(this.tcx.generics_of(item_def_id) as Generics).own_params.map((param) => generic_param_def_as_bound_arg(param)));
  // PORT: the `fn_sig` query's value is typed `unknown` in queries.gen.ts; it is `EarlyBinder<PolyFnSig>`.
  bound_vars.push(...Binder.bound_vars(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.fn_sig(item_def_id) as EarlyBinder<Binder<unknown>>))));

  // SUBTLE: Stash the old bound vars onto the *item segment* before appending
  // the new bound vars. We do this because we need to know how many bound vars
  // are present on the binder explicitly (i.e. not return-type-notation vars)
  // to do bound var shifting correctly in HIR lowering.
  //
  // For example, in `where for<'a> <T as Trait<'a>>::method(..): Other`,
  // the `late_bound_vars` of the where clause predicate (i.e. this HIR ty's
  // parent) will include `'a` AND all the early- and late-bound vars of the
  // method. But when lowering the RTN type, we just want the list of vars
  // we used to resolve the trait ref. We explicitly stored those back onto
  // the item segment, since there's no other good place to put them.
  //
  // See where these vars are used in `HirTyLowerer::lower_ty_maybe_return_type_notation`.
  // And this is exercised in:
  // `tests/ui/associated-type-bounds/return-type-notation/higher-ranked-bound-works.rs`.
  const existing_bound_vars = unwrap(this.rbv.late_bound_vars.get(hir_id.local_id));
  const existing_bound_vars_saved = [...existing_bound_vars];
  existing_bound_vars.push(...bound_vars);
  this.record_late_bound_vars(item_segment.hir_id, existing_bound_vars_saved);
};

/// Walk the generics of the item for a trait bound whose self type
/// corresponds to the expected res, and return the trait def id.
// PORT: the `gen move { .. }` block is a generator (lazy, like the upstream iterator).
// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2499 for_each_trait_bound_on_res
BoundVarContext.prototype.for_each_trait_bound_on_res = function* (this: BoundVarContext, expected_res: Res): Generator<DefId> {
  let scope = this.scope;
  for (;;) {
    let hir_id: HirId | undefined;
    if (scope.$ === "Binder") {
      hir_id = scope.hir_id;
    } else if (scope.$ === "Root" && scope.opt_parent_item !== undefined) {
      const parent_def_id = scope.opt_parent_item;
      hir_id = this.tcx.local_def_id_to_hir_id(parent_def_id);
    } else {
      // Body | ObjectLifetimeDefault | Supertrait | TraitRefBoundary | LateBoundary | Opaque
      // | Root { opt_parent_item: None }
      hir_id = undefined;
    }

    if (hir_id !== undefined) {
      const node = this.tcx.hir_node(hir_id);
      // If this is a `Self` bound in a trait, yield the trait itself.
      // Specifically, we don't need to look at any supertraits since
      // we already do that in `BoundVarContext::supertrait_hrtb_vars`.
      if (expected_res.$ === "SelfTyParam" && node.$ === "Item" && node._0.kind.$ === "Trait") {
        const item = node._0;
        // Yield the trait's def id. Supertraits will be
        // elaborated from that.
        yield LocalDefId.to_def_id(item.owner_id.def_id);
      } else {
        const generics = Node.generics(node);
        if (generics !== undefined) {
          for (const pred of generics.predicates) {
            if (pred.kind.$ !== "BoundPredicate") {
              continue;
            }
            const bpred = pred.kind._0;
            const bkind = bpred.bounded_ty.kind;
            if (!(bkind.$ === "Path" && bkind._0.$ === "Resolved" && bkind._0._0 === undefined)) {
              continue;
            }
            const bounded_path = bkind._0._1;
            // Match the expected res.
            if (!Res_eq(bounded_path.res, expected_res, HirId_eq)) {
              continue;
            }
            for (const pred2 of bpred.bounds) {
              switch (pred2.$) {
                case "Trait": {
                  const poly_trait_ref = pred2._0;
                  const def_id = poly_trait_ref.trait_ref.trait_def_id();
                  if (def_id !== undefined) {
                    yield def_id;
                  }
                  break;
                }
                case "Outlives":
                case "Use":
                  break;
              }
            }
          }
        }
      }
    }

    switch (scope.$) {
      case "Binder":
      case "Body":
      case "ObjectLifetimeDefault":
      case "Supertrait":
      case "TraitRefBoundary":
      case "LateBoundary":
      case "Opaque": {
        scope = scope.s;
        break;
      }
      case "Root":
        return;
    }
  }
};

/// Detects late-bound lifetimes and inserts them into
/// `late_bound`.
///
/// A region declared on a fn is **late-bound** if:
/// - it is constrained by an argument type;
/// - it does not appear in a where-clause.
///
/// "Constrained" basically means that it appears in any type but
/// not amongst the inputs to a projection. In other words, `<&'a
/// T as Trait<''b>>::Foo` does not constrain `'a` or `'b`.
// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2587 is_late_bound_map
export function is_late_bound_map(tcx: TyCtxt, owner_id: hir.OwnerId): Set<hir.ItemLocalId> | undefined {
  const sig = tcx.hir_fn_sig_by_hir_id(HirId_from_OwnerId(owner_id));
  if (sig === undefined) return undefined;
  const generics = tcx.hir_get_generics(owner_id.def_id);
  if (generics === undefined) return undefined;

  const late_bound = new Set<hir.ItemLocalId>();

  const constrained_by_input = new ConstrainedCollector(new Set(), tcx);
  for (const arg_ty of sig.decl.inputs) {
    constrained_by_input.visit_ty_unambig(arg_ty);
  }

  const appears_in_output = new AllCollector(false, new Set());
  walk_fn_ret_ty(appears_in_output, sig.decl.output);
  if (appears_in_output.has_fully_capturing_opaque) {
    for (const param of generics.params) appears_in_output.regions.add(param.def_id);
  }

  // debug!(?constrained_by_input.regions);

  // Walk the lifetimes that appear in where clauses.
  //
  // Subtle point: because we disallow nested bindings, we can just
  // ignore binders here and scrape up all names we see.
  const appears_in_where_clause = new AllCollector(true, new Set());
  appears_in_where_clause.visit_generics(generics);
  // debug!(?appears_in_where_clause.regions);

  // Late bound regions are those that:
  // - appear in the inputs
  // - do not appear in the where-clauses
  // - are not implicitly captured by `impl Trait`
  for (const param of generics.params) {
    switch (param.kind.$) {
      case "Lifetime": {
        /* fall through */
        break;
      }

      // Neither types nor consts are late-bound.
      case "Type":
      case "Const":
        continue;
    }

    // appears in the where clauses? early-bound.
    if (appears_in_where_clause.regions.has(param.def_id)) {
      continue;
    }

    // does not appear in the inputs, but appears in the return type? early-bound.
    if (!constrained_by_input.regions.has(param.def_id) && appears_in_output.regions.has(param.def_id)) {
      continue;
    }

    // debug!("lifetime {:?} with id {:?} is late-bound", param.name.ident(), param.def_id);

    const inserted = !late_bound.has(param.hir_id.local_id);
    late_bound.add(param.hir_id.local_id);
    assert(inserted, `visited lifetime ${debug_LocalDefId(param.def_id, PLAIN)} twice`);
  }

  // debug!(?late_bound);
  return late_bound;
}

// (the nested items of `is_late_bound_map`, at module level: TS classes need no per-call allocation)

/// Visits a `ty::Ty` collecting information about what generic parameters are constrained.
///
/// The visitor does not operate on `hir::Ty` so that it can be called on the rhs of a `type Alias<...> = ...;`
/// which may live in a separate crate so there would not be any hir available. Instead we use the `type_of`
/// query to obtain a `ty::Ty` which will be present even in cross crate scenarios. It also naturally
/// handles cycle detection as we go through the query system.
///
/// This is necessary in the first place for the following case:
/// ```rust,ignore (pseudo-Rust)
/// type Alias<'a, T> = <T as Trait<'a>>::Assoc;
/// fn foo<'a>(_: Alias<'a, ()>) -> Alias<'a, ()> { ... }
/// ```
///
/// If we conservatively considered `'a` unconstrained then we could break users who had written code before
/// we started correctly handling aliases. If we considered `'a` constrained then it would become late bound
/// causing an error during HIR ty lowering as the `'a` is not constrained by the input type `<() as Trait<'a>>::Assoc`
/// but appears in the output type `<() as Trait<'a>>::Assoc`.
///
/// We must therefore "look into" the `Alias` to see whether we should consider `'a` constrained or not.
///
/// See #100508 #85533 #47511 for additional context
// rustc-type: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2673 ConstrainedCollectorPostHirTyLowering
class ConstrainedCollectorPostHirTyLowering implements TypeVisitor<undefined> {
  readonly Result: VisitorResult<undefined, unknown> = VisitorResult.unit;

  constructor(public arg_is_constrained: boolean[]) {}

  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }

  // impl<'tcx> TypeVisitor<TyCtxt<'tcx>> for ConstrainedCollectorPostHirTyLowering

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2679 visit_ty
  visit_ty(t: Ty): undefined {
    const k = t.kind();
    if (k.$ === "Param") {
      const param_ty = k._0;
      // PORT: an out-of-bounds index panics in Rust (`Box<[bool]>` indexing).
      assert(param_ty.index < this.arg_is_constrained.length, `index out of bounds: the len is ${this.arg_is_constrained.length} but the index is ${param_ty.index}`);
      this.arg_is_constrained[param_ty.index] = true;
    } else if (k.$ === "Alias" && (k._1.kind.$ === "Projection" || k._1.kind.$ === "Inherent")) {
      return undefined;
    } else {
      // _ => (),
    }
    return fold_Ty.super_visit_with(t, this);
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2693 visit_const
  visit_const(_: Const): undefined {
    return undefined;
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2695 visit_region
  visit_region(r: Region): undefined {
    // debug!("r={:?}", r.kind());
    const k = r.kind();
    if (k.$ === "ReEarlyParam") {
      const region = k._0;
      assert(region.index < this.arg_is_constrained.length, `index out of bounds: the len is ${this.arg_is_constrained.length} but the index is ${region.index}`);
      this.arg_is_constrained[region.index] = true;
    }
    return undefined;
  }

  visit_predicate<P>(p: P, d: import("../../rustc_type_ir/fold.ts").PredicateProxy<P>): undefined {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  visit_clauses(c: import("../../rustc_middle/ty/list.ts").Clauses): undefined {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  visit_error(guar: ErrorGuaranteedT): undefined {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

// rustc-type: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2703 ConstrainedCollector
class ConstrainedCollector extends Visitor {
  constructor(
    public regions: Set<LocalDefId>,
    public tcx: TyCtxt,
  ) {
    super();
  }

  // impl<'v> Visitor<'v> for ConstrainedCollector<'_>

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2709 visit_ty
  override visit_ty(ty: hir.Ty<hir.AmbigArg>): undefined {
    const kind = ty.kind;
    if (kind.$ === "Path" && ((kind._0.$ === "Resolved" && kind._0._0 !== undefined) || kind._0.$ === "TypeRelative")) {
      // ignore lifetimes appearing in associated type
      // projections, as they are not *constrained*
      // (defined above)
    } else if (kind.$ === "Path" && kind._0.$ === "Resolved" && kind._0._1.res.$ === "Def" && kind._0._1.res._0.$ === "TyAlias") {
      const { res, segments, span } = kind._0._1;
      const alias_def = (res as { _1: DefId })._1;
      // See comments on `ConstrainedCollectorPostHirTyLowering` for why this arm does not
      // just consider args to be unconstrained.
      const generics = this.tcx.generics_of(alias_def) as Generics;
      const walker = new ConstrainedCollectorPostHirTyLowering(new Array<boolean>(generics.own_params.length).fill(false));
      // PORT: the `type_of` query's value is typed `unknown` in queries.gen.ts; it is `EarlyBinder<Ty>`.
      walker.visit_ty(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(alias_def) as EarlyBinder<Ty>)));

      const last = segments[segments.length - 1];
      if (last !== undefined && last.args !== undefined) {
        const args = last.args;
        const tcx = this.tcx;
        const constrained: hir.GenericArg[] = [];
        args.args.forEach((arg, n) => {
          if (n < walker.arg_is_constrained.length) {
            if (walker.arg_is_constrained[n]) constrained.push(arg);
          } else {
            tcx.dcx().span_delayed_bug(span, `Incorrect generic arg count for alias ${debug_DefId(alias_def, PLAIN)}`);
          }
        });
        for (const constrained_arg of constrained) {
          this.visit_generic_arg(constrained_arg);
        }
      } else if (last !== undefined) {
        // Some(_) => (),
      } else {
        return bug("Path with no segments or self type");
      }
    } else if (kind.$ === "Path" && kind._0.$ === "Resolved" && kind._0._0 === undefined) {
      const path = kind._0._1;
      // consider only the lifetimes on the final
      // segment; I am not sure it's even currently
      // valid to have them elsewhere, but even if it
      // is, those would be potentially inputs to
      // projections
      const last_segment = path.segments[path.segments.length - 1];
      if (last_segment !== undefined) {
        this.visit_path_segment(last_segment);
      }
    } else {
      walk_ty(this, ty);
    }
    return undefined;
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2779 visit_lifetime
  override visit_lifetime(lifetime_ref: hir.Lifetime): undefined {
    if (lifetime_ref.kind.$ === "Param") {
      const def_id = lifetime_ref.kind._0;
      this.regions.add(def_id);
    }
    return undefined;
  }
}

// rustc-type: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2786 AllCollector
class AllCollector extends Visitor {
  constructor(
    public has_fully_capturing_opaque: boolean,
    public regions: Set<LocalDefId>,
  ) {
    super();
  }

  // impl<'tcx> Visitor<'tcx> for AllCollector

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2792 visit_lifetime
  override visit_lifetime(lifetime_ref: hir.Lifetime): undefined {
    if (lifetime_ref.kind.$ === "Param") {
      const def_id = lifetime_ref.kind._0;
      this.regions.add(def_id);
    }
    return undefined;
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2798 visit_opaque_ty
  override visit_opaque_ty(opaque: hir.OpaqueTy): undefined {
    if (!this.has_fully_capturing_opaque) {
      this.has_fully_capturing_opaque = opaque_captures_all_in_scope_lifetimes(opaque);
    }
    return walk_opaque_ty(this, opaque);
  }
}

// rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2807 deny_non_region_late_bound
export function deny_non_region_late_bound(tcx: TyCtxt, bound_vars: Map<LocalDefId, ResolvedArg>, where_: string): void {
  let first = true;

  for (const [var_] of bound_vars) {
    const node = tcx.hir_node_by_def_id(var_);
    if (node.$ !== "GenericParam") {
      return span_bug(tcx.def_span(var_), "expected bound-var def-id to resolve to param");
    }
    const param = node._0;

    let what: string;
    switch (param.kind.$) {
      case "Type":
        what = "type";
        break;
      case "Const":
        what = "const";
        break;
      case "Lifetime":
        continue;
    }

    const diag = tcx.dcx().struct_span_err(param.span, `late-bound ${what} parameter not allowed on ${where_}`);

    const guar = diag.emit_err_unless_delay(!tcx.features().non_lifetime_binders() || !first);

    first = false;
    bound_vars.set(var_, { $: "Error", _0: guar });
  }
}

/// A path segment index.
// rustc-type: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2839 SegIdx
// #[derive(Clone, Copy, Debug)]
class SegIdx {
  constructor(public _0: number) {}

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2842 reverse
  reverse(segments: readonly hir.PathSegment[]): RevSegIdx {
    const seg_idx = this._0;
    // PORT: `usize` subtraction; an underflow panics only with overflow checks (the release oracle wraps).
    return new RevSegIdx(segments.length - seg_idx - 1);
  }
}

/// A reversed path segment index.
///
/// E.g., for qualified path `<() as path::to::TraitRef<…>>::AssocTy<…>` the mapping from reversed
/// index to path segment would look like 3 ↦ `path`, 2 ↦ `to`, 1 ↦ `TraitRef<…>`, 0 ↦ `AssocTy<…>`.
// rustc-type: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2852 RevSegIdx
class RevSegIdx {
  constructor(public _0: number) {}

  // rustc: compiler/rustc_hir_analysis/src/collect/resolve_bound_vars.rs:2855 reverse
  reverse(segments: readonly hir.PathSegment[]): SegIdx {
    const rev_seg_idx = this._0;
    return new SegIdx(segments.length - rev_seg_idx - 1);
  }
}

