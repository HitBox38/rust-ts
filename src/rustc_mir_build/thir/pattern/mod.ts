// Port of compiler/rustc_mir_build/src/thir/pattern/mod.rs (lanes thir-cx-print: stub; thir-pattern: port).
//! Validation of patterns/matches.
//
// PORT: `impl PatCtxt` is split over this file and const_to_pat.rs; const_to_pat.ts puts `const_to_pat` on the
// prototype (PORTING §5) and is loaded by the crate root (lib.ts) after this module. Init order: cx/mod.ts imports this
// module for `pat_from_hir` (a value read inside a function body only), so this module must not read cx/ values at
// load time; it imports cx types only.
import { Integer } from "../../../rustc_abi/lib.ts";
import { IntegerExt } from "../../../rustc_middle/ty/layout.ts";
import type { IntTy, UintTy } from "../../../rustc_ast_ir/lib.ts";
import { E0030 } from "../../../rustc_errors/lib.ts";
import { DefKind, type Res } from "../../../rustc_hir/def.ts";
import {
  debug_PatExpr as debug_HirPatExpr,
  debug_PatKind as debug_HirPatKind,
  type DotDotPos,
  type Pat as HirPat,
  type PatExpr as HirPatExpr,
  type QPath,
  type RangeEnd,
  type Ty as HirTy,
} from "../../../rustc_hir/hir.ts";
import { enumerate_and_adjust } from "../../../rustc_hir/pat_util.ts";
import { type HirId, HirId_eq } from "../../../rustc_hir_id/lib.ts";
import {
  type Ascription,
  type DerefPatBorrowMode,
  type FieldPat,
  Pat,
  type PatExtra,
  type PatKind,
  PatRange,
  PatRangeBoundary,
} from "../../../rustc_middle/thir.ts";
import type { PatAdjustment } from "../../../rustc_middle/ty/adjustment.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { AdtDef, TypeckResults, Value } from "../../../rustc_middle/ty/decls.ts";
import { fold_GenericArgs, type GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import { const_lit_matches_ty, type LitToConstInput } from "../../../rustc_middle/ty/consts/lit.ts";
import type { CanonicalUserType, CanonicalUserTypeAnnotation } from "../../../rustc_middle/ty/typeck_results.ts";
import { debug_Ty, type Ty, type TypingEnv } from "../../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../../rustc_middle/ty/print/pretty.ts";
import { type ErrorGuaranteed, Span } from "../../../rustc_span/lib.ts";
import { bug, span_bug } from "../../../rustc_span/macros.ts";
import { display_Ident } from "../../../rustc_span/symbol.ts";
import { Binder } from "../../../rustc_type_ir/binder.ts";
import { AliasConst } from "../../../rustc_type_ir/const_kind.ts";
import type { AliasConstKind } from "../../../rustc_type_ir/const_kind.gen.ts";
import { Const } from "../../../rustc_type_ir/sty/consts.ts";
import { debug_option, debug_tuple, PLAIN } from "../../../std/fmt.ts";
import { assert, assert_matches, panic, unported } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import {
  ConstParamInPattern_diagnostic,
  LiteralOutOfRange_diagnostic,
  LowerRangeBoundMustBeLessThanOrEqualToUpper_diagnostic,
  LowerRangeBoundMustBeLessThanUpper_diagnostic,
  NonConstPath_diagnostic,
  StaticInPattern_diagnostic,
  UpperRangeBoundCannotBeMin_diagnostic,
} from "../../diagnostics.ts";
import type { ThirBuildCx } from "../cx/mod.ts";
import * as util from "../util.ts";
import { PatMigration } from "./migration.ts";

// mod check_match; mod const_to_pat; mod migration;
// PORT: the submodules are loaded by the crate root (lib.ts) after this module (const_to_pat.ts extends `PatCtxt`).

// pub(crate) use self::check_match::check_match;
export { check_match } from "./check_match.ts";

/// Context for lowering HIR patterns to THIR patterns.
// rustc-type: compiler/rustc_mir_build/src/thir/pattern/mod.rs:36 PatCtxt
export class PatCtxt {
  constructor(
    public upper: ThirBuildCx,
    public tcx: TyCtxt,
    public typing_env: TypingEnv,
    public typeck_results: TypeckResults,

    /// Used by the Rust 2024 migration lint.
    public rust_2024_migration: PatMigration | undefined,
  ) {}
}

/** PORT: `TypeckResults::deref_pat_borrow_mode` returns typeck_results.ts's pending `DerefPatBorrowMode`, built as
 *  thir.rs's (`{ $: "Borrow", _0 } | { $: "Box" }`, PORTING §5): the same values, typed as rustc_middle thir's. */
function deref_pat_borrow_mode(typeck_results: TypeckResults, pointer_ty: Ty, inner: HirPat): DerefPatBorrowMode {
  return typeck_results.deref_pat_borrow_mode(pointer_ty, inner) as unknown as DerefPatBorrowMode;
}

/** `thir_pat.extra.get_or_insert_default()` (`PatExtra: Default`). */
function extra_get_or_insert_default(pat: Pat): PatExtra {
  if (pat.extra === undefined) pat.extra = { expanded_const: undefined, ascriptions: [] };
  return pat.extra;
}

// #[instrument(level = "debug", skip(upper, tcx, typing_env, typeck_results), ret)]
// rustc: compiler/rustc_mir_build/src/thir/pattern/mod.rs:47 pat_from_hir
export function pat_from_hir(
  upper: ThirBuildCx,
  tcx: TyCtxt,
  typing_env: TypingEnv,
  typeck_results: TypeckResults,
  pat: HirPat,
  // Present if `pat` came from a let statement with an explicit type annotation
  let_stmt_type: HirTy | undefined,
): Pat {
  const info = typeck_results.rust_2024_migration_desugared_pats().get(pat.hir_id);
  const pcx = new PatCtxt(
    upper,
    tcx,
    typing_env,
    typeck_results,
    info === undefined ? undefined : PatMigration.new(info),
  );

  const thir_pat = pcx.lower_pattern(pat);

  // If this pattern came from a let statement with an explicit type annotation
  // (e.g. `let x: Foo = ...`), retain that user type information in the THIR pattern.
  let user_ty: CanonicalUserType | undefined;
  if (let_stmt_type !== undefined && (user_ty = typeck_results.user_provided_types().get(let_stmt_type.hir_id)) !== undefined) {
    // debug!(?user_ty);
    const annotation: CanonicalUserTypeAnnotation = {
      user_ty: user_ty,
      span: let_stmt_type.span,
      inferred_ty: typeck_results.node_type(let_stmt_type.hir_id),
    };
    extra_get_or_insert_default(thir_pat).ascriptions.push({ annotation, variance: "Covariant" });
  }

  if (pcx.rust_2024_migration !== undefined) {
    const m = pcx.rust_2024_migration;
    m.emit(tcx, pat.hir_id);
  }

  return thir_pat;
}

export interface PatCtxt {
  lower_pattern(pat: HirPat): Pat;
  lower_pattern_range_endpoint(
    pat: HirPat,
    expr: HirPatExpr | undefined,
    // Out-parameter collecting extra data to be reapplied by the caller
    ascriptions: Ascription[],
  ): Result<PatRangeBoundary | undefined, ErrorGuaranteed>;
  error_on_literal_overflow(expr: HirPatExpr | undefined, ty: Ty): Result<null, ErrorGuaranteed>;
  lower_pattern_range(pat: HirPat, lo_expr: HirPatExpr | undefined, hi_expr: HirPatExpr | undefined, end: RangeEnd): Result<Pat, ErrorGuaranteed>;
  lower_pattern_unadjusted(pat: HirPat): Pat;
  lower_tuple_subpats(pats: readonly HirPat[], expected_len: number, gap_pos: DotDotPos): FieldPat[];
  lower_patterns(pats: readonly HirPat[]): Pat[];
  lower_opt_pattern(pat: HirPat | undefined): Pat | undefined;
  slice_or_array_pattern(pat: HirPat, prefix: readonly HirPat[], slice: HirPat | undefined, suffix: readonly HirPat[]): Pat;
  lower_variant_or_leaf(pat: HirPat, expr: HirPatExpr | undefined, res: Res, subpatterns: FieldPat[]): Pat;
  user_args_applied_to_ty_of_hir_id(hir_id: HirId): CanonicalUserType | undefined;
  lower_path(pat: HirPat, expr: HirPatExpr, qpath: QPath): Pat;
  lower_pat_expr(pat: HirPat, expr: HirPatExpr): Pat;
}

// impl<'tcx, 'ptcx> PatCtxt<'tcx, 'ptcx>

// rustc: compiler/rustc_mir_build/src/thir/pattern/mod.rs:95 lower_pattern
PatCtxt.prototype.lower_pattern = function (this: PatCtxt, pat: HirPat): Pat {
  const adjustments: readonly PatAdjustment[] = this.typeck_results.pat_adjustments().get(pat.hir_id) ?? [];

  // Track the default binding mode for the Rust 2024 migration suggestion.
  // Implicitly dereferencing references changes the default binding mode, but implicit deref
  // patterns do not. Only track binding mode changes if a ref type is in the adjustments.
  let opt_old_mode_span: ReturnType<PatMigration["visit_implicit_derefs"]> = undefined;
  if (this.rust_2024_migration !== undefined && adjustments.some((adjust) => adjust.kind === "BuiltinDeref")) {
    const s = this.rust_2024_migration;
    opt_old_mode_span = s.visit_implicit_derefs(pat.span, adjustments);
  }

  // When implicit dereferences have been inserted in this pattern, the unadjusted lowered
  // pattern has the type that results *after* dereferencing. For example, in this code:
  //
  // ```
  // match &&Some(0i32) {
  //     Some(n) => { ... },
  //     _ => { ... },
  // }
  // ```
  //
  // the type assigned to `Some(n)` in `unadjusted_pat` would be `Option<i32>` (this is
  // determined in rustc_hir_analysis::check::match). The adjustments would be
  //
  // `vec![&&Option<i32>, &Option<i32>]`.
  //
  // Applying the adjustments, we want to instead output `&&Some(n)` (as a THIR pattern). So
  // we wrap the unadjusted pattern in `PatKind::Deref` repeatedly, consuming the
  // adjustments in *reverse order* (last-in-first-out, so that the last `Deref` inserted
  // gets the least-dereferenced type).
  let unadjusted_pat: Pat;
  if (pat.kind.$ === "Ref" && this.typeck_results.skipped_ref_pats().contains(pat.hir_id)) {
    const inner = pat.kind._0;
    unadjusted_pat = this.lower_pattern(inner);
  } else {
    unadjusted_pat = this.lower_pattern_unadjusted(pat);
  }

  let adjusted_pat = unadjusted_pat;
  for (let i = adjustments.length - 1; i >= 0; i--) {
    const adjust = adjustments[i]!;
    const thir_pat = adjusted_pat;
    // debug!("{:?}: wrapping pattern with adjustment {:?}", thir_pat, adjust);
    const span = thir_pat.span;
    let kind: PatKind;
    switch (adjust.kind) {
      case "BuiltinDeref":
        kind = { $: "Deref", pin: "Not", subpattern: thir_pat };
        break;
      case "OverloadedDeref": {
        const borrow = deref_pat_borrow_mode(this.typeck_results, adjust.source, pat);
        kind = { $: "DerefPattern", subpattern: thir_pat, borrow };
        break;
      }
      case "PinDeref":
        kind = { $: "Deref", pin: "Pinned", subpattern: thir_pat };
        break;
    }
    adjusted_pat = new Pat(adjust.source, span, undefined, kind);
  }

  if (this.rust_2024_migration !== undefined && adjustments.some((adjust) => adjust.kind === "BuiltinDeref")) {
    const s = this.rust_2024_migration;
    s.leave_ref(opt_old_mode_span);
  }

  return adjusted_pat;
};

// rustc: compiler/rustc_mir_build/src/thir/pattern/mod.rs:164 lower_pattern_range_endpoint
PatCtxt.prototype.lower_pattern_range_endpoint = function (
  this: PatCtxt,
  pat: HirPat, // Range pattern containing the endpoint
  expr: HirPatExpr | undefined,
  // Out-parameter collecting extra data to be reapplied by the caller
  ascriptions: Ascription[],
): Result<PatRangeBoundary | undefined, ErrorGuaranteed> {
  assert_matches(pat.kind, pat.kind.$ === "Range", "hir::PatKind::Range(..)", (k) => debug_HirPatKind(k, PLAIN));

  // For partly-bounded ranges like `X..` or `..X`, an endpoint will be absent.
  // Return None in that case; the caller will use NegInfinity or PosInfinity instead.
  if (expr === undefined) return Ok(undefined);

  // Lower the endpoint into a temporary `thir::Pat` that will then be
  // deconstructed to obtain the constant value and other data.
  const endpoint_pat: Pat = this.lower_pat_expr(pat, expr);
  const { kind, extra } = endpoint_pat;

  // Preserve any ascriptions from endpoint constants.
  if (extra !== undefined) {
    ascriptions.push(...extra.ascriptions);
  }

  // The unpeeled kind should now be a constant, giving us the endpoint value.
  if (kind.$ !== "Constant") {
    const msg = `found bad range pattern endpoint \`${debug_HirPatExpr(expr, PLAIN)}\` outside of error recovery`;
    return Err(this.tcx.dcx().span_delayed_bug(expr.span, msg));
  }
  const value = kind.value;
  return Ok({ $: "Finite", _0: value.valtree });
};

/// Overflowing literals are linted against in a late pass. This is mostly fine, except when we
/// encounter a range pattern like `-130i8..2`: if we believe `eval_bits`, this looks like a
/// range where the endpoints are in the wrong order. To avoid a confusing error message, we
/// check for overflow then.
/// This is only called when the range is already known to be malformed.
// rustc: compiler/rustc_mir_build/src/thir/pattern/mod.rs:201 error_on_literal_overflow
PatCtxt.prototype.error_on_literal_overflow = function (
  this: PatCtxt,
  expr: HirPatExpr | undefined,
  ty: Ty,
): Result<null, ErrorGuaranteed> {
  if (expr === undefined) {
    return Ok(null);
  }
  const span = expr.span;

  // We need to inspect the original expression, because if we only inspect the output of
  // `eval_bits`, an overflowed value has already been wrapped around.
  // We mostly copy the logic from the `rustc_lint::OVERFLOWING_LITERALS` lint.
  if (expr.kind.$ !== "Lit") {
    return Ok(null);
  }
  const { lit, negated } = expr.kind;
  if (lit.node.$ !== "Int") {
    return Ok(null);
  }
  const lit_val: bigint = lit.node._0;
  let min: bigint;
  let max: bigint;
  const k = ty.kind();
  switch (k.$) {
    case "Int": {
      const size = Integer.size(Integer_from_int_ty(this.tcx, k._0));
      [min, max] = [size.signed_int_min(), size.signed_int_max()];
      break;
    }
    case "Uint": {
      const size = Integer.size(Integer_from_uint_ty(this.tcx, k._0));
      [min, max] = [0n, size.unsigned_int_max()];
      break;
    }
    default: {
      return Ok(null);
    }
  }
  // Detect literal value out of range `[min, max]` inclusive, avoiding use of `-min` to
  // prevent overflow/panic.
  if ((negated && lit_val > max + 1n) || (!negated && lit_val > max)) {
    return Err(this.tcx.dcx().emit_err(LiteralOutOfRange_diagnostic({ span, ty, min, max })));
  }
  return Ok(null);
};

// rustc: compiler/rustc_mir_build/src/thir/pattern/mod.rs:241 lower_pattern_range
PatCtxt.prototype.lower_pattern_range = function (
  this: PatCtxt,
  pat: HirPat,
  lo_expr: HirPatExpr | undefined,
  hi_expr: HirPatExpr | undefined,
  end: RangeEnd,
): Result<Pat, ErrorGuaranteed> {
  const ty = this.typeck_results.node_type(pat.hir_id);
  const span = pat.span;

  if (lo_expr === undefined && hi_expr === undefined) {
    const msg = "found twice-open range pattern (`..`) outside of error recovery";
    this.tcx.dcx().span_bug(span, msg);
  }

  // Collect extra data while lowering the endpoints, to be reapplied later.
  const ascriptions: Ascription[] = [];
  const lower_endpoint = (expr: HirPatExpr | undefined) => this.lower_pattern_range_endpoint(pat, expr, ascriptions);

  const lo_r = lower_endpoint(lo_expr);
  if (lo_r.$ === "Err") return lo_r;
  const lo: PatRangeBoundary = lo_r._0 ?? PatRangeBoundary.NegInfinity;
  const hi_r = lower_endpoint(hi_expr);
  if (hi_r.$ === "Err") return hi_r;
  const hi: PatRangeBoundary = hi_r._0 ?? PatRangeBoundary.PosInfinity;

  const cmp = PatRangeBoundary.compare_with(lo, hi, ty, this.tcx);
  let kind: PatKind = { $: "Range", _0: new PatRange(lo, hi, end, ty) };
  if (end === "Excluded" && cmp === "Less") {
    // `x..y` where `x < y`.
  } else if (end === "Included" && cmp === "Less") {
    // `x..=y` where `x < y`.
  } else if (end === "Included" && cmp === "Equal" && PatRangeBoundary.is_finite(lo) && PatRangeBoundary.is_finite(hi)) {
    // `x..=y` where `x == y` and `x` and `y` are finite.
    const valtree = PatRangeBoundary.as_finite(lo);
    if (valtree === undefined) return panic("called `Option::unwrap()` on a `None` value");
    const value: Value = { ty, valtree };
    kind = { $: "Constant", value };
  } else if (end === "Included" && cmp === "Equal" && !PatRangeBoundary.is_finite(lo)) {
    // `..=x` where `x == ty::MIN`.
  } else if (end === "Included" && cmp === "Equal" && !PatRangeBoundary.is_finite(hi)) {
    // `x..` where `x == ty::MAX` (yes, `x..` gives `RangeEnd::Included` since it is meant
    // to include `ty::MAX`).
  } else {
    // `x..y` where `x >= y`, or `x..=y` where `x > y`. The range is empty => error.
    // Emit a more appropriate message if there was overflow.
    let r = this.error_on_literal_overflow(lo_expr, ty);
    if (r.$ === "Err") return r;
    r = this.error_on_literal_overflow(hi_expr, ty);
    if (r.$ === "Err") return r;
    let e: ErrorGuaranteed;
    if (end === "Included") {
      e = this.tcx.dcx().emit_err(
        LowerRangeBoundMustBeLessThanOrEqualToUpper_diagnostic({
          span,
          teach: this.tcx.sess.teach(E0030),
        }),
      );
    } else if (lo_expr === undefined) {
      e = this.tcx.dcx().emit_err(UpperRangeBoundCannotBeMin_diagnostic({ span }));
    } else {
      e = this.tcx.dcx().emit_err(LowerRangeBoundMustBeLessThanUpper_diagnostic({ span }));
    }
    return Err(e);
  }
  const thir_pat = new Pat(ty, span, undefined, kind);

  // If we are handling a range with associated constants (e.g.
  // `Foo::<'a>::A..=Foo::B`), we need to put the ascriptions for the associated
  // constants somewhere. Have them on the range pattern.
  extra_get_or_insert_default(thir_pat).ascriptions.push(...ascriptions);
  // IDs of expanded constants from range endpoints used to
  // also be preserved here, but that was only needed for unsafeck of
  // inline `const { .. }` patterns, which were removed by
  // <https://github.com/rust-lang/rust/pull/138492>.

  return Ok(thir_pat);
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_mir_build/src/thir/pattern/mod.rs:318 lower_pattern_unadjusted
PatCtxt.prototype.lower_pattern_unadjusted = function (this: PatCtxt, pat: HirPat): Pat {
  const ty = this.typeck_results.node_type(pat.hir_id);
  const span = pat.span;

  // Some of these match arms return a `Box<Pat>` early, while others
  // evaluate to a `PatKind` that will become a `Box<Pat>` at the end of
  // this function.
  let kind: PatKind;
  const pk = pat.kind;
  switch (pk.$) {
    case "Missing":
      kind = { $: "Missing" };
      break;

    case "Wild":
      kind = { $: "Wild" };
      break;

    case "Never":
      kind = { $: "Never" };
      break;

    case "Expr":
      return this.lower_pat_expr(pat, pk._0);

    case "Range": {
      const [lo_expr, hi_expr, end] = [pk._0, pk._1, pk._2];
      const r = this.lower_pattern_range(pat, lo_expr, hi_expr, end);
      if (r.$ === "Ok") return r._0;
      kind = { $: "Error", _0: r._0 };
      break;
    }

    case "Deref": {
      const subpattern = pk._0;
      const borrow = deref_pat_borrow_mode(this.typeck_results, ty, subpattern);
      kind = { $: "DerefPattern", subpattern: this.lower_pattern(subpattern), borrow };
      break;
    }
    case "Ref": {
      const [subpattern_, pin] = [pk._0, pk._1];
      // Track the default binding mode for the Rust 2024 migration suggestion.
      const opt_old_mode_span = this.rust_2024_migration?.visit_explicit_deref();
      const subpattern = this.lower_pattern(subpattern_);
      if (this.rust_2024_migration !== undefined) {
        const s = this.rust_2024_migration;
        s.leave_ref(opt_old_mode_span);
      }
      kind = { $: "Deref", pin, subpattern };
      break;
    }
    case "Slice": {
      const [prefix, slice, suffix] = [pk._0, pk._1, pk._2];
      return this.slice_or_array_pattern(pat, prefix, slice, suffix);
    }

    case "Tuple": {
      const [pats, ddpos] = [pk._0, pk._1];
      const tk = ty.kind();
      if (tk.$ !== "Tuple") {
        return span_bug(pat.span, `unexpected type for tuple pattern: ${debug_Ty(ty, PLAIN)}`);
      }
      const tys = tk._0;
      const subpatterns = this.lower_tuple_subpats(pats, tys.length, ddpos);
      kind = { $: "Leaf", subpatterns };
      break;
    }

    case "Binding": {
      const [explicit_ba, id, ident, sub] = [pk._0, pk._1, pk._2, pk._3];
      let thir_pat_span = span;
      const ident_span = Span.find_ancestor_inside(ident.span, span);
      if (ident_span !== undefined) {
        thir_pat_span = Span.with_hi(span, Span.hi(ident_span));
      }

      const mode = this.typeck_results.pat_binding_modes().get(pat.hir_id);
      if (mode === undefined) return panic("missing binding mode");

      if (this.rust_2024_migration !== undefined) {
        const s = this.rust_2024_migration;
        s.visit_binding(pat.span, mode, explicit_ba, ident);
      }

      // A ref x pattern is the same node used for x, and as such it has
      // x's type, which is &T, where we want T (the type being matched).
      const var_ty = ty;
      let thir_pat_ty = ty;
      if (mode._0.$ === "Yes") {
        const pinnedness = mode._0._0;
        let pty: Ty | undefined;
        let rk;
        if (pinnedness === "Pinned" && (pty = ty.pinned_ty()) !== undefined && (rk = pty.kind()).$ === "Ref") {
          thir_pat_ty = rk._1;
        } else if (pinnedness === "Not" && (rk = ty.kind()).$ === "Ref") {
          thir_pat_ty = rk._1;
        } else {
          return bug(`\`ref ${display_Ident(ident)}\` has wrong type ${display_Ty(ty)}`);
        }
      }

      const kind: PatKind = {
        $: "Binding",
        mode,
        name: ident.name,
        var: { _0: id },
        ty: var_ty,
        subpattern: this.lower_opt_pattern(sub),
        is_primary: HirId_eq(id, pat.hir_id),
        is_shorthand: false,
      };
      // We might have modified the type or span, so use the modified
      // values in the THIR pattern node.
      return new Pat(thir_pat_ty, thir_pat_span, undefined, kind);
    }

    case "TupleStruct": {
      const [qpath, pats, ddpos] = [pk._0, pk._1, pk._2];
      const res = this.typeck_results.qpath_res(qpath, pat.hir_id);
      const tk = ty.kind();
      if (tk.$ !== "Adt") {
        return span_bug(pat.span, `tuple struct pattern not applied to an ADT ${debug_Ty(ty, PLAIN)}`);
      }
      const adt_def = tk._0;
      const variant_def = adt_def.variant_of_res(res);
      const subpatterns = this.lower_tuple_subpats(pats, variant_def.fields.length, ddpos);
      return this.lower_variant_or_leaf(pat, undefined, res, subpatterns);
    }

    case "Struct": {
      const [qpath, fields] = [pk._0, pk._1];
      const res = this.typeck_results.qpath_res(qpath, pat.hir_id);
      const subpatterns: FieldPat[] = fields.map((field) => {
        const pattern = this.lower_pattern(field.pat);
        if (pattern.kind.$ === "Binding") {
          pattern.kind.is_shorthand = field.is_shorthand;
        }
        const field_ = this.typeck_results.field_index(field.hir_id);
        return { field: field_, pattern };
      });

      return this.lower_variant_or_leaf(pat, undefined, res, subpatterns);
    }

    case "Or":
      kind = { $: "Or", pats: this.lower_patterns(pk._0) };
      break;

    case "Guard": {
      const [pat_, condition] = [pk._0, pk._1];
      kind = {
        $: "Guard",
        subpattern: this.lower_pattern(pat_),
        condition: this.upper.mirror_expr(condition),
      };
      break;
    }

    case "Err":
      kind = { $: "Error", _0: pk._0 };
      break;
  }

  // For pattern kinds that haven't already returned, create a `thir::Pat`
  // with the HIR pattern node's type and span.
  return new Pat(ty, span, undefined, kind);
};

// rustc: compiler/rustc_mir_build/src/thir/pattern/mod.rs:458 lower_tuple_subpats
PatCtxt.prototype.lower_tuple_subpats = function (
  this: PatCtxt,
  pats: readonly HirPat[],
  expected_len: number,
  gap_pos: DotDotPos,
): FieldPat[] {
  const out: FieldPat[] = [];
  for (const [i, subpattern] of enumerate_and_adjust(pats, expected_len, gap_pos)) {
    out.push({
      field: i as FieldPat["field"],
      pattern: this.lower_pattern(subpattern),
    });
  }
  return out;
};

// rustc: compiler/rustc_mir_build/src/thir/pattern/mod.rs:473 lower_patterns
PatCtxt.prototype.lower_patterns = function (this: PatCtxt, pats: readonly HirPat[]): Pat[] {
  return pats.map((p) => this.lower_pattern(p));
};

// rustc: compiler/rustc_mir_build/src/thir/pattern/mod.rs:477 lower_opt_pattern
PatCtxt.prototype.lower_opt_pattern = function (this: PatCtxt, pat: HirPat | undefined): Pat | undefined {
  return pat === undefined ? undefined : this.lower_pattern(pat);
};

// rustc: compiler/rustc_mir_build/src/thir/pattern/mod.rs:481 slice_or_array_pattern
PatCtxt.prototype.slice_or_array_pattern = function (
  this: PatCtxt,
  pat: HirPat,
  prefix_: readonly HirPat[],
  slice_: HirPat | undefined,
  suffix_: readonly HirPat[],
): Pat {
  const ty = this.typeck_results.node_type(pat.hir_id);
  const span = pat.span;

  const prefix = this.lower_patterns(prefix_);
  const slice = this.lower_opt_pattern(slice_);
  const suffix = this.lower_patterns(suffix_);
  let kind: PatKind;
  const tk = ty.kind();
  switch (tk.$) {
    // Matching a slice, `[T]`.
    case "Slice":
      kind = { $: "Slice", prefix, slice, suffix };
      break;
    // Fixed-length array, `[T; len]`.
    case "Array": {
      const len = tk._1.try_to_target_usize(this.tcx);
      if (len === undefined) return panic("expected len of array pat to be definite");
      assert(
        len >= prefix.length + suffix.length,
        "assertion failed: len >= prefix.len() as u64 + suffix.len() as u64",
      );
      kind = { $: "Array", prefix, slice, suffix };
      break;
    }
    default:
      return span_bug(span, `bad slice pattern type ${debug_Ty(ty, PLAIN)}`);
  }
  return new Pat(ty, span, undefined, kind);
};

// rustc: compiler/rustc_mir_build/src/thir/pattern/mod.rs:510 lower_variant_or_leaf
PatCtxt.prototype.lower_variant_or_leaf = function (
  this: PatCtxt,
  pat: HirPat,
  expr: HirPatExpr | undefined,
  res: Res,
  subpatterns: FieldPat[],
): Pat {
  // Check whether the caller should have provided an `expr` for this pattern kind.
  assert_matches(
    [pat.kind, expr] as const,
    ((pat.kind.$ === "Expr" || pat.kind.$ === "Range") && expr !== undefined) ||
      ((pat.kind.$ === "Struct" || pat.kind.$ === "TupleStruct") && expr === undefined),
    "(hir::PatKind::Expr(..) | hir::PatKind::Range(..), Some(_)) |\n    (hir::PatKind::Struct(..) | hir::PatKind::TupleStruct(..), None)",
    ([k, e]) =>
      debug_tuple(PLAIN, "", [debug_HirPatKind(k, PLAIN), debug_option(e, PLAIN, debug_HirPatExpr)]),
  );

  // Use the id/span of the `hir::PatExpr`, if provided.
  // Otherwise, use the id/span of the `hir::Pat`.
  const [hir_id, span] = expr !== undefined ? [expr.hir_id, expr.span] : [pat.hir_id, pat.span];
  const ty = this.typeck_results.node_type(hir_id);

  if (res.$ === "Def" && res._0.$ === "Ctor" && res._0._0 === "Variant") {
    const variant_ctor_id = res._1;
    const variant_id = this.tcx.parent(variant_ctor_id);
    res = { $: "Def", _0: DefKind.Variant, _1: variant_id };
  }

  let kind: PatKind;
  if (res.$ === "Def" && res._0.$ === "Variant") {
    const variant_id = res._1;
    const enum_id = this.tcx.parent(variant_id);
    const adt_def = this.tcx.adt_def(enum_id) as AdtDef;
    if (adt_def.is_enum()) {
      let args: GenericArgs;
      const tk = ty.kind();
      switch (tk.$) {
        case "FnDef": {
          const a = Binder.no_bound_vars(tk._1, fold_GenericArgs);
          if (a === undefined) return panic("called `Option::unwrap()` on a `None` value");
          args = a;
          break;
        }
        case "Adt":
          args = tk._1;
          break;
        case "Error":
          // Avoid ICE (#50585)
          return new Pat(ty, span, undefined, { $: "Error", _0: tk._0 });
        default:
          return bug(`inappropriate type for def: ${debug_Ty(ty, PLAIN)}`);
      }
      kind = {
        $: "Variant",
        adt_def,
        args,
        variant_index: adt_def.variant_index_with_id(variant_id),
        subpatterns,
      };
    } else {
      kind = { $: "Leaf", subpatterns };
    }
  } else if (
    (res.$ === "Def" &&
      (res._0.$ === "Struct" ||
        (res._0.$ === "Ctor" && res._0._0 === "Struct") ||
        res._0.$ === "Union" ||
        res._0.$ === "TyAlias" ||
        res._0.$ === "AssocTy")) ||
    res.$ === "SelfTyParam" ||
    res.$ === "SelfTyAlias" ||
    res.$ === "SelfCtor"
  ) {
    kind = { $: "Leaf", subpatterns };
  } else {
    let e: ErrorGuaranteed;
    if (res.$ === "Def" && res._0.$ === "ConstParam") {
      const def_id = res._1;
      const const_span = this.tcx.def_span(def_id);
      e = this.tcx.dcx().emit_err(ConstParamInPattern_diagnostic({ span, const_span }));
    } else if (res.$ === "Def" && res._0.$ === "Static") {
      const def_id = res._1;
      const static_span = this.tcx.def_span(def_id);
      e = this.tcx.dcx().emit_err(StaticInPattern_diagnostic({ span, static_span }));
    } else {
      e = this.tcx.dcx().emit_err(NonConstPath_diagnostic({ span }));
    }
    kind = { $: "Error", _0: e };
  }
  const thir_pat = new Pat(ty, span, undefined, kind);

  const user_ty = this.user_args_applied_to_ty_of_hir_id(hir_id);
  if (user_ty !== undefined) {
    // debug!(?thir_pat, ?user_ty, ?span, "lower_variant_or_leaf: applying ascription");
    const annotation: CanonicalUserTypeAnnotation = {
      user_ty: user_ty,
      span,
      inferred_ty: this.typeck_results.node_type(hir_id),
    };
    extra_get_or_insert_default(thir_pat).ascriptions.push({ annotation, variance: "Covariant" });
  }

  return thir_pat;
};

// rustc: compiler/rustc_mir_build/src/thir/pattern/mod.rs:615 user_args_applied_to_ty_of_hir_id
PatCtxt.prototype.user_args_applied_to_ty_of_hir_id = function (
  this: PatCtxt,
  hir_id: HirId,
): CanonicalUserType | undefined {
  return util.user_args_applied_to_ty_of_hir_id(this.tcx, this.typeck_results, hir_id);
};

/// Takes a HIR Path. If the path is a constant, evaluates it and feeds
/// it to `const_to_pat`. Any other path (like enum variants without fields)
/// is converted to the corresponding pattern via `lower_variant_or_leaf`.
// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_mir_build/src/thir/pattern/mod.rs:626 lower_path
PatCtxt.prototype.lower_path = function (
  this: PatCtxt,
  pat: HirPat, // Pattern that directly contains `expr`
  expr: HirPatExpr,
  qpath: QPath,
): Pat {
  assert_matches(
    pat.kind,
    pat.kind.$ === "Expr" || pat.kind.$ === "Range",
    "hir::PatKind::Expr(..) | hir::PatKind::Range(..)",
    (k) => debug_HirPatKind(k, PLAIN),
  );

  const id = expr.hir_id;
  const span = expr.span;
  const ty = this.typeck_results.node_type(id);
  const res = this.typeck_results.qpath_res(qpath, id);

  let kind: AliasConstKind;
  if (res.$ === "Def" && res._0.$ === "Const") {
    const def_id = res._1;
    kind = { $: "Free", def_id };
  } else if (res.$ === "Def" && res._0.$ === "AssocConst") {
    const def_id = res._1;
    const pk = this.tcx.def_kind(this.tcx.parent(def_id));
    if (pk.$ === "Impl" && pk.of_trait === false) {
      kind = { $: "InherentImpl", def_id };
    } else {
      kind = { $: "Projection", def_id };
    }
  } else {
    // The path isn't the name of a constant, so it must actually
    // be a unit struct or unit variant (e.g. `Option::None`).
    return this.lower_variant_or_leaf(pat, expr, res, []);
  }

  // Lower the named constant to a THIR pattern.
  const args = this.typeck_results.node_args(id);
  const alias = AliasConst.new(this.tcx, kind, args);
  const c = Const.new_alias(this.tcx, "No", alias);
  const pattern = this.const_to_pat(c, ty, id, span);

  // If this is an associated constant with an explicit user-written
  // type, add an ascription node (e.g. `<Foo<'a> as MyTrait>::CONST`).
  const user_ty = this.typeck_results.user_provided_types().get(id);
  if (user_ty !== undefined) {
    const annotation: CanonicalUserTypeAnnotation = {
      user_ty: user_ty,
      span,
      inferred_ty: this.typeck_results.node_type(id),
    };
    // Note that we use `Contravariant` here. See the
    // `variance` field documentation for details.
    extra_get_or_insert_default(pattern).ascriptions.push({ annotation, variance: "Contravariant" });
  }

  return pattern;
};

/// Lowers the kinds of "expression" that can appear in a HIR pattern:
/// - Paths (e.g. `FOO`, `foo::BAR`, `Option::None`)
/// - Literals, possibly negated (e.g. `-128u8`, `"hello"`)
// rustc: compiler/rustc_mir_build/src/thir/pattern/mod.rs:688 lower_pat_expr
PatCtxt.prototype.lower_pat_expr = function (
  this: PatCtxt,
  pat: HirPat, // Pattern that directly contains `expr`
  expr: HirPatExpr,
): Pat {
  assert_matches(
    pat.kind,
    pat.kind.$ === "Expr" || pat.kind.$ === "Range",
    "hir::PatKind::Expr(..) | hir::PatKind::Range(..)",
    (k) => debug_HirPatKind(k, PLAIN),
  );
  const ek = expr.kind;
  switch (ek.$) {
    case "Path":
      return this.lower_path(pat, expr, ek._0);
    case "Lit": {
      const { lit, negated } = ek;
      // We handle byte string literal patterns by using the pattern's type instead of the
      // literal's type in `const_to_pat`: if the literal `b"..."` matches on a slice reference,
      // the pattern's type will be `&[u8]` whereas the literal's type is `&[u8; 3]`; using the
      // pattern's type means we'll properly translate it to a slice reference pattern. This works
      // because slices and arrays have the same valtree representation.
      //
      // Under `feature(deref_patterns)`, this adjustment can also convert string literal
      // patterns to `str`, and byte-string literal patterns to `[u8; N]` or `[u8]`.

      const pat_ty = this.typeck_results.node_type(pat.hir_id);
      const lit_input: LitToConstInput = { lit: lit.node, ty: pat_ty, neg: negated };
      let constant: Const | undefined;
      if (const_lit_matches_ty(this.tcx, lit.node, pat_ty, negated)) {
        const v = this.tcx.at(expr.span).lit_to_const(lit_input) as Value | undefined;
        if (v !== undefined) constant = Const.new_value(this.tcx, v.valtree, pat_ty);
      }
      if (constant === undefined) {
        constant = Const.new_error_with_message(this.tcx, expr.span, "literal does not match expected type");
      }
      return this.const_to_pat(constant, pat_ty, expr.hir_id, lit.span);
    }
  }
};

// ---- stand-ins for fns of other upstream files that are not ported yet (not markers; repoint when they land) ----

// `IntegerExt::{from_int_ty, from_uint_ty}` (rustc_middle ty/layout.ts, lane typeck-gaps).
function Integer_from_int_ty(tcx: TyCtxt, ity: IntTy): Integer {
  return IntegerExt.from_int_ty(tcx, ity);
}
function Integer_from_uint_ty(tcx: TyCtxt, uty: UintTy): Integer {
  return IntegerExt.from_uint_ty(tcx, uty);
}
