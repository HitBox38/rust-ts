//! Code for type-checking cast expressions.
//!
//! A cast `e as U` is valid if one of the following holds:
//! * `e` has type `T` and `T` coerces to `U`; *coercion-cast*
//! * `e` has type `*T`, `U` is `*U_0`, and either `U_0: Sized` or
//!    pointer_kind(`T`) = pointer_kind(`U_0`); *ptr-ptr-cast*
//! * `e` has type `*T` and `U` is a numeric type, while `T: Sized`; *ptr-addr-cast*
//! * `e` is an integer and `U` is `*U_0`, while `U_0: Sized`; *addr-ptr-cast*
//! * `e` has type `T` and `T` and `U` are any numeric types; *numeric-cast*
//! * `e` is a C-like enum and `U` is an integer type; *enum-cast*
//! * `e` has type `bool` or `char` and `U` is an integer; *prim-int-cast*
//! * `e` has type `u8` and `U` is `char`; *u8-char-cast*
//! * `e` has type `&[T; n]` and `U` is `*const T`; *array-ptr-cast*
//! * `e` is a function pointer type and `U` has type `*T`,
//!   while `T: Sized`; *fptr-ptr-cast*
//! * `e` is a function pointer type and `U` is an integer; *fptr-addr-cast*
//!
//! where `&.T` and `*T` are references of either mutability,
//! and where pointer_kind(`T`) is the kind of the unsize info
//! in `T` - the vtable for a trait definition (e.g., `fmt::Display` or
//! `Iterator`, not `Iterator<Item=u8>`) or a length (or `()` if `T: Sized`).
//!
//! Note that lengths are not adjusted when casting raw slices -
//! `T: *const [u16] as *const [u8]` creates a slice that only includes
//! half of the original memory.
//!
//! Casting is not transitive, that is, even if `e as U1 as U2` is a valid
//! expression, `e as U2` is not necessarily so (in fact it will only be valid if
//! `U1` coerces to `U2`).
// Port of compiler/rustc_hir_typeck/src/cast.rs (lane typeck-callee-cast).
//
// `FnCtxt::pointer_kind` is assigned onto `FnCtxt.prototype` (declared in ./decls.ts), the `impl CastCheck` methods onto
// the generated class's prototype (cast.gen.ts), `CastCheck::new` as its associated fn.
// - `impl From<ErrorGuaranteed> for CastError` is `CastError_from` (decls.ts comment-only declaration).
// - `#[derive(PartialEq)] PointerKind` is `PointerKind_eq` (PORTING §5 "on data → a `<type>_eq` function").
// Init order: top-level code here touches only ./decls.ts, this file's .gen.ts and other crates; every other
// rustc_hir_typeck export is read inside function bodies only.
export * from "./cast.gen.ts";
import { Mutability, Mutability_cmp } from "../rustc_ast_ir/lib.ts";
import { String_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import { DiagSymbolList_from } from "../rustc_errors/diagnostic_impls.ts";
import { type Diag, E0604, E0605, E0606, E0607, E0620 } from "../rustc_errors/lib.ts";
import type * as hir from "../rustc_hir/lib.ts";
import { HirId_eq } from "../rustc_hir_id/lib.ts";
import { ToTrace_Ty } from "../rustc_infer/infer/at.ts";
import { DefineOpaqueTypes } from "../rustc_infer/infer/mod.ts";
import { clone_Obligation, type PredicateObligation } from "../rustc_infer/traits/mod.ts";
import { TRIVIAL_CASTS, TRIVIAL_NUMERIC_CASTS } from "../rustc_lint_defs/builtin.gen.ts";
import { EvaluationResult } from "../rustc_middle/traits/select.ts";
import { AllowTwoPhase } from "../rustc_middle/ty/adjustment.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { debug_Ty, type ParamEnv, Ty } from "../rustc_middle/ty/mod.ts";
import { CastTy } from "../rustc_middle/ty/cast.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { fold_Predicate, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { DefId_eq, type DefId } from "../rustc_span/def_id.ts";
import { DUMMY_SP, type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { sym } from "../rustc_span/symbol.ts";
import { ObligationCtxt } from "../rustc_trait_selection/traits/engine.ts";
import type { FulfillmentError } from "../rustc_trait_selection/traits/mod.gen.ts";
import type { TypeErrCtxtView } from "../rustc_trait_selection/traits/mod.ts";
import { Binder, fold_Binder } from "../rustc_type_ir/binder.ts";
import { fold_FnSig } from "../rustc_type_ir/ty_kind.ts";
import type { TypeError } from "../rustc_type_ir/error.ts";
import { supertrait_def_ids } from "../rustc_type_ir/elaborate.ts";
import { fold_Option, type TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { TypeAndMut } from "../rustc_type_ir/ty_kind.gen.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { format_debug, PLAIN } from "../std/fmt.ts";
import { panic, unported, unreachable } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { FnCtxt, TypeckRootCtxt } from "./decls.ts";
import { CastCheck, CastError, type CastKind, debug_CastError, fold_with_PointerKind, PointerKind, try_fold_with_PointerKind, visit_with_PointerKind } from "./cast.gen.ts";
import * as diagnostics from "./diagnostics.ts";
import { type_error_struct } from "./lib.ts";

/** PORT (D4): the `TypeFoldable` descriptor of `PointerKind` over its derived impls (cast.gen.ts), for
 *  `erase_and_anonymize_regions`. */
const fold_PointerKind: TypeFoldable<PointerKind> = {
  visit_with: (self, visitor) => visit_with_PointerKind(self, visitor),
  try_fold_with: (self, folder) => try_fold_with_PointerKind(self, folder),
  fold_with: (self, folder) => fold_with_PointerKind(self, folder),
};

/** `#[derive(PartialEq)]` of `PointerKind` (cast.rs:90). */
function PointerKind_eq(a: PointerKind, b: PointerKind): boolean {
  switch (a.$) {
    case "Thin":
    case "Length":
      return a.$ === b.$;
    case "VTable":
      // `&'tcx List<..>` is interned: equality is identity.
      return b.$ === "VTable" && a._0 === b._0;
    case "OfAlias":
      return b.$ === "OfAlias" && a._0.kind.$ === b._0.kind.$ && DefId_eq(a._0.kind.def_id, b._0.kind.def_id) && a._0.args === b._0.args;
    case "OfParam":
      return b.$ === "OfParam" && a._0.index === b._0.index && a._0.name === b._0.name;
  }
}

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {
/// Returns the kind of unsize information of t, or None
/// if t is unknown.
// rustc: compiler/rustc_hir_typeck/src/cast.rs:107 pointer_kind
FnCtxt.prototype.pointer_kind = function (this: FnCtxt, t_: Ty, span: Span): Result<PointerKind | undefined, ErrorGuaranteed> {
  // debug!("pointer_kind({:?}, {:?})", t, span);

  let t = this.deeply_resolve_ignoring_regions(t_, fold_Ty);
  const reported = TypeVisitableExt.error_reported(t, fold_Ty);
  if (reported.$ === "Err") return reported;

  if (this.type_is_sized_modulo_regions(this.param_env, t)) {
    return Ok(PointerKind.Thin);
  }

  t = this.deeply_resolve_ignoring_regions_with_obligations(t, fold_Ty);

  const k = t.kind();
  switch (k.$) {
    case "Slice":
    case "Str":
      return Ok(PointerKind.Length);
    case "Dynamic":
      return Ok({ $: "VTable", _0: k._0 });
    case "Adt":
      if (k._0.is_struct()) {
        const f = k._0.non_enum_variant().tail_opt();
        if (f === undefined) {
          return Ok(PointerKind.Thin);
        } else {
          const field_ty = this.field_ty(span, f, k._1);
          return this.pointer_kind(field_ty, span);
        }
      }
      break;
    case "Tuple": {
      const f = k._0[k._0.length - 1];
      if (f === undefined) {
        return Ok(PointerKind.Thin);
      } else {
        return this.pointer_kind(f, span);
      }
    }

    case "UnsafeBinder":
      return panic("not implemented: FIXME(unsafe_binder)");

    // Pointers to foreign types are thin, despite being unsized
    case "Foreign":
      return Ok(PointerKind.Thin);
    // We should really try to normalize here.
    case "Alias":
      return Ok({ $: "OfAlias", _0: k._1 });
    case "Param":
      return Ok({ $: "OfParam", _0: k._0 });
    // Insufficient type information.
    case "Placeholder":
    case "Bound":
    case "Infer":
      return Ok(undefined);

    default:
      break;
  }
  // ty::Bool | ty::Char | ty::Int(..) | ty::Uint(..) | ty::Float(_) | ty::Array(..) | ty::CoroutineWitness(..)
  // | ty::RawPtr(_, _) | ty::Ref(..) | ty::Pat(..) | ty::FnDef(..) | ty::FnPtr(..) | ty::Closure(..)
  // | ty::CoroutineClosure(..) | ty::Coroutine(..) | ty::Adt(..) | ty::Never | ty::Error(_)
  const guar = this.dcx().span_delayed_bug(span, `\`${format_debug(t, debug_Ty, PLAIN)}\` should be sized but is not?`);
  return Err(guar);
};
// }

// rustc: compiler/rustc_hir_typeck/src/cast.rs:207 from
export function CastError_from(err: ErrorGuaranteed): CastError {
  return { $: "ErrorGuaranteed", _0: err };
}

// rustc: compiler/rustc_hir_typeck/src/cast.rs:212 make_invalid_casting_error
export function make_invalid_casting_error(span: Span, expr_ty: Ty, cast_ty: Ty, fcx: FnCtxt): Diag {
  return type_error_struct(fcx.dcx(), span, expr_ty, E0606, `casting \`${fcx.ty_to_string(expr_ty)}\` as \`${fcx.ty_to_string(cast_ty)}\` is invalid`);
}

/// If a cast from `from_ty` to `to_ty` is valid, returns a `Some` containing the kind
/// of the cast.
///
/// This is a helper used from clippy.
// rustc: compiler/rustc_hir_typeck/src/cast.rs:233 check_cast
export function check_cast(tcx: TyCtxt, param_env: ParamEnv, e: hir.Expr, from_ty: Ty, to_ty: Ty): CastKind | undefined {
  const hir_id = e.hir_id;
  const local_def_id = hir_id.owner.def_id;

  const root_ctxt = TypeckRootCtxt.new(tcx, local_def_id);
  const fn_ctxt = FnCtxt.new(root_ctxt, param_env, local_def_id);

  const check = CastCheck.new(
    fn_ctxt,
    e,
    from_ty,
    to_ty,
    // We won't show any errors to the user, so the span is irrelevant here.
    DUMMY_SP,
    DUMMY_SP,
  );
  if (check.$ === "Ok") {
    const r = check._0.do_check(fn_ctxt);
    return r.$ === "Ok" ? r._0 : undefined;
  } else {
    return undefined;
  }
}

// impl<'a, 'tcx> CastCheck<'tcx> {
// rustc: compiler/rustc_hir_typeck/src/cast.rs:258 new
(CastCheck as unknown as { new: typeof CastCheck.new }).new = function (fcx: FnCtxt, expr: hir.Expr, expr_ty: Ty, cast_ty: Ty, cast_span: Span, span: Span): Result<CastCheck, ErrorGuaranteed> {
  const expr_span = Span.find_ancestor_inside(expr.span, span) ?? expr.span;
  const check = new CastCheck(expr, expr_ty, expr_span, cast_ty, cast_span, span, fcx.body_def_id);

  // For better error messages, check for some obviously unsized
  // cases now. We do a more thorough check at the end, once
  // inference is more completely known.
  const k = cast_ty.kind();
  switch (k.$) {
    case "Dynamic":
    case "Slice":
      return Err(check.report_cast_to_unsized_type(fcx));
    default:
      return Ok(check);
  }
};

// rustc: compiler/rustc_hir_typeck/src/cast.rs:286 report_cast_error
CastCheck.prototype.report_cast_error = function (this: CastCheck, fcx: FnCtxt, e: CastError): void {
  switch (e.$) {
    case "ErrorGuaranteed": {
      // an error has already been reported
      break;
    }
    case "NeedDeref": {
      const err = make_invalid_casting_error(this.span, this.expr_ty, this.cast_ty, fcx);

      if (this.expr.kind.$ === "AddrOf") {
        // get just the borrow part of the expression
        const span = Span.with_hi(this.expr_span, Span.lo(this.expr.peel_borrows().span));
        err.span_suggestion_verbose(span, "remove the unneeded borrow", "", "MachineApplicable");
      } else {
        err.span_suggestion_verbose(Span.shrink_to_lo(this.expr_span), "dereference the expression", "*", "MachineApplicable");
      }

      err.emit();
      break;
    }
    case "NeedViaThinPtr":
    case "NeedViaPtr": {
      const err = make_invalid_casting_error(this.span, this.expr_ty, this.cast_ty, fcx);

      if (this.cast_ty.is_integral()) {
        const ek = this.expr_ty.kind();
        let ik: ReturnType<Ty["kind"]> | undefined;
        if (
          this.expr.kind.$ !== "AddrOf" &&
          ek.$ === "Ref" &&
          (ik = ek._1.kind()).$ === "Adt" &&
          ik._0.is_enum() &&
          ik._0.is_payloadfree()
        ) {
          const inner_ty = ek._1;
          const adt_def = ik._0;
          err.span_suggestion_verbose(Span.shrink_to_lo(this.expr_span), "try dereferencing before the cast", "*", "MaybeIncorrect");
          if (!fcx.type_is_copy_modulo_regions(fcx.param_env, inner_ty)) {
            err.span_suggestion_verbose(Span.shrink_to_lo(fcx.tcx.def_span(adt_def.did())), "add `#[derive(Copy, Clone)]` to the enum definition", "#[derive(Copy, Clone)]\n", "MaybeIncorrect");
          }
        } else {
          let via: string;
          switch (e.$) {
            case "NeedViaPtr":
              via = "a raw pointer";
              break;
            case "NeedViaThinPtr":
              via = "a thin pointer";
              break;
          }
          err.help(`cast through ${via} first`);
        }
      }

      this.try_suggest_collection_to_bool(fcx, err);

      err.emit();
      break;
    }
    case "NeedViaInt": {
      make_invalid_casting_error(this.span, this.expr_ty, this.cast_ty, fcx).with_help("cast through an integer first").emit();
      break;
    }
    case "IllegalCast": {
      make_invalid_casting_error(this.span, this.expr_ty, this.cast_ty, fcx).emit();
      break;
    }
    case "DifferingKinds": {
      const { src_kind, dst_kind } = e;
      const err = make_invalid_casting_error(this.span, this.expr_ty, this.cast_ty, fcx);

      const s = src_kind.$;
      const d = dst_kind.$;
      if (s === "VTable" && d === "VTable") {
        err.note("the trait objects may have different vtables");
      } else if (
        ((s === "OfParam" || s === "OfAlias") && (d === "OfParam" || d === "OfAlias" || d === "VTable" || d === "Length")) ||
        ((s === "VTable" || s === "Length") && (d === "OfParam" || d === "OfAlias"))
      ) {
        err.note("the pointers may have different metadata");
      } else if ((s === "VTable" && d === "Length") || (s === "Length" && d === "VTable")) {
        err.note("the pointers have different metadata");
      } else {
        // (Thin, _) | (_, Thin) | (Length, Length)
        span_bug(this.span, `unexpected cast error: ${format_debug(e, debug_CastError, PLAIN)}`);
      }

      err.emit();
      break;
    }
    case "CastToBool": {
      const expr_ty = fcx.deeply_resolve_ignoring_regions(this.expr_ty, fold_Ty);
      const help: diagnostics.CannotCastToBoolHelp = this.expr_ty.is_numeric()
        ? { $: "Numeric", _0: Span.with_hi(Span.shrink_to_hi(this.expr_span), Span.hi(this.span)) }
        : { $: "Unsupported", _0: this.span };
      fcx.dcx().emit_err(diagnostics.CannotCastToBool_diagnostic({ span: this.span, expr_ty, help }));
      break;
    }
    case "CastToChar": {
      const err = type_error_struct(fcx.dcx(), this.span, this.expr_ty, E0604, `only \`u8\` can be cast as \`char\`, not \`${display_Ty(this.expr_ty)}\``);
      err.span_label(this.span, "invalid cast");
      if (this.expr_ty.is_numeric()) {
        if (this.expr_ty === fcx.tcx.types.u32) {
          err.multipart_suggestion(
            "consider using `char::from_u32` instead",
            [
              [Span.shrink_to_lo(this.expr_span), "char::from_u32("],
              [Span.to(Span.shrink_to_hi(this.expr_span), this.cast_span), ")"],
            ],
            "MachineApplicable",
          );
        } else if (this.expr_ty === fcx.tcx.types.i8) {
          err.span_help(this.span, "consider casting from `u8` instead");
        } else {
          err.span_help(this.span, "consider using `char::from_u32` instead (via a `u32`)");
        }
      }
      err.emit();
      break;
    }
    case "NonScalar": {
      const err = type_error_struct(fcx.dcx(), this.span, this.expr_ty, E0605, `non-primitive cast: \`${display_Ty(this.expr_ty)}\` as \`${fcx.ty_to_string(this.cast_ty)}\``);

      const snippet = fcx.tcx.sess.source_map().span_to_snippet(this.expr_span);
      if (snippet.$ === "Ok" && this.expr.kind.$ === "AddrOf") {
        err.note(`casting reference expression \`${snippet._0.toString()}\` because \`&\` binds tighter than \`as\``);
      }

      let sugg: [string, boolean] | undefined = undefined;
      let sugg_mutref = false;
      const ck = this.cast_ty.kind();
      if (ck.$ === "Ref") {
        const [reg, cast_ty, mutbl] = [ck._0, ck._1, ck._2];
        const ek = this.expr_ty.kind();
        if (ek.$ === "RawPtr" && fcx.may_coerce(Ty.new_ref(fcx.tcx, fcx.tcx.lifetimes.re_erased, ek._0, mutbl), this.cast_ty)) {
          sugg = [`&${Mutability.prefix_str(mutbl)}*`, cast_ty === ek._0];
        } else if (ek.$ === "Ref" && ek._2 === "Not" && mutbl === "Mut" && fcx.may_coerce(Ty.new_mut_ref(fcx.tcx, ek._0, ek._1), this.cast_ty)) {
          sugg_mutref = true;
        }

        if (!sugg_mutref && sugg === undefined && fcx.may_coerce(Ty.new_ref(fcx.tcx, reg, this.expr_ty, mutbl), this.cast_ty)) {
          sugg = [`&${Mutability.prefix_str(mutbl)}`, false];
        }
      } else if (ck.$ === "RawPtr" && fcx.may_coerce(Ty.new_ref(fcx.tcx, fcx.tcx.lifetimes.re_erased, this.expr_ty, ck._1), this.cast_ty)) {
        sugg = [`&${Mutability.prefix_str(ck._1)}`, false];
      }
      if (sugg_mutref) {
        err.span_label(this.span, "invalid cast");
        err.span_note(this.expr_span, "this reference is immutable");
        err.span_note(this.cast_span, "trying to cast to a mutable reference type");
      } else if (sugg !== undefined) {
        const [sugg_, remove_cast] = sugg;
        err.span_label(this.span, "invalid cast");

        const snip = fcx.tcx.sess.source_map().span_to_snippet(this.expr_span);
        const has_parens = snip.$ === "Ok" && snip._0.toString().startsWith("(");

        // Very crude check to see whether the expression must be wrapped
        // in parentheses for the suggestion to work (issue #89497).
        // Can/should be extended in the future.
        const needs_parens = !has_parens && this.expr.kind.$ === "Cast";

        const suggestion: [Span, string][] = [[Span.shrink_to_lo(this.expr_span), sugg_]];
        if (needs_parens) {
          suggestion[0]![1] += "(";
          suggestion.push([Span.shrink_to_hi(this.expr_span), ")"]);
        }
        if (remove_cast) {
          suggestion.push([Span.to(Span.shrink_to_hi(this.expr_span), this.cast_span), ""]);
        }

        err.multipart_suggestion("consider borrowing the value", suggestion, "MachineApplicable");
      } else if (!(ck.$ === "FnDef" || ck.$ === "FnPtr" || ck.$ === "Closure")) {
        // Check `impl From<self.expr_ty> for self.cast_ty {}` for accurate suggestion:
        const from_trait = fcx.tcx.get_diagnostic_item(sym.From);
        if (from_trait !== undefined) {
          const ty = fcx.deeply_resolve_ignoring_regions(this.cast_ty, fold_Ty);
          const expr_ty = fcx.deeply_resolve_ignoring_regions(this.expr_ty, fold_Ty);
          if (EvaluationResult.must_apply_modulo_regions(fcx.infcx.type_implements_trait(from_trait, [GenericArg.from_Ty(ty), GenericArg.from_Ty(expr_ty)], fcx.param_env))) {
            const ck2 = this.cast_ty.kind();
            const to_ty = ck2.$ === "Adt" ? fcx.tcx.value_path_str_with_args(ck2._0.did(), ck2._1) : display_Ty(this.cast_ty);
            err.multipart_suggestion(
              "consider using the `From` trait instead",
              [
                [Span.shrink_to_lo(this.expr_span), `${to_ty}::from(`],
                [Span.to(Span.shrink_to_hi(this.expr_span), this.cast_span), ")"],
              ],
              "MaybeIncorrect",
            );
          }
        }

        let msg: string;
        let note: string | undefined;
        const ek = this.expr_ty.kind();
        if (ek.$ === "Adt" && ek._0.is_enum() && this.cast_ty.is_numeric()) {
          msg = "an `as` expression can be used to convert enum types to numeric \
types only if the enum type is unit-only or field-less";
          note = "see https://doc.rust-lang.org/reference/items/enumerations.html#casting for more information";
        } else {
          msg = "an `as` expression can only be used to convert between primitive \
types or to coerce to a specific trait object";
          note = undefined;
        }

        err.span_label(this.span, msg);

        if (note !== undefined) {
          err.note(note);
        }
      } else {
        err.span_label(this.span, "invalid cast");
      }

      fcx.suggest_closure_to_fn_ptr_coercion(err, this.expr, this.cast_ty, this.expr_ty);
      this.try_suggest_collection_to_bool(fcx, err);

      err.emit();
      break;
    }
    case "SizedUnsizedCast": {
      const cast_ty = fcx.deeply_resolve_ignoring_regions(this.cast_ty, fold_Ty);
      const expr_ty = fcx.deeply_resolve_ignoring_regions(this.expr_ty, fold_Ty);
      fcx.dcx().emit_err(
        diagnostics.CastThinPointerToWidePointer_diagnostic({
          span: this.span,
          expr_ty,
          cast_ty,
          teach: fcx.tcx.sess.teach(E0607),
        }),
      );
      break;
    }
    case "IntToWideCast": {
      const known_metadata = e._0;
      const expr_if_nightly = fcx.tcx.sess.is_nightly_build() ? this.expr_span : undefined;
      const cast_ty = fcx.deeply_resolve_ignoring_regions(this.cast_ty, fold_Ty);
      const expr_ty = fcx.deeply_resolve_ignoring_regions(this.expr_ty, fold_Ty);
      const metadata = known_metadata ?? "type-specific metadata";
      const known_wide = known_metadata !== undefined;
      const span = this.cast_span;
      let param_note: diagnostics.IntToWideParamNote | undefined = undefined;
      if (!known_wide) {
        const ck = cast_ty.kind();
        if (ck.$ === "RawPtr") {
          const pk = ck._0.kind();
          if (pk.$ === "Param") {
            param_note = { param: pk._0.name };
          }
        }
      }
      fcx.dcx().emit_err(
        diagnostics.IntToWide_diagnostic({
          span,
          metadata,
          expr_ty,
          cast_ty,
          expr_if_nightly,
          known_wide,
          param_note,
        }),
      );
      break;
    }
    case "UnknownCastPtrKind":
    case "UnknownExprPtrKind": {
      let unknown_cast_to: boolean;
      switch (e.$) {
        case "UnknownCastPtrKind":
          unknown_cast_to = true;
          break;
        case "UnknownExprPtrKind":
          unknown_cast_to = false;
          break;
      }
      const [span, sub]: [Span, diagnostics.CastUnknownPointerSub] = unknown_cast_to ? [this.cast_span, { $: "To", _0: this.cast_span }] : [this.cast_span, { $: "From", _0: this.span }];
      fcx.dcx().emit_err(
        diagnostics.CastUnknownPointer_diagnostic({
          span,
          to: unknown_cast_to,
          sub,
        }),
      );
      break;
    }
    case "CastEnumDrop": {
      const expr_ty = fcx.deeply_resolve_ignoring_regions(this.expr_ty, fold_Ty);
      const cast_ty = fcx.deeply_resolve_ignoring_regions(this.cast_ty, fold_Ty);

      fcx.dcx().emit_err(diagnostics.CastEnumDrop_diagnostic({ span: this.span, expr_ty, cast_ty }));
      break;
    }
    case "ForeignNonExhaustiveAdt": {
      make_invalid_casting_error(this.span, this.expr_ty, this.cast_ty, fcx).with_note("cannot cast an enum with a non-exhaustive variant when it's defined in another crate").emit();
      break;
    }
    case "PtrPtrAddingAutoTrait": {
      const added = e._0;
      const traits: string[] = added.map((trait_did) => fcx.tcx.def_path_str(trait_did));
      traits.sort(cmp_string);
      fcx.dcx().emit_err(
        diagnostics.PtrCastAddAutoToObject_diagnostic({
          span: this.span,
          traits_len: added.length,
          traits: DiagSymbolList_from(traits),
        }),
      );
      break;
    }
  }
};

/** `Ord for String` (byte-wise UTF-8 order = code point order; JS `<` compares UTF-16 code units). */
function cmp_string(a: string, b: string): number {
  const ai = a[Symbol.iterator]();
  const bi = b[Symbol.iterator]();
  for (;;) {
    const x = ai.next();
    const y = bi.next();
    if (x.done || y.done) return x.done && y.done ? 0 : x.done ? -1 : 1;
    const cx = x.value.codePointAt(0)!;
    const cy = y.value.codePointAt(0)!;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}

// rustc: compiler/rustc_hir_typeck/src/cast.rs:710 report_cast_to_unsized_type
CastCheck.prototype.report_cast_to_unsized_type = function (this: CastCheck, fcx: FnCtxt): ErrorGuaranteed {
  let r = TypeVisitableExt.error_reported(this.cast_ty, fold_Ty);
  if (r.$ === "Err") {
    return r._0;
  }
  r = TypeVisitableExt.error_reported(this.expr_ty, fold_Ty);
  if (r.$ === "Err") {
    return r._0;
  }

  const tstr = fcx.ty_to_string(this.cast_ty);
  const err = type_error_struct(fcx.dcx(), this.span, this.expr_ty, E0620, `cast to unsized type: \`${display_Ty(fcx.deeply_resolve_ignoring_regions(this.expr_ty, fold_Ty))}\` as \`${tstr}\``);
  const k = this.expr_ty.kind();
  if (k.$ === "Ref") {
    const mtstr = Mutability.prefix_str(k._2);
    err.span_suggestion_verbose(Span.shrink_to_lo(this.cast_span), "consider casting to a reference instead", `&${mtstr}`, "MachineApplicable");
  } else if (k.$ === "Adt" && k._0.is_box()) {
    err.multipart_suggestion(
      "you can cast to a `Box` instead",
      [
        [Span.shrink_to_lo(this.cast_span), "Box<"],
        [Span.shrink_to_hi(this.cast_span), ">"],
      ],
      "MachineApplicable",
    );
  } else {
    err.span_help(this.expr_span, "consider using a box or reference as appropriate");
  }
  return err.emit_err();
};

// rustc: compiler/rustc_hir_typeck/src/cast.rs:755 trivial_cast_lint
CastCheck.prototype.trivial_cast_lint = function (this: CastCheck, fcx: FnCtxt): void {
  if (this.is_non_trivial_ref_trait_object_upcast(fcx)) {
    return;
  }

  const [numeric, lint] = this.cast_ty.is_numeric() && this.expr_ty.is_numeric() ? [true, TRIVIAL_NUMERIC_CASTS] : [false, TRIVIAL_CASTS];
  const expr_ty = fcx.deeply_resolve_ignoring_regions(this.expr_ty, fold_Ty);
  const cast_ty = fcx.deeply_resolve_ignoring_regions(this.cast_ty, fold_Ty);
  fcx.tcx.emit_node_span_lint(lint, this.expr.hir_id, this.span, diagnostics.TrivialCast_diagnostic({ numeric, expr_ty, cast_ty }));
};

// A trait-object upcast from a method receiver, such as
// `(other as &dyn Any).downcast_ref::<u32>()`,
// is not trivial, because it may change the method resolution, we want to skip the lint in this case.
// see issue #148219
// rustc: compiler/rustc_hir_typeck/src/cast.rs:779 is_non_trivial_ref_trait_object_upcast
CastCheck.prototype.is_non_trivial_ref_trait_object_upcast = function (this: CastCheck, fcx: FnCtxt): boolean {
  const ek = this.expr_ty.kind();
  const ck = this.cast_ty.kind();
  let matches = false;
  if (ek.$ === "Ref" && ck.$ === "Ref") {
    const fk = ek._1.kind();
    const tk = ck._1.kind();
    matches = fk.$ === "Dynamic" && tk.$ === "Dynamic" && fk._0 !== tk._0;
  }
  if (!matches) {
    return false;
  }

  const cast_expr_ = fcx.tcx.parent_hir_node(this.expr.hir_id);
  if (cast_expr_.$ !== "Expr") {
    return false;
  }
  const cast_expr = cast_expr_._0;
  const parent_ = fcx.tcx.parent_hir_node(cast_expr.hir_id);
  if (parent_.$ !== "Expr") {
    return false;
  }
  const parent = parent_._0;

  return parent.kind.$ === "MethodCall" && HirId_eq(parent.kind._1.hir_id, cast_expr.hir_id);
};

// rustc: compiler/rustc_hir_typeck/src/cast.rs:804 expr_span_for_type_resolution
CastCheck.prototype.expr_span_for_type_resolution = function (this: CastCheck, fcx: FnCtxt): Span {
  if (
    this.expr.kind.$ === "Index" &&
    fcx.deeply_resolve_ignoring_regions(this.expr_ty, fold_Ty).is_ty_var() &&
    fcx.deeply_resolve_ignoring_regions(fcx.node_ty(this.expr.kind._1.hir_id), fold_Ty).is_ty_var()
  ) {
    return index_operand_ambiguity_span(this.expr.kind._1);
  } else {
    return this.expr_span;
  }
};

// #[instrument(skip(fcx), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/cast.rs:816 check
CastCheck.prototype.check = function (this: CastCheck, fcx: FnCtxt): void {
  const expr_span = this.expr_span_for_type_resolution(fcx);
  this.expr_ty = fcx.structurally_resolve_type(expr_span, this.expr_ty);
  this.cast_ty = fcx.deeply_resolve_ignoring_regions_with_obligations(this.cast_ty, fold_Ty);
  if (this.cast_ty.is_ty_var()) {
    const guar = this.try_report_ambiguous_binop_for_infer_cast(fcx);
    if (guar !== undefined) {
      const err = Ty.new_error(fcx.tcx, guar);
      fcx.demand_suptype(this.cast_span, err, this.cast_ty);
      this.cast_ty = err;
    } else {
      this.cast_ty = fcx.type_must_be_known_at_this_point(this.cast_span, this.cast_ty);
    }
  }

  // debug!("check_cast({}, {:?} as {:?})", self.expr.hir_id, self.expr_ty, self.cast_ty);

  if (!fcx.type_is_sized_modulo_regions(fcx.param_env, this.cast_ty) && !TypeVisitableExt.has_infer_types(this.cast_ty, fold_Ty)) {
    this.report_cast_to_unsized_type(fcx);
  } else if (TypeVisitableExt.references_error(this.expr_ty, fold_Ty) || TypeVisitableExt.references_error(this.cast_ty, fold_Ty)) {
    // No sense in giving duplicate error messages
  } else {
    const r = this.try_coercion_cast(fcx);
    if (r.$ === "Ok") {
      if (this.expr_ty.is_raw_ptr() && this.cast_ty.is_raw_ptr()) {
        // When casting a raw pointer to another raw pointer, we cannot convert the cast into
        // a coercion because the pointee types might only differ in regions, which HIR typeck
        // cannot distinguish. This would cause us to erroneously discard a cast which will
        // lead to a borrowck error like #113257.
        // We still did a coercion above to unify inference variables for `ptr as _` casts.
        // This does cause us to miss some trivial casts in the trivial cast lint.
        // debug!(" -> PointerCast");
      } else {
        this.trivial_cast_lint(fcx);
        // debug!(" -> CoercionCast");
        fcx.typeck_results.set_coercion_cast(this.expr.hir_id.local_id);
      }
    } else {
      const k = this.do_check(fcx);
      if (k.$ === "Ok") {
        // debug!(" -> {:?}", k);
      } else {
        this.report_cast_error(fcx, k._0);
      }
    }
  }
};

/// Prefer a pending operator ambiguity over a generic `as _` inference failure.
// #[cold]
// rustc: compiler/rustc_hir_typeck/src/cast.rs:871 try_report_ambiguous_binop_for_infer_cast
CastCheck.prototype.try_report_ambiguous_binop_for_infer_cast = function (this: CastCheck, fcx: FnCtxt): ErrorGuaranteed | undefined {
  const errors: FulfillmentError[] = [];
  for (const obligation_ of fcx.fulfillment_cx.pending_obligations()) {
    // PORT: `pending_obligations()` returns owned clones; the obligation is mutated below.
    const obligation: PredicateObligation = clone_Obligation(obligation_, (p) => p);
    const predicate = fcx.deeply_resolve_ignoring_regions(obligation.predicate, fold_Predicate);
    const pk = Binder.skip_binder(predicate.kind());
    if (!(pk.$ === "Clause" && pk._0.$ === "Trait")) {
      continue;
    }
    const cast_span = this.cast_span;

    const code = obligation.cause.code_();
    if (code.$ !== "BinOp") {
      continue;
    }
    const { lhs_hir_id, rhs_hir_id, rhs_span } = code;
    const lhs_ty = fcx.deeply_resolve_ignoring_regions(fcx.node_ty(lhs_hir_id), fold_Ty);
    const rhs_ty = fcx.deeply_resolve_ignoring_regions(fcx.node_ty(rhs_hir_id), fold_Ty);

    let found: FulfillmentError | undefined = undefined;
    if ((Span.contains(fcx.tcx.hir_span(lhs_hir_id), cast_span) && lhs_ty.contains(this.cast_ty)) || (Span.contains(rhs_span, cast_span) && rhs_ty.contains(this.cast_ty))) {
      obligation.cause.span = cast_span;
      obligation.predicate = predicate;

      const ocx = ObligationCtxt.new_with_diagnostics(fcx.infcx);
      ocx.register_obligation(obligation);
      const r = ocx.evaluate_obligations_error_on_ambiguity();
      found = (r.$ === "HasErrors" ? r._0 : []).find((error) => error.code.$ === "Ambiguity" && error.code.overflow === undefined);
    } else {
      found = undefined;
    }
    if (found !== undefined) errors.push(found);
  }

  if (errors.length === 0) {
    return undefined;
  } else {
    // PORT(wave 19): `TypeErrCtxt` is `Pending`; the method is read through rustc_trait_selection's `TypeErrCtxtView`.
    return (fcx.err_ctxt() as unknown as TypeErrCtxtView).report_fulfillment_errors(errors);
  }
};

/// Checks a cast, and report an error if one exists. In some cases, this
/// can return Ok and create type errors in the fcx rather than returning
/// directly. coercion-cast is handled in check instead of here.
// rustc: compiler/rustc_hir_typeck/src/cast.rs:929 do_check
CastCheck.prototype.do_check = function (this: CastCheck, fcx: FnCtxt): Result<CastKind, CastError> {
  // use rustc_middle::ty::cast::CastTy::*;

  let t_from: CastTy;
  let t_cast: CastTy;
  const from = CastTy.from_ty(this.expr_ty);
  const cast = CastTy.from_ty(this.cast_ty);
  if (from !== undefined && cast !== undefined) {
    [t_from, t_cast] = [from, cast];
  } else if (from === undefined && cast !== undefined) {
    // Function item types may need to be reified before casts.
    const t_cast_ = cast;
    const ek = this.expr_ty.kind();
    switch (ek.$) {
      case "FnDef": {
        // Attempt a coercion to a fn pointer type.
        const f = fcx.normalize(this.expr_span, Unnormalized.new_wip(this.expr_ty.fn_sig(fcx.tcx)), fold_Binder(fold_FnSig));
        const res = fcx.coerce(this.expr, this.expr_ty, Ty.new_fn_ptr(fcx.tcx, f), AllowTwoPhase.No, undefined);
        if (res.$ === "Err" && res._0.$ === "IntrinsicCast") {
          return Err(CastError.IllegalCast);
        }
        if (res.$ === "Err") {
          return Err(CastError.NonScalar);
        }
        [t_from, t_cast] = [CastTy.FnPtr, t_cast_];
        break;
      }
      // Special case some errors for references, and check for
      // array-ptr-casts. `Ref` is not a CastTy because the cast
      // is split into a coercion to a pointer type, followed by
      // a cast.
      case "Ref": {
        const [inner_ty, mutbl] = [ek._1, ek._2];
        switch (t_cast_.$) {
          case "Int":
          case "CEnum":
          case "Bool":
          case "Char":
          case "Float": {
            const ik = inner_ty.kind();
            switch (ik.$) {
              case "Int":
              case "Uint":
              case "Float":
                return Err(CastError.NeedDeref);
              case "Infer":
                if (ik._0.$ === "IntVar" || ik._0.$ === "FloatVar") {
                  return Err(CastError.NeedDeref);
                }
                return Err(CastError.NeedViaPtr);
              default:
                return Err(CastError.NeedViaPtr);
            }
          }
          // array-ptr-cast
          case "Ptr": {
            const mt = t_cast_._0;
            if (!fcx.type_is_sized_modulo_regions(fcx.param_env, mt.ty)) {
              return Err(CastError.IllegalCast);
            }
            return this.check_ref_cast(fcx, { mutbl, ty: inner_ty }, mt);
          }
          default:
            return Err(CastError.NonScalar);
        }
      }
      default:
        return Err(CastError.NonScalar);
    }
  } else {
    return Err(CastError.NonScalar);
  }
  const ek = this.expr_ty.kind();
  if (ek.$ === "Adt" && !ek._0.did().is_local() && ek._0.variants().some((v) => v.is_field_list_non_exhaustive())) {
    return Err(CastError.ForeignNonExhaustiveAdt);
  }
  const f = t_from.$;
  const c = t_cast.$;
  // These types have invariants! can't cast into them.
  if (c === "CEnum" || c === "FnPtr") return Err(CastError.NonScalar);

  // * -> Bool
  if (c === "Bool") return Err(CastError.CastToBool);

  // * -> Char
  if (f === "Int" && c === "Char" && this.expr_ty === fcx.tcx.types.u8) {
    return Ok("U8CharCast"); // u8-char-cast
  }
  if (c === "Char") return Err(CastError.CastToChar);

  // prim -> float,ptr
  if ((f === "Bool" || f === "CEnum" || f === "Char") && c === "Float") return Err(CastError.NeedViaInt);

  if (((f === "Bool" || f === "CEnum" || f === "Char" || f === "Float") && c === "Ptr") || ((f === "Ptr" || f === "FnPtr") && c === "Float")) {
    return Err(CastError.IllegalCast);
  }

  // ptr -> ptr
  if (t_from.$ === "Ptr" && t_cast.$ === "Ptr") return this.check_ptr_ptr_cast(fcx, t_from._0, t_cast._0); // ptr-ptr-cast

  // ptr-addr-cast
  if (t_from.$ === "Ptr" && c === "Int") return this.check_ptr_addr_cast(fcx, t_from._0);

  if (f === "FnPtr" && c === "Int") {
    // FIXME(#95489): there should eventually be a lint for these casts
    return Ok("FnPtrAddrCast");
  }
  // addr-ptr-cast
  if (f === "Int" && t_cast.$ === "Ptr") return this.check_addr_ptr_cast(fcx, t_cast._0);
  // fn-ptr-cast
  if (f === "FnPtr" && t_cast.$ === "Ptr") return this.check_fptr_ptr_cast(fcx, t_cast._0);

  // enum -> int
  if (f === "CEnum" && c === "Int") return this.check_enum_cast(fcx);

  // prim -> prim
  if ((f === "Char" || f === "Bool") && c === "Int") return Ok("PrimIntCast");

  if ((f === "Int" || f === "Float") && (c === "Int" || c === "Float")) return Ok("NumericCast");

  return unreachable();
};

// rustc: compiler/rustc_hir_typeck/src/cast.rs:1040 check_ptr_ptr_cast
CastCheck.prototype.check_ptr_ptr_cast = function (this: CastCheck, fcx: FnCtxt, m_src: TypeAndMut, m_dst: TypeAndMut): Result<CastKind, CastError> {
  // debug!("check_ptr_ptr_cast m_src={m_src:?} m_dst={m_dst:?}");
  // ptr-ptr cast. metadata must match.

  const src_r = fcx.pointer_kind(m_src.ty, this.span);
  if (src_r.$ === "Err") return Err(CastError_from(src_r._0));
  const src_kind_ = fcx.tcx.erase_and_anonymize_regions(src_r._0, fold_Option(fold_PointerKind));
  const dst_r = fcx.pointer_kind(m_dst.ty, this.span);
  if (dst_r.$ === "Err") return Err(CastError_from(dst_r._0));
  const dst_kind_ = fcx.tcx.erase_and_anonymize_regions(dst_r._0, fold_Option(fold_PointerKind));

  // We can't cast if target pointer kind is unknown
  if (dst_kind_ === undefined) {
    return Err(CastError.UnknownCastPtrKind);
  }
  const dst_kind = dst_kind_;

  // Cast to thin pointer is OK
  if (PointerKind_eq(dst_kind, PointerKind.Thin)) {
    return Ok("PtrPtrCast");
  }

  // We can't cast to wide pointer if source pointer kind is unknown
  if (src_kind_ === undefined) {
    return Err(CastError.UnknownCastPtrKind);
  }
  const src_kind = src_kind_;

  // thin -> fat? report invalid cast (don't complain about vtable kinds)
  if (src_kind.$ === "Thin") {
    return Err(CastError.SizedUnsizedCast);
  }

  // trait object -> trait object? need to do additional checks
  if (src_kind.$ === "VTable" && dst_kind.$ === "VTable") {
    const src_tty = src_kind._0;
    const dst_tty = dst_kind._0;
    const src_principal_ = src_tty.principal();
    const dst_principal_ = dst_tty.principal();
    // A<dyn Src<...> + SrcAuto> -> B<dyn Dst<...> + DstAuto>. need to make sure
    // - `Src` and `Dst` traits are the same
    // - traits have the same generic arguments
    // - projections are the same
    // - `SrcAuto` (+auto traits implied by `Src`) is a superset of `DstAuto`
    //
    // Note that trait upcasting goes through a different mechanism (`coerce_unsized`)
    // and is unaffected by this check.
    if (src_principal_ !== undefined && dst_principal_ !== undefined) {
      const src_principal = src_principal_;
      const tcx = fcx.tcx;

      // We need to reconstruct trait object types.
      // `m_src` and `m_dst` won't work for us here because they will potentially
      // contain wrappers, which we do not care about.
      //
      // e.g. we want to allow `dyn T -> (dyn T,)`, etc.
      //
      // We also need to skip auto traits to emit an FCW and not an error.
      const src_obj = Ty.new_dynamic(tcx, tcx.mk_poly_existential_predicates([...src_tty.without_auto_traits()]), tcx.lifetimes.re_erased);
      const dst_obj = Ty.new_dynamic(tcx, tcx.mk_poly_existential_predicates([...dst_tty.without_auto_traits()]), tcx.lifetimes.re_erased);

      // `dyn Src = dyn Dst`, this checks for matching traits/generics/projections
      // This is `fcx.demand_eqtype`, but inlined to give a better error.
      const cause = fcx.misc(this.span);
      const eq = fcx.at(cause, fcx.param_env).eq(DefineOpaqueTypes.Yes, src_obj, dst_obj, ToTrace_Ty);
      if (eq.$ === "Ok") fcx.register_infer_ok_obligations(eq._0);
      if (eq.$ === "Err") {
        return Err({ $: "DifferingKinds", src_kind, dst_kind });
      }

      // Check that `SrcAuto` (+auto traits implied by `Src`) is a superset of `DstAuto`.
      // Emit an FCW otherwise.
      const src_auto: DefId[] = [...src_tty.auto_traits()];
      for (const def_id of supertrait_def_ids(tcx, Binder.skip_binder(src_principal).def_id)) {
        if (tcx.trait_is_auto(def_id)) src_auto.push(def_id);
      }

      const added = [...dst_tty.auto_traits()].filter((trait_did) => !src_auto.some((d) => DefId_eq(d, trait_did)));

      if (added.length !== 0) {
        return Err({ $: "PtrPtrAddingAutoTrait", _0: added });
      }

      return Ok("PtrPtrCast");
    }

    // dyn Auto -> dyn Auto'? ok.
    if (src_principal_ === undefined && dst_principal_ === undefined) return Ok("PtrPtrCast");

    // dyn Trait -> dyn Auto? not ok (for now).
    //
    // Although dropping the principal is already allowed for unsizing coercions
    // (e.g. `*const (dyn Trait + Auto)` to `*const dyn Auto`), dropping it is
    // currently **NOT** allowed for (non-coercion) ptr-to-ptr casts (e.g
    // `*const Foo` to `*const Bar` where `Foo` has a `dyn Trait + Auto` tail
    // and `Bar` has a `dyn Auto` tail), because the underlying MIR operations
    // currently work very differently:
    //
    // * A MIR unsizing coercion on raw pointers to trait objects (`*const dyn Src`
    //   to `*const dyn Dst`) is currently equivalent to downcasting the source to
    //   the concrete sized type that it was originally unsized from first (via a
    //   ptr-to-ptr cast from `*const Src` to `*const T` with `T: Sized`) and then
    //   unsizing this thin pointer to the target type (unsizing `*const T` to
    //   `*const Dst`). In particular, this means that the pointer's metadata
    //   (vtable) will semantically change, e.g. for const eval and miri, even
    //   though the vtables will always be merged for codegen.
    //
    // * A MIR ptr-to-ptr cast is currently equivalent to a transmute and does not
    //   change the pointer metadata (vtable) at all.
    //
    // In addition to this potentially surprising difference between coercion and
    // non-coercion casts, casting away the principal with a MIR ptr-to-ptr cast
    // is currently considered undefined behavior:
    //
    // As a validity invariant of pointers to trait objects, we currently require
    // that the principal of the vtable in the pointer metadata exactly matches
    // the principal of the pointee type, where "no principal" is also considered
    // a kind of principal.
    if (src_principal_ !== undefined && dst_principal_ === undefined) return Err({ $: "DifferingKinds", src_kind, dst_kind });

    // dyn Auto -> dyn Trait? not ok.
    return Err({ $: "DifferingKinds", src_kind, dst_kind });
  }

  // fat -> fat? metadata kinds must match
  if (PointerKind_eq(src_kind, dst_kind)) return Ok("PtrPtrCast");

  return Err({ $: "DifferingKinds", src_kind, dst_kind });
};

// rustc: compiler/rustc_hir_typeck/src/cast.rs:1187 check_fptr_ptr_cast
CastCheck.prototype.check_fptr_ptr_cast = function (this: CastCheck, fcx: FnCtxt, m_cast: TypeAndMut): Result<CastKind, CastError> {
  // fptr-ptr cast. must be to thin ptr

  const r = fcx.pointer_kind(m_cast.ty, this.span);
  if (r.$ === "Err") return Err(CastError_from(r._0));
  if (r._0 === undefined) return Err(CastError.UnknownCastPtrKind);
  if (r._0.$ === "Thin") return Ok("FnPtrPtrCast");
  return Err(CastError.IllegalCast);
};

// rustc: compiler/rustc_hir_typeck/src/cast.rs:1201 check_ptr_addr_cast
CastCheck.prototype.check_ptr_addr_cast = function (this: CastCheck, fcx: FnCtxt, m_expr: TypeAndMut): Result<CastKind, CastError> {
  // ptr-addr cast. must be from thin ptr

  const r = fcx.pointer_kind(m_expr.ty, this.span);
  if (r.$ === "Err") return Err(CastError_from(r._0));
  if (r._0 === undefined) return Err(CastError.UnknownExprPtrKind);
  if (r._0.$ === "Thin") return Ok("PtrAddrCast");
  return Err(CastError.NeedViaThinPtr);
};

// rustc: compiler/rustc_hir_typeck/src/cast.rs:1215 check_ref_cast
CastCheck.prototype.check_ref_cast = function (this: CastCheck, fcx: FnCtxt, m_expr_: TypeAndMut, m_cast_: TypeAndMut): Result<CastKind, CastError> {
  const m_expr: TypeAndMut = { ...m_expr_ };
  const m_cast: TypeAndMut = { ...m_cast_ };
  // array-ptr-cast: allow mut-to-mut, mut-to-const, const-to-const
  m_expr.ty = fcx.deeply_resolve_ignoring_regions_with_obligations(m_expr.ty, fold_Ty);
  m_cast.ty = fcx.deeply_resolve_ignoring_regions_with_obligations(m_cast.ty, fold_Ty);

  const ek = m_expr.ty.kind();
  if (Mutability_cmp(m_expr.mutbl, m_cast.mutbl) >= 0 && ek.$ === "Array" && fcx.can_eq(fcx.param_env, ek._0, m_cast.ty, ToTrace_Ty)) {
    const ety = ek._0;
    // Due to historical reasons we allow directly casting references of
    // arrays into raw pointers of their element type.

    // Coerce to a raw pointer so that we generate RawPtr in MIR.
    const array_ptr_type = Ty.new_ptr(fcx.tcx, m_expr.ty, m_expr.mutbl);
    const r = fcx.coerce(this.expr, this.expr_ty, array_ptr_type, AllowTwoPhase.No, undefined);
    if (r.$ === "Err") {
      bug(`could not cast from reference to array to pointer to array (${format_debug(this.expr_ty, debug_Ty, PLAIN)} to ${format_debug(array_ptr_type, debug_Ty, PLAIN)})`);
    }

    // this will report a type mismatch if needed
    fcx.demand_eqtype(this.span, ety, m_cast.ty);
    return Ok("ArrayPtrCast");
  }

  return Err(CastError.IllegalCast);
};

// rustc: compiler/rustc_hir_typeck/src/cast.rs:1251 check_addr_ptr_cast
CastCheck.prototype.check_addr_ptr_cast = function (this: CastCheck, fcx: FnCtxt, m_cast: TypeAndMut): Result<CastKind, CastError> {
  // ptr-addr cast. pointer must be thin.
  const r = fcx.pointer_kind(m_cast.ty, this.span);
  if (r.$ === "Err") return Err(CastError_from(r._0));
  const k = r._0;
  if (k === undefined) return Err(CastError.UnknownCastPtrKind);
  switch (k.$) {
    case "Thin":
      return Ok("AddrPtrCast");
    case "VTable":
      return Err({ $: "IntToWideCast", _0: "a vtable" });
    case "Length":
      return Err({ $: "IntToWideCast", _0: "a length" });
    case "OfAlias":
    case "OfParam":
      return Err({ $: "IntToWideCast", _0: undefined });
  }
};

// rustc: compiler/rustc_hir_typeck/src/cast.rs:1268 check_enum_cast
CastCheck.prototype.check_enum_cast = function (this: CastCheck, fcx: FnCtxt): Result<CastKind, CastError> {
  const k = this.expr_ty.kind();
  if (k.$ === "Adt" && k._0.has_dtor(fcx.tcx)) {
    return Err(CastError.CastEnumDrop);
  } else {
    return Ok("EnumCast");
  }
};

// rustc: compiler/rustc_hir_typeck/src/cast.rs:1278 try_coercion_cast
CastCheck.prototype.try_coercion_cast = function (this: CastCheck, fcx: FnCtxt): Result<undefined, TypeError> {
  const r = fcx.coerce(this.expr, this.expr_ty, this.cast_ty, AllowTwoPhase.No, undefined);
  if (r.$ === "Ok") return Ok(undefined);
  return Err(r._0);
};

/// Attempt to suggest using `.is_empty` when trying to cast from a
/// collection type to a boolean.
// rustc: compiler/rustc_hir_typeck/src/cast.rs:1287 try_suggest_collection_to_bool
CastCheck.prototype.try_suggest_collection_to_bool = function (this: CastCheck, fcx: FnCtxt, err: Diag): void {
  if (this.cast_ty.is_bool()) {
    let derefed: [Ty, number] | undefined = undefined;
    for (const t of fcx.autoderef(this.expr_span, this.expr_ty).silence_errors()) {
      const k = t[0].kind();
      if (k.$ === "Str" || k.$ === "Slice") {
        derefed = t;
        break;
      }
    }

    if (derefed !== undefined) {
      const [deref_ty, _] = derefed;
      // Give a note about what the expr derefs to.
      if (deref_ty !== this.expr_ty.peel_refs()) {
        err.subdiagnostic(
          diagnostics.DerefImplsIsEmpty_subdiagnostic({
            span: this.expr_span,
            deref_ty,
          }),
        );
      }

      // Create a multipart suggestion: add `!` and `.is_empty()` in
      // place of the cast.
      err.subdiagnostic(
        diagnostics.UseIsEmpty_subdiagnostic({
          lo: Span.shrink_to_lo(this.expr_span),
          hi: Span.with_lo(this.span, Span.hi(this.expr_span)),
          expr_ty: this.expr_ty,
        }),
      );
    }
  }
};
// }

// rustc: compiler/rustc_hir_typeck/src/cast.rs:1315 index_operand_ambiguity_span
export function index_operand_ambiguity_span(expr: hir.Expr): Span {
  switch (expr.kind.$) {
    case "MethodCall":
      return expr.kind._0.ident.span;
    default:
      return expr.span;
  }
}
