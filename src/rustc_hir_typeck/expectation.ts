// Port of compiler/rustc_hir_typeck/src/expectation.rs (lane fnctxt-contract).
//
// `enum Expectation` and its derived Debug / Clone are generated (expectation.gen.ts). Its methods live on the companion
// const (PORTING §8: `Expectation.method(self_, ..)`), declared in decls.ts `Companions["Expectation"]`.
// Init order: top-level code here touches only ./decls.ts, this file's .gen.ts and other crates.
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { Span } from "../rustc_span/lib.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import type { Companions, FnCtxt } from "./decls.ts";
import * as gen from "./expectation.gen.ts";
import type { Expectation as ExpectationT } from "./expectation.gen.ts";

export * from "./expectation.gen.ts";

// PORT: `use super::Expectation::*;` -- the variants are written `{ $: "ExpectHasType", _0: ety }` /
// `Expectation.NoExpectation`.

export type Expectation = ExpectationT;
export const Expectation: typeof gen.Expectation & Companions["Expectation"] = {
  ...gen.Expectation,

  // impl<'a, 'tcx> Expectation<'tcx> {
  // Disregard "castable to" expectations because they
  // can lead us astray. Consider for example `if cond
  // {22} else {c} as u8` -- if we propagate the
  // "castable to u8" constraint to 22, it will pick the
  // type 22u8, which is overly constrained (c might not
  // be a u8). In effect, the problem is that the
  // "castable to" expectation is not the tightest thing
  // we can say, so we want to drop it in this case.
  // The tightest thing we can say is "must unify with
  // else branch". Note that in the case of a "has type"
  // constraint, this limitation does not hold.

  // If the expected type is just a type variable, then don't use
  // an expected type. Otherwise, we might write parts of the type
  // when checking the 'then' block which are incompatible with the
  // 'else' branch.
  // rustc: compiler/rustc_hir_typeck/src/expectation.rs:43 try_structurally_resolve_and_adjust_for_branches
  try_structurally_resolve_and_adjust_for_branches(self_: ExpectationT, fcx: FnCtxt): ExpectationT {
    switch (self_.$) {
      case "ExpectHasType": {
        const ety = fcx.deeply_resolve_ignoring_regions_with_obligations(self_._0, fold_Ty);
        if (!ety.is_ty_var()) {
          return { $: "ExpectHasType", _0: ety };
        } else {
          return gen.Expectation.NoExpectation;
        }
      }
      case "ExpectRvalueLikeUnsized":
        return { $: "ExpectRvalueLikeUnsized", _0: self_._0 };
      default:
        return gen.Expectation.NoExpectation;
    }
  },

  /// Provides an expectation for an rvalue expression given an *optional*
  /// hint, which is not required for type safety (the resulting type might
  /// be checked higher up, as is the case with `&expr` and `box expr`), but
  /// is useful in determining the concrete type.
  ///
  /// The primary use case is where the expected type is a wide pointer,
  /// like `&[isize]`. For example, consider the following statement:
  ///
  ///    let x: &[isize] = &[1, 2, 3];
  ///
  /// In this case, the expected type for the `&[1, 2, 3]` expression is
  /// `&[isize]`. If however we were to say that `[1, 2, 3]` has the
  /// expectation `ExpectHasType([isize])`, that would be too strong --
  /// `[1, 2, 3]` does not have the type `[isize]` but rather `[isize; 3]`.
  /// It is only the `&[1, 2, 3]` expression as a whole that can be coerced
  /// to the type `&[isize]`. Therefore, we propagate this more limited hint,
  /// which still is useful, because it informs integer literals and the like.
  /// See the test case `test/ui/coerce-expect-unsized.rs` and #20169
  /// for examples of where this comes up,.
  // rustc: compiler/rustc_hir_typeck/src/expectation.rs:76 rvalue_hint
  rvalue_hint(fcx: FnCtxt, ty: Ty): ExpectationT {
    const k = ty.kind();
    const span = k.$ === "Adt" ? fcx.tcx.def_span(k._0.did()) : fcx.tcx.def_span(fcx.body_def_id);
    const cause = ObligationCause.misc(span, fcx.body_def_id);

    // FIXME(#155345): Missing normalization call
    const tail = fcx.tcx
      .struct_tail_raw(
        ty,
        cause,
        (ty) => Unnormalized.skip_normalization(ty),
        () => {},
      )
      .kind();
    switch (tail.$) {
      case "Slice":
      case "Str":
      case "Dynamic":
        return { $: "ExpectRvalueLikeUnsized", _0: ty };
      default:
        return { $: "ExpectHasType", _0: ty };
    }
  },

  /// Resolves `expected` by a single level if it is a variable. If
  /// there is no expected type or resolution is not possible (e.g.,
  /// no constraints yet present), just returns `self`.
  // rustc: compiler/rustc_hir_typeck/src/expectation.rs:93 resolve
  resolve(self_: ExpectationT, fcx: FnCtxt): ExpectationT {
    switch (self_.$) {
      case "NoExpectation":
        return gen.Expectation.NoExpectation;
      case "ExpectCastableToType":
        return { $: "ExpectCastableToType", _0: fcx.deeply_resolve_ignoring_regions(self_._0, fold_Ty) };
      case "ExpectHasType":
        return { $: "ExpectHasType", _0: fcx.deeply_resolve_ignoring_regions(self_._0, fold_Ty) };
      case "ExpectRvalueLikeUnsized":
        return { $: "ExpectRvalueLikeUnsized", _0: fcx.deeply_resolve_ignoring_regions(self_._0, fold_Ty) };
    }
  },

  // rustc: compiler/rustc_hir_typeck/src/expectation.rs:104 to_option
  to_option(self_: ExpectationT, fcx: FnCtxt): Ty | undefined {
    const r = Expectation.resolve(self_, fcx);
    switch (r.$) {
      case "NoExpectation":
        return undefined;
      case "ExpectCastableToType":
      case "ExpectHasType":
      case "ExpectRvalueLikeUnsized":
        return r._0;
    }
  },

  /// It sometimes happens that we want to turn an expectation into
  /// a **hard constraint** (i.e., something that must be satisfied
  /// for the program to type-check). `only_has_type` will return
  /// such a constraint, if it exists.
  // rustc: compiler/rustc_hir_typeck/src/expectation.rs:115 only_has_type
  only_has_type(self_: ExpectationT, fcx: FnCtxt): Ty | undefined {
    switch (self_.$) {
      case "ExpectHasType":
        return fcx.deeply_resolve_ignoring_regions(self_._0, fold_Ty);
      case "NoExpectation":
      case "ExpectCastableToType":
      case "ExpectRvalueLikeUnsized":
        return undefined;
    }
  },

  /// Like `only_has_type`, but instead of returning `None` if no
  /// hard constraint exists, creates a fresh type variable.
  // rustc: compiler/rustc_hir_typeck/src/expectation.rs:124 coercion_target_type
  coercion_target_type(self_: ExpectationT, fcx: FnCtxt, span: Span): Ty {
    return Expectation.only_has_type(self_, fcx) ?? fcx.next_ty_var(span);
  },
};
