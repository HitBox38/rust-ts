// Port of compiler/rustc_infer/src/traits/util.rs (lane infer-opaque-snapshot). `PredicateSet` is generated
// (util.gen.ts); its methods are assigned onto the prototype below. Init order: other rustc_infer modules are read inside
// function bodies only.
//
// PORT: `impl Extend<ty::Predicate> for PredicateSet` is three methods on the class (`extend` takes an `Iterable`);
// `impl Elaboratable<TyCtxt> for PredicateObligation` is the D4 descriptor `Elaboratable_PredicateObligation`
// (rustc_type_ir elaborate.ts). `FxHashSet<ty::Predicate>` holds interned values: a plain `Set`; `FxHashSet<PolyTraitRef>`
// holds `Binder` structs: a `KeyedSet` on `intern_key`.

import { PredicateSet } from "./util.gen.ts";

export * from "./util.gen.ts";
// `pub use rustc_middle::ty::elaborate::*;` (`rustc_middle::ty` re-exports `rustc_type_ir::elaborate`)
export * from "../../rustc_type_ir/elaborate.ts";

import { intern_key } from "../../rust_ts/intern_key.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import { clone_ObligationCause, type ObligationCauseCode } from "../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Clause, Predicate } from "../../rustc_middle/ty/decls.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { Ident } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { PolyTraitRef } from "../../rustc_type_ir/decls.ts";
import type { Elaboratable } from "../../rustc_type_ir/elaborate.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import {
  fold_with_TraitRef,
  PolyTraitClause,
  PolyTraitRef as PolyTraitRefC,
  type TraitClause,
  type TraitRef,
  try_fold_with_TraitRef,
  visit_with_TraitRef,
} from "../../rustc_type_ir/predicate.ts";
import { fold_with_PredicateKind, type PredicateKind, try_fold_with_PredicateKind, visit_with_PredicateKind } from "../../rustc_type_ir/predicate_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { Obligation, type PredicateObligation } from "./mod.ts";

/** The `TypeFoldable` impl fns of `PredicateKind` / `TraitRef` (generated) as D4 descriptors (`anonymize_bound_vars`). */
const d_PredicateKind: TypeFoldable<PredicateKind> = {
  visit_with: visit_with_PredicateKind,
  try_fold_with: try_fold_with_PredicateKind,
  fold_with: fold_with_PredicateKind,
};
const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };

// rustc: compiler/rustc_infer/src/traits/util.rs:8 anonymize_predicate
export function anonymize_predicate(tcx: TyCtxt, pred: Predicate): Predicate {
  const new_ = tcx.anonymize_bound_vars(pred.kind(), d_PredicateKind);
  return tcx.reuse_or_mk_predicate(pred, new_);
}

declare module "./util.gen.ts" {
  interface PredicateSet {
    insert(pred: Predicate): boolean;
    extend(iter: Iterable<Predicate>): void;
    extend_one(pred: Predicate): void;
    extend_reserve(additional: number): void;
  }
  namespace PredicateSet {
    function new_(tcx: TyCtxt): PredicateSet;
    export { new_ as new };
  }
}

// ---- impl PredicateSet -----------------------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/traits/util.rs:22 new
(PredicateSet as unknown as { new: typeof PredicateSet.new }).new = function (tcx: TyCtxt): PredicateSet {
  return new PredicateSet(tcx, new Set());
};

/// Adds a predicate to the set.
///
/// Returns whether the predicate was newly inserted. That is:
/// - If the set did not previously contain this predicate, `true` is returned.
/// - If the set already contained this predicate, `false` is returned,
///   and the set is not modified: original predicate is not replaced,
///   and the predicate passed as argument is dropped.
// rustc: compiler/rustc_infer/src/traits/util.rs:33 insert
PredicateSet.prototype.insert = function (this: PredicateSet, pred: Predicate): boolean {
  // We have to be careful here because we want
  //
  //    for<'a> Foo<&'a i32>
  //
  // and
  //
  //    for<'b> Foo<&'b i32>
  //
  // to be considered equivalent. So normalize all late-bound
  // regions before we throw things into the underlying set.
  return set_insert(this.set, anonymize_predicate(this.tcx, pred));
};

// ---- impl Extend<ty::Predicate> for PredicateSet ---------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/traits/util.rs:49 extend
PredicateSet.prototype.extend = function (this: PredicateSet, iter: Iterable<Predicate>): void {
  // `self.set.reserve(iter.size_hint().0)`: capacity only.
  for (const pred of iter) {
    this.insert(pred);
  }
};

