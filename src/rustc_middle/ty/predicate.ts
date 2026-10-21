// Contract stub + partial port of compiler/rustc_middle/src/ty/predicate.rs (lane ty-contract, docs/plan-m3.md
// D2; the rest is lane ty-args').
//
// PORT (D2):
// - `Predicate(Interned<WithCachedTypeInfo<Binder<PredicateKind>>>)` is the hash-consed object itself, made only
//   by `CtxtInterners::intern_predicate` (context.ts). Fields as for `Ty`: `internee`, `flags_`,
//   `outer_exclusive_binder_` (renamed: `impl Flags` needs the method names).
// - `Clause` wraps the *same* interned pointer (`Clause(self.0)` / `Predicate(self.0)`). To keep `===` exact, each
//   `Predicate` owns exactly one `Clause` twin, made with it and frozen with it: `Clause.of(p)` is
//   `Clause(p.0)` and `clause.as_predicate()` returns the twin back. `Clause.of` must only be used where upstream
//   writes `Clause(self.0)` (after checking the kind is `PredicateKind::Clause`).
// - Methods: declared in decls.ts, assigned below in upstream order (lane ty-args). A method of an `inherent::*` /
//   `IntoKind` / `BoundExistentialPredicates` impl that only forwards to the inherent method of the same name is that
//   method (its marker sits on it).
// - `impl UpcastFrom<TyCtxt, X> for Y` is the free fn `Y_upcast_from_X(from, tcx)` (the names of the stand-ins in
//   rustc_type_ir/predicate.ts and relate/combine.ts); `x.upcast(tcx)` is a direct call of the impl it selects.
//   `ty::Binder<'tcx, X>` is `Binder_X`, or `PolyX` where rustc_middle has that alias (`PolyTraitRef`, ...);
//   `Binder<HostEffectClause>` is `PolyHostEffectClause` (as in rustc_type_ir/predicate.ts).
// - `impl Iterator` results are arrays (the closures have no side effects).
import { Interned } from "../../rustc_data_structures/intern.ts";
import type { DiagArgValue, PathBuf } from "../../rustc_error_messages/lib.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { bug } from "../../rustc_span/macros.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { ClauseKind, DebruijnIndex, ExistentialPredicate, ExistentialProjection, ExistentialTraitRef, HostEffectClause, NormalizesTo, PolyExistentialPredicate, PolyTraitRef, PredicateKind, ProjectionClause, RegionOutlivesClause, TraitClause, TraitRef, TypeFlags, TypeOutlivesClause } from "../../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { Predicate_provided } from "../../rustc_type_ir/inherent.ts";
import { fold_with_ClauseKind, try_fold_with_ClauseKind, visit_with_ClauseKind, visit_with_PredicateKind } from "../../rustc_type_ir/predicate_kind.gen.ts";
import { fold_with_OutlivesClause, try_fold_with_OutlivesClause, visit_with_OutlivesClause, visit_with_TraitRef } from "../../rustc_type_ir/predicate.gen.ts";
import { fold_with_GenericArg, try_fold_with_GenericArg, visit_with_GenericArg } from "./generic_args.ts";
import type { ArgOutlivesClause } from "./predicate.gen.ts";
import { ClausePolarity, PolyTraitClause } from "../../rustc_type_ir/predicate.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import type { TypeVisitable } from "../../rustc_type_ir/visit.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { panic, unported, unreachable } from "../../std/panic.ts";
import type { TyCtxt } from "./context.ts";
import { RawList, type List } from "./list.ts";
import type { Ordering } from "./mod.ts";
import type { FallibleTypeFolder, TypeFolder } from "../../rustc_type_ir/fold.ts";
import type { TypeVisitor } from "../../rustc_type_ir/visit.ts";
import type { Fmt } from "../../std/fmt.ts";
import type { Result } from "../../std/result.ts";
import { debug_Clause, debug_Predicate, fold_Clause, fold_Predicate } from "./structural_impls.ts";

// The other types of predicate.rs with their derived impls are generated into predicate.gen.ts (set rustc_ty of
// tools/codegen/types.ts, lane codegen-tyir); merged with the contract stub by merge-w13.
export * from "./predicate.gen.ts";

/// A statement that can be proven by a trait solver. This includes things that may
/// show up in where clauses, such as trait predicates and projection predicates,
/// and also things that are emitted as part of type checking such as `DynCompatible`
/// predicate which is emitted when a type is coerced to a trait object.
///
/// Use this rather than `PredicateKind`, whenever possible.
// rustc-type: compiler/rustc_middle/src/ty/predicate.rs:46 Predicate
export class Predicate extends Interned {
  /** `WithCachedTypeInfo::internee` */
  readonly internee: Binder<PredicateKind>;
  /** `WithCachedTypeInfo::flags` (renamed: module comment) */
  readonly flags_: TypeFlags;
  /** `WithCachedTypeInfo::outer_exclusive_binder` (renamed: module comment) */
  readonly outer_exclusive_binder_: DebruijnIndex;
  /** PORT: the `Clause` twin over the same interned value (module comment). */
  readonly clause_twin: Clause;

