// Contract stub for compiler/rustc_next_trait_solver/src/placeholder.rs (lane evalctxt-contract; the file belongs to lane
// nts-canonical). The folder classes are final; their methods (inherent statics and `TypeFolder`) are stubs with final
// signatures: fill each in place and add the `// rustc:` marker. Extension module (docs/handoff/evalctxt-contract.md
// "Init order").
//
// PORT: generic over `Infcx: InferCtxtLike` (the `InferCtxtLike` interface). The `IndexMap<Placeholder*, Bound*>` maps
// are keyed by structs compared by value: build them as `KeyedMap`s over `intern_key` (rust_ts/keyed.ts; they are
// `Map`s, insertion-ordered like `IndexMap`). `universe_indices: &'a mut Vec<..>` is the caller's array, mutated in place.
// `TypeFolder::fold_clauses` (not overridden upstream; `PlaceholderReplacer` also keeps the default `fold_predicate`)
// forwards to `TypeFolder_provided`.
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Clauses, Ty } from "../rustc_middle/ty/decls.ts";
import type {
  Binder,
  BoundConst,
  BoundRegion,
  BoundTy,
  DebruijnIndex,
  PlaceholderConst,
  PlaceholderRegion,
  PlaceholderType,
  UniverseIndex,
} from "../rustc_type_ir/decls.ts";
import { type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../rustc_type_ir/fold.ts";
import type { InferCtxtLike } from "../rustc_type_ir/infer_ctxt.ts";
import type { Const } from "../rustc_type_ir/sty/consts.ts";
import type { Region } from "../rustc_type_ir/sty/mod.ts";
import { unported } from "../std/panic.ts";

export class BoundVarReplacer implements TypeFolder {
  constructor(
    public infcx: InferCtxtLike,
    // These three maps track the bound variable that were replaced by placeholders. It might be
    // nice to remove these since we already have the `kind` in the placeholder; we really just need
    // the `var` (but we *could* bring that into scope if we were to track them as we pass them).
    public mapped_regions: Map<PlaceholderRegion, BoundRegion>,
    public mapped_types: Map<PlaceholderType, BoundTy>,
    public mapped_consts: Map<PlaceholderConst, BoundConst>,
    // The current depth relative to *this* folding, *not* the entire normalization. In other words,
    // the depth of binders we've passed here.
    public current_index: DebruijnIndex,
    // The `UniverseIndex` of the binding levels above us. These are optional, since we are lazy:
    // we don't actually create a universe until we see a bound var we have to replace.
    public universe_indices: (UniverseIndex | undefined)[],
  ) {}

  /// Returns a type with all bound vars replaced by placeholders,
  /// together with mappings from the new placeholders back to the original variable.
  ///
  /// Panics if there are any bound vars that use a binding level above `universe_indices.len()`.
  static replace_bound_vars<T>(
    _infcx: InferCtxtLike,
    _universe_indices: (UniverseIndex | undefined)[],
    _value: T,
    _d_T: TypeFoldable<T>,
  ): [T, Map<PlaceholderRegion, BoundRegion>, Map<PlaceholderType, BoundTy>, Map<PlaceholderConst, BoundConst>] {
    return unported("rustc_next_trait_solver::placeholder::BoundVarReplacer::replace_bound_vars");
  }

  universe_for(_debruijn: DebruijnIndex): UniverseIndex {
    return unported("rustc_next_trait_solver::placeholder::BoundVarReplacer::universe_for");
  }

  // ---- impl TypeFolder for BoundVarReplacer ----
  cx(): TyCtxt {
    return unported("rustc_next_trait_solver::placeholder::BoundVarReplacer::cx");
  }

  fold_binder<T>(_t: Binder<T>, _d: TypeFoldable<T>): Binder<T> {
    return unported("rustc_next_trait_solver::placeholder::BoundVarReplacer::fold_binder");
  }

  fold_region(_r: Region): Region {
    return unported("rustc_next_trait_solver::placeholder::BoundVarReplacer::fold_region");
  }

  fold_ty(_t: Ty): Ty {
    return unported("rustc_next_trait_solver::placeholder::BoundVarReplacer::fold_ty");
  }

  fold_const(_ct: Const): Const {
    return unported("rustc_next_trait_solver::placeholder::BoundVarReplacer::fold_const");
  }

  fold_predicate<P>(_p: P, _d: PredicateProxy<P>): P {
    return unported("rustc_next_trait_solver::placeholder::BoundVarReplacer::fold_predicate");
  }

  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

/// The inverse of [`BoundVarReplacer`]: replaces placeholders with the bound vars from which they came.
export class PlaceholderReplacer implements TypeFolder {
  constructor(
    public infcx: InferCtxtLike,
    public mapped_regions: Map<PlaceholderRegion, BoundRegion>,
    public mapped_types: Map<PlaceholderType, BoundTy>,
    public mapped_consts: Map<PlaceholderConst, BoundConst>,
    public universe_indices: readonly (UniverseIndex | undefined)[],
    public current_index: DebruijnIndex,
  ) {}

  static replace_placeholders<T>(
    _infcx: InferCtxtLike,
    _mapped_regions: Map<PlaceholderRegion, BoundRegion>,
    _mapped_types: Map<PlaceholderType, BoundTy>,
    _mapped_consts: Map<PlaceholderConst, BoundConst>,
    _universe_indices: readonly (UniverseIndex | undefined)[],
    _value: T,
    _d_T: TypeFoldable<T>,
  ): T {
    return unported("rustc_next_trait_solver::placeholder::PlaceholderReplacer::replace_placeholders");
  }

  // ---- impl TypeFolder for PlaceholderReplacer ----
  cx(): TyCtxt {
    return unported("rustc_next_trait_solver::placeholder::PlaceholderReplacer::cx");
  }

  fold_binder<T>(_t: Binder<T>, _d: TypeFoldable<T>): Binder<T> {
    return unported("rustc_next_trait_solver::placeholder::PlaceholderReplacer::fold_binder");
  }

  fold_region(_r0: Region): Region {
    return unported("rustc_next_trait_solver::placeholder::PlaceholderReplacer::fold_region");
  }

  fold_ty(_ty: Ty): Ty {
    return unported("rustc_next_trait_solver::placeholder::PlaceholderReplacer::fold_ty");
  }

  fold_const(_ct: Const): Const {
    return unported("rustc_next_trait_solver::placeholder::PlaceholderReplacer::fold_const");
  }

  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }

  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}
