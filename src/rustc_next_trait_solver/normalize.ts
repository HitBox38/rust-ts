// Contract stub for compiler/rustc_next_trait_solver/src/normalize.rs (lane evalctxt-contract; the file belongs to lane
// nts-canonical). The types are final; `NormalizationFolder`'s methods (inherent and `FallibleTypeFolder`) are stubs
// with final signatures: fill each in place and add the `// rustc:` marker. Extension module
// (docs/handoff/evalctxt-contract.md "Init order").
//
// PORT: `NormalizationFolder<'a, Infcx, I, F>`: `Infcx` is the `InferCtxtLike` interface; `F: FnMut(AliasTerm<I>) ->
// Result<(I::Term, NormalizationWasAmbiguous), E>` is the closure type of `normalize`, and `E` (`type Error = E`) is the
// class's type parameter. `E: Debug` is erased (tracing only). `try_fold_region` / `try_fold_clauses` (not overridden
// upstream) forward to `FallibleTypeFolder_provided`.
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Clauses, Term, Ty } from "../rustc_middle/ty/decls.ts";
import type { Binder, UniverseIndex } from "../rustc_type_ir/decls.ts";
import { type FallibleTypeFolder, FallibleTypeFolder_provided, type PredicateProxy, type TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { InferCtxtLike } from "../rustc_type_ir/infer_ctxt.ts";
import type { Const } from "../rustc_type_ir/sty/consts.ts";
import type { Region } from "../rustc_type_ir/sty/mod.ts";
import type { AliasTerm } from "../rustc_type_ir/ty/alias.ts";
import { unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";

/// This folder normalizes value and collects ambiguous goals.
///
/// Note that for ambiguous alias which contains escaping bound vars,
/// we just return the original alias and don't collect the ambiguous goal.
export class NormalizationFolder<E> implements FallibleTypeFolder<E> {
  constructor(
    public infcx: InferCtxtLike,
    public universes: (UniverseIndex | undefined)[],
    public normalize: (alias_term: AliasTerm) => Result<[Term, NormalizationWasAmbiguous], E>,
  ) {}

  static new<E>(
    _infcx: InferCtxtLike,
    _universes: (UniverseIndex | undefined)[],
    _normalize: (alias_term: AliasTerm) => Result<[Term, NormalizationWasAmbiguous], E>,
  ): NormalizationFolder<E> {
    return unported("rustc_next_trait_solver::normalize::NormalizationFolder::new");
  }

  normalize_alias_term(_alias_term: AliasTerm, _has_escaping: HasEscapingBoundVars): Result<Term | undefined, E> {
    return unported("rustc_next_trait_solver::normalize::NormalizationFolder::normalize_alias_term");
  }

  // ---- impl FallibleTypeFolder for NormalizationFolder ----
  cx(): TyCtxt {
    return unported("rustc_next_trait_solver::normalize::NormalizationFolder::cx");
  }

  try_fold_binder<T>(_t: Binder<T>, _d: TypeFoldable<T>): Result<Binder<T>, E> {
    return unported("rustc_next_trait_solver::normalize::NormalizationFolder::try_fold_binder");
  }

  try_fold_ty(_ty: Ty): Result<Ty, E> {
    return unported("rustc_next_trait_solver::normalize::NormalizationFolder::try_fold_ty");
  }

  try_fold_const(_ct: Const): Result<Const, E> {
    return unported("rustc_next_trait_solver::normalize::NormalizationFolder::try_fold_const");
  }

  try_fold_predicate<P>(_p: P, _d: PredicateProxy<P>): Result<P, E> {
    return unported("rustc_next_trait_solver::normalize::NormalizationFolder::try_fold_predicate");
  }

  try_fold_region(r: Region): Result<Region, E> {
    return FallibleTypeFolder_provided.try_fold_region(this, r);
  }

  try_fold_clauses(c: Clauses): Result<Clauses, E> {
    return FallibleTypeFolder_provided.try_fold_clauses(this, c);
  }
}

// PORT: `#[derive(PartialEq, Eq)]` fieldless enum: `===`.
export type HasEscapingBoundVars = "Yes" | "No";
export const HasEscapingBoundVars = { Yes: "Yes", No: "No" } as const;

// PORT: `#[derive(PartialEq, Eq)]` fieldless enum: `===`.
export type NormalizationWasAmbiguous = "Yes" | "No";
export const NormalizationWasAmbiguous = { Yes: "Yes", No: "No" } as const;