  /** PORT: only `CtxtInterners::intern_predicate` constructs (D2); the binder object is frozen with it. */
  constructor(internee: Binder<PredicateKind>, flags: TypeFlags, outer_exclusive_binder: DebruijnIndex) {
    super();
    this.internee = Object.freeze(internee);
    this.flags_ = flags;
    this.outer_exclusive_binder_ = outer_exclusive_binder;
    this.clause_twin = new Clause(this);
    Object.freeze(this);
  }

  // rustc: compiler/rustc_middle/src/ty/predicate.rs:65 flags
  flags(): TypeFlags {
    return this.flags_;
  }

  // rustc: compiler/rustc_middle/src/ty/predicate.rs:69 outer_exclusive_binder
  outer_exclusive_binder(): DebruijnIndex {
    return this.outer_exclusive_binder_;
  }

  /// Gets the inner `ty::Binder<'tcx, PredicateKind<'tcx>>`.
  // PORT: also `impl IntoKind for Predicate` (predicate.rs:59, `self.kind()`): one method.
  // rustc: compiler/rustc_middle/src/ty/predicate.rs:59 kind
  // rustc: compiler/rustc_middle/src/ty/predicate.rs:77 kind
  kind(): Binder<PredicateKind> {
    return this.internee;
  }
}

/// A subset of predicates which can be assumed by the trait solver. They show up in
/// an item's where clauses, hence the name `Clause`, and may either be user-written
/// (such as traits) or may be inserted during lowering.
// rustc-type: compiler/rustc_middle/src/ty/predicate.rs:136 Clause
export class Clause extends Interned {
  /** PORT: the `Predicate` over the same interned value (module comment). */
  readonly predicate_twin: Predicate;

  /** PORT: only `Predicate`'s constructor makes the twin (module comment). */
  constructor(predicate: Predicate) {
    super();
    this.predicate_twin = predicate;
    Object.freeze(this);
  }

  /** PORT: `Clause(pred.0)` (module comment). */
  static of(pred: Predicate): Clause {
    return pred.clause_twin;
  }

  /** `self.0.internee` */
  get internee(): Binder<PredicateKind> {
    return this.predicate_twin.internee;
  }

  // PORT: also `impl inherent::Clause for Clause` (predicate.rs:141, `self.as_predicate()`): one method.
  // rustc: compiler/rustc_middle/src/ty/predicate.rs:141 as_predicate
  // rustc: compiler/rustc_middle/src/ty/predicate.rs:169 as_predicate
  as_predicate(): Predicate {
    return this.predicate_twin;
  }

  // rustc: compiler/rustc_middle/src/ty/predicate.rs:159 flags
  flags(): TypeFlags {
    return this.predicate_twin.flags_;
  }

  // rustc: compiler/rustc_middle/src/ty/predicate.rs:163 outer_exclusive_binder
  outer_exclusive_binder(): DebruijnIndex {
    return this.predicate_twin.outer_exclusive_binder_;
  }
}

// ---- impl Predicate (predicate.rs:74) ----

/// Flips the polarity of a Predicate.
///
/// Given `T: Trait` predicate it returns `T: !Trait` and given `T: !Trait` returns `T: Trait`.
// rustc: compiler/rustc_middle/src/ty/predicate.rs:84 flip_polarity
Predicate.prototype.flip_polarity = function (this: Predicate, tcx: TyCtxt): Predicate | undefined {
  const kind = Binder.transpose(
    Binder.map_bound(this.kind(), (kind): PredicateKind | undefined => {
      if (kind.$ === "Clause" && kind._0.$ === "Trait") {
        const { trait_ref, polarity } = kind._0._0;
        return {
          $: "Clause",
          _0: {
            $: "Trait",
            _0: {
              trait_ref,
              polarity: ClausePolarity.flip(polarity),
            },
          },
        };
      }

      return undefined;
    }),
  );
  if (kind === undefined) return undefined;

  return tcx.mk_predicate(kind);
};

/// Whether this projection can be soundly normalized.
///
/// Wf predicates must not be normalized, as normalization
/// can remove required bounds which would cause us to
/// unsoundly accept some programs. See #91068.
// #[inline]
// rustc: compiler/rustc_middle/src/ty/predicate.rs:108 allow_normalization
Predicate.prototype.allow_normalization = function (this: Predicate): boolean {
  return Predicate_provided.allow_normalization(this);
};

/** `impl IntoDiagArg for Predicate`.
 *  PORT: `tcx.lift(self)` is the identity (`Lift` is skipped, PORTING §3); `Print for Predicate` is ty/print/pretty.ts's
 *  `print_Predicate`, loaded lazily (extension module, ty-contract "Init order"). */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:114 into_diag_arg
export function Predicate_into_diag_arg(self: Predicate, path: MutRef<PathBuf | undefined>): DiagArgValue {
  return tls().with_((tcx) => {
    const pred = tcx.short_string(tcx.lift(self), path, pretty().print_Predicate);
    return { $: "Str", _0: pred };
  });
}

/** `impl IntoDiagArg for Clause` (see `Predicate_into_diag_arg`). */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:123 into_diag_arg
export function Clause_into_diag_arg(self: Clause, path: MutRef<PathBuf | undefined>): DiagArgValue {
  return tls().with_((tcx) => {
    const clause = tcx.short_string(tcx.lift(self), path, pretty().print_Clause);
    return { $: "Str", _0: clause };
  });
}

