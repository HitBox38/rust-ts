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
// - Methods: declared in decls.ts; the `unported_methods(..)` lists below are this file's stubs. The many
//   `UpcastFrom` impls become `upcast_*` functions (lane ty-args).
import { Interned } from "../../rustc_data_structures/intern.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import type { Binder, DebruijnIndex, PredicateKind, TypeFlags } from "../../rustc_type_ir/decls.ts";
import { RawList } from "./list.ts";
import type { FallibleTypeFolder, TypeFolder } from "../../rustc_type_ir/fold.ts";
import type { TypeVisitor } from "../../rustc_type_ir/visit.ts";
import type { Fmt } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";

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

unported_methods(Predicate.prototype, "rustc_middle::ty::predicate::Predicate", [
  "as_clause",
  "flip_polarity",
  "allow_normalization",
  "as_trait_clause",
  "as_projection_clause",
  "expect_clause",
]);
unported_methods(Clause.prototype, "rustc_middle::ty::predicate::Clause", [
  "instantiate_supertrait",
  "kind",
  "as_trait_clause",
  "as_projection_clause",
  "as_type_outlives_clause",
  "as_region_outlives_clause",
]);
unported_methods(RawList.prototype, "rustc_middle::ty::predicate::List<PolyExistentialPredicate>", [
  "principal",
  "principal_def_id",
  "projection_bounds",
  "auto_traits",
  "without_auto_traits",
]);

// ---- tools/codegen's view of the Debug / traversal impls (merge-w13) ----
// PORT: generated code calls `debug_<T>` and the `visit_with_<T>` / `try_fold_with_<T>` / `fold_with_<T>` free fns
// (tools/codegen type_fold.json). The impls are structural_impls.rs's; stubs until lane ty-print / tyir-binder ports
// them (then: D4 descriptors `fold_Predicate` / `fold_Clause`, which these wrap).
/** Stub: `impl fmt::Debug for ty::Predicate` (structural_impls.rs:100). */
export function debug_Predicate(_v: Predicate, _f: Fmt): string {
  return unported("rustc_middle::ty::Predicate: Debug (structural_impls.rs:100)");
}
/** Stub: `impl fmt::Debug for ty::Clause` (structural_impls.rs:106). */
export function debug_Clause(_v: Clause, _f: Fmt): string {
  return unported("rustc_middle::ty::Clause: Debug (structural_impls.rs:106)");
}
/** Stub: `impl TypeVisitable for ty::Predicate` (structural_impls.rs:577). */
export function visit_with_Predicate<R>(_self: Predicate, _visitor: TypeVisitor<R>): R {
  return unported("rustc_middle::ty::Predicate: TypeVisitable::visit_with (structural_impls.rs:577)");
}
/** Stub: `impl TypeFoldable for ty::Predicate` (structural_impls.rs:470). */
export function try_fold_with_Predicate<E>(_self: Predicate, _folder: FallibleTypeFolder<E>): Result<Predicate, E> {
  return unported("rustc_middle::ty::Predicate: TypeFoldable::try_fold_with (structural_impls.rs:470)");
}
export function fold_with_Predicate(_self: Predicate, _folder: TypeFolder): Predicate {
  return unported("rustc_middle::ty::Predicate: TypeFoldable::fold_with (structural_impls.rs:470)");
}
/** Stub: `impl TypeVisitable for ty::Clause` (structural_impls.rs:583). */
export function visit_with_Clause<R>(_self: Clause, _visitor: TypeVisitor<R>): R {
  return unported("rustc_middle::ty::Clause: TypeVisitable::visit_with (structural_impls.rs:583)");
}
/** Stub: `impl TypeFoldable for ty::Clause` (structural_impls.rs:502). */
export function try_fold_with_Clause<E>(_self: Clause, _folder: FallibleTypeFolder<E>): Result<Clause, E> {
  return unported("rustc_middle::ty::Clause: TypeFoldable::try_fold_with (structural_impls.rs:502)");
}
export function fold_with_Clause(_self: Clause, _folder: TypeFolder): Clause {
  return unported("rustc_middle::ty::Clause: TypeFoldable::fold_with (structural_impls.rs:502)");
}
