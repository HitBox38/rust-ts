// Port of compiler/rustc_hir_typeck/src/pat.rs (lines 1..1779 ported by lane typeck-pat-a; STUB for lane typeck-pat-b): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// pat.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/pat.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./pat.gen.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { unwrap, assert_matches } from "../std/panic.ts";
import { FnCtxt } from "./decls.ts";
import { BindingMode, BindingMode_eq, ByRef, type LitKind } from "../rustc_ast/lib.ts";
import { Mutability, Pinnedness } from "../rustc_ast_ir/lib.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { type Diag, struct_span_code_err, Suggestions } from "../rustc_errors/lib.ts";
import { E0029, E0033, E0533, E0596 } from "../rustc_errors/error_codes.gen.ts";
import { type CtorKind, debug_Res, Res } from "../rustc_hir/def.ts";
import * as hir from "../rustc_hir/lib.ts";
import { debug_HirId, HirId_eq, type HirId } from "../rustc_hir_id/lib.ts";
import { report_autoderef_recursion_limit_error } from "../rustc_hir_analysis/autoderef.ts";
import { ToTrace_Ty } from "../rustc_infer/infer/at.ts";
import { ObligationCause, type ObligationCauseCode, type PatternOriginExpr } from "../rustc_middle/traits/mod.ts";
import { EvaluationResult } from "../rustc_middle/traits/select.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import type { PatAdjust, PatAdjustment } from "../rustc_middle/ty/adjustment.ts";
import { debug_Ty, Ty, type VariantDef } from "../rustc_middle/ty/mod.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { fold_Span, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { feature_err } from "../rustc_session/diagnostics.ts";
import { type DefId, DefId_eq } from "../rustc_span/def_id.ts";
import { Edition as EditionC, type Edition } from "../rustc_span/edition.ts";
import { BytePos, type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { display_Ident, type Ident, sym, Symbol } from "../rustc_span/symbol.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import type { TyKind } from "../rustc_type_ir/ty_kind.gen.ts";
import { type TypeVisitable, TypeVisitableExt, type VisitWith, visit_with_Option, visit_with_tuple2, visit_with_tuple3 } from "../rustc_type_ir/visit.ts";
import { is_ascii_digit } from "../std/char.ts";
import { PLAIN } from "../std/fmt.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { str_to_lowercase } from "../std/unicode/str_case.ts";
import * as diagnostics from "./diagnostics.gen.ts";
import type { DeclOrigin } from "./gather_locals.gen.ts";
import { Expectation as gen_Expectation } from "./expectation.gen.ts";
import * as gen from "./pat.gen.ts";
import { debug_ResolvedPat, type InheritedRefMatchRule, type PatInfo, type PeelKind, type ResolvedPat, type TopInfo } from "./pat.gen.ts";
import { debug_PatExprKind } from "../rustc_hir/hir.gen.ts";

// ==== lane typeck-pat-a: pat.rs:1..1779 ====
// Port notes (lane typeck-pat-a):
// - `TopInfo` / `PatInfo` are `Copy`: they are passed by reference to the same (never mutated) objects; struct
//   updates (`PatInfo { current_depth: .., ..old_pat_info }`) build new objects.
// - `impl AdjustMode` / `impl MutblCap` are on the companions (PORTING §8), `impl ResolvedPat` on the generated
//   class's prototype.
// - `debug!` / `trace!` / `#[instrument]` are tracing only and stay as comments; `#[cfg(debug_assertions)]` /
//   `cfg!(debug_assertions)` code is off (rustc ships without debug assertions) and stays as comments.

const CANNOT_IMPLICITLY_DEREF_POINTER_TRAIT_OBJ =
  "This error indicates that a pointer to a trait type cannot be implicitly dereferenced by a \
pattern. Every trait defines a type, but because the size of trait implementors isn't fixed, \
this type has no compile-time size. Therefore, all accesses to trait types must be through \
pointers. If you encounter this error you should try to avoid dereferencing the pointer.\n\
\n\
You can read more about trait objects in the Trait Objects section of the Reference: \
https://doc.rust-lang.org/reference/types.html#trait-objects";

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {
// rustc: compiler/rustc_hir_typeck/src/pat.rs:104 pattern_cause
FnCtxt.prototype.pattern_cause = function (this: FnCtxt, ti: TopInfo, cause_span: Span): ObligationCause {
  // If origin_expr exists, then expected represents the type of origin_expr.
  // If span also exists, then span == origin_expr.span (although it doesn't need to exist).
  // In that case, we can peel away references from both and treat them
  // as the same.
  const origin_expr_info: PatternOriginExpr | undefined =
    ti.origin_expr === undefined
      ? undefined
      : ((cur_expr: hir.Expr): PatternOriginExpr => {
          let count = 0;

          // cur_ty may have more layers of references than cur_expr.
          // We can only make suggestions about cur_expr, however, so we'll
          // use that as our condition for stopping.
          let k: hir.ExprKind;
          while ((k = cur_expr.kind).$ === "AddrOf") {
            cur_expr = k._2;
            count += 1;
          }

          return {
            peeled_span: cur_expr.span,
            peeled_count: count,
            peeled_prefix_suggestion_parentheses: hir.expr_needs_parens(cur_expr),
          };
        })(ti.origin_expr);

  const code: ObligationCauseCode = {
    $: "Pattern",
    span: ti.span,
    root_ty: ti.expected,
    origin_expr: origin_expr_info,
  };
  return this.cause(cause_span, code);
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:135 demand_eqtype_pat_diag
FnCtxt.prototype.demand_eqtype_pat_diag = function (this: FnCtxt, cause_span: Span, expected: Ty, actual: Ty, ti: TopInfo): Result<undefined, Diag> {
  const r = this.demand_eqtype_with_origin(this.pattern_cause(ti, cause_span), expected, actual);
  if (r.$ === "Ok") return r;
  const diag = r._0;
  const expr = ti.origin_expr;
  if (expr !== undefined) {
    this.suggest_fn_call(diag, expr, expected, (output) => this.can_eq(this.param_env, output, actual, ToTrace_Ty));
  }
  return Err(diag);
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:153 demand_eqtype_pat
FnCtxt.prototype.demand_eqtype_pat = function (this: FnCtxt, cause_span: Span, expected: Ty, actual: Ty, ti: TopInfo): Result<undefined, ErrorGuaranteed> {
  const r = this.demand_eqtype_pat_diag(cause_span, expected, actual, ti);
  if (r.$ === "Ok") return r;
  return Err(r._0.emit_err());
};
// }

// impl AdjustMode {
export type AdjustMode = gen.AdjustMode;
export const AdjustMode = {
  ...gen.AdjustMode,

  // rustc: compiler/rustc_hir_typeck/src/pat.rs:192 peel_until_adt
  peel_until_adt(opt_adt_def: DefId | undefined): AdjustMode {
    return { $: "Peel", kind: { $: "Implicit", until_adt: opt_adt_def, pat_ref_layers: 0 } };
  },

  // rustc: compiler/rustc_hir_typeck/src/pat.rs:195 peel_all
  peel_all(): AdjustMode {
    return AdjustMode.peel_until_adt(undefined);
  },
};
// }

// impl MutblCap {
export type MutblCap = gen.MutblCap;
export const MutblCap = {
  ...gen.MutblCap,

  // #[must_use]
  // rustc: compiler/rustc_hir_typeck/src/pat.rs:229 cap_to_weakly_not
  cap_to_weakly_not(self_: MutblCap, span: Span | undefined): MutblCap {
    switch (self_.$) {
      case "Not":
        return gen.MutblCap.Not;
      default:
        return { $: "WeaklyNot", _0: span };
    }
  },

  // #[must_use]
  // rustc: compiler/rustc_hir_typeck/src/pat.rs:237 as_mutbl
  as_mutbl(self_: MutblCap): Mutability {
    switch (self_.$) {
      case "Not":
      case "WeaklyNot":
        return "Not";
      case "Mut":
        return "Mut";
    }
  },
};
// }

/** Derived `PartialEq` for `MutblCap`. */
function MutblCap_eq(a: MutblCap, b: MutblCap): boolean {
  if (a.$ === "WeaklyNot" && b.$ === "WeaklyNot") return a._0 === b._0;
  return a.$ === b.$;
}

declare module "./pat.gen.ts" {
  interface ResolvedPat {
    adjust_mode(): gen.AdjustMode;
  }
}

// impl<'tcx> ResolvedPat<'tcx> {
// rustc: compiler/rustc_hir_typeck/src/pat.rs:313 adjust_mode
gen.ResolvedPat.prototype.adjust_mode = function (this: ResolvedPat): AdjustMode {
  const k = this.kind;
  if (k.$ === "Path" && k.res.$ === "Def" && (k.res._0.$ === "Const" || k.res._0.$ === "AssocConst")) {
    // These constants can be of a reference type, e.g. `const X: &u8 = &0;`.
    // Peeling the reference types too early will cause type checking failures.
    // Although it would be possible to *also* peel the types of the constants too.
    return AdjustMode.Pass;
  } else {
    // The remaining possible resolutions for path, struct, and tuple struct patterns are
    // ADT constructors. As such, we may peel references freely, but we must not peel the
    // ADT itself from the scrutinee if it's a smart pointer.
    return AdjustMode.peel_until_adt(this.ty.ty_adt_def()?.did());
  }
};
// }

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {
/// Experimental pattern feature: after matching against a shared reference, do we limit the
/// default binding mode in subpatterns to be `ref` when it would otherwise be `ref mut`?
/// This corresponds to Rule 3 of RFC 3627.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:334 downgrade_mut_inside_shared
FnCtxt.prototype.downgrade_mut_inside_shared = function (this: FnCtxt): boolean {
  // NB: RFC 3627 proposes stabilizing Rule 3 in all editions. If we adopt the same behavior
  // across all editions, this may be removed.
  return this.tcx.features().ref_pat_eat_one_layer_2024_structural();
};

/// Experimental pattern feature: when do reference patterns match against inherited references?
/// This corresponds to variations on Rule 4 of RFC 3627.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:342 ref_pat_matches_inherited_ref
FnCtxt.prototype.ref_pat_matches_inherited_ref = function (this: FnCtxt, edition: Edition): InheritedRefMatchRule {
  // NB: The particular rule used here is likely to differ across editions, so calls to this
  // may need to become edition checks after match ergonomics stabilize.
  if (EditionC.at_least_rust_2024(edition)) {
    if (this.tcx.features().ref_pat_eat_one_layer_2024()) {
      return gen.InheritedRefMatchRule.EatOuter;
    } else if (this.tcx.features().ref_pat_eat_one_layer_2024_structural()) {
      return gen.InheritedRefMatchRule.EatInner;
    } else {
      // Currently, matching against an inherited ref on edition 2024 is an error.
      // Use `EatBoth` as a fallback to be similar to stable Rust.
      return { $: "EatBoth", consider_inherited_ref: false };
    }
  } else {
    return {
      $: "EatBoth",
      consider_inherited_ref: this.tcx.features().ref_pat_eat_one_layer_2024() || this.tcx.features().ref_pat_eat_one_layer_2024_structural(),
    };
  }
};

/// Experimental pattern feature: do `&` patterns match against `&mut` references, treating them
/// as if they were shared references? This corresponds to Rule 5 of RFC 3627.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:365 ref_pat_matches_mut_ref
FnCtxt.prototype.ref_pat_matches_mut_ref = function (this: FnCtxt): boolean {
  // NB: RFC 3627 proposes stabilizing Rule 5 in all editions. If we adopt the same behavior
  // across all editions, this may be removed.
  return this.tcx.features().ref_pat_eat_one_layer_2024() || this.tcx.features().ref_pat_eat_one_layer_2024_structural();
};

/// Type check the given top level pattern against the `expected` type.
///
/// If a `Some(span)` is provided and `origin_expr` holds,
/// then the `span` represents the scrutinee's span.
/// The scrutinee is found in e.g. `match scrutinee { ... }` and `let pat = scrutinee;`.
///
/// Otherwise, `Some(span)` represents the span of a type expression
/// which originated the `expected` type.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:380 check_pat_top
FnCtxt.prototype.check_pat_top = function (
  this: FnCtxt,
  pat: hir.Pat,
  expected: Ty,
  span: Span | undefined,
  origin_expr: hir.Expr | undefined,
  decl_origin: DeclOrigin | undefined,
): void {
  const top_info: TopInfo = { expected, origin_expr, span, hir_id: pat.hir_id };
  const pat_info: PatInfo = {
    binding_mode: ByRef.No,
    max_pinnedness: "Not",
    max_ref_mutbl: gen.MutblCap.Mut,
    top_info,
    decl_origin,
    current_depth: 0,
  };
  this.check_pat(pat, expected, pat_info);
};

/// Type check the given `pat` against the `expected` type
/// with the provided `binding_mode` (default binding mode).
///
/// Outside of this module, `check_pat_top` should always be used.
/// Conversely, inside this module, `check_pat_top` should never be used.
// #[instrument(level = "debug", skip(self, pat_info))]
// rustc: compiler/rustc_hir_typeck/src/pat.rs:406 check_pat
FnCtxt.prototype.check_pat = function (this: FnCtxt, pat: hir.Pat, expected: Ty, pat_info: PatInfo): void {
  // For patterns containing paths, we need the path's resolution to determine whether to
  // implicitly dereference the scrutinee before matching.
  let opt_path_res: Result<ResolvedPat, ErrorGuaranteed> | undefined;
  const pk = pat.kind;
  if (pk.$ === "Expr" && pk._0.kind.$ === "Path") {
    const { kind, hir_id, span } = pk._0;
    opt_path_res = this.resolve_pat_path(hir_id, span, kind._0);
  } else if (pk.$ === "Struct") {
    opt_path_res = this.resolve_pat_struct(pat, pk._0);
  } else if (pk.$ === "TupleStruct") {
    opt_path_res = this.resolve_pat_tuple_struct(pat, pk._0);
  } else {
    opt_path_res = undefined;
  }
  const adjust_mode = this.calc_adjust_mode(pat, opt_path_res);
  const ty = this.check_pat_inner(pat, opt_path_res, adjust_mode, expected, pat_info);
  this.write_ty(pat.hir_id, ty);

  // If we implicitly inserted overloaded dereferences before matching check the pattern to
  // see if the dereferenced types need `DerefMut` bounds.
  let derefed_tys: PatAdjustment[] | undefined;
  if (
    (derefed_tys = this.typeck_results.pat_adjustments().get(pat.hir_id)) !== undefined &&
    derefed_tys.some((adjust) => adjust.kind === "OverloadedDeref")
  ) {
    const tys = derefed_tys;
    this.register_deref_mut_bounds_if_needed(
      pat.span,
      pat,
      (function* (): Generator<Ty> {
        for (const adjust of tys) {
          switch (adjust.kind) {
            case "OverloadedDeref":
              yield adjust.source;
              break;
            case "BuiltinDeref":
            case "PinDeref":
              break;
          }
        }
      })(),
    );
  }

  // (note_1): In most of the cases where (note_1) is referenced
  // (literals and constants being the exception), we relate types
  // using strict equality, even though subtyping would be sufficient.
  // There are a few reasons for this, some of which are fairly subtle
  // and which cost me (nmatsakis) an hour or two debugging to remember,
  // so I thought I'd write them down this time.
  //
  // 1. There is no loss of expressiveness here, though it does
  // cause some inconvenience. What we are saying is that the type
  // of `x` becomes *exactly* what is expected. This can cause unnecessary
  // errors in some cases, such as this one:
  //
  // ```
  // fn foo<'x>(x: &'x i32) {
  //    let a = 1;
  //    let mut z = x;
  //    z = &a;
  // }
  // ```
  //
  // The reason we might get an error is that `z` might be
  // assigned a type like `&'x i32`, and then we would have
  // a problem when we try to assign `&a` to `z`, because
  // the lifetime of `&a` (i.e., the enclosing block) is
  // shorter than `'x`.
  //
  // HOWEVER, this code works fine. The reason is that the
  // expected type here is whatever type the user wrote, not
  // the initializer's type. In this case the user wrote
  // nothing, so we are going to create a type variable `Z`.
  // Then we will assign the type of the initializer (`&'x i32`)
  // as a subtype of `Z`: `&'x i32 <: Z`. And hence we
  // will instantiate `Z` as a type `&'0 i32` where `'0` is
  // a fresh region variable, with the constraint that `'x : '0`.
  // So basically we're all set.
  //
  // Note that there are two tests to check that this remains true
  // (`regions-reassign-{match,let}-bound-pointer.rs`).
  //
  // 2. An outdated issue related to the old HIR borrowck. See the test
  // `regions-relate-bound-regions-on-closures-to-inference-variables.rs`,
};

// Helper to avoid resolving the same path pattern several times.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:480 check_pat_inner
FnCtxt.prototype.check_pat_inner = function (
  this: FnCtxt,
  pat: hir.Pat,
  opt_path_res: Result<ResolvedPat, ErrorGuaranteed> | undefined,
  adjust_mode: AdjustMode,
  expected_: Ty,
  pat_info_: PatInfo,
): Ty {
  // #[cfg(debug_assertions)]
  // if matches!(pat_info.binding_mode, ByRef::Yes(_, Mutability::Mut))
  //     && pat_info.max_ref_mutbl != MutblCap::Mut
  //     && self.downgrade_mut_inside_shared()
  // {
  //     span_bug!(pat.span, "Pattern mutability cap violated!");
  // }

  // Resolve type if needed.
  const expected = adjust_mode.$ === "Peel" && pat.default_binding_modes ? this.deeply_resolve_ignoring_regions_with_obligations(expected_, fold_Ty) : expected_;
  const old_pat_info = pat_info_;
  const pat_info: PatInfo = { ...old_pat_info, current_depth: old_pat_info.current_depth + 1 };

  let ek: TyKind;
  let pinned_ty: Ty | undefined;
  let pk: TyKind;
  // Peel off a `&` or `&mut`from the scrutinee type. See the examples in
  // `tests/ui/rfcs/rfc-2005-default-binding-mode`.
  if (adjust_mode.$ === "Peel" && pat.default_binding_modes && (ek = expected.kind()).$ === "Ref" && this.should_peel_ref(adjust_mode.kind, expected)) {
    const inner_ty = ek._1;
    const inner_mutability = ek._2;
    // debug!("inspecting {:?}", expected);

    // debug!("current discriminant is Ref, inserting implicit deref");
    // Preserve the reference type. We'll need it later during THIR lowering.
    this.typeck_results
      .pat_adjustments_mut()
      .entry(pat.hir_id)
      .or_default(() => [])
      .value.push({ kind: "BuiltinDeref", source: expected });

    // Use the old pat info to keep `current_depth` to its old value.
    const new_pat_info = this.adjust_pat_info("Not", inner_mutability, old_pat_info);

    // Recurse with the new expected type.
    return this.check_pat_inner(pat, opt_path_res, adjust_mode, inner_ty, new_pat_info);
  }
  // If `pin_ergonomics` is enabled, peel the `&pin` from the pinned reference type. See the
  // examples in `tests/ui/async-await/pin-ergonomics/`.
  if (
    this.tcx.features().pin_ergonomics() &&
    adjust_mode.$ === "Peel" &&
    pat.default_binding_modes &&
    this.should_peel_smart_pointer(adjust_mode.kind, expected) &&
    (pinned_ty = expected.pinned_ty()) !== undefined &&
    // Currently, only pinned reference is specially handled, leaving other
    // pinned types (e.g. `Pin<Box<T>>` to deref patterns) handled as a
    // deref pattern.
    (pk = pinned_ty.kind()).$ === "Ref"
  ) {
    const inner_ty = pk._1;
    const inner_mutability = pk._2;
    // debug!("scrutinee ty {expected:?} is a pinned reference, inserting pin deref");

    // Use the old pat info to keep `current_depth` to its old value.
    const new_pat_info = this.adjust_pat_info("Pinned", inner_mutability, old_pat_info);

    return this.check_deref_pattern(pat, opt_path_res, adjust_mode, expected, inner_ty, "PinDeref", new_pat_info);
  }
  // If `deref_patterns` is enabled, peel a smart pointer from the scrutinee type. See the
  // examples in `tests/ui/pattern/deref_patterns/`.
  if (this.tcx.features().deref_patterns() && adjust_mode.$ === "Peel" && pat.default_binding_modes && this.should_peel_smart_pointer(adjust_mode.kind, expected)) {
    // debug!("scrutinee ty {expected:?} is a smart pointer, inserting pin deref");

    // The scrutinee is a smart pointer; implicitly dereference it. This adds a
    // requirement that `expected: DerefPure`.
    const inner_ty = this.deref_pat_target(pat.span, expected);
    // Once we've checked `pat`, we'll add a `DerefMut` bound if it contains any
    // `ref mut` bindings. See `Self::register_deref_mut_bounds_if_needed`.

    return this.check_deref_pattern(pat, opt_path_res, adjust_mode, expected, inner_ty, "OverloadedDeref", old_pat_info);
  }
  const kind = pat.kind;
  switch (kind.$) {
    case "Missing":
    case "Wild":
    case "Err":
      return expected;
    // We allow any type here; we ensure that the type is uninhabited during match checking.
    case "Never":
      return expected;
    case "Expr": {
      const pat_expr = kind._0;
      if (pat_expr.kind.$ === "Path") {
        const hir_id = pat_expr.hir_id;
        const r = unwrap(opt_path_res);
        let ty: Ty;
        if (r.$ === "Ok") {
          const pr = r._0;
          ty = this.check_pat_path(pat.hir_id, pat.span, pr, expected, pat_info.top_info);
        } else {
          const guar = r._0;
          ty = Ty.new_error(this.tcx, guar);
        }
        this.write_ty(hir_id, ty);
        return ty;
      } else {
        const expr = pat_expr;
        const lit = pat_expr.kind.lit;
        return this.check_pat_lit(pat.span, expr, lit.node, expected, pat_info.top_info);
      }
    }
    case "Range": {
      const lhs = kind._0;
      const rhs = kind._1;
      return this.check_pat_range(pat.span, lhs, rhs, expected, pat_info.top_info);
    }
    case "Binding": {
      const ba = kind._0;
      const var_id = kind._1;
      const ident = kind._2;
      const sub = kind._3;
      return this.check_pat_ident(pat, ba, var_id, ident, sub, expected, pat_info);
    }
    case "TupleStruct": {
      const qpath = kind._0;
      const subpats = kind._1;
      const ddpos = kind._2;
      const r = unwrap(opt_path_res);
      if (r.$ === "Ok" && r._0.kind.$ === "TupleStruct") {
        const { ty, kind: rk } = r._0;
        return this.check_pat_tuple_struct(pat, qpath, subpats, ddpos, rk.res, ty, rk.variant, expected, pat_info);
      } else if (r.$ === "Err") {
        const guar = r._0;
        const ty_err = Ty.new_error(this.tcx, guar);
        for (const subpat of subpats) {
          this.check_pat(subpat, ty_err, pat_info);
        }
        return ty_err;
      } else {
        const pr = r._0;
        return span_bug(pat.span, `tuple struct pattern resolved to ${debug_ResolvedPat(pr, PLAIN)}`);
      }
    }
    case "Struct": {
      const fields = kind._1;
      const has_rest_pat = kind._2;
      const r = unwrap(opt_path_res);
      if (r.$ === "Ok" && r._0.kind.$ === "Struct") {
        const { ty, kind: rk } = r._0;
        return this.check_pat_struct(pat, fields, has_rest_pat !== undefined, ty, rk.variant, expected, pat_info);
      } else if (r.$ === "Err") {
        const guar = r._0;
        const ty_err = Ty.new_error(this.tcx, guar);
        for (const field of fields) {
          this.check_pat(field.pat, ty_err, pat_info);
        }
        return ty_err;
      } else {
        const pr = r._0;
        return span_bug(pat.span, `struct pattern resolved to ${debug_ResolvedPat(pr, PLAIN)}`);
      }
    }
    case "Guard": {
      const pat_ = kind._0;
      const cond = kind._1;
      this.check_pat(pat_, expected, pat_info);
      this.check_expr_has_type_or_error(cond, this.tcx.types.bool, (_) => {});
      return expected;
    }
    case "Or": {
      const pats = kind._0;
      for (const pat_ of pats) {
        this.check_pat(pat_, expected, pat_info);
      }
      return expected;
    }
    case "Tuple": {
      const elements = kind._0;
      const ddpos = kind._1;
      return this.check_pat_tuple(pat.span, elements, ddpos, expected, pat_info);
    }
    case "Deref": {
      const inner = kind._0;
      return this.check_pat_deref(pat.span, inner, expected, pat_info);
    }
    case "Ref": {
      const inner = kind._0;
      const pinned = kind._1;
      const mutbl = kind._2;
      return this.check_pat_ref(pat, inner, pinned, mutbl, expected, pat_info);
    }
    case "Slice": {
      const before = kind._0;
      const slice = kind._1;
      const after = kind._2;
      return this.check_pat_slice(pat.span, before, slice, after, expected, pat_info);
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:666 adjust_pat_info
FnCtxt.prototype.adjust_pat_info = function (this: FnCtxt, inner_pinnedness: Pinnedness, inner_mutability: Mutability, pat_info: PatInfo): PatInfo {
  let binding_mode: ByRef;
  const pbm = pat_info.binding_mode;
  switch (pbm.$) {
    // If default binding mode is by value, make it `ref`, `ref mut`, `ref pin const`
    // or `ref pin mut` (depending on whether we observe `&`, `&mut`, `&pin const` or
    // `&pin mut`).
    case "No":
      binding_mode = { $: "Yes", _0: inner_pinnedness, _1: inner_mutability };
      break;
    case "Yes": {
      const pinnedness_ = pbm._0;
      const mutability_ = pbm._1;
      let pinnedness: Pinnedness;
      switch (pinnedness_) {
        // When `ref`, stay a `ref` (on `&`) or downgrade to `ref pin` (on `&pin`).
        case "Not":
          pinnedness = inner_pinnedness;
          break;
        // When `ref pin`, stay a `ref pin`.
        // This is because we cannot get an `&mut T` from `&mut &pin mut T` unless `T: Unpin`.
        // Note that `&T` and `&mut T` are `Unpin`, which implies
        // `& &pin const T` <-> `&pin const &T` and `&mut &pin mut T` <-> `&pin mut &mut T`
        // (i.e. mutually coercible).
        case "Pinned":
          pinnedness = "Pinned";
          break;
      }

      let mutability: Mutability;
      switch (mutability_) {
        // When `ref mut`, stay a `ref mut` (on `&mut`) or downgrade to `ref` (on `&`).
        case "Mut":
          mutability = inner_mutability;
          break;
        // Once a `ref`, always a `ref`.
        // This is because a `& &mut` cannot mutate the underlying value.
        case "Not":
          mutability = "Not";
          break;
      }
      binding_mode = { $: "Yes", _0: pinnedness, _1: mutability };
      break;
    }
  }

  let { max_ref_mutbl, max_pinnedness } = pat_info;
  if (this.downgrade_mut_inside_shared()) {
    binding_mode = ByRef.cap_ref_mutability(binding_mode, MutblCap.as_mutbl(max_ref_mutbl));
  }
  if (binding_mode.$ === "Yes" && binding_mode._1 === "Not") {
    max_ref_mutbl = gen.MutblCap.Not;
  } else if (binding_mode.$ === "Yes" && binding_mode._0 === "Pinned") {
    max_pinnedness = "Pinned";
  }
  // debug!("default binding mode is now {:?}", binding_mode);
  return { ...pat_info, binding_mode, max_pinnedness, max_ref_mutbl };
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:713 check_deref_pattern
FnCtxt.prototype.check_deref_pattern = function (
  this: FnCtxt,
  pat: hir.Pat,
  opt_path_res: Result<ResolvedPat, ErrorGuaranteed> | undefined,
  adjust_mode: AdjustMode,
  expected: Ty,
  inner_ty: Ty,
  pat_adjust_kind: PatAdjust,
  pat_info: PatInfo,
): Ty {
  // debug_assert!(
  //     !matches!(pat_adjust_kind, PatAdjust::BuiltinDeref),
  //     "unexpected deref pattern for builtin reference type {expected:?}",
  // );

  const typeck_results = this.typeck_results;
  const pat_adjustments_table = typeck_results.pat_adjustments_mut();
  const pat_adjustments = pat_adjustments_table.entry(pat.hir_id).or_default(() => []).value;
  // We may reach the recursion limit if a user matches on a type `T` satisfying
  // `T: Deref<Target = T>`; error gracefully in this case.
  // FIXME(deref_patterns): If `deref_patterns` stabilizes, it may make sense to move
  // this check out of this branch. Alternatively, this loop could be implemented with
  // autoderef and this check removed. For now though, don't break code compiling on
  // stable with lots of `&`s and a low recursion limit, if anyone's done that.
  if (this.tcx.recursion_limit().value_within_limit(pat_adjustments.length)) {
    // Preserve the smart pointer type for THIR lowering and closure upvar analysis.
    pat_adjustments.push({ kind: pat_adjust_kind, source: expected });
  } else {
    const guar = report_autoderef_recursion_limit_error(this.tcx, pat.span, expected);
    inner_ty = Ty.new_error(this.tcx, guar);
  }
  // drop(typeck_results);

  // Recurse, using the old pat info to keep `current_depth` to its old value.
  // Peeling smart pointers does not update the default binding mode.
  return this.check_pat_inner(pat, opt_path_res, adjust_mode, inner_ty, pat_info);
};

/// How should the binding mode and expected type be adjusted?
///
/// When the pattern contains a path, `opt_path_res` must be `Some(path_res)`.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:754 calc_adjust_mode
FnCtxt.prototype.calc_adjust_mode = function (this: FnCtxt, pat: hir.Pat, opt_path_res: Result<ResolvedPat, ErrorGuaranteed> | undefined): AdjustMode {
  const kind = pat.kind;
  switch (kind.$) {
    // Type checking these product-like types successfully always require
    // that the expected type be of those types and not reference types.
    case "Tuple":
    case "Range":
    case "Slice":
      return AdjustMode.peel_all();
    // When checking an explicit deref pattern, only peel reference types.
    case "Deref":
      return { $: "Peel", kind: gen.PeelKind.ExplicitDerefPat };
    // A never pattern behaves somewhat like a literal or unit variant.
    case "Never":
      return AdjustMode.peel_all();
    // For patterns with paths, how we peel the scrutinee depends on the path's resolution.
    case "Struct":
    case "TupleStruct":
    case "Expr": {
      if (kind.$ !== "Expr" || kind._0.kind.$ === "Path") {
        // If there was an error resolving the path, default to peeling everything.
        const r = unwrap(opt_path_res);
        return r.$ === "Ok" ? r._0.adjust_mode() : AdjustMode.peel_all();
      }

      // String and byte-string literals result in types `&str` and `&[u8]` respectively.
      // All other literals result in non-reference types.
      // As a result, we allow `if let 0 = &&0 {}` but not `if let "foo" = &&"foo" {}` unless
      // `deref_patterns` is enabled.
      const lt = kind._0;
      // Path patterns have already been handled, and inline const blocks currently
      // aren't possible to write, so any handling for them would be untested.
      // if cfg!(debug_assertions)
      //     && self.tcx.features().deref_patterns()
      //     && !matches!(lt.kind, PatExprKind::Lit { .. })
      // {
      //     span_bug!(
      //         lt.span,
      //         "FIXME(deref_patterns): adjust mode unimplemented for {:?}",
      //         lt.kind
      //     );
      // }
      // Call `deeply_resolve_ignoring_regions` here for inline const blocks.
      const lit_ty = this.deeply_resolve_ignoring_regions(this.check_pat_expr_unadjusted(lt), fold_Ty);
      // If `deref_patterns` is enabled, allow `if let "foo" = &&"foo" {}`.
      if (this.tcx.features().deref_patterns()) {
        let peeled_ty = lit_ty;
        let pat_ref_layers = 0;
        let k: TyKind;
        while ((k = this.deeply_resolve_ignoring_regions_with_obligations(peeled_ty, fold_Ty).kind()).$ === "Ref") {
          const inner_ty = k._1;
          // We rely on references at the head of constants being immutable.
          // debug_assert!(mutbl.is_not());
          pat_ref_layers += 1;
          peeled_ty = inner_ty;
        }
        return { $: "Peel", kind: { $: "Implicit", until_adt: undefined, pat_ref_layers } };
      } else {
        if (lit_ty.is_ref()) {
          return AdjustMode.Pass;
        } else {
          return AdjustMode.peel_all();
        }
      }
    }

    // Ref patterns are complicated, we handle them in `check_pat_ref`.
    case "Ref":
    // No need to do anything on a missing pattern.
    case "Missing":
    // A `_` pattern works with any expected type, so there's no need to do anything.
    case "Wild":
    // A malformed pattern doesn't have an expected type, so let's just accept any type.
    case "Err":
    // Bindings also work with whatever the expected type is,
    // and moreover if we peel references off, that will give us the wrong binding type.
    // Also, we can have a subpattern `binding @ pat`.
    // Each side of the `@` should be treated independently (like with OR-patterns).
    case "Binding":
    // An OR-pattern just propagates to each individual alternative.
    // This is maximally flexible, allowing e.g., `Some(mut x) | &Some(mut x)`.
    // In that example, `Some(mut x)` results in `Peel` whereas `&Some(mut x)` in `Reset`.
    case "Or":
    // Like or-patterns, guard patterns just propagate to their subpatterns.
    case "Guard":
      return AdjustMode.Pass;
  }
};

/// Assuming `expected` is a reference type, determine whether to peel it before matching.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:839 should_peel_ref
FnCtxt.prototype.should_peel_ref = function (this: FnCtxt, peel_kind: PeelKind, expected: Ty): boolean {
  // debug_assert!(expected.is_ref());
  let pat_ref_layers: number;
  switch (peel_kind.$) {
    case "ExplicitDerefPat":
      pat_ref_layers = 0;
      break;
    case "Implicit":
      pat_ref_layers = peel_kind.pat_ref_layers;
      break;
  }

  // Most patterns don't have reference types, so we'll want to peel all references from the
  // scrutinee before matching. To optimize for the common case, return early.
  if (pat_ref_layers === 0) {
    return true;
  }
  // debug_assert!(
  //     self.tcx.features().deref_patterns(),
  //     "Peeling for patterns with reference types is gated by `deref_patterns`."
  // );

  // If the pattern has as many or more layers of reference as the expected type, we can match
  // without peeling more, unless we find a smart pointer or `&mut` that we also need to peel.
  // We don't treat `&` and `&mut` as interchangeable, but by peeling `&mut`s before matching,
  // we can still, e.g., match on a `&mut str` with a string literal pattern. This is because
  // string literal patterns may be used where `str` is expected.
  let expected_ref_layers = 0;
  let k: TyKind;
  while ((k = expected.kind()).$ === "Ref") {
    const inner_ty = k._1;
    const mutbl = k._2;
    if (Mutability.is_mut(mutbl)) {
      // Mutable references can't be in the final value of constants, thus they can't be
      // at the head of their types, thus we should always peel `&mut`.
      return true;
    }
    expected_ref_layers += 1;
    expected = inner_ty;
  }
  return pat_ref_layers < expected_ref_layers || this.should_peel_smart_pointer(peel_kind, expected);
};

/// Determine whether `expected` is a smart pointer type that should be peeled before matching.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:875 should_peel_smart_pointer
FnCtxt.prototype.should_peel_smart_pointer = function (this: FnCtxt, peel_kind: PeelKind, expected: Ty): boolean {
  let k: TyKind;
  let deref_trait: DefId | undefined;
  // Explicit `deref!(_)` patterns match against smart pointers; don't peel in that case.
  if (
    peel_kind.$ === "Implicit" &&
    // For simplicity, only apply overloaded derefs if `expected` is a known ADT.
    // FIXME(deref_patterns): we'll get better diagnostics for users trying to
    // implicitly deref generics if we allow them here, but primitives, tuples, and
    // inference vars definitely should be stopped. Figure out what makes most sense.
    (k = expected.kind()).$ === "Adt" &&
    // Don't peel if the pattern type already matches the scrutinee. E.g., stop here if
    // matching on a `Cow<'a, T>` scrutinee with a `Cow::Owned(_)` pattern.
    !(peel_kind.until_adt !== undefined && DefId_eq(peel_kind.until_adt, k._0.did())) &&
    // At this point, the pattern isn't able to match `expected` without peeling. Check
    // that it implements `Deref` before assuming it's a smart pointer, to get a normal
    // type error instead of a missing impl error if not. This only checks for `Deref`,
    // not `DerefPure`: we require that too, but we want a trait error if it's missing.
    (deref_trait = this.tcx.lang_items().deref_trait()) !== undefined &&
    EvaluationResult.may_apply(this.type_implements_trait(deref_trait, [expected], this.param_env))
  ) {
    return true;
  } else {
    return false;
  }
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:899 check_pat_expr_unadjusted
FnCtxt.prototype.check_pat_expr_unadjusted = function (this: FnCtxt, lt: hir.PatExpr): Ty {
  let ty: Ty;
  const k = lt.kind;
  switch (k.$) {
    case "Lit": {
      const { lit, negated } = k;
      const ty_ = this.check_expr_lit(lit, lt.hir_id, gen_Expectation.NoExpectation);
      if (negated) {
        this.register_bound(ty_, this.tcx.require_lang_item(LangItem.Neg, lt.span), ObligationCause.dummy_with_span(lt.span));
      }
      ty = ty_;
      break;
    }
    case "Path": {
      const qpath = k._0;
      const [res, opt_ty, segments] = this.resolve_ty_and_res_fully_qualified_call(qpath, lt.hir_id, lt.span);
      ty = this.instantiate_value_path(segments, opt_ty, res, lt.span, lt.span, lt.hir_id, false)[0];
      break;
    }
  }
  this.write_ty(lt.hir_id, ty);
  return ty;
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:925 check_pat_lit
FnCtxt.prototype.check_pat_lit = function (this: FnCtxt, span: Span, expr: hir.PatExpr, lit_kind: LitKind, expected: Ty, ti: TopInfo): Ty {
  assert_matches(expr.kind, expr.kind.$ === "Lit", "hir::PatExprKind::Lit { .. }", (v) => debug_PatExprKind(v, PLAIN));

  // We've already computed the type above (when checking for a non-ref pat),
  // so avoid computing it again.
  const ty = this.node_ty(expr.hir_id);

  // Byte string patterns behave the same way as array patterns
  // They can denote both statically and dynamically-sized byte arrays.
  // Additionally, when `deref_patterns` is enabled, byte string literal patterns may have
  // types `[u8]` or `[u8; N]`, in order to type, e.g., `deref!(b"..."): Vec<u8>`.
  let pat_ty = ty;
  if (lit_kind.$ === "ByteStr") {
    const tcx = this.tcx;
    const expected_ = this.structurally_resolve_type(span, expected);
    const ek = expected_.kind();
    // Allow `b"...": &[u8]`
    if (ek.$ === "Ref" && this.deeply_resolve_ignoring_regions_with_obligations(ek._1, fold_Ty).is_slice()) {
      // trace!(?expr.hir_id.local_id, "polymorphic byte string lit");
      pat_ty = Ty.new_imm_ref(tcx, tcx.lifetimes.re_static, Ty.new_slice(tcx, tcx.types.u8));
    }
    // Allow `b"...": [u8; 3]` for `deref_patterns`
    else if (ek.$ === "Array" && tcx.features().deref_patterns()) {
      const tk = ty.kind();
      if (tk.$ === "Ref") {
        pat_ty = tk._1;
      } else {
        pat_ty = span_bug(span, `found byte string literal with non-ref type ${debug_Ty(ty, PLAIN)}`);
      }
    }
    // Allow `b"...": [u8]` for `deref_patterns`
    else if (ek.$ === "Slice" && tcx.features().deref_patterns()) {
      pat_ty = Ty.new_slice(tcx, tcx.types.u8);
    }
    // Otherwise, `b"...": &[u8; 3]`
    else {
    }
  }

  // When `deref_patterns` is enabled, in order to allow `deref!("..."): String`, we allow
  // string literal patterns to have type `str`. This is accounted for when lowering to MIR.
  if (this.tcx.features().deref_patterns() && lit_kind.$ === "Str" && this.deeply_resolve_ignoring_regions_with_obligations(expected, fold_Ty).is_str()) {
    pat_ty = this.tcx.types.str_;
  }

  // Somewhat surprising: in this case, the subtyping relation goes the
  // opposite way as the other cases. Actually what we really want is not
  // a subtyping relation at all but rather that there exists a LUB
  // (so that they can be compared). However, in practice, constants are
  // always scalars or strings. For scalars subtyping is irrelevant,
  // and for strings `ty` is type is `&'static str`, so if we say that
  //
  //     &'static str <: expected
  //
  // then that's equivalent to there existing a LUB.
  const cause = this.pattern_cause(ti, span);
  const r = this.demand_suptype_with_origin(cause, expected, pat_ty);
  if (r.$ === "Err") {
    const err = r._0;
    // If scrutinee is String and pattern is &str, suggest .as_str()
    const expected_ = this.deeply_resolve_ignoring_regions_with_obligations(expected, fold_Ty);
    const ek = expected_.kind();
    let origin_expr: hir.Expr | undefined;
    if (
      ek.$ === "Adt" &&
      this.tcx.is_lang_item(ek._0.did(), LangItem.String) &&
      pat_ty.is_ref() &&
      pat_ty.peel_refs().is_str() &&
      (origin_expr = ti.origin_expr) !== undefined
    ) {
      err.span_suggestion_verbose(Span.shrink_to_hi(origin_expr.span), "consider converting the `String` to a `&str` using `.as_str()`", ".as_str()", "MachineApplicable");
    }
    err.emit();
  }

  return pat_ty;
};

/** PORT: an endpoint of a range pattern as computed by `check_pat_range`'s `calc_side`: `(fail, ty, span)`. */
type RangeSide = [boolean, Ty, Span];

/** PORT: `TypeVisitable for (Option<(bool, Ty, Span)>, Option<(bool, Ty, Span)>)` (visit.rs's tuple / `Option`
 *  impls over `bool`'s and `Span`'s trivial traversals), for `(lhs, rhs).references_error()`. */
const visit_RangeSides: TypeVisitable<[RangeSide | undefined, RangeSide | undefined]> = {
  visit_with: (self, visitor) => {
    const visit_side: VisitWith<RangeSide | undefined> = (side, v) =>
      visit_with_Option(side, v, (s: RangeSide, v2) => visit_with_tuple3(s, v2, (_b: boolean, v3) => v3.Result.output(), fold_Ty.visit_with, fold_Span.visit_with));
    return visit_with_tuple2(self, visitor, visit_side, visit_side);
  },
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:1019 check_pat_range
FnCtxt.prototype.check_pat_range = function (this: FnCtxt, span: Span, lhs_: hir.PatExpr | undefined, rhs_: hir.PatExpr | undefined, expected: Ty, ti: TopInfo): Ty {
  const calc_side = (opt_expr: hir.PatExpr | undefined): RangeSide | undefined => {
    if (opt_expr === undefined) {
      return undefined;
    } else {
      const expr = opt_expr;
      const ty_ = this.check_pat_expr_unadjusted(expr);
      // Check that the end-point is possibly of numeric or char type.
      // The early check here is not for correctness, but rather better
      // diagnostics (e.g. when `&str` is being matched, `expected` will
      // be peeled to `str` while ty here is still `&str`, if we don't
      // err early here, a rather confusing unification error will be
      // emitted instead).
      const ty = this.deeply_resolve_ignoring_regions_with_obligations(ty_, fold_Ty);
      const fail = !(ty.is_numeric() || ty.is_char() || ty.is_ty_var() || TypeVisitableExt.references_error(ty, fold_Ty));
      return [fail, ty, expr.span];
    }
  };
  const endpoints = [lhs_, rhs_];
  // PORT: `lhs` / `rhs` are `Copy` tuples: `calc_side` returns fresh arrays, `demand_eqtype` updates `fail` in
  // place (`ref mut fail`) and reads only the type and span of the other side.
  const lhs = calc_side(lhs_);
  const rhs = calc_side(rhs_);

  if ((lhs !== undefined && lhs[0]) || (rhs !== undefined && rhs[0])) {
    // There exists a side that didn't meet our criteria that the end-point
    // be of a numeric or char type, as checked in `calc_side` above.
    const guar = this.emit_err_pat_range(span, lhs, rhs, endpoints);
    return Ty.new_error(this.tcx, guar);
  }

  // Unify each side with `expected`.
  // Subtyping doesn't matter here, as the value is some kind of scalar.
  const demand_eqtype = (x: RangeSide | undefined, y: RangeSide | undefined): void => {
    let r: Result<undefined, Diag>;
    if (x !== undefined && (r = this.demand_eqtype_pat_diag(x[2], expected, x[1], ti)).$ === "Err") {
      const err = r._0;
      if (y !== undefined) {
        const y_ty = y[1];
        const y_span = y[2];
        this.endpoint_has_type(err, y_span, y_ty);
      }
      err.emit();
      x[0] = true;
    }
  };
  demand_eqtype(lhs, rhs);
  demand_eqtype(rhs, lhs);

  if ((lhs !== undefined && lhs[0]) || (rhs !== undefined && rhs[0])) {
    return Ty.new_misc_error(this.tcx);
  }

  // Find the unified type and check if it's of numeric or char type again.
  // This check is needed if both sides are inference variables.
  // We require types to be resolved here so that we emit inference failure
  // rather than "_ is not a char or numeric".
  const ty = this.structurally_resolve_type(span, expected);
  if (!(ty.is_numeric() || ty.is_char() || TypeVisitableExt.references_error(ty, fold_Ty))) {
    if (lhs !== undefined) {
      lhs[0] = true;
    }
    if (rhs !== undefined) {
      rhs[0] = true;
    }
    const guar = this.emit_err_pat_range(span, lhs, rhs, endpoints);
    return Ty.new_error(this.tcx, guar);
  }
  return ty;
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:1092 endpoint_has_type
FnCtxt.prototype.endpoint_has_type = function (this: FnCtxt, err: Diag, span: Span, ty: Ty): void {
  if (!TypeVisitableExt.references_error(ty, fold_Ty)) {
    err.span_label(span, `this is of type \`${display_Ty(ty)}\``);
  }
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:1098 emit_err_pat_range
FnCtxt.prototype.emit_err_pat_range = function (
  this: FnCtxt,
  span: Span,
  lhs: RangeSide | undefined,
  rhs: RangeSide | undefined,
  endpoints: (hir.PatExpr | undefined)[],
): ErrorGuaranteed {
  if (!TypeVisitableExt.references_error([lhs, rhs], visit_RangeSides)) {
    // Range endpoints must resolve to constants, not local variables.
    // Label both runtime endpoints before the type error.
    const spans: Span[] = [];
    for (const expr of endpoints) {
      if (expr === undefined) continue;
      const k = expr.kind;
      if (k.$ === "Path" && k._0.$ === "Resolved" && k._0._1.res.$ === "Local") {
        spans.push(expr.span);
      }
    }
    if (spans.length !== 0) {
      return this.dcx().emit_err(diagnostics.NonConstPathInPattern_diagnostic({ spans }));
    }
  }

  let span_: Span;
  if (lhs !== undefined && lhs[0] && rhs !== undefined && rhs[0]) {
    span_ = span;
  } else if (lhs !== undefined && lhs[0]) {
    span_ = lhs[2];
  } else if (rhs !== undefined && rhs[0]) {
    span_ = rhs[2];
  } else {
    span_ = span_bug(span, "emit_err_pat_range: no side failed or exists but still error?");
  }
  const err = struct_span_code_err(this.dcx(), span_, E0029, "only `char` and numeric types are allowed in range patterns");
  const msg = (ty_: Ty): string => {
    const ty = this.deeply_resolve_ignoring_regions(ty_, fold_Ty);
    return `this is of type \`${display_Ty(ty)}\` but it should be \`char\` or numeric`;
  };
  const one_side_err = (first_span: Span, first_ty: Ty, second: RangeSide | undefined): void => {
    err.span_label(first_span, msg(first_ty));
    if (second !== undefined) {
      const ty_ = second[1];
      const sp = second[2];
      const ty = this.deeply_resolve_ignoring_regions(ty_, fold_Ty);
      this.endpoint_has_type(err, sp, ty);
    }
  };
  if (lhs !== undefined && lhs[0] && rhs !== undefined && rhs[0]) {
    const [, lhs_ty, lhs_sp] = lhs;
    const [, rhs_ty, rhs_sp] = rhs;
    err.span_label(lhs_sp, msg(lhs_ty));
    err.span_label(rhs_sp, msg(rhs_ty));
  } else if (lhs !== undefined && lhs[0]) {
    const [, lhs_ty, lhs_sp] = lhs;
    one_side_err(lhs_sp, lhs_ty, rhs);
  } else if (rhs !== undefined && rhs[0]) {
    const [, rhs_ty, rhs_sp] = rhs;
    one_side_err(rhs_sp, rhs_ty, lhs);
  } else {
    span_bug(span, "Impossible, verified above.");
  }
  if (TypeVisitableExt.references_error([lhs, rhs], visit_RangeSides)) {
    err.downgrade_to_delayed_bug();
  }
  if (this.tcx.sess.teach(unwrap(err.deref().code))) {
    err.note(
      "In a match expression, only numbers and characters can be matched \
against a range. This is because the compiler checks that the range \
is non-empty at compile-time, and is unable to evaluate arbitrary \
comparison functions. If you want to capture values of an orderable \
type between two end-points, you can use a guard.",
    );
  }
  return err.emit_err();
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:1168 check_pat_ident
FnCtxt.prototype.check_pat_ident = function (
  this: FnCtxt,
  pat: hir.Pat,
  user_bind_annot: BindingMode,
  var_id: HirId,
  ident: Ident,
  sub: hir.Pat | undefined,
  expected: Ty,
  pat_info: PatInfo,
): Ty {
  const { binding_mode: def_br, top_info: ti } = pat_info;

  // Determine the binding mode...
  let bm: BindingMode;
  if (user_bind_annot._0.$ === "No" && user_bind_annot._1 === "Mut" && def_br.$ === "Yes") {
    const def_br_mutbl = def_br._1;
    // Only mention the experimental `mut_ref` feature if if we're in edition 2024 and
    // using other experimental matching features compatible with it.
    if (
      Span.at_least_rust_2024(pat.span) &&
      (this.tcx.features().ref_pat_eat_one_layer_2024() || this.tcx.features().ref_pat_eat_one_layer_2024_structural())
    ) {
      if (!this.tcx.features().mut_ref()) {
        feature_err(this.tcx.sess, sym.mut_ref, Span.until(pat.span, ident.span), "binding cannot be both mutable and by-reference").emit();
      }

      bm = new BindingMode(def_br, "Mut");
    } else {
      // `mut` resets the binding mode on edition <= 2021
      this.add_rust_2024_migration_desugared_pat(
        pat_info.top_info.hir_id,
        pat,
        0x74 /* 't' */, // last char of `mut`
        def_br_mutbl,
      );
      bm = new BindingMode(ByRef.No, "Mut");
    }
  } else if (user_bind_annot._0.$ === "No") {
    const mutbl = user_bind_annot._1;
    bm = new BindingMode(def_br, mutbl);
  } else {
    const user_br_mutbl = user_bind_annot._0._1;
    if (def_br.$ === "Yes") {
      const def_br_mutbl = def_br._1;
      // `ref`/`ref mut` overrides the binding mode on edition <= 2021
      let final_char: number;
      switch (user_br_mutbl) {
        case "Not":
          final_char = 0x66 /* 'f' */; // last char of `ref`
          break;
        case "Mut":
          final_char = 0x74 /* 't' */; // last char of `ref mut`
          break;
      }
      this.add_rust_2024_migration_desugared_pat(pat_info.top_info.hir_id, pat, final_char, def_br_mutbl);
    }
    bm = user_bind_annot;
  }

  // If there exists a pinned reference in the pattern but the binding is not pinned,
  // it means the binding is unpinned and thus requires an `Unpin` bound.
  if (pat_info.max_pinnedness === "Pinned" && bm._0.$ === "Yes" && bm._0._0 === "Not") {
    this.register_bound(expected, this.tcx.require_lang_item(LangItem.Unpin, pat.span), this.misc(pat.span));
  }

  if (bm._0.$ === "Yes" && bm._0._1 === "Mut" && pat_info.max_ref_mutbl.$ === "WeaklyNot") {
    const and_pat_span = pat_info.max_ref_mutbl._0;
    const err = struct_span_code_err(this.dcx(), ident.span, E0596, "cannot borrow as mutable inside an `&` pattern");

    if (and_pat_span !== undefined) {
      const span = and_pat_span;
      err.span_suggestion_short(span, "replace this `&` with `&mut`", "&mut ", "MachineApplicable");
    }
    err.emit();
  }

  // ...and store it in a side table:
  this.typeck_results.pat_binding_modes_mut().insert(pat.hir_id, bm);

  // debug!("check_pat_ident: pat.hir_id={:?} bm={:?}", pat.hir_id, bm);

  const local_ty = this.local_ty(pat.span, pat.hir_id);
  let eq_ty: Ty;
  switch (bm._0.$) {
    case "Yes": {
      const pinnedness = bm._0._0;
      const mutbl = bm._0._1;
      // If the binding is like `ref x | ref mut x`,
      // then `x` is assigned a value of type `&M T` where M is the
      // mutability and T is the expected type.
      //
      // Under pin ergonomics, if the binding is like `ref pin const|mut x`,
      // then `x` is assigned a value of type `&pin M T` where M is the
      // mutability and T is the expected type.
      //
      // `x` is assigned a value of type `&M T`, hence `&M T <: typeof(x)`
      // is required. However, we use equality, which is stronger.
      // See (note_1) for an explanation.
      eq_ty = this.new_ref_ty(pat.span, pinnedness, mutbl, expected);
      break;
    }
    // Otherwise, the type of x is the expected type `T`.
    case "No":
      eq_ty = expected; // As above, `T <: typeof(x)` is required, but we use equality, see (note_1).
      break;
  }

  // We have a concrete type for the local, so we do not need to taint it and hide follow up errors *using* the local.
  void this.demand_eqtype_pat(pat.span, eq_ty, local_ty, ti);

  // If there are multiple arms, make sure they all agree on
  // what the type of the binding `x` ought to be.
  if (!HirId_eq(var_id, pat.hir_id)) {
    this.check_binding_alt_eq_ty(user_bind_annot, pat.span, var_id, local_ty, ti);
  }

  if (sub !== undefined) {
    const p = sub;
    this.check_pat(p, expected, pat_info);
  }

  return local_ty;
};

/// When a variable is bound several times in a `PatKind::Or`, it'll resolve all of the
/// subsequent bindings of the same name to the first usage. Verify that all of these
/// bindings have the same type by comparing them all against the type of that first pat.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:1306 check_binding_alt_eq_ty
FnCtxt.prototype.check_binding_alt_eq_ty = function (this: FnCtxt, ba: BindingMode, span: Span, var_id: HirId, ty: Ty, ti: TopInfo): void {
  const var_ty_ = this.local_ty(span, var_id);
  const r = this.demand_eqtype_pat_diag(span, var_ty_, ty, ti);
  if (r.$ === "Err") {
    const err = r._0;
    const var_ty = this.deeply_resolve_ignoring_regions(var_ty_, fold_Ty);
    const msg = `first introduced with type \`${display_Ty(var_ty)}\` here`;
    err.span_label(this.tcx.hir_span(var_id), msg);
    let in_match = false;
    for (const [, n] of this.tcx.hir_parent_iter(var_id)) {
      if (n.$ === "Expr" && n._0.kind.$ === "Match" && n._0.kind._2.$ === "Normal") {
        in_match = true;
        break;
      }
    }
    const pre = in_match ? "in the same arm, " : "";
    err.note(`${pre}a binding must have the same type in all alternatives`);
    this.suggest_adding_missing_ref_or_removing_ref(err, span, var_ty, this.deeply_resolve_ignoring_regions(ty, fold_Ty), ba);
    err.emit();
  }
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:1341 suggest_adding_missing_ref_or_removing_ref
FnCtxt.prototype.suggest_adding_missing_ref_or_removing_ref = function (this: FnCtxt, err: Diag, span: Span, expected: Ty, actual: Ty, ba: BindingMode): void {
  const ek = expected.kind();
  const ak = actual.kind();
  if (ek.$ === "Ref" && BindingMode_eq(ba, BindingMode.NONE) && this.can_eq(this.param_env, ek._1, actual, ToTrace_Ty)) {
    err.span_suggestion_verbose(Span.shrink_to_lo(span), "consider adding `ref`", "ref ", "MaybeIncorrect");
  } else if (ak.$ === "Ref" && BindingMode_eq(ba, BindingMode.REF) && this.can_eq(this.param_env, expected, ak._1, ToTrace_Ty)) {
    err.span_suggestion_verbose(Span.with_hi(span, BytePos(Span.lo(span) + 4)), "consider removing `ref`", "", "MaybeIncorrect");
  } else {
  }
};

/// Precondition: pat is a `Ref(_)` pattern
// rustc: compiler/rustc_hir_typeck/src/pat.rs:1375 borrow_pat_suggestion
FnCtxt.prototype.borrow_pat_suggestion = function (this: FnCtxt, err: Diag, pat: hir.Pat): void {
  const tcx = this.tcx;
  const pk = pat.kind;
  if (pk.$ === "Ref" && pk._0.kind.$ === "Binding") {
    const inner = pk._0;
    const pinned = pk._1;
    const mutbl = pk._2;
    const binding = pk._0.kind._2;
    const binding_parent = tcx.parent_hir_node(pat.hir_id);
    // debug!(?inner, ?pat, ?binding_parent);

    const pin_and_mut = Pinnedness.prefix_str(pinned, mutbl).trimEnd();

    const mut_var_suggestion = ((): [Span, string, string] | undefined => {
      if (Mutability.is_not(mutbl)) {
        return undefined;
      }

      let ident_kind: string;
      switch (binding_parent.$) {
        case "Param":
          ident_kind = "parameter";
          break;
        case "LetStmt":
          ident_kind = "variable";
          break;
        case "Arm":
          ident_kind = "binding";
          break;

        // Provide diagnostics only if the parent pattern is struct-like,
        // i.e. where `mut binding` makes sense
        case "Pat": {
          const kind = binding_parent._0.kind;
          switch (kind.$) {
            case "Struct":
            case "TupleStruct":
            case "Or":
            case "Guard":
            case "Tuple":
            case "Slice":
              ident_kind = "binding";
              break;

            case "Missing":
            case "Wild":
            case "Never":
            case "Binding":
            case "Deref":
            case "Ref":
            case "Expr":
            case "Range":
            case "Err":
              return undefined;
          }
          break;
        }

        // Don't provide suggestions in other cases
        default:
          return undefined;
      }

      return [pat.span, `to declare a mutable ${ident_kind} use`, `mut ${display_Ident(binding)}`];
    })();

    if (
      binding_parent.$ === "Param" &&
      binding_parent._0.pat.span !== binding_parent._0.ty_span &&
      Pinnedness.is_pinned(pinned) &&
      !tcx.features().pin_ergonomics()
    ) {
      // FIXME(pin_ergonomics): Once `pin_ergonomics` is stabilized, remove this
      // gate and allow the pinned reference type-position suggestion unconditionally.
    }
    // Check that there is explicit type (ie this is not a closure param with inferred type)
    // so we don't suggest moving something to the type that does not exist
    else if (binding_parent.$ === "Param" && binding_parent._0.pat.span !== binding_parent._0.ty_span) {
      const { ty_span, pat: param_pat } = binding_parent._0;
      err.multipart_suggestion(
        `to take parameter \`${display_Ident(binding)}\` by reference, move \`&${pin_and_mut}\` to the type`,
        [
          [Span.until(param_pat.span, inner.span), ""],
          [Span.shrink_to_lo(ty_span), `&${Pinnedness.prefix_str(pinned, mutbl)}`],
        ],
        "MachineApplicable",
      );

      if (mut_var_suggestion !== undefined) {
        const [sp, msg, sugg] = mut_var_suggestion;
        err.span_note(sp, `${msg}: \`${sugg}\``);
      }
    } else if (binding_parent.$ === "Pat" && binding_parent._0.kind.$ === "TupleStruct") {
      const pat_arr = binding_parent._0.kind._1;
      for (const i of pat_arr) {
        if (i.kind.$ === "Ref" && i.kind._0.kind.$ === "Binding") {
          const mt = i.kind._0.kind._0;
          const ident = i.kind._0.kind._2;
          const mtblty = mt._1;
          err.span_suggestion_verbose(
            i.span,
            `consider removing \`&${pin_and_mut}\` from the pattern`,
            Mutability.prefix_str(mtblty) + Symbol.as_str(ident.name),
            "MaybeIncorrect",
          );
        }
      }
      if (mut_var_suggestion !== undefined) {
        const [sp, msg, sugg] = mut_var_suggestion;
        err.span_note(sp, `${msg}: \`${sugg}\``);
      }
    } else if (binding_parent.$ === "Param" || binding_parent.$ === "Arm" || binding_parent.$ === "Pat") {
      // rely on match ergonomics or it might be nested `&&pat`
      err.span_suggestion_verbose(Span.until(pat.span, inner.span), `consider removing \`&${pin_and_mut}\` from the pattern`, "", "MaybeIncorrect");

      if (mut_var_suggestion !== undefined) {
        const [sp, msg, sugg] = mut_var_suggestion;
        err.span_note(sp, `${msg}: \`${sugg}\``);
      }
    } else if (mut_var_suggestion !== undefined) {
      const [sp, msg, sugg] = mut_var_suggestion;
      err.span_suggestion_verbose(sp, msg, sugg, "MachineApplicable");
    } else {
      // don't provide suggestions in other cases #55175
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:1491 check_dereferenceable
FnCtxt.prototype.check_dereferenceable = function (this: FnCtxt, span: Span, expected: Ty, inner: hir.Pat): Result<undefined, ErrorGuaranteed> {
  let pointee_ty: Ty | undefined;
  if (inner.kind.$ === "Binding" && (pointee_ty = this.shallow_resolve(expected).builtin_deref(true)) !== undefined && pointee_ty.kind().$ === "Dynamic") {
    // This is "x = dyn SomeTrait" being reduced from
    // "let &x = &dyn SomeTrait" or "let box x = Box<dyn SomeTrait>", an error.
    const type_str = this.ty_to_string(expected);
    const err = struct_span_code_err(this.dcx(), span, E0033, `type \`${type_str}\` cannot be dereferenced`);
    err.span_label(span, `type \`${type_str}\` cannot be dereferenced`);
    if (this.tcx.sess.teach(unwrap(err.deref().code))) {
      err.note(CANNOT_IMPLICITLY_DEREF_POINTER_TRAIT_OBJ);
    }
    return Err(err.emit_err());
  }
  return Ok(undefined);
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:1520 resolve_pat_struct
FnCtxt.prototype.resolve_pat_struct = function (this: FnCtxt, pat: hir.Pat, qpath: hir.QPath): Result<ResolvedPat, ErrorGuaranteed> {
  // Resolve the path and check the definition for errors.
  const r = this.check_struct_path(qpath, pat.hir_id);
  if (r.$ === "Err") return r;
  const [variant, pat_ty] = r._0;
  return Ok(new gen.ResolvedPat(pat_ty, { $: "Struct", variant }));
};

/// Reject pin-projection through a type that isn't structurally pinnable.
///
/// Destructuring an ADT underneath a `&pin` reference projects its fields as pinned references.
/// This is only sound if the type opted into structural pinning with `#[pin_v2]`; otherwise it
/// would let safe code form a `Pin<&mut Field>` for a type that should never be pinned, breaking
/// the `Pin` guarantee (see #157634).
///
/// This covers both explicit (`&pin mut`/`&pin const`) and implicit (match-ergonomics)
/// projection. `max_pinnedness` is only set for `&pin mut`, so the implicit shared (`&pin
/// const`) case is instead recognized through its pinned binding mode, hence both are checked.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:1540 check_pin_projection
FnCtxt.prototype.check_pin_projection = function (this: FnCtxt, pat: hir.Pat, pat_ty: Ty, pat_info: PatInfo): void {
  const through_pin = pat_info.max_pinnedness === "Pinned" || (pat_info.binding_mode.$ === "Yes" && pat_info.binding_mode._0 === "Pinned");
  let adt: AdtDef | undefined;
  if (through_pin && (adt = pat_ty.ty_adt_def()) !== undefined && !adt.is_pin_project() && !adt.is_pin()) {
    const def_span: Span | undefined = this.tcx.hir_span_if_local(adt.did());
    const sugg_span = def_span === undefined ? undefined : Span.shrink_to_lo(def_span);
    this.dcx().emit_err(
      diagnostics.ProjectOnNonPinProjectType_diagnostic({
        span: pat.span,
        def_span,
        sugg_span,
      }),
    );
  }
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:1563 check_pat_struct
FnCtxt.prototype.check_pat_struct = function (
  this: FnCtxt,
  pat: hir.Pat,
  fields: readonly hir.PatField[],
  has_rest_pat: boolean,
  pat_ty: Ty,
  variant: VariantDef,
  expected: Ty,
  pat_info: PatInfo,
): Ty {
  this.check_pin_projection(pat, pat_ty, pat_info);

  // Type-check the path.
  const had_err = this.demand_eqtype_pat(pat.span, expected, pat_ty, pat_info.top_info);

  // Type-check subpatterns.
  const r = this.check_struct_pat_fields(pat_ty, pat, variant, fields, has_rest_pat, pat_info);
  if (r.$ === "Ok") {
    if (had_err.$ === "Ok") {
      return pat_ty;
    } else {
      const guar = had_err._0;
      return Ty.new_error(this.tcx, guar);
    }
  } else {
    const guar = r._0;
    return Ty.new_error(this.tcx, guar);
  }
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:1588 resolve_pat_path
FnCtxt.prototype.resolve_pat_path = function (this: FnCtxt, path_id: HirId, span: Span, qpath: hir.QPath): Result<ResolvedPat, ErrorGuaranteed> {
  const tcx = this.tcx;

  const [res, opt_ty, segments] = this.resolve_ty_and_res_fully_qualified_call(qpath, path_id, span);
  if (res.$ === "Err") {
    const e = this.dcx().span_delayed_bug(hir.QPath.span(qpath), "`Res::Err` but no error emitted");
    this.set_tainted_by_errors(e);
    return Err(e);
  } else if (res.$ === "Def" && (res._0.$ === "AssocFn" || (res._0.$ === "Ctor" && res._0._1 === "Fn") || res._0.$ === "Variant")) {
    const expected = "unit struct, unit variant or constant";
    const e = this.report_unexpected_variant_res(res, undefined, [], qpath, span, E0533, expected);
    return Err(e);
  } else if (res.$ === "SelfCtor") {
    const def_id = res._0;
    let ak: TyKind;
    let ctor: [CtorKind, DefId] | undefined;
    if (
      (ak = EarlyBinder.skip_binder(tcx.type_of(def_id) as EarlyBinder<Ty>).kind()).$ === "Adt" &&
      ak._0.is_struct() &&
      (ctor = ak._0.non_enum_variant().ctor) !== undefined &&
      ctor[0] === "Const"
    ) {
      // Ok, we allow unit struct ctors in patterns only.
    } else {
      const e = this.report_unexpected_variant_res(res, undefined, [], qpath, span, E0533, "unit struct");
      return Err(e);
    }
  } else if (
    res.$ === "Def" &&
    ((res._0.$ === "Ctor" && res._0._1 === "Const") || res._0.$ === "Const" || res._0.$ === "AssocConst" || res._0.$ === "ConstParam")
  ) {
    // OK
  } else {
    bug(`unexpected pattern resolution: ${debug_Res(res, PLAIN, debug_HirId)}`);
  }

  // Find the type of the path pattern, for later checking.
  const [pat_ty, pat_res] = this.instantiate_value_path(segments, opt_ty, res, span, span, path_id, false);
  return Ok(new gen.ResolvedPat(pat_ty, { $: "Path", res, pat_res, segments }));
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:1653 check_pat_path
FnCtxt.prototype.check_pat_path = function (this: FnCtxt, pat_id_for_diag: HirId, span: Span, resolved: ResolvedPat, expected: Ty, ti: TopInfo): Ty {
  const r = this.demand_suptype_with_origin(this.pattern_cause(ti, span), expected, resolved.ty);
  if (r.$ === "Err") {
    const err = r._0;
    this.emit_bad_pat_path(err, pat_id_for_diag, span, resolved);
  }
  return resolved.ty;
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:1669 maybe_suggest_range_literal
FnCtxt.prototype.maybe_suggest_range_literal = function (this: FnCtxt, e: Diag, opt_def_id: DefId | undefined, ident: Ident): boolean {
  let node: hir.Node | undefined;
  let rhs_node: hir.Node;
  if (
    opt_def_id !== undefined &&
    (node = this.tcx.hir_get_if_local(opt_def_id)) !== undefined &&
    node.$ === "Item" &&
    node._0.kind.$ === "Const" &&
    (rhs_node = this.tcx.hir_node(hir.ConstItemRhs.hir_id(node._0.kind._3))).$ === "Expr" &&
    hir.is_range_literal(rhs_node._0)
  ) {
    const ct_rhs = node._0.kind._3;
    const span = this.tcx.hir_span(hir.ConstItemRhs.hir_id(ct_rhs));
    const r = this.tcx.sess.source_map().span_to_snippet(span);
    if (r.$ === "Ok") {
      const snip = r._0.toString();
      e.span_suggestion_verbose(ident.span, "you may want to move the range into the match block", snip, "MachineApplicable");
      return true;
    }
  }
  return false;
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:1697 emit_bad_pat_path
FnCtxt.prototype.emit_bad_pat_path = function (this: FnCtxt, e: Diag, hir_id: HirId, pat_span: Span, resolved_pat: ResolvedPat): void {
  const rk = resolved_pat.kind;
  if (rk.$ !== "Path") {
    return span_bug(pat_span, `unexpected resolution for path pattern: ${debug_ResolvedPat(resolved_pat, PLAIN)}`);
  }
  const { res, pat_res, segments } = rk;

  let span: Span;
  const res_span = this.tcx.hir_res_span(pat_res);
  const res_def_id = Res.opt_def_id(res);
  if (res_span !== undefined) {
    span = res_span;
  } else if (res_def_id !== undefined) {
    span = this.tcx.def_span(res_def_id);
  } else {
    e.emit();
    return;
  }
  if (segments.length === 1 && segments[0].args === undefined && Suggestions.len(e.deref().suggestions) === 0) {
    const ident = segments[0].ident;
    e.span_label(span, `${Res.descr(res)} defined here`);
    e.span_label(pat_span, `\`${display_Ident(ident)}\` is interpreted as ${Res.article(res)} ${Res.descr(res)}, not a new binding`);
    const parent = this.tcx.parent_hir_node(hir_id);
    switch (parent.$) {
      case "PatField": {
        e.span_suggestion_verbose(
          Span.shrink_to_hi(ident.span),
          "bind the struct field to a different name instead",
          `: other_${str_to_lowercase(ident.as_str())}`,
          "HasPlaceholders",
        );
        break;
      }
      default: {
        let type_def_id: DefId | undefined;
        let item_def_id: DefId | undefined;
        const tk = resolved_pat.ty.kind();
        if (tk.$ === "Adt") {
          const def = tk._0;
          if (res.$ === "Def" && res._0.$ === "Const") {
            const def_id = res._1;
            [type_def_id, item_def_id] = [def.did(), def_id];
          } else {
            [type_def_id, item_def_id] = [undefined, undefined];
          }
        } else {
          [type_def_id, item_def_id] = [undefined, undefined];
        }

        const lang_item = type_def_id === undefined ? undefined : this.tcx.as_lang_item(type_def_id);
        const is_range =
          lang_item === LangItem.Range ||
          lang_item === LangItem.RangeFrom ||
          lang_item === LangItem.RangeTo ||
          lang_item === LangItem.RangeFull ||
          lang_item === LangItem.RangeInclusiveStruct ||
          lang_item === LangItem.RangeToInclusive;
        if (is_range) {
          if (!this.maybe_suggest_range_literal(e, item_def_id, ident)) {
            const msg =
              "constants only support matching by type, \
if you meant to match against a range of values, \
consider using a range pattern like `min ..= max` in the match block";
            e.note(msg);
          }
        } else {
          const msg = "introduce a new binding instead";
          const sugg = `other_${str_to_lowercase(ident.as_str())}`;
          e.span_suggestion_verbose(ident.span, msg, sugg, "HasPlaceholders");
        }
        break;
      }
    }
  }
  e.emit();
};
// }

// ==== lane typeck-pat-b: pat.rs:1780..3388 ====
unported_methods(FnCtxt.prototype, "rustc_hir_typeck::pat::FnCtxt", ["resolve_pat_tuple_struct", "check_pat_tuple_struct", "emit_err_pat_wrong_number_of_fields", "check_pat_tuple", "check_struct_pat_fields", "error_tuple_variant_index_shorthand", "error_foreign_non_exhaustive_spat", "error_field_already_bound", "error_inexistent_fields", "error_tuple_variant_as_struct_pat", "get_suggested_tuple_struct_pattern", "error_no_accessible_fields", "lint_non_exhaustive_omitted_patterns", "error_unmentioned_fields", "check_pat_deref", "deref_pat_target", "register_deref_mut_bounds_if_needed", "check_pat_ref", "new_ref_ty", "new_pinned_ty", "error_inherited_ref_mutability_mismatch", "try_resolve_slice_ty_to_array_ty", "pat_is_irrefutable", "check_pat_slice", "check_array_pat_len", "error_scrutinee_inconsistent_length", "error_scrutinee_with_rest_inconsistent_length", "error_scrutinee_unfixed_length", "error_expected_array_or_slice", "is_slice_or_array_or_vector", "add_rust_2024_migration_desugared_pat"]);

// rustc: compiler/rustc_hir_typeck/src/pat.rs:49 is_number
export function is_number(text: string): boolean {
  for (const c of text) {
    if (!is_ascii_digit(c.codePointAt(0) as number)) return false;
  }
  return true;
}