/** PORT: lazy load of context/tls.ts, which imports context.ts (a defining module that imports this one). */
function tls(): typeof import("./context/tls.ts") {
  return require("./context/tls.ts") as typeof import("./context/tls.ts");
}

/** PORT: lazy load of the extension module ty/print/pretty.ts (module comment of `Predicate_into_diag_arg`). */
function pretty(): typeof import("./print/pretty.ts") {
  return require("./print/pretty.ts") as typeof import("./print/pretty.ts");
}

// ---- impl Clause (predicate.rs:168) ----

// PORT: also `impl IntoKind for Clause` (predicate.rs:153, `self.kind()`): one method.
// rustc: compiler/rustc_middle/src/ty/predicate.rs:153 kind
// rustc: compiler/rustc_middle/src/ty/predicate.rs:173 kind
Clause.prototype.kind = function (this: Clause): Binder<ClauseKind> {
  // Outline the unreachable! call to make the happy path faster.
  // see: https://github.com/rust-lang/rust/pull/163657#issuecomment-5956974964
  return Binder.map_bound_no_validate_bound_vars(this.internee, (kind) => {
    switch (kind.$) {
      case "Clause":
        return kind._0;
      default:
        return unreachable_inner();
    }
  });
};

// #[cold] #[inline(never)] (local to `Clause::kind`)
// rustc: compiler/rustc_middle/src/ty/predicate.rs:178 unreachable_inner
function unreachable_inner(): never {
  return unreachable();
}

