// Port of compiler/rustc_hir_typeck/src/pat.rs (lines 1..1779 by lane typeck-pat-a, 1780.. by lane typeck-pat-b): see docs/handoff/fnctxt-contract.md "How to
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
import { BindingMode, BindingMode_eq, ByRef, type LitKind } from "../rustc_ast/lib.ts";
import { Mutability, Mutability_cmp, Pinnedness } from "../rustc_ast_ir/lib.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { Applicability, Diag, type DiagCtxtHandle, type Diagnostic, E0023, E0025, E0026, E0027, E0164, E0308, E0527, E0528, E0638, E0730, E0769, type Level, MultiSpan, pluralize, struct_span_code_err, Suggestions } from "../rustc_errors/lib.ts";
import { debug_Res, Res, type Res as ResT, type CtorKind } from "../rustc_hir/def.ts";
import { enumerate_and_adjust } from "../rustc_hir/pat_util.ts";
import { pat_to_string, qpath_to_string } from "../rustc_hir_pretty/lib.ts";
import { debug_HirId, type HirId, HirId_eq } from "../rustc_hir_id/lib.ts";
import { NON_EXHAUSTIVE_OMITTED_PATTERNS } from "../rustc_lint_defs/builtin.gen.ts";
import type { Rust2024IncompatiblePatInfo } from "../rustc_middle/ty/typeck_results.ts";
import type { Const, FieldIdx } from "../rustc_middle/ty/decls.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import type { GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { debug_Ty, type FieldDef, Ty, type VariantDef } from "../rustc_middle/ty/mod.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { fold_Ty, fold_Span } from "../rustc_middle/ty/structural_impls.ts";
import { KeyedMap } from "../rust_ts/keyed.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { BytePos, DUMMY_SP, type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { span_bug, bug } from "../rustc_span/macros.ts";
import { find_best_match_for_name } from "../rustc_span/edit_distance.ts";
import { display_Ident, type Ident, kw, sym, Symbol } from "../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import { PolyFnSig as PolyFnSigC } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt, type TypeVisitable, type VisitWith, visit_with_Option, visit_with_tuple2, visit_with_tuple3 } from "../rustc_type_ir/visit.ts";
import { ch, is_ascii_digit } from "../std/char.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert, unported, unreachable, unwrap, assert_matches } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { str_trim_start } from "../std/str.ts";
import { FnCtxt } from "./decls.ts";
import { ExpectedArrayOrSlice_diagnostic, UnionPatDotDot_diagnostic, UnionPatMultipleFields_diagnostic, type AsDerefSuggestion, type SlicingSuggestion } from "./diagnostics.ts";
import { FnCtxt_as_PpAnn } from "./fn_ctxt/mod.ts";
import { type InheritedRefMatchRule, type PatInfo, clone_PatInfo, ResolvedPat, debug_ResolvedPat, type PeelKind, type TopInfo } from "./pat.gen.ts";
import { E0029, E0033, E0533, E0596 } from "../rustc_errors/error_codes.gen.ts";
import { report_autoderef_recursion_limit_error } from "../rustc_hir_analysis/autoderef.ts";
import { ToTrace_Ty } from "../rustc_infer/infer/at.ts";
import { ObligationCause, type ObligationCauseCode, type PatternOriginExpr } from "../rustc_middle/traits/mod.ts";
import { EvaluationResult } from "../rustc_middle/traits/select.ts";
import type { PatAdjust, PatAdjustment } from "../rustc_middle/ty/adjustment.ts";
import { feature_err } from "../rustc_session/diagnostics.ts";
import { type DefId, DefId_eq } from "../rustc_span/def_id.ts";
import { Edition as EditionC, type Edition } from "../rustc_span/edition.ts";
import type { TyKind } from "../rustc_type_ir/ty_kind.gen.ts";
import { str_to_lowercase } from "../std/unicode/str_case.ts";
import type { DeclOrigin } from "./gather_locals.gen.ts";
import { Expectation as gen_Expectation } from "./expectation.gen.ts";
import { debug_PatExprKind } from "../rustc_hir/hir.gen.ts";
import * as hir from "../rustc_hir/lib.ts";
import * as diagnostics from "./diagnostics.gen.ts";
import * as gen from "./pat.gen.ts";

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
// PORT: `PatInfo` is `Copy` and passed by value; a fn that takes `mut pat_info` and assigns its fields clones it on
// entry (`clone_PatInfo`) so the caller's value is untouched (PORTING §8 "Rust copy of a Copy object").
/** `FxHashMap<Ident, _>` key: `Ident`'s `Eq`/`Hash` (the name and the span's `SyntaxContext`). */
function Ident_key(ident: Ident): string {
  return `${ident.name}:${Span.ctxt(ident.span)}`;
}

/** `str::parse::<usize>().is_err()` (an optional `+`, then ASCII digits, value < 2^64). */
function parse_usize_is_err(s: string): boolean {
  if (!/^\+?[0-9]+$/.test(s)) return true;
  return BigInt(s) > 0xffff_ffff_ffff_ffffn;
}

