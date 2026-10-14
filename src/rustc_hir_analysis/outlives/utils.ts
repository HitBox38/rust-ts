// Port of compiler/rustc_hir_analysis/src/outlives/utils.rs (lane variance-outlives).
//
// PORT notes (file-wide):
// - `RequiredClauses<'tcx>` (`FxIndexMap<ty::ArgOutlivesClause<'tcx>, Span>`) is a `KeyedMap` keyed by `intern_key`
//   (rust_ts/keyed.ts: insertion-ordered, as `IndexMap`; the key is the derived `Hash`/`Eq` of
//   `OutlivesClause(GenericArg, Region)`, whose fields are interned). `new_RequiredClauses()` is `Default::default()`.
// - `.entry(k).or_insert(span)` is `if (!map.has(k)) map.set(k, span)`.
// - `smallvec![]` is `[]`.
// - `d_ArgOutlivesClause` is the D4 descriptor of `OutlivesClause<GenericArg>` (generated impls), for
//   `EarlyBinder::instantiate` in implicit_infer.ts.
// Init order: top-level code here touches only other crates.
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { fold_with_GenericArg, GenericArg, try_fold_with_GenericArg, visit_with_GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { ParamTy } from "../../rustc_middle/ty/sty.ts";
import { debug_Region } from "../../rustc_type_ir/sty/mod.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { type Component, push_outlives_components } from "../../rustc_type_ir/outlives.ts";
import { fold_with_OutlivesClause, type OutlivesClause, try_fold_with_OutlivesClause, visit_with_OutlivesClause } from "../../rustc_type_ir/predicate.gen.ts";
import { AliasTy } from "../../rustc_type_ir/ty_kind.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { PLAIN } from "../../std/fmt.ts";

/** `ty::ArgOutlivesClause<'tcx>` (`OutlivesClause<'tcx, GenericArg<'tcx>>`). */
export type ArgOutlivesClause = OutlivesClause<GenericArg>;

/// Tracks the `T: 'a` or `'a: 'a` clauses that we have inferred
/// must be added to the struct header.
export type RequiredClauses = KeyedMap<ArgOutlivesClause, Span>;

/** `RequiredClauses::default()` */
export function new_RequiredClauses(): RequiredClauses {
  return new KeyedMap<ArgOutlivesClause, Span>(intern_key);
}

/** PORT: the generated `TypeFoldable` impls of `OutlivesClause<GenericArg>` as a D4 descriptor. */
export const d_ArgOutlivesClause: TypeFoldable<ArgOutlivesClause> = {
  visit_with: (self, visitor) => visit_with_OutlivesClause(self, visitor, visit_with_GenericArg),
  try_fold_with: (self, folder) => try_fold_with_OutlivesClause(self, folder, try_fold_with_GenericArg),
  fold_with: (self, folder) => fold_with_OutlivesClause(self, folder, fold_with_GenericArg),
};

/// Given a requirement `T: 'a` or `'b: 'a`, deduce the
/// outlives_component and add it to `required_clauses`
// rustc: compiler/rustc_hir_analysis/src/outlives/utils.rs:13 insert_outlives_clause
export function insert_outlives_clause(tcx: TyCtxt, arg: GenericArg, outlived_region: Region, span: Span, required_clauses: RequiredClauses): void {
  // If the `'a` region is bound within the field type itself, we
  // don't want to propagate this constraint to the header.
  if (!is_free_region(outlived_region)) {
    return;
  }

  const k = GenericArg.kind(arg);
  switch (k.$) {
    case "Type": {
      const ty = k._0;
      // `T: 'outlived_region` for some type `T`
      // But T could be a lot of things:
      // e.g., if `T = &'b u32`, then `'b: 'outlived_region` is
      // what we want to add.
      //
      // Or if within `struct Foo<U>` you had `T = Vec<U>`, then
      // we would want to add `U: 'outlived_region`
      const components: Component[] = [];
      push_outlives_components(tcx, ty, components);
      for (const component of components) {
        switch (component.$) {
          case "Region": {
            const r = component._0;
            // This would arise from something like:
            //
            // ```
            // struct Foo<'a, 'b> {
            //    x:  &'a &'b u32
            // }
            // ```
            //
            // Here `outlived_region = 'a` and `kind = &'b
            // u32`. Decomposing `&'b u32` into
            // components would yield `'b`, and we add the
            // where clause that `'b: 'a`.
            insert_outlives_clause(tcx, GenericArg.from_Region(r), outlived_region, span, required_clauses);
            break;
          }

          case "Param": {
            const param_ty = component._0;
            // param_ty: ty::ParamTy
            // This would arise from something like:
            //
            // ```
            // struct Foo<'a, U> {
            //    x:  &'a Vec<U>
            // }
            // ```
            //
            // Here `outlived_region = 'a` and `kind =
            // Vec<U>`. Decomposing `Vec<U>` into
            // components would yield `U`, and we add the
            // where clause that `U: 'a`.
            const ty = ParamTy.to_ty(param_ty, tcx);
            const key: ArgOutlivesClause = { _0: GenericArg.from_Ty(ty), _1: outlived_region };
            if (!required_clauses.has(key)) required_clauses.set(key, span);
            break;
          }

          case "Placeholder":
            span_bug(span, "Should not deduce placeholder outlives component");

          case "Alias": {
            const [is_rigid, alias_ty] = [component._0, component._1];
            // This would either arise from something like:
            //
            // ```
            // struct Foo<'a, T: Iterator> {
            //    x:  &'a <T as Iterator>::Item
            // }
            // ```
            //
            // or:
            //
            // ```rust
            // type Opaque<T> = impl Sized;
            // fn defining<T>() -> Opaque<T> {}
            // struct Ss<'a, T>(&'a Opaque<T>);
            // ```
            //
            // Here we want to add an explicit `where <T as Iterator>::Item: 'a`
            // or `Opaque<T>: 'a` depending on the alias kind.
            const ty = AliasTy.to_ty(alias_ty, tcx, is_rigid);
            const key: ArgOutlivesClause = { _0: GenericArg.from_Ty(ty), _1: outlived_region };
            if (!required_clauses.has(key)) required_clauses.set(key, span);
            break;
          }

          case "EscapingAlias":
            // As above, but the projection involves
            // late-bound regions. Therefore, the WF
            // requirement is not checked in type definition
            // but at fn call site, so ignore it.
            //
            // ```
            // struct Foo<'a, T: Iterator> {
            //    x: for<'b> fn(<&'b T as Iterator>::Item)
            //              //  ^^^^^^^^^^^^^^^^^^^^^^^^^
            // }
            // ```
            //
            // Since `'b` is not in scope on `Foo`, can't
            // do anything here, ignore it.
            break;

          case "UnresolvedInferenceVariable":
            bug("not using infcx");
        }
      }
      break;
    }

    case "Lifetime": {
      const r = k._0;
      if (!is_free_region(r)) {
        return;
      }
      const key: ArgOutlivesClause = { _0: arg, _1: outlived_region };
      if (!required_clauses.has(key)) required_clauses.set(key, span);
      break;
    }

    case "Const":
      // Generic consts don't impose any constraints.
      break;
  }
}

// rustc: compiler/rustc_hir_analysis/src/outlives/utils.rs:145 is_free_region
function is_free_region(region: Region): boolean {
  // First, screen for regions that might appear in a type header.
  const k = region.kind();
  switch (k.$) {
    // These correspond to `T: 'a` relationships:
    //
    //     struct Foo<'a, T> {
    //         field: &'a T, // this would generate a ReEarlyParam referencing `'a`
    //     }
    //
    // We care about these, so fall through.
    case "ReEarlyParam":
      return true;

    // These correspond to `T: 'static` relationships which can be
    // rather surprising.
    //
    //     struct Foo<'a, T> {
    //         field: &'static T, // this would generate a ReStatic
    //     }
    case "ReStatic":
      return false;

    // Late-bound regions can appear in `fn` types:
    //
    //     struct Foo<T> {
    //         field: for<'b> fn(&'b T) // e.g., 'b here
    //     }
    //
    // The type above might generate a `T: 'b` bound, but we can
    // ignore it. We can't name this lifetime pn the struct header anyway.
    case "ReBound":
      return false;

    case "ReError":
      return false;

    // These regions don't appear in types from type declarations:
    case "ReErased":
    case "ReVar":
    case "RePlaceholder":
    case "ReLateParam":
      return bug(`unexpected region in outlives inference: ${debug_Region(region, PLAIN)}`);
  }
}