// rustc: compiler/rustc_middle/src/ty/predicate.rs:188 as_trait_clause
Clause.prototype.as_trait_clause = function (this: Clause): Binder<TraitClause> | undefined {
  const clause = this.kind();
  const k = Binder.skip_binder(clause);
  if (k.$ === "Trait") {
    const trait_clause = k._0;
    return Binder.rebind(clause, trait_clause);
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_middle/src/ty/predicate.rs:197 as_projection_clause
Clause.prototype.as_projection_clause = function (this: Clause): Binder<ProjectionClause> | undefined {
  const clause = this.kind();
  const k = Binder.skip_binder(clause);
  if (k.$ === "Projection") {
    const projection_clause = k._0;
    return Binder.rebind(clause, projection_clause);
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_middle/src/ty/predicate.rs:206 as_type_outlives_clause
Clause.prototype.as_type_outlives_clause = function (this: Clause): Binder<TypeOutlivesClause> | undefined {
  const clause = this.kind();
  const k = Binder.skip_binder(clause);
  if (k.$ === "TypeOutlives") {
    const o = k._0;
    return Binder.rebind(clause, o);
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_middle/src/ty/predicate.rs:215 as_region_outlives_clause
Clause.prototype.as_region_outlives_clause = function (this: Clause): Binder<RegionOutlivesClause> | undefined {
  const clause = this.kind();
  const k = Binder.skip_binder(clause);
  if (k.$ === "RegionOutlives") {
    const o = k._0;
    return Binder.rebind(clause, o);
  } else {
    return undefined;
  }
};

// ---- ExistentialPredicateStableCmpExt (predicate.rs:227) ----

/// Compares via an ordering that will not change if modules are reordered or other changes are
/// made to the tree. In particular, this ordering is preserved across incremental compilations.
// PORT: `#[extension(pub trait ExistentialPredicateStableCmpExt)]`: a free fn. `DefPathHash` is a `bigint` whose order
// is the derived `Ord` (rustc_data_structures/fingerprint.ts).
// rustc: compiler/rustc_middle/src/ty/predicate.rs:231 stable_cmp
export function ExistentialPredicate_stable_cmp(self: ExistentialPredicate, tcx: TyCtxt, other: ExistentialPredicate): Ordering {
  if (self.$ === "Trait" && other.$ === "Trait") {
    return "Equal";
  } else if (self.$ === "Projection" && other.$ === "Projection") {
    const a = self._0;
    const b = other._0;
    return cmp_bigint(tcx.def_path_hash(a.def_id), tcx.def_path_hash(b.def_id));
  } else if (self.$ === "AutoTrait" && other.$ === "AutoTrait") {
    const a = self._0;
    const b = other._0;
    return cmp_bigint(tcx.def_path_hash(a), tcx.def_path_hash(b));
  } else if (self.$ === "Trait") {
    return "Less";
  } else if (self.$ === "Projection" && other.$ === "Trait") {
    return "Greater";
  } else if (self.$ === "Projection") {
    return "Less";
  } else {
    // (ExistentialPredicate::AutoTrait(_), _)
    return "Greater";
  }
}

/** `Ord::cmp` on `bigint`. */
function cmp_bigint(a: bigint, b: bigint): Ordering {
  return a < b ? "Less" : a > b ? "Greater" : "Equal";
}

// ---- impl List<PolyExistentialPredicate> (predicate.rs:274) ----

/// Returns the "principal `DefId`" of this set of existential predicates.
///
/// A Rust trait object type consists (in addition to a lifetime bound)
/// of a set of trait bounds, which are separated into any number
/// of auto-trait bounds, and at most one non-auto-trait bound. The
/// non-auto-trait bound is called the "principal" of the trait
/// object.
///
/// Only the principal can have methods or type parameters (because
/// auto traits can have neither of them). This is important, because
/// it means the auto traits can be treated as an unordered set (methods
/// would force an order for the vtable, while relating traits with
/// type parameters without knowing the order to relate them in is
/// a rather non-trivial task).
///
/// For example, in the trait object `dyn std::fmt::Debug + Sync`, the
/// principal bound is `Some(std::fmt::Debug)`, while the auto-trait bounds
/// are the set `{Sync}`.
///
/// It is also possible to have a "trivial" trait object that
/// consists only of auto traits, with no principal - for example,
/// `dyn Send + Sync`. In that case, the set of auto-trait bounds
/// is `{Send, Sync}`, while there is no principal. These trait objects
/// have a "trivial" vtable consisting of just the size, alignment,
/// and destructor.
// PORT: also `impl BoundExistentialPredicates` `principal` (predicate.rs:259): one method.
// rustc: compiler/rustc_middle/src/ty/predicate.rs:259 principal
// rustc: compiler/rustc_middle/src/ty/predicate.rs:300 principal
RawList.prototype.principal = function (this: List<PolyExistentialPredicate>): Binder<ExistentialTraitRef> | undefined {
  return Binder.transpose(
    Binder.map_bound(index(this, 0), (this_) => {
      switch (this_.$) {
        case "Trait":
          return this_._0;
        default:
          return undefined;
      }
    }),
  );
};

// PORT: also `impl BoundExistentialPredicates` `principal_def_id` (predicate.rs:255): one method.
// rustc: compiler/rustc_middle/src/ty/predicate.rs:255 principal_def_id
// rustc: compiler/rustc_middle/src/ty/predicate.rs:309 principal_def_id
RawList.prototype.principal_def_id = function (this: List<PolyExistentialPredicate>): DefId | undefined {
  const p = this.principal();
  return p === undefined ? undefined : Binder.skip_binder(p).def_id;
};

// PORT: also `impl BoundExistentialPredicates` `projection_bounds` (predicate.rs:267): one method.
// #[inline]
// rustc: compiler/rustc_middle/src/ty/predicate.rs:267 projection_bounds
// rustc: compiler/rustc_middle/src/ty/predicate.rs:314 projection_bounds
RawList.prototype.projection_bounds = function (this: List<PolyExistentialPredicate>): Binder<ExistentialProjection>[] {
  const out: Binder<ExistentialProjection>[] = [];
  for (const predicate of this) {
    const p = Binder.transpose(
      Binder.map_bound(predicate, (pred) => {
        switch (pred.$) {
          case "Projection":
            return pred._0;
          default:
            return undefined;
        }
      }),
    );
    if (p !== undefined) out.push(p);
  }
  return out;
};

// PORT: also `impl BoundExistentialPredicates` `auto_traits` (predicate.rs:263): one method.
// #[inline]
// rustc: compiler/rustc_middle/src/ty/predicate.rs:263 auto_traits
// rustc: compiler/rustc_middle/src/ty/predicate.rs:328 auto_traits
RawList.prototype.auto_traits = function (this: List<PolyExistentialPredicate>): DefId[] {
  const out: DefId[] = [];
  for (const predicate of this) {
    const k = Binder.skip_binder(predicate);
    if (k.$ === "AutoTrait") out.push(k._0);
  }
  return out;
};

// rustc: compiler/rustc_middle/src/ty/predicate.rs:335 without_auto_traits
RawList.prototype.without_auto_traits = function (this: List<PolyExistentialPredicate>): PolyExistentialPredicate[] {
  return this.filter((predicate) => !(Binder.skip_binder(Binder.as_ref(predicate)).$ === "AutoTrait"));
};

/** PORT: `self[i]` with core's `panic_bounds_check` text. */
function index<T>(v: readonly T[], i: number): T {
  if (i < 0 || i >= v.length) panic(`index out of bounds: the len is ${v.length} but the index is ${i}`);
  return v[i]!;
}

// ---- impl Clause (predicate.rs:346) ----

/** PORT: the generated `TypeFoldable` / `TypeVisitable` impl fns of `ClauseKind` as a D4 descriptor. */
const d_ClauseKind: TypeFoldable<ClauseKind> = { visit_with: visit_with_ClauseKind, try_fold_with: try_fold_with_ClauseKind, fold_with: fold_with_ClauseKind };

/// Performs a instantiation suitable for going from a
/// poly-trait-ref to supertraits that must hold if that
/// poly-trait-ref holds. This is slightly different from a normal
/// instantiation in terms of what happens with bound regions. See
/// lengthy comment below for details.
// PORT: also `impl inherent::Clause` `instantiate_supertrait` (predicate.rs:145): one method.
// rustc: compiler/rustc_middle/src/ty/predicate.rs:145 instantiate_supertrait
// rustc: compiler/rustc_middle/src/ty/predicate.rs:352 instantiate_supertrait
Clause.prototype.instantiate_supertrait = function (this: Clause, tcx: TyCtxt, trait_ref: PolyTraitRef): Clause {
  // The interaction between HRTB and supertraits is not entirely
  // obvious. Let me walk you (and myself) through an example.
  //
  // Let's start with an easy case. Consider two traits:
  //
  //     trait Foo<'a>: Bar<'a,'a> { }
  //     trait Bar<'b,'c> { }
  //
  // Now, if we have a trait reference `for<'x> T: Foo<'x>`, then
  // we can deduce that `for<'x> T: Bar<'x,'x>`. Basically, if we
  // knew that `Foo<'x>` (for any 'x) then we also know that
  // `Bar<'x,'x>` (for any 'x). This more-or-less falls out from
  // normal instantiation.
  //
  // In terms of why this is sound, the idea is that whenever there
  // is an impl of `T:Foo<'a>`, it must show that `T:Bar<'a,'a>`
  // holds. So if there is an impl of `T:Foo<'a>` that applies to
  // all `'a`, then we must know that `T:Bar<'a,'a>` holds for all
  // `'a`.
  //
  // Another example to be careful of is this:
  //
  //     trait Foo1<'a>: for<'b> Bar1<'a,'b> { }
  //     trait Bar1<'b,'c> { }
  //
  // Here, if we have `for<'x> T: Foo1<'x>`, then what do we know?
  // The answer is that we know `for<'x,'b> T: Bar1<'x,'b>`. The
  // reason is similar to the previous example: any impl of
  // `T:Foo1<'x>` must show that `for<'b> T: Bar1<'x, 'b>`. So
  // basically we would want to collapse the bound lifetimes from
  // the input (`trait_ref`) and the supertraits.
  //
  // To achieve this in practice is fairly straightforward. Let's
  // consider the more complicated scenario:
  //
  // - We start out with `for<'x> T: Foo1<'x>`. In this case, `'x`
  //   has a De Bruijn index of 1. We want to produce `for<'x,'b> T: Bar1<'x,'b>`,
  //   where both `'x` and `'b` would have a DB index of 1.
  //   The instantiation from the input trait-ref is therefore going to be
  //   `'a => 'x` (where `'x` has a DB index of 1).
  // - The supertrait-ref is `for<'b> Bar1<'a,'b>`, where `'a` is an
  //   early-bound parameter and `'b` is a late-bound parameter with a
  //   DB index of 1.
  // - If we replace `'a` with `'x` from the input, it too will have
  //   a DB index of 1, and thus we'll have `for<'x,'b> Bar1<'x,'b>`
  //   just as we wanted.
  //
  // There is only one catch. If we just apply the instantiation `'a
  // => 'x` to `for<'b> Bar1<'a,'b>`, the instantiation code will
  // adjust the DB index because we instantiating into a binder (it
  // tries to be so smart...) resulting in `for<'x> for<'b>
  // Bar1<'x,'b>` (we have no syntax for this, so use your
  // imagination). Basically the 'x will have DB index of 2 and 'b
  // will have DB index of 1. Not quite what we want. So we apply
  // the instantiation to the *contents* of the trait reference,
  // rather than the trait reference itself (put another way, the
  // instantiation code expects equal binding levels in the values
  // from the instantiation and the value being instantiated into, and
  // this trick achieves that).

  // Working through the second example:
  // trait_ref: for<'x> T: Foo1<'^0.0>; args: [T, '^0.0]
  // predicate: for<'b> Self: Bar1<'a, '^0.0>; args: [Self, 'a, '^0.0]
  // We want to end up with:
  //     for<'x, 'b> T: Bar1<'^0.0, '^0.1>
  // To do this:
  // 1) We must shift all bound vars in predicate by the length
  //    of trait ref's bound vars. So, we would end up with predicate like
  //    Self: Bar1<'a, '^0.1>
  // 2) We can then apply the trait args to this, ending up with
  //    T: Bar1<'^0.0, '^0.1>
  // 3) Finally, to create the final bound vars, we concatenate the bound
  //    vars of the trait ref with those of the predicate:
  //    ['x, 'b]
  const bound_pred = this.kind();
  const pred_bound_vars = Binder.bound_vars(bound_pred);
  const trait_bound_vars = Binder.bound_vars(trait_ref);
  // 1) Self: Bar1<'a, '^0.0> -> Self: Bar1<'a, '^0.1>
  const shifted_pred = tcx.shift_bound_var_indices(trait_bound_vars.length, Binder.skip_binder(bound_pred), d_ClauseKind);
  // 2) Self: Bar1<'a, '^0.1> -> T: Bar1<'^0.0, '^0.1>
  const new_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(EarlyBinder.bind(tcx, shifted_pred, d_ClauseKind), tcx, Binder.skip_binder(trait_ref).args, d_ClauseKind));
  // 3) ['x] + ['b] -> ['x, 'b]
  const bound_vars = tcx.mk_bound_variable_kinds_from_iter([...trait_bound_vars, ...pred_bound_vars]);

  // FIXME: Is it really perf sensitive to use reuse_or_mk_predicate here?
  return tcx.reuse_or_mk_predicate(this.as_predicate(), Binder.bind_with_vars<PredicateKind>({ $: "Clause", _0: new_ }, bound_vars)).expect_clause();
};

// ---- UpcastFrom impls (predicate.rs:454) ----

/** PORT: the generated `TypeVisitable` impl fns as D4 descriptors (for `Binder::dummy`). */
const d_PredicateKind: TypeVisitable<PredicateKind> = { visit_with: visit_with_PredicateKind };
const d_TraitRef: TypeVisitable<TraitRef> = { visit_with: visit_with_TraitRef };

/** `impl UpcastFrom<TyCtxt, PredicateKind> for Predicate` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:455 upcast_from
export function Predicate_upcast_from_PredicateKind(from: PredicateKind, tcx: TyCtxt): Predicate {
  return Predicate_upcast_from_Binder_PredicateKind(Binder.dummy(from, d_PredicateKind), tcx);
}

/** `impl UpcastFrom<TyCtxt, Binder<PredicateKind>> for Predicate` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:461 upcast_from
export function Predicate_upcast_from_Binder_PredicateKind(from: Binder<PredicateKind>, tcx: TyCtxt): Predicate {
  return tcx.mk_predicate(from);
}

/** `impl UpcastFrom<TyCtxt, ClauseKind> for Predicate` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:467 upcast_from
export function Predicate_upcast_from_ClauseKind(from: ClauseKind, tcx: TyCtxt): Predicate {
  return tcx.mk_predicate(Binder.dummy<PredicateKind>({ $: "Clause", _0: from }, d_PredicateKind));
}

/** `impl UpcastFrom<TyCtxt, Binder<ClauseKind>> for Predicate` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:473 upcast_from
export function Predicate_upcast_from_Binder_ClauseKind(from: Binder<ClauseKind>, tcx: TyCtxt): Predicate {
  return tcx.mk_predicate(Binder.map_bound(from, (c): PredicateKind => ({ $: "Clause", _0: c })));
}

/** `impl UpcastFrom<TyCtxt, Clause> for Predicate` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:479 upcast_from
export function Predicate_upcast_from_Clause(from: Clause, _tcx: TyCtxt): Predicate {
  return from.as_predicate();
}

/** `impl UpcastFrom<TyCtxt, ClauseKind> for Clause` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:485 upcast_from
export function Clause_upcast_from_ClauseKind(from: ClauseKind, tcx: TyCtxt): Clause {
  return tcx.mk_predicate(Binder.dummy<PredicateKind>({ $: "Clause", _0: from }, d_PredicateKind)).expect_clause();
}

/** `impl UpcastFrom<TyCtxt, Binder<ClauseKind>> for Clause` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:491 upcast_from
export function Clause_upcast_from_Binder_ClauseKind(from: Binder<ClauseKind>, tcx: TyCtxt): Clause {
  return tcx.mk_predicate(Binder.map_bound(from, (clause): PredicateKind => ({ $: "Clause", _0: clause }))).expect_clause();
}

/** `impl UpcastFrom<TyCtxt, TraitRef> for Predicate` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:497 upcast_from
export function Predicate_upcast_from_TraitRef(from: TraitRef, tcx: TyCtxt): Predicate {
  return Predicate_upcast_from_PolyTraitRef(Binder.dummy(from, d_TraitRef), tcx);
}

/** `impl UpcastFrom<TyCtxt, TraitRef> for Clause` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:503 upcast_from
export function Clause_upcast_from_TraitRef(from: TraitRef, tcx: TyCtxt): Clause {
  const p: Predicate = Predicate_upcast_from_TraitRef(from, tcx);
  return p.expect_clause();
}

/** `impl UpcastFrom<TyCtxt, Binder<TraitRef>> for Predicate`.
 *  PORT: `from.upcast(tcx)` to `PolyTraitClause` is rustc_type_ir's `UpcastFrom<Binder<TraitRef>> for Binder<TraitClause>`
 *  (`PolyTraitClause.upcast_from_PolyTraitRef`), which takes the `Interner` (`TyCtxt`, D3). */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:510 upcast_from
export function Predicate_upcast_from_PolyTraitRef(from: PolyTraitRef, tcx: TyCtxt): Predicate {
  const pred: Binder<TraitClause> = PolyTraitClause.upcast_from_PolyTraitRef(from, as_interner(tcx));
  return Predicate_upcast_from_PolyTraitClause(pred, tcx);
}

/** `impl UpcastFrom<TyCtxt, Binder<TraitRef>> for Clause` (see `Predicate_upcast_from_PolyTraitRef`). */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:517 upcast_from
export function Clause_upcast_from_PolyTraitRef(from: PolyTraitRef, tcx: TyCtxt): Clause {
  const pred: Binder<TraitClause> = PolyTraitClause.upcast_from_PolyTraitRef(from, as_interner(tcx));
  return Clause_upcast_from_PolyTraitClause(pred, tcx);
}

/** `impl UpcastFrom<TyCtxt, TraitClause> for Predicate` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:524 upcast_from
export function Predicate_upcast_from_TraitClause(from: TraitClause, tcx: TyCtxt): Predicate {
  return Predicate_upcast_from_PredicateKind({ $: "Clause", _0: { $: "Trait", _0: from } }, tcx);
}

/** `impl UpcastFrom<TyCtxt, PolyTraitClause> for Predicate` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:530 upcast_from
export function Predicate_upcast_from_PolyTraitClause(from: Binder<TraitClause>, tcx: TyCtxt): Predicate {
  return Predicate_upcast_from_Binder_PredicateKind(
    Binder.map_bound_no_validate_bound_vars(from, (p): PredicateKind => ({ $: "Clause", _0: { $: "Trait", _0: p } })),
    tcx,
  );
}

/** `impl UpcastFrom<TyCtxt, TraitClause> for Clause` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:537 upcast_from
export function Clause_upcast_from_TraitClause(from: TraitClause, tcx: TyCtxt): Clause {
  const p: Predicate = Predicate_upcast_from_TraitClause(from, tcx);
  return p.expect_clause();
}

/** `impl UpcastFrom<TyCtxt, PolyTraitClause> for Clause` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:544 upcast_from
export function Clause_upcast_from_PolyTraitClause(from: Binder<TraitClause>, tcx: TyCtxt): Clause {
  const p: Predicate = Predicate_upcast_from_PolyTraitClause(from, tcx);
  return p.expect_clause();
}

/** `impl UpcastFrom<TyCtxt, RegionOutlivesClause> for Predicate` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:551 upcast_from
export function Predicate_upcast_from_RegionOutlivesClause(from: RegionOutlivesClause, tcx: TyCtxt): Predicate {
  return Predicate_upcast_from_Binder_PredicateKind(Binder.dummy<PredicateKind>({ $: "Clause", _0: { $: "RegionOutlives", _0: from } }, d_PredicateKind), tcx);
}

/** `impl UpcastFrom<TyCtxt, PolyRegionOutlivesClause> for Predicate` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:557 upcast_from
export function Predicate_upcast_from_PolyRegionOutlivesClause(from: Binder<RegionOutlivesClause>, tcx: TyCtxt): Predicate {
  return Predicate_upcast_from_Binder_PredicateKind(
    Binder.map_bound(from, (c): PredicateKind => ({ $: "Clause", _0: { $: "RegionOutlives", _0: c } })),
    tcx,
  );
}

/** `impl UpcastFrom<TyCtxt, TypeOutlivesClause> for Predicate` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:563 upcast_from
export function Predicate_upcast_from_TypeOutlivesClause(from: TypeOutlivesClause, tcx: TyCtxt): Predicate {
  return Predicate_upcast_from_Binder_PredicateKind(Binder.dummy<PredicateKind>({ $: "Clause", _0: { $: "TypeOutlives", _0: from } }, d_PredicateKind), tcx);
}

/** `impl UpcastFrom<TyCtxt, ProjectionClause> for Predicate` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:569 upcast_from
export function Predicate_upcast_from_ProjectionClause(from: ProjectionClause, tcx: TyCtxt): Predicate {
  return Predicate_upcast_from_Binder_PredicateKind(Binder.dummy<PredicateKind>({ $: "Clause", _0: { $: "Projection", _0: from } }, d_PredicateKind), tcx);
}

/** `impl UpcastFrom<TyCtxt, PolyProjectionClause> for Predicate` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:575 upcast_from
export function Predicate_upcast_from_PolyProjectionClause(from: Binder<ProjectionClause>, tcx: TyCtxt): Predicate {
  return Predicate_upcast_from_Binder_PredicateKind(
    Binder.map_bound(from, (p): PredicateKind => ({ $: "Clause", _0: { $: "Projection", _0: p } })),
    tcx,
  );
}

/** `impl UpcastFrom<TyCtxt, ProjectionClause> for Clause` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:581 upcast_from
export function Clause_upcast_from_ProjectionClause(from: ProjectionClause, tcx: TyCtxt): Clause {
  const p: Predicate = Predicate_upcast_from_ProjectionClause(from, tcx);
  return p.expect_clause();
}

/** `impl UpcastFrom<TyCtxt, PolyProjectionClause> for Clause` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:588 upcast_from
export function Clause_upcast_from_PolyProjectionClause(from: Binder<ProjectionClause>, tcx: TyCtxt): Clause {
  const p: Predicate = Predicate_upcast_from_PolyProjectionClause(from, tcx);
  return p.expect_clause();
}

/** `impl UpcastFrom<TyCtxt, Binder<HostEffectClause>> for Predicate` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:597 upcast_from
export function Predicate_upcast_from_PolyHostEffectClause(from: Binder<HostEffectClause>, tcx: TyCtxt): Predicate {
  return Predicate_upcast_from_Binder_ClauseKind(
    Binder.map_bound(from, (c): ClauseKind => ({ $: "HostEffect", _0: c })),
    tcx,
  );
}

/** `impl UpcastFrom<TyCtxt, Binder<HostEffectClause>> for Clause` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:603 upcast_from
export function Clause_upcast_from_PolyHostEffectClause(from: Binder<HostEffectClause>, tcx: TyCtxt): Clause {
  return Clause_upcast_from_Binder_ClauseKind(
    Binder.map_bound(from, (c): ClauseKind => ({ $: "HostEffect", _0: c })),
    tcx,
  );
}

/** `impl UpcastFrom<TyCtxt, NormalizesTo> for Predicate` */
// rustc: compiler/rustc_middle/src/ty/predicate.rs:609 upcast_from
export function Predicate_upcast_from_NormalizesTo(from: NormalizesTo, tcx: TyCtxt): Predicate {
  return Predicate_upcast_from_PredicateKind({ $: "NormalizesTo", _0: from }, tcx);
}

/** PORT (D3): `TyCtxt` viewed as the `Interner` (as rustc_type_ir/predicate.ts's `as_interner`; root drops both when the
 *  query value types are generated). */
function as_interner(tcx: TyCtxt): import("../../rustc_type_ir/interner.ts").Interner {
  return tcx as unknown as import("../../rustc_type_ir/interner.ts").Interner;
}

// ---- impl Predicate (predicate.rs:614) ----

// rustc: compiler/rustc_middle/src/ty/predicate.rs:615 as_trait_clause
Predicate.prototype.as_trait_clause = function (this: Predicate): Binder<TraitClause> | undefined {
  const predicate = this.kind();
  const k = Binder.skip_binder(predicate);
  if (k.$ === "Clause" && k._0.$ === "Trait") {
    const t = k._0._0;
    return Binder.rebind(predicate, t);
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_middle/src/ty/predicate.rs:623 as_projection_clause
Predicate.prototype.as_projection_clause = function (this: Predicate): Binder<ProjectionClause> | undefined {
  const predicate = this.kind();
  const k = Binder.skip_binder(predicate);
  if (k.$ === "Clause" && k._0.$ === "Projection") {
    const t = k._0._0;
    return Binder.rebind(predicate, t);
  } else {
    return undefined;
  }
};

/// Matches a `PredicateKind::Clause` and turns it into a `Clause`, otherwise returns `None`.
// PORT: also `impl inherent::Predicate` `as_clause` (predicate.rs:51): one method.
// rustc: compiler/rustc_middle/src/ty/predicate.rs:51 as_clause
// rustc: compiler/rustc_middle/src/ty/predicate.rs:632 as_clause
Predicate.prototype.as_clause = function (this: Predicate): Clause | undefined {
  switch (Binder.skip_binder(this.kind()).$) {
    case "Clause":
      return this.expect_clause();
    default:
      return undefined;
  }
};

/// Assert that the predicate is a clause.
// rustc: compiler/rustc_middle/src/ty/predicate.rs:640 expect_clause
Predicate.prototype.expect_clause = function (this: Predicate): Clause {
  switch (Binder.skip_binder(this.kind()).$) {
    case "Clause":
      return Clause.of(this);
    default:
      return bug(`${pretty().display_Predicate(this)} is not a clause`);
  }
};

// ---- tools/codegen's view of the Debug / traversal impls (merge-w13) ----
// PORT: generated code calls `debug_<T>` and the `visit_with_<T>` / `try_fold_with_<T>` / `fold_with_<T>` free fns
// (tools/codegen type_fold.json). The impls are structural_impls.rs's (lane ty-results): the Debug fns are re-exported
// and these wrap its D4 descriptors `fold_Predicate` / `fold_Clause` (merge-w15b).
export { debug_Clause, debug_Predicate };
export function visit_with_Predicate<R>(self: Predicate, visitor: TypeVisitor<R>): R {
  return fold_Predicate.visit_with(self, visitor);
}
export function try_fold_with_Predicate<E>(self: Predicate, folder: FallibleTypeFolder<E>): Result<Predicate, E> {
  return fold_Predicate.try_fold_with(self, folder);
}
export function fold_with_Predicate(self: Predicate, folder: TypeFolder): Predicate {
  return fold_Predicate.fold_with(self, folder);
}
export function visit_with_Clause<R>(self: Clause, visitor: TypeVisitor<R>): R {
  return fold_Clause.visit_with(self, visitor);
}
export function try_fold_with_Clause<E>(self: Clause, folder: FallibleTypeFolder<E>): Result<Clause, E> {
  return fold_Clause.try_fold_with(self, folder);
}
export function fold_with_Clause(self: Clause, folder: TypeFolder): Clause {
  return fold_Clause.fold_with(self, folder);
}

// PORT: `ty::ArgOutlivesClause<'tcx> = OutlivesClause<'tcx, GenericArg<'tcx>>` (predicate.rs:28) is a type alias: its
// `TypeVisitable` / `TypeFoldable` are rustc_type_ir's derived `OutlivesClause<A>` impls at `A = GenericArg`, named here
// for the generated code that folds a field of this type (tools/codegen/type_fold.json; merge-w18c).
export function visit_with_ArgOutlivesClause<R>(self: ArgOutlivesClause, visitor: TypeVisitor<R>): R {
  return visit_with_OutlivesClause(self, visitor, visit_with_GenericArg);
}
export function try_fold_with_ArgOutlivesClause<E>(self: ArgOutlivesClause, folder: FallibleTypeFolder<E>): Result<ArgOutlivesClause, E> {
  return try_fold_with_OutlivesClause(self, folder, try_fold_with_GenericArg);
}
export function fold_with_ArgOutlivesClause(self: ArgOutlivesClause, folder: TypeFolder): ArgOutlivesClause {
  return fold_with_OutlivesClause(self, folder, fold_with_GenericArg);
}
