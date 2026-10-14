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
import type { Clauses } from "../rustc_middle/ty/decls.ts";
import { fold_Term, type Term, type Ty } from "../rustc_middle/ty/mod.ts";
import { debug_Ty, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { type Binder, fold_Binder } from "../rustc_type_ir/binder.ts";
import { type AliasConstKind, fold_with_AliasConstKind, try_fold_with_AliasConstKind, visit_with_AliasConstKind } from "../rustc_type_ir/const_kind.ts";
import { type FallibleTypeFolder, FallibleTypeFolder_provided, type PredicateProxy, type TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { InferCtxtLike } from "../rustc_type_ir/infer_ctxt.ts";
import { Term_provided } from "../rustc_type_ir/inherent.ts";
import { UniverseIndex } from "../rustc_type_ir/lib.ts";
import { type Const, debug_Const, fold_Const } from "../rustc_type_ir/sty/consts.ts";
import type { Region } from "../rustc_type_ir/sty/mod.ts";
import { AliasTerm as AliasTermC } from "../rustc_type_ir/term_kind.ts";
import { type Alias, type AliasTerm, fold_with_Alias, try_fold_with_Alias, visit_with_Alias } from "../rustc_type_ir/ty/alias.ts";
import { type AliasTyKind, fold_with_AliasTyKind, try_fold_with_AliasTyKind, visit_with_AliasTyKind } from "../rustc_type_ir/ty_kind.ts";
import { max_universe_of_infer_vars } from "../rustc_type_ir/universe.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { PLAIN } from "../std/fmt.ts";
import { panic, unwrap } from "../std/panic.ts";
import { Ok, type Result } from "../std/result.ts";
import { BoundVarReplacer, PlaceholderReplacer } from "./placeholder.ts";

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

  // rustc: compiler/rustc_next_trait_solver/src/normalize.rs:44 new
  static new<E>(
    infcx: InferCtxtLike,
    universes: (UniverseIndex | undefined)[],
    normalize: (alias_term: AliasTerm) => Result<[Term, NormalizationWasAmbiguous], E>,
  ): NormalizationFolder<E> {
    return new NormalizationFolder(infcx, universes, normalize);
  }

  // rustc: compiler/rustc_next_trait_solver/src/normalize.rs:48 normalize_alias_term
  normalize_alias_term(alias_term: AliasTerm, has_escaping: HasEscapingBoundVars): Result<Term | undefined, E> {
    const r = this.normalize(alias_term);
    if (r.$ === "Err") return r;
    const [normalized, normalization_was_ambiguous] = r._0;

    // Return ambiguous higher ranked alias as is, if
    //   - it contains escaping vars, and
    //   - the normalized term contains infer vars which may mention
    //     temporary placeholders after we've already mapped them back
    //     to bound vars.
    //
    // We can normalize the ambiguous alias again after the binder is instantiated.
    if (normalization_was_ambiguous === NormalizationWasAmbiguous.Yes && has_escaping === HasEscapingBoundVars.Yes) {
      const max_universe = max_universe_of_infer_vars(this.infcx, normalized, fold_Term);
      // PORT: `self.universes.first().unwrap().unwrap()`: an empty list and a leading `None` panic with the same message.
      if (UniverseIndex.can_name(max_universe, unwrap(this.universes[0]))) {
        return Ok(undefined);
      }
    }

    return Ok(normalized);
  }

  // ---- impl FallibleTypeFolder for NormalizationFolder ----
  // rustc: compiler/rustc_next_trait_solver/src/normalize.rs:84 cx
  cx(): TyCtxt {
    return this.infcx.cx();
  }

  // rustc: compiler/rustc_next_trait_solver/src/normalize.rs:88 try_fold_binder
  try_fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Result<Binder<T>, E> {
    this.universes.push(undefined);
    const r = fold_Binder(d).try_super_fold_with(t, this);
    if (r.$ === "Err") return r;
    this.universes.pop();
    return Ok(r._0);
  }

  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_next_trait_solver/src/normalize.rs:99 try_fold_ty
  try_fold_ty(ty: Ty): Result<Ty, E> {
    const infcx = this.infcx;
    const original = ty;

    if (!this.cx().renormalize_rigid_aliases() && !TypeVisitableExt.has_non_rigid_aliases(ty, fold_Ty)) {
      return Ok(ty);
    }

    // With eager normalization, we should normalize the args of alias before
    // normalizing the alias itself.
    const r = fold_Ty.try_super_fold_with(ty, this);
    if (r.$ === "Err") return r;
    ty = r._0;
    const k = ty.kind();
    if (k.$ !== "Alias") return Ok(ty);
    const orig_is_rigid = k._0;
    const alias_ty = k._1;
    // We support ambiguous aliases inside rigid alias. So we still recognize
    // the rigidness of the outer alias.
    if (!this.cx().renormalize_rigid_aliases() && orig_is_rigid === "Yes") {
      return Ok(ty);
    }

    let normalized: Ty;
    if (TypeVisitableExt.has_escaping_bound_vars(ty, fold_Ty)) {
      const [alias_ty_, mapped_regions, mapped_types, mapped_consts] = BoundVarReplacer.replace_bound_vars(
        infcx,
        this.universes,
        alias_ty,
        fold_AliasTy,
      );
      const res = this.normalize_alias_term(AliasTermC.from_AliasTy(alias_ty_), HasEscapingBoundVars.Yes);
      if (res.$ === "Err") return res;
      const result = res._0;
      if (result === undefined) {
        return Ok(ty);
      }

      normalized = PlaceholderReplacer.replace_placeholders(
        infcx,
        mapped_regions,
        mapped_types,
        mapped_consts,
        this.universes,
        Term_provided.expect_ty(result),
        fold_Ty,
      );
    } else {
      const res = this.normalize_alias_term(AliasTermC.from_AliasTy(alias_ty), HasEscapingBoundVars.No);
      if (res.$ === "Err") return res;
      normalized = res._0 !== undefined ? Term_provided.expect_ty(res._0) : ty;
    }

    if (this.cx().renormalize_rigid_aliases() && orig_is_rigid === "Yes") {
      // find out missing typing env change.
      const original_ = infcx.deeply_resolve_via_unification_table(original, fold_Ty);
      const normalized_ = infcx.deeply_resolve_via_unification_table(normalized, fold_Ty);
      if (original_ !== normalized_) {
        panic(
          `assertion \`left == right\` failed: rigid alias is further normalized\n  left: ${debug_Ty(original_, PLAIN)}\n right: ${debug_Ty(normalized_, PLAIN)}`,
        );
      }
    }
    return Ok(normalized);
  }

  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_next_trait_solver/src/normalize.rs:150 try_fold_const
  try_fold_const(ct: Const): Result<Const, E> {
    const infcx = this.infcx;
    const original = ct;

    if (!this.cx().renormalize_rigid_aliases() && !TypeVisitableExt.has_non_rigid_aliases(ct, fold_Const)) {
      return Ok(ct);
    }

    // With eager normalization, we should normalize the args of alias before
    // normalizing the alias itself.
    const r = fold_Const.try_super_fold_with(ct, this);
    if (r.$ === "Err") return r;
    ct = r._0;
    const k = ct.kind();
    if (k.$ !== "Alias") return Ok(ct);
    const orig_is_rigid = k._0;
    const alias_const = k._1;
    // We support ambiguous aliases inside rigid alias. So we still recognize
    // the rigidness of the outer alias.
    if (!this.cx().renormalize_rigid_aliases() && orig_is_rigid === "Yes") {
      return Ok(ct);
    }

    let normalized: Const;
    if (TypeVisitableExt.has_escaping_bound_vars(ct, fold_Const)) {
      const [alias_const_, mapped_regions, mapped_types, mapped_consts] = BoundVarReplacer.replace_bound_vars(
        infcx,
        this.universes,
        alias_const,
        fold_AliasConst,
      );
      const res = this.normalize_alias_term(AliasTermC.from_AliasConst(alias_const_), HasEscapingBoundVars.Yes);
      if (res.$ === "Err") return res;
      const result = res._0;
      if (result === undefined) {
        return Ok(ct);
      }
      normalized = PlaceholderReplacer.replace_placeholders(
        infcx,
        mapped_regions,
        mapped_types,
        mapped_consts,
        this.universes,
        Term_provided.expect_const(result),
        fold_Const,
      );
    } else {
      const res = this.normalize_alias_term(AliasTermC.from_AliasConst(alias_const), HasEscapingBoundVars.No);
      if (res.$ === "Err") return res;
      normalized = res._0 !== undefined ? Term_provided.expect_const(res._0) : ct;
    }

    if (this.cx().renormalize_rigid_aliases() && orig_is_rigid === "Yes") {
      // find out missing typing env change.
      const original_ = infcx.deeply_resolve_via_unification_table(original, fold_Const);
      const normalized_ = infcx.deeply_resolve_via_unification_table(normalized, fold_Const);
      if (original_ !== normalized_) {
        panic(
          `assertion \`left == right\` failed: rigid alias is further normalized\n  left: ${debug_Const(original_, PLAIN)}\n right: ${debug_Const(normalized_, PLAIN)}`,
        );
      }
    }

    return Ok(normalized);
  }

  // rustc: compiler/rustc_next_trait_solver/src/normalize.rs:200 try_fold_predicate
  try_fold_predicate<P>(p: P, d: PredicateProxy<P>): Result<P, E> {
    return d.allow_normalization(p) ? d.try_super_fold_with(p, this) : Ok(p);
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

// ---- D4 descriptors of the traversed types (fold.ts header) ---------------------------------------------------------

/** `AliasTy<I>` = `Alias<I, AliasTyKind<I>>` (derived traversal, rustc_type_ir ty/alias.gen.ts). */
const fold_AliasTy: TypeFoldable<Alias<AliasTyKind>> = {
  visit_with: (self, visitor) => visit_with_Alias(self, visitor, visit_with_AliasTyKind),
  try_fold_with: (self, folder) => try_fold_with_Alias(self, folder, try_fold_with_AliasTyKind),
  fold_with: (self, folder) => fold_with_Alias(self, folder, fold_with_AliasTyKind),
};

/** `AliasConst<I>` = `Alias<I, AliasConstKind<I>>`. */
const fold_AliasConst: TypeFoldable<Alias<AliasConstKind>> = {
  visit_with: (self, visitor) => visit_with_Alias(self, visitor, visit_with_AliasConstKind),
  try_fold_with: (self, folder) => try_fold_with_Alias(self, folder, try_fold_with_AliasConstKind),
  fold_with: (self, folder) => fold_with_Alias(self, folder, fold_with_AliasConstKind),
};
