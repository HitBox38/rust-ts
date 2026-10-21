// Port of compiler/rustc_middle/src/ty/abstract_const.rs (contract stub by lane ty-contract; `expand_abstract_consts`:
// lane small-gaps-19).
//! A subset of a mir body used for const evaluability checking.
//
// PORT: `T: TypeFoldable` arguments take the D4 descriptor last (`tcx.expand_abstract_consts(ac, d_T)`). The fn-local
// `Expander` is a class implementing `TypeFolder` (its provided methods forward to `TypeFolder_provided`).
// `NotConstEvaluatable` and `BoundAbstractConst` stay pending in ty/decls.ts (not reached yet). `CastKind` is below
// (lane small-gaps-21; decls.ts re-exports the type).
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes;
// its top-level code may touch only the classes it imports, never another extension module.
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { type Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { TypeFlags } from "../../rustc_type_ir/flags.ts";
import { type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../../rustc_type_ir/fold.ts";
import { Const, fold_Const, type Region } from "../../rustc_type_ir/sty/mod.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import type { Result } from "../../std/result.ts";
import { TyCtxt } from "./context.ts";
import type { Clauses } from "./decls.ts";
import type { Ty } from "./mod.ts";
import { fold_GenericArgs } from "./generic_args.ts";
import { fold_Ty } from "./structural_impls.ts";

// rustc-type: compiler/rustc_middle/src/ty/abstract_const.rs:13 CastKind
export type CastKind =
  /// `thir::ExprKind::As`
  | "As"
  /// `thir::ExprKind::ValueExpr`
  | "Use";
export const CastKind = { As: "As", Use: "Use" } as const;

// rustc: compiler/rustc_middle/src/ty/abstract_const.rs:37 expand_abstract_consts
TyCtxt.prototype.expand_abstract_consts = function <T>(this: TyCtxt, ac: T, d_T: TypeFoldable<T>): T {
  return d_T.fold_with(ac, new Expander(this));
};

// rustc-type: compiler/rustc_middle/src/ty/abstract_const.rs:38 Expander
class Expander implements TypeFolder {
  constructor(public tcx: TyCtxt) {}

  // rustc: compiler/rustc_middle/src/ty/abstract_const.rs:43 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // rustc: compiler/rustc_middle/src/ty/abstract_const.rs:46 fold_ty
  fold_ty(ty: Ty): Ty {
    if (TypeVisitableExt.has_type_flags(ty, TypeFlags.HAS_CONST_ALIAS, fold_Ty)) {
      return fold_Ty.super_fold_with(ty, this);
    } else {
      return ty;
    }
  }

  // rustc: compiler/rustc_middle/src/ty/abstract_const.rs:53 fold_const
  fold_const(c: Const): Const {
    let ct: Const;
    const k = c.kind();
    if (k.$ === "Alias") {
      const alias_const = k._1;
      const def_id = alias_const.kind.def_id;
      const r = this.tcx.thir_abstract_const(def_id) as Result<EarlyBinder<Const> | undefined, ErrorGuaranteed>;
      if (r.$ === "Err") {
        ct = Const.new_error(this.tcx, r._0);
      } else if (r._0 !== undefined) {
        const bac_ = r._0;
        const args = this.tcx.erase_and_anonymize_regions(alias_const.args, fold_GenericArgs);
        const bac = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(bac_, this.tcx, args, fold_Const));
        return fold_Const.fold_with(bac, this);
      } else {
        ct = c;
      }
    } else {
      ct = c;
    }
    return fold_Const.super_fold_with(ct, this);
  }

  // (provided) `TypeFolder::fold_binder`
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }

  // (provided) `TypeFolder::fold_region`
  fold_region(r: Region): Region {
    return TypeFolder_provided.fold_region(this, r);
  }

  // (provided) `TypeFolder::fold_predicate`
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }

  // (provided) `TypeFolder::fold_clauses`
  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}