// rustc: compiler/rustc_hir_typeck/src/pat.rs:1781 resolve_pat_tuple_struct
FnCtxt.prototype.resolve_pat_tuple_struct = function (this: FnCtxt, pat: hir.Pat, qpath: hir.QPath): Result<ResolvedPat, ErrorGuaranteed> {
  const tcx = this.tcx;
  const report_unexpected_res = (res: ResT): Result<ResolvedPat, ErrorGuaranteed> => {
    const expected = "tuple struct or tuple variant";
    const sub_pats: readonly hir.Pat[] = pat.kind.$ === "TupleStruct" ? pat.kind._1 : [];
    const e = this.report_unexpected_variant_res(res, undefined, sub_pats, qpath, pat.span, E0164, expected);
    return Err(e);
  };

  // Resolve the path and check the definition for errors.
  const [res_, opt_ty, segments] = this.resolve_ty_and_res_fully_qualified_call(qpath, pat.hir_id, pat.span);
  if (res_.$ === "Err") {
    const e = this.dcx().span_delayed_bug(pat.span, "`Res::Err` but no error emitted");
    this.set_tainted_by_errors(e);
    return Err(e);
  }

  // Type-check the path.
  const [pat_ty_, res] = this.instantiate_value_path(segments, opt_ty, res_, pat.span, pat.span, pat.hir_id, false);
  if (!pat_ty_.is_fn()) {
    return report_unexpected_res(res);
  }

  let variant: VariantDef;
  if (res.$ === "Err") {
    return this.dcx().span_bug(pat.span, "`Res::Err` but no error emitted");
  } else if (res.$ === "Def" && (res._0.$ === "AssocConst" || res._0.$ === "AssocFn")) {
    return report_unexpected_res(res);
  } else if (res.$ === "Def" && res._0.$ === "Ctor" && res._0._1 === "Fn") {
    variant = tcx.expect_variant_res(res);
  } else {
    return bug(`unexpected pattern resolution: ${debug_Res(res, PLAIN, debug_HirId)}`);
  }

  // Replace constructor type with constructed type for tuple struct patterns.
  const pat_ty_out = PolyFnSigC.output(pat_ty_.fn_sig(tcx));
  const pat_ty = unwrap(Binder.no_bound_vars(pat_ty_out, fold_Ty), "expected fn type");

  return Ok(new ResolvedPat(pat_ty, { $: "TupleStruct", res, variant }));
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:1833 check_pat_tuple_struct
FnCtxt.prototype.check_pat_tuple_struct = function (
  this: FnCtxt,
  pat: hir.Pat,
  qpath: hir.QPath,
  subpats: readonly hir.Pat[],
  ddpos: hir.DotDotPos,
  res: ResT,
  pat_ty: Ty,
  variant: VariantDef,
  expected: Ty,
  pat_info: PatInfo,
): Ty {
  this.check_pin_projection(pat, pat_ty, pat_info);

  const tcx = this.tcx;
  const on_error = (e: ErrorGuaranteed): void => {
    for (const pat of subpats) {
      this.check_pat(pat, Ty.new_error(tcx, e), pat_info);
    }
  };

  // Type-check the tuple struct pattern against the expected type.
  const had_err = this.demand_eqtype_pat(pat.span, expected, pat_ty, pat_info.top_info);

  // Type-check subpatterns.
  if (subpats.length === variant.fields.length || (subpats.length < variant.fields.length && ddpos.as_opt_usize() !== undefined)) {
    const k = pat_ty.kind();
    if (k.$ !== "Adt") {
      return bug(`unexpected pattern type ${debug_Ty(pat_ty, PLAIN)}`);
    }
    const args = k._1;
    for (const [i, subpat] of enumerate_and_adjust(subpats, variant.fields.length, ddpos)) {
      const field = unwrap(variant.fields[i]);
      const field_ty = this.field_ty(subpat.span, field, args);
      this.check_pat(subpat, field_ty, pat_info);

      this.tcx.check_stability(unwrap(variant.fields[i]).did, subpat.hir_id, subpat.span, undefined);
    }
    if (had_err.$ === "Err") {
      const e = had_err._0;
      on_error(e);
      return Ty.new_error(tcx, e);
    }
  } else {
    const e = this.emit_err_pat_wrong_number_of_fields(pat.span, res, qpath, subpats, variant.fields, expected, had_err);
    on_error(e);
    return Ty.new_error(tcx, e);
  }
  return pat_ty;
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:1896 emit_err_pat_wrong_number_of_fields
FnCtxt.prototype.emit_err_pat_wrong_number_of_fields = function (
  this: FnCtxt,
  pat_span: Span,
  res: ResT,
  qpath: hir.QPath,
  subpats: readonly hir.Pat[],
  fields: readonly FieldDef[],
  expected: Ty,
  had_err: Result<undefined, ErrorGuaranteed>,
): ErrorGuaranteed {
  const subpats_ending = pluralize(subpats.length);
  const fields_ending = pluralize(fields.length);

  const subpat_spans: Span[] = subpats.length === 0 ? [pat_span] : subpats.map((p) => p.span);
  const last_subpat_span = unwrap(subpat_spans[subpat_spans.length - 1]);
  const res_span = this.tcx.def_span(Res.def_id(res, debug_HirId));
  const def_ident_span = this.tcx.def_ident_span(Res.def_id(res, debug_HirId)) ?? res_span;
  const field_def_spans: Span[] = fields.length === 0 ? [res_span] : fields.map((f) => f.ident(this.tcx).span);
  const last_field_def_span = unwrap(field_def_spans[field_def_spans.length - 1]);

  const err = struct_span_code_err(
    this.dcx(),
    MultiSpan.from_spans(subpat_spans),
    E0023,
    `this pattern has ${subpats.length} field${subpats_ending}, but the corresponding ${Res.descr(res)} has ${fields.length} field${fields_ending}`,
  );
  err.span_label(last_subpat_span, `expected ${fields.length} field${fields_ending}, found ${subpats.length}`);
  err.span_context(hir.QPath.span(qpath));
  if (this.tcx.sess.source_map().is_multiline(Span.between(def_ident_span, last_field_def_span))) {
    err.span_label(def_ident_span, `${Res.descr(res)} defined here`);
  }
  for (const span of field_def_spans.slice(0, field_def_spans.length - 1)) {
    err.span_label(span, "");
  }
  err.span_label(last_field_def_span, `${Res.descr(res)} has ${fields.length} field${fields_ending}`);

  // Identify the case `Some(x, y)` where the expected type is e.g. `Option<(T, U)>`.
  // More generally, the expected type wants a tuple variant with one field of an
  // N-arity-tuple, e.g., `V_i((p_0, .., p_N))`. Meanwhile, the user supplied a pattern
  // with the subpatterns directly in the tuple variant pattern, e.g., `V_i(p_0, .., p_N)`.
  let missing_parentheses: boolean;
  const expected_kind = expected.kind();
  // #67037: only do this if we could successfully type-check the expected type against
  // the tuple struct pattern. Otherwise the args could get out of range on e.g.,
  // `let P() = U;` where `P != U` with `struct Box<T>(T);`.
  if (expected_kind.$ === "Adt" && fields.length === 1 && had_err.$ === "Ok") {
    const field = fields[0]!;
    const field_ty = this.field_ty(pat_span, field, expected_kind._1);
    const fk = field_ty.kind();
    missing_parentheses = fk.$ === "Tuple" ? fk._0.length === subpats.length : false;
  } else {
    missing_parentheses = false;
  }
  if (missing_parentheses) {
    let left: Span;
    let right: Span;
    if (subpats.length === 0) {
      // This is the zero case; we aim to get the "hi" part of the `QPath`'s
      // span as the "lo" and then the "hi" part of the pattern's span as the "hi".
      // This looks like:
      //
      // help: missing parentheses
      //   |
      // L |     let A(()) = A(());
      //   |          ^  ^
      [left, right] = [Span.shrink_to_hi(hir.QPath.span(qpath)), pat_span];
    } else {
      // Easy case. Just take the "lo" of the first sub-pattern and the "hi" of the
      // last sub-pattern. In the case of `A(x)` the first and last may coincide.
      // This looks like:
      //
      // help: missing parentheses
      //   |
      // L |     let A((x, y)) = A((1, 2));
      //   |           ^    ^
      const first = subpats[0]!;
      [left, right] = [Span.shrink_to_lo(first.span), unwrap(subpats[subpats.length - 1]).span];
    }
    err.multipart_suggestion(
      "missing parentheses",
      [
        [left, "("],
        [Span.shrink_to_hi(right), ")"],
      ],
      "MachineApplicable",
    );
  } else if (fields.length > subpats.length && pat_span !== DUMMY_SP) {
    const after_fields_span = Span.shrink_to_hi(Span.with_hi(pat_span, (Span.hi(pat_span) - 1) as BytePos));
    let all_fields_span: Span;
    if (subpats.length === 0) {
      all_fields_span = after_fields_span;
    } else if (subpats.length === 1) {
      all_fields_span = subpats[0]!.span;
    } else {
      all_fields_span = Span.to(subpats[0]!.span, subpats[subpats.length - 1]!.span);
    }

    // Check if all the fields in the pattern are wildcards.
    const all_wildcards = subpats.every((pat) => pat.kind.$ === "Wild");
    let first_tail_wildcard: number | undefined = undefined;
    subpats.forEach((pat, pos) => {
      const acc = first_tail_wildcard;
      if (acc === undefined && pat.kind.$ === "Wild") {
        first_tail_wildcard = pos;
      } else if (acc !== undefined && pat.kind.$ === "Wild") {
        first_tail_wildcard = acc;
      } else {
        first_tail_wildcard = undefined;
      }
    });
    let tail_span: Span;
    const ftw = first_tail_wildcard as number | undefined;
    if (ftw === undefined) {
      tail_span = after_fields_span;
    } else if (ftw === 0) {
      tail_span = Span.to(subpats[0]!.span, after_fields_span);
    } else {
      tail_span = Span.to(Span.shrink_to_hi(subpats[ftw - 1]!.span), after_fields_span);
    }

    // FIXME: heuristic-based suggestion to check current types for where to add `_`.
    let wildcard_sugg = new Array<string>(fields.length - subpats.length).fill("_").join(", ");
    if (subpats.length !== 0) {
      wildcard_sugg = ", " + wildcard_sugg;
    }

    err.span_suggestion_verbose(after_fields_span, "use `_` to explicitly ignore each field", wildcard_sugg, "MaybeIncorrect");

    // Only suggest `..` if more than one field is missing
    // or the pattern consists of all wildcards.
    if (fields.length - subpats.length > 1 || all_wildcards) {
      if (subpats.length === 0 || all_wildcards) {
        err.span_suggestion_verbose(all_fields_span, "use `..` to ignore all fields", "..", "MaybeIncorrect");
      } else {
        err.span_suggestion_verbose(tail_span, "use `..` to ignore the rest of the fields", ", ..", "MaybeIncorrect");
      }
    }
  }

  return err.emit_err();
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:2053 check_pat_tuple
FnCtxt.prototype.check_pat_tuple = function (this: FnCtxt, span: Span, elements: readonly hir.Pat[], ddpos: hir.DotDotPos, expected: Ty, pat_info: PatInfo): Ty {
  const tcx = this.tcx;
  let expected_len = elements.length;
  if (ddpos.as_opt_usize() !== undefined) {
    // Require known type only when `..` is present.
    const k = this.structurally_resolve_type(span, expected).kind();
    if (k.$ === "Tuple") {
      expected_len = k._0.length;
    }
  }
  const max_len = Math.max(expected_len, elements.length);

  const element_tys_iter: Ty[] = [];
  for (let i = 0; i < max_len; i++) element_tys_iter.push(this.next_ty_var(span));
  const element_tys = tcx.mk_type_list_from_iter(element_tys_iter);
  const pat_ty = Ty.new_tup(tcx, element_tys);
  const r = this.demand_eqtype_pat(span, expected, pat_ty, pat_info.top_info);
  if (r.$ === "Err") {
    const reported = r._0;
    // Walk subpatterns with an expected type of `err` in this case to silence
    // further errors being emitted when using the bindings. #50333
    for (const [, elem] of enumerate_and_adjust(elements, max_len, ddpos)) {
      this.check_pat(elem, Ty.new_error(tcx, reported), pat_info);
    }
    return Ty.new_error(tcx, reported);
  } else {
    for (const [i, elem] of enumerate_and_adjust(elements, max_len, ddpos)) {
      this.check_pat(elem, unwrap(element_tys[i]), pat_info);
    }
    return pat_ty;
  }
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:2089 check_struct_pat_fields
FnCtxt.prototype.check_struct_pat_fields = function (
  this: FnCtxt,
  adt_ty: Ty,
  pat: hir.Pat,
  variant: VariantDef,
  fields: readonly hir.PatField[],
  has_rest_pat: boolean,
  pat_info: PatInfo,
): Result<undefined, ErrorGuaranteed> {
  const tcx = this.tcx;

  const adt_kind = adt_ty.kind();
  if (adt_kind.$ !== "Adt") {
    return span_bug(pat.span, "struct pattern is not an ADT");
  }
  const adt = adt_kind._0;
  const args = adt_kind._1;

  // Index the struct fields' types.
  const field_map = new KeyedMap<Ident, [FieldIdx, FieldDef]>(Ident_key);
  variant.fields.forEach((field, i) => {
    field_map.set(field.ident(this.tcx).normalize_to_macros_2_0(), [i as FieldIdx, field]);
  });

  // Keep track of which fields have already appeared in the pattern.
  const used_fields = new KeyedMap<Ident, Span>(Ident_key);
  let result: Result<undefined, ErrorGuaranteed> = Ok(undefined);

  const inexistent_fields: hir.PatField[] = [];
  // Typecheck each field.
  for (const field of fields) {
    const span = field.span;
    const ident = tcx.adjust_ident(field.ident, variant.def_id);
    let field_ty: Ty;
    if (used_fields.has(ident)) {
      // Occupied(occupied)
      const guar = this.error_field_already_bound(span, field.ident, used_fields.get(ident)!);
      result = Err(guar);
      field_ty = Ty.new_error(tcx, guar);
    } else {
      // Vacant(vacant)
      used_fields.set(ident, span);
      const entry = field_map.get(ident);
      if (entry !== undefined) {
        const [i, f] = entry;
        this.write_field_index(field.hir_id, i);
        this.tcx.check_stability(f.did, field.hir_id, span, undefined);
        field_ty = this.field_ty(span, f, args);
      } else {
        inexistent_fields.push(field);
        field_ty = Ty.new_misc_error(tcx);
      }
    }

    this.check_pat(field.pat, field_ty, pat_info);
  }

  const unmentioned_fields: [FieldDef, Ident][] = variant.fields
    .map((field): [FieldDef, Ident] => [field, field.ident(this.tcx).normalize_to_macros_2_0()])
    .filter(([, ident]) => !used_fields.has(ident));

  let inexistent_fields_err: Diag | undefined;
  if (inexistent_fields.length !== 0 && !inexistent_fields.some((field) => field.ident.name === kw.Underscore)) {
    // we don't care to report errors for a struct if the struct itself is tainted
    const tainted = variant.has_errors();
    if (tainted.$ === "Err") return Err(tainted._0);
    inexistent_fields_err = this.error_inexistent_fields(adt.variant_descr(), inexistent_fields, unmentioned_fields, pat, variant, args);
  } else {
    inexistent_fields_err = undefined;
  }

  // Require `..` if struct has non_exhaustive attribute.
  const non_exhaustive = variant.field_list_has_applicable_non_exhaustive();
  if (non_exhaustive && !has_rest_pat) {
    this.error_foreign_non_exhaustive_spat(pat, adt.variant_descr(), fields.length === 0);
  }

  let unmentioned_err: Diag | undefined = undefined;
  // Report an error if an incorrect number of fields was specified.
  if (adt.is_union()) {
    if (fields.length !== 1) {
      this.dcx().emit_err(UnionPatMultipleFields_diagnostic({ span: pat.span }));
    }
    if (has_rest_pat) {
      this.dcx().emit_err(UnionPatDotDot_diagnostic({ span: pat.span }));
    }
  } else if (unmentioned_fields.length !== 0) {
    const accessible_unmentioned_fields: [FieldDef, Ident][] = unmentioned_fields.filter(([field]) => this.is_field_suggestable(field, pat.span));

    if (!has_rest_pat) {
      if (accessible_unmentioned_fields.length === 0) {
        unmentioned_err = this.error_no_accessible_fields(pat, fields);
      } else {
        unmentioned_err = this.error_unmentioned_fields(
          pat,
          accessible_unmentioned_fields,
          accessible_unmentioned_fields.length !== unmentioned_fields.length,
          fields,
        );
      }
    } else if (non_exhaustive && accessible_unmentioned_fields.length !== 0) {
      this.lint_non_exhaustive_omitted_patterns(pat, accessible_unmentioned_fields, adt_ty);
    }
  }
  if (inexistent_fields_err !== undefined && unmentioned_err !== undefined) {
    const i = inexistent_fields_err;
    const u = unmentioned_err;
    const r = this.error_tuple_variant_as_struct_pat(pat, fields, variant);
    if (r.$ === "Err") {
      // We don't want to show the nonexistent fields error when this was
      // `Foo { a, b }` when it should have been `Foo(a, b)`.
      i.delay_as_bug();
      u.delay_as_bug();
      return Err(r._0);
    } else {
      i.emit();
      return Err(u.emit_err());
    }
  } else if (inexistent_fields_err === undefined && unmentioned_err !== undefined) {
    const u = unmentioned_err;
    const r = this.error_tuple_variant_as_struct_pat(pat, fields, variant);
    if (r.$ === "Err") {
      u.delay_as_bug();
      return Err(r._0);
    } else {
      return Err(u.emit_err());
    }
  } else if (inexistent_fields_err !== undefined && unmentioned_err === undefined) {
    return Err(inexistent_fields_err.emit_err());
  } else {
    const r = this.error_tuple_variant_index_shorthand(variant, pat, fields);
    if (r.$ === "Err") return r;
    return result;
  }
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:2239 error_tuple_variant_index_shorthand
FnCtxt.prototype.error_tuple_variant_index_shorthand = function (this: FnCtxt, variant: VariantDef, pat: hir.Pat, fields: readonly hir.PatField[]): Result<undefined, ErrorGuaranteed> {
  // if this is a tuple struct, then all field names will be numbers
  // so if any fields in a struct pattern use shorthand syntax, they will
  // be invalid identifiers (for example, Foo { 0, 1 }).
  if (variant.ctor_kind() === "Fn" && pat.kind.$ === "Struct") {
    const qpath = pat.kind._0;
    const field_patterns = pat.kind._1;
    const has_shorthand_field_name = field_patterns.some((field) => field.is_shorthand);
    if (has_shorthand_field_name) {
      const path = qpath_to_string(FnCtxt_as_PpAnn(this), qpath);
      const err = struct_span_code_err(this.dcx(), pat.span, E0769, `tuple variant \`${path}\` written as struct variant`);
      err.span_suggestion_verbose(
        Span.to(Span.shrink_to_hi(hir.QPath.span(qpath)), Span.shrink_to_hi(pat.span)),
        "use the tuple variant pattern syntax instead",
        `(${this.get_suggested_tuple_struct_pattern(fields, variant)})`,
        "MaybeIncorrect",
      );
      return Err(err.emit_err());
    }
  }
  return Ok(undefined);
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:2272 error_foreign_non_exhaustive_spat
FnCtxt.prototype.error_foreign_non_exhaustive_spat = function (this: FnCtxt, pat: hir.Pat, descr: string, no_fields: boolean): void {
  const sess = this.tcx.sess;
  const sm = sess.source_map();
  const sp_brace = sm.end_point(pat.span);
  const sp_comma = sm.end_point(Span.with_hi(pat.span, Span.hi(sp_brace)));
  const sugg = no_fields || sp_brace !== sp_comma ? ".. }" : ", .. }";

  struct_span_code_err(this.dcx(), pat.span, E0638, `\`..\` required with ${descr} marked as non-exhaustive`)
    .with_span_suggestion_verbose(sp_comma, "add `..` at the end of the field list to ignore all other fields", sugg, "MachineApplicable")
    .emit();
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:2294 error_field_already_bound
FnCtxt.prototype.error_field_already_bound = function (this: FnCtxt, span: Span, ident: Ident, other_field: Span): ErrorGuaranteed {
  return struct_span_code_err(this.dcx(), span, E0025, `field \`${display_Ident(ident)}\` bound multiple times in the pattern`)
    .with_span_label(span, `multiple uses of \`${display_Ident(ident)}\` in pattern`)
    .with_span_label(other_field, `first use of \`${display_Ident(ident)}\``)
    .emit_err();
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:2312 error_inexistent_fields
FnCtxt.prototype.error_inexistent_fields = function (
  this: FnCtxt,
  kind_name: string,
  inexistent_fields: readonly hir.PatField[],
  unmentioned_fields: [FieldDef, Ident][],
  pat: hir.Pat,
  variant: VariantDef,
  args: GenericArgs,
): Diag {
  const tcx = this.tcx;
  let field_names: string;
  let t: string;
  let plural: string;
  if (inexistent_fields.length === 1) {
    const field = inexistent_fields[0]!;
    [field_names, t, plural] = [`a field named \`${display_Ident(field.ident)}\``, "this", ""];
  } else {
    [field_names, t, plural] = [`fields named ${inexistent_fields.map((field) => `\`${display_Ident(field.ident)}\``).join(", ")}`, "these", "s"];
  }
  const spans = inexistent_fields.map((field) => field.ident.span);
  const err = struct_span_code_err(this.dcx(), spans, E0026, `${kind_name} \`${tcx.def_path_str(variant.def_id)}\` does not have ${field_names}`);
  const pat_field = inexistent_fields[inexistent_fields.length - 1];
  if (pat_field !== undefined) {
    err.span_label(pat_field.ident.span, `${kind_name} \`${tcx.def_path_str(variant.def_id)}\` does not have ${t} field${plural}`);

    if (unmentioned_fields.length === 1 && this.is_field_suggestable(unmentioned_fields[0]![0], pat.span)) {
      const [field_def, field] = unmentioned_fields[0]!;
      const suggested_name = find_best_match_for_name([field.name], pat_field.ident.name, undefined);
      if (suggested_name !== undefined) {
        err.span_suggestion_verbose(pat_field.ident.span, "a field with a similar name exists", Symbol.as_str(suggested_name), "MaybeIncorrect");

        // When we have a tuple struct used with struct we don't want to suggest using
        // the (valid) struct syntax with numeric field names. Instead we want to
        // suggest the expected syntax. We infer that this is the case by parsing the
        // `Ident` into an unsized integer. The suggestion will be emitted elsewhere in
        // `smart_resolve_context_dependent_help`.
        if (parse_usize_is_err(Symbol.to_ident_string(suggested_name))) {
          // We don't want to throw `E0027` in case we have thrown `E0026` for them.
          // PORT: `Vec::retain` edits the caller's vector in place.
          const kept = unmentioned_fields.filter(([, x]) => x.name !== suggested_name);
          unmentioned_fields.splice(0, unmentioned_fields.length, ...kept);
        }
      } else if (inexistent_fields.length === 1) {
        if (pat_field.pat.kind.$ === "Expr" && !this.may_coerce(this.typeck_results.node_type(pat_field.pat.hir_id), this.field_ty(field.span, field_def, args))) {
          // nothing
        } else {
          err.span_suggestion_short(
            pat_field.ident.span,
            `\`${tcx.def_path_str(variant.def_id)}\` has a field named \`${Symbol.as_str(field.name)}\``,
            Symbol.as_str(field.name),
            "MaybeIncorrect",
          );
        }
      }
    }
  }
  if (tcx.sess.teach(unwrap(err.deref().code))) {
    err.note(
      "This error indicates that a struct pattern attempted to \
extract a nonexistent field from a struct. Struct fields \
are identified by the name used before the colon : so struct \
patterns should resemble the declaration of the struct type \
being matched.\n\n\
If you are using shorthand field patterns but want to refer \
to the struct field by a different name, you should rename \
it explicitly.",
    );
  }
  return err;
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:2420 error_tuple_variant_as_struct_pat
FnCtxt.prototype.error_tuple_variant_as_struct_pat = function (this: FnCtxt, pat: hir.Pat, fields: readonly hir.PatField[], variant: VariantDef): Result<undefined, ErrorGuaranteed> {
  if (variant.ctor_kind() === "Fn" && pat.kind.$ === "Struct") {
    const qpath = pat.kind._0;
    const pattern_fields = pat.kind._1;
    const is_tuple_struct_match = pattern_fields.length !== 0 && pattern_fields.map((field) => Symbol.as_str(field.ident.name)).every((s) => is_number(s));
    if (is_tuple_struct_match) {
      return Ok(undefined);
    }

    // we don't care to report errors for a struct if the struct itself is tainted
    const tainted = variant.has_errors();
    if (tainted.$ === "Err") return Err(tainted._0);

    const path = qpath_to_string(FnCtxt_as_PpAnn(this), qpath);
    const err = struct_span_code_err(this.dcx(), pat.span, E0769, `tuple variant \`${path}\` written as struct variant`);
    let sugg: string;
    let appl: Applicability;
    if (fields.length === variant.fields.length) {
      [sugg, appl] = [this.get_suggested_tuple_struct_pattern(fields, variant), "MachineApplicable"];
    } else {
      [sugg, appl] = [variant.fields.map(() => "_").join(", "), "MaybeIncorrect"];
    }
    err.span_suggestion_verbose(
      Span.to(Span.shrink_to_hi(hir.QPath.span(qpath)), Span.shrink_to_hi(pat.span)),
      "use the tuple variant pattern syntax instead",
      `(${sugg})`,
      appl,
    );
    return Err(err.emit_err());
  }
  return Ok(undefined);
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:2468 get_suggested_tuple_struct_pattern
FnCtxt.prototype.get_suggested_tuple_struct_pattern = function (this: FnCtxt, fields: readonly hir.PatField[], variant: VariantDef): string {
  const variant_field_idents: Ident[] = variant.fields.map((f) => f.ident(this.tcx));
  return fields
    .map((field) => {
      const r = this.tcx.sess.source_map().span_to_snippet(field.pat.span);
      if (r.$ === "Ok") {
        const f = r._0.toString();
        // Field names are numbers, but numbers
        // are not valid identifiers
        if (variant_field_idents.some((i) => i.eq(field.ident))) {
          return "_";
        } else {
          return f;
        }
      } else {
        return pat_to_string(FnCtxt_as_PpAnn(this), field.pat);
      }
    })
    .join(", ");
};

/// Returns a diagnostic reporting a struct pattern which is missing an `..` due to
/// inaccessible fields.
///
/// ```text
/// error: pattern requires `..` due to inaccessible fields
///   --> src/main.rs:10:9
///    |
/// LL |     let foo::Foo {} = foo::Foo::default();
///    |         ^^^^^^^^^^^
///    |
/// help: add a `..`
///    |
/// LL |     let foo::Foo { .. } = foo::Foo::default();
///    |                  ^^^^^^
/// ```
// rustc: compiler/rustc_hir_typeck/src/pat.rs:2510 error_no_accessible_fields
FnCtxt.prototype.error_no_accessible_fields = function (this: FnCtxt, pat: hir.Pat, fields: readonly hir.PatField[]): Diag {
  const err = this.dcx().struct_span_err(pat.span, "pattern requires `..` due to inaccessible fields");

  const field = fields[fields.length - 1];
  if (field !== undefined) {
    const tail_span = Span.to(Span.shrink_to_hi(field.span), Span.shrink_to_hi(pat.span));
    const snippet_r = this.tcx.sess.source_map().span_to_snippet(tail_span);
    let comma_hi_offset: number | undefined;
    if (snippet_r.$ === "Ok") {
      const snippet = snippet_r._0;
      const trimmed = str_trim_start(snippet);
      comma_hi_offset = trimmed.starts_with(",") ? snippet.len() - trimmed.len() + 1 : undefined;
    } else {
      comma_hi_offset = undefined;
    }
    err.span_suggestion_verbose(
      comma_hi_offset !== undefined
        ? Span.shrink_to_hi(Span.with_hi(tail_span, (Span.lo(tail_span) + comma_hi_offset) as BytePos))
        : Span.shrink_to_hi(field.span),
      "ignore the inaccessible and unused fields",
      comma_hi_offset !== undefined ? " .." : ", ..",
      "MachineApplicable",
    );
  } else {
    let qpath_span: Span;
    if (pat.kind.$ === "Struct") {
      qpath_span = hir.QPath.span(pat.kind._0);
    } else {
      return bug("`error_no_accessible_fields` called on non-struct pattern");
    }

    // Shrink the span to exclude the `foo:Foo` in `foo::Foo { }`.
    const span = Span.with_lo(pat.span, Span.hi(Span.shrink_to_hi(qpath_span)));
    err.span_suggestion_verbose(span, "ignore the inaccessible and unused fields", " { .. }", "MachineApplicable");
  }
  return err;
};

/// Report that a pattern for a `#[non_exhaustive]` struct marked with `non_exhaustive_omitted_patterns`
/// is not exhaustive enough.
///
/// Nb: the partner lint for enums lives in `compiler/rustc_mir_build/src/thir/pattern/usefulness.rs`.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:2559 lint_non_exhaustive_omitted_patterns
FnCtxt.prototype.lint_non_exhaustive_omitted_patterns = function (this: FnCtxt, pat: hir.Pat, unmentioned_fields: readonly [FieldDef, Ident][], ty: Ty): void {
  // struct FieldsNotListed<'a, 'b, 'tcx> { pat_span, unmentioned_fields, joined_patterns, ty }
  // impl<'a, 'b, 'c, 'tcx> Diagnostic<'a> for FieldsNotListed<'b, 'c, 'tcx>
  const FieldsNotListed = (self_: { pat_span: Span; unmentioned_fields: readonly [FieldDef, Ident][]; joined_patterns: string; ty: Ty }): Diagnostic => ({
    // rustc: compiler/rustc_hir_typeck/src/pat.rs:2573 into_diag
    into_diag(dcx: DiagCtxtHandle, level: Level): Diag {
      const { pat_span, unmentioned_fields, joined_patterns, ty } = self_;
      return Diag.new(dcx, level, "some fields are not explicitly listed")
        .with_span_label(pat_span, `field${pluralize(unmentioned_fields.length)} ${joined_patterns} not listed`)
        .with_help("ensure that all fields are mentioned explicitly by adding the suggested fields")
        .with_note(`the pattern is of type \`${display_Ty(ty)}\` and the \`non_exhaustive_omitted_patterns\` attribute was found`);
    },
  });

  // rustc: compiler/rustc_hir_typeck/src/pat.rs:2586 joined_uncovered_patterns
  function joined_uncovered_patterns(witnesses: readonly Ident[]): string {
    const LIMIT = 3;
    if (witnesses.length === 0) {
      return unreachable("expected an uncovered pattern, otherwise why are we emitting an error?");
    } else if (witnesses.length === 1) {
      return `\`${display_Ident(witnesses[0]!)}\``;
    } else if (witnesses.length - 1 < LIMIT) {
      const head_ = witnesses.slice(0, witnesses.length - 1);
      const tail = witnesses[witnesses.length - 1]!;
      const head = head_.map(display_Ident);
      return `\`${head.join("`, `")}\` and \`${display_Ident(tail)}\``;
    } else {
      const head_ = witnesses.slice(0, LIMIT);
      const tail = witnesses.slice(LIMIT);
      const head = head_.map(display_Ident);
      return `\`${head.join("`, `")}\` and ${tail.length} more`;
    }
  }
  const joined_patterns = joined_uncovered_patterns(unmentioned_fields.map(([, i]) => i));

  this.tcx.emit_node_span_lint(
    NON_EXHAUSTIVE_OMITTED_PATTERNS,
    pat.hir_id,
    pat.span,
    FieldsNotListed({ pat_span: pat.span, unmentioned_fields, joined_patterns, ty }),
  );
};

/// Returns a diagnostic reporting a struct pattern which does not mention some fields.
///
/// ```text
/// error[E0027]: pattern does not mention field `bar`
///   --> src/main.rs:15:9
///    |
/// LL |     let foo::Foo {} = foo::Foo::new();
///    |         ^^^^^^^^^^^ missing field `bar`
/// ```
// rustc: compiler/rustc_hir_typeck/src/pat.rs:2627 error_unmentioned_fields
FnCtxt.prototype.error_unmentioned_fields = function (
  this: FnCtxt,
  pat: hir.Pat,
  unmentioned_fields: readonly [FieldDef, Ident][],
  have_inaccessible_fields: boolean,
  fields: readonly hir.PatField[],
): Diag {
  const inaccessible = have_inaccessible_fields ? " and inaccessible fields" : "";
  let field_names: string;
  if (unmentioned_fields.length === 1) {
    const field = unmentioned_fields[0]![1];
    field_names = `field \`${display_Ident(field)}\`${inaccessible}`;
  } else {
    const fields = unmentioned_fields.map(([, name]) => `\`${display_Ident(name)}\``).join(", ");
    field_names = `fields ${fields}${inaccessible}`;
  }
  const err = struct_span_code_err(this.dcx(), pat.span, E0027, `pattern does not mention ${field_names}`);
  err.span_label(pat.span, `missing ${field_names}`);
  const len = unmentioned_fields.length;
  let prefix: string;
  let postfix: string;
  let sp: Span;
  if (fields.length === 0) {
    if (pat.kind.$ === "Struct" && pat.kind._1.length === 0 && pat.kind._2 === undefined) {
      const path = pat.kind._0;
      [prefix, postfix, sp] = [" { ", " }", Span.until(Span.shrink_to_hi(hir.QPath.span(path)), Span.shrink_to_hi(pat.span))];
    } else {
      return err;
    }
  } else {
    const field = fields[fields.length - 1]!;
    // Account for last field having a trailing comma or parse recovery at the tail of
    // the pattern to avoid invalid suggestion (#78511).
    const tail = Span.with_hi(Span.shrink_to_hi(field.span), Span.hi(pat.span));
    if (pat.kind.$ === "Struct") {
      [prefix, postfix, sp] = [", ", " }", tail];
    } else {
      return err;
    }
  }
  err.span_suggestion_verbose(
    sp,
    `include the missing field${pluralize(len)} in the pattern${have_inaccessible_fields ? " and ignore the inaccessible fields" : ""}`,
    `${prefix}${unmentioned_fields
      .map(([, name]) => {
        const field_name = display_Ident(name);
        return is_number(field_name) ? `${field_name}: _` : field_name;
      })
      .join(", ")}${have_inaccessible_fields ? ", .." : ""}${postfix}`,
    "MachineApplicable",
  );
  err.span_suggestion_verbose(
    sp,
    `if you don't care about ${pluralize("this", len)} missing field${pluralize(len)}, you can explicitly ignore ${len === 1 ? "it" : "them"}`,
    `${prefix}${unmentioned_fields
      .map(([, name]) => {
        const field_name = display_Ident(name);
        return `${field_name}: _`;
      })
      .join(", ")}${have_inaccessible_fields ? ", .." : ""}${postfix}`,
    "MachineApplicable",
  );
  err.span_suggestion_verbose(sp, "or always ignore missing fields here", `${prefix}..${postfix}`, "MachineApplicable");
  return err;
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:2727 check_pat_deref
FnCtxt.prototype.check_pat_deref = function (this: FnCtxt, span: Span, inner: hir.Pat, expected: Ty, pat_info: PatInfo): Ty {
  const target_ty = this.deref_pat_target(span, expected);
  this.check_pat(inner, target_ty, pat_info);
  this.register_deref_mut_bounds_if_needed(span, inner, [expected]);
  return expected;
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:2740 deref_pat_target
FnCtxt.prototype.deref_pat_target = function (this: FnCtxt, span: Span, source_ty: Ty): Ty {
  // Register a `DerefPure` bound, which is required by all `deref!()` pats.
  const tcx = this.tcx;
  this.register_bound(source_ty, tcx.require_lang_item("DerefPure" satisfies LangItem, span), this.misc(span));
  // The expected type for the deref pat's inner pattern is `<expected as Deref>::Target`.
  const target_ty_ = Ty.new_projection(tcx, "No", tcx.require_lang_item("DerefTarget" satisfies LangItem, span), [source_ty]);
  const target_ty = this.normalize(span, Unnormalized.new_wip(target_ty_), fold_Ty);
  return this.deeply_resolve_ignoring_regions_with_obligations(target_ty, fold_Ty);
};

/// Check if the interior of a deref pattern (either explicit or implicit) has any `ref mut`
/// bindings, which would require `DerefMut` to be emitted in MIR building instead of just
/// `Deref`. We do this *after* checking the inner pattern, since we want to make sure to
/// account for `ref mut` binding modes inherited from implicitly dereferencing `&mut` refs.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:2763 register_deref_mut_bounds_if_needed
FnCtxt.prototype.register_deref_mut_bounds_if_needed = function (this: FnCtxt, span: Span, inner: hir.Pat, derefed_tys: Iterable<Ty>): void {
  if (this.typeck_results.pat_has_ref_mut_binding(inner)) {
    for (const mutably_derefed_ty of derefed_tys) {
      this.register_bound(mutably_derefed_ty, this.tcx.require_lang_item("DerefMut" satisfies LangItem, span), this.misc(span));
    }
  }
};

// Precondition: Pat is Ref(inner)
// rustc: compiler/rustc_hir_typeck/src/pat.rs:2781 check_pat_ref
FnCtxt.prototype.check_pat_ref = function (
  this: FnCtxt,
  pat: hir.Pat,
  inner: hir.Pat,
  pat_pinned: Pinnedness,
  pat_mutbl: Mutability,
  expected: Ty,
  pat_info_: PatInfo,
): Ty {
  // PORT: `mut pat_info` is a by-value copy (see the PORT note at the top of this region).
  const pat_info = clone_PatInfo(pat_info_);
  const tcx = this.tcx;

  const pat_prefix_span_ = Span.find_ancestor_inside(inner.span, pat.span);
  const pat_prefix_span = pat_prefix_span_ === undefined ? undefined : Span.until(pat.span, pat_prefix_span_);

  const ref_pat_matches_mut_ref = this.ref_pat_matches_mut_ref();
  if (ref_pat_matches_mut_ref && pat_mutbl === "Not") {
    // If `&` patterns can match against mutable reference types (RFC 3627, Rule 5), we need
    // to prevent subpatterns from binding with `ref mut`. Subpatterns of a shared reference
    // pattern should have read-only access to the scrutinee, and the borrow checker won't
    // catch it in this case.
    pat_info.max_ref_mutbl = MutblCap.cap_to_weakly_not(pat_info.max_ref_mutbl, pat_prefix_span);
  }

  expected = this.deeply_resolve_ignoring_regions_with_obligations(expected, fold_Ty);
  // Determine whether we're consuming an inherited reference and resetting the default
  // binding mode, based on edition and enabled experimental features.
  const binding_mode = pat_info.binding_mode;
  if (binding_mode.$ === "Yes" && pat_pinned === binding_mode._0) {
    const inh_mut = binding_mode._1;
    const rule: InheritedRefMatchRule = this.ref_pat_matches_inherited_ref(Span.edition(pat.span));
    if (rule.$ === "EatOuter") {
      // ref pattern attempts to consume inherited reference
      if (Mutability_cmp(pat_mutbl, inh_mut) > 0) {
        // Tried to match inherited `ref` with `&mut`
        // NB: This assumes that `&` patterns can match against mutable references
        // (RFC 3627, Rule 5). If we implement a pattern typing ruleset with Rule 4E
        // but not Rule 5, we'll need to check that here.
        // debug_assert!(ref_pat_matches_mut_ref);
        this.error_inherited_ref_mutability_mismatch(pat, pat_prefix_span);
      }

      pat_info.binding_mode = ByRef.No;
      this.typeck_results.skipped_ref_pats_mut().insert(pat.hir_id);
      this.check_pat(inner, expected, pat_info);
      return expected;
    } else if (rule.$ === "EatInner") {
      const ek = expected.kind();
      if (ek.$ === "Ref" && Mutability_cmp(pat_mutbl, ek._2) <= 0) {
        const r_mutbl = ek._2;
        // Match against the reference type; don't consume the inherited ref.
        // NB: The check for compatible pattern and ref type mutability assumes that
        // `&` patterns can match against mutable references (RFC 3627, Rule 5). If
        // we implement a pattern typing ruleset with Rule 4 (including the fallback
        // to matching the inherited ref when the inner ref can't match) but not
        // Rule 5, we'll need to check that here.
        // debug_assert!(ref_pat_matches_mut_ref);
        // NB: For RFC 3627's Rule 3, we limit the default binding mode's ref
        // mutability to `pat_info.max_ref_mutbl`. If we implement a pattern typing
        // ruleset with Rule 4 but not Rule 3, we'll need to check that here.
        // debug_assert!(self.downgrade_mut_inside_shared());
        const cap = MutblCap.as_mutbl(pat_info.max_ref_mutbl);
        // cmp::min(r_mutbl, cap) (derived `Ord`)
        const mutbl_cap = Mutability_cmp(cap, r_mutbl) < 0 ? cap : r_mutbl;
        pat_info.binding_mode = ByRef.cap_ref_mutability(pat_info.binding_mode, mutbl_cap);
      } else {
        // The reference pattern can't match against the expected type, so try
        // matching against the inherited ref instead.
        if (Mutability_cmp(pat_mutbl, inh_mut) > 0) {
          // We can't match an inherited shared reference with `&mut`.
          // NB: This assumes that `&` patterns can match against mutable
          // references (RFC 3627, Rule 5). If we implement a pattern typing
          // ruleset with Rule 4 but not Rule 5, we'll need to check that here.
          // FIXME(ref_pat_eat_one_layer_2024_structural): If we already tried
          // matching the real reference, the error message should explain that
          // falling back to the inherited reference didn't work. This should be
          // the same error as the old-Edition version below.
          // debug_assert!(ref_pat_matches_mut_ref);
          this.error_inherited_ref_mutability_mismatch(pat, pat_prefix_span);
        }

        pat_info.binding_mode = ByRef.No;
        this.typeck_results.skipped_ref_pats_mut().insert(pat.hir_id);
        this.check_pat(inner, expected, pat_info);
        return expected;
      }
    } else if (rule.$ === "EatBoth" && rule.consider_inherited_ref) {
      // Reset binding mode on old editions
      pat_info.binding_mode = ByRef.No;

      const ek = expected.kind();
      if (ek.$ === "Ref") {
        const inner_ty = ek._1;
        // Consume both the inherited and inner references.
        if (pat_mutbl === "Mut" && inh_mut === "Mut") {
          // As a special case, a `&mut` reference pattern will be able to match
          // against a reference type of any mutability if the inherited ref is
          // mutable. Since this allows us to match against a shared reference
          // type, we refer to this as "falling back" to matching the inherited
          // reference, though we consume the real reference as well. We handle
          // this here to avoid adding this case to the common logic below.
          this.check_pat(inner, inner_ty, pat_info);
          return expected;
        } else {
          // Otherwise, use the common logic below for matching the inner
          // reference type.
          // FIXME(ref_pat_eat_one_layer_2024_structural): If this results in a
          // mutability mismatch, the error message should explain that falling
          // back to the inherited reference didn't work. This should be the same
          // error as the Edition 2024 version above.
        }
      } else {
        // The expected type isn't a reference type, so only match against the
        // inherited reference.
        if (Mutability_cmp(pat_mutbl, inh_mut) > 0) {
          // We can't match a lone inherited shared reference with `&mut`.
          this.error_inherited_ref_mutability_mismatch(pat, pat_prefix_span);
        }

        this.typeck_results.skipped_ref_pats_mut().insert(pat.hir_id);
        this.check_pat(inner, expected, pat_info);
        return expected;
      }
    } else {
      // InheritedRefMatchRule::EatBoth { consider_inherited_ref: false }
      // Reset binding mode on stable Rust. This will be a type error below if
      // `expected` is not a reference type.
      pat_info.binding_mode = ByRef.No;
      this.add_rust_2024_migration_desugared_pat(
        pat_info.top_info.hir_id,
        pat,
        pat_mutbl === "Not"
          ? ch("&") // last char of `&`
          : ch("t"), // last char of `&mut`
        inh_mut,
      );
    }
  }

  let ref_ty: Ty;
  let inner_ty: Ty;
  const deref_r = this.check_dereferenceable(pat.span, expected, inner);
  if (deref_r.$ === "Ok") {
    // `demand::subtype` would be good enough, but using `eqtype` turns
    // out to be equally general. See (note_1) for details.

    // Take region, inner-type from expected type if we can,
    // to avoid creating needless variables. This also helps with
    // the bad interactions of the given hack detailed in (note_1).
    // debug!("check_pat_ref: expected={:?}", expected);
    const m = expected.maybe_pinned_ref();
    if (
      m !== undefined &&
      ((ref_pat_matches_mut_ref && Mutability_cmp(m[2], pat_mutbl) >= 0) || m[2] === pat_mutbl) &&
      pat_pinned === m[1]
    ) {
      const [r_ty, r_pinned, r_mutbl] = m;
      if (r_mutbl === "Not") {
        pat_info.max_ref_mutbl = MutblCap.Not;
      }
      if (r_pinned === "Pinned") {
        pat_info.max_pinnedness = "Pinned";
      }

      [ref_ty, inner_ty] = [expected, r_ty];
    } else {
      const inner_ty_ = this.next_ty_var(inner.span);
      const ref_ty_ = this.new_ref_ty(pat.span, pat_pinned, pat_mutbl, inner_ty_);
      // debug!("check_pat_ref: demanding {:?} = {:?}", expected, ref_ty);
      const err = this.demand_eqtype_pat_diag(pat.span, expected, ref_ty_, pat_info.top_info);

      // Look for a case like `fn foo(&foo: u32)` and suggest
      // `fn foo(foo: &u32)`
      if (err.$ === "Err") {
        const e = err._0;
        this.borrow_pat_suggestion(e, pat);
        e.emit();
      }
      [ref_ty, inner_ty] = [ref_ty_, inner_ty_];
    }
  } else {
    const guar = deref_r._0;
    const err = Ty.new_error(tcx, guar);
    [ref_ty, inner_ty] = [err, err];
  }

  this.check_pat(inner, inner_ty, pat_info);
  return ref_ty;
};

/// Create a reference or pinned reference type with a fresh region variable.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:2975 new_ref_ty
FnCtxt.prototype.new_ref_ty = function (this: FnCtxt, span: Span, pinnedness: Pinnedness, mutbl: Mutability, ty: Ty): Ty {
  const region = this.next_region_var({ $: "PatternRegion", _0: span });
  const ref_ty = Ty.new_ref(this.tcx, region, ty, mutbl);
  if (Pinnedness.is_pinned(pinnedness)) {
    return this.new_pinned_ty(span, ref_ty);
  }
  return ref_ty;
};

/// Create a pinned type.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:2991 new_pinned_ty
FnCtxt.prototype.new_pinned_ty = function (this: FnCtxt, span: Span, ty: Ty): Ty {
  return Ty.new_adt(this.tcx, this.tcx.adt_def(this.tcx.require_lang_item("Pin" satisfies LangItem, span)) as AdtDef, this.tcx.mk_args([ty]));
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:2999 error_inherited_ref_mutability_mismatch
FnCtxt.prototype.error_inherited_ref_mutability_mismatch = function (this: FnCtxt, pat: hir.Pat, pat_prefix_span: Span | undefined): ErrorGuaranteed {
  const err_msg = "mismatched types";
  let err: Diag;
  if (pat_prefix_span !== undefined) {
    const span = pat_prefix_span;
    const err_ = this.dcx().struct_span_err(span, err_msg);
    err_.code(E0308);
    err_.note("cannot match inherited `&` with `&mut` pattern");
    err_.span_suggestion_verbose(span, "replace this `&mut` pattern with `&`", "&", "MachineApplicable");
    err = err_;
  } else {
    err = this.dcx().struct_span_err(pat.span, err_msg);
  }
  return err.emit_err();
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:3022 try_resolve_slice_ty_to_array_ty
FnCtxt.prototype.try_resolve_slice_ty_to_array_ty = function (this: FnCtxt, before: readonly hir.Pat[], slice: hir.Pat | undefined, span: Span): Ty | undefined {
  if (slice !== undefined) {
    return undefined;
  }

  const tcx = this.tcx;
  const len = before.length;
  const inner_ty = this.next_ty_var(span);

  return Ty.new_array(tcx, inner_ty, len);
};

/// Used to determines whether we can infer the expected type in the slice pattern to be of type array.
/// This is only possible if we're in an irrefutable pattern. If we were to allow this in refutable
/// patterns we wouldn't e.g. report ambiguity in the following situation:
///
/// ```ignore(rust)
/// struct Zeroes;
///    const ARR: [usize; 2] = [0; 2];
///    const ARR2: [usize; 2] = [2; 2];
///
///    impl Into<&'static [usize; 2]> for Zeroes {
///        fn into(self) -> &'static [usize; 2] {
///            &ARR
///        }
///    }
///
///    impl Into<&'static [usize]> for Zeroes {
///        fn into(self) -> &'static [usize] {
///            &ARR2
///        }
///    }
///
///    fn main() {
///        let &[a, b]: &[usize] = Zeroes.into() else {
///           ..
///        };
///    }
/// ```
///
/// If we're in an irrefutable pattern we prefer the array impl candidate given that
/// the slice impl candidate would be rejected anyway (if no ambiguity existed).
// rustc: compiler/rustc_hir_typeck/src/pat.rs:3069 pat_is_irrefutable
FnCtxt.prototype.pat_is_irrefutable = function (this: FnCtxt, decl_origin: DeclOrigin | undefined): boolean {
  if (decl_origin !== undefined && decl_origin.$ === "LocalDecl" && decl_origin.els === undefined) {
    return true;
  }
  // Some(DeclOrigin::LocalDecl { els: Some(_) } | DeclOrigin::LetExpr) | None
  return false;
};

/// Type check a slice pattern.
///
/// Syntactically, these look like `[pat_0, ..., pat_n]`.
/// Semantically, we are type checking a pattern with structure:
/// ```ignore (not-rust)
/// [before_0, ..., before_n, (slice, after_0, ... after_n)?]
/// ```
/// The type of `slice`, if it is present, depends on the `expected` type.
/// If `slice` is missing, then so is `after_i`.
/// If `slice` is present, it can still represent 0 elements.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:3086 check_pat_slice
FnCtxt.prototype.check_pat_slice = function (
  this: FnCtxt,
  span: Span,
  before: readonly hir.Pat[],
  slice: hir.Pat | undefined,
  after: readonly hir.Pat[],
  expected_: Ty,
  pat_info: PatInfo,
): Ty {
  const expected0 = this.deeply_resolve_ignoring_regions_with_obligations(expected_, fold_Ty);

  // If the pattern is irrefutable and `expected` is an infer ty, we try to equate it
  // to an array if the given pattern allows it. See issue #76342
  if (this.pat_is_irrefutable(pat_info.decl_origin) && expected0.is_ty_var()) {
    const resolved_arr_ty = this.try_resolve_slice_ty_to_array_ty(before, slice, span);
    if (resolved_arr_ty !== undefined) {
      // debug!(?resolved_arr_ty);
      this.demand_eqtype(span, expected0, resolved_arr_ty);
    }
  }

  const expected = this.structurally_resolve_type(span, expected0);
  // debug!(?expected);

  let element_ty: Ty;
  let opt_slice_ty: Ty | undefined;
  let inferred: Ty;
  const k = expected.kind();
  if (k.$ === "Array") {
    // An array, so we might have something like `let [a, b, c] = [0, 1, 2];`.
    const element_ty_ = k._0;
    const len = k._1;
    const min = before.length + after.length;
    const [opt_slice_ty_, expected_] = this.check_array_pat_len(span, element_ty_, expected, slice, len, min);
    // `opt_slice_ty.is_none()` => `slice.is_none()`.
    // Note, though, that opt_slice_ty could be `Some(error_ty)`.
    assert(opt_slice_ty_ !== undefined || slice === undefined, "assertion failed: opt_slice_ty.is_some() || slice.is_none()");
    [element_ty, opt_slice_ty, inferred] = [element_ty_, opt_slice_ty_, expected_];
  } else if (k.$ === "Slice") {
    [element_ty, opt_slice_ty, inferred] = [k._0, expected, expected];
  } else {
    // The expected type must be an array or slice, but was neither, so error.
    const r = TypeVisitableExt.error_reported(expected, fold_Ty);
    const guar = r.$ === "Err" ? r._0 : this.error_expected_array_or_slice(span, expected, pat_info);
    const err = Ty.new_error(this.tcx, guar);
    [element_ty, opt_slice_ty, inferred] = [err, err, err];
  }

  // Type check all the patterns before `slice`.
  for (const elt of before) {
    this.check_pat(elt, element_ty, pat_info);
  }
  // Type check the `slice`, if present, against its expected type.
  if (slice !== undefined) {
    this.check_pat(slice, unwrap(opt_slice_ty), pat_info);
  }
  // Type check the elements after `slice`, if present.
  for (const elt of after) {
    this.check_pat(elt, element_ty, pat_info);
  }
  return inferred;
};

/// Type check the length of an array pattern.
///
/// Returns both the type of the variable length pattern (or `None`), and the potentially
/// inferred array type. We only return `None` for the slice type if `slice.is_none()`.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:3152 check_array_pat_len
FnCtxt.prototype.check_array_pat_len = function (
  this: FnCtxt,
  span: Span,
  element_ty: Ty,
  arr_ty: Ty,
  slice: hir.Pat | undefined,
  len_: Const,
  min_len: number,
): [Ty | undefined, Ty] {
  const len = this.try_structurally_resolve_const(span, len_).try_to_target_usize(this.tcx);

  let guar: ErrorGuaranteed;
  if (len !== undefined) {
    // Now we know the length...
    if (slice === undefined) {
      // ...and since there is no variable-length pattern,
      // we require an exact match between the number of elements
      // in the array pattern and as provided by the matched type.
      if (min_len === len) {
        return [undefined, arr_ty];
      }

      guar = this.error_scrutinee_inconsistent_length(span, min_len, len);
    } else if (len >= min_len) {
      // `len.checked_sub(min_len)` is `Some(pat_len)`
      const pat_len = len - min_len;
      // The variable-length pattern was there,
      // so it has an array type with the remaining elements left as its size...
      return [Ty.new_array(this.tcx, element_ty, pat_len), arr_ty];
    } else {
      // ...however, in this case, there were no remaining elements.
      // That is, the slice pattern requires more than the array type offers.
      guar = this.error_scrutinee_with_rest_inconsistent_length(span, min_len, len);
    }
  } else if (slice === undefined) {
    // We have a pattern with a fixed length,
    // which we can use to infer the length of the array.
    const updated_arr_ty = Ty.new_array(this.tcx, element_ty, min_len);
    this.demand_eqtype(span, updated_arr_ty, arr_ty);
    return [undefined, updated_arr_ty];
  } else {
    // We have a variable-length pattern and don't know the array length.
    // This happens if we have e.g.,
    // `let [a, b, ..] = arr` where `arr: [T; N]` where `const N: usize`.
    guar = this.error_scrutinee_unfixed_length(span);
  }

  // If we get here, we must have emitted an error.
  return [Ty.new_error(this.tcx, guar), arr_ty];
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:3200 error_scrutinee_inconsistent_length
FnCtxt.prototype.error_scrutinee_inconsistent_length = function (this: FnCtxt, span: Span, min_len: number, size: number): ErrorGuaranteed {
  return struct_span_code_err(this.dcx(), span, E0527, `pattern requires ${min_len} element${pluralize(min_len)} but array has ${size}`)
    .with_span_label(span, `expected ${size} element${pluralize(size)}`)
    .emit_err();
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:3219 error_scrutinee_with_rest_inconsistent_length
FnCtxt.prototype.error_scrutinee_with_rest_inconsistent_length = function (this: FnCtxt, span: Span, min_len: number, size: number): ErrorGuaranteed {
  return struct_span_code_err(this.dcx(), span, E0528, `pattern requires at least ${min_len} element${pluralize(min_len)} but array has ${size}`)
    .with_span_label(span, `pattern cannot match array of ${size} element${pluralize(size)}`)
    .emit_err();
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:3241 error_scrutinee_unfixed_length
FnCtxt.prototype.error_scrutinee_unfixed_length = function (this: FnCtxt, span: Span): ErrorGuaranteed {
  return struct_span_code_err(this.dcx(), span, E0730, "cannot pattern-match on an array without a fixed length").emit_err();
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:3251 error_expected_array_or_slice
FnCtxt.prototype.error_expected_array_or_slice = function (this: FnCtxt, span: Span, expected_ty: Ty, pat_info: PatInfo): ErrorGuaranteed {
  const { top_info: ti, current_depth } = pat_info;

  let slice_pat_semantics = false;
  let as_deref: AsDerefSuggestion | undefined = undefined;
  let slicing: SlicingSuggestion | undefined = undefined;
  const ek = expected_ty.kind();
  const ref_inner = ek.$ === "Ref" ? ek._1.kind() : undefined;
  if (ref_inner !== undefined && (ref_inner.$ === "Array" || ref_inner.$ === "Slice")) {
    slice_pat_semantics = true;
  } else {
    let any = false;
    for (const [ty] of this.autoderef(span, expected_ty).silence_errors()) {
      const tk = ty.kind();
      if (tk.$ === "Slice" || tk.$ === "Array") {
        any = true;
        break;
      }
    }
    const ti_span = ti.span;
    if (any && ti_span !== undefined && ti.origin_expr !== undefined) {
      const span = ti_span;
      const resolved_ty_ = this.deeply_resolve_ignoring_regions(ti.expected, fold_Ty);
      const [is_slice_or_array_or_vector, resolved_ty] = this.is_slice_or_array_or_vector(resolved_ty_);
      const rk = resolved_ty.kind();
      if (rk.$ === "Adt" && (this.tcx.is_diagnostic_item(sym.Option, rk._0.did()) || this.tcx.is_diagnostic_item(sym.Result, rk._0.did()))) {
        // Slicing won't work here, but `.as_deref()` might (issue #91328).
        as_deref = { span: Span.shrink_to_hi(span) };
      }

      const is_top_level = current_depth <= 1;
      if (is_slice_or_array_or_vector && is_top_level) {
        slicing = { span: Span.shrink_to_hi(span) };
      }
    }
  }
  return this.dcx().emit_err(
    ExpectedArrayOrSlice_diagnostic({
      span,
      ty: expected_ty,
      slice_pat_semantics,
      as_deref,
      slicing,
    }),
  );
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:3301 is_slice_or_array_or_vector
FnCtxt.prototype.is_slice_or_array_or_vector = function (this: FnCtxt, ty: Ty): [boolean, Ty] {
  const k = ty.kind();
  if (k.$ === "Adt" && this.tcx.is_diagnostic_item(sym.Vec, k._0.did())) {
    return [true, ty];
  } else if (k.$ === "Ref") {
    return this.is_slice_or_array_or_vector(k._1);
  } else if (k.$ === "Slice" || k.$ === "Array") {
    return [true, ty];
  } else {
    return [false, ty];
  }
};

/// Record a pattern that's invalid under Rust 2024 match ergonomics, along with a problematic
/// span, so that the pattern migration lint can desugar it during THIR construction.
// rustc: compiler/rustc_hir_typeck/src/pat.rs:3314 add_rust_2024_migration_desugared_pat
FnCtxt.prototype.add_rust_2024_migration_desugared_pat = function (this: FnCtxt, pat_id: HirId, subpat: hir.Pat, final_char: number, def_br_mutbl: Mutability): void {
  // Try to trim the span we're labeling to just the `&` or binding mode that's an issue.
  const from_expansion = Span.from_expansion(subpat.span);
  let trimmed_span: Span;
  if (from_expansion) {
    // If the subpattern is from an expansion, highlight the whole macro call instead.
    trimmed_span = subpat.span;
  } else {
    const trimmed = this.tcx.sess.source_map().span_through_char(subpat.span, final_char);
    // The edition of the trimmed span should be the same as `subpat.span`; this will be a
    // a hard error if the subpattern is of edition >= 2024. We set it manually to be sure:
    trimmed_span = Span.with_ctxt(trimmed, Span.ctxt(subpat.span));
  }

  const typeck_results = this.typeck_results;
  const table = typeck_results.rust_2024_migration_desugared_pats_mut();
  // FIXME(ref_pat_eat_one_layer_2024): The migration diagnostic doesn't know how to track the
  // default binding mode in the presence of Rule 3 or Rule 5. As a consequence, the labels it
  // gives for default binding modes are wrong, as well as suggestions based on the default
  // binding mode. This keeps it from making those suggestions, as doing so could panic.
  const info: Rust2024IncompatiblePatInfo = table.entry(pat_id).or_insert_with(
    (): Rust2024IncompatiblePatInfo => ({
      primary_labels: [],
      bad_ref_modifiers: false,
      bad_mut_modifiers: false,
      bad_ref_pats: false,
      suggest_eliding_modes: !this.tcx.features().ref_pat_eat_one_layer_2024() && !this.tcx.features().ref_pat_eat_one_layer_2024_structural(),
    }),
  ).value;

  let pat_kind: string;
  if (subpat.kind.$ === "Binding") {
    const user_bind_annot = subpat.kind._0;
    // If the user-provided binding modifier doesn't match the default binding mode, we'll
    // need to suggest reference patterns, which can affect other bindings.
    // For simplicity, we opt to suggest making the pattern fully explicit.
    info.suggest_eliding_modes =
      info.suggest_eliding_modes && user_bind_annot._0.$ === "Yes" && user_bind_annot._1 === "Not" && user_bind_annot._0._1 === def_br_mutbl;
    if (BindingMode_eq(user_bind_annot, new BindingMode(ByRef.No, "Mut"))) {
      info.bad_mut_modifiers = true;
      pat_kind = "`mut` binding modifier";
    } else {
      info.bad_ref_modifiers = true;
      switch (user_bind_annot._1) {
        case "Not":
          pat_kind = "explicit `ref` binding modifier";
          break;
        case "Mut":
          pat_kind = "explicit `ref mut` binding modifier";
          break;
      }
    }
  } else {
    info.bad_ref_pats = true;
    // For simplicity, we don't try to suggest eliding reference patterns. Thus, we'll
    // suggest adding them instead, which can affect the types assigned to bindings.
    // As such, we opt to suggest making the pattern fully explicit.
    info.suggest_eliding_modes = false;
    pat_kind = "reference pattern";
  }
  // Only provide a detailed label if the problematic subpattern isn't from an expansion.
  // In the case that it's from a macro, we'll add a more detailed note in the emitter.
  let primary_label: string;
  if (from_expansion) {
    // We can't suggest eliding modifiers within expansions.
    info.suggest_eliding_modes = false;
    // NB: This wording assumes the only expansions that can produce problematic reference
    // patterns and bindings are macros. If a desugaring or AST pass is added that can do
    // so, we may want to inspect the span's source callee or macro backtrace.
    primary_label = "occurs within macro expansion";
  } else {
    primary_label = `${pat_kind} not allowed when implicitly borrowing`;
  }
  info.primary_labels.push([trimmed_span, primary_label]);
};

// rustc: compiler/rustc_hir_typeck/src/pat.rs:49 is_number
export function is_number(text: string): boolean {
  for (const c of text) {
    if (!is_ascii_digit(c.codePointAt(0) as number)) return false;
  }
  return true;
}