// rustc: compiler/rustc_infer/src/traits/util.rs:57 extend_one
PredicateSet.prototype.extend_one = function (this: PredicateSet, pred: Predicate): void {
  this.insert(pred);
};

// rustc: compiler/rustc_infer/src/traits/util.rs:61 extend_reserve
PredicateSet.prototype.extend_reserve = function (this: PredicateSet, _additional: number): void {
  // `Extend::<ty::Predicate>::extend_reserve(&mut self.set, additional)`: capacity only.
};

// ---- impl Elaboratable<TyCtxt> for PredicateObligation ---------------------------------------------------------------

/// For [`Obligation`], a sub-obligation is combined with the current obligation's
/// param-env and cause code.
export const Elaboratable_PredicateObligation: Elaboratable<PredicateObligation> = {
  // rustc: compiler/rustc_infer/src/traits/util.rs:69 predicate
  predicate(self: PredicateObligation): Predicate {
    return self.predicate;
  },

  // rustc: compiler/rustc_infer/src/traits/util.rs:73 child
  child(self: PredicateObligation, clause: Clause): PredicateObligation {
    return new Obligation(clone_ObligationCause(self.cause), self.param_env, clause.as_predicate(), 0);
  },

  // rustc: compiler/rustc_infer/src/traits/util.rs:82 child_with_derived_cause
  child_with_derived_cause(self: PredicateObligation, clause: Clause, span: Span, parent_trait_pred: Binder<TraitClause>, index: number): PredicateObligation {
    const cause = clone_ObligationCause(self.cause).derived_cause(parent_trait_pred, (derived): ObligationCauseCode => ({
      $: "ImplDerived",
      _0: {
        derived,
        impl_or_alias_def_id: PolyTraitClause.def_id(parent_trait_pred),
        impl_def_clause_index: index,
        span,
      },
    }));
    return new Obligation(cause, self.param_env, clause.as_predicate(), 0);
  },
};

/// A specialized variant of `elaborate` that only elaborates trait references that may
/// define the given associated item with the name `assoc_name`. It uses the
/// `explicit_supertraits_containing_assoc_item` query to avoid enumerating super-predicates that
/// aren't related to `assoc_item`. This is used when resolving types like `Self::Item` or
/// `T::Item` and helps to avoid cycle errors (see e.g. #35237).
// PORT: the `std::iter::from_fn` closure is a generator; `seen` and `stack` are built first, as upstream.
// rustc: compiler/rustc_infer/src/traits/util.rs:111 transitive_bounds_that_define_assoc_item
export function transitive_bounds_that_define_assoc_item(tcx: TyCtxt, trait_refs: Iterable<PolyTraitRef>, assoc_name: Ident): Iterable<PolyTraitRef> {
  const seen = new KeyedSet<PolyTraitRef>(intern_key);
  const stack: PolyTraitRef[] = [...trait_refs];

  return (function* (): Generator<PolyTraitRef> {
    for (;;) {
      let trait_ref: PolyTraitRef | undefined;
      let found = false;
      while ((trait_ref = stack.pop()) !== undefined) {
        if (!set_insert(seen, tcx.anonymize_bound_vars(trait_ref, d_TraitRef))) {
          continue;
        }

        // PORT: the query's value is typed `unknown` in queries.gen.ts; it is `EarlyBinder<&[(Clause, Span)]>`.
        const supertraits = tcx.explicit_supertraits_containing_assoc_item([PolyTraitRefC.def_id(trait_ref), assoc_name]) as EarlyBinder<readonly [Clause, Span][]>;
        const tr = trait_ref;
        for (const u of EarlyBinder.iter_identity_copied(supertraits)) {
          const [clause_] = Unnormalized.skip_norm_wip(u);
          const clause = clause_.instantiate_supertrait(tcx, tr);
          const trait_clause = clause.as_trait_clause();
          if (trait_clause === undefined) continue;
          if (PolyTraitClause.polarity(trait_clause) !== "Positive") continue;
          stack.push(Binder.map_bound(trait_clause, (c) => c.trait_ref));
        }

        found = true;
        break;
      }
      if (!found) return;
      yield trait_ref!;
    }
  })();
}

/** `HashSet::insert`: whether the value was newly inserted. */
function set_insert<T>(set: Set<T>, value: T): boolean {
  if (set.has(value)) return false;
  set.add(value);
  return true;
}
