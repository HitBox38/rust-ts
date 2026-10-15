// Port of compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs (lane trait-sel-traits-b, wave 17).
//
//! "Dyn-compatibility"[^1] refers to the ability for a trait to be converted
//! to a trait object. In general, traits may only be converted to a trait
//! object if certain criteria are met.
//!
//! [^1]: Formerly known as "object safety".
//
// PORT: `debug!` / `#[instrument]` (tracing) are dropped. `SmallVec<[Span; 1]>` is `Span[]`. The generic
// `contains_illegal_self_type_reference<T: TypeVisitable>` takes `T`'s D4 descriptor last. The visitors / the folder are
// classes implementing rustc_type_ir's `TypeVisitor` / `TypeFolder`. Derived `PartialEq` of the non-interned `TraitRef`
// / `AliasTy` values (`supertraits.contains(&trait_ref)`, `Some(proj) != self.allowed`) compares their `intern_key`s
// (rust_ts/intern_key.ts: the derived `Hash` + `Eq` as a string). `normalize_param_env_or_error` (traits/mod.rs, lane
// trait-sel-traits-a) is a `PORT(merge)` stand-in at the end of the file that stops as UNPORTED.
//
// Init order: rustc_infer is loaded through its crate root; other modules are read inside function bodies only.
import "../../rustc_infer/lib.ts";
import { Obligation } from "../../rustc_infer/traits/mod.ts";
import { ControlFlow, VisitorResult as VisitorResultC, type VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { Defaultness, FnRetTy, type GenericBounds, Node } from "../../rustc_hir/hir.ts";
import {
  type AssocConstViolation,
  type DynCompatibilityViolation,
  type MethodViolation,
  ObligationCause,
} from "../../rustc_middle/traits/mod.ts";
import type { Providers } from "../../rustc_middle/queries.gen.ts";
import { AssocItem, AssocItems } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Clause, Const, GenericArg, Predicate, Region } from "../../rustc_middle/ty/decls.ts";
import { fold_GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { GenericClauses, type Generics } from "../../rustc_middle/ty/generics.ts";
import type { Clauses } from "../../rustc_middle/ty/list.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { Asyncness, ParamEnv, Ty } from "../../rustc_middle/ty/mod.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { Clause_upcast_from_TraitRef, Predicate_upcast_from_TraitRef } from "../../rustc_middle/ty/predicate.ts";
import { fold_Clause, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { TraitDef } from "../../rustc_middle/ty/trait_def.ts";
import { DefId_eq, type DefId } from "../../rustc_span/def_id.ts";
import { FatalError } from "../../rustc_span/fatal_error.ts";
import { DUMMY_SP, type ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { kw, sym, type Symbol } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import type { PolyFnSig } from "../../rustc_type_ir/decls.ts";
import { Elaboratable_Clause, elaborate, supertrait_def_ids, supertraits } from "../../rustc_type_ir/elaborate.ts";
import type { PredicateProxy, TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { TypeFolder_provided, type TypeFolder } from "../../rustc_type_ir/fold.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import { DebruijnIndex, INNERMOST } from "../../rustc_type_ir/lib.ts";
import { as_interner, TraitClause, TraitRef } from "../../rustc_type_ir/predicate.ts";
import { fold_with_TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../../rustc_type_ir/predicate.gen.ts";
import type { ClauseKind } from "../../rustc_type_ir/predicate_kind.gen.ts";
import { fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import type { AliasTy } from "../../rustc_type_ir/ty/alias.ts";
import { AliasTy as AliasTyC, FnSig, fold_FnSig, PolyFnSig as PolyFnSigC } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitableExt, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import { assert, unported, unwrap } from "../../std/panic.ts";

/** PORT: the `TypeFoldable` impl of `TraitRef` (generated) and `PolyFnSig`'s (`fold_Binder`) as D4 descriptors. */
const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
const d_PolyTy = fold_Binder(fold_Ty);
const d_PolyFnSig: TypeFoldable<PolyFnSig> = fold_Binder(fold_FnSig);

/// Returns the dyn-compatibility violations that affect HIR ty lowering.
///
/// Currently that is `Self` in supertraits. This is needed
/// because `dyn_compatibility_violations` can't be used during
/// type collection, as type collection is needed for `dyn_compatibility_violations` itself.
// #[instrument(level = "debug", skip(tcx), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:38 hir_ty_lowering_dyn_compatibility_violations
export function hir_ty_lowering_dyn_compatibility_violations(tcx: TyCtxt, trait_def_id: DefId): DynCompatibilityViolation[] {
  // debug_assert!(tcx.generics_of(trait_def_id).has_self);
  const out: DynCompatibilityViolation[] = [];
  for (const def_id of supertrait_def_ids(tcx, trait_def_id)) {
    const spans = clauses_reference_self(tcx, def_id, true);
    if (spans.length === 0) continue;
    out.push({ $: "SupertraitSelf", _0: spans });
  }
  return out;
}

// rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:50 dyn_compatibility_violations
function dyn_compatibility_violations(tcx: TyCtxt, trait_def_id: DefId): readonly DynCompatibilityViolation[] {
  // debug_assert!(tcx.generics_of(trait_def_id).has_self);
  // debug!("dyn_compatibility_violations: {:?}", trait_def_id);
  const out: DynCompatibilityViolation[] = [];
  for (const def_id of supertrait_def_ids(tcx, trait_def_id)) {
    out.push(...dyn_compatibility_violations_for_trait(tcx, def_id));
  }
  return out;
}

// rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:62 is_dyn_compatible
function is_dyn_compatible(tcx: TyCtxt, trait_def_id: DefId): boolean {
  return tcx.dyn_compatibility_violations(trait_def_id).length === 0;
}

/// We say a method is *vtable safe* if it can be invoked on a trait
/// object. Note that dyn-compatible traits can have some
/// non-vtable-safe methods, so long as they require `Self: Sized` or
/// otherwise ensure that they cannot be used when `Self = Trait`.
// rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:70 is_vtable_safe_method
export function is_vtable_safe_method(tcx: TyCtxt, trait_def_id: DefId, method: AssocItem): boolean {
  // debug_assert!(tcx.generics_of(trait_def_id).has_self);
  // debug!("is_vtable_safe_method({:?}, {:?})", trait_def_id, method);
  // Any method that has a `Self: Sized` bound cannot be called.
  if (tcx.generics_require_sized_self(method.def_id)) {
    return false;
  }

  return virtual_call_violations_for_method(tcx, trait_def_id, method).length === 0;
}

// #[instrument(level = "debug", skip(tcx), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:82 dyn_compatibility_violations_for_trait
function dyn_compatibility_violations_for_trait(tcx: TyCtxt, trait_def_id: DefId): DynCompatibilityViolation[] {
  // Check assoc items for violations.
  const violations: DynCompatibilityViolation[] = [];
  for (const item of AssocItems.in_definition_order(tcx.associated_items(trait_def_id) as AssocItems)) {
    violations.push(...dyn_compatibility_violations_for_assoc_item(tcx, trait_def_id, item));
  }

  // Check the trait itself.
  if (trait_has_sized_self(tcx, trait_def_id)) {
    // We don't want to include the requirement from `Sized` itself to be `Sized` in the list.
    const spans = get_sized_bounds(tcx, trait_def_id);
    violations.push({ $: "SizedSelf", _0: spans });
  } else {
    const span = (tcx.trait_def(trait_def_id) as TraitDef).force_dyn_incompatible;
    if (span !== undefined) {
      violations.push({ $: "ExplicitlyDynIncompatible", _0: [span] });
    }
  }

  let spans = clauses_reference_self(tcx, trait_def_id, false);
  if (spans.length !== 0) {
    violations.push({ $: "SupertraitSelf", _0: spans });
  }
  spans = bounds_reference_self(tcx, trait_def_id);
  if (spans.length !== 0) {
    violations.push({ $: "SupertraitSelf", _0: spans });
  }
  spans = super_clauses_have_non_lifetime_binders(tcx, trait_def_id);
  if (spans.length !== 0) {
    violations.push({ $: "SupertraitNonLifetimeBinder", _0: spans });
  }
  spans = super_clauses_are_unconditionally_const(tcx, trait_def_id);
  if (spans.length !== 0) {
    violations.push({ $: "SupertraitConst", _0: spans });
  }

  return violations;
}

// rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:122 sized_trait_bound_spans
function* sized_trait_bound_spans(tcx: TyCtxt, bounds: GenericBounds): Generator<Span> {
  for (const b of bounds) {
    if (b.$ === "Trait") {
      const trait_ref = b._0;
      const trait_def_id = trait_ref.trait_ref.trait_def_id();
      if (trait_has_sized_self(tcx, trait_def_id !== undefined ? trait_def_id : new FatalError().raise())) {
        // Fetch spans for supertraits that are `Sized`: `trait T: Super`
        yield trait_ref.span;
      }
    }
  }
}

// rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:140 get_sized_bounds
function get_sized_bounds(tcx: TyCtxt, trait_def_id: DefId): Span[] {
  const node = tcx.hir_get_if_local(trait_def_id);
  if (node !== undefined && node.$ === "Item" && node._0.kind.$ === "Trait") {
    const { generics, bounds } = node._0.kind;
    const out: Span[] = [];
    for (const pred of generics.predicates) {
      const kind = pred.kind;
      if (kind.$ === "BoundPredicate" && DefId_eq(kind._0.bounded_ty.hir_id.owner.to_def_id(), trait_def_id)) {
        // Fetch spans for trait bounds that are Sized:
        // `trait T where Self: Pred`
        out.push(...sized_trait_bound_spans(tcx, kind._0.bounds));
      }
    }
    // Fetch spans for supertraits that are `Sized`: `trait T: Super`.
    out.push(...sized_trait_bound_spans(tcx, bounds));
    return out;
  }
  return [];
}

// rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:172 clauses_reference_self
function clauses_reference_self(tcx: TyCtxt, trait_def_id: DefId, supertraits_only: boolean): Span[] {
  const trait_ref = Binder.dummy(TraitRef.identity(tcx, trait_def_id), d_TraitRef);
  const clauses: readonly (readonly [Clause, Span])[] = supertraits_only
    ? EarlyBinder.skip_binder(tcx.explicit_super_clauses_of(trait_def_id) as EarlyBinder<readonly (readonly [Clause, Span])[]>)
    : (tcx.clauses_of(trait_def_id) as GenericClauses).clauses;
  const out: Span[] = [];
  for (const [clause_, sp] of clauses) {
    const clause = clause_.instantiate_supertrait(tcx, trait_ref);
    // Super clauses cannot allow self projections, since they're
    // impossible to make into existential bounds without eager resolution
    // or something.
    // e.g. `trait A: B<Item = Self::Assoc>`.
    const s = predicate_references_self(tcx, trait_def_id, clause, sp, "No");
    if (s !== undefined) out.push(s);
  }
  return out;
}

// rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:196 bounds_reference_self
function bounds_reference_self(tcx: TyCtxt, trait_def_id: DefId): Span[] {
  const out: Span[] = [];
  for (const item of AssocItems.in_definition_order(tcx.associated_items(trait_def_id) as AssocItems)) {
    // We're only looking at associated type bounds
    if (!AssocItem.is_type(item)) continue;
    // Ignore GATs with `Self: Sized`
    if (tcx.generics_require_sized_self(item.def_id)) continue;
    for (const u of EarlyBinder.iter_identity_copied(tcx.explicit_item_bounds(item.def_id) as EarlyBinder<readonly (readonly [Clause, Span])[]>)) {
      const [clause, sp] = Unnormalized.skip_norm_wip(u);
      // Item bounds *can* have self projections, since they never get
      // their self type erased.
      const s = predicate_references_self(tcx, trait_def_id, clause, sp, "Yes");
      if (s !== undefined) out.push(s);
    }
  }
  return out;
}

// rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:216 predicate_references_self
function predicate_references_self(
  tcx: TyCtxt,
  trait_def_id: DefId,
  predicate: Clause,
  sp: Span,
  allow_self_projections: AllowSelfProjections,
): Span | undefined {
  const k: ClauseKind = Binder.skip_binder(predicate.kind());
  switch (k.$) {
    case "Trait": {
      const data = k._0;
      // In the case of a trait predicate, we can skip the "self" type.
      return data.trait_ref.args.slice(1).some((arg) => contains_illegal_self_type_reference(tcx, trait_def_id, arg, allow_self_projections, fold_GenericArg))
        ? sp
        : undefined;
    }
    case "Projection": {
      const data = k._0;
      // And similarly for projections. This should be redundant with
      // the previous check because any projection should have a
      // matching `Trait` predicate with the same inputs, but we do
      // the check to be safe.
      //
      // It's also won't be redundant if we allow type-generic associated
      // types for trait objects.
      //
      // Note that we *do* allow projection *outputs* to contain
      // `Self` (i.e., `trait Foo: Bar<Output=Self::Result> { type Result; }`),
      // we just require the user to specify *both* outputs
      // in the object type (i.e., `dyn Foo<Output=(), Result=()>`).
      //
      // This is ALT2 in issue #56288, see that for discussion of the
      // possible alternatives.
      return data.projection_term.args.slice(1).some((arg) => contains_illegal_self_type_reference(tcx, trait_def_id, arg, allow_self_projections, fold_GenericArg))
        ? sp
        : undefined;
    }
    case "ConstArgHasType": {
      const ty = k._1;
      return contains_illegal_self_type_reference(tcx, trait_def_id, ty, allow_self_projections, fold_Ty) ? sp : undefined;
    }

    case "WellFormed":
    case "TypeOutlives":
    case "RegionOutlives":
    case "HostEffect":
    case "UnstableFeature":
      return undefined;

    // FIXME(generic_const_exprs): this can mention `Self`
    case "ConstEvaluatable":
      return undefined;
  }
}

// rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:282 super_clauses_have_non_lifetime_binders
function super_clauses_have_non_lifetime_binders(tcx: TyCtxt, trait_def_id: DefId): Span[] {
  const out: Span[] = [];
  for (const u of EarlyBinder.iter_identity_copied(tcx.explicit_super_clauses_of(trait_def_id) as EarlyBinder<readonly (readonly [Clause, Span])[]>)) {
    const [clause, span] = Unnormalized.skip_norm_wip(u);
    if (TypeVisitableExt.has_non_region_bound_vars(clause, fold_Clause)) out.push(span);
  }
  return out;
}

/// Checks for `const Trait` supertraits. We're okay with `[const] Trait`,
/// supertraits since for a non-const instantiation of that trait, the
/// conditionally-const supertrait is also not required to be const.
// rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:296 super_clauses_are_unconditionally_const
function super_clauses_are_unconditionally_const(tcx: TyCtxt, trait_def_id: DefId): Span[] {
  const out: Span[] = [];
  for (const u of EarlyBinder.iter_identity_copied(tcx.explicit_super_clauses_of(trait_def_id) as EarlyBinder<readonly (readonly [Clause, Span])[]>)) {
    const [clause, span] = Unnormalized.skip_norm_wip(u);
    if (Binder.skip_binder(clause.kind()).$ === "HostEffect") {
      out.push(span);
    }
  }
  return out;
}

// rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:313 trait_has_sized_self
function trait_has_sized_self(tcx: TyCtxt, trait_def_id: DefId): boolean {
  return tcx.generics_require_sized_self(trait_def_id);
}

// rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:317 generics_require_sized_self
function generics_require_sized_self(tcx: TyCtxt, def_id: DefId): boolean {
  const sized_def_id = tcx.lang_items().sized_trait();
  if (sized_def_id === undefined) {
    return false; /* No Sized trait, can't require it! */
  }

  // Search for a clause like `Self: Sized` amongst the trait bounds.
  const clauses: Clause[] = GenericClauses.instantiate_identity(tcx.clauses_of(def_id) as GenericClauses, tcx).clauses.map(Unnormalized.skip_norm_wip);
  for (const clause of elaborate(tcx, clauses, Elaboratable_Clause)) {
    const k: ClauseKind = Binder.skip_binder(clause.kind());
    switch (k.$) {
      case "Trait": {
        const trait_pred = k._0;
        if (DefId_eq(TraitClause.def_id(trait_pred), sized_def_id) && TraitClause.self_ty(trait_pred).is_param(0)) {
          return true;
        }
        break;
      }
      case "RegionOutlives":
      case "TypeOutlives":
      case "Projection":
      case "ConstArgHasType":
      case "WellFormed":
      case "ConstEvaluatable":
      case "UnstableFeature":
      case "HostEffect":
        break;
    }
  }
  return false;
}

// #[instrument(level = "debug", skip(tcx), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:346 dyn_compatibility_violations_for_assoc_item
export function dyn_compatibility_violations_for_assoc_item(tcx: TyCtxt, trait_def_id: DefId, item: AssocItem): DynCompatibilityViolation[] {
  // `final` assoc functions don't prevent a trait from being dyn-compatible
  if (Defaultness.is_final(tcx.defaultness(item.def_id) as Defaultness)) {
    return [];
  }

  // Any item that has a `Self: Sized` requisite is otherwise exempt from the regulations.
  if (tcx.generics_require_sized_self(item.def_id)) {
    return [];
  }

  const span = (): Span => AssocItem.ident(item, tcx).span;

  const kind = item.kind;
  switch (kind.$) {
    case "Const": {
      const name = kind.name;
      // We will permit type associated consts if they are explicitly mentioned in the
      // trait object type. We can't check this here, as here we only check if it is
      // guaranteed to not be possible.

      const errors: AssocConstViolation[] = [];

      if (tcx.features().gca_min_const_items()) {
        if (!(tcx.generics_of(item.def_id) as Generics).is_own_empty()) {
          errors.push("Generic");
        } else if (!tcx.is_always_gca(item.def_id) && !tcx.features().gca_const_items()) {
          errors.push("NonType");
        }

        const ty = Binder.dummy(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(item.def_id) as EarlyBinder<Ty>)), fold_Ty);
        if (contains_illegal_self_type_reference(tcx, trait_def_id, ty, "Yes", d_PolyTy)) {
          errors.push("TypeReferencesSelf");
        }
      } else {
        errors.push("FeatureNotEnabled");
      }

      return errors.map((error) => ({ $: "AssocConst", _0: name, _1: error, _2: span() }));
    }
    case "Fn": {
      const name = kind.name;
      return virtual_call_violations_for_method(tcx, trait_def_id, item).map((v): DynCompatibilityViolation => {
        const node = tcx.hir_get_if_local(item.def_id);
        // Get an accurate span depending on the violation.
        let span_: Span;
        if (v.$ === "ReferencesSelfInput" && v._0 !== undefined) {
          span_ = v._0;
        } else if (v.$ === "UndispatchableReceiver" && v._0 !== undefined) {
          span_ = v._0[0];
        } else if (v.$ === "ReferencesImplTraitInTrait") {
          span_ = v._0;
        } else if (v.$ === "ReferencesSelfOutput" && node !== undefined) {
          const decl = Node.fn_decl(node);
          span_ = decl === undefined ? AssocItem.ident(item, tcx).span : FnRetTy.span(decl.output);
        } else {
          span_ = span();
        }

        return { $: "Method", _0: name, _1: v, _2: span_ };
      });
    }
    case "Type": {
      const data = kind.data;
      if (!(tcx.generics_of(item.def_id) as Generics).is_own_empty() && data.$ === "Normal") {
        const name = data._0;
        return [{ $: "GenericAssocTy", _0: name, _1: span() }];
      } else {
        // We will permit associated types if they are explicitly mentioned in the trait
        // object type. We can't check this here, as here we only check if it is
        // guaranteed to not be possible.
        return [];
      }
    }
  }
}

/// Returns `Some(_)` if this method cannot be called on a trait
/// object; this does not necessarily imply that the enclosing trait
/// is dyn-incompatible, because the method might have a where clause
/// `Self: Sized`.
// rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:437 virtual_call_violations_for_method
function virtual_call_violations_for_method(tcx: TyCtxt, trait_def_id: DefId, method: AssocItem): MethodViolation[] {
  const sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(method.def_id) as EarlyBinder<PolyFnSig>));

  // The method's first parameter must be named `self`
  if (!AssocItem.is_method(method)) {
    let sugg: [[string, Span], [string, Span]] | undefined;
    const node = tcx.hir_get_if_local(method.def_id);
    if (node !== undefined && node.$ === "TraitItem" && node._0.kind.$ === "Fn") {
      const generics = node._0.generics;
      const sig = node._0.kind._0;
      const sm = tcx.sess.source_map();
      sugg = [
        [`&self${sig.decl.inputs.length === 0 ? "" : ", "}`, Span.shrink_to_hi(sm.span_through_char(sig.span, C_LPAREN))],
        [`${generics.add_where_or_trailing_comma()} Self: Sized`, generics.tail_span_for_predicate_suggestion()],
      ];
    } else {
      sugg = undefined;
    }

    // Not having `self` parameter messes up the later checks,
    // so we need to return instead of pushing
    return [{ $: "StaticMethod", _0: sugg }];
  }

  const errors: MethodViolation[] = [];

  const inputs = FnSig.inputs(Binder.skip_binder(sig));
  for (let i = 1; i < inputs.length; i++) {
    const input_ty = inputs[i]!;
    if (contains_illegal_self_type_reference(tcx, trait_def_id, Binder.rebind(sig, input_ty), "Yes", d_PolyTy)) {
      let span: Span | undefined;
      const node = tcx.hir_get_if_local(method.def_id);
      if (node !== undefined && node.$ === "TraitItem" && node._0.kind.$ === "Fn") {
        const sig = node._0.kind._0;
        span = sig.decl.inputs[i]!.span;
      } else {
        span = undefined;
      }
      errors.push({ $: "ReferencesSelfInput", _0: span });
    }
  }
  if (contains_illegal_self_type_reference(tcx, trait_def_id, PolyFnSigC.output(sig), "Yes", d_PolyTy)) {
    errors.push({ $: "ReferencesSelfOutput" });
  }
  const error = contains_illegal_impl_trait_in_trait(tcx, method.def_id, PolyFnSigC.output(sig));
  if (error !== undefined) {
    errors.push(error);
  }
  if (FnSig.c_variadic(Binder.skip_binder(sig))) {
    errors.push({ $: "CVariadic" });
  }

  // We can't monomorphize things like `fn foo<A>(...)`.
  const own_counts = (tcx.generics_of(method.def_id) as Generics).own_counts();
  if (own_counts.types > 0 || own_counts.consts > 0) {
    errors.push({ $: "Generic" });
  }

  const receiver_ty = tcx.liberate_late_bound_regions(method.def_id, PolyFnSigC.input(sig, 0), fold_Ty);

  // `self: Self` can't be dispatched on.
  // However, this is considered dyn compatible. We allow it as a special case here.
  // FIXME(mikeyhew) get rid of this `if` statement once `receiver_is_dispatchable` allows
  // `Receiver: Unsize<Receiver[Self => dyn Trait]>`.
  if (receiver_ty !== tcx.types.self_param) {
    if (!receiver_is_dispatchable(tcx, method, receiver_ty)) {
      let span_n_lt: [Span, Symbol] | undefined;
      const node = tcx.hir_get_if_local(method.def_id);
      if (node !== undefined && node.$ === "TraitItem" && node._0.kind.$ === "Fn") {
        const sig = node._0.kind._0;
        const trait_fn = node._0.kind._1;
        // If we have `self: &'a Ty`, get `'a`, so that we can suggest `&'a self`.
        const in0 = sig.decl.inputs[0]!.kind;
        let lt: Symbol;
        if (in0.$ === "Ref" && in0._0.ident.name === kw.UnderscoreLifetime) {
          lt = sym.empty;
        } else if (in0.$ === "Ref") {
          lt = in0._0.ident.name;
        } else {
          lt = sym.empty;
        }
        // Get the `Span` for all of `self: Ty`, not just `Ty`.
        let sp: Span | undefined;
        const name = trait_fn.$ === "Required" ? trait_fn._0[0] : undefined;
        if (trait_fn.$ === "Required" && trait_fn._0.length >= 1 && name !== undefined && Span.eq_ctxt(name.span, sig.decl.inputs[0]!.span)) {
          sp = Span.to(name.span, sig.decl.inputs[0]!.span);
        } else if (trait_fn.$ === "Provided") {
          const body_id = trait_fn._0;
          const body = tcx.hir_body(body_id);
          const p = body.params[0];
          if (p !== undefined && Span.eq_ctxt(p.span, p.ty_span)) {
            sp = Span.to(p.span, p.ty_span);
          } else {
            sp = undefined;
          }
        } else {
          sp = undefined;
        }
        span_n_lt = sp === undefined ? undefined : [sp, lt];
      } else {
        span_n_lt = undefined;
      }
      errors.push({ $: "UndispatchableReceiver", _0: span_n_lt });
    } else {
      // We confirm that the `receiver_is_dispatchable` is accurate later,
      // see `check_receiver_correct`. It should be kept in sync with this code.
    }
  }

  // NOTE: This check happens last, because it results in a lint, and not a
  // hard error.
  if (
    (tcx.clauses_of(method.def_id) as GenericClauses).clauses.some(([clause, _span]) => {
      // dyn Trait is okay:
      //
      //     trait Trait {
      //         fn f(&self) where Self: 'static;
      //     }
      //
      // because a trait object can't claim to live longer than the concrete
      // type. If the lifetime bound holds on dyn Trait then it's guaranteed
      // to hold as well on the concrete type.
      if (clause.as_type_outlives_clause() !== undefined) {
        return false;
      }

      // dyn Trait is okay:
      //
      //     auto trait AutoTrait {}
      //
      //     trait Trait {
      //         fn f(&self) where Self: AutoTrait;
      //     }
      //
      // because `impl AutoTrait for dyn Trait` is disallowed by coherence.
      // Traits with a default impl are implemented for a trait object if and
      // only if the autotrait is one of the trait object's trait bounds, like
      // in `dyn Trait + AutoTrait`. This guarantees that trait objects only
      // implement auto traits if the underlying type does as well.
      const ck: ClauseKind = Binder.skip_binder(clause.kind());
      if (ck.$ === "Trait" && ck._0.polarity === "Positive") {
        const pred_trait_ref = ck._0.trait_ref;
        if (TraitRef.self_ty(pred_trait_ref) === tcx.types.self_param && tcx.trait_is_auto(pred_trait_ref.def_id)) {
          // Consider bounds like `Self: Bound<Self>`. Auto traits are not
          // allowed to have generic parameters so `auto trait Bound<T> {}`
          // would already have reported an error at the definition of the
          // auto trait.
          if (pred_trait_ref.args.length !== 1) {
            assert(tcx.dcx().has_errors() !== undefined, "auto traits cannot have generic parameters");
          }
          return false;
        }
      }

      return contains_illegal_self_type_reference(tcx, trait_def_id, clause, "Yes", fold_Clause);
    })
  ) {
    errors.push({ $: "WhereClauseReferencesSelf" });
  }

  return errors;
}

/// Performs a type instantiation to produce the version of `receiver_ty` when `Self = self_ty`.
/// For example, for `receiver_ty = Rc<Self>` and `self_ty = Foo`, returns `Rc<Foo>`.
// rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:621 receiver_for_self_ty
function receiver_for_self_ty(tcx: TyCtxt, receiver_ty: Ty, self_ty: Ty, method_def_id: DefId): Ty {
  // debug!("receiver_for_self_ty({:?}, {:?}, {:?})", receiver_ty, self_ty, method_def_id);
  const args = RawList.for_item(tcx, method_def_id, (param, _) => (param.index === 0 ? GenericArgFrom(self_ty) : tcx.mk_param_from_def(param)));

  const result = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(EarlyBinder.bind(tcx, receiver_ty, fold_Ty), tcx, args, fold_Ty));
  // debug!("receiver_for_self_ty({:?}, {:?}, {:?}) = {:?}", receiver_ty, self_ty, method_def_id, result);
  return result;
}

/// Checks the method's receiver (the `self` argument) can be dispatched on when `Self` is a
/// trait object. We require that `DispatchableFromDyn` be implemented for the receiver type
/// in the following way:
/// - let `Receiver` be the type of the `self` argument, i.e `Self`, `&Self`, `Rc<Self>`,
/// - require the following bound:
///
///   ```ignore (not-rust)
///   Receiver[Self => T]: DispatchFromDyn<Receiver[Self => dyn Trait]>
///   ```
///
///   where `Foo[X => Y]` means "the same type as `Foo`, but with `X` replaced with `Y`"
///   (instantiation notation).
///
/// Some examples of receiver types and their required obligation:
/// - `&'a mut self` requires `&'a mut Self: DispatchFromDyn<&'a mut dyn Trait>`,
/// - `self: Rc<Self>` requires `Rc<Self>: DispatchFromDyn<Rc<dyn Trait>>`,
/// - `self: Pin<Box<Self>>` requires `Pin<Box<Self>>: DispatchFromDyn<Pin<Box<dyn Trait>>>`.
///
/// The only case where the receiver is not dispatchable, but is still a valid receiver
/// type (just not dyn compatible), is when there is more than one level of pointer indirection.
/// E.g., `self: &&Self`, `self: &Rc<Self>`, `self: Box<Box<Self>>`. In these cases, there
/// is no way, or at least no inexpensive way, to coerce the receiver from the version where
/// `Self = dyn Trait` to the version where `Self = T`, where `T` is the unknown erased type
/// contained by the trait object, because the object that needs to be coerced is behind
/// a pointer.
///
/// If lowering already produced an error in the receiver type, we conservatively treat it as
/// undispatchable instead of asking the solver.
///
/// In practice, we cannot use `dyn Trait` explicitly in the obligation because it would result in
/// a new check that `Trait` is dyn-compatible, creating a cycle.
/// Instead, we emulate a placeholder by introducing a new type parameter `U` such that
/// `Self: Unsize<U>` and `U: Trait + MetaSized`, and use `U` in place of `dyn Trait`.
///
/// Written as a chalk-style query:
/// ```ignore (not-rust)
/// forall (U: Trait + MetaSized) {
///     if (Self: Unsize<U>) {
///         Receiver: DispatchFromDyn<Receiver[Self => U]>
///     }
/// }
/// ```
/// for `self: &'a mut Self`, this means `&'a mut Self: DispatchFromDyn<&'a mut U>`
/// for `self: Rc<Self>`, this means `Rc<Self>: DispatchFromDyn<Rc<U>>`
/// for `self: Pin<Box<Self>>`, this means `Pin<Box<Self>>: DispatchFromDyn<Pin<Box<U>>>`
//
// FIXME(mikeyhew) when unsized receivers are implemented as part of unsized rvalues, add this
// fallback query: `Receiver: Unsize<Receiver[Self => U]>` to support receivers like
// `self: Wrapper<Self>`.
// rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:689 receiver_is_dispatchable
function receiver_is_dispatchable(tcx: TyCtxt, method: AssocItem, receiver_ty: Ty): boolean {
  // debug!("receiver_is_dispatchable: method = {:?}, receiver_ty = {:?}", method, receiver_ty);

  if (TypeVisitableExt.references_error(receiver_ty, fold_Ty)) {
    return false;
  }

  const unsize_did = tcx.lang_items().unsize_trait();
  const dispatch_from_dyn_did = tcx.lang_items().dispatch_from_dyn_trait();
  if (unsize_did === undefined || dispatch_from_dyn_did === undefined) {
    // debug!("receiver_is_dispatchable: Missing `Unsize` or `DispatchFromDyn` traits");
    return false;
  }

  // the type `U` in the query
  // use a bogus type parameter to mimic a forall(U) query using u32::MAX for now.
  const unsized_self_ty: Ty = Ty.new_param(tcx, U32_MAX, sym.RustaceansAreAwesome);

  // `Receiver[Self => U]`
  const unsized_receiver_ty = receiver_for_self_ty(tcx, receiver_ty, unsized_self_ty, method.def_id);

  // create a modified param env, with `Self: Unsize<U>` and `U: Trait` (and all of
  // its supertraits) added to caller bounds. `U: MetaSized` is already implied here.
  let param_env: ParamEnv;
  {
    // N.B. We generally want to emulate the construction of the `unnormalized_param_env`
    // in the param-env query here. The fact that we don't just start with the clauses
    // in the param-env of the method is because those are already normalized, and mixing
    // normalized and unnormalized copies of predicates in `normalize_param_env_or_error`
    // will cause ambiguity that the user can't really avoid.
    //
    // We leave out certain complexities of the param-env query here. Specifically, we:
    // 1. Do not add `[const]` bounds since there are no `dyn const Trait`s.
    // 2. Do not add RPITIT self projection bounds for defaulted methods, since we
    //    are not constructing a param-env for "inside" of the body of the defaulted
    //    method, so we don't really care about projecting to a specific RPIT type,
    //    and because RPITITs are not dyn compatible (yet).
    const clauses: Clause[] = GenericClauses.instantiate_identity(tcx.clauses_of(method.def_id) as GenericClauses, tcx).clauses.map(Unnormalized.skip_norm_wip);

    // Self: Unsize<U>
    const unsize_predicate = TraitRef.new(as_interner(tcx), unsize_did, [GenericArgFrom(tcx.types.self_param), GenericArgFrom(unsized_self_ty)]);
    clauses.push(Clause_upcast_from_TraitRef(unsize_predicate, tcx));

    // U: Trait<Arg1, ..., ArgN>
    const trait_def_id = unwrap(AssocItem.trait_container(method, tcx));
    const args = RawList.for_item(tcx, trait_def_id, (param, _) => (param.index === 0 ? GenericArgFrom(unsized_self_ty) : tcx.mk_param_from_def(param)));
    const trait_predicate = TraitRef.new_from_args(as_interner(tcx), trait_def_id, args);
    clauses.push(Clause_upcast_from_TraitRef(trait_predicate, tcx));

    // U satisfies Trait's trait bounds. When normalizing `U: Trait<Arg1, ..., ArgN>`, aliases
    // in the arguments of supertrait bounds can generate trait obligations which may only be
    // be provable using where-clauses from Trait (#161621).
    clauses.push(
      ...GenericClauses.instantiate(tcx.clauses_of(trait_def_id) as GenericClauses, tcx, args)
        .clauses.map(Unnormalized.skip_norm_wip)
        .filter((clause) => Binder.skip_binder(clause.kind()).$ === "Trait"),
    );
    // FIXME(@dianne): we need projection clauses too in some form, but adding them all
    // unmodified can introduce ambiguity (#163550)

    let meta_sized_predicate: TraitRef;
    {
      const meta_sized_did = tcx.require_lang_item(LangItem.MetaSized, DUMMY_SP);
      meta_sized_predicate = TraitRef.new(as_interner(tcx), meta_sized_did, [GenericArgFrom(unsized_self_ty)]);
    }
    clauses.push(Clause_upcast_from_TraitRef(meta_sized_predicate, tcx));

    param_env = normalize_param_env_or_error(tcx, ParamEnv.new(tcx, clauses), ObligationCause.dummy_with_span(tcx.def_span(method.def_id)));
  }

  // Receiver: DispatchFromDyn<Receiver[Self => U]>
  let obligation: Obligation<Predicate>;
  {
    const predicate = TraitRef.new(as_interner(tcx), dispatch_from_dyn_did, [GenericArgFrom(receiver_ty), GenericArgFrom(unsized_receiver_ty)]);

    obligation = Obligation.new(tcx, ObligationCause.dummy(), param_env, predicate, upcast_via_tcx(Predicate_upcast_from_TraitRef));
  }

  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  // the receiver is dispatchable iff the obligation holds
  return infcx.predicate_must_hold_modulo_regions(obligation);
}

// rustc-type: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:793 AllowSelfProjections
type AllowSelfProjections = "Yes" | "No";

/// Check if the given value contains illegal `Self` references.
///
/// This is somewhat subtle. In general, we want to forbid references to `Self` in the
/// argument and return types, since the value of `Self` is erased.
///
/// However, there is one exception: It is ok to reference `Self` in order to access an
/// associated type of the current trait, since we retain the value of those associated
/// types in the trait object type itself.
///
/// The same thing holds for associated consts under feature `gca_min_const_items`.
///
/// ```rust,ignore (example)
/// trait SuperTrait {
///     type X;
/// }
///
/// trait Trait : SuperTrait {
///     type Y;
///     fn foo(&self, x: Self) // bad
///     fn foo(&self) -> Self // bad
///     fn foo(&self) -> Option<Self> // bad
///     fn foo(&self) -> Self::Y // OK, desugars to next example
///     fn foo(&self) -> <Self as Trait>::Y // OK
///     fn foo(&self) -> Self::X // OK, desugars to next example
///     fn foo(&self) -> <Self as SuperTrait>::X // OK
/// }
/// ```
///
/// However, it is not as simple as allowing `Self` in a projected
/// type, because there are illegal ways to use `Self` as well:
///
/// ```rust,ignore (example)
/// trait Trait : SuperTrait {
///     ...
///     fn foo(&self) -> <Self as SomeOtherTrait>::X;
/// }
/// ```
///
/// Here we will not have the type of `X` recorded in the
/// object type, and we cannot resolve `Self as SomeOtherTrait`
/// without knowing what `Self` is.
// rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:839 contains_illegal_self_type_reference
function contains_illegal_self_type_reference<T>(
  tcx: TyCtxt,
  trait_def_id: DefId,
  value: T,
  allow_self_projections: AllowSelfProjections,
  d_T: TypeVisitable<T>,
): boolean {
  return d_T.visit_with(value, new IllegalSelfTypeVisitor(tcx, trait_def_id, undefined, allow_self_projections)).$ === "Break";
}

// rustc-type: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:855 IllegalSelfTypeVisitor
class IllegalSelfTypeVisitor implements TypeVisitor<ControlFlow<null>> {
  /** `impl TypeVisitor`: `type Result = ControlFlow<()>`. */
  readonly Result: VisitorResult<ControlFlow<null>, null> = VisitorResultC.ControlFlow<null>();

  constructor(
    public tcx: TyCtxt,
    public trait_def_id: DefId,
    public supertraits: TraitRef[] | undefined,
    public allow_self_projections: AllowSelfProjections,
  ) {}

  // ---- impl<'tcx> IllegalSelfTypeVisitor<'tcx> ----

  // rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:863 is_supertrait_of_current_trait
  is_supertrait_of_current_trait(trait_ref_: TraitRef): boolean {
    // Compute supertraits of current trait lazily.
    if (this.supertraits === undefined) {
      const out: TraitRef[] = [];
      for (const trait_ref of supertraits(this.tcx, Binder.dummy(TraitRef.identity(this.tcx, this.trait_def_id), d_TraitRef))) {
        out.push(this.tcx.erase_and_anonymize_regions(this.tcx.instantiate_bound_regions_with_erased(trait_ref, d_TraitRef), d_TraitRef));
      }
      this.supertraits = out;
    }
    const supertraits_ = this.supertraits;

    // Determine whether the given trait ref is in fact a supertrait of the current trait.
    // In that case, any derived projections are legal, because the term will be specified
    // in the trait object type.
    // Note that we can just use direct equality here because all of these types are part of
    // the formal parameter listing, and hence there should be no inference variables.
    const trait_ref = fold_with_TraitRef(trait_ref_, new EraseEscapingBoundRegions(this.tcx, INNERMOST));
    const key = intern_key(trait_ref);
    return supertraits_.some((t) => intern_key(t) === key);
  }

  // ---- impl<'tcx> TypeVisitor<TyCtxt<'tcx>> for IllegalSelfTypeVisitor<'tcx> ----

  /** (provided) `TypeVisitor::visit_binder` */
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<null> {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }

  // rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:892 visit_ty
  visit_ty(ty: Ty): ControlFlow<null> {
    const k = ty.kind();
    if (k.$ === "Param") {
      if (ty === this.tcx.types.self_param) {
        return ControlFlow.Break(null);
      } else {
        return ControlFlow.CONTINUE;
      }
    } else if (k.$ === "Alias" && k._1.kind.$ === "Projection" && this.tcx.is_impl_trait_in_trait(k._1.kind.def_id)) {
      // We'll deny these later in their own pass
      return ControlFlow.CONTINUE;
    } else if (k.$ === "Alias" && k._1.kind.$ === "Projection") {
      const proj = k._1;
      switch (this.allow_self_projections) {
        case "Yes": {
          // Only walk contained types if the parent trait is not a supertrait.
          if (this.is_supertrait_of_current_trait(AliasTyC.trait_ref(proj, as_interner(this.tcx)))) {
            return ControlFlow.CONTINUE;
          } else {
            return fold_Ty.super_visit_with(ty, this);
          }
        }
        case "No":
          return fold_Ty.super_visit_with(ty, this);
      }
    } else {
      return fold_Ty.super_visit_with(ty, this);
    }
  }

  // rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:924 visit_const
  visit_const(ct_: Const): ControlFlow<null> {
    const ct = this.tcx.expand_abstract_consts(ct_, fold_Const);

    const k = ct.kind();
    if (k.$ === "Alias" && k._1.kind.$ === "Projection" && this.tcx.features().gca_min_const_items()) {
      const def_id = k._1.kind.def_id;
      const args = k._1.args;
      switch (this.allow_self_projections) {
        case "Yes": {
          const trait_def_id = this.tcx.parent(def_id);
          const trait_ref = TraitRef.from_assoc(as_interner(this.tcx), trait_def_id, args);

          // Only walk contained consts if the parent trait is not a supertrait.
          if (this.is_supertrait_of_current_trait(trait_ref)) {
            return ControlFlow.CONTINUE;
          } else {
            return fold_Const.super_visit_with(ct, this);
          }
        }
        case "No":
          return fold_Const.super_visit_with(ct, this);
      }
    } else {
      return fold_Const.super_visit_with(ct, this);
    }
  }

  /** (provided) `TypeVisitor::visit_region` */
  visit_region(r: Region): ControlFlow<null> {
    return TypeVisitor_provided.visit_region(this, r);
  }

  /** (provided) `TypeVisitor::visit_predicate` */
  visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<null> {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  /** (provided) `TypeVisitor::visit_clauses` */
  visit_clauses(c: Clauses): ControlFlow<null> {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  /** (provided) `TypeVisitor::visit_error` */
  visit_error(guar: ErrorGuaranteed): ControlFlow<null> {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

// rustc-type: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:952 EraseEscapingBoundRegions
class EraseEscapingBoundRegions implements TypeFolder {
  constructor(
    public tcx: TyCtxt,
    public binder: DebruijnIndex,
  ) {}

  // ---- impl<'tcx> TypeFolder<TyCtxt<'tcx>> for EraseEscapingBoundRegions<'tcx> ----

  // rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:958 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:962 fold_binder
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    this.binder = DebruijnIndex.shifted_in(this.binder, 1);
    const result = fold_Binder(d).super_fold_with(t, this);
    this.binder = DebruijnIndex.shifted_out(this.binder, 1);
    return result;
  }

  // rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:972 fold_region
  fold_region(r: Region): Region {
    const k = r.kind();
    if (k.$ === "ReBound" && k._0.$ === "Bound" && k._0._0 < this.binder) {
      return r;
    } else {
      return this.tcx.lifetimes.re_erased;
    }
  }

  /** (provided) `TypeFolder::fold_ty` */
  fold_ty(t: Ty): Ty {
    return TypeFolder_provided.fold_ty(this, t);
  }

  /** (provided) `TypeFolder::fold_const` */
  fold_const(c: Const): Const {
    return TypeFolder_provided.fold_const(this, c);
  }

  /** (provided) `TypeFolder::fold_predicate` */
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }

  /** (provided) `TypeFolder::fold_clauses` */
  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

// rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:983 contains_illegal_impl_trait_in_trait
function contains_illegal_impl_trait_in_trait(tcx: TyCtxt, fn_def_id: DefId, ty_: Binder<Ty>): MethodViolation | undefined {
  const ty = tcx.liberate_late_bound_regions(fn_def_id, ty_, fold_Ty);

  if (Asyncness.is_async(tcx.asyncness(fn_def_id) as Asyncness)) {
    // Rendering the error as a separate `async-specific` message is better.
    return { $: "AsyncFn" };
  } else {
    const r = fold_Ty.visit_with(ty, new IllegalRpititVisitor(tcx, undefined));
    return r.$ === "Break" ? r._0 : undefined;
  }
}

// rustc-type: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:998 IllegalRpititVisitor
class IllegalRpititVisitor implements TypeVisitor<ControlFlow<MethodViolation>> {
  /** `impl TypeVisitor`: `type Result = ControlFlow<MethodViolation>`. */
  readonly Result: VisitorResult<ControlFlow<MethodViolation>, MethodViolation> = VisitorResultC.ControlFlow<MethodViolation>();

  constructor(
    public tcx: TyCtxt,
    public allowed: AliasTy | undefined,
  ) {}

  /** (provided) `TypeVisitor::visit_binder` */
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<MethodViolation> {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }

  // rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:1006 visit_ty
  visit_ty(ty: Ty): ControlFlow<MethodViolation> {
    const k = ty.kind();
    if (
      k.$ === "Alias" &&
      k._1.kind.$ === "Projection" &&
      (this.allowed === undefined || intern_key(k._1) !== intern_key(this.allowed)) &&
      this.tcx.is_impl_trait_in_trait(k._1.kind.def_id)
    ) {
      const def_id = k._1.kind.def_id;
      return ControlFlow.Break<MethodViolation>({ $: "ReferencesImplTraitInTrait", _0: this.tcx.def_span(def_id) });
    } else {
      return fold_Ty.super_visit_with(ty, this);
    }
  }

  /** (provided) `TypeVisitor::visit_region` */
  visit_region(r: Region): ControlFlow<MethodViolation> {
    return TypeVisitor_provided.visit_region(this, r);
  }

  /** (provided) `TypeVisitor::visit_const` */
  visit_const(c: Const): ControlFlow<MethodViolation> {
    return TypeVisitor_provided.visit_const(this, c);
  }

  /** (provided) `TypeVisitor::visit_predicate` */
  visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<MethodViolation> {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  /** (provided) `TypeVisitor::visit_clauses` */
  visit_clauses(c: Clauses): ControlFlow<MethodViolation> {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  /** (provided) `TypeVisitor::visit_error` */
  visit_error(guar: ErrorGuaranteed): ControlFlow<MethodViolation> {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

// rustc: compiler/rustc_trait_selection/src/traits/dyn_compatibility.rs:1020 provide
export function provide(providers: Providers): void {
  providers.dyn_compatibility_violations = dyn_compatibility_violations;
  providers.is_dyn_compatible = is_dyn_compatible;
  providers.generics_require_sized_self = generics_require_sized_self;
}

// ---- PORT helpers ----------------------------------------------------------------------------------------------------

/** `u32::MAX` */
const U32_MAX = 0xffff_ffff;
/** `'('` */
const C_LPAREN = 0x28;

/** `ty.into()` (`impl From<Ty> for GenericArg`). */
function GenericArgFrom(ty: Ty): GenericArg {
  return ty as unknown as GenericArg;
}

/**
 * PORT: the `impl UpcastFrom<TyCtxt, X> for Predicate` fns (rustc_middle ty/predicate.ts) take the `TyCtxt`;
 * `Obligation::new` passes `as_interner(tcx)`, which is the same object (D3).
 */
function upcast_via_tcx<P>(f: (from: P, tcx: TyCtxt) => Predicate): (from: P, interner: Interner) => Predicate {
  return (from, interner) => f(from, interner as unknown as TyCtxt);
}

// ---- PORT(merge): fns of parallel wave-17 lanes' files (not on this branch); root repoints them at merge ----------

/** PORT(merge): `traits::normalize_param_env_or_error` (traits/mod.rs, lane trait-sel-traits-a). */
function normalize_param_env_or_error(_tcx: TyCtxt, _unnormalized_env: ParamEnv, _cause: ObligationCause): ParamEnv {
  return unported("rustc_trait_selection::traits::normalize_param_env_or_error");
}
